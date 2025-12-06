<template>
  <div class="backup-page">
    <el-card>
      <template #header>数据备份</template>
      <el-form label-width="140px" style="max-width: 600px;">
        <el-form-item label="备份内容">
          <el-checkbox-group v-model="backupOptions">
            <el-checkbox label="settings">系统设置</el-checkbox>
            <el-checkbox label="proxies">代理列表</el-checkbox>
            <el-checkbox label="blacklist">黑名单词库</el-checkbox>
            <el-checkbox label="products">商品数据</el-checkbox>
            <el-checkbox label="tasks">任务记录</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="备份操作">
          <el-button type="primary" @click="doBackup" :loading="backupLoading" :disabled="backupOptions.length === 0">
            导出备份
          </el-button>
          <span class="form-hint">将选中的数据导出为 JSON 文件</span>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card style="margin-top: 20px;">
      <template #header>数据恢复</template>
      <el-form label-width="140px" style="max-width: 600px;">
        <el-form-item label="选择备份文件">
          <el-upload
            ref="restoreUploadRef"
            :auto-upload="false"
            :limit="1"
            accept=".json"
            :on-change="handleRestoreFileChange"
            :show-file-list="false"
          >
            <el-button type="warning">选择备份文件</el-button>
          </el-upload>
          <span class="form-hint" style="margin-left: 12px;">从备份文件恢复数据</span>
        </el-form-item>
      </el-form>
      <el-alert type="info" :closable="false" style="margin-top: 16px;">
        <template #title>备份说明</template>
        <ul style="margin: 8px 0 0 0; padding-left: 20px; line-height: 1.8;">
          <li>备份文件为 JSON 格式，可以用文本编辑器查看和编辑</li>
          <li>恢复数据会覆盖现有数据，请谨慎操作</li>
          <li>建议定期备份重要数据，如代理列表和黑名单词库</li>
        </ul>
      </el-alert>
    </el-card>

    <!-- 恢复确认弹窗 -->
    <el-dialog v-model="restoreDialogVisible" title="恢复数据确认" width="500px">
      <el-alert type="warning" :closable="false" style="margin-bottom: 16px;">
        恢复数据将覆盖现有数据，请谨慎操作！
      </el-alert>
      <div v-if="restorePreview">
        <div style="margin-bottom: 12px;">备份文件包含以下数据：</div>
        <el-checkbox-group v-model="restoreOptions">
          <div v-if="restorePreview.settings" style="margin-bottom: 8px;">
            <el-checkbox label="settings">系统设置 ({{ Object.keys(restorePreview.settings).length }} 项)</el-checkbox>
          </div>
          <div v-if="restorePreview.proxies" style="margin-bottom: 8px;">
            <el-checkbox label="proxies">代理列表 ({{ restorePreview.proxies.length }} 条)</el-checkbox>
          </div>
          <div v-if="restorePreview.blacklist" style="margin-bottom: 8px;">
            <el-checkbox label="blacklist">黑名单词库 ({{ restorePreview.blacklist.length }} 条)</el-checkbox>
          </div>
          <div v-if="restorePreview.products" style="margin-bottom: 8px;">
            <el-checkbox label="products">商品数据 ({{ restorePreview.products.length }} 条)</el-checkbox>
          </div>
          <div v-if="restorePreview.tasks" style="margin-bottom: 8px;">
            <el-checkbox label="tasks">任务记录 ({{ restorePreview.tasks.length }} 条)</el-checkbox>
          </div>
        </el-checkbox-group>
      </div>
      <template #footer>
        <el-button @click="restoreDialogVisible = false">取消</el-button>
        <el-button type="danger" @click="doRestore" :loading="restoreLoading" :disabled="restoreOptions.length === 0">
          确认恢复
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>


<script setup>
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

const backupOptions = ref(['settings', 'proxies', 'blacklist']);
const backupLoading = ref(false);
const restoreUploadRef = ref(null);
const restoreDialogVisible = ref(false);
const restorePreview = ref(null);
const restoreOptions = ref([]);
const restoreData = ref(null);
const restoreLoading = ref(false);

// 导出备份
const doBackup = async () => {
  if (backupOptions.value.length === 0) {
    ElMessage.warning('请选择要备份的内容');
    return;
  }
  backupLoading.value = true;
  try {
    const res = await api.exportBackup(backupOptions.value);
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scraper_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ElMessage.success('备份导出成功');
  } catch (e) {
    ElMessage.error('备份失败');
  } finally {
    backupLoading.value = false;
  }
};

// 选择恢复文件
const handleRestoreFileChange = (file) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      restoreData.value = data;
      restorePreview.value = data;
      restoreOptions.value = Object.keys(data).filter(k => ['settings', 'proxies', 'blacklist', 'products', 'tasks'].includes(k));
      restoreDialogVisible.value = true;
    } catch (err) {
      ElMessage.error('无效的备份文件');
    }
  };
  reader.readAsText(file.raw);
  if (restoreUploadRef.value) {
    restoreUploadRef.value.clearFiles();
  }
};

// 执行恢复
const doRestore = async () => {
  if (restoreOptions.value.length === 0) {
    ElMessage.warning('请选择要恢复的内容');
    return;
  }
  restoreLoading.value = true;
  try {
    const dataToRestore = {};
    for (const key of restoreOptions.value) {
      if (restoreData.value[key]) {
        dataToRestore[key] = restoreData.value[key];
      }
    }
    const res = await api.importBackup(dataToRestore);
    ElMessage.success(res.data.message || '恢复成功');
    restoreDialogVisible.value = false;
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '恢复失败');
  } finally {
    restoreLoading.value = false;
  }
};
</script>

<style scoped>
.form-hint { margin-left: 12px; color: #909399; font-size: 12px; }
</style>
