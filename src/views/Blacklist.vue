<template>
  <div class="blacklist-page">
    <!-- 统计卡片 -->
    <el-row :gutter="16" class="stats-row">
      <el-col :span="4">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-value">{{ stats.total || 0 }}</div>
          <div class="stat-label">总计</div>
        </el-card>
      </el-col>
      <el-col :span="5">
        <el-card shadow="hover" class="stat-card brand">
          <div class="stat-value">{{ stats.brand || 0 }}</div>
          <div class="stat-label">品牌违规词</div>
        </el-card>
      </el-col>
      <el-col :span="5">
        <el-card shadow="hover" class="stat-card product">
          <div class="stat-value">{{ stats.product || 0 }}</div>
          <div class="stat-label">产品违规词</div>
        </el-card>
      </el-col>
      <el-col :span="5">
        <el-card shadow="hover" class="stat-card tro">
          <div class="stat-value">{{ stats.tro || 0 }}</div>
          <div class="stat-label">TRO违规词</div>
        </el-card>
      </el-col>
      <el-col :span="5">
        <el-card shadow="hover" class="stat-card seller">
          <div class="stat-value">{{ stats.seller || 0 }}</div>
          <div class="stat-label">黑名单卖家</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 工具栏 -->
    <el-card class="toolbar-card">
      <el-row :gutter="16" align="middle">
        <el-col :span="4">
          <el-select v-model="filters.type" placeholder="选择类型" clearable @change="loadList">
            <el-option label="品牌违规词" value="brand" />
            <el-option label="产品违规词" value="product" />
            <el-option label="TRO违规词" value="tro" />
            <el-option label="黑名单卖家" value="seller" />
          </el-select>
        </el-col>
        <el-col :span="5">
          <el-input v-model="filters.keyword" placeholder="搜索关键词" clearable @keyup.enter="loadList" />
        </el-col>
        <el-col :span="15" style="text-align: right;">
          <el-button @click="loadList">搜索</el-button>
          <el-button type="primary" @click="showAddDialog">添加</el-button>
          <el-button type="success" @click="showBatchDialog">批量添加</el-button>
          <el-button type="warning" @click="batchDelete" :disabled="selectedIds.length === 0">
            批量删除 ({{ selectedIds.length }})
          </el-button>
          <el-dropdown @command="handleExport" style="margin-left: 12px;">
            <el-button>
              导出 <el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="brand">导出品牌违规词</el-dropdown-item>
                <el-dropdown-item command="product">导出产品违规词</el-dropdown-item>
                <el-dropdown-item command="tro">导出TRO违规词</el-dropdown-item>
                <el-dropdown-item command="seller">导出黑名单卖家</el-dropdown-item>
                <el-dropdown-item command="all" divided>导出全部</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button type="primary" @click="showImportDialog" style="margin-left: 12px;">导入</el-button>
          <el-dropdown @command="handleClear" style="margin-left: 12px;">
            <el-button type="danger">
              清空 <el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="brand">清空品牌违规词</el-dropdown-item>
                <el-dropdown-item command="product">清空产品违规词</el-dropdown-item>
                <el-dropdown-item command="tro">清空TRO违规词</el-dropdown-item>
                <el-dropdown-item command="seller">清空黑名单卖家</el-dropdown-item>
                <el-dropdown-item command="all" divided>清空全部</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </el-col>
      </el-row>
    </el-card>

    <!-- 列表 -->
    <el-card>
      <template #header>
        <div class="card-header">
          <span>黑名单列表</span>
          <el-tag type="info">共 {{ total }} 条</el-tag>
        </div>
      </template>
      
      <el-table :data="list" v-loading="loading" stripe @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="50" />
        <el-table-column prop="keyword" label="关键词" min-width="200" />
        <el-table-column prop="type" label="类型" width="130">
          <template #default="{ row }">
            <el-tag :type="typeTagMap[row.type]?.type" size="small">{{ typeTagMap[row.type]?.label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="备注" min-width="200" show-overflow-tooltip />
        <el-table-column prop="createdAt" label="添加时间" width="170" />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="showEditDialog(row)">编辑</el-button>
            <el-button size="small" link type="danger" @click="deleteItem(row.id)">删除</el-button>
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
          @current-change="loadList"
          @size-change="handleSizeChange"
        />
      </div>
    </el-card>

    <!-- 添加/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑黑名单' : '添加黑名单'" width="500px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="类型" required>
          <el-select v-model="form.type" placeholder="选择类型" style="width: 100%;">
            <el-option label="品牌违规词" value="brand" />
            <el-option label="产品违规词" value="product" />
            <el-option label="TRO违规词" value="tro" />
            <el-option label="黑名单卖家" value="seller" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词" required>
          <el-input v-model="form.keyword" placeholder="输入关键词" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="可选备注说明" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>

    <!-- 批量添加弹窗 -->
    <el-dialog v-model="batchDialogVisible" title="批量添加黑名单" width="600px">
      <el-form :model="batchForm" label-width="80px">
        <el-form-item label="类型" required>
          <el-select v-model="batchForm.type" placeholder="选择类型" style="width: 100%;">
            <el-option label="品牌违规词" value="brand" />
            <el-option label="产品违规词" value="product" />
            <el-option label="TRO违规词" value="tro" />
            <el-option label="黑名单卖家" value="seller" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词" required>
          <el-input 
            v-model="batchForm.keywords" 
            type="textarea" 
            :rows="8" 
            placeholder="每行一个关键词，或用逗号分隔"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="batchForm.description" placeholder="可选备注说明（应用于所有关键词）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitBatchForm">批量添加</el-button>
      </template>
    </el-dialog>

    <!-- 导入弹窗 -->
    <el-dialog v-model="importDialogVisible" title="导入黑名单" width="600px">
      <el-alert type="info" :closable="false" style="margin-bottom: 16px;">
        <template #title>
          <div>支持 CSV 格式文件，包含列：关键词、类型代码、备注</div>
          <div style="margin-top: 4px;">类型代码：brand(品牌违规词)、product(产品违规词)、tro(TRO违规词)、seller(黑名单卖家)</div>
        </template>
      </el-alert>
      
      <el-upload
        ref="uploadRef"
        drag
        :auto-upload="false"
        :limit="1"
        accept=".csv"
        :on-change="handleFileChange"
        :on-exceed="handleExceed"
      >
        <el-icon class="el-icon--upload"><Upload /></el-icon>
        <div class="el-upload__text">拖拽文件到此处，或 <em>点击上传</em></div>
        <template #tip>
          <div class="el-upload__tip">只支持 CSV 文件</div>
        </template>
      </el-upload>
      
      <div v-if="importPreview.length > 0" style="margin-top: 16px;">
        <div style="margin-bottom: 8px; color: #606266;">预览（前10条）：</div>
        <el-table :data="importPreview" size="small" max-height="200">
          <el-table-column prop="keyword" label="关键词" />
          <el-table-column prop="type" label="类型代码" width="100" />
          <el-table-column prop="description" label="备注" />
        </el-table>
        <div style="margin-top: 8px; color: #909399;">共 {{ importData.length }} 条数据</div>
      </div>
      
      <template #footer>
        <el-button @click="downloadTemplate">下载模板</el-button>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitImport" :disabled="importData.length === 0">
          导入 ({{ importData.length }})
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>


<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowDown, Upload } from '@element-plus/icons-vue';
import api from '../api';

const list = ref([]);
const loading = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const filters = ref({ type: '', keyword: '' });
const selectedIds = ref([]);
const stats = ref({});

const dialogVisible = ref(false);
const batchDialogVisible = ref(false);
const importDialogVisible = ref(false);
const editingId = ref(null);
const form = ref({ keyword: '', type: 'brand', description: '' });
const batchForm = ref({ keywords: '', type: 'brand', description: '' });
const uploadRef = ref(null);
const importData = ref([]);
const importPreview = ref([]);

const typeTagMap = {
  brand: { label: '品牌违规词', type: 'danger' },
  product: { label: '产品违规词', type: 'warning' },
  tro: { label: 'TRO违规词', type: '' },
  seller: { label: '黑名单卖家', type: 'info' },
};

const handleSelectionChange = (selection) => {
  selectedIds.value = selection.map(item => item.id);
};

const handleSizeChange = () => {
  page.value = 1;
  loadList();
};

const loadList = async () => {
  loading.value = true;
  try {
    const res = await api.getBlacklist({ page: page.value, pageSize: pageSize.value, ...filters.value });
    list.value = res.data.list;
    total.value = res.data.total;
  } catch (e) {
    ElMessage.error('加载失败');
  } finally {
    loading.value = false;
  }
};

const loadStats = async () => {
  try {
    const res = await api.getBlacklistStats();
    stats.value = res.data;
  } catch (e) {
    console.error(e);
  }
};

const showAddDialog = () => {
  editingId.value = null;
  form.value = { keyword: '', type: 'brand', description: '' };
  dialogVisible.value = true;
};

const showEditDialog = (row) => {
  editingId.value = row.id;
  form.value = { keyword: row.keyword, type: row.type, description: row.description || '' };
  dialogVisible.value = true;
};

const showBatchDialog = () => {
  batchForm.value = { keywords: '', type: 'brand', description: '' };
  batchDialogVisible.value = true;
};

const submitForm = async () => {
  if (!form.value.keyword || !form.value.type) {
    ElMessage.warning('请填写关键词和类型');
    return;
  }
  
  try {
    if (editingId.value) {
      await api.updateBlacklist(editingId.value, form.value);
      ElMessage.success('更新成功');
    } else {
      await api.addBlacklist(form.value);
      ElMessage.success('添加成功');
    }
    dialogVisible.value = false;
    loadList();
    loadStats();
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '操作失败');
  }
};

const submitBatchForm = async () => {
  if (!batchForm.value.keywords || !batchForm.value.type) {
    ElMessage.warning('请填写关键词和类型');
    return;
  }
  
  try {
    const res = await api.batchAddBlacklist(batchForm.value);
    ElMessage.success(res.data.message);
    batchDialogVisible.value = false;
    loadList();
    loadStats();
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '操作失败');
  }
};

const deleteItem = async (id) => {
  await ElMessageBox.confirm('确定删除该项？', '提示', { type: 'warning' });
  await api.deleteBlacklist(id);
  ElMessage.success('已删除');
  loadList();
  loadStats();
};

const batchDelete = async () => {
  if (selectedIds.value.length === 0) return;
  
  await ElMessageBox.confirm(`确定删除选中的 ${selectedIds.value.length} 项？`, '批量删除', { type: 'warning' });
  
  try {
    const res = await api.batchDeleteBlacklist(selectedIds.value);
    ElMessage.success(res.data.message);
    selectedIds.value = [];
    loadList();
    loadStats();
  } catch (e) {
    ElMessage.error('删除失败');
  }
};

const handleClear = async (type) => {
  const typeNames = { brand: '品牌违规词', product: '产品违规词', tro: 'TRO违规词', seller: '黑名单卖家', all: '全部' };
  const msg = `确定清空${typeNames[type]}？此操作不可恢复！`;
  
  await ElMessageBox.confirm(msg, '清空数据', { type: 'error', confirmButtonText: '确定清空' });
  
  try {
    const res = await api.clearBlacklist(type);
    ElMessage.success(res.data.message);
    loadList();
    loadStats();
  } catch (e) {
    ElMessage.error('清空失败');
  }
};

// 导出功能
const handleExport = async (type) => {
  try {
    const res = await api.exportBlacklist(type === 'all' ? '' : type);
    const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blacklist_${type}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    ElMessage.success('导出成功');
  } catch (e) {
    ElMessage.error('导出失败');
  }
};

// 下载模板
const downloadTemplate = async () => {
  try {
    const res = await api.downloadBlacklistTemplate();
    const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'blacklist_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    ElMessage.error('下载模板失败');
  }
};

// 显示导入弹窗
const showImportDialog = () => {
  importData.value = [];
  importPreview.value = [];
  if (uploadRef.value) {
    uploadRef.value.clearFiles();
  }
  importDialogVisible.value = true;
};

// 解析 CSV
const parseCSV = (text) => {
  const lines = text.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'));
  if (lines.length < 2) return [];
  
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        if (inQuotes && line[j + 1] === '"') {
          current += '"';
          j++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    
    if (values.length >= 2) {
      const row = {};
      header.forEach((h, idx) => {
        row[h] = values[idx] || '';
      });
      // 兼容中英文列名
      row.keyword = row['关键词'] || row.keyword || values[0] || '';
      row.type = row['类型代码'] || row.type || values[1] || '';
      row.description = row['备注'] || row.description || values[2] || '';
      
      if (row.keyword) {
        data.push(row);
      }
    }
  }
  
  return data;
};

// 文件选择处理
const handleFileChange = (file) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const data = parseCSV(text);
    importData.value = data;
    importPreview.value = data.slice(0, 10);
  };
  reader.readAsText(file.raw, 'UTF-8');
};

const handleExceed = () => {
  ElMessage.warning('只能上传一个文件');
};

// 提交导入
const submitImport = async () => {
  if (importData.value.length === 0) {
    ElMessage.warning('没有可导入的数据');
    return;
  }
  
  try {
    const res = await api.importBlacklist(importData.value);
    ElMessage.success(res.data.message);
    importDialogVisible.value = false;
    loadList();
    loadStats();
  } catch (e) {
    ElMessage.error(e.response?.data?.error || '导入失败');
  }
};

onMounted(() => {
  loadList();
  loadStats();
});
</script>


<style scoped>
.stats-row { margin-bottom: 16px; }
.stat-card { text-align: center; }
.stat-value { font-size: 28px; font-weight: 600; color: #303133; }
.stat-label { font-size: 14px; color: #909399; margin-top: 8px; }
.stat-card.brand .stat-value { color: #f56c6c; }
.stat-card.product .stat-value { color: #e6a23c; }
.stat-card.tro .stat-value { color: #909399; }
.stat-card.seller .stat-value { color: #909399; }
.toolbar-card { margin-bottom: 16px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.pagination-wrapper { margin-top: 16px; display: flex; justify-content: flex-end; }
</style>
