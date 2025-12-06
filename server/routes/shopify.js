import { Router } from 'express';
import { getDb } from '../db/index.js';
import { ShopifyScraper } from '../services/shopifyScraper.js';
import { shopifyTaskRunner } from '../services/shopifyTaskRunner.js';

const router = Router();
const scraper = new ShopifyScraper();

// 获取店铺列表
router.get('/stores', (req, res) => {
  const db = getDb();
  const stores = db.prepare('SELECT * FROM shopify_stores ORDER BY createdAt DESC').all();
  res.json({ stores });
});

// 添加店铺
router.post('/stores', async (req, res) => {
  const db = getDb();
  const { url, name } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: '请提供店铺 URL' });
  }
  
  const domain = scraper.normalizeStoreUrl(url);
  
  // 检查是否已存在
  const existing = db.prepare('SELECT id FROM shopify_stores WHERE domain = ?').get(domain);
  if (existing) {
    return res.status(400).json({ error: '该店铺已存在' });
  }
  
  // 测试连接
  const testResult = await scraper.testStore(domain);
  
  const result = db.prepare(`
    INSERT INTO shopify_stores (domain, name, apiSupported, status, lastTestAt)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(domain, name || domain, testResult.apiSupported ? 1 : 0, testResult.success ? 'active' : 'failed');
  
  res.json({
    id: result.lastInsertRowid,
    domain,
    testResult,
  });
});

// 测试店铺连接
router.post('/stores/:id/test', async (req, res) => {
  const db = getDb();
  const store = db.prepare('SELECT * FROM shopify_stores WHERE id = ?').get(req.params.id);
  
  if (!store) {
    return res.status(404).json({ error: '店铺不存在' });
  }
  
  // 获取设置
  const settingsRows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  for (const row of settingsRows) {
    if (['proxyEnabled'].includes(row.key)) {
      settings[row.key] = row.value === 'true';
    } else {
      settings[row.key] = row.value;
    }
  }
  
  const testResult = await scraper.testStore(store.domain, settings);
  
  // 更新店铺状态
  db.prepare(`
    UPDATE shopify_stores SET apiSupported = ?, status = ?, lastTestAt = CURRENT_TIMESTAMP WHERE id = ?
  `).run(testResult.apiSupported ? 1 : 0, testResult.success ? 'active' : 'failed', store.id);
  
  res.json(testResult);
});

// 删除店铺
router.delete('/stores/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM shopify_products WHERE storeId = ?').run(req.params.id);
  db.prepare('DELETE FROM shopify_collections WHERE storeId = ?').run(req.params.id);
  db.prepare('DELETE FROM shopify_stores WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 获取店铺的集合列表
router.get('/stores/:id/collections', (req, res) => {
  const db = getDb();
  const collections = db.prepare(`
    SELECT c.*, 
           (SELECT COUNT(*) FROM shopify_products WHERE collectionId = c.id) as productCount
    FROM shopify_collections c 
    WHERE c.storeId = ? 
    ORDER BY c.title ASC
  `).all(req.params.id);
  res.json({ collections });
});

// 同步店铺的集合列表
router.post('/stores/:id/sync-collections', async (req, res) => {
  const db = getDb();
  const store = db.prepare('SELECT * FROM shopify_stores WHERE id = ?').get(req.params.id);
  
  if (!store) {
    return res.status(404).json({ error: '店铺不存在' });
  }
  
  // 获取设置
  const settingsRows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  for (const row of settingsRows) {
    if (['proxyEnabled'].includes(row.key)) {
      settings[row.key] = row.value === 'true';
    } else {
      settings[row.key] = row.value;
    }
  }
  
  try {
    const result = await scraper.fetchCollections(store.domain, settings);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || '获取集合失败' });
    }
    
    // 保存集合到数据库
    const insert = db.prepare(`
      INSERT INTO shopify_collections (storeId, collectionId, handle, title, description, image, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(storeId, collectionId) DO UPDATE SET
        handle = excluded.handle,
        title = excluded.title,
        description = excluded.description,
        image = excluded.image,
        updatedAt = CURRENT_TIMESTAMP
    `);
    
    db.transaction(() => {
      for (const c of result.collections) {
        insert.run(store.id, c.collectionId, c.handle, c.title, c.description, c.image);
      }
    })();
    
    // 更新店铺集合数量
    db.prepare('UPDATE shopify_stores SET collectionCount = ? WHERE id = ?')
      .run(result.collections.length, store.id);
    
    res.json({
      success: true,
      count: result.collections.length,
      collections: result.collections,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 爬取某个集合的商品
router.post('/collections/:id/scrape', async (req, res) => {
  const db = getDb();
  const collection = db.prepare('SELECT * FROM shopify_collections WHERE id = ?').get(req.params.id);
  
  if (!collection) {
    return res.status(404).json({ error: '集合不存在' });
  }
  
  const store = db.prepare('SELECT * FROM shopify_stores WHERE id = ?').get(collection.storeId);
  if (!store) {
    return res.status(404).json({ error: '店铺不存在' });
  }
  
  // 获取设置
  const settingsRows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  for (const row of settingsRows) {
    if (['proxyEnabled'].includes(row.key)) {
      settings[row.key] = row.value === 'true';
    } else if (['requestDelay'].includes(row.key)) {
      settings[row.key] = Number(row.value);
    } else {
      settings[row.key] = row.value;
    }
  }
  
  try {
    const results = await scraper.scrapeCollection(store.id, collection.id, settings);
    
    // 保存商品到数据库
    const insert = db.prepare(`
      INSERT INTO shopify_products (storeId, collectionId, productId, handle, title, vendor, productType, price, comparePrice, description, descriptionHtml, images, imagesData, image, options, variants, variantCount, totalInventory, tags, url, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(storeId, productId) DO UPDATE SET
        collectionId = excluded.collectionId,
        handle = excluded.handle,
        title = excluded.title,
        vendor = excluded.vendor,
        productType = excluded.productType,
        price = excluded.price,
        comparePrice = excluded.comparePrice,
        description = excluded.description,
        descriptionHtml = excluded.descriptionHtml,
        images = excluded.images,
        imagesData = excluded.imagesData,
        image = excluded.image,
        options = excluded.options,
        variants = excluded.variants,
        variantCount = excluded.variantCount,
        totalInventory = excluded.totalInventory,
        tags = excluded.tags,
        url = excluded.url,
        updatedAt = CURRENT_TIMESTAMP
    `);
    
    db.transaction(() => {
      for (const p of results.products) {
        insert.run(
          store.id, collection.id, p.productId, p.handle, p.title, p.vendor, p.productType,
          p.price, p.comparePrice, p.description, p.descriptionHtml, p.images, p.imagesData, p.image,
          p.options, p.variants, p.variantCount, p.totalInventory, p.tags, p.url
        );
      }
    })();
    
    // 更新集合商品数量
    const collectionProductCount = db.prepare('SELECT COUNT(*) as count FROM shopify_products WHERE collectionId = ?').get(collection.id).count;
    db.prepare('UPDATE shopify_collections SET productCount = ? WHERE id = ?').run(collectionProductCount, collection.id);
    
    // 更新店铺商品数量
    const storeProductCount = db.prepare('SELECT COUNT(*) as count FROM shopify_products WHERE storeId = ?').get(store.id).count;
    db.prepare('UPDATE shopify_stores SET productCount = ?, lastScrapeAt = CURRENT_TIMESTAMP WHERE id = ?').run(storeProductCount, store.id);
    
    res.json({
      success: true,
      total: results.total,
      saved: results.success,
      failed: results.failed,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 爬取店铺商品
router.post('/stores/:id/scrape', async (req, res) => {
  const db = getDb();
  const store = db.prepare('SELECT * FROM shopify_stores WHERE id = ?').get(req.params.id);
  
  if (!store) {
    return res.status(404).json({ error: '店铺不存在' });
  }
  
  // 获取设置
  const settingsRows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  for (const row of settingsRows) {
    if (['proxyEnabled'].includes(row.key)) {
      settings[row.key] = row.value === 'true';
    } else if (['requestDelay'].includes(row.key)) {
      settings[row.key] = Number(row.value);
    } else {
      settings[row.key] = row.value;
    }
  }
  
  try {
    const results = await scraper.scrapeStore(store.id, settings);
    
    // 保存商品到数据库
    const insert = db.prepare(`
      INSERT INTO shopify_products (storeId, productId, handle, title, vendor, productType, price, comparePrice, description, descriptionHtml, images, imagesData, image, options, variants, variantCount, totalInventory, tags, url, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(storeId, productId) DO UPDATE SET
        handle = excluded.handle,
        title = excluded.title,
        vendor = excluded.vendor,
        productType = excluded.productType,
        price = excluded.price,
        comparePrice = excluded.comparePrice,
        description = excluded.description,
        descriptionHtml = excluded.descriptionHtml,
        images = excluded.images,
        imagesData = excluded.imagesData,
        image = excluded.image,
        options = excluded.options,
        variants = excluded.variants,
        variantCount = excluded.variantCount,
        totalInventory = excluded.totalInventory,
        tags = excluded.tags,
        url = excluded.url,
        updatedAt = CURRENT_TIMESTAMP
    `);
    
    db.transaction(() => {
      for (const p of results.products) {
        insert.run(
          store.id, p.productId, p.handle, p.title, p.vendor, p.productType,
          p.price, p.comparePrice, p.description, p.descriptionHtml, p.images, p.imagesData, p.image,
          p.options, p.variants, p.variantCount, p.totalInventory, p.tags, p.url
        );
      }
    })();
    
    // 更新店铺商品数量
    db.prepare('UPDATE shopify_stores SET productCount = ?, lastScrapeAt = CURRENT_TIMESTAMP WHERE id = ?')
      .run(results.success, store.id);
    
    res.json({
      success: true,
      total: results.total,
      saved: results.success,
      failed: results.failed,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取商品列表
router.get('/products', (req, res) => {
  const db = getDb();
  const { storeId, collectionId, keyword, page = 1, pageSize = 20 } = req.query;
  
  let where = '1=1';
  const params = [];
  
  if (storeId) {
    where += ' AND p.storeId = ?';
    params.push(storeId);
  }
  
  if (collectionId) {
    where += ' AND p.collectionId = ?';
    params.push(collectionId);
  }
  
  if (keyword) {
    where += ' AND (p.title LIKE ? OR p.handle LIKE ? OR p.vendor LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  
  const total = db.prepare(`SELECT COUNT(*) as count FROM shopify_products p WHERE ${where}`).get(...params).count;
  
  const offset = (page - 1) * pageSize;
  const list = db.prepare(`
    SELECT p.*, s.domain as storeDomain, s.name as storeName, c.title as collectionTitle
    FROM shopify_products p
    LEFT JOIN shopify_stores s ON p.storeId = s.id
    LEFT JOIN shopify_collections c ON p.collectionId = c.id
    WHERE ${where}
    ORDER BY p.updatedAt DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(pageSize), offset);
  
  res.json({ list, total, page: Number(page), pageSize: Number(pageSize) });
});

// 获取商品详细信息（从 HTML 页面解析）
router.post('/products/:id/fetch-details', async (req, res) => {
  const db = getDb();
  const product = db.prepare('SELECT * FROM shopify_products WHERE id = ?').get(req.params.id);
  
  if (!product) {
    return res.status(404).json({ error: '商品不存在' });
  }
  
  // 获取设置
  const settingsRows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  for (const row of settingsRows) {
    if (['proxyEnabled'].includes(row.key)) {
      settings[row.key] = row.value === 'true';
    } else {
      settings[row.key] = row.value;
    }
  }
  
  try {
    const result = await scraper.fetchProductDetails(product.url, settings);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || '获取详情失败' });
    }
    
    // 更新数据库
    db.prepare(`
      UPDATE shopify_products 
      SET detailedDescription = ?, sizeAndFit = ?, detailsFetched = 1 
      WHERE id = ?
    `).run(result.detailedDescription, result.sizeAndFit, req.params.id);
    
    res.json({
      success: true,
      detailedDescription: result.detailedDescription,
      sizeAndFit: result.sizeAndFit,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 批量获取商品详细信息
router.post('/products/batch-fetch-details', async (req, res) => {
  const db = getDb();
  const { ids, storeId, collectionId, unfetchedOnly } = req.body;
  
  // 构建查询条件
  let where = '1=1';
  const params = [];
  
  if (ids && Array.isArray(ids) && ids.length > 0) {
    // 按 ID 列表
    const placeholders = ids.map(() => '?').join(',');
    where += ` AND id IN (${placeholders})`;
    params.push(...ids);
  } else {
    // 按筛选条件
    if (storeId) {
      where += ' AND storeId = ?';
      params.push(storeId);
    }
    if (collectionId) {
      where += ' AND collectionId = ?';
      params.push(collectionId);
    }
  }
  
  if (unfetchedOnly) {
    where += ' AND (detailsFetched IS NULL OR detailsFetched = 0)';
  }
  
  const products = db.prepare(`SELECT id, url FROM shopify_products WHERE ${where}`).all(...params);
  
  if (products.length === 0) {
    return res.json({ success: true, total: 0, fetched: 0, message: '没有需要获取的商品' });
  }
  
  // 获取设置
  const settingsRows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  for (const row of settingsRows) {
    if (['proxyEnabled'].includes(row.key)) {
      settings[row.key] = row.value === 'true';
    } else if (['requestDelay'].includes(row.key)) {
      settings[row.key] = Number(row.value);
    } else {
      settings[row.key] = row.value;
    }
  }
  
  let fetched = 0;
  let failed = 0;
  
  for (const product of products) {
    try {
      const result = await scraper.fetchProductDetails(product.url, settings);
      
      if (result.success) {
        db.prepare(`
          UPDATE shopify_products 
          SET detailedDescription = ?, sizeAndFit = ?, detailsFetched = 1 
          WHERE id = ?
        `).run(result.detailedDescription, result.sizeAndFit, product.id);
        fetched++;
      } else {
        failed++;
      }
      
      // 请求间隔
      if (settings.requestDelay) {
        await new Promise(resolve => setTimeout(resolve, settings.requestDelay));
      }
    } catch (e) {
      failed++;
    }
  }
  
  res.json({
    success: true,
    total: products.length,
    fetched,
    failed,
    message: `已获取 ${fetched} 个商品详情，失败 ${failed} 个`,
  });
});

// 批量删除商品
router.post('/products/batch-delete', (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '请选择要删除的商品' });
  }
  
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM shopify_products WHERE id IN (${placeholders})`).run(...ids);
  
  res.json({ deleted: result.changes });
});

// 清空全部商品 - 必须放在 /products/:id 之前，否则 'all' 会被当作 :id
router.delete('/products/all', (req, res) => {
  const db = getDb();
  const { storeId } = req.query;
  
  console.log('清空商品请求, storeId:', storeId, typeof storeId);
  
  let result;
  // 注意：空字符串也是 truthy 在 query 参数中
  if (storeId && storeId !== '') {
    result = db.prepare('DELETE FROM shopify_products WHERE storeId = ?').run(storeId);
    // 更新店铺商品数量
    db.prepare('UPDATE shopify_stores SET productCount = 0 WHERE id = ?').run(storeId);
    // 更新集合商品数量
    db.prepare('UPDATE shopify_collections SET productCount = 0 WHERE storeId = ?').run(storeId);
  } else {
    result = db.prepare('DELETE FROM shopify_products').run();
    // 更新所有店铺商品数量
    db.prepare('UPDATE shopify_stores SET productCount = 0').run();
    // 更新所有集合商品数量
    db.prepare('UPDATE shopify_collections SET productCount = 0').run();
  }
  
  console.log('删除结果:', result.changes);
  res.json({ deleted: result.changes, message: `已清空 ${result.changes} 个商品` });
});

// 删除单个商品 - 必须放在 /products/all 之后
router.delete('/products/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM shopify_products WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 导出商品
router.get('/products/export', (req, res) => {
  const db = getDb();
  const { storeId, fields } = req.query;
  
  let where = '1=1';
  const params = [];
  
  if (storeId) {
    where += ' AND p.storeId = ?';
    params.push(storeId);
  }
  
  const products = db.prepare(`
    SELECT p.*, s.domain as storeDomain
    FROM shopify_products p
    LEFT JOIN shopify_stores s ON p.storeId = s.id
    WHERE ${where}
  `).all(...params);
  
  // 字段配置
  const fieldConfig = {
    image: { label: '图片', getValue: p => p.image || '' },
    handle: { label: 'Handle', getValue: p => p.handle || '' },
    title: { label: '标题', getValue: p => p.title || '' },
    vendor: { label: '品牌', getValue: p => p.vendor || '' },
    productType: { label: '类型', getValue: p => p.productType || '' },
    price: { label: '价格', getValue: p => p.price || '' },
    comparePrice: { label: '原价', getValue: p => p.comparePrice || '' },
    totalInventory: { label: '库存', getValue: p => p.totalInventory || 0 },
    variantCount: { label: '变体数', getValue: p => p.variantCount || 0 },
    tags: { label: '标签', getValue: p => p.tags || '' },
    storeDomain: { label: '店铺', getValue: p => p.storeDomain || '' },
    url: { label: '链接', getValue: p => p.url || '' },
  };
  
  const selectedFields = fields ? fields.split(',').filter(f => fieldConfig[f]) : Object.keys(fieldConfig);
  const headers = selectedFields.map(f => fieldConfig[f].label);
  
  const rows = products.map(p => {
    return selectedFields.map(f => {
      const value = fieldConfig[f].getValue(p);
      const strValue = String(value);
      if (strValue.includes(',') || strValue.includes('\n') || strValue.includes('"')) {
        return `"${strValue.replace(/"/g, '""')}"`;
      }
      return strValue;
    }).join(',');
  });
  
  const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
  
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=shopify_products.csv');
  res.send(csv);
});

// 获取统计
router.get('/stats', (req, res) => {
  const db = getDb();
  
  const storeCount = db.prepare('SELECT COUNT(*) as count FROM shopify_stores').get().count;
  const productCount = db.prepare('SELECT COUNT(*) as count FROM shopify_products').get().count;
  const activeStores = db.prepare("SELECT COUNT(*) as count FROM shopify_stores WHERE status = 'active'").get().count;
  
  res.json({
    storeCount,
    productCount,
    activeStores,
  });
});

// ==================== 任务相关 API ====================

// 获取任务列表
router.get('/tasks', (req, res) => {
  const db = getDb();
  const { status, page = 1, pageSize = 20 } = req.query;
  
  let where = '1=1';
  const params = [];
  
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }
  
  const total = db.prepare(`SELECT COUNT(*) as count FROM shopify_tasks WHERE ${where}`).get(...params).count;
  const offset = (page - 1) * pageSize;
  
  const tasks = db.prepare(`
    SELECT t.*, s.name as storeName, c.title as collectionTitle
    FROM shopify_tasks t
    LEFT JOIN shopify_stores s ON t.storeId = s.id
    LEFT JOIN shopify_collections c ON t.collectionId = c.id
    WHERE ${where}
    ORDER BY t.createdAt DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(pageSize), offset);
  
  res.json({ tasks, total, page: Number(page), pageSize: Number(pageSize) });
});

// 获取单个任务详情
router.get('/tasks/:id', (req, res) => {
  const db = getDb();
  const task = db.prepare(`
    SELECT t.*, s.name as storeName, c.title as collectionTitle
    FROM shopify_tasks t
    LEFT JOIN shopify_stores s ON t.storeId = s.id
    LEFT JOIN shopify_collections c ON t.collectionId = c.id
    WHERE t.id = ?
  `).get(req.params.id);
  
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }
  
  res.json({ task });
});

// 创建任务
router.post('/tasks', (req, res) => {
  const db = getDb();
  const { type, storeId, collectionId, productIds } = req.body;
  
  if (!type) {
    return res.status(400).json({ error: '请指定任务类型' });
  }
  
  // 计算总数
  let totalCount = 0;
  if (productIds && Array.isArray(productIds) && productIds.length > 0) {
    totalCount = productIds.length;
  } else {
    let where = '(detailsFetched IS NULL OR detailsFetched = 0)';
    const params = [];
    
    if (storeId) {
      where += ' AND storeId = ?';
      params.push(storeId);
    }
    if (collectionId) {
      where += ' AND collectionId = ?';
      params.push(collectionId);
    }
    
    totalCount = db.prepare(`SELECT COUNT(*) as count FROM shopify_products WHERE ${where}`).get(...params).count;
  }
  
  if (totalCount === 0) {
    return res.status(400).json({ error: '没有需要处理的商品' });
  }
  
  const result = db.prepare(`
    INSERT INTO shopify_tasks (type, status, totalCount, storeId, collectionId, productIds)
    VALUES (?, 'pending', ?, ?, ?, ?)
  `).run(
    type,
    totalCount,
    storeId || null,
    collectionId || null,
    productIds ? JSON.stringify(productIds) : null
  );
  
  res.json({
    success: true,
    taskId: result.lastInsertRowid,
    totalCount,
    message: `任务已创建，共 ${totalCount} 个商品待处理`,
  });
});

// 暂停任务
router.post('/tasks/:id/pause', (req, res) => {
  const success = shopifyTaskRunner.pauseTask(Number(req.params.id));
  res.json({ success, message: success ? '任务已暂停' : '无法暂停该任务' });
});

// 恢复任务
router.post('/tasks/:id/resume', (req, res) => {
  const success = shopifyTaskRunner.resumeTask(Number(req.params.id));
  res.json({ success, message: success ? '任务已恢复' : '无法恢复该任务' });
});

// 取消任务
router.post('/tasks/:id/cancel', (req, res) => {
  const success = shopifyTaskRunner.cancelTask(Number(req.params.id));
  res.json({ success, message: success ? '任务已取消' : '无法取消该任务' });
});

// 清空已完成的任务 - 必须放在 /tasks/:id 之前
router.delete('/tasks/completed/all', (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM shopify_tasks WHERE status IN ('completed', 'cancelled', 'failed')").run();
  res.json({ deleted: result.changes });
});

// 删除任务 - 必须放在 /tasks/completed/all 之后
router.delete('/tasks/:id', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT status FROM shopify_tasks WHERE id = ?').get(req.params.id);
  
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }
  
  if (task.status === 'running') {
    return res.status(400).json({ error: '运行中的任务无法删除，请先取消' });
  }
  
  db.prepare('DELETE FROM shopify_tasks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ==================== 设置相关 API ====================

// Shopify 设置键名列表
const shopifySettingKeys = [
  'shopifyRequestDelay',
  'shopifyConcurrency',
  'shopifyTimeout',
  'shopifyProxyEnabled',
  'shopifyProxyRotateCount',
  'shopifyRetryCount',
  'shopifyUARotate',
  'shopifyUARotateCount',
  'shopifyUARotateOnError',
];

// 获取 Shopify 设置
router.get('/settings', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM settings WHERE key LIKE ?').all('shopify%');
  const settings = {};
  for (const row of rows) {
    if (['shopifyProxyEnabled', 'shopifyUARotateOnError'].includes(row.key)) {
      settings[row.key] = row.value === 'true';
    } else if (['shopifyRequestDelay', 'shopifyConcurrency', 'shopifyTimeout', 'shopifyProxyRotateCount', 'shopifyRetryCount', 'shopifyUARotateCount'].includes(row.key)) {
      settings[row.key] = Number(row.value);
    } else {
      settings[row.key] = row.value;
    }
  }
  res.json({ settings });
});

// 更新 Shopify 设置
router.put('/settings', (req, res) => {
  const db = getDb();
  const { settings } = req.body;
  
  const update = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  
  db.transaction(() => {
    for (const key of shopifySettingKeys) {
      if (settings[key] !== undefined) {
        update.run(key, String(settings[key]));
      }
    }
  })();
  
  res.json({ success: true });
});

export default router;
