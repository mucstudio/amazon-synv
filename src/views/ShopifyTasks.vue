<template>
  <div class="shopify-tasks">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>Shopify 任务管理</span>
          <div>
            <el-button type="danger" size="small" @click="clearCompleted" :disabled="!hasCompleted">
              清空已完成
            </el-button>
            <el-button type="primary" size="small" @click="loadTasks">
              <el-icon><Refresh /></el-icon> 刷新
            </el-button>
          </div>
        </div>
      </template>

      <el-table :data="tasks" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column prop="type" label="类型" width="120">
          <template #default="{ row }">
            <el-tag size="small">{{ typeLabels[row.type] || row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="范围" min-width="150">
          <template #default="{ row }">
            <span v-if="row.productIds">指定商品 ({{ JSON.parse(row.productIds).length }})</span>
            <span v-else-if="row.collectionTitle">{{ row.collectionTitle }}</span>
            <span v-else-if="row.storeName">{{ row.storeName }}</span>
            <span v-else>全部未获取</span>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="200">
          <template #default="{ row }">
            <el-progress 
              :percentage="row.totalCount ? Math.round(row.processedCount / row.totalCount * 100) : 0"
              :status="progressStatus(row)"
            />
            <div class="progress-text">
              {{ row.processedCount }} / {{ row.totalCount }}
              <span v-if="row.successCount || row.failCount">
                (成功: {{ row.successCount }}, 失败: {{ row.failCount }})
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">
              {{ statusLabels[row.status] || row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="160" />
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button-group size="small">
              <el-button v-if="row.status === 'running'" @click="pauseTask(row)" type="warning">
                暂停
              </el-button>
              <el-button v-if="row.status === 'paused'" @click="resumeTask(row)" type="success">
                继续
              </el-button>
              <el-button 
                v-if="['running', 'paused', 'pending'].includes(row.status)" 
                @click="cancelTask(row)" 
                type="danger"
              >
                取消
              </el-button>
              <el-button 
                v-if="['completed', 'cancelled', 'failed'].includes(row.status)" 
                @click="deleteTask(row)" 
                type="danger"
              >
                删除
              </el-button>
            </el-button-group>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-if="total > pageSize"
        class="pagination"
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="handlePageChange"
      />
    </el-card>
  </div>
</template>


<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import api from '../api';

const loading = ref(false);
const tasks = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
let pollTimer = null;

const typeLabels = {
  'fetch-details': '获取详情',
};

const statusLabels = {
  pending: '等待中',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
  failed: '失败',
};

const hasCompleted = computed(() => {
  return tasks.value.some(t => ['completed', 'cancelled', 'failed'].includes(t.status));
});

const statusType = (status) => {
  const map = {
    pending: 'info',
    running: 'primary',
    paused: 'warning',
    completed: 'success',
    cancelled: 'info',
    failed: 'danger',
  };
  return map[status] || 'info';
};

const progressStatus = (row) => {
  if (row.status === 'completed') return 'success';
  if (row.status === 'failed') return 'exception';
  if (row.status === 'cancelled') return 'warning';
  return '';
};

const loadTasks = async () => {
  loading.value = true;
  try {
    const { data } = await api.getShopifyTasks({ page: page.value, pageSize: pageSize.value });
    tasks.value = data.tasks;
    total.value = data.total;
  } catch (e) {
    ElMessage.error('加载任务失败');
  } finally {
    loading.value = false;
  }
};

const handlePageChange = (p) => {
  page.value = p;
  loadTasks();
};

const pauseTask = async (row) => {
  try {
    await api.pauseShopifyTask(row.id);
    ElMessage.success('任务已暂停');
    loadTasks();
  } catch (e) {
    ElMessage.error('暂停失败');
  }
};

const resumeTask = async (row) => {
  try {
    await api.resumeShopifyTask(row.id);
    ElMessage.success('任务已恢复');
    loadTasks();
  } catch (e) {
    ElMessage.error('恢复失败');
  }
};

const cancelTask = async (row) => {
  try {
    await ElMessageBox.confirm('确定取消该任务？', '提示', { type: 'warning' });
    await api.cancelShopifyTask(row.id);
    ElMessage.success('任务已取消');
    loadTasks();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('取消失败');
  }
};

const deleteTask = async (row) => {
  try {
    await ElMessageBox.confirm('确定删除该任务？', '提示', { type: 'warning' });
    await api.deleteShopifyTask(row.id);
    ElMessage.success('已删除');
    loadTasks();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('删除失败');
  }
};

const clearCompleted = async () => {
  try {
    await ElMessageBox.confirm('确定清空所有已完成/已取消/失败的任务？', '提示', { type: 'warning' });
    const { data } = await api.clearCompletedShopifyTasks();
    ElMessage.success(`已清空 ${data.deleted} 个任务`);
    loadTasks();
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('清空失败');
  }
};

// 轮询刷新（有运行中任务时）
const startPolling = () => {
  pollTimer = setInterval(() => {
    const hasRunning = tasks.value.some(t => ['running', 'pending', 'paused'].includes(t.status));
    if (hasRunning) {
      loadTasks();
    }
  }, 2000);
};

onMounted(() => {
  loadTasks();
  startPolling();
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.progress-text {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
.pagination {
  margin-top: 16px;
  justify-content: flex-end;
}
</style>
