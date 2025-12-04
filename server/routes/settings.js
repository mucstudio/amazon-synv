import { Router } from 'express';
import { getDb } from '../db/index.js';

const router = Router();

// 获取设置
router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM settings').all();
  
  const settings = {};
  for (const row of rows) {
    // 转换类型
    if (['concurrency', 'requestDelay', 'timeout', 'proxyRotateByCount', 'proxyRotateByTime', 'proxyMaxFailures'].includes(row.key)) {
      settings[row.key] = Number(row.value);
    } else if (['proxyEnabled', 'saveHtml'].includes(row.key)) {
      settings[row.key] = row.value === 'true';
    } else {
      settings[row.key] = row.value;
    }
  }
  
  res.json(settings);
});

// 更新设置
router.put('/', (req, res) => {
  const db = getDb();
  const update = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  
  for (const [key, value] of Object.entries(req.body)) {
    update.run(key, String(value));
  }
  
  res.json({ success: true });
});

export default router;
