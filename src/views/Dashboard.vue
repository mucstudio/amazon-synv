<template>
  <div class="dashboard">
    <el-row :gutter="20" class="stats-row">
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-icon" style="background: #409eff"><el-icon><List /></el-icon></div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.totalTasks }}</div>
            <div class="stat-label">总任务数</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-icon" style="background: #67c23a"><el-icon><Goods /></el-icon></div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.totalProducts }}</div>
            <div class="stat-label">商品总数</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-icon" style="background: #e6a23c"><el-icon><Loading /></el-icon></div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.runningTasks }}</div>
            <div class="stat-label">运行中任务</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-icon" style="background: #909399"><el-icon><Connection /></el-icon></div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.activeProxies }}</div>
            <div class="stat-label">可用代理</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20">
      <el-col :span="16">
        <el-card class="section-card">
          <template #header>
            <div class="card-header">
              <span>最近任务</span>
              <el-button type="primary" size="small" @click="$router.push('/tasks')">查看全部</el-button>
            </div>
          </template>
          <el-table :data="recentTasks" stripe size="small">
            <el-table-column prop="id" label="ID" width="80" />
            <el-table-column prop="asinCount" label="ASIN数" width="80" />
            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="progress" label="进度" width="120">
              <template #default="{ row }">
                <el-progress :percentage="row.progress" :stroke-width="6" />
              </template>
            </el-table-column>
            <el-table-column prop="createdAt" label="创建时间" />
          </el-table>
        </el-card>
      </el-col>
      
      <el-col :span="8">
        <el-card class="section-card">
          <template #header>快速爬取</template>
          <el-input
            v-model="quickAsins"
            type="textarea"
            :rows="4"
            placeholder="输入ASIN，每行一个"
          />
          <el-button type="primary" style="margin-top: 12px; width: 100%" @click="quickScrape" :loading="submitting">
            开始爬取
          </el-button>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

const stats = ref({ totalTasks: 0, totalProducts: 0, runningTasks: 0, activeProxies: 0 });
const recentTasks = ref([]);
const quickAsins = ref('');
const submitting = ref(false);

const statusType = (s) => ({ pending: 'info', running: 'warning', completed: 'success', failed: 'danger' }[s] || 'info');
const statusText = (s) => ({ pending: '等待中', running: '运行中', completed: '已完成', failed: '失败' }[s] || s);

const loadData = async () => {
  try {
    const [statsRes, tasksRes] = await Promise.all([api.getStats(), api.getTasks({ limit: 5 })]);
    stats.value = statsRes.data;
    recentTasks.value = tasksRes.data.list;
  } catch (e) {
    console.error(e);
  }
};

const quickScrape = async () => {
  const asins = quickAsins.value.trim().split('\n').filter(a => a.trim());
  if (asins.length === 0) return ElMessage.warning('请输入ASIN');
  
  submitting.value = true;
  try {
    await api.createTask({ asins });
    ElMessage.success('任务已创建');
    quickAsins.value = '';
    loadData();
  } catch (e) {
    ElMessage.error('创建失败: ' + e.message);
  } finally {
    submitting.value = false;
  }
};

onMounted(loadData);
</script>

<style scoped>
.stats-row { margin-bottom: 20px; }
.stat-card { display: flex; align-items: center; padding: 10px; }
.stat-card :deep(.el-card__body) { display: flex; align-items: center; width: 100%; }
.stat-icon {
  width: 60px; height: 60px;
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 28px;
  margin-right: 16px;
}
.stat-info { flex: 1; }
.stat-value { font-size: 28px; font-weight: 600; color: #303133; }
.stat-label { font-size: 14px; color: #909399; margin-top: 4px; }
.section-card { margin-bottom: 20px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
</style>
