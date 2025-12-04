import { Router } from 'express';
import { getDb } from '../db/index.js';

const router = Router();

// 获取商品列表
router.get('/', (req, res) => {
  const db = getDb();
  const { page = 1, pageSize = 20, keyword, taskId } = req.query;
  const offset = (page - 1) * pageSize;

  let where = '1=1';
  const params = [];

  if (keyword) {
    where += ' AND (asin LIKE ? OR title LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (taskId) {
    where += ' AND taskId = ?';
    params.push(taskId);
  }

  const total = db.prepare(`SELECT COUNT(*) as count FROM products WHERE ${where}`).get(...params).count;
  const list = db.prepare(`
    SELECT * FROM products WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  res.json({ list, total, page: Number(page), pageSize: Number(pageSize) });
});

// 导出商品
router.get('/export', (req, res) => {
  const db = getDb();
  const { keyword, taskId } = req.query;

  let where = '1=1';
  const params = [];

  if (keyword) {
    where += ' AND (asin LIKE ? OR title LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (taskId) {
    where += ' AND taskId = ?';
    params.push(taskId);
  }

  const products = db.prepare(`SELECT * FROM products WHERE ${where}`).all(...params);

  // 生成 CSV
  const headers = ['ASIN', '标题', '价格', '评分', '评论数', '送达信息', '五点描述', '商品描述', '图片', '链接'];
  const rows = products.map(p => [
    p.asin,
    `"${(p.title || '').replace(/"/g, '""')}"`,
    p.price,
    p.rating,
    p.reviewCount,
    `"${(p.deliveryInfo || '').replace(/"/g, '""')}"`,
    `"${(p.bulletPoints || '').replace(/"/g, '""')}"`,
    `"${(p.description || '').substring(0, 500).replace(/"/g, '""')}"`,
    p.image,
    p.url,
  ].join(','));

  const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
  
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=products.csv');
  res.send(csv);
});

// 删除单个商品
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 批量删除商品
router.post('/batch-delete', (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '请提供要删除的ID列表' });
  }

  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM products WHERE id IN (${placeholders})`).run(...ids);
  
  res.json({ success: true, deleted: result.changes });
});

// 删除全部商品
router.delete('/all/clear', (req, res) => {
  const db = getDb();
  const { taskId } = req.query;
  
  let result;
  if (taskId) {
    result = db.prepare('DELETE FROM products WHERE taskId = ?').run(taskId);
  } else {
    result = db.prepare('DELETE FROM products').run();
  }
  
  res.json({ success: true, deleted: result.changes });
});

export default router;
