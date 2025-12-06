import { getDb } from '../db/index.js';
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_DIR = join(__dirname, '../../data/html');

/**
 * 爬取器 - HTTP 请求 + 解析，支持验证码处理
 */
export class Scraper {
  constructor() {
    this.proxyIndex = 0;
    this.proxyUsageCount = {};
    this.browser = null;
    this.cookies = null;
    this.captchaCallback = null;
    this.lastProxyRotateTime = null;
    this.captchaLock = false; // 验证码处理锁，避免同时启动多个浏览器
    this.captchaQueue = []; // 等待验证码处理的请求队列
    
    // 确保 HTML 目录存在
    if (!existsSync(HTML_DIR)) {
      mkdirSync(HTML_DIR, { recursive: true });
    }
  }

  /**
   * 保存 HTML 到本地
   */
  saveHtml(asin, html, settings) {
    if (!settings.saveHtml) return null;
    
    try {
      const timestamp = Date.now();
      const filename = `${asin}_${timestamp}.html`;
      const filepath = join(HTML_DIR, filename);
      writeFileSync(filepath, html, 'utf-8');
      return filename;
    } catch (e) {
      console.error(`保存 HTML 失败: ${asin}`, e.message);
      return null;
    }
  }

  /**
   * 设置验证码回调
   */
  onCaptcha(callback) {
    this.captchaCallback = callback;
  }

  async scrapeProduct(asin, settings, retryCount = 0) {
    const url = `${settings.amazonDomain}/dp/${asin}`;
    
    const fingerprint = this.getRandomFingerprint();
    const headers = {
      'User-Agent': fingerprint.ua,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
    };
    
    // 只有 Chrome 才发送 sec-ch-ua headers
    if (fingerprint.secChUa) {
      headers['sec-ch-ua'] = fingerprint.secChUa;
      headers['sec-ch-ua-mobile'] = '?0';
      headers['sec-ch-ua-platform'] = fingerprint.platform;
    }

    // 设置邮编 cookie（影响价格和配送信息）
    const zipCode = settings.zipCode || '10001';
    
    // 构建地址 cookie - Amazon 使用多个 cookie 来确定位置
    const addressData = {
      "locationType": "LOCATION_INPUT",
      "zipCode": zipCode,
      "stateOrRegion": "",
      "city": "",
      "countryCode": "US",
      "deviceType": "web",
      "district": "",
      "addressId": ""
    };
    
    // 使用更完整的 cookie 设置
    let cookieStr = [
      `ubid-main=131-0000000-0000000`,
      `session-id=000-0000000-0000000`,
      `sp-cdn="L5Z9:CN"`,
      `lc-main=en_US`,
      `i18n-prefs=USD`,
      `gp-delivery-location=${encodeURIComponent(JSON.stringify(addressData))}`,
      `x-wl-uid=1`,
      `session-token=none`,
      `csm-hit=tb:s-00000000000000000000000000000000|0000000000000&t:0000000000000&adb:adblk_no`
    ].join('; ');

    // 如果有验证码处理后的 cookies，合并
    if (this.cookies) {
      cookieStr = this.cookies + '; ' + cookieStr;
    }
    
    headers['Cookie'] = cookieStr;

    const fetchOptions = { headers, redirect: 'follow' };

    // 代理支持
    let currentProxy = null;
    if (settings.proxyEnabled) {
      currentProxy = this.getProxy(settings);
      if (currentProxy) {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        fetchOptions.agent = new HttpsProxyAgent(currentProxy);
      }
    }

    try {
      const response = await fetch(url, fetchOptions);
      const html = await response.text();

      // 检测产品不存在（狗狗页面）
      if (this.isProductNotFound(html, response.status)) {
        console.log(`⚠️ 产品不存在: ${asin}`);
        throw new Error('PRODUCT_NOT_FOUND');
      }

      // 检测验证码
      if (this.hasCaptcha(html)) {
        console.log(`⚠️ 检测到验证码: ${asin}`);
        
        // 根据设置决定是否更换浏览器指纹
        if (settings.fingerprintRotateOnCaptcha !== false) {
          this.rotateFingerprint();
        }
        
        const captchaHandling = settings.captchaHandling || 'auto';
        const captchaRetryCount = settings.captchaRetryCount || 2;
        const captchaTimeout = (settings.captchaTimeout || 300) * 1000;
        
        // 处理方式：跳过
        if (captchaHandling === 'skip') {
          throw new Error('CAPTCHA_REQUIRED');
        }
        
        // 处理方式：更换指纹后重试
        if (captchaHandling === 'retry') {
          if (retryCount < captchaRetryCount) {
            console.log(`  🔄 更换指纹后重试 (${retryCount + 1}/${captchaRetryCount}): ${asin}`);
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
            return this.scrapeProduct(asin, settings, retryCount + 1);
          }
          throw new Error('CAPTCHA_REQUIRED');
        }
        
        // 处理方式：自动处理（默认）
        // 如果已经有验证码在处理中，等待处理完成后重试
        if (this.captchaLock) {
          console.log(`  ⏳ 等待其他验证码处理完成: ${asin}`);
          await this.waitForCaptchaUnlock();
          // 验证码处理完成后，使用新的 cookies 和指纹重试
          return this.scrapeProduct(asin, settings, retryCount);
        }
        
        // 尝试用浏览器自动处理验证码
        const resolvedHtml = await this.handleCaptchaWithBrowser(url, settings, captchaTimeout);
        if (resolvedHtml) {
          return this.parseProduct(resolvedHtml, url, asin);
        }
        
        throw new Error('CAPTCHA_REQUIRED');
      }

      // 检测封禁
      if (this.isBlocked(html, response.status)) {
        // 如果有代理且开启了失败自动切换
        if (currentProxy) {
          this.markProxyFailed(currentProxy, settings.proxyMaxFailures || 3);
          const maxRetry = settings.proxyFailRetryCount || 2;
          if (settings.proxySwitchOnFail && retryCount < maxRetry) {
            // 强制切换到下一个代理
            this.forceNextProxy();
            console.log(`  🔄 代理被封禁，切换代理重试 (${retryCount + 1}/${maxRetry}): ${asin}`);
            return this.scrapeProduct(asin, settings, retryCount + 1);
          }
        }
        throw new Error('IP_BLOCKED');
      }

      // 保存 HTML 到本地
      const htmlFile = this.saveHtml(asin, html, settings);

      // 解析数据
      const product = this.parseProduct(html, url, asin);
      if (htmlFile) {
        product.htmlFile = htmlFile;
      }
      
      // 注意：如果价格是 "See All Buying Options"，表示没有 Buy Box 卖家
      // 需要从 Other Sellers 获取价格，但这需要浏览器支持（待开发）
      // 当前保持 "See All Buying Options" 状态，不尝试获取可能错误的价格
      
      // 标记代理成功
      if (currentProxy) {
        this.markProxySuccess(currentProxy);
      }
      
      return product;
    } catch (error) {
      // 网络错误时，如果开启了失败自动切换，尝试切换代理重试
      if (currentProxy && (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET')) {
        this.markProxyFailed(currentProxy, settings.proxyMaxFailures || 3);
        const maxRetry = settings.proxyFailRetryCount || 2;
        if (settings.proxySwitchOnFail && retryCount < maxRetry) {
          this.forceNextProxy();
          console.log(`  🔄 代理连接失败，切换代理重试 (${retryCount + 1}/${maxRetry}): ${asin}`);
          return this.scrapeProduct(asin, settings, retryCount + 1);
        }
      }
      throw error;
    }
  }

  /**
   * 检测是否有验证码
   */
  hasCaptcha(html) {
    const captchaPatterns = [
      'captchacharacters',
      'validateCaptcha',
      'Type the characters you see',
      'Enter the characters you see below',
    ];
    return captchaPatterns.some(p => html.includes(p));
  }

  /**
   * 等待验证码锁释放
   */
  async waitForCaptchaUnlock() {
    while (this.captchaLock) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  /**
   * 用浏览器处理验证码（自动处理简单验证码，复杂的转人工）
   */
  async handleCaptchaWithBrowser(url, settings, timeout = 300000) {
    // 设置锁，防止同时启动多个浏览器
    this.captchaLock = true;
    
    try {
      console.log('🌐 启动浏览器处理验证码...');
      
      if (!this.browser) {
        this.browser = await chromium.launch({
          headless: false, // 显示浏览器窗口
          slowMo: 100,
        });
      }

      const context = await this.browser.newContext({
        userAgent: this.getRandomUA(),
        viewport: { width: 1920, height: 1080 },
      });

      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      // 检查是否是简单验证码（图片验证码）
      const isSimpleCaptcha = await page.evaluate(() => {
        const captchaInput = document.querySelector('input#captchacharacters');
        const captchaImage = document.querySelector('img[src*="captcha"]');
        return !!(captchaInput && captchaImage);
      });

      if (isSimpleCaptcha) {
        console.log('🤖 检测到简单验证码，尝试自动处理...');
        
        // 等待一小段时间，让页面完全加载
        await page.waitForTimeout(1000);
        
        // 检查页面是否自动跳过了验证码（有时浏览器环境下不需要验证码）
        const stillHasCaptcha = await page.evaluate(() => {
          return !!document.querySelector('input#captchacharacters');
        });
        
        if (!stillHasCaptcha) {
          console.log('✓ 验证码已自动跳过');
        } else {
          // 通知前端需要人工处理
          if (this.captchaCallback) {
            this.captchaCallback({ status: 'captcha', message: '需要人工处理验证码' });
          }
          console.log(`⏳ 等待人工完成验证码（最多${Math.round(timeout/1000)}秒）...`);
          
          // 等待验证码消失或页面跳转
          await page.waitForFunction(() => {
            return !document.querySelector('input#captchacharacters') &&
                   !document.body.innerHTML.includes('validateCaptcha');
          }, { timeout });
          
          console.log('✓ 验证码已处理');
        }
      } else {
        // 复杂验证码，直接等待人工处理
        if (this.captchaCallback) {
          this.captchaCallback({ status: 'captcha', message: '需要人工处理复杂验证码' });
        }
        console.log(`⏳ 等待人工完成验证码（最多${Math.round(timeout/1000)}秒）...`);
        
        await page.waitForFunction(() => {
          return !document.querySelector('input#captchacharacters') &&
                 !document.body.innerHTML.includes('validateCaptcha');
        }, { timeout });
        
        console.log('✓ 验证码已处理');
      }

      // 获取 cookies 供后续请求使用
      const cookies = await context.cookies();
      this.cookies = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      // 获取页面内容
      const html = await page.content();
      
      await context.close();
      
      return html;
    } catch (error) {
      console.error('验证码处理失败:', error.message);
      return null;
    } finally {
      // 释放锁
      this.captchaLock = false;
    }
  }

  /**
   * 关闭浏览器
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * 标记代理失败
   */
  markProxyFailed(proxyUrl, maxFailures = 3) {
    const db = getDb();
    db.prepare(`
      UPDATE proxies SET failCount = failCount + 1,
      status = CASE WHEN failCount >= ? THEN 'failed' ELSE status END
      WHERE url = ?
    `).run(maxFailures, proxyUrl);
    console.log(`代理失败: ${proxyUrl.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')}`);
  }

  /**
   * 解码 HTML 实体
   */
  decodeHtmlEntities(text) {
    if (!text) return '';
    return text
      .replace(/&#34;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
  }

  parseProduct(html, url, asin) {
    const price = this.extractPrice(html);
    const shippingFee = this.extractShippingFee(html);
    const totalPrice = this.calculateTotalPrice(price, shippingFee);
    const deliveryInfo = this.extractDelivery(html);
    const deliveryDays = this.calculateDeliveryDays(html);
    const stock = this.extractStock(html);
    const sellerName = this.extractSellerName(html);
    
    return {
      asin,
      url,
      title: this.decodeHtmlEntities(this.extract(html, /<span id="productTitle"[^>]*>([^<]+)<\/span>/)),
      price,
      shippingFee,
      totalPrice,
      rating: this.extract(html, /<span class="a-icon-alt">([0-9.]+) out of 5/),
      reviewCount: this.extract(html, /<span id="acrCustomerReviewText"[^>]*>([^<]+)<\/span>/),
      images: this.extractImages(html),
      bulletPoints: this.extractBullets(html).map(b => this.decodeHtmlEntities(b)),
      description: this.decodeHtmlEntities(this.extractDescription(html)),
      attributes: this.extractAttributes(html),
      deliveryInfo,
      deliveryDays,
      fulfillmentType: this.extractFulfillmentType(html),
      stock,
      sellerName,
      returnPolicy: this.extractReturnPolicy(html),
    };
  }

  /**
   * 提取退货政策
   */
  extractReturnPolicy(html) {
    // 方法1: 从 span 标签内提取包含 refund/replacement 的文本
    const spanRefundMatch = html.match(/<span[^>]*>([^<]*(?:FREE\s+)?refund\/replacement[^<]*)<\/span>/i);
    if (spanRefundMatch) {
      const text = spanRefundMatch[1].trim();
      if (text && text.length < 100) {
        return this.decodeHtmlEntities(text);
      }
    }
    
    // 方法2: 从 span 标签内提取 "Returnable until..." 格式
    const returnableUntilMatch = html.match(/<span[^>]*>([^<]*Returnable\s+until[^<]*)<\/span>/i);
    if (returnableUntilMatch) {
      const text = returnableUntilMatch[1].trim();
      if (text && text.length < 100) {
        return this.decodeHtmlEntities(text);
      }
    }
    
    // 方法3: 从 desktop-returns-info 区域提取
    const returnsSection = html.match(/data-csa-c-content-id="odf-desktop-returns-info"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
    if (returnsSection) {
      // 查找包含 refund、return、replacement、returnable 等关键词的 span
      const returnTextMatch = returnsSection[1].match(/<span[^>]*class="[^"]*offer-display-feature-text-message[^"]*"[^>]*>([^<]*(?:refund|returnable|replacement)[^<]*)<\/span>/i);
      if (returnTextMatch) {
        return this.decodeHtmlEntities(returnTextMatch[1].trim());
      }
    }
    
    // 方法4: 从 Returns 标签后提取
    const returnsLabelSection = html.match(/<span[^>]*>Returns<\/span>([\s\S]*?)<\/div>\s*<\/div>/i);
    if (returnsLabelSection) {
      const spans = returnsLabelSection[1].matchAll(/<span[^>]*class="[^"]*offer-display-feature-text-message[^"]*"[^>]*>([^<]+)<\/span>/gi);
      for (const span of spans) {
        const text = span[1].trim();
        // 跳过看起来像卖家名的文本，匹配退货相关关键词
        if (text.toLowerCase().includes('refund') || 
            text.toLowerCase().includes('returnable') || 
            text.toLowerCase().includes('replacement') ||
            text.toLowerCase().includes('eligible')) {
          return this.decodeHtmlEntities(text);
        }
      }
    }
    
    // 方法5: 检查是否有 "Non-returnable" 标识（在 span 内）
    const nonReturnMatch = html.match(/<span[^>]*>([^<]*Non-?returnable[^<]*)<\/span>/i);
    if (nonReturnMatch) {
      return this.decodeHtmlEntities(nonReturnMatch[1].trim());
    }
    
    // 方法6: 检查是否有 "Eligible for Return"（在 span 内）
    const eligibleMatch = html.match(/<span[^>]*>([^<]*Eligible for Return[^<]*)<\/span>/i);
    if (eligibleMatch) {
      return this.decodeHtmlEntities(eligibleMatch[1].trim());
    }
    
    // 方法7: 通用匹配 - 查找任何包含 Returnable 的 span
    const returnableMatch = html.match(/<span[^>]*>([^<]*Returnable[^<]*)<\/span>/i);
    if (returnableMatch) {
      const text = returnableMatch[1].trim();
      if (text && text.length < 100) {
        return this.decodeHtmlEntities(text);
      }
    }
    
    return '';
  }

  /**
   * 提取商品属性（品牌、尺寸、重量、材质等）
   */
  extractAttributes(html) {
    const attributes = {};
    
    // 需要排除的属性名
    const excludeKeys = ['Customer Reviews', 'Best Sellers Rank', 'ASIN'];
    
    const shouldInclude = (key, value) => {
      if (!key || !value) return false;
      if (attributes[key]) return false;  // 已存在
      if (excludeKeys.some(e => key.includes(e))) return false;
      if (!this.isValidAttributeValue(value)) return false;
      return true;
    };
    
    // 方法1: 从 productDetails_techSpec_section 表格提取（新版页面）
    const techSpecMatch = html.match(/<table[^>]*id="productDetails_techSpec_section[^"]*"[^>]*class="[^"]*prodDetTable[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
    if (techSpecMatch) {
      const rows = techSpecMatch[1].matchAll(/<tr[^>]*>[\s\S]*?<th[^>]*>([\s\S]*?)<\/th>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi);
      for (const row of rows) {
        const key = this.cleanAttributeText(row[1]);
        const value = this.cleanAttributeText(row[2]);
        if (shouldInclude(key, value)) {
          attributes[key] = value;
        }
      }
    }
    
    // 方法2: 从 productDetails_detailBullets_sections 表格提取
    const detailBulletsTableMatch = html.match(/<table[^>]*id="productDetails_detailBullets_sections[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
    if (detailBulletsTableMatch) {
      const rows = detailBulletsTableMatch[1].matchAll(/<tr[^>]*>[\s\S]*?<th[^>]*>([\s\S]*?)<\/th>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi);
      for (const row of rows) {
        const key = this.cleanAttributeText(row[1]);
        const value = this.cleanAttributeText(row[2]);
        if (shouldInclude(key, value)) {
          attributes[key] = value;
        }
      }
    }
    
    // 方法3: 从 detailBullets_feature_div 列表提取（旧版页面）
    const detailBulletsMatch = html.match(/<div[^>]*id="detailBullets_feature_div"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
    if (detailBulletsMatch) {
      const items = detailBulletsMatch[1].matchAll(/<span[^>]*class="[^"]*a-text-bold[^"]*"[^>]*>([^<:]+)\s*:?\s*<\/span>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi);
      for (const item of items) {
        const key = this.cleanAttributeText(item[1]);
        const value = this.cleanAttributeText(item[2]);
        if (shouldInclude(key, value)) {
          attributes[key] = value;
        }
      }
    }
    
    // 方法4: 从 detail-bullet-list 提取
    const bulletListMatch = html.match(/<ul[^>]*class="[^"]*detail-bullet-list[^"]*"[^>]*>([\s\S]*?)<\/ul>/i);
    if (bulletListMatch) {
      const items = bulletListMatch[1].matchAll(/<li[^>]*>[\s\S]*?<span[^>]*class="[^"]*a-text-bold[^"]*"[^>]*>([^<:]+)\s*:?\s*<\/span>[\s\S]*?(?:<span[^>]*>)?([^<]+)/gi);
      for (const item of items) {
        const key = this.cleanAttributeText(item[1]);
        const value = this.cleanAttributeText(item[2]);
        if (shouldInclude(key, value)) {
          attributes[key] = value;
        }
      }
    }
    
    return attributes;
  }

  /**
   * 清理属性文本
   */
  cleanAttributeText(text) {
    if (!text) return '';
    
    let cleaned = text
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')  // 移除 script 标签及内容
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')    // 移除 style 标签及内容
      .replace(/<[^>]+>/g, '')  // 移除其他 HTML 标签
      .replace(/&lrm;/g, '')    // 移除左到右标记
      .replace(/&rlm;/g, '')    // 移除右到左标记
      .replace(/\s+/g, ' ')     // 合并空白
      .trim();
    
    return this.decodeHtmlEntities(cleaned);
  }
  
  /**
   * 验证属性值是否有效（过滤包含 JavaScript 代码的值）
   */
  isValidAttributeValue(value) {
    if (!value) return false;
    // 检查是否包含代码特征
    const codePatterns = ['function(', 'P.when(', 'window.', 'var ', 'ue.count(', 'execute(', 'declarative(', '.ready)', 'dpAcr'];
    return !codePatterns.some(p => value.includes(p));
  }

  /**
   * 提取卖家名称 (Sold by)
   */
  extractSellerName(html) {
    // 方法1: 从 sellerProfileTriggerId 提取（最可靠，直接包含卖家名称）
    const sellerProfileMatch = html.match(/id=['"]sellerProfileTriggerId['"][^>]*>([^<]+)<\/a>/i);
    if (sellerProfileMatch) {
      return sellerProfileMatch[1].trim();
    }
    
    // 方法2: 从 desktop-seller-info 区域的链接提取
    // 匹配 data-csa-c-content-id="odf-desktop-merchant-info" 后面的 offer-display-feature-text-message
    const merchantInfoMatch = html.match(/data-csa-c-content-id="odf-desktop-merchant-info"[^>]*>[\s\S]*?<span[^>]*class="[^"]*offer-display-feature-text-message[^"]*"[^>]*>([^<]+)<\/span>/i);
    if (merchantInfoMatch) {
      return merchantInfoMatch[1].trim();
    }
    
    // 方法3: 从 "Sold by" 标签后的链接提取
    const soldByMatch = html.match(/<span[^>]*>Sold by<\/span>[\s\S]*?<a[^>]*class="[^"]*offer-display-feature-text-message[^"]*"[^>]*>([^<]+)<\/a>/i);
    if (soldByMatch) {
      return soldByMatch[1].trim();
    }
    
    // 方法4: 从 merchant-info 区域提取
    const merchantMatch = html.match(/id="merchant-info"[^>]*>[\s\S]*?Sold by\s*<a[^>]*>([^<]+)<\/a>/i);
    if (merchantMatch) {
      return merchantMatch[1].trim();
    }
    
    // 方法5: 从 "Ships from and sold by" 提取
    const shipsAndSoldMatch = html.match(/Ships from and sold by\s*<a[^>]*>([^<]+)<\/a>/i);
    if (shipsAndSoldMatch) {
      return shipsAndSoldMatch[1].trim();
    }
    
    // 方法6: 从 bylineInfo 区域提取（品牌/卖家）
    const bylineMatch = html.match(/id="bylineInfo"[^>]*>[\s\S]*?Visit the\s*([^<]+)\s*Store/i);
    if (bylineMatch) {
      return bylineMatch[1].trim();
    }
    
    return '';
  }

  /**
   * 计算预估送达天数
   */
  calculateDeliveryDays(html) {
    // 从 data-csa-c-delivery-time 属性提取送达日期
    const deliveryTimeMatch = html.match(/data-csa-c-delivery-time="([^"]+)"/);
    let deliveryDateStr = deliveryTimeMatch ? deliveryTimeMatch[1] : null;
    
    // 如果没找到，尝试从文本中提取
    if (!deliveryDateStr) {
      const textPatterns = [
        /(?:Delivery|Arrives|Get it)\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2})/i,
        /(?:FREE delivery|delivery)\s+<span[^>]*>([^<]+)<\/span>/i,
      ];
      for (const p of textPatterns) {
        const match = html.match(p);
        if (match) {
          deliveryDateStr = match[1];
          break;
        }
      }
    }
    
    if (!deliveryDateStr) return null;
    
    // 解析日期字符串，如 "Friday, December 12" 或 "Dec 12"
    const today = new Date();
    const currentYear = today.getFullYear();
    
    // 提取月份和日期
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const dateMatch = deliveryDateStr.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})/i);
    
    if (!dateMatch) return null;
    
    const monthStr = dateMatch[1].toLowerCase();
    const day = parseInt(dateMatch[2], 10);
    const month = monthNames.indexOf(monthStr.substring(0, 3));
    
    if (month === -1 || isNaN(day)) return null;
    
    // 构建送达日期
    let deliveryDate = new Date(currentYear, month, day);
    
    // 如果送达日期已过（可能是明年），加一年
    if (deliveryDate < today) {
      deliveryDate = new Date(currentYear + 1, month, day);
    }
    
    // 计算天数差
    const diffTime = deliveryDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays > 0 ? diffDays : 0;
  }

  /**
   * 提取运费
   */
  extractShippingFee(html) {
    // 优先从 data-csa-c-delivery-price 属性提取（最可靠的来源）
    const deliveryPriceAttr = html.match(/data-csa-c-delivery-price="([^"]+)"/);
    if (deliveryPriceAttr) {
      const value = deliveryPriceAttr[1].trim();
      // 检查是否免运费
      if (value.toUpperCase() === 'FREE' || value === '$0.00' || value === '0') {
        return 'FREE';
      }
      // 如果是价格格式，直接返回（不再检查其他模式）
      if (/^\$[\d,.]+$/.test(value)) {
        return value;
      }
    }
    
    // 只有在没有从 data-csa-c-delivery-price 获取到有效值时，才检查免运费标识
    // 注意：需要更精确地匹配，避免匹配到 Prime 会员的免费配送提示
    const freeShippingPatterns = [
      /data-csa-c-delivery-price="FREE"/i,
      />\s*FREE\s+delivery\s*</i,
      />\s*FREE\s+Shipping\s*</i,
    ];
    
    for (const p of freeShippingPatterns) {
      if (p.test(html)) {
        return 'FREE';
      }
    }
    
    // 从明确的运费文本中提取
    const shippingPatterns = [
      /\+\s*(\$[\d,.]+)\s*shipping/i,
      /(\$[\d,.]+)\s*(?:for\s+)?shipping/i,
    ];
    
    for (const p of shippingPatterns) {
      const match = html.match(p);
      if (match) {
        return match[1];
      }
    }
    
    return '';
  }

  /**
   * 提取库存信息
   */
  extractStock(html) {
    // 首先检查 outOfStock div（最可靠的缺货标识）
    if (/id="outOfStock"[^>]*>[\s\S]*?Currently unavailable/i.test(html)) {
      return 0;
    }
    
    // 检查 availability 区域内的缺货状态
    const availabilitySection = html.match(/id="availability"[^>]*>([\s\S]*?)<\/div>/i);
    if (availabilitySection) {
      const availText = availabilitySection[1];
      if (/Currently unavailable/i.test(availText) || 
          /We don't know when or if this item will be back in stock/i.test(availText)) {
        return 0;
      }
    }
    
    // 检查带有 a-color-price 类的缺货文本
    if (/<span[^>]*class="[^"]*a-color-price[^"]*"[^>]*>\s*Currently unavailable/i.test(html)) {
      return 0;
    }
    
    // 检查带有 a-color-success 类的缺货文本（Amazon 有时用这个类）
    if (/<span[^>]*class="[^"]*a-color-success[^"]*"[^>]*>\s*Currently unavailable/i.test(html)) {
      return 0;
    }
    
    // 检查是否是多卖家页面（有 See All Buying Options）
    const isMultiSellerPage = html.includes('No featured offers available') || 
                              html.includes('See All Buying Options');
    
    // 多卖家页面，返回 -1 表示有货（需要从 offer-listing 获取详情）
    if (isMultiSellerPage) {
      return -1;
    }
    
    // 从数量下拉框提取最大可购买数量
    const quantitySelectMatch = html.match(/<select[^>]*id="quantity"[^>]*>([\s\S]*?)<\/select>/i);
    if (quantitySelectMatch) {
      const optionsHtml = quantitySelectMatch[1];
      const optionValues = [...optionsHtml.matchAll(/<option[^>]*value="(\d+)"[^>]*>/gi)];
      if (optionValues.length > 0) {
        const maxQty = Math.max(...optionValues.map(m => parseInt(m[1], 10)));
        if (maxQty > 0) {
          return maxQty;
        }
      }
    }
    
    // 提取 "Only X left in stock" 格式
    const limitedStockMatch = html.match(/Only\s+(\d+)\s+left\s+in\s+stock/i);
    if (limitedStockMatch) {
      return parseInt(limitedStockMatch[1], 10);
    }
    
    // 检查是否有 "In Stock" 标识
    const inStockPatterns = [
      /<span[^>]*class="[^"]*a-color-success[^"]*"[^>]*>\s*In Stock\s*<\/span>/i,
      /id="availability"[^>]*>[\s\S]*?In Stock/i,
    ];
    
    for (const p of inStockPatterns) {
      if (p.test(html)) {
        return -1;
      }
    }
    
    return null;
  }

  /**
   * 计算总价 (价格 + 运费)
   */
  calculateTotalPrice(price, shippingFee) {
    if (!price || price === 'See All Buying Options') {
      return '';
    }
    
    // 解析价格数字
    const priceNum = this.parsePrice(price);
    if (priceNum === null) return price;
    
    // 如果免运费或无运费信息，总价等于商品价格
    if (!shippingFee || shippingFee === 'FREE') {
      return price;
    }
    
    // 解析运费数字
    const shippingNum = this.parsePrice(shippingFee);
    if (shippingNum === null) return price;
    
    // 计算总价
    const total = priceNum + shippingNum;
    return '$' + total.toFixed(2);
  }

  /**
   * 解析价格字符串为数字
   */
  parsePrice(priceStr) {
    if (!priceStr) return null;
    const match = priceStr.match(/[\d,.]+/);
    if (!match) return null;
    return parseFloat(match[0].replace(/,/g, ''));
  }

  /**
   * 提取配送类型 FBA/FBM
   * FBA: Ships from 包含 Amazon（包括 Amazon.com, Amazon Seller 等）
   * FBM: Ships from 不包含 Amazon（第三方卖家发货）
   */
  extractFulfillmentType(html) {
    // 方法1: 检查 fulfiller-info 区域的 Ships from 信息
    const fulfillerSection = html.match(/offer-display-feature-name="desktop-fulfiller-info"[\s\S]*?<span[^>]*class="[^"]*offer-display-feature-text-message[^"]*"[^>]*>([^<]+)<\/span>/i);
    if (fulfillerSection) {
      const shipper = fulfillerSection[1].trim().toLowerCase();
      if (shipper.includes('amazon')) {
        return 'FBA';
      }
      return 'FBM';
    }
    
    // 方法2: 检查 Shipper / Seller 区域（合并显示的情况）
    const shipperSellerMatch = html.match(/Shipper\s*\/\s*Seller[\s\S]*?<span[^>]*class="[^"]*offer-display-feature-text-message[^"]*"[^>]*>([^<]+)<\/span>/i);
    if (shipperSellerMatch) {
      const seller = shipperSellerMatch[1].trim().toLowerCase();
      if (seller.includes('amazon')) {
        return 'FBA';
      }
      return 'FBM';
    }
    
    // 方法3: 传统模式匹配
    if (/Ships from[\s\S]*?Amazon/i.test(html)) {
      return 'FBA';
    }
    
    if (/Fulfilled by Amazon/i.test(html)) {
      return 'FBA';
    }
    
    // 如果有卖家信息但不包含 Amazon
    if (/Ships from and sold by/i.test(html)) {
      return 'FBM';
    }
    
    return '';
  }

  // 注意：FBA/FBM 筛选功能待开发
  // 需要使用浏览器加载 AOD 弹窗来获取 Other Sellers 数据

  extract(html, regex) {
    const match = html.match(regex);
    return match ? match[1].trim() : '';
  }

  extractPrice(html) {
    // 首先检测缺货状态 - 缺货产品不应该显示价格
    if (/id="outOfStock"[^>]*>[\s\S]*?Currently unavailable/i.test(html)) {
      return '';
    }
    if (/<span[^>]*class="[^"]*a-color-price[^"]*"[^>]*>\s*Currently unavailable/i.test(html)) {
      return '';
    }
    
    // 检测是否是多卖家页面（无购物车按钮，但有货）
    const noFeaturedOffer = html.includes('No featured offers available');
    
    // 如果是多卖家页面且不是缺货，返回需要查看 offer-listing
    if (noFeaturedOffer) {
      return 'See All Buying Options';
    }
    
    // 方法1: 从隐藏表单字段提取（最可靠，这是实际购买价格）
    const formPriceMatch = html.match(/name="items\[0\.base\]\[customerVisiblePrice\]\[displayString\]"\s*value="(\$[\d,.]+)"/);
    if (formPriceMatch) {
      return formPriceMatch[1];
    }
    
    // 方法2: 从 twister-plus-buying-options-price-data JSON 提取
    const twisterPriceMatch = html.match(/id="twister-plus-buying-options-price-data"[^>]*>([^<]+)</);
    if (twisterPriceMatch) {
      try {
        const priceData = JSON.parse(twisterPriceMatch[1]);
        if (priceData.desktop_buybox_group_1 && priceData.desktop_buybox_group_1[0]) {
          const displayPrice = priceData.desktop_buybox_group_1[0].displayPrice;
          if (displayPrice && /^\$[\d,.]+$/.test(displayPrice)) {
            return displayPrice;
          }
        }
      } catch (e) {
        // JSON 解析失败，继续尝试其他方法
      }
    }
    
    // 方法3: 从 apex_dp_offer_display 区域提取（主价格显示区域）
    const apexSection = html.match(/data-csa-c-slot-id="apex_dp_offer_display"[\s\S]*?data-csa-c-content-id="[^"]*">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
    if (apexSection) {
      const priceMatch = apexSection[1].match(/<span class="a-offscreen">(\$[\d,.]+)<\/span>/);
      if (priceMatch && !/data-a-strike/.test(apexSection[1].substring(0, apexSection[1].indexOf(priceMatch[0])))) {
        return priceMatch[1];
      }
    }
    
    // 方法4: 从 corePriceDisplay 区域提取（排除划线价）
    const coreSection = html.match(/id="corePriceDisplay[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
    if (coreSection) {
      // 排除 data-a-strike="true" 的划线价格
      const sectionHtml = coreSection[1];
      // 找到第一个非划线价格
      const priceBlocks = sectionHtml.split(/<span[^>]*class="a-price[^"]*"/);
      for (let i = 1; i < priceBlocks.length; i++) {
        const block = priceBlocks[i];
        // 跳过划线价格
        if (block.includes('data-a-strike="true"')) continue;
        const priceMatch = block.match(/<span class="a-offscreen">(\$[\d,.]+)<\/span>/);
        if (priceMatch) {
          return priceMatch[1];
        }
      }
    }
    
    // 方法5: 从 priceToPay 类提取（实际支付价格）
    const priceToPayMatch = html.match(/class="[^"]*priceToPay[^"]*"[^>]*>[\s\S]*?<span class="a-offscreen">(\$[\d,.]+)<\/span>/);
    if (priceToPayMatch) {
      return priceToPayMatch[1];
    }
    
    // 方法6: 传统价格块 ID
    const legacyPatterns = [
      /<span[^>]*id="priceblock_ourprice"[^>]*>(\$[\d,.]+)<\/span>/,
      /<span[^>]*id="priceblock_dealprice"[^>]*>(\$[\d,.]+)<\/span>/,
      /<span[^>]*id="priceblock_saleprice"[^>]*>(\$[\d,.]+)<\/span>/,
    ];
    
    for (const p of legacyPatterns) {
      const match = html.match(p);
      if (match) {
        return match[1];
      }
    }
    
    // 检查是否有 "See All Buying Options" 按钮
    if (html.includes('See All Buying Options')) {
      return 'See All Buying Options';
    }
    
    return '';
  }

  extractImages(html) {
    const images = [];
    
    // 方法1: 从 colorImages JSON 提取 hiRes 图片（最完整）
    const colorImagesMatch = html.match(/'colorImages'\s*:\s*\{\s*'initial'\s*:\s*\[/);
    if (colorImagesMatch) {
      // 直接用正则提取所有 hiRes URL
      const hiResMatches = html.matchAll(/"hiRes"\s*:\s*"(https:\/\/[^"]+)"/g);
      for (const m of hiResMatches) {
        if (!images.includes(m[1])) {
          images.push(m[1]);
        }
      }
      
      // 如果没有 hiRes，提取 large
      if (images.length === 0) {
        const largeMatches = html.matchAll(/"large"\s*:\s*"(https:\/\/[^"]+)"/g);
        for (const m of largeMatches) {
          if (!images.includes(m[1])) {
            images.push(m[1]);
          }
        }
      }
    }
    
    // 方法2: 从 imageGalleryData 提取
    if (images.length === 0) {
      const galleryMatch = html.match(/imageGalleryData'\s*:\s*(\[[\s\S]*?\])/);
      if (galleryMatch) {
        const urlMatches = galleryMatch[1].matchAll(/"(https:\/\/[^"]+\.(?:jpg|png|webp)[^"]*)"/gi);
        for (const m of urlMatches) {
          if (!images.includes(m[1]) && m[1].includes('media-amazon.com')) {
            images.push(m[1]);
          }
        }
      }
    }
    
    // 方法3: 从 landingImage 提取主图
    if (images.length === 0) {
      const landingMatch = html.match(/id="landingImage"[^>]*(?:src|data-old-hires|data-a-dynamic-image)="([^"]+)"/);
      if (landingMatch) {
        let imgUrl = landingMatch[1];
        // 如果是 data-a-dynamic-image，解析 JSON 获取最大图
        if (imgUrl.startsWith('{')) {
          try {
            const imgData = JSON.parse(imgUrl.replace(/&quot;/g, '"'));
            const urls = Object.keys(imgData);
            if (urls.length > 0) imgUrl = urls[0];
          } catch (e) {}
        }
        if (imgUrl.startsWith('http')) images.push(imgUrl);
      }
    }
    
    // 方法4: 从 imgTagWrapperId 区域提取
    if (images.length === 0) {
      const imgTagMatch = html.match(/id="imgTagWrapperId"[\s\S]*?<img[^>]*src="(https:\/\/[^"]+)"/);
      if (imgTagMatch) images.push(imgTagMatch[1]);
    }
    
    // 去重并限制数量
    return [...new Set(images)].slice(0, 10);
  }

  extractBullets(html) {
    const bullets = [];
    
    // 先找到 feature-bullets 区域
    const bulletSection = html.match(/<div[^>]*id="feature-bullets"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i);
    if (bulletSection) {
      const matches = bulletSection[1].matchAll(/<span class="a-list-item">\s*([^<]{10,})\s*<\/span>/g);
      for (const m of matches) {
        const text = m[1].trim();
        // 过滤无效内容
        if (text && 
            text.length < 500 && 
            !text.includes('See more') && 
            !text.includes('{') &&
            !text.includes('_') &&
            !text.startsWith('.')) {
          bullets.push(text);
        }
      }
    }
    
    return bullets.slice(0, 10);
  }

  /**
   * 清理提取的文本内容
   */
  cleanExtractedText(text) {
    if (!text) return '';
    return text
      // 移除 style 标签
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      // 移除 script 标签
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      // 移除 CSS 代码块
      .replace(/#[a-zA-Z_][\w_-]*\s*\{[^}]*\}/g, '')
      .replace(/\.[a-zA-Z_][\w_-]*\s*\{[^}]*\}/g, '')
      // 移除 HTML 标签
      .replace(/<[^>]+>/g, ' ')
      // 移除 JavaScript 代码片段
      .replace(/if\s*\([^)]*\)\s*\{[^}]*\}/g, '')
      .replace(/window\.[a-zA-Z]+/g, '')
      .replace(/function\s*\([^)]*\)/g, '')
      // 移除残留的 CSS 属性
      .replace(/[a-z-]+\s*:\s*[^;]+;/gi, '')
      // 清理多余空白
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 验证描述是否有效（不是推荐商品或其他无效内容）
   */
  isValidDescription(text) {
    if (!text || text.length < 30) return false;
    
    // 排除推荐商品信息的特征
    const invalidPatterns = [
      /Shop the Store/i,
      /out of 5 stars/i,
      /\$\s*\d+\s*\.\s*\d+/,  // 价格格式
      /Typical:\s*\$/i,
      /List:\s*\$/i,
      /Next page/i,
      /P\.when\(/,
      /window\./,
      /celwidget/i,
      /data-csa-c/i,
      /To calculate the overall star rating/i,
      /reviewer bought/i,
      /star rating/i,
    ];
    
    for (const pattern of invalidPatterns) {
      if (pattern.test(text)) return false;
    }
    
    return true;
  }

  extractDescription(html) {
    // 方法1: 从 pqv-description 区域提取（Product Quick View 描述，最精确）
    const pqvMatch = html.match(/<div[^>]*id="pqv-description"[^>]*>[\s\S]*?<div>\s*([\s\S]*?)\s*<\/div>\s*<\/div>/i);
    if (pqvMatch) {
      const desc = this.cleanExtractedText(pqvMatch[1]);
      if (this.isValidDescription(desc)) {
        return desc.substring(0, 2000);
      }
    }
    
    // 方法2: 从 productDescription 内的 p 标签提取
    const descPMatch = html.match(/<div[^>]*id="productDescription"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
    if (descPMatch) {
      const desc = this.cleanExtractedText(descPMatch[1]);
      if (this.isValidDescription(desc)) {
        return desc.substring(0, 2000);
      }
    }
    
    // 方法3: 从 productDescription_feature_div 的第一个 p 标签提取
    const featurePMatch = html.match(/<div[^>]*id="productDescription_feature_div"[^>]*>[\s\S]*?<div[^>]*class="[^"]*a-section[^"]*"[^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/i);
    if (featurePMatch) {
      const desc = this.cleanExtractedText(featurePMatch[1]);
      if (this.isValidDescription(desc)) {
        return desc.substring(0, 2000);
      }
    }
    
    // 方法4: 从 aplus_feature_div 提取 A+ 内容
    const aplusMatch = html.match(/<div[^>]*id="aplus_feature_div"[^>]*>([\s\S]*?)<div[^>]*id="[^"]*_feature_div"/i);
    if (aplusMatch) {
      const desc = this.cleanExtractedText(aplusMatch[1]);
      if (this.isValidDescription(desc)) {
        return desc.substring(0, 2000);
      }
    }
    
    // 方法5: 从 bookDescription 提取（书籍类）
    const bookDescMatch = html.match(/<div[^>]*id="bookDescription_feature_div"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i);
    if (bookDescMatch) {
      const desc = this.cleanExtractedText(bookDescMatch[1]);
      if (this.isValidDescription(desc)) {
        return desc.substring(0, 2000);
      }
    }
    
    // 方法6: 从 detailBullets_feature_div 提取（某些产品的描述在这里）
    const detailBulletsMatch = html.match(/<div[^>]*id="detailBullets_feature_div"[^>]*>([\s\S]*?)<\/div>/i);
    if (detailBulletsMatch) {
      const desc = this.cleanExtractedText(detailBulletsMatch[1]);
      if (this.isValidDescription(desc)) {
        return desc.substring(0, 2000);
      }
    }
    
    return '';
  }

  extractDelivery(html) {
    // 更精确的送达时间提取
    const patterns = [
      // 主要的送达信息区域
      /<span[^>]*id="deliveryMessageMirId"[^>]*>([^<]+)<\/span>/i,
      /<span[^>]*data-csa-c-delivery-time="([^"]+)"/i,
      // 带日期的送达信息
      /(?:Delivery|Arrives|Get it)\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2})/i,
      /(?:Delivery|Arrives|Get it)\s+(\w+,?\s+\w+\s+\d{1,2}\s*-\s*\w+,?\s+\w+\s+\d{1,2})/i,
      // FREE delivery 格式
      /FREE delivery[^<]*?(\w+day,?\s+\w+\s+\d{1,2})/i,
    ];
    
    for (const p of patterns) {
      const match = html.match(p);
      if (match) {
        let result = match[1].trim();
        // 过滤掉 CSS 或无效内容
        if (result.length < 100 && !result.includes('{') && !result.includes('_')) {
          return result;
        }
      }
    }
    
    // 尝试从 delivery block 提取
    const deliveryBlock = html.match(/<div[^>]*id="mir-layout-DELIVERY_BLOCK"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
    if (deliveryBlock) {
      const dateMatch = deliveryBlock[1].match(/((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*,?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2})/i);
      if (dateMatch) return dateMatch[1];
    }
    
    return '';
  }

  /**
   * 检测产品是否不存在（狗狗页面）
   */
  isProductNotFound(html, status) {
    if (status === 404) return true;
    const notFoundPatterns = [
      'looking for something?',
      "we couldn't find that page",
      'the Web address you entered is not a functioning page',
      'dogsofamazon',
      'dogs-hierarchical-702702._TTD_',
      'Try checking the URL for errors',
    ];
    return notFoundPatterns.some(p => html.toLowerCase().includes(p.toLowerCase()));
  }

  isBlocked(html, status) {
    if (status === 503 || status === 429) return true;
    const patterns = ['automated access', 'api-services-support@amazon.com', 'Sorry, we just need to make sure'];
    return patterns.some(p => html.includes(p));
  }

  getProxy(settings) {
    const db = getDb();
    const proxies = db.prepare("SELECT * FROM proxies WHERE status = 'active' ORDER BY id ASC").all();
    if (proxies.length === 0) return null;

    // 按时间轮换检查
    if (settings.proxyRotateByTime > 0) {
      const now = Date.now();
      if (!this.lastProxyRotateTime) {
        this.lastProxyRotateTime = now;
      }
      const elapsed = (now - this.lastProxyRotateTime) / 1000; // 秒
      if (elapsed >= settings.proxyRotateByTime) {
        this.proxyIndex++;
        this.lastProxyRotateTime = now;
        // 重置所有代理的使用次数
        db.prepare('UPDATE proxies SET usageCount = 0').run();
        console.log(`⏱ 按时间轮换代理 (${elapsed.toFixed(0)}秒)`);
      }
    }

    let proxy = proxies[this.proxyIndex % proxies.length];

    // 按次数轮换检查（使用数据库中的 usageCount）
    if (settings.proxyRotateByCount > 0 && proxy.usageCount >= settings.proxyRotateByCount) {
      // 当前代理已达到使用次数，切换到下一个
      this.proxyIndex++;
      // 重置当前代理的使用次数
      db.prepare('UPDATE proxies SET usageCount = 0 WHERE id = ?').run(proxy.id);
      proxy = proxies[this.proxyIndex % proxies.length];
      console.log(`🔄 按次数轮换代理 (已使用${settings.proxyRotateByCount}次)`);
    }

    // 更新使用次数和最后使用时间（usageCount 用于轮换，totalUsageCount 记录总次数）
    db.prepare('UPDATE proxies SET usageCount = usageCount + 1, totalUsageCount = totalUsageCount + 1, lastUsedAt = CURRENT_TIMESTAMP WHERE id = ?').run(proxy.id);
    return proxy.url;
  }

  /**
   * 标记代理成功
   */
  markProxySuccess(proxyUrl) {
    const db = getDb();
    db.prepare('UPDATE proxies SET successCount = successCount + 1 WHERE url = ?').run(proxyUrl);
  }

  /**
   * 强制切换到下一个代理（失败时调用）
   */
  forceNextProxy() {
    this.proxyIndex++;
    console.log(`🔄 强制切换到下一个代理 (index: ${this.proxyIndex})`);
  }

  /**
   * 随机生成浏览器指纹（UA + sec-ch-ua）
   * 遇到验证码时调用 rotateFingerprint() 重新生成
   */
  generateFingerprint() {
    // 随机选择浏览器类型
    const browsers = ['chrome', 'chrome', 'chrome', 'firefox', 'safari']; // Chrome 权重更高
    const browser = browsers[Math.floor(Math.random() * browsers.length)];
    
    // 随机选择操作系统
    const isWindows = Math.random() > 0.3; // 70% Windows
    const platform = isWindows ? '"Windows"' : '"macOS"';
    
    // 随机 Chrome 版本 (118-122)
    const chromeVersion = 118 + Math.floor(Math.random() * 5);
    
    // 随机 Firefox 版本 (118-122)
    const firefoxVersion = 118 + Math.floor(Math.random() * 5);
    
    // 随机 Safari 版本 (16.6-17.2)
    const safariMajor = Math.random() > 0.5 ? 17 : 16;
    const safariMinor = safariMajor === 17 ? Math.floor(Math.random() * 3) : 6;
    
    // 随机 macOS 版本 (10_15_7, 11_0, 12_0, 13_0, 14_0)
    const macVersions = ['10_15_7', '11_0', '12_0', '13_0', '14_0'];
    const macVersion = macVersions[Math.floor(Math.random() * macVersions.length)];
    
    // 随机 Windows 版本
    const winVersions = ['10.0', '11.0'];
    const winVersion = winVersions[Math.floor(Math.random() * winVersions.length)];
    
    let ua, secChUa;
    
    if (browser === 'chrome') {
      if (isWindows) {
        ua = `Mozilla/5.0 (Windows NT ${winVersion}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion}.0.0.0 Safari/537.36`;
      } else {
        ua = `Mozilla/5.0 (Macintosh; Intel Mac OS X ${macVersion}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion}.0.0.0 Safari/537.36`;
      }
      // Chrome 的 sec-ch-ua 格式
      const brands = [
        `"Not_A Brand";v="8", "Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}"`,
        `"Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not?A_Brand";v="24"`,
        `"Chromium";v="${chromeVersion}", "Not)A;Brand";v="99", "Google Chrome";v="${chromeVersion}"`,
      ];
      secChUa = brands[Math.floor(Math.random() * brands.length)];
    } else if (browser === 'firefox') {
      if (isWindows) {
        ua = `Mozilla/5.0 (Windows NT ${winVersion}; Win64; x64; rv:${firefoxVersion}.0) Gecko/20100101 Firefox/${firefoxVersion}.0`;
      } else {
        ua = `Mozilla/5.0 (Macintosh; Intel Mac OS X ${macVersion}; rv:${firefoxVersion}.0) Gecko/20100101 Firefox/${firefoxVersion}.0`;
      }
      secChUa = ''; // Firefox 不发送 sec-ch-ua
    } else {
      // Safari (只在 macOS)
      ua = `Mozilla/5.0 (Macintosh; Intel Mac OS X ${macVersion}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${safariMajor}.${safariMinor} Safari/605.1.15`;
      secChUa = ''; // Safari 不发送 sec-ch-ua
    }
    
    return { ua, secChUa, platform };
  }

  /**
   * 获取当前浏览器指纹（如果没有则生成）
   */
  getRandomFingerprint() {
    if (!this.currentFingerprint) {
      this.currentFingerprint = this.generateFingerprint();
    }
    return this.currentFingerprint;
  }

  /**
   * 强制更换浏览器指纹（遇到验证码时调用）
   */
  rotateFingerprint() {
    this.currentFingerprint = this.generateFingerprint();
    this.fingerprintUsageCount = 0;
    console.log(`🔄 更换浏览器指纹: ${this.currentFingerprint.ua.substring(0, 50)}...`);
  }

  /**
   * 按次数更换指纹
   */
  incrementFingerprintUsage(maxCount) {
    this.fingerprintUsageCount = (this.fingerprintUsageCount || 0) + 1;
    if (this.fingerprintUsageCount >= maxCount) {
      this.rotateFingerprint();
    }
  }

  getRandomUA() {
    return this.getRandomFingerprint().ua;
  }
}
