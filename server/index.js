import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initDb } from './db/index.js';
import tasksRouter from './routes/tasks.js';
import productsRouter from './routes/products.js';
import proxiesRouter from './routes/proxies.js';
import settingsRouter from './routes/settings.js';
import blacklistRouter from './routes/blacklist.js';
import scanRouter from './routes/scan.js';
import { TaskRunner } from './services/taskRunner.js';
import { ScanRunner } from './services/scanRunner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' })); // 支持大批量 ASIN 提交

// 静态文件（生产环境）
app.use(express.static(join(__dirname, '../dist')));

// API 路由
app.use('/api/tasks', tasksRouter);
app.use('/api/products', productsRouter);
app.use('/api/proxies', proxiesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/blacklist', blacklistRouter);
app.use('/api/scan', scanRouter);

// 状态接口
app.get('/api/status', (req, res) => {
  res.json({ ready: true, version: '2.0.0' });
});

// 统计接口
app.get('/api/stats', async (req, res) => {
  const db = await initDb();
  const totalTasks = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
  const runningTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'running'").get().count;
  const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
  const activeProxies = db.prepare("SELECT COUNT(*) as count FROM proxies WHERE status = 'active'").get().count;
  res.json({ totalTasks, runningTasks, totalProducts, activeProxies });
});

// SPA 回退
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../dist/index.html'));
});

// 启动服务
async function start() {
  const db = await initDb();
  
  // 将之前运行中的任务标记为中断（服务器重启导致）
  const interruptedCount = db.prepare("UPDATE tasks SET status = 'interrupted' WHERE status = 'running'").run().changes;
  if (interruptedCount > 0) {
    console.log(`已将 ${interruptedCount} 个运行中的任务标记为中断`);
  }
  
  // 启动任务运行器
  const taskRunner = new TaskRunner();
  taskRunner.start();

  // 启动扫描任务运行器
  const scanRunner = new ScanRunner();
  scanRunner.start();

  app.listen(PORT, () => {
    console.log(`\n========== Amazon Scraper v2 ==========`);
    console.log(`服务已启动: http://localhost:${PORT}`);
    console.log(`API 地址: http://localhost:${PORT}/api`);
    console.log(`========================================\n`);
  });
}

start().catch(console.error);
