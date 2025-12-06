import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '../../data/scraper.db');

let db = null;

export async function initDb() {
  if (db) return db;
  
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // 创建表
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asins TEXT NOT NULL,
      asinCount INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      successCount INTEGER DEFAULT 0,
      failCount INTEGER DEFAULT 0,
      captchaCount INTEGER DEFAULT 0,
      message TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      taskId INTEGER,
      asin TEXT NOT NULL UNIQUE,
      title TEXT,
      price TEXT,
      shippingFee TEXT,
      totalPrice TEXT,
      rating TEXT,
      reviewCount TEXT,
      image TEXT,
      images TEXT,
      bulletPoints TEXT,
      description TEXT,
      deliveryInfo TEXT,
      deliveryDays INTEGER,
      fulfillmentType TEXT,
      url TEXT,
      status TEXT DEFAULT 'success',
      errorMsg TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (taskId) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS proxies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      rawInput TEXT,
      status TEXT DEFAULT 'pending',
      successCount INTEGER DEFAULT 0,
      failCount INTEGER DEFAULT 0,
      responseTime INTEGER,
      lastUsedAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_products_asin ON products(asin);
    CREATE INDEX IF NOT EXISTS idx_products_taskId ON products(taskId);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

    CREATE TABLE IF NOT EXISTS blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_blacklist_type ON blacklist(type);
    CREATE INDEX IF NOT EXISTS idx_blacklist_keyword ON blacklist(keyword);

    CREATE TABLE IF NOT EXISTS scan_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      totalProducts INTEGER DEFAULT 0,
      scannedCount INTEGER DEFAULT 0,
      matchedCount INTEGER DEFAULT 0,
      productScope TEXT,
      errorMsg TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      completedAt DATETIME
    );

    CREATE TABLE IF NOT EXISTS scan_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scanTaskId INTEGER NOT NULL,
      asin TEXT NOT NULL,
      title TEXT,
      totalPrice TEXT,
      stock INTEGER,
      deliveryDays INTEGER,
      sellerName TEXT,
      matchedSeller TEXT,
      matchedTro TEXT,
      matchedBrand TEXT,
      matchedProduct TEXT,
      hasViolation INTEGER DEFAULT 0,
      FOREIGN KEY (scanTaskId) REFERENCES scan_tasks(id)
    );

    CREATE INDEX IF NOT EXISTS idx_scan_tasks_status ON scan_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_scan_results_taskId ON scan_results(scanTaskId);
    CREATE INDEX IF NOT EXISTS idx_scan_results_violation ON scan_results(scanTaskId, hasViolation);
  `);

  // 默认设置
  const defaultSettings = {
    concurrency: '5',
    requestDelay: '1000',
    timeout: '30000',
    amazonDomain: 'https://www.amazon.com',
    zipCode: '10001',           // 默认邮编（纽约）
    proxyEnabled: 'false',
    proxyRotateByCount: '10',
    proxyRotateByTime: '60',
    proxyMaxFailures: '3',
    proxySwitchOnFail: 'true',   // 失败时自动切换代理
    proxyFailRetryCount: '2',    // 切换代理后重试次数
    saveHtml: 'false',
    fulfillmentFilter: 'all',   // all=全部, fba=只爬FBA, fbm=只爬FBM
    fingerprintRotateOnCaptcha: 'true',  // 遇到验证码时更换指纹（独立开关）
    fingerprintRotate: 'none',   // none=不主动轮换, batch=每批次, count=按次数, request=每次请求
    fingerprintRotateCount: '10', // 按次数更换时的次数
    captchaHandling: 'auto',      // auto=自动处理, skip=跳过, retry=重试
    captchaRetryCount: '2',       // 验证码重试次数
    captchaTimeout: '300',        // 人工处理超时时间（秒）
  };

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaultSettings)) {
    insertSetting.run(key, value);
  }

  // 迁移：添加新列（如果不存在）
  try {
    const columns = db.prepare("PRAGMA table_info(products)").all();
    const columnNames = columns.map(col => col.name);
    
    if (!columnNames.includes('fulfillmentType')) {
      db.exec("ALTER TABLE products ADD COLUMN fulfillmentType TEXT");
      console.log('已添加 fulfillmentType 列');
    }
    if (!columnNames.includes('shippingFee')) {
      db.exec("ALTER TABLE products ADD COLUMN shippingFee TEXT");
      console.log('已添加 shippingFee 列');
    }
    if (!columnNames.includes('totalPrice')) {
      db.exec("ALTER TABLE products ADD COLUMN totalPrice TEXT");
      console.log('已添加 totalPrice 列');
    }
    if (!columnNames.includes('deliveryDays')) {
      db.exec("ALTER TABLE products ADD COLUMN deliveryDays INTEGER");
      console.log('已添加 deliveryDays 列');
    }
    if (!columnNames.includes('stock')) {
      db.exec("ALTER TABLE products ADD COLUMN stock INTEGER");
      console.log('已添加 stock 列');
    }
    if (!columnNames.includes('sellerName')) {
      db.exec("ALTER TABLE products ADD COLUMN sellerName TEXT");
      console.log('已添加 sellerName 列');
    }
    if (!columnNames.includes('updatedAt')) {
      db.exec("ALTER TABLE products ADD COLUMN updatedAt DATETIME");
      db.exec("UPDATE products SET updatedAt = createdAt WHERE updatedAt IS NULL");
      console.log('已添加 updatedAt 列');
    }
    if (!columnNames.includes('attributes')) {
      db.exec("ALTER TABLE products ADD COLUMN attributes TEXT");
      console.log('已添加 attributes 列');
    }
    if (!columnNames.includes('returnPolicy')) {
      db.exec("ALTER TABLE products ADD COLUMN returnPolicy TEXT");
      console.log('已添加 returnPolicy 列');
    }
    
    // 检查 asin 是否有唯一索引，如果没有则创建
    const indexes = db.prepare("PRAGMA index_list(products)").all();
    const hasUniqueAsin = indexes.some(idx => {
      if (!idx.unique) return false;
      const cols = db.prepare(`PRAGMA index_info(${idx.name})`).all();
      return cols.length === 1 && cols[0].name === 'asin';
    });
    if (!hasUniqueAsin) {
      // 先删除重复的 asin，保留最新的记录
      db.exec(`
        DELETE FROM products WHERE id NOT IN (
          SELECT MAX(id) FROM products GROUP BY asin
        )
      `);
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_products_asin_unique ON products(asin)");
      console.log('已为 asin 添加唯一约束');
    }
    
    // 迁移 proxies 表
    const proxyColumns = db.prepare("PRAGMA table_info(proxies)").all();
    const proxyColumnNames = proxyColumns.map(col => col.name);
    
    if (!proxyColumnNames.includes('usageCount')) {
      db.exec("ALTER TABLE proxies ADD COLUMN usageCount INTEGER DEFAULT 0");
      console.log('已添加 proxies.usageCount 列');
    }
    if (!proxyColumnNames.includes('totalUsageCount')) {
      db.exec("ALTER TABLE proxies ADD COLUMN totalUsageCount INTEGER DEFAULT 0");
      console.log('已添加 proxies.totalUsageCount 列');
    }
  } catch (e) {
    console.error('迁移失败:', e.message);
  }

  console.log('数据库已初始化');
  return db;
}

export function getDb() {
  return db;
}
