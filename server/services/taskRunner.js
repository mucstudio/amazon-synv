import { getDb } from '../db/index.js';
import { Scraper } from './scraper.js';

/**
 * 任务运行器 - 轮询执行待处理任务
 */
export class TaskRunner {
  constructor() {
    this.running = false;
    this.currentTaskId = null;
    this.scraper = new Scraper();
  }

  start() {
    this.running = true;
    this.poll();
    console.log('任务运行器已启动');
  }

  stop() {
    this.running = false;
  }

  async poll() {
    while (this.running) {
      try {
        await this.processNextTask();
      } catch (e) {
        console.error('任务处理错误:', e);
      }
      await this.sleep(2000);
    }
  }

  async processNextTask() {
    const db = getDb();
    
    // 获取下一个待处理任务
    const task = db.prepare("SELECT * FROM tasks WHERE status = 'pending' ORDER BY id ASC LIMIT 1").get();
    if (!task) return;

    this.currentTaskId = task.id;
    console.log(`\n开始处理任务 #${task.id}`);

    // 更新状态为运行中
    db.prepare("UPDATE tasks SET status = 'running', updatedAt = CURRENT_TIMESTAMP WHERE id = ?").run(task.id);

    const allAsins = task.asins.split(',').filter(a => a.trim());
    
    // 获取已经爬取过的 ASIN（用于继续任务）
    const completedAsins = db.prepare('SELECT asin FROM products WHERE taskId = ?').all(task.id).map(r => r.asin);
    const completedSet = new Set(completedAsins);
    
    // 过滤掉已完成的 ASIN
    const asins = allAsins.filter(asin => !completedSet.has(asin.trim()));
    
    // 使用已有的计数（继续任务时保留之前的进度）
    let successCount = task.successCount || 0;
    let failCount = task.failCount || 0;
    let completed = completedAsins.length;

    // 获取设置
    const settings = this.getSettings();
    const concurrency = settings.concurrency || 5;

    if (completedAsins.length > 0) {
      console.log(`继续任务: 已完成 ${completedAsins.length}/${allAsins.length}, 剩余 ${asins.length}`);
    }
    console.log(`并发数: ${concurrency}, 总数: ${allAsins.length}`);

    // 并发爬取
    for (let i = 0; i < asins.length; i += concurrency) {
      // 检查任务是否被取消
      const currentTask = db.prepare('SELECT status FROM tasks WHERE id = ?').get(task.id);
      if (currentTask?.status === 'cancelled') {
        console.log(`任务 #${task.id} 已取消`);
        break;
      }

      // 取一批 ASIN
      const batch = asins.slice(i, i + concurrency);
      console.log(`\n批次 ${Math.floor(i / concurrency) + 1}: ${batch.join(', ')}`);

      // 每批次更换指纹（如果设置了）
      if (settings.fingerprintRotate === 'batch') {
        this.scraper.rotateFingerprint();
      }

      // 并发执行这一批（每个请求之间添加随机延迟，避免同时触发验证码）
      const results = await Promise.allSettled(
        batch.map(async (asin, index) => {
          const trimmedAsin = asin.trim();
          // 每个请求之间添加随机延迟 (0-500ms * index)
          if (index > 0) {
            await this.sleep(Math.random() * 500 * index);
          }
          // 每次请求更换指纹（如果设置了）
          if (settings.fingerprintRotate === 'request') {
            this.scraper.rotateFingerprint();
          }
          // 按次数更换指纹
          if (settings.fingerprintRotate === 'count') {
            this.scraper.incrementFingerprintUsage(settings.fingerprintRotateCount);
          }
          try {
            const product = await this.scraper.scrapeProduct(trimmedAsin, settings);
            return { success: true, asin: trimmedAsin, product };
          } catch (e) {
            return { success: false, asin: trimmedAsin, error: e.message };
          }
        })
      );

      // 处理结果
      let captchaCount = 0;
      for (const result of results) {
        const data = result.value;
        completed++;
        
        if (data.success) {
          const product = data.product;
          db.prepare(`
            INSERT INTO products (taskId, asin, title, price, shippingFee, totalPrice, rating, reviewCount, image, images, bulletPoints, description, attributes, deliveryInfo, deliveryDays, fulfillmentType, stock, sellerName, returnPolicy, url, status, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', CURRENT_TIMESTAMP)
            ON CONFLICT(asin) DO UPDATE SET
              taskId = excluded.taskId,
              title = excluded.title,
              price = excluded.price,
              shippingFee = excluded.shippingFee,
              totalPrice = excluded.totalPrice,
              rating = excluded.rating,
              reviewCount = excluded.reviewCount,
              image = excluded.image,
              images = excluded.images,
              bulletPoints = excluded.bulletPoints,
              description = excluded.description,
              attributes = excluded.attributes,
              deliveryInfo = excluded.deliveryInfo,
              deliveryDays = excluded.deliveryDays,
              fulfillmentType = excluded.fulfillmentType,
              stock = excluded.stock,
              sellerName = excluded.sellerName,
              returnPolicy = excluded.returnPolicy,
              url = excluded.url,
              status = 'success',
              errorMsg = NULL,
              updatedAt = CURRENT_TIMESTAMP
          `).run(
            task.id,
            product.asin || data.asin,
            product.title,
            product.price,
            product.shippingFee || '',
            product.totalPrice || '',
            product.rating,
            product.reviewCount,
            product.images?.[0] || '',
            JSON.stringify(product.images || []),
            JSON.stringify(product.bulletPoints || []),
            product.description,
            JSON.stringify(product.attributes || {}),
            product.deliveryInfo,
            product.deliveryDays,
            product.fulfillmentType || '',
            product.stock,
            product.sellerName || '',
            product.returnPolicy || '',
            product.url
          );
          successCount++;
          console.log(`  ✓ ${data.asin}`);
        } else {
          failCount++;
          
          // 根据错误类型设置标题
          let errorTitle = '';
          if (data.error === 'PRODUCT_NOT_FOUND') {
            errorTitle = '商品不存在';
          } else if (data.error === 'CAPTCHA_REQUIRED') {
            errorTitle = '需要验证码';
          } else if (data.error === 'IP_BLOCKED') {
            errorTitle = 'IP被封禁';
          } else {
            errorTitle = '爬取失败';
          }
          
          // 记录失败的 ASIN 到数据库（包含标题）
          db.prepare(`
            INSERT INTO products (taskId, asin, title, status, errorMsg, updatedAt)
            VALUES (?, ?, ?, 'failed', ?, CURRENT_TIMESTAMP)
            ON CONFLICT(asin) DO UPDATE SET
              taskId = excluded.taskId,
              title = excluded.title,
              status = 'failed',
              errorMsg = excluded.errorMsg,
              updatedAt = CURRENT_TIMESTAMP
          `).run(task.id, data.asin, errorTitle, data.error);
          
          // 记录不同错误类型
          if (data.error === 'CAPTCHA_REQUIRED') {
            captchaCount++;
            console.log(`  ⚠ ${data.asin}: 需要验证码`);
          } else if (data.error === 'PRODUCT_NOT_FOUND') {
            console.log(`  ⚠ ${data.asin}: 产品不存在`);
          } else {
            console.log(`  ✗ ${data.asin}: ${data.error}`);
          }
        }
      }
      
      // 如果这批有验证码，更新任务状态提示
      if (captchaCount > 0) {
        db.prepare("UPDATE tasks SET message = '遇到验证码，已自动处理或跳过', captchaCount = captchaCount + ? WHERE id = ?")
          .run(captchaCount, task.id);
      }

      // 更新进度（使用总数计算）
      const progress = Math.round((completed / allAsins.length) * 100);
      db.prepare('UPDATE tasks SET progress = ?, successCount = ?, failCount = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?')
        .run(progress, successCount, failCount, task.id);

      // 批次间延迟
      if (i + concurrency < asins.length && settings.requestDelay > 0) {
        await this.sleep(settings.requestDelay);
      }
    }

    // 更新任务状态（检查是否被取消）
    const finalTask = db.prepare('SELECT status FROM tasks WHERE id = ?').get(task.id);
    if (finalTask?.status !== 'cancelled') {
      const finalStatus = failCount === allAsins.length ? 'failed' : 'completed';
      db.prepare("UPDATE tasks SET status = ?, progress = 100, updatedAt = CURRENT_TIMESTAMP WHERE id = ?")
        .run(finalStatus, task.id);
    }

    console.log(`\n任务 #${task.id} 完成: 成功 ${successCount}, 失败 ${failCount}`);
    this.currentTaskId = null;
  }

  getSettings() {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM settings').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    
    // 辅助函数：解析数字，支持 0 值（不使用 || 避免 0 被当作 falsy）
    const parseNum = (val, defaultVal) => {
      const num = Number(val);
      return isNaN(num) ? defaultVal : num;
    };
    
    return {
      concurrency: parseNum(settings.concurrency, 5),
      requestDelay: parseNum(settings.requestDelay, 1000),
      timeout: parseNum(settings.timeout, 30000),
      amazonDomain: settings.amazonDomain || 'https://www.amazon.com',
      zipCode: settings.zipCode || '10001',
      proxyEnabled: settings.proxyEnabled === 'true',
      proxyRotateByCount: parseNum(settings.proxyRotateByCount, 10),  // 0 = 禁用
      proxyRotateByTime: parseNum(settings.proxyRotateByTime, 60),    // 0 = 禁用
      proxyMaxFailures: parseNum(settings.proxyMaxFailures, 3),
      proxySwitchOnFail: settings.proxySwitchOnFail !== 'false',      // 默认 true
      proxyFailRetryCount: parseNum(settings.proxyFailRetryCount, 2),
      saveHtml: settings.saveHtml === 'true',
      fulfillmentFilter: settings.fulfillmentFilter || 'all', // all, fba, fbm
      fingerprintRotateOnCaptcha: settings.fingerprintRotateOnCaptcha !== 'false', // 默认 true
      fingerprintRotate: settings.fingerprintRotate || 'none', // none, batch, count, request
      fingerprintRotateCount: parseNum(settings.fingerprintRotateCount, 10),
      captchaHandling: settings.captchaHandling || 'auto', // auto, skip, retry
      captchaRetryCount: parseNum(settings.captchaRetryCount, 2),
      captchaTimeout: parseNum(settings.captchaTimeout, 300),
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
