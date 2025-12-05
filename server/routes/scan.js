import { Router } from 'express';
import { getDb } from '../db/index.js';

const router = Router();

// 获取扫描任务列表
router.get('/tasks', (req, res) => {
  const db = getDb();
  const { page = 1, pageSize = 20 } = req.query;
  const offset = (page - 1) * pageSize;

  const total = db.prepare('SELECT COUNT(*) as count FROM scan_tasks').get().count;
  const list = db.prepare(`
    SELECT * FROM scan_tasks ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(Number(pageSize), offset);

  res.json({ list, total, page: Number(page), pageSize: Number(pageSize) });
});

// 创建扫描任务
router.post('/tasks', (req, res) => {
  const db = getDb();
  const { name, productScope } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: '请输入任务名称' });
  }

  const result = db.prepare(`
    INSERT INTO scan_tasks (name, productScope, status) VALUES (?, ?, 'pending')
  `).run(name, productScope || 'all');

  res.json({ 
    id: result.lastInsertRowid, 
    status: 'pending',
    message: '扫描任务已创建' 
  });
});

// 获取扫描任务详情
router.get('/tasks/:id', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM scan_tasks WHERE id = ?').get(req.params.id);
  
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }
  
  res.json(task);
});

// 删除扫描任务
router.delete('/tasks/:id', (req, res) => {
  const db = getDb();
  const taskId = req.params.id;
  
  // 先删除关联的扫描结果
  db.prepare('DELETE FROM scan_results WHERE scanTaskId = ?').run(taskId);
  // 再删除任务
  db.prepare('DELETE FROM scan_tasks WHERE id = ?').run(taskId);
  
  res.json({ success: true, message: '已删除' });
});

// 获取扫描结果（分页）
router.get('/tasks/:id/results', (req, res) => {
  const db = getDb();
  const taskId = req.params.id;
  const { page = 1, pageSize = 50, filter } = req.query;
  const offset = (page - 1) * pageSize;

  let where = 'scanTaskId = ?';
  const params = [taskId];

  // 筛选条件
  if (filter === 'violation') {
    where += ' AND hasViolation = 1';
  } else if (filter === 'brand') {
    where += " AND matchedBrand != ''";
  } else if (filter === 'product') {
    where += " AND matchedProduct != ''";
  } else if (filter === 'tro') {
    where += " AND matchedTro != ''";
  } else if (filter === 'seller') {
    where += " AND matchedSeller != ''";
  }

  const total = db.prepare(`SELECT COUNT(*) as count FROM scan_results WHERE ${where}`).get(...params).count;
  const list = db.prepare(`
    SELECT * FROM scan_results WHERE ${where} ORDER BY hasViolation DESC, id ASC LIMIT ? OFFSET ?
  `).all(...params, Number(pageSize), offset);

  res.json({ list, total, page: Number(page), pageSize: Number(pageSize) });
});

// 下载扫描结果 CSV
router.get('/tasks/:id/download', (req, res) => {
  const db = getDb();
  const taskId = req.params.id;
  const { filter } = req.query;

  let where = 'scanTaskId = ?';
  const params = [taskId];

  if (filter === 'violation') {
    where += ' AND hasViolation = 1';
  }

  const results = db.prepare(`SELECT * FROM scan_results WHERE ${where} ORDER BY hasViolation DESC, id ASC`).all(...params);

  // 格式化库存显示
  const formatStock = (stock) => {
    if (stock === -1) return '有货';
    if (stock === 0) return '缺货';
    if (stock === null || stock === undefined) return '';
    return String(stock);
  };

  // 格式化快递时间
  const formatDelivery = (days) => {
    if (days === null || days === undefined) return '';
    return `${days}天`;
  };

  // 生成 CSV
  const headers = ['ASIN', '总价', '库存', '快递时间', '黑名单卖家', 'TRO违规词', '品牌违规词', '产品违规词', '产品标题'];
  const rows = results.map(r => [
    r.asin,
    r.totalPrice || '',
    formatStock(r.stock),
    formatDelivery(r.deliveryDays),
    r.matchedSeller || '',
    r.matchedTro || '',
    r.matchedBrand || '',
    r.matchedProduct || '',
    `"${(r.title || '').replace(/"/g, '""')}"`,
  ].join(','));

  const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
  
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=scan_results_${taskId}.csv`);
  res.send(csv);
});

// 获取扫描统计
router.get('/stats', (req, res) => {
  const db = getDb();
  
  const totalTasks = db.prepare('SELECT COUNT(*) as count FROM scan_tasks').get().count;
  const runningTasks = db.prepare("SELECT COUNT(*) as count FROM scan_tasks WHERE status = 'running'").get().count;
  const completedTasks = db.prepare("SELECT COUNT(*) as count FROM scan_tasks WHERE status = 'completed'").get().count;
  
  res.json({ totalTasks, runningTasks, completedTasks });
});

export default router;
