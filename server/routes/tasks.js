import { Router } from 'express';
import { getDb } from '../db/index.js';

const router = Router();

// 获取任务列表
router.get('/', (req, res) => {
  const db = getDb();
  const { page = 1, pageSize = 20, limit } = req.query;
  const offset = (page - 1) * pageSize;
  const actualLimit = limit || pageSize;

  const total = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
  const list = db.prepare(`
    SELECT * FROM tasks ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(actualLimit, offset);

  res.json({ list, total, page: Number(page), pageSize: Number(pageSize) });
});

// 创建任务
router.post('/', (req, res) => {
  const db = getDb();
  const { asins } = req.body;
  
  if (!asins || !Array.isArray(asins) || asins.length === 0) {
    return res.status(400).json({ error: '请提供ASIN列表' });
  }

  const uniqueAsins = [...new Set(asins.map(a => a.trim()).filter(a => a))];
  const result = db.prepare(`
    INSERT INTO tasks (asins, asinCount, status) VALUES (?, ?, 'pending')
  `).run(uniqueAsins.join(','), uniqueAsins.length);

  res.json({ id: result.lastInsertRowid, asinCount: uniqueAsins.length });
});

// 取消任务
router.post('/:id/cancel', (req, res) => {
  const db = getDb();
  db.prepare("UPDATE tasks SET status = 'cancelled', updatedAt = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// 重试任务（从头开始）
router.post('/:id/retry', (req, res) => {
  const db = getDb();
  db.prepare("UPDATE tasks SET status = 'pending', progress = 0, successCount = 0, failCount = 0, updatedAt = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  // 清除该任务的产品记录，重新爬取
  db.prepare('DELETE FROM products WHERE taskId = ?').run(req.params.id);
  res.json({ success: true });
});

// 继续任务（从上次进度继续）
router.post('/:id/resume', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }
  // 只更新状态为 pending，保留进度
  db.prepare("UPDATE tasks SET status = 'pending', updatedAt = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// 删除任务（不删除关联的商品数据）
router.delete('/:id', (req, res) => {
  const db = getDb();
  // 将商品的 taskId 设为 null，保留商品数据
  db.prepare('UPDATE products SET taskId = NULL WHERE taskId = ?').run(req.params.id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 获取任务的成功/失败详情
router.get('/:id/results', (req, res) => {
  const db = getDb();
  const taskId = req.params.id;
  const { status } = req.query; // 'success' 或 'failed'
  
  let results;
  if (status === 'success') {
    results = db.prepare(`
      SELECT asin, title, price, rating, status, createdAt 
      FROM products WHERE taskId = ? AND status = 'success'
    `).all(taskId);
  } else if (status === 'failed') {
    results = db.prepare(`
      SELECT asin, status, errorMsg, createdAt 
      FROM products WHERE taskId = ? AND status = 'failed'
    `).all(taskId);
  } else {
    results = db.prepare(`
      SELECT asin, title, price, status, errorMsg, createdAt 
      FROM products WHERE taskId = ?
    `).all(taskId);
  }
  
  res.json(results);
});

export default router;
