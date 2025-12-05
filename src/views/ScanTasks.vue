<template>
  <div class="scan-tasks-page">
    <!-- 创建任务卡片 -->
    <el-card class="toolbar-card">
      <el-row :gutter="16" align="middle">
        <el-col :span="6">
          <el-input v-model="newTask.name" placeholder="任务名称" />
        </el-col>
        <el-col :span="6">
          <el-select v-model="newTask.productScope" placeholder="商品范围" style="width: 100%;">
            <el-option label="全部商品" value="all" />
            <el-option 
              v-for="task in crawlTasks" 
              :key="task.id" 
              :label="`任务 #${task.id} (${task.asinCount}个)`" 
              :value="String(task.id)" 
            />
          </el-select>
        </el-col>
        <el-col :span="12">
          <el-button type="primary" @click="createTask" :loading="creating">创建扫描任务</el-button>
          <el-button @click="loadTasks">刷新</el-button>
        </el-col>
      </el-row>
    </el-card>

    <!-- 任务列表 -->
    <el-card>
      <template #header>
        <div class="card-header">
          <span>扫描任务列表</span>
          <el-tag type="info">共 {{ total }} 个任务</el-tag>
        </div>
      </template>
      
      <el-table :data="tasks" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="name" label="任务名称" min-width="150" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="150">
          <template #default="{ row }">
            <el-progress :percentage="row.progress" :stroke-width="8" />
          </template>
        </el-table-column>
        <el-table-column label="扫描/命中" width="120">
          <template #default="{ row }">
            <span>{{ row.scannedCount || 0 }} / </span>
            <span class="matched-count">{{ row.matchedCount || 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="170" />
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button 
              v-if="row.status === 'completed'" 
              size="small" link type="primary" 
              @click="showResults(row)"
            >查看结果</el-button>
            <el-button 
              v-if="row.status === 'completed'" 
              size="small" link type="success" 
              @click="downloadResults(row.id)"
            >下载</el-button>
            <el-button 
              size="small" link type="danger" 
              @click="deleteTask(row.id)"
            >删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        style="margin-top: 16px; justify-content: flex-end;"
        @current-change="loadTasks"
      />
    </el-card>

    <!-- 结果查看弹窗 -->
    <el-dialog v-model="resultDialogVisible" :title="resultDialogTitle" width="90%" top="5vh">
      <div class="result-toolbar">
        <el-radio-group v-model="resultFilter" @change="loadResults">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="violation">有违规</el-radio-button>
          <el-radio-button value="brand">品牌</el-radio-button>
          <el-radio-button value="product">产品</el-radio-button>
          <el-radio-button value="tro">TRO</el-radio-button>
          <el-radio-button value="seller">卖家</el-radio-button>
        </el-radio-group>
        <el-button type="success" @click="downloadResults(currentTaskId, resultFilter)">
          下载当前筛选结果
        </el-button>
      </div>
      
      <el-table :data="results" v-loading="resultLoading" stripe size="small" max-height="500">
        <el-table-column prop="asin" label="ASIN" width="120">
          <template #default="{ row }">
            <a :href="`https://www.amazon.com/dp/${row.asin}`" target="_blank" class="asin-link">{{ row.asin }}</a>
          </template>
        </el-table-column>
        <el-table-column prop="totalPrice" label="总价" width="90" />
        <el-table-column label="库存" width="70">
          <template #default="{ row }">
            {{ formatStock(row.stock) }}
          </template>
        </el-table-column>
        <el-table-column label="快递" width="70">
          <template #default="{ row }">
            {{ row.deliveryDays ? row.deliveryDays + '天' : '' }}
          </template>
        </el-table-column>
        <el-table-column prop="matchedSeller" label="黑名单卖家" width="120" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.matchedSeller" class="violation-text">{{ row.matchedSeller }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="matchedTro" label="TRO违规词" width="120" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.matchedTro" class="violation-text">{{ row.matchedTro }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="matchedBrand" label="品牌违规词" width="120" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.matchedBrand" class="violation-text">{{ row.matchedBrand }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="matchedProduct" label="产品违规词" width="120" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.matchedProduct" class="violation-text">{{ row.matchedProduct }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="产品标题" min-width="200" show-overflow-tooltip />
      </el-table>

      <el-pagination
        v-model:current-page="resultPage"
        v-model:page-size="resultPageSize"
        :total="resultTotal"
        layout="total, sizes, prev, pager, next"
        :page-sizes="[50, 100, 200]"
        style="margin-top: 16px; justify-content: flex-end;"
        @current-change="loadResults"
        @size-change="loadResults"
      />
    </el-dialog>
  </div>
</template>


<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';

const tasks = ref([]);
const loading = ref(false);
const creating = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const newTask = ref({ name: '', productScope: 'all' });
const crawlTasks = ref([]); // 爬取任务列表，用于选择商品范围

// 结果弹窗
const resultDialogVisible = ref(false);
const resultDialogTitle = ref('');
const results = ref([]);
const resultLoading = ref(false);
const resultFilter = ref('');
const resultPage = ref(1);
const resultPageSize = ref(50);
const resultTotal = ref(0);
const currentTaskId = ref(null);

// 轮询定时器
let pollTimer = null;

const statusType = (s) => ({
  pending: 'info',
  running: 'warning',
  completed: 'success',
  failed: 'danger'
}[s] || 'info');

const statusText = (s) => ({
  pending: '等待中',
  running: '扫描中',
  completed: '已完成',
  failed: '失败'
}[s] || s);

const formatStock = (stock) => {
  if (stock === -1) return '有货';
  if (stock === 0) return '缺货';
  if (stock === null || stock === undefined) return '';
  return String(stock);
};

const loadTasks = async () => {
  loading.value = true;
  try {
    const res = await api.getScanTasks({ page: page.value, pageSize: pageSize.value });
    tasks.value = res.data.list;
    total.value = res.data.total;
    
    // 如果有运行中的任务，启动轮询
    const hasRunning = tasks.value.some(t => t.status === 'running' || t.status === 'pending');
    if (hasRunning && !pollTimer) {
      startPolling();
    } else if (!hasRunning && pollTimer) {
      stopPolling();
    }
  } catch (e) {
    ElMessage.error('加载失败');
  } finally {
    loading.value = false;
  }
};

const loadCrawlTasks = async () => {
  try {
    const res = await api.getTasks({ pageSize: 100 });
    crawlTasks.value = res.data.list.filter(t => t.status === 'completed');
  } catch (e) {
    console.error(e);
  }
};

const createTask = async () => {
  if (!newTask.value.name) {
    ElMessage.warning('请输入任务名称');
    return;
  }
  
  creating.value = true;
  try {
    await api.createScanTask(newTask.value);
    ElMessage.success('扫描任务已创建');
    newTask.value = { name: '', productScope: 'all' };
    loadTasks();
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '创建失败');
  } finally {
    creating.value = false;
  }
};

const deleteTask = async (id) => {
  await ElMessageBox.confirm('确定删除此扫描任务？', '提示', { type: 'warning' });
  await api.deleteScanTask(id);
  ElMessage.success('已删除');
  loadTasks();
};

const showResults = async (task) => {
  currentTaskId.value = task.id;
  resultDialogTitle.value = `扫描结果 - ${task.name} (命中 ${task.matchedCount} 个)`;
  resultDialogVisible.value = true;
  resultFilter.value = '';
  resultPage.value = 1;
  loadResults();
};

const loadResults = async () => {
  resultLoading.value = true;
  try {
    const res = await api.getScanResults(currentTaskId.value, {
      page: resultPage.value,
      pageSize: resultPageSize.value,
      filter: resultFilter.value
    });
    results.value = res.data.list;
    resultTotal.value = res.data.total;
  } catch (e) {
    ElMessage.error('加载结果失败');
  } finally {
    resultLoading.value = false;
  }
};

const downloadResults = async (taskId, filter = '') => {
  try {
    const res = await api.downloadScanResults(taskId, filter);
    const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scan_results_${taskId}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  } catch (e) {
    ElMessage.error('下载失败');
  }
};

const startPolling = () => {
  pollTimer = setInterval(() => {
    loadTasks();
  }, 2000);
};

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

onMounted(() => {
  loadTasks();
  loadCrawlTasks();
});

onUnmounted(() => {
  stopPolling();
});
</script>

<style scoped>
.toolbar-card { margin-bottom: 16px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.matched-count { color: #f56c6c; font-weight: 600; }
.asin-link { color: #409eff; text-decoration: none; }
.asin-link:hover { text-decoration: underline; }
.violation-text { color: #f56c6c; }
.result-toolbar { 
  display: flex; 
  justify-content: space-between; 
  align-items: center; 
  margin-bottom: 16px; 
}
</style>
