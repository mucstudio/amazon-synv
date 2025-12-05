<template>
  <div class="products-page">
    <el-card class="toolbar-card">
      <el-row :gutter="16" align="middle">
        <el-col :span="5">
          <el-input v-model="filters.keyword" placeholder="搜索ASIN/标题" clearable @keyup.enter="loadProducts" />
        </el-col>
        <el-col :span="4">
          <el-select v-model="filters.taskId" placeholder="选择任务" clearable>
            <el-option v-for="t in taskOptions" :key="t.id" :label="`任务 #${t.id}`" :value="t.id" />
          </el-select>
        </el-col>
        <el-col :span="15" style="text-align: right;">
          <el-button @click="loadProducts">搜索</el-button>
          <el-button type="success" @click="exportData">导出 CSV</el-button>
          <el-button type="warning" @click="batchDelete" :disabled="selectedIds.length === 0">
            批量删除 ({{ selectedIds.length }})
          </el-button>
          <el-button type="danger" @click="clearAll">清空全部</el-button>
        </el-col>
      </el-row>
    </el-card>

    <el-card>
      <template #header>
        <div class="card-header">
          <span>商品列表</span>
          <el-tag type="info">共 {{ total }} 条</el-tag>
        </div>
      </template>
      
      <el-table 
        :data="products" 
        v-loading="loading" 
        stripe 
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="50" />
        <el-table-column label="图片" width="70">
          <template #default="{ row }">
            <el-image v-if="row.image" :src="row.image" :preview-src-list="[row.image]" fit="contain" style="width: 50px; height: 50px;" />
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="asin" label="ASIN" width="120">
          <template #default="{ row }">
            <a :href="`https://www.amazon.com/dp/${row.asin}`" target="_blank" class="asin-link">{{ row.asin }}</a>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="250" show-overflow-tooltip />
        <el-table-column prop="price" label="价格" width="90" />
        <el-table-column prop="shippingFee" label="运费" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.shippingFee === 'FREE'" type="success" size="small">免运费</el-tag>
            <span v-else-if="row.shippingFee">{{ row.shippingFee }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="totalPrice" label="总价" width="90" />
        <el-table-column prop="rating" label="评分" width="70" />
        <el-table-column prop="reviewCount" label="评论数" width="90" />
        <el-table-column prop="deliveryInfo" label="送达" width="140" show-overflow-tooltip />
        <el-table-column prop="deliveryDays" label="天数" width="70">
          <template #default="{ row }">
            <el-tag v-if="row.deliveryDays !== null && row.deliveryDays !== undefined" :type="row.deliveryDays <= 3 ? 'success' : row.deliveryDays <= 7 ? 'warning' : 'info'" size="small">
              {{ row.deliveryDays }}天
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="fulfillmentType" label="配送" width="70">
          <template #default="{ row }">
            <el-tag v-if="row.fulfillmentType === 'FBA'" type="success" size="small">FBA</el-tag>
            <el-tag v-else-if="row.fulfillmentType === 'FBM'" type="warning" size="small">FBM</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="stock" label="库存" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.stock === 0" type="danger" size="small">缺货</el-tag>
            <el-tag v-else-if="row.stock === -1" type="success" size="small">有货</el-tag>
            <el-tag v-else-if="row.stock > 0" :type="row.stock <= 5 ? 'warning' : 'success'" size="small">{{ row.stock }}</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="sellerName" label="卖家" width="120" show-overflow-tooltip />
        <el-table-column prop="createdAt" label="爬取时间" width="170" />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="showDetail(row)">详情</el-button>
            <el-button size="small" link type="danger" @click="deleteProduct(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrapper">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          layout="total, sizes, prev, pager, next, jumper"
          :page-sizes="[20, 50, 100, 200]"
          @current-change="loadProducts"
          @size-change="handleSizeChange"
        />
      </div>
    </el-card>

    <el-dialog v-model="detailVisible" title="商品详情" width="750px">
      <el-descriptions :column="2" border v-if="currentProduct">
        <el-descriptions-item label="ASIN">
          <a :href="`https://www.amazon.com/dp/${currentProduct.asin}`" target="_blank">{{ currentProduct.asin }}</a>
        </el-descriptions-item>
        <el-descriptions-item label="价格">{{ currentProduct.price }}</el-descriptions-item>
        <el-descriptions-item label="运费">
          <el-tag v-if="currentProduct.shippingFee === 'FREE'" type="success">免运费</el-tag>
          <span v-else-if="currentProduct.shippingFee">{{ currentProduct.shippingFee }}</span>
          <span v-else>-</span>
        </el-descriptions-item>
        <el-descriptions-item label="总价">{{ currentProduct.totalPrice || '-' }}</el-descriptions-item>
        <el-descriptions-item label="评分">{{ currentProduct.rating }}</el-descriptions-item>
        <el-descriptions-item label="评论数">{{ currentProduct.reviewCount }}</el-descriptions-item>
        <el-descriptions-item label="配送类型">
          <el-tag v-if="currentProduct.fulfillmentType === 'FBA'" type="success">FBA (亚马逊配送)</el-tag>
          <el-tag v-else-if="currentProduct.fulfillmentType === 'FBM'" type="warning">FBM (卖家配送)</el-tag>
          <span v-else>未知</span>
        </el-descriptions-item>
        <el-descriptions-item label="库存">
          <el-tag v-if="currentProduct.stock === 0" type="danger">缺货</el-tag>
          <el-tag v-else-if="currentProduct.stock === -1" type="success">有货</el-tag>
          <el-tag v-else-if="currentProduct.stock > 0" :type="currentProduct.stock <= 5 ? 'warning' : 'success'">{{ currentProduct.stock }} 件</el-tag>
          <span v-else>未知</span>
        </el-descriptions-item>
        <el-descriptions-item label="卖家" :span="2">{{ currentProduct.sellerName || '-' }}</el-descriptions-item>
        <el-descriptions-item label="标题" :span="2">{{ currentProduct.title }}</el-descriptions-item>
        <el-descriptions-item label="送达信息">{{ currentProduct.deliveryInfo }}</el-descriptions-item>
        <el-descriptions-item label="预估天数">
          <el-tag v-if="currentProduct.deliveryDays !== null && currentProduct.deliveryDays !== undefined" :type="currentProduct.deliveryDays <= 3 ? 'success' : currentProduct.deliveryDays <= 7 ? 'warning' : 'info'">
            {{ currentProduct.deliveryDays }} 天
          </el-tag>
          <span v-else>-</span>
        </el-descriptions-item>
        <el-descriptions-item label="五点描述" :span="2">
          <ul style="margin: 0; padding-left: 20px;">
            <li v-for="(b, i) in parseBullets(currentProduct.bulletPoints)" :key="i">{{ b }}</li>
          </ul>
        </el-descriptions-item>
        <el-descriptions-item label="商品描述" :span="2">
          <div style="max-height: 200px; overflow-y: auto;">{{ currentProduct.description }}</div>
        </el-descriptions-item>
        <el-descriptions-item label="图片预览" :span="2">
          <div class="image-list">
            <el-image 
              v-for="(img, i) in parseImages(currentProduct.images)" 
              :key="i" 
              :src="img" 
              :preview-src-list="parseImages(currentProduct.images)"
              fit="contain"
              style="width: 80px; height: 80px; margin-right: 8px;"
            />
          </div>
        </el-descriptions-item>
        <el-descriptions-item label="高清图链接" :span="2" v-if="getHdImages(currentProduct.images).length > 0">
          <div class="hd-image-links">
            <div v-for="(img, i) in getHdImages(currentProduct.images)" :key="i" class="hd-link-item">
              <span class="hd-link-index">{{ i + 1 }}.</span>
              <a :href="img" target="_blank" class="hd-link">{{ img }}</a>
              <el-button size="small" link type="primary" @click="copyToClipboard(img)">复制</el-button>
            </div>
          </div>
        </el-descriptions-item>
        <el-descriptions-item label="商品属性" :span="2" v-if="hasAttributes(currentProduct.attributes)">
          <el-table :data="parseAttributesTable(currentProduct.attributes)" size="small" border style="width: 100%">
            <el-table-column prop="key" label="属性名" width="180" />
            <el-table-column prop="value" label="属性值" />
          </el-table>
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';

const products = ref([]);
const loading = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const filters = ref({ keyword: '', taskId: '' });
const taskOptions = ref([]);
const detailVisible = ref(false);
const currentProduct = ref(null);
const selectedIds = ref([]);

const parseBullets = (str) => {
  if (!str) return [];
  try { return JSON.parse(str); } catch { return [str]; }
};

const parseImages = (str) => {
  if (!str) return [];
  try { return JSON.parse(str); } catch { return []; }
};

const parseAttributes = (str) => {
  if (!str) return {};
  try { return JSON.parse(str); } catch { return {}; }
};

const hasAttributes = (str) => {
  const attrs = parseAttributes(str);
  return Object.keys(attrs).length > 0;
};

const parseAttributesTable = (str) => {
  const attrs = parseAttributes(str);
  return Object.entries(attrs).map(([key, value]) => ({ key, value }));
};

// 将图片 URL 转换为高清图链接（去掉尺寸参数）
const toHdImage = (url) => {
  if (!url) return '';
  // 匹配 Amazon 图片 URL 中的尺寸参数，如 ._AC_SL1400_. 或 ._SX300_. 等
  return url.replace(/\._[A-Z0-9_,]+_\./, '.');
};

// 获取所有高清图链接
const getHdImages = (str) => {
  const images = parseImages(str);
  return images.map(img => toHdImage(img)).filter(img => img);
};

// 复制到剪贴板
const copyToClipboard = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('已复制到剪贴板');
  } catch (e) {
    ElMessage.error('复制失败');
  }
};

const handleSelectionChange = (selection) => {
  selectedIds.value = selection.map(item => item.id);
};

const handleSizeChange = () => {
  page.value = 1;
  loadProducts();
};

const loadProducts = async () => {
  loading.value = true;
  try {
    const res = await api.getProducts({ page: page.value, pageSize: pageSize.value, ...filters.value });
    products.value = res.data.list;
    total.value = res.data.total;
  } catch (e) {
    ElMessage.error('加载失败');
  } finally {
    loading.value = false;
  }
};

const loadTasks = async () => {
  try {
    const res = await api.getTasks({ pageSize: 100 });
    taskOptions.value = res.data.list;
  } catch (e) {
    console.error(e);
  }
};

const showDetail = (row) => {
  currentProduct.value = row;
  detailVisible.value = true;
};

const deleteProduct = async (id) => {
  await ElMessageBox.confirm('确定删除该商品？', '提示', { type: 'warning' });
  await api.deleteProduct(id);
  ElMessage.success('已删除');
  loadProducts();
};

const batchDelete = async () => {
  if (selectedIds.value.length === 0) return;
  
  await ElMessageBox.confirm(`确定删除选中的 ${selectedIds.value.length} 个商品？`, '批量删除', { type: 'warning' });
  
  try {
    const res = await api.batchDeleteProducts(selectedIds.value);
    ElMessage.success(`已删除 ${res.data.deleted} 个商品`);
    selectedIds.value = [];
    loadProducts();
  } catch (e) {
    ElMessage.error('删除失败');
  }
};

const clearAll = async () => {
  const taskId = filters.value.taskId;
  const msg = taskId ? `确定清空任务 #${taskId} 的所有商品？` : '确定清空全部商品数据？此操作不可恢复！';
  
  await ElMessageBox.confirm(msg, '清空数据', { type: 'error', confirmButtonText: '确定清空' });
  
  try {
    const res = await api.clearAllProducts(taskId);
    ElMessage.success(`已清空 ${res.data.deleted} 个商品`);
    loadProducts();
  } catch (e) {
    ElMessage.error('清空失败');
  }
};

const exportData = async () => {
  try {
    const res = await api.exportProducts(filters.value);
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `products_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    ElMessage.success('导出成功');
  } catch (e) {
    ElMessage.error('导出失败');
  }
};

onMounted(() => { loadProducts(); loadTasks(); });
</script>

<style scoped>
.toolbar-card { margin-bottom: 16px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.pagination-wrapper { margin-top: 16px; display: flex; justify-content: flex-end; }
.asin-link { color: #409eff; text-decoration: none; }
.asin-link:hover { text-decoration: underline; }
.image-list { display: flex; flex-wrap: wrap; gap: 8px; }
.hd-image-links { max-height: 150px; overflow-y: auto; }
.hd-link-item { display: flex; align-items: center; margin-bottom: 4px; gap: 8px; }
.hd-link-index { color: #909399; min-width: 20px; }
.hd-link { color: #409eff; text-decoration: none; word-break: break-all; flex: 1; font-size: 12px; }
.hd-link:hover { text-decoration: underline; }
</style>
