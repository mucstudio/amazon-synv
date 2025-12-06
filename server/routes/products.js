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
  const { keyword, taskId, fields } = req.query;

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

  // 字段映射配置
  const fieldConfig = {
    image: { label: '图片', getValue: p => p.image || '' },
    asin: { label: 'ASIN', getValue: p => p.asin || '' },
    title: { label: '标题', getValue: p => p.title || '' },
    price: { label: '价格', getValue: p => p.price || '' },
    shippingFee: { label: '运费', getValue: p => p.shippingFee || '' },
    totalPrice: { label: '总价', getValue: p => p.totalPrice || '' },
    rating: { label: '评分', getValue: p => p.rating || '' },
    reviewCount: { label: '评论数', getValue: p => p.reviewCount || '' },
    deliveryInfo: { label: '送达信息', getValue: p => p.deliveryInfo || '' },
    deliveryDays: { label: '天数', getValue: p => p.deliveryDays != null ? p.deliveryDays : '' },
    fulfillmentType: { label: '配送', getValue: p => p.fulfillmentType || '' },
    stock: { label: '库存', getValue: p => p.stock != null ? (p.stock === -1 ? '有货' : (p.stock === 0 ? '缺货' : p.stock)) : '' },
    sellerName: { label: '卖家', getValue: p => p.sellerName || '' },
    returnPolicy: { label: '退货政策', getValue: p => p.returnPolicy || '' },
    bulletPoints: { label: '五点描述', getValue: p => p.bulletPoints || '' },
    description: { label: '商品描述', getValue: p => (p.description || '').substring(0, 500) },
    attributes: { label: '商品属性', getValue: p => p.attributes || '' },
    url: { label: '链接', getValue: p => p.url || '' },
  };

  // 解析要导出的字段
  const selectedFields = fields ? fields.split(',').filter(f => fieldConfig[f]) : Object.keys(fieldConfig);
  
  // 生成 CSV 表头
  const headers = selectedFields.map(f => fieldConfig[f].label);
  
  // 生成 CSV 数据行
  const rows = products.map(p => {
    return selectedFields.map(f => {
      const value = fieldConfig[f].getValue(p);
      // 如果值包含逗号、换行或双引号，需要用双引号包裹并转义
      const strValue = String(value);
      if (strValue.includes(',') || strValue.includes('\n') || strValue.includes('"')) {
        return `"${strValue.replace(/"/g, '""')}"`;
      }
      return strValue;
    }).join(',');
  });

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
