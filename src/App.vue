<template>
  <el-container class="app-container">
    <el-aside width="220px" class="sidebar">
      <div class="logo">
        <el-icon size="24"><Shop /></el-icon>
        <span>Amazon Scraper</span>
      </div>
      <el-menu
        :default-active="$route.path"
        router
        background-color="#1d1e1f"
        text-color="#bfcbd9"
        active-text-color="#409eff"
      >
        <template v-for="route in menuRoutes" :key="route.path">
          <!-- 有子菜单 -->
          <el-sub-menu v-if="route.children && route.children.length" :index="route.path">
            <template #title>
              <el-icon><component :is="route.meta.icon" /></el-icon>
              <span>{{ route.meta.title }}</span>
            </template>
            <el-menu-item 
              v-for="child in route.children" 
              :key="route.path + '/' + child.path" 
              :index="route.path + '/' + child.path"
            >
              <el-icon><component :is="child.meta.icon" /></el-icon>
              <span>{{ child.meta.title }}</span>
            </el-menu-item>
          </el-sub-menu>
          <!-- 无子菜单 -->
          <el-menu-item v-else :index="route.path">
            <el-icon><component :is="route.meta.icon" /></el-icon>
            <span>{{ route.meta.title }}</span>
          </el-menu-item>
        </template>
      </el-menu>
    </el-aside>
    
    <el-container>
      <el-header class="header">
        <div class="header-title">{{ currentTitle }}</div>
        <div class="header-right">
          <el-tag type="success" v-if="systemStatus.ready">服务运行中</el-tag>
          <el-tag type="danger" v-else>服务离线</el-tag>
        </div>
      </el-header>
      
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { routes } from './router';
import api from './api';

const route = useRoute();
const menuRoutes = routes.filter(r => r.meta?.title);
const currentTitle = computed(() => {
  // 如果是子路由，显示父级 + 子级标题
  if (route.matched.length > 1) {
    const parent = route.matched[route.matched.length - 2];
    const current = route.matched[route.matched.length - 1];
    if (parent.meta?.title && current.meta?.title) {
      return `${parent.meta.title} - ${current.meta.title}`;
    }
  }
  return route.meta?.title || '';
});
const systemStatus = ref({ ready: false });

onMounted(async () => {
  try {
    const res = await api.getStatus();
    systemStatus.value = res.data;
  } catch (e) {
    console.error('获取状态失败', e);
  }
});
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
.app-container { height: 100vh; }
.sidebar {
  background: #1d1e1f;
  overflow-y: auto;
}
.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  border-bottom: 1px solid #333;
}
.el-menu { border-right: none; }
.header {
  background: #fff;
  border-bottom: 1px solid #e6e6e6;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
}
.header-title { font-size: 18px; font-weight: 500; }
.main {
  background: #f5f7fa;
  padding: 20px;
  overflow-y: auto;
}
</style>
