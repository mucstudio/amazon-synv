import { Router } from 'express';
import { getDb } from '../db/index.js';

const router = Router();

/**
 * 解析代理格式: ip:port:user:pass -> http://user:pass@ip:port
 */
function parseProxyUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  
  // 已经是标准格式
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('socks')) {
    return trimmed;
  }
  
  const parts = trimmed.split(':');
  
  // 格式: ip:port:user:pass
  if (parts.length === 4) {
    const [ip, port, user, pass] = parts;
    return `http://${user}:${pass}@${ip}:${port}`;
  }
  
  // 格式: ip:port
  if (parts.length === 2) {
    return `http://${parts[0]}:${parts[1]}`;
  }
  
  return null;
}

// 获取代理列表
router.get('/', (req, res) => {
  const db = getDb();
  const proxies = db.prepare('SELECT * FROM proxies ORDER BY id DESC').all();
  res.json(proxies);
});

// 添加代理
router.post('/', (req, res) => {
  const db = getDb();
  const { list } = req.body;
  
  if (!list || !Array.isArray(list)) {
    return res.status(400).json({ error: '请提供代理列表' });
  }

  const insert = db.prepare('INSERT OR IGNORE INTO proxies (url, rawInput) VALUES (?, ?)');
  let added = 0;
  let invalid = 0;
  
  for (const raw of list) {
    const proxyUrl = parseProxyUrl(raw);
    if (proxyUrl) {
      const result = insert.run(proxyUrl, raw.trim());
      if (result.changes > 0) added++;
    } else {
      invalid++;
    }
  }

  res.json({ success: true, added, invalid });
});

// 测试单个代理
router.post('/:id/test', async (req, res) => {
  const db = getDb();
  const proxy = db.prepare('SELECT * FROM proxies WHERE id = ?').get(req.params.id);
  
  if (!proxy) {
    return res.status(404).json({ error: '代理不存在' });
  }

  const result = await testProxyConnection(proxy.url);
  
  if (result.success) {
    db.prepare(`
      UPDATE proxies SET status = 'active', successCount = successCount + 1, 
      lastUsedAt = CURRENT_TIMESTAMP, responseTime = ? WHERE id = ?
    `).run(result.responseTime, proxy.id);
  } else {
    db.prepare(`
      UPDATE proxies SET status = 'failed', failCount = failCount + 1 WHERE id = ?
    `).run(proxy.id);
  }
  
  res.json(result);
});

// 批量测试所有代理
router.post('/test-all', async (req, res) => {
  const db = getDb();
  const proxies = db.prepare('SELECT * FROM proxies').all();
  
  if (proxies.length === 0) {
    return res.json({ success: true, results: [] });
  }

  const results = [];
  
  // 并发测试（最多5个同时）
  const concurrency = 5;
  for (let i = 0; i < proxies.length; i += concurrency) {
    const batch = proxies.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (proxy) => {
        const result = await testProxyConnection(proxy.url);
        
        if (result.success) {
          db.prepare(`
            UPDATE proxies SET status = 'active', successCount = successCount + 1,
            lastUsedAt = CURRENT_TIMESTAMP, responseTime = ? WHERE id = ?
          `).run(result.responseTime, proxy.id);
        } else {
          db.prepare(`
            UPDATE proxies SET status = 'failed', failCount = failCount + 1 WHERE id = ?
          `).run(proxy.id);
        }
        
        return { id: proxy.id, ...result };
      })
    );
    results.push(...batchResults);
  }

  const successCount = results.filter(r => r.success).length;
  res.json({ 
    success: true, 
    total: proxies.length,
    successCount,
    failCount: proxies.length - successCount,
    results 
  });
});

// 编辑代理
router.put('/:id', (req, res) => {
  const db = getDb();
  const { rawInput } = req.body;
  
  if (!rawInput) {
    return res.status(400).json({ error: '请提供代理地址' });
  }
  
  const proxyUrl = parseProxyUrl(rawInput);
  if (!proxyUrl) {
    return res.status(400).json({ error: '代理格式无效' });
  }
  
  db.prepare('UPDATE proxies SET url = ?, rawInput = ?, status = ? WHERE id = ?')
    .run(proxyUrl, rawInput.trim(), 'pending', req.params.id);
  
  res.json({ success: true });
});

// 删除代理
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM proxies WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// 批量删除代理
router.post('/batch-delete', (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '请提供要删除的ID列表' });
  }

  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM proxies WHERE id IN (${placeholders})`).run(...ids);
  
  res.json({ success: true, deleted: result.changes });
});

// 批量测试选中的代理
router.post('/batch-test', async (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '请提供要测试的ID列表' });
  }

  const placeholders = ids.map(() => '?').join(',');
  const proxies = db.prepare(`SELECT * FROM proxies WHERE id IN (${placeholders})`).all(...ids);
  
  const results = [];
  const concurrency = 5;
  
  for (let i = 0; i < proxies.length; i += concurrency) {
    const batch = proxies.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (proxy) => {
        const result = await testProxyConnection(proxy.url);
        
        if (result.success) {
          db.prepare(`
            UPDATE proxies SET status = 'active', successCount = successCount + 1,
            lastUsedAt = CURRENT_TIMESTAMP, responseTime = ? WHERE id = ?
          `).run(result.responseTime, proxy.id);
        } else {
          db.prepare(`
            UPDATE proxies SET status = 'failed', failCount = failCount + 1 WHERE id = ?
          `).run(proxy.id);
        }
        
        return { id: proxy.id, ...result };
      })
    );
    results.push(...batchResults);
  }

  const successCount = results.filter(r => r.success).length;
  res.json({ success: true, total: proxies.length, successCount, failCount: proxies.length - successCount });
});

// 清除失效代理
router.delete('/failed/all', (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM proxies WHERE status = 'failed'").run();
  res.json({ success: true, deleted: result.changes });
});

/**
 * 测试代理连接
 */
async function testProxyConnection(proxyUrl) {
  const startTime = Date.now();
  
  try {
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    const agent = new HttpsProxyAgent(proxyUrl);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch('https://www.amazon.com', {
      agent,
      signal: controller.signal,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
    });
    
    clearTimeout(timeout);
    const responseTime = Date.now() - startTime;
    
    // 检查是否被封
    const html = await response.text();
    const isBlocked = html.includes('api-services-support@amazon.com') || 
                      html.includes('automated access') ||
                      response.status === 503;
    
    if (response.ok && !isBlocked) {
      return { success: true, responseTime, status: response.status };
    } else {
      return { success: false, responseTime, status: response.status, blocked: isBlocked };
    }
  } catch (e) {
    return { success: false, error: e.message, responseTime: Date.now() - startTime };
  }
}

export default router;
