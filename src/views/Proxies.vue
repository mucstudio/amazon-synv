<template>
  <div class="proxies-page">
    <el-card class="toolbar-card">
      <el-row :gutter="16" align="middle">
        <el-col :span="14">
          <el-input v-model="newProxies" type="textarea" :rows="3" placeholder="每行一个，支持格式:&#10;ip:port:user:pass&#10;ip:port&#10;http://user:pass@ip:port" />
        </el-col>
        <el-col :span="10">
          <el-button type="primary" @click="addProxies" :loading="adding">添加代理</el-button>
          <el-button @click="loadProxies">刷新</el-button>
        </el-col>
      </el-row>
    </el-card>

    <el-card>
      <template #header>
        <div class="card-header">
          <div class="header-left">
            <span>代理列表</span>
            <div class="stats">
              <el-tag type="info" size="small">总数: {{ proxies.length }}</el-tag>
              <el-tag type="success" size="small">可用: {{ proxies.filter(p => p.status === 'active').length }}</el-tag>
              <el-tag type="warning" size="small">待测: {{ proxies.filter(p => p.status === 'pending').length }}</el-tag>
              <el-tag type="danger" size="small">失效: {{ proxies.filter(p => p.status === 'failed').length }}</el-tag>
            </div>
          </div>
          <div class="header-right">
            <el-button size="small" @click="batchTest" :disabled="selectedIds.length === 0" :loading="batchTesting">
              批量测试 ({{ selectedIds.length }})
            </el-button>
            <el-button size="small" type="danger" @click="batchDelete" :disabled="selectedIds.length === 0">
              批量删除 ({{ selectedIds.length }})
            </el-button>
            <el-button size="small" type="success" @click="testAllProxies" :loading="testingAll">测试全部</el-button>
            <el-button size="small" type="warning" @click="clearFailed">清除失效</el-button>
          </div>
        </div>
      </template>
      
      <el-table :data="proxies" v-loading="loading" stripe size="small" @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="45" />
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column label="代理地址" min-width="220">
          <template #default="{ row }">
            <span class="proxy-url">{{ maskProxy(row.url) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="responseTime" label="响应" width="80">
          <template #default="{ row }">
            <span v-if="row.responseTime" :class="responseClass(row.responseTime)">{{ row.responseTime }}ms</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="totalUsageCount" label="总次数" width="70" />
        <el-table-column prop="successCount" label="成功" width="60" />
        <el-table-column prop="failCount" label="失败" width="60" />
        <el-table-column prop="lastUsedAt" label="最后使用" width="160" />
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="testProxy(row.id)" :loading="row.testing">测试</el-button>
            <el-button size="small" link type="warning" @click="openEditDialog(row)">编辑</el-button>
            <el-button size="small" link type="danger" @click="deleteProxy(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="editDialogVisible" title="编辑代理" width="500px">
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="代理地址">
          <el-input v-model="editForm.rawInput" placeholder="ip:port:user:pass 或 http://user:pass@ip:port" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveEdit" :loading="saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';

const proxies = ref([]);
const loading = ref(false);
const adding = ref(false);
const testingAll = ref(false);
const batchTesting = ref(false);
const newProxies = ref('');
const selectedIds = ref([]);
const editDialogVisible = ref(false);
const editForm = ref({ id: null, rawInput: '' });
const saving = ref(false);

const maskProxy = (url) => url?.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@') || '';
const statusType = (s) => ({ active: 'success', failed: 'danger', pending: 'warning' }[s] || 'info');
const statusText = (s) => ({ active: '可用', failed: '失效', pending: '待测试' }[s] || s);
const responseClass = (time) => {
  if (time < 1000) return 'fast';
  if (time < 3000) return 'medium';
  return 'slow';
};

const handleSelectionChange = (selection) => {
  selectedIds.value = selection.map(item => item.id);
};

const loadProxies = async () => {
  loading.value = true;
  try {
    const res = await api.getProxies();
    proxies.value = res.data;
  } catch (e) {
    ElMessage.error('加载失败');
  } finally {
    loading.value = false;
  }
};

const addProxies = async () => {
  const list = newProxies.value.split('\n').map(p => p.trim()).filter(p => p);
  if (list.length === 0) return ElMessage.warning('请输入代理');
  
  adding.value = true;
  try {
    const res = await api.addProxies({ list });
    ElMessage.success(`添加成功: ${res.data.added} 个${res.data.invalid ? `, 无效: ${res.data.invalid} 个` : ''}`);
    newProxies.value = '';
    loadProxies();
  } catch (e) {
    ElMessage.error('添加失败');
  } finally {
    adding.value = false;
  }
};

const testProxy = async (id) => {
  const proxy = proxies.value.find(p => p.id === id);
  if (proxy) proxy.testing = true;
  try {
    const res = await api.testProxy(id);
    if (res.data.success) {
      ElMessage.success(`代理可用，响应: ${res.data.responseTime}ms`);
    } else {
      ElMessage.error(`代理不可用${res.data.blocked ? ' (已被封禁)' : ''}`);
    }
    loadProxies();
  } catch (e) {
    ElMessage.error('测试失败');
  } finally {
    if (proxy) proxy.testing = false;
  }
};

const testAllProxies = async () => {
  if (proxies.value.length === 0) return ElMessage.warning('没有代理可测试');
  testingAll.value = true;
  try {
    const res = await api.testAllProxies();
    ElMessage.success(`测试完成: 可用 ${res.data.successCount}/${res.data.total}`);
    loadProxies();
  } catch (e) {
    ElMessage.error('测试失败');
  } finally {
    testingAll.value = false;
  }
};

const batchTest = async () => {
  if (selectedIds.value.length === 0) return;
  batchTesting.value = true;
  try {
    const res = await api.batchTestProxies(selectedIds.value);
    ElMessage.success(`测试完成: 可用 ${res.data.successCount}/${res.data.total}`);
    loadProxies();
  } catch (e) {
    ElMessage.error('测试失败');
  } finally {
    batchTesting.value = false;
  }
};

const batchDelete = async () => {
  if (selectedIds.value.length === 0) return;
  await ElMessageBox.confirm(`确定删除选中的 ${selectedIds.value.length} 个代理？`, '批量删除', { type: 'warning' });
  try {
    const res = await api.batchDeleteProxies(selectedIds.value);
    ElMessage.success(`已删除 ${res.data.deleted} 个代理`);
    selectedIds.value = [];
    loadProxies();
  } catch (e) {
    ElMessage.error('删除失败');
  }
};

const clearFailed = async () => {
  const failedCount = proxies.value.filter(p => p.status === 'failed').length;
  if (failedCount === 0) return ElMessage.info('没有失效代理');
  await ElMessageBox.confirm(`确定清除 ${failedCount} 个失效代理？`, '提示', { type: 'warning' });
  await api.clearFailedProxies();
  ElMessage.success('已清除');
  loadProxies();
};

const deleteProxy = async (id) => {
  await ElMessageBox.confirm('确定删除？', '提示', { type: 'warning' });
  await api.deleteProxy(id);
  ElMessage.success('已删除');
  loadProxies();
};

const openEditDialog = (row) => {
  editForm.value = { id: row.id, rawInput: row.rawInput || row.url };
  editDialogVisible.value = true;
};

const saveEdit = async () => {
  if (!editForm.value.rawInput.trim()) {
    return ElMessage.warning('请输入代理地址');
  }
  saving.value = true;
  try {
    await api.updateProxy(editForm.value.id, { rawInput: editForm.value.rawInput });
    ElMessage.success('保存成功');
    editDialogVisible.value = false;
    loadProxies();
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '保存失败');
  } finally {
    saving.value = false;
  }
};

onMounted(loadProxies);
</script>

<style scoped>
.toolbar-card { margin-bottom: 16px; }
.card-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
.header-left { display: flex; align-items: center; gap: 16px; }
.header-right { display: flex; gap: 8px; flex-wrap: wrap; }
.stats { display: flex; gap: 6px; }
.proxy-url { font-family: monospace; font-size: 13px; }
.fast { color: #67c23a; }
.medium { color: #e6a23c; }
.slow { color: #f56c6c; }
</style>
