<template>
  <div class="shopify-stores-page">
    <el-card class="toolbar-card">
      <el-row :gutter="16" align="middle">
        <el-col :span="18">
          <el-input v-model="newStoreUrl" placeholder="输入 Shopify 店铺 URL，如 example.myshopify.com" style="width: 400px;">
            <template #prepend>https://</template>
          </el-input>
          <el-input v-model="newStoreName" placeholder="店铺名称（可选）" style="width: 200px; margin-left: 12px;" />
          <el-button type="primary" @click="addStore" :loading="adding" style="margin-left: 12px;">添加店铺</el-button>
        </el-col>
        <el-col :span="6" style="text-align: right;">
          <el-statistic title="店铺总数" :value="stores.length" />
        </el-col>
      </el-row>
    </el-card>

    <el-card>
      <template #header>
        <div class="card-header">
          <span>店铺列表</span>
        </div>
      </template>
      
      <el-table :data="stores" v-loading="loading" stripe>
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="collection-panel" v-loading="row.loadingCollections">
              <div class="collection-header">
                <span>集合列表 ({{ row.collections?.length || 0 }})</span>
                <el-button size="small" type="primary" @click="syncCollections(row)" :loading="row.syncingCollections">
                  同步集合
                </el-button>
              </div>
              <el-table :data="row.collections || []" size="small" v-if="row.collections?.length">
                <el-table-column prop="title" label="集合名称" min-width="200" />
                <el-table-column prop="handle" label="Handle" width="180" />
                <el-table-column prop="productCount" label="已采集商品" width="100" />
                <el-table-column label="操作" width="180">
                  <template #default="{ row: col }">
                    <el-button size="small" link type="success" @click="scrapeCollection(row, col)" :loading="col.scraping">
                      采集商品
                    </el-button>
                    <el-button size="small" link type="info" @click="viewCollectionProducts(row, col)">
                      查看商品
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
              <el-empty v-else description="暂无集合，请点击同步集合" :image-size="60" />
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="domain" label="店铺域名" min-width="200">
          <template #default="{ row }">
            <a :href="`https://${row.domain}`" target="_blank" class="store-link">{{ row.domain }}</a>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="名称" width="150" />
        <el-table-column prop="apiSupported" label="API" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.apiSupported" type="success" size="small">支持</el-tag>
            <el-tag v-else type="warning" size="small">HTML</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
              {{ row.status === 'active' ? '正常' : '异常' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="collectionCount" label="集合数" width="80" />
        <el-table-column prop="productCount" label="商品数" width="80" />
        <el-table-column prop="lastScrapeAt" label="上次爬取" width="170" />
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="testStore(row)" :loading="row.testing">测试</el-button>
            <el-button size="small" link type="warning" @click="toggleCollections(row)">集合</el-button>
            <el-button size="small" link type="success" @click="scrapeStore(row)" :loading="row.scraping">全部爬取</el-button>
            <el-button size="small" link type="info" @click="viewProducts(row)">商品</el-button>
            <el-button size="small" link type="danger" @click="deleteStore(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRouter } from 'vue-router';
import api from '../api';

const router = useRouter();
const stores = ref([]);
const loading = ref(false);
const adding = ref(false);
const newStoreUrl = ref('');
const newStoreName = ref('');

const loadStores = async () => {
  loading.value = true;
  try {
    const res = await api.getShopifyStores();
    stores.value = res.data.stores.map(s => ({ 
      ...s, 
      testing: false, 
      scraping: false,
      loadingCollections: false,
      syncingCollections: false,
      collections: [],
    }));
  } catch (e) {
    ElMessage.error('加载失败');
  } finally {
    loading.value = false;
  }
};

const addStore = async () => {
  if (!newStoreUrl.value.trim()) {
    ElMessage.warning('请输入店铺 URL');
    return;
  }
  
  adding.value = true;
  try {
    const res = await api.addShopifyStore({ 
      url: newStoreUrl.value.trim(),
      name: newStoreName.value.trim() || undefined,
    });
    ElMessage.success(res.data.testResult.message);
    newStoreUrl.value = '';
    newStoreName.value = '';
    loadStores();
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '添加失败');
  } finally {
    adding.value = false;
  }
};

const testStore = async (store) => {
  store.testing = true;
  try {
    const res = await api.testShopifyStore(store.id);
    ElMessage.success(res.data.message);
    loadStores();
  } catch (e) {
    ElMessage.error('测试失败');
  } finally {
    store.testing = false;
  }
};


const toggleCollections = async (store) => {
  if (store.collections?.length) {
    // 已加载，不需要重新加载
    return;
  }
  await loadCollections(store);
};

const loadCollections = async (store) => {
  store.loadingCollections = true;
  try {
    const res = await api.getShopifyCollections(store.id);
    store.collections = (res.data.collections || []).map(c => ({ ...c, scraping: false }));
  } catch (e) {
    ElMessage.error('加载集合失败');
  } finally {
    store.loadingCollections = false;
  }
};

const syncCollections = async (store) => {
  store.syncingCollections = true;
  try {
    const res = await api.syncShopifyCollections(store.id);
    ElMessage.success(`同步成功：共 ${res.data.count} 个集合`);
    await loadCollections(store);
    // 更新店铺的集合数量
    store.collectionCount = res.data.count;
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '同步失败');
  } finally {
    store.syncingCollections = false;
  }
};

const scrapeCollection = async (store, collection) => {
  collection.scraping = true;
  try {
    const res = await api.scrapeShopifyCollection(collection.id);
    ElMessage.success(`采集完成：共 ${res.data.saved} 个商品`);
    // 刷新集合列表以更新商品数量
    await loadCollections(store);
    loadStores();
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '采集失败');
  } finally {
    collection.scraping = false;
  }
};

const viewCollectionProducts = (store, collection) => {
  router.push({ path: '/shopify/products', query: { storeId: store.id, collectionId: collection.id } });
};

const scrapeStore = async (store) => {
  store.scraping = true;
  try {
    const res = await api.scrapeShopifyStore(store.id);
    ElMessage.success(`爬取完成：共 ${res.data.saved} 个商品`);
    loadStores();
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '爬取失败');
  } finally {
    store.scraping = false;
  }
};

const viewProducts = (store) => {
  router.push({ path: '/shopify/products', query: { storeId: store.id } });
};

const deleteStore = async (store) => {
  await ElMessageBox.confirm(`确定删除店铺 ${store.domain}？相关集合和商品数据也会被删除。`, '删除确认', { type: 'warning' });
  try {
    await api.deleteShopifyStore(store.id);
    ElMessage.success('已删除');
    loadStores();
  } catch (e) {
    ElMessage.error('删除失败');
  }
};

onMounted(loadStores);
</script>

<style scoped>
.toolbar-card { margin-bottom: 16px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.store-link { color: #409eff; text-decoration: none; }
.store-link:hover { text-decoration: underline; }
.collection-panel { padding: 12px 20px; }
.collection-header { 
  display: flex; 
  justify-content: space-between; 
  align-items: center; 
  margin-bottom: 12px;
  font-weight: 500;
}
</style>
