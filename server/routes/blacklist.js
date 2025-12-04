import { Router } from 'express';
import { getDb } from '../db/index.js';

const router = Router();

// 黑名单类型
const BLACKLIST_TYPES = ['brand', 'product', 'tro', 'seller'];

// 获取黑名单列表
router.get('/', (req, res) => {
  const db = getDb();
  const { type, keyword, page = 1, pageSize = 20 } = req.query;
  
  let sql = 'SELECT * FROM blacklist WHERE 1=1';
  let countSql = 'SELECT COUNT(*) as count FROM blacklist WHERE 1=1';
  const params = [];
  
  if (type) {
    sql += ' AND type = ?';
    countSql += ' AND type = ?';
    params.push(type);
  }
  
  if (keyword) {
    sql += ' AND keyword LIKE ?';
    countSql += ' AND keyword LIKE ?';
    params.push(`%${keyword}%`);
  }
  
  const total = db.prepare(countSql).get(...params).count;
  
  sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
  const offset = (page - 1) * pageSize;
  const list = db.prepare(sql).all(...params, Number(pageSize), offset);
  
  res.json({ list, total, page: Number(page), pageSize: Number(pageSize) });
});

// 获取所有黑名单（用于匹配）
router.get('/all', (req, res) => {
  const db = getDb();
  const list = db.prepare('SELECT * FROM blacklist ORDER BY type, keyword').all();
  res.json({ list });
});

// 获取黑名单统计
router.get('/stats', (req, res) => {
  const db = getDb();
  const stats = {};
  
  for (const type of BLACKLIST_TYPES) {
    stats[type] = db.prepare('SELECT COUNT(*) as count FROM blacklist WHERE type = ?').get(type).count;
  }
  stats.total = db.prepare('SELECT COUNT(*) as count FROM blacklist').get().count;
  
  res.json(stats);
});

// 添加黑名单
router.post('/', (req, res) => {
  const db = getDb();
  const { keyword, type, description } = req.body;
  
  if (!keyword || !type) {
    return res.status(400).json({ error: '关键词和类型不能为空' });
  }
  
  if (!BLACKLIST_TYPES.includes(type)) {
    return res.status(400).json({ error: '无效的类型' });
  }
  
  // 检查是否已存在
  const existing = db.prepare('SELECT id FROM blacklist WHERE keyword = ? AND type = ?').get(keyword.trim(), type);
  if (existing) {
    return res.status(400).json({ error: '该关键词已存在' });
  }
  
  const result = db.prepare('INSERT INTO blacklist (keyword, type, description) VALUES (?, ?, ?)')
    .run(keyword.trim(), type, description || '');
  
  res.json({ id: result.lastInsertRowid, message: '添加成功' });
});

// 批量添加黑名单
router.post('/batch', (req, res) => {
  const db = getDb();
  const { keywords, type, description } = req.body;
  
  if (!keywords || !type) {
    return res.status(400).json({ error: '关键词和类型不能为空' });
  }
  
  if (!BLACKLIST_TYPES.includes(type)) {
    return res.status(400).json({ error: '无效的类型' });
  }
  
  // 解析关键词（支持逗号、换行分隔）
  const keywordList = keywords.split(/[,\n]/).map(k => k.trim()).filter(k => k);
  
  let added = 0;
  let skipped = 0;
  
  const insert = db.prepare('INSERT OR IGNORE INTO blacklist (keyword, type, description) VALUES (?, ?, ?)');
  
  db.transaction(() => {
    for (const kw of keywordList) {
      const result = insert.run(kw, type, description || '');
      if (result.changes > 0) {
        added++;
      } else {
        skipped++;
      }
    }
  })();
  
  res.json({ added, skipped, message: `成功添加 ${added} 个，跳过 ${skipped} 个重复项` });
});

// 更新黑名单
router.put('/:id', (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { keyword, type, description } = req.body;
  
  if (!keyword || !type) {
    return res.status(400).json({ error: '关键词和类型不能为空' });
  }
  
  db.prepare('UPDATE blacklist SET keyword = ?, type = ?, description = ? WHERE id = ?')
    .run(keyword.trim(), type, description || '', id);
  
  res.json({ message: '更新成功' });
});

// 删除黑名单
router.delete('/:id', (req, res) => {
  const db = getDb();
  const { id } = req.params;
  
  db.prepare('DELETE FROM blacklist WHERE id = ?').run(id);
  res.json({ message: '删除成功' });
});

// 批量删除
router.post('/batch-delete', (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '请选择要删除的项' });
  }
  
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM blacklist WHERE id IN (${placeholders})`).run(...ids);
  
  res.json({ deleted: result.changes, message: `已删除 ${result.changes} 项` });
});

// 清空指定类型
router.delete('/clear/:type', (req, res) => {
  const db = getDb();
  const { type } = req.params;
  
  if (type === 'all') {
    const result = db.prepare('DELETE FROM blacklist').run();
    res.json({ deleted: result.changes, message: `已清空全部 ${result.changes} 项` });
  } else if (BLACKLIST_TYPES.includes(type)) {
    const result = db.prepare('DELETE FROM blacklist WHERE type = ?').run(type);
    res.json({ deleted: result.changes, message: `已清空 ${result.changes} 项` });
  } else {
    res.status(400).json({ error: '无效的类型' });
  }
});

export default router;
