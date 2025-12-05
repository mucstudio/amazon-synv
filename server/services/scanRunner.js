import { getDb } from '../db/index.js';
import { BlacklistMatcher } from './blacklistMatcher.js';

/**
 * 扫描任务运行器 - 后台处理黑名单扫描任务
 */
export class ScanRunner {
  constructor() {
    this.running = false;
    this.matcher = new BlacklistMatcher();
    this.batchSize = 500; // 每批处理的商品数量
  }

  start() {
    this.running = true;
    this.poll();
    console.log('扫描任务运行器已启动');
  }

  stop() {
    this.running = false;
  }

  async poll() {
    while (this.running) {
      try {
        await this.processNextTask();
      } catch (e) {
        console.error('扫描任务处理错误:', e);
      }
      await this.sleep(3000); // 每3秒检查一次
    }
  }

  async processNextTask() {
    const db = getDb();
    
    // 获取下一个待处理的扫描任务
    const task = db.prepare("SELECT * FROM scan_tasks WHERE status = 'pending' ORDER BY id ASC LIMIT 1").get();
    if (!task) return;

    console.log(`\n开始扫描任务 #${task.id}: ${task.name}`);

    // 更新状态为运行中
    db.prepare("UPDATE scan_tasks SET status = 'running' WHERE id = ?").run(task.id);

    try {
      // 加载黑名单
      this.matcher.loadBlacklist();
      const stats = this.matcher.getStats();
      
      if (stats.total === 0) {
        throw new Error('黑名单为空');
      }

      // 获取要扫描的商品
      let products;
      if (task.productScope === 'all' || !task.productScope) {
        products = db.prepare("SELECT * FROM products WHERE status = 'success'").all();
      } else {
        // 指定任务ID
        products = db.prepare("SELECT * FROM products WHERE taskId = ? AND status = 'success'").all(task.productScope);
      }

      if (products.length === 0) {
        throw new Error('没有可扫描的商品');
      }

      const totalProducts = products.length;
      db.prepare("UPDATE scan_tasks SET totalProducts = ? WHERE id = ?").run(totalProducts, task.id);

      console.log(`  商品总数: ${totalProducts}, 黑名单总数: ${stats.total}`);

      let scannedCount = 0;
      let matchedCount = 0;

      // 批量处理
      for (let i = 0; i < products.length; i += this.batchSize) {
        const batch = products.slice(i, i + this.batchSize);
        
        // 处理这一批商品
        for (const product of batch) {
          const result = this.matcher.match(product);
          
          // 插入扫描结果
          db.prepare(`
            INSERT INTO scan_results (scanTaskId, asin, title, totalPrice, stock, deliveryDays, sellerName, matchedSeller, matchedTro, matchedBrand, matchedProduct, hasViolation)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            task.id,
            product.asin,
            product.title,
            product.totalPrice || product.price,
            product.stock,
            product.deliveryDays,
            product.sellerName || '',
            result.seller.join(', '),
            result.tro.join(', '),
            result.brand.join(', '),
            result.product.join(', '),
            result.hasViolation ? 1 : 0
          );

          scannedCount++;
          if (result.hasViolation) {
            matchedCount++;
          }
        }

        // 更新进度
        const progress = Math.round((scannedCount / totalProducts) * 100);
        db.prepare("UPDATE scan_tasks SET progress = ?, scannedCount = ?, matchedCount = ? WHERE id = ?")
          .run(progress, scannedCount, matchedCount, task.id);

        console.log(`  进度: ${progress}% (${scannedCount}/${totalProducts}), 命中: ${matchedCount}`);
      }

      // 完成任务
      db.prepare("UPDATE scan_tasks SET status = 'completed', progress = 100, completedAt = CURRENT_TIMESTAMP WHERE id = ?")
        .run(task.id);

      console.log(`扫描任务 #${task.id} 完成: 扫描 ${scannedCount}, 命中 ${matchedCount}`);

    } catch (error) {
      // 任务失败
      db.prepare("UPDATE scan_tasks SET status = 'failed', errorMsg = ? WHERE id = ?")
        .run(error.message, task.id);
      console.error(`扫描任务 #${task.id} 失败:`, error.message);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
