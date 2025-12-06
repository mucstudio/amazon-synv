import { getDb } from '../db/index.js';
import { ShopifyScraper } from './shopifyScraper.js';

/**
 * Shopify 任务运行器 - 后台执行批量任务
 */
class ShopifyTaskRunner {
  constructor() {
    this.scraper = new ShopifyScraper();
    this.runningTasks = new Map(); // taskId -> { running: boolean }
    this.checkInterval = null;
  }

  /**
   * 启动任务运行器
   */
  start() {
    // 每 2 秒检查一次待执行的任务
    this.checkInterval = setInterval(() => this.checkPendingTasks(), 2000);
    console.log('Shopify 任务运行器已启动');
  }

  /**
   * 停止任务运行器
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * 检查并执行待处理的任务
   */
  async checkPendingTasks() {
    const db = getDb();
    if (!db) return;

    // 获取待执行或需要恢复的任务（一次只执行一个）
    // 包括 pending 状态和 running 状态但不在 runningTasks 中的任务（服务器重启后恢复）
    const task = db.prepare(`
      SELECT * FROM shopify_tasks 
      WHERE status IN ('pending', 'running') 
      ORDER BY 
        CASE WHEN status = 'running' THEN 0 ELSE 1 END,
        createdAt ASC 
      LIMIT 1
    `).get();

    if (task && !this.runningTasks.has(task.id)) {
      this.executeTask(task);
    }
  }

  /**
   * 执行任务
   */
  async executeTask(task) {
    const db = getDb();
    const taskState = { running: true };
    this.runningTasks.set(task.id, taskState);

    // 更新任务状态为运行中
    db.prepare(`
      UPDATE shopify_tasks 
      SET status = 'running', startedAt = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(task.id);

    try {
      if (task.type === 'fetch-details') {
        await this.executeFetchDetails(task, taskState);
      }
    } catch (error) {
      db.prepare(`
        UPDATE shopify_tasks 
        SET status = 'failed', message = ?, completedAt = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(error.message, task.id);
    } finally {
      this.runningTasks.delete(task.id);
    }
  }


  /**
   * 获取 Shopify 专用设置
   */
  getShopifySettings() {
    const db = getDb();
    const settingsRows = db.prepare('SELECT * FROM settings WHERE key LIKE ?').all('shopify%');
    const settings = {
      requestDelay: 1000,
      timeout: 30000,
      proxyEnabled: false,
      proxyRotateCount: 10,
      retryCount: 2,
      uaRotate: 'request',
      uaRotateCount: 10,
      uaRotateOnError: true,
      concurrency: 3,
    };
    
    for (const row of settingsRows) {
      switch (row.key) {
        case 'shopifyRequestDelay':
          settings.requestDelay = Number(row.value);
          break;
        case 'shopifyTimeout':
          settings.timeout = Number(row.value);
          break;
        case 'shopifyProxyEnabled':
          settings.proxyEnabled = row.value === 'true';
          break;
        case 'shopifyProxyRotateCount':
          settings.proxyRotateCount = Number(row.value);
          break;
        case 'shopifyRetryCount':
          settings.retryCount = Number(row.value);
          break;
        case 'shopifyUARotate':
          settings.uaRotate = row.value;
          break;
        case 'shopifyUARotateCount':
          settings.uaRotateCount = Number(row.value);
          break;
        case 'shopifyUARotateOnError':
          settings.uaRotateOnError = row.value === 'true';
          break;
        case 'shopifyConcurrency':
          settings.concurrency = Number(row.value);
          break;
      }
    }
    
    return settings;
  }

  /**
   * 执行获取详情任务
   */
  async executeFetchDetails(task, taskState) {
    const db = getDb();
    
    // 获取 Shopify 专用设置
    const settings = this.getShopifySettings();

    // 获取要处理的商品列表（只获取未处理的）
    let products = [];
    if (task.productIds) {
      const ids = JSON.parse(task.productIds);
      const placeholders = ids.map(() => '?').join(',');
      // 只获取未获取详情的商品（支持断点续传）
      products = db.prepare(`
        SELECT id, url FROM shopify_products 
        WHERE id IN (${placeholders}) AND (detailsFetched IS NULL OR detailsFetched = 0)
      `).all(...ids);
    } else {
      let where = '(detailsFetched IS NULL OR detailsFetched = 0)';
      const params = [];
      
      if (task.storeId) {
        where += ' AND storeId = ?';
        params.push(task.storeId);
      }
      if (task.collectionId) {
        where += ' AND collectionId = ?';
        params.push(task.collectionId);
      }
      
      products = db.prepare(`SELECT id, url FROM shopify_products WHERE ${where}`).all(...params);
    }

    // 获取当前进度（用于断点续传）
    const currentProgress = db.prepare('SELECT processedCount, successCount, failCount, totalCount FROM shopify_tasks WHERE id = ?').get(task.id);
    
    // 如果是首次执行，更新总数；如果是恢复执行，保持原总数
    if (!currentProgress.totalCount || currentProgress.totalCount === 0) {
      db.prepare('UPDATE shopify_tasks SET totalCount = ? WHERE id = ?').run(products.length, task.id);
    }

    // 从上次进度继续
    let successCount = currentProgress.successCount || 0;
    let failCount = currentProgress.failCount || 0;
    let processedCount = currentProgress.processedCount || 0;

    for (let i = 0; i < products.length; i++) {
      // 检查任务是否被暂停或取消
      const currentTask = db.prepare('SELECT status FROM shopify_tasks WHERE id = ?').get(task.id);
      if (!currentTask || currentTask.status === 'cancelled') {
        break;
      }
      if (currentTask.status === 'paused') {
        // 等待恢复
        while (true) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const checkTask = db.prepare('SELECT status FROM shopify_tasks WHERE id = ?').get(task.id);
          if (!checkTask || checkTask.status === 'cancelled') {
            this.runningTasks.delete(task.id);
            return;
          }
          if (checkTask.status === 'running') break;
        }
      }

      const product = products[i];
      let success = false;
      
      // 支持重试
      for (let retry = 0; retry <= settings.retryCount; retry++) {
        try {
          // isError 参数用于"遇错误时轮换 UA"功能
          const isErrorRetry = retry > 0 && settings.uaRotateOnError;
          const result = await this.scraper.fetchProductDetails(product.url, settings, isErrorRetry);
          
          if (result.success) {
            db.prepare(`
              UPDATE shopify_products 
              SET detailedDescription = ?, sizeAndFit = ?, detailsFetched = 1 
              WHERE id = ?
            `).run(result.detailedDescription, result.sizeAndFit, product.id);
            success = true;
            break;
          } else {
            // 请求成功但解析失败，触发"遇错误时轮换 UA"
            if (settings.uaRotateOnError) {
              this.scraper.getUA(settings, true);
            }
          }
        } catch (e) {
          // 请求失败，触发"遇错误时轮换 UA"
          if (settings.uaRotateOnError) {
            this.scraper.getUA(settings, true);
          }
          // 重试前等待
          if (retry < settings.retryCount) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
      if (success) {
        successCount++;
      } else {
        failCount++;
      }

      // 更新进度
      processedCount++;
      db.prepare(`
        UPDATE shopify_tasks 
        SET processedCount = ?, successCount = ?, failCount = ? 
        WHERE id = ?
      `).run(processedCount, successCount, failCount, task.id);

      // 请求间隔
      if (settings.requestDelay && i < products.length - 1) {
        await new Promise(resolve => setTimeout(resolve, settings.requestDelay));
      }
    }

    // 完成任务
    const finalTask = db.prepare('SELECT status FROM shopify_tasks WHERE id = ?').get(task.id);
    if (finalTask && finalTask.status !== 'cancelled') {
      db.prepare(`
        UPDATE shopify_tasks 
        SET status = 'completed', 
            message = ?, 
            completedAt = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(`成功 ${successCount} 个，失败 ${failCount} 个`, task.id);
    }
  }

  /**
   * 暂停任务
   */
  pauseTask(taskId) {
    const db = getDb();
    const task = db.prepare('SELECT status FROM shopify_tasks WHERE id = ?').get(taskId);
    if (task && task.status === 'running') {
      db.prepare('UPDATE shopify_tasks SET status = ? WHERE id = ?').run('paused', taskId);
      return true;
    }
    return false;
  }

  /**
   * 恢复任务
   */
  resumeTask(taskId) {
    const db = getDb();
    const task = db.prepare('SELECT status FROM shopify_tasks WHERE id = ?').get(taskId);
    if (task && task.status === 'paused') {
      // 如果任务不在运行中（可能是服务器重启后），重新设置为 running 让 checkPendingTasks 重新执行
      db.prepare('UPDATE shopify_tasks SET status = ? WHERE id = ?').run('running', taskId);
      
      // 如果任务不在 runningTasks 中，checkPendingTasks 会自动重新执行它
      // 如果任务在 runningTasks 中（正在等待恢复），循环会检测到状态变化并继续
      return true;
    }
    return false;
  }

  /**
   * 取消任务
   */
  cancelTask(taskId) {
    const db = getDb();
    const task = db.prepare('SELECT status FROM shopify_tasks WHERE id = ?').get(taskId);
    if (task && ['running', 'paused', 'pending'].includes(task.status)) {
      db.prepare(`
        UPDATE shopify_tasks 
        SET status = 'cancelled', completedAt = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(taskId);
      return true;
    }
    return false;
  }
}

// 单例
export const shopifyTaskRunner = new ShopifyTaskRunner();
