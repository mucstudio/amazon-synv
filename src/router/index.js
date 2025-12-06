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
    path: '/amazon',
    name: 'Amazon',
    redirect: '/amazon/tasks',
    meta: { title: 'Amazon', icon: 'ShoppingBag' },
    children: [
      {
        path: 'tasks',
        name: 'Tasks',
        component: () => import('../views/Tasks.vue'),
        meta: { title: '爬取任务', icon: 'List' },
      },
      {
        path: 'products',
        name: 'Products',
        component: () => import('../views/Products.vue'),
        meta: { title: '商品数据', icon: 'Goods' },
      },
      {
        path: 'settings',
        name: 'AmazonSettings',
        component: () => import('../views/Settings.vue'),
        meta: { title: '参数设置', icon: 'Setting' },
      },
    ],
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
    path: '/proxies',
    name: 'Proxies',
    component: () => import('../views/Proxies.vue'),
    meta: { title: '代理管理', icon: 'Connection' },
  },
  {
    path: '/blacklist',
    name: 'BlacklistManage',
    redirect: '/blacklist/keywords',
    meta: { title: '黑名单管理', icon: 'Warning' },
    children: [
      {
        path: 'keywords',
        name: 'Blacklist',
        component: () => import('../views/Blacklist.vue'),
        meta: { title: '黑名单词库', icon: 'Document' },
      },
      {
        path: 'scan',
        name: 'ScanTasks',
        component: () => import('../views/ScanTasks.vue'),
        meta: { title: '黑名单扫描', icon: 'Search' },
      },
    ],
  },
  {
    path: '/backup',
    name: 'Backup',
    component: () => import('../views/Backup.vue'),
    meta: { title: '备份与恢复', icon: 'FolderOpened' },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
export { routes };
