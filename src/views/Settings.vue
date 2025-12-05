<template>
  <div class="settings-page">
    <el-card>
      <template #header>爬取设置</template>
      <el-form :model="settings" label-width="140px" style="max-width: 600px;">
        <el-form-item label="并发数">
          <el-input-number v-model="settings.concurrency" :min="1" :max="20" />
          <span class="form-hint">同时爬取的商品数量</span>
        </el-form-item>
        <el-form-item label="请求间隔(ms)">
          <el-input-number v-model="settings.requestDelay" :min="0" :max="10000" :step="100" />
          <span class="form-hint">每次请求之间的延迟</span>
        </el-form-item>
        <el-form-item label="请求超时(ms)">
          <el-input-number v-model="settings.timeout" :min="5000" :max="60000" :step="1000" />
        </el-form-item>
        <el-form-item label="亚马逊域名">
          <el-select v-model="settings.amazonDomain" style="width: 100%;">
            <el-option label="美国 (amazon.com)" value="https://www.amazon.com" />
            <el-option label="日本 (amazon.co.jp)" value="https://www.amazon.co.jp" />
            <el-option label="英国 (amazon.co.uk)" value="https://www.amazon.co.uk" />
            <el-option label="德国 (amazon.de)" value="https://www.amazon.de" />
            <el-option label="法国 (amazon.fr)" value="https://www.amazon.fr" />
          </el-select>
        </el-form-item>
        <el-form-item label="收货地址邮编">
          <el-input v-model="settings.zipCode" placeholder="10001" style="width: 150px;" />
          <span class="form-hint">影响价格和配送信息显示</span>
        </el-form-item>
        <el-form-item label="保存原始HTML">
          <el-switch v-model="settings.saveHtml" />
          <span class="form-hint">保存到 data/html/ 目录，方便调试和重新解析</span>
        </el-form-item>
        <el-form-item label="配送类型筛选">
          <el-radio-group v-model="settings.fulfillmentFilter" disabled>
            <el-radio value="all">全部</el-radio>
            <el-radio value="fba">只爬取 FBA</el-radio>
            <el-radio value="fbm">只爬取 FBM</el-radio>
          </el-radio-group>
          <el-tag type="warning" size="small" style="margin-left: 10px;">待开发</el-tag>
          <div class="form-hint" style="margin-left: 0; margin-top: 5px;">
            FBA=亚马逊发货，FBM=卖家自发货。选择后会自动从 Other Sellers 获取对应类型的最低价
          </div>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card style="margin-top: 20px;">
      <template #header>反检测设置</template>
      <el-form :model="settings" label-width="180px" style="max-width: 650px;">
        <el-form-item label="遇到验证码时更换指纹">
          <el-switch v-model="settings.fingerprintRotateOnCaptcha" />
          <span class="form-hint">检测到验证码时自动更换浏览器指纹</span>
        </el-form-item>
        <el-form-item label="指纹轮换策略">
          <el-select v-model="settings.fingerprintRotate" style="width: 180px;">
            <el-option value="none" label="不主动轮换" />
            <el-option value="batch" label="每批次更换" />
            <el-option value="count" label="按请求次数更换" />
            <el-option value="request" label="每次请求更换" />
          </el-select>
          <el-input-number 
            v-if="settings.fingerprintRotate === 'count'" 
            v-model="settings.fingerprintRotateCount" 
            :min="1" :max="100" 
            style="margin-left: 10px;"
          />
          <span v-if="settings.fingerprintRotate === 'count'" class="form-hint">次后更换</span>
          <div class="form-hint" style="margin-left: 0; margin-top: 5px;">
            浏览器指纹包括 User-Agent、sec-ch-ua 等，更换频率越高越安全但可能影响效率
          </div>
        </el-form-item>
        <el-form-item label="验证码处理方式">
          <el-radio-group v-model="settings.captchaHandling">
            <el-radio value="auto">自动处理（简单验证码）</el-radio>
            <el-radio value="skip">跳过（标记失败）</el-radio>
            <el-radio value="retry">更换指纹后重试</el-radio>
          </el-radio-group>
          <div class="form-hint" style="margin-left: 0; margin-top: 5px;">
            自动处理：简单验证码自动完成，复杂验证码转人工处理
          </div>
        </el-form-item>
        <el-form-item label="验证码重试次数">
          <el-input-number v-model="settings.captchaRetryCount" :min="0" :max="5" />
          <span class="form-hint">更换指纹后重试的最大次数，0=不重试</span>
        </el-form-item>
        <el-form-item label="人工处理超时(秒)">
          <el-input-number v-model="settings.captchaTimeout" :min="30" :max="600" :step="30" />
          <span class="form-hint">等待人工处理验证码的最长时间</span>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card style="margin-top: 20px;">
      <template #header>代理设置</template>
      <el-form :model="settings" label-width="140px" style="max-width: 600px;">
        <el-form-item label="启用代理">
          <el-switch v-model="settings.proxyEnabled" />
        </el-form-item>
        <el-form-item label="按次数轮换">
          <el-input-number v-model="settings.proxyRotateByCount" :min="0" :max="100" />
          <span class="form-hint">每个代理使用N次后切换，0=禁用</span>
        </el-form-item>
        <el-form-item label="按时间轮换(秒)">
          <el-input-number v-model="settings.proxyRotateByTime" :min="0" :max="86400" />
          <span class="form-hint">每N秒切换代理，0=禁用（最大24小时）</span>
        </el-form-item>
        <el-form-item label="最大失败次数">
          <el-input-number v-model="settings.proxyMaxFailures" :min="1" :max="10" />
          <span class="form-hint">失败N次后禁用该代理</span>
        </el-form-item>
        <el-form-item label="失败自动切换">
          <el-switch v-model="settings.proxySwitchOnFail" />
          <span class="form-hint">请求失败时自动切换到下一个代理重试</span>
        </el-form-item>
        <el-form-item label="失败重试次数" v-if="settings.proxySwitchOnFail">
          <el-input-number v-model="settings.proxyFailRetryCount" :min="1" :max="5" />
          <span class="form-hint">切换代理后最多重试N次</span>
        </el-form-item>
      </el-form>
    </el-card>

    <div style="margin-top: 20px;">
      <el-button type="primary" size="large" @click="saveSettings" :loading="saving">保存设置</el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

const settings = ref({
  concurrency: 5,
  requestDelay: 1000,
  timeout: 30000,
  amazonDomain: 'https://www.amazon.com',
  zipCode: '10001',
  proxyEnabled: false,
  proxyRotateByCount: 10,
  proxyRotateByTime: 60,
  proxyMaxFailures: 3,
  proxySwitchOnFail: true,      // 失败时自动切换代理
  proxyFailRetryCount: 2,       // 切换代理后重试次数
  saveHtml: false,
  fulfillmentFilter: 'all',
  fingerprintRotateOnCaptcha: true,  // 遇到验证码时更换指纹
  fingerprintRotate: 'none',          // 主动轮换策略：none/batch/count/request
  fingerprintRotateCount: 10,
  captchaHandling: 'auto',
  captchaRetryCount: 2,
  captchaTimeout: 300,
});
const saving = ref(false);

const loadSettings = async () => {
  try {
    const res = await api.getSettings();
    settings.value = { ...settings.value, ...res.data };
  } catch (e) {
    console.error(e);
  }
};

const saveSettings = async () => {
  saving.value = true;
  try {
    await api.updateSettings(settings.value);
    ElMessage.success('设置已保存');
  } catch (e) {
    ElMessage.error('保存失败');
  } finally {
    saving.value = false;
  }
};

onMounted(loadSettings);
</script>

<style scoped>
.form-hint { margin-left: 12px; color: #909399; font-size: 12px; }
</style>
