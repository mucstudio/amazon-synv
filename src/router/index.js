import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  {
    path: '/',
    redirect: '/dashboard',
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('../views/Dashboard.vue'),
    meta: { title: '仪表盘', icon: 'Odometer' },
  },
  {
    path: '/tasks',
    name: 'Tasks',
    component: () => import('../views/Tasks.vue'),
    meta: { title: '爬取任务', icon: 'List' },
  },
  {
    path: '/products',
    name: 'Products',
    component: () => import('../views/Products.vue'),
    meta: { title: '商品数据', icon: 'Goods' },
  },
  {
    path: '/proxies',
    name: 'Proxies',
    component: () => import('../views/Proxies.vue'),
    meta: { title: '代理管理', icon: 'Connection' },
  },
  {
    path: '/blacklist',
    name: 'Blacklist',
    component: () => import('../views/Blacklist.vue'),
    meta: { title: '黑名单词库', icon: 'Warning' },
  },
  {
    path: '/scan',
    name: 'ScanTasks',
    component: () => import('../views/ScanTasks.vue'),
    meta: { title: '黑名单扫描', icon: 'Search' },
  },
  {
    path: '/shopify',
    name: 'Shopify',
    redirect: '/shopify/stores',
    meta: { title: 'Shopify', icon: 'Shop' },
    children: [
      {
        path: 'stores',
        name: 'ShopifyStores',
        component: () => import('../views/ShopifyStores.vue'),
        meta: { title: '店铺管理', icon: 'Shop' },
      },
      {
        path: 'products',
        name: 'ShopifyProducts',
        component: () => import('../views/ShopifyProducts.vue'),
        meta: { title: '商品数据', icon: 'ShoppingCart' },
      },
      {
        path: 'tasks',
        name: 'ShopifyTasks',
        component: () => import('../views/ShopifyTasks.vue'),
        meta: { title: '任务管理', icon: 'Clock' },
      },
      {
        path: 'settings',
        name: 'ShopifySettings',
        component: () => import('../views/ShopifySettings.vue'),
        meta: { title: '参数设置', icon: 'Setting' },
      },
    ],
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/Settings.vue'),
    meta: { title: '系统设置', icon: 'Setting' },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
export { routes };
