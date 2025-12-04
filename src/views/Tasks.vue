<template>
  <div class="tasks-page">
    <el-card class="toolbar-card">
      <el-row :gutter="16" align="middle">
        <el-col :span="16">
          <el-input v-model="newAsins" type="textarea" :rows="2" placeholder="输入ASIN，每行一个或用逗号分隔" />
        </el-col>
        <el-col :span="8">
          <el-button type="primary" @click="createTask" :loading="creating">创建任务</el-button>
          <el-button @click="loadTasks">刷新</el-button>
        </el-col>
      </el-row>
    </el-card>

    <el-card>
      <el-table :data="tasks" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column label="ASIN" width="120">
          <template #default="{ row }">
            <el-tooltip :content="row.asins" placement="top">
              <span>{{ row.asinCount }} 个</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="140">
          <template #default="{ row }">
            <el-progress :percentage="row.progress" :stroke-width="8" :status="row.status === 'failed' ? 'exception' : ''" />
          </template>
        </el-table-column>
        <el-table-column label="成功" width="70">
          <template #default="{ row }">
            <span class="clickable success-count" @click="showResults(row.id, 'success', row.successCount)">
              {{ row.successCount }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="失败" width="70">
          <template #default="{ row }">
            <span class="clickable fail-count" @click="showResults(row.id, 'failed', row.failCount)">
              {{ row.failCount }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="170" />
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'running'" size="small" link type="warning" @click="cancelTask(row.id)">取消</el-button>
            <el-button v-if="row.status === 'cancelled' || (row.status === 'running' && row.progress > 0)" size="small" link type="success" @click="resumeTask(row.id)">继续</el-button>
            <el-button v-if="row.status === 'failed' || row.status === 'completed' || row.status === 'cancelled'" size="small" link type="primary" @click="retryTask(row.id)">重试</el-button>
            <el-button size="small" link type="danger" @click="deleteTask(row.id)">删除</el-button>
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

    <!-- 结果详情弹窗 -->
    <el-dialog v-model="resultDialogVisible" :title="resultDialogTitle" width="700px">
      <el-table :data="resultList" v-loading="resultLoading" stripe size="small" max-height="400">
        <el-table-column prop="asin" label="ASIN" width="130">
          <template #default="{ row }">
            <a :href="`https://www.amazon.com/dp/${row.asin}`" target="_blank" class="asin-link">{{ row.asin }}</a>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 'success' ? 'success' : 'danger'" size="small">
              {{ row.status === 'success' ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="resultType === 'success'" prop="title" label="商品标题" show-overflow-tooltip />
        <el-table-column v-if="resultType === 'success'" prop="price" label="价格" width="100" />
        <el-table-column v-if="resultType === 'failed'" prop="errorMsg" label="失败原因">
          <template #default="{ row }">
            <span class="error-msg">{{ formatError(row.errorMsg) }}</span>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="resultDialogVisible = false">关闭</el-button>
        <el-button v-if="resultType === 'failed'" type="primary" @click="retryFailed">重试失败项</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';

const tasks = ref([]);
const loading = ref(false);
const creating = ref(false);
const newAsins = ref('');
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

// 结果弹窗
const resultDialogVisible = ref(false);
const resultDialogTitle = ref('');
const resultList = ref([]);
const resultLoading = ref(false);
const resultType = ref('success');
const currentTaskId = ref(null);

const statusType = (s) => ({ pending: 'info', running: 'warning', completed: 'success', failed: 'danger', cancelled: 'info' }[s] || 'info');
const statusText = (s) => ({ pending: '等待中', running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消' }[s] || s);

const formatError = (err) => {
  const errorMap = {
    'IP_BLOCKED': 'IP被封禁',
    'CAPTCHA_REQUIRED': '需要验证码',
    'ECONNREFUSED': '连接被拒绝',
    'ETIMEDOUT': '连接超时',
    'fetch failed': '请求失败',
  };
  for (const [key, value] of Object.entries(errorMap)) {
    if (err?.includes(key)) return value;
  }
  return err || '未知错误';
};

const loadTasks = async () => {
  loading.value = true;
  try {
    const res = await api.getTasks({ page: page.value, pageSize: pageSize.value });
    tasks.value = res.data.list;
    total.value = res.data.total;
  } catch (e) {
    ElMessage.error('加载失败');
  } finally {
    loading.value = false;
  }
};

const createTask = async () => {
  const asins = newAsins.value.split(/[\n,]/).map(a => a.trim()).filter(a => a);
  if (asins.length === 0) return ElMessage.warning('请输入ASIN');
  
  creating.value = true;
  try {
    await api.createTask({ asins });
    ElMessage.success('任务已创建');
    newAsins.value = '';
    loadTasks();
  } catch (e) {
    ElMessage.error('创建失败');
  } finally {
    creating.value = false;
  }
};

const cancelTask = async (id) => {
  await api.cancelTask(id);
  ElMessage.success('已取消');
  loadTasks();
};

const retryTask = async (id) => {
  await ElMessageBox.confirm('重试将清除已爬取的数据，从头开始。确定吗？', '提示', { type: 'warning' });
  await api.retryTask(id);
  ElMessage.success('已重新开始');
  loadTasks();
};

const resumeTask = async (id) => {
  await api.resumeTask(id);
  ElMessage.success('任务已继续');
  loadTasks();
};

const deleteTask = async (id) => {
  await ElMessageBox.confirm('确定删除此任务？', '提示', { type: 'warning' });
  await api.deleteTask(id);
  ElMessage.success('已删除');
  loadTasks();
};

const showResults = async (taskId, type, count) => {
  if (count === 0) {
    ElMessage.info(type === 'success' ? '没有成功记录' : '没有失败记录');
    return;
  }
  
  currentTaskId.value = taskId;
  resultType.value = type;
  resultDialogTitle.value = type === 'success' ? `成功记录 (${count})` : `失败记录 (${count})`;
  resultDialogVisible.value = true;
  resultLoading.value = true;
  
  try {
    const res = await api.getTaskResults(taskId, type);
    resultList.value = res.data;
  } catch (e) {
    ElMessage.error('加载失败');
  } finally {
    resultLoading.value = false;
  }
};

const retryFailed = async () => {
  const failedAsins = resultList.value.map(r => r.asin);
  if (failedAsins.length === 0) return;
  
  try {
    await api.createTask({ asins: failedAsins });
    ElMessage.success('已创建重试任务');
    resultDialogVisible.value = false;
    loadTasks();
  } catch (e) {
    ElMessage.error('创建失败');
  }
};

onMounted(loadTasks);
</script>

<style scoped>
.toolbar-card { margin-bottom: 16px; }
.clickable {
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
  transition: background 0.2s;
}
.clickable:hover { background: #f0f0f0; }
.success-count { color: #67c23a; font-weight: 500; }
.fail-count { color: #f56c6c; font-weight: 500; }
.asin-link { color: #409eff; text-decoration: none; }
.asin-link:hover { text-decoration: underline; }
.error-msg { color: #f56c6c; font-size: 12px; }
</style>
