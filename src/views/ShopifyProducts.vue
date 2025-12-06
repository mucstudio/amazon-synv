<template>
  <div class="shopify-products-page">
    <el-card class="toolbar-card">
      <el-row :gutter="16" align="middle">
        <el-col :span="5">
          <el-input v-model="filters.keyword" placeholder="搜索标题/Handle/品牌" clearable @keyup.enter="loadProducts" />
        </el-col>
        <el-col :span="3">
          <el-select v-model="filters.storeId" placeholder="选择店铺" clearable @change="onStoreChange">
            <el-option v-for="s in storeOptions" :key="s.id" :label="s.name || s.domain" :value="s.id" />
          </el-select>
        </el-col>
        <el-col :span="3">
          <el-select v-model="filters.collectionId" placeholder="选择集合" clearable @change="loadProducts" :disabled="!filters.storeId">
            <el-option v-for="c in collectionOptions" :key="c.id" :label="c.title" :value="c.id" />
          </el-select>
        </el-col>
        <el-col :span="13" style="text-align: right;">
          <el-button @click="loadProducts">搜索</el-button>
          <el-button type="success" @click="showExportDialog">导出 CSV</el-button>
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
          <span>Shopify 商品列表</span>
          <el-tag type="info">共 {{ total }} 条</el-tag>
        </div>
      </template>
      
      <el-table :data="products" v-loading="loading" stripe @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="50" />
        <el-table-column label="图片" width="70">
          <template #default="{ row }">
            <el-image v-if="row.image" :src="row.image" :preview-src-list="[row.image]" fit="contain" style="width: 50px; height: 50px;" />
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="handle" label="Handle" width="150" show-overflow-tooltip />
        <el-table-column prop="title" label="标题" min-width="250" show-overflow-tooltip />
        <el-table-column prop="vendor" label="品牌" width="120" show-overflow-tooltip />
        <el-table-column prop="collectionTitle" label="集合" width="120" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.collectionTitle || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="price" label="价格" width="90" />
        <el-table-column prop="comparePrice" label="原价" width="90">
          <template #default="{ row }">
            <span v-if="row.comparePrice" style="text-decoration: line-through; color: #909399;">{{ row.comparePrice }}</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="totalInventory" label="库存" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.totalInventory === 0" type="danger" size="small">缺货</el-tag>
            <el-tag v-else-if="row.totalInventory > 0" :type="row.totalInventory <= 5 ? 'warning' : 'success'" size="small">
              {{ row.totalInventory }}
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="variantCount" label="变体" width="70" />
        <el-table-column prop="storeDomain" label="店铺" width="150" show-overflow-tooltip />
        <el-table-column prop="updatedAt" label="更新时间" width="170" />
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

    <!-- 详情弹窗 -->
    <el-dialog v-model="detailVisible" title="商品详情" width="750px">
      <el-descriptions :column="2" border v-if="currentProduct">
        <el-descriptions-item label="Handle">{{ currentProduct.handle }}</el-descriptions-item>
        <el-descriptions-item label="店铺">{{ currentProduct.storeDomain }}</el-descriptions-item>
        <el-descriptions-item label="标题" :span="2">{{ currentProduct.title }}</el-descriptions-item>
        <el-descriptions-item label="品牌">{{ currentProduct.vendor || '-' }}</el-descriptions-item>
        <el-descriptions-item label="类型">{{ currentProduct.productType || '-' }}</el-descriptions-item>
        <el-descriptions-item label="价格">{{ currentProduct.price }}</el-descriptions-item>
        <el-descriptions-item label="原价">
          <span v-if="currentProduct.comparePrice" style="text-decoration: line-through;">{{ currentProduct.comparePrice }}</span>
          <span v-else>-</span>
        </el-descriptions-item>
        <el-descriptions-item label="库存">{{ currentProduct.totalInventory }}</el-descriptions-item>
        <el-descriptions-item label="变体数">{{ currentProduct.variantCount }}</el-descriptions-item>
        <el-descriptions-item label="标签" :span="2">{{ currentProduct.tags || '-' }}</el-descriptions-item>
        <el-descriptions-item label="属性选项" :span="2" v-if="currentProduct.options">
          <div class="options-list">
            <el-tag v-for="opt in parseOptions(currentProduct.options)" :key="opt.name" style="margin-right: 8px; margin-bottom: 4px;">
              {{ opt.name }}: {{ opt.values.join(', ') }}
            </el-tag>
          </div>
        </el-descriptions-item>
        <el-descriptions-item label="图片" :span="2">
          <div class="image-list">
            <el-image 
              v-for="(img, idx) in parseImages(currentProduct.images)" 
              :key="idx" 
              :src="img" 
              :preview-src-list="parseImages(currentProduct.images)"
              fit="contain"
              style="width: 80px; height: 80px; margin-right: 8px;"
            />
          </div>
        </el-descriptions-item>
        <el-descriptions-item label="变体" :span="2" v-if="currentProduct.variants">
          <el-table :data="parseVariants(currentProduct.variants)" size="small" max-height="200">
            <el-table-column prop="title" label="名称" width="120" />
            <el-table-column label="属性" min-width="150">
              <template #default="{ row }">
                <span v-if="row.option1">{{ row.option1 }}</span>
                <span v-if="row.option2"> / {{ row.option2 }}</span>
                <span v-if="row.option3"> / {{ row.option3 }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="price" label="价格" width="80" />
            <el-table-column prop="sku" label="SKU" width="120" show-overflow-tooltip />
            <el-table-column prop="barcode" label="条码" width="120" show-overflow-tooltip />
            <el-table-column prop="inventory" label="库存" width="70" />
          </el-table>
        </el-descriptions-item>
        <el-descriptions-item label="描述" :span="2">
          <div style="max-height: 150px; overflow-y: auto;">{{ currentProduct.description || '-' }}</div>
        </el-descriptions-item>
        <el-descriptions-item label="链接" :span="2">
          <a :href="currentProduct.url" target="_blank">{{ currentProduct.url }}</a>
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>

    <!-- 导出弹窗 -->
    <el-dialog v-model="exportDialogVisible" title="导出 CSV" width="500px">
      <div style="margin-bottom: 12px;">
        <el-button size="small" @click="selectAllFields">全选</el-button>
        <el-button size="small" @click="selectDefaultFields">默认</el-button>
        <el-button size="small" @click="clearFields">清空</el-button>
      </div>
      <el-checkbox-group v-model="exportFields">
        <el-row :gutter="8">
          <el-col :span="8" v-for="field in allExportFields" :key="field.key">
            <el-checkbox :label="field.key" style="margin-bottom: 8px;">{{ field.label }}</el-checkbox>
          </el-col>
        </el-row>
      </el-checkbox-group>
      <template #footer>
        <el-button @click="exportDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="doExport" :disabled="exportFields.length === 0">
          导出 ({{ exportFields.length }} 个字段)
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';

const route = useRoute();
const products = ref([]);
const loading = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const filters = ref({ keyword: '', storeId: '', collectionId: '' });
const storeOptions = ref([]);
const collectionOptions = ref([]);
const selectedIds = ref([]);
const detailVisible = ref(false);
const currentProduct = ref(null);
const exportDialogVisible = ref(false);

const allExportFields = [
  { key: 'image', label: '图片' },
  { key: 'handle', label: 'Handle' },
  { key: 'title', label: '标题' },
  { key: 'vendor', label: '品牌' },
  { key: 'productType', label: '类型' },
  { key: 'price', label: '价格' },
  { key: 'comparePrice', label: '原价' },
  { key: 'totalInventory', label: '库存' },
  { key: 'variantCount', label: '变体数' },
  { key: 'tags', label: '标签' },
  { key: 'storeDomain', label: '店铺' },
  { key: 'url', label: '链接' },
];
const defaultExportFields = ['image', 'handle', 'title', 'vendor', 'price', 'totalInventory', 'storeDomain', 'url'];
const exportFields = ref([...defaultExportFields]);

// 全选字段
const selectAllFields = () => {
  exportFields.value = allExportFields.map(f => f.key);
};

// 选择默认字段
const selectDefaultFields = () => {
  exportFields.value = [...defaultExportFields];
};

// 清空字段
const clearFields = () => {
  exportFields.value = [];
};

const parseImages = (str) => {
  if (!str) return [];
  try { return JSON.parse(str); } catch { return []; }
};

const parseVariants = (str) => {
  if (!str) return [];
  try { return JSON.parse(str); } catch { return []; }
};

const parseOptions = (str) => {
  if (!str) return [];
  try { return JSON.parse(str); } catch { return []; }
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
    const res = await api.getShopifyProducts({ page: page.value, pageSize: pageSize.value, ...filters.value });
    products.value = res.data.list;
    total.value = res.data.total;
  } catch (e) {
    ElMessage.error('加载失败');
  } finally {
    loading.value = false;
  }
};

const loadStores = async () => {
  try {
    const res = await api.getShopifyStores();
    storeOptions.value = res.data.stores;
  } catch (e) {
    console.error(e);
  }
};

const loadCollections = async (storeId) => {
  if (!storeId) {
    collectionOptions.value = [];
    return;
  }
  try {
    const res = await api.getShopifyCollections(storeId);
    collectionOptions.value = res.data.collections || [];
  } catch (e) {
    console.error(e);
    collectionOptions.value = [];
  }
};

const onStoreChange = () => {
  filters.value.collectionId = '';
  loadCollections(filters.value.storeId);
  loadProducts();
};

const showDetail = (row) => {
  currentProduct.value = row;
  detailVisible.value = true;
};

const deleteProduct = async (id) => {
  await ElMessageBox.confirm('确定删除该商品？', '提示', { type: 'warning' });
  await api.deleteShopifyProduct(id);
  ElMessage.success('已删除');
  loadProducts();
};

const batchDelete = async () => {
  if (selectedIds.value.length === 0) return;
  await ElMessageBox.confirm(`确定删除选中的 ${selectedIds.value.length} 个商品？`, '批量删除', { type: 'warning' });
  try {
    await api.batchDeleteShopifyProducts(selectedIds.value);
    ElMessage.success('删除成功');
    selectedIds.value = [];
    loadProducts();
  } catch (e) {
    ElMessage.error('删除失败');
  }
};

const clearAll = async () => {
  const msg = filters.value.storeId 
    ? '确定清空当前店铺的所有商品？' 
    : '确定清空全部 Shopify 商品数据？此操作不可恢复！';
  await ElMessageBox.confirm(msg, '清空数据', { type: 'error', confirmButtonText: '确定清空' });
  try {
    const res = await api.clearShopifyProducts(filters.value.storeId);
    ElMessage.success(res.data.message || '清空成功');
    loadProducts();
  } catch (e) {
    ElMessage.error('清空失败');
  }
};

const showExportDialog = () => {
  exportDialogVisible.value = true;
};

const doExport = async () => {
  try {
    const res = await api.exportShopifyProducts({ ...filters.value, fields: exportFields.value.join(',') });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shopify_products_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    ElMessage.success('导出成功');
    exportDialogVisible.value = false;
  } catch (e) {
    ElMessage.error('导出失败');
  }
};

onMounted(() => {
  // 从 URL 参数获取店铺 ID 和集合 ID
  if (route.query.storeId) {
    filters.value.storeId = Number(route.query.storeId);
    loadCollections(filters.value.storeId);
  }
  if (route.query.collectionId) {
    filters.value.collectionId = Number(route.query.collectionId);
  }
  loadProducts();
  loadStores();
});
</script>

<style scoped>
.toolbar-card { margin-bottom: 16px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.pagination-wrapper { margin-top: 16px; display: flex; justify-content: flex-end; }
.image-list { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
