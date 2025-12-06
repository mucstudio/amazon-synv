<template>
  <div class="shopify-settings">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>Shopify 爬虫参数设置</span>
          <el-button type="primary" @click="saveSettings" :loading="saving">保存设置</el-button>
        </div>
      </template>

      <el-form :model="settings" label-width="160px" v-loading="loading">
        <el-divider content-position="left">请求控制</el-divider>
        
        <el-form-item label="请求间隔">
          <el-input-number v-model="settings.shopifyRequestDelay" :min="100" :max="10000" :step="100" />
          <span class="form-tip">毫秒，建议 1000-3000，过快可能被封禁</span>
        </el-form-item>

        <el-form-item label="并发数量">
          <el-input-number v-model="settings.shopifyConcurrency" :min="1" :max="10" />
          <span class="form-tip">同时处理的请求数，建议 1-3</span>
        </el-form-item>

        <el-form-item label="请求超时">
          <el-input-number v-model="settings.shopifyTimeout" :min="5000" :max="120000" :step="1000" />
          <span class="form-tip">毫秒，单个请求的超时时间</span>
        </el-form-item>

        <el-form-item label="失败重试次数">
          <el-input-number v-model="settings.shopifyRetryCount" :min="0" :max="5" />
          <span class="form-tip">请求失败后的重试次数</span>
        </el-form-item>

        <el-divider content-position="left">代理设置</el-divider>

        <el-form-item label="启用代理">
          <el-switch v-model="settings.shopifyProxyEnabled" />
          <span class="form-tip">使用代理池中的代理进行请求</span>
        </el-form-item>

        <el-form-item label="代理轮换次数" v-if="settings.shopifyProxyEnabled">
          <el-input-number v-model="settings.shopifyProxyRotateCount" :min="1" :max="100" />
          <span class="form-tip">每个代理使用多少次后切换</span>
        </el-form-item>

        <el-divider content-position="left">反检测设置</el-divider>

        <el-form-item label="UA 轮换策略">
          <el-select v-model="settings.shopifyUARotate" style="width: 200px;">
            <el-option value="none" label="不轮换（固定 UA）" />
            <el-option value="request" label="每次请求轮换" />
            <el-option value="count" label="按次数轮换" />
          </el-select>
          <span class="form-tip">User-Agent 浏览器标识的常规轮换策略</span>
        </el-form-item>

        <el-form-item label="UA 轮换次数" v-if="settings.shopifyUARotate === 'count'">
          <el-input-number v-model="settings.shopifyUARotateCount" :min="1" :max="100" />
          <span class="form-tip">每隔多少次请求更换一次 UA</span>
        </el-form-item>

        <el-form-item label="遇错误时轮换 UA">
          <el-switch v-model="settings.shopifyUARotateOnError" />
          <span class="form-tip">请求失败或被拦截时自动更换 UA（独立于上面的策略）</span>
        </el-form-item>

        <el-alert type="info" :closable="false" style="margin-top: 20px;">
          <template #title>
            <strong>大批量抓取建议</strong>
          </template>
          <ul style="margin: 8px 0 0 0; padding-left: 20px; line-height: 1.8;">
            <li>请求间隔建议设置 2000-3000 毫秒</li>
            <li>并发数量建议设置 1-2，避免同时发起过多请求</li>
            <li>启用代理可以分散请求来源，降低被封风险</li>
            <li>UA 轮换策略：每次请求轮换最安全，按次数轮换可减少开销</li>
            <li>建议开启"遇错误时轮换 UA"，可在被拦截时自动切换浏览器标识</li>
            <li>如果遇到大量失败，可以增加请求间隔或启用代理</li>
          </ul>
        </el-alert>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

const loading = ref(false);
const saving = ref(false);
const settings = ref({
  shopifyRequestDelay: 1000,
  shopifyConcurrency: 3,
  shopifyTimeout: 30000,
  shopifyProxyEnabled: false,
  shopifyProxyRotateCount: 10,
  shopifyRetryCount: 2,
  shopifyUARotate: 'request',
  shopifyUARotateCount: 10,
  shopifyUARotateOnError: true,
});

const loadSettings = async () => {
  loading.value = true;
  try {
    const { data } = await api.getShopifySettings();
    settings.value = { ...settings.value, ...data.settings };
  } catch (e) {
    ElMessage.error('加载设置失败');
  } finally {
    loading.value = false;
  }
};

const saveSettings = async () => {
  saving.value = true;
  try {
    await api.updateShopifySettings({ settings: settings.value });
    ElMessage.success('设置已保存');
  } catch (e) {
    ElMessage.error('保存失败');
  } finally {
    saving.value = false;
  }
};

onMounted(() => {
  loadSettings();
});
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.form-tip {
  margin-left: 12px;
  color: #909399;
  font-size: 12px;
}
</style>
