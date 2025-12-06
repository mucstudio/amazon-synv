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

// 导出备份
router.post('/backup', (req, res) => {
  const db = getDb();
  const { options = [] } = req.body;
  
  const backup = {
    version: '1.0',
    createdAt: new Date().toISOString(),
  };
  
  if (options.includes('settings')) {
    const rows = db.prepare('SELECT * FROM settings').all();
    backup.settings = {};
    for (const row of rows) {
      backup.settings[row.key] = row.value;
    }
  }
  
  if (options.includes('proxies')) {
    backup.proxies = db.prepare('SELECT url, rawInput, status, successCount, failCount, usageCount, totalUsageCount FROM proxies').all();
  }
  
  if (options.includes('blacklist')) {
    backup.blacklist = db.prepare('SELECT keyword, type, description FROM blacklist').all();
  }
  
  if (options.includes('products')) {
    backup.products = db.prepare(`
      SELECT asin, title, price, shippingFee, totalPrice, rating, reviewCount, 
             image, images, bulletPoints, description, attributes, deliveryInfo, 
             deliveryDays, fulfillmentType, stock, sellerName, returnPolicy, url, status
      FROM products
    `).all();
  }
  
  if (options.includes('tasks')) {
    backup.tasks = db.prepare('SELECT asins, asinCount, status, progress, successCount, failCount, captchaCount, message, createdAt FROM tasks').all();
  }
  
  res.json(backup);
});

// 导入恢复
router.post('/restore', (req, res) => {
  const db = getDb();
  const data = req.body;
  
  const results = {
    settings: 0,
    proxies: 0,
    blacklist: 0,
    products: 0,
    tasks: 0,
  };
  
  try {
    db.transaction(() => {
      // 恢复设置
      if (data.settings && typeof data.settings === 'object') {
        const update = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        for (const [key, value] of Object.entries(data.settings)) {
          update.run(key, String(value));
          results.settings++;
        }
      }
      
      // 恢复代理
      if (data.proxies && Array.isArray(data.proxies)) {
        // 先清空现有代理
        db.prepare('DELETE FROM proxies').run();
        const insert = db.prepare(`
          INSERT INTO proxies (url, rawInput, status, successCount, failCount, usageCount, totalUsageCount)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const p of data.proxies) {
          insert.run(p.url, p.rawInput || '', p.status || 'pending', p.successCount || 0, p.failCount || 0, p.usageCount || 0, p.totalUsageCount || 0);
          results.proxies++;
        }
      }
      
      // 恢复黑名单
      if (data.blacklist && Array.isArray(data.blacklist)) {
        // 先清空现有黑名单
        db.prepare('DELETE FROM blacklist').run();
        const insert = db.prepare('INSERT INTO blacklist (keyword, type, description) VALUES (?, ?, ?)');
        for (const b of data.blacklist) {
          insert.run(b.keyword, b.type, b.description || '');
          results.blacklist++;
        }
      }
      
      // 恢复商品
      if (data.products && Array.isArray(data.products)) {
        // 先清空现有商品
        db.prepare('DELETE FROM products').run();
        const insert = db.prepare(`
          INSERT INTO products (asin, title, price, shippingFee, totalPrice, rating, reviewCount, 
                               image, images, bulletPoints, description, attributes, deliveryInfo, 
                               deliveryDays, fulfillmentType, stock, sellerName, returnPolicy, url, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const p of data.products) {
          insert.run(
            p.asin, p.title, p.price, p.shippingFee, p.totalPrice, p.rating, p.reviewCount,
            p.image, p.images, p.bulletPoints, p.description, p.attributes, p.deliveryInfo,
            p.deliveryDays, p.fulfillmentType, p.stock, p.sellerName, p.returnPolicy, p.url, p.status || 'success'
          );
          results.products++;
        }
      }
      
      // 恢复任务
      if (data.tasks && Array.isArray(data.tasks)) {
        // 先清空现有任务
        db.prepare('DELETE FROM tasks').run();
        const insert = db.prepare(`
          INSERT INTO tasks (asins, asinCount, status, progress, successCount, failCount, captchaCount, message, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const t of data.tasks) {
          insert.run(t.asins, t.asinCount, t.status, t.progress, t.successCount, t.failCount, t.captchaCount || 0, t.message, t.createdAt);
          results.tasks++;
        }
      }
    })();
    
    const messages = [];
    if (results.settings > 0) messages.push(`设置 ${results.settings} 项`);
    if (results.proxies > 0) messages.push(`代理 ${results.proxies} 条`);
    if (results.blacklist > 0) messages.push(`黑名单 ${results.blacklist} 条`);
    if (results.products > 0) messages.push(`商品 ${results.products} 条`);
    if (results.tasks > 0) messages.push(`任务 ${results.tasks} 条`);
    
    res.json({ success: true, message: `恢复成功：${messages.join('，')}` });
  } catch (e) {
    console.error('恢复失败:', e);
    res.status(500).json({ error: '恢复失败: ' + e.message });
  }
});

export default router;
