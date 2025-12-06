import { getDb } from '../db/index.js';

/**
 * Shopify 爬取器 - 支持 JSON API 和 HTML 解析
 */
export class ShopifyScraper {
  constructor() {
    this.proxyIndex = 0;
    this.proxyUsageCount = {};
    this.currentUA = null;
    this.uaRequestCount = 0;
  }

  /**
   * User-Agent 列表
   */
  static UA_LIST = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  ];

  /**
   * 获取 User-Agent（根据轮换策略）
   * @param {object} settings - 设置对象
   * @param {boolean} forceRotate - 是否强制轮换（用于"遇错误时轮换"功能）
   */
  getUA(settings = {}, forceRotate = false) {
    const rotate = settings.uaRotate || 'request';
    const rotateCount = settings.uaRotateCount || 10;
    
    // 初始化 UA
    if (!this.currentUA) {
      this.currentUA = ShopifyScraper.UA_LIST[Math.floor(Math.random() * ShopifyScraper.UA_LIST.length)];
    }
    
    let shouldRotate = forceRotate; // 强制轮换优先
    
    if (!shouldRotate) {
      switch (rotate) {
        case 'none':
          // 不轮换，使用固定 UA
          break;
        case 'request':
          // 每次请求都轮换
          shouldRotate = true;
          break;
        case 'count':
          // 按次数轮换
          this.uaRequestCount++;
          if (this.uaRequestCount >= rotateCount) {
            shouldRotate = true;
            this.uaRequestCount = 0;
          }
          break;
      }
    }
    
    if (shouldRotate) {
      this.currentUA = ShopifyScraper.UA_LIST[Math.floor(Math.random() * ShopifyScraper.UA_LIST.length)];
    }
    
    return this.currentUA;
  }

  /**
   * 获取随机 User-Agent（兼容旧接口）
   */
  getRandomUA(useRandom = true) {
    if (!useRandom) {
      return ShopifyScraper.UA_LIST[0];
    }
    return ShopifyScraper.UA_LIST[Math.floor(Math.random() * ShopifyScraper.UA_LIST.length)];
  }

  /**
   * 获取代理（复用 Amazon 爬虫的代理池）
   */
  getProxy(settings) {
    if (!settings.proxyEnabled) return null;
    
    const db = getDb();
    const proxies = db.prepare("SELECT * FROM proxies WHERE status != 'failed' ORDER BY usageCount ASC, lastUsedAt ASC").all();
    
    if (proxies.length === 0) return null;
    
    const proxy = proxies[0];
    
    // 更新使用记录
    db.prepare(`
      UPDATE proxies SET usageCount = usageCount + 1, totalUsageCount = totalUsageCount + 1, lastUsedAt = CURRENT_TIMESTAMP WHERE id = ?
    `).run(proxy.id);
    
    return proxy.url;
  }

  /**
   * 标准化店铺 URL
   */
  normalizeStoreUrl(url) {
    let normalized = url.trim().toLowerCase();
    
    // 移除协议
    normalized = normalized.replace(/^https?:\/\//, '');
    // 移除末尾斜杠
    normalized = normalized.replace(/\/+$/, '');
    // 移除 www
    normalized = normalized.replace(/^www\./, '');
    
    return normalized;
  }


  /**
   * 测试店铺连接，检测是否支持 JSON API
   */
  async testStore(storeUrl, settings = {}) {
    const domain = this.normalizeStoreUrl(storeUrl);
    const baseUrl = `https://${domain}`;
    
    const headers = {
      'User-Agent': this.getRandomUA(),
      'Accept': 'application/json',
    };

    const fetchOptions = { headers };

    // 代理支持
    if (settings.proxyEnabled) {
      const proxyUrl = this.getProxy(settings);
      if (proxyUrl) {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        fetchOptions.agent = new HttpsProxyAgent(proxyUrl);
      }
    }

    try {
      // 尝试访问 JSON API
      const jsonUrl = `${baseUrl}/products.json?limit=1`;
      const response = await fetch(jsonUrl, { ...fetchOptions, timeout: 15000 });
      
      if (response.ok) {
        const data = await response.json();
        if (data.products) {
          return {
            success: true,
            apiSupported: true,
            storeName: domain,
            message: 'JSON API 可用',
          };
        }
      }
      
      // JSON API 不可用，尝试访问首页
      const homeResponse = await fetch(baseUrl, { ...fetchOptions, timeout: 15000 });
      if (homeResponse.ok) {
        const html = await homeResponse.text();
        // 检测是否是 Shopify 店铺
        const isShopify = html.includes('Shopify.') || 
                          html.includes('cdn.shopify.com') ||
                          html.includes('myshopify.com');
        
        if (isShopify) {
          return {
            success: true,
            apiSupported: false,
            storeName: domain,
            message: 'Shopify 店铺，但 JSON API 不可用，将使用 HTML 解析',
          };
        }
      }
      
      return {
        success: false,
        message: '无法识别为 Shopify 店铺',
      };
    } catch (error) {
      return {
        success: false,
        message: `连接失败: ${error.message}`,
      };
    }
  }

  /**
   * 获取店铺所有商品列表（通过 JSON API）
   */
  async fetchProductList(storeUrl, settings = {}, page = 1, limit = 250) {
    const domain = this.normalizeStoreUrl(storeUrl);
    const url = `https://${domain}/products.json?limit=${limit}&page=${page}`;
    
    const headers = {
      'User-Agent': this.getRandomUA(),
      'Accept': 'application/json',
    };

    const fetchOptions = { headers };

    if (settings.proxyEnabled) {
      const proxyUrl = this.getProxy(settings);
      if (proxyUrl) {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        fetchOptions.agent = new HttpsProxyAgent(proxyUrl);
      }
    }

    try {
      const response = await fetch(url, fetchOptions);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      return {
        success: true,
        products: data.products || [],
        hasMore: (data.products || []).length === limit,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        products: [],
      };
    }
  }

  /**
   * 获取单个商品详情（通过 JSON API）
   */
  async fetchProduct(storeUrl, handle, settings = {}) {
    const domain = this.normalizeStoreUrl(storeUrl);
    const url = `https://${domain}/products/${handle}.json`;
    
    const headers = {
      'User-Agent': this.getRandomUA(),
      'Accept': 'application/json',
    };

    const fetchOptions = { headers };

    if (settings.proxyEnabled) {
      const proxyUrl = this.getProxy(settings);
      if (proxyUrl) {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        fetchOptions.agent = new HttpsProxyAgent(proxyUrl);
      }
    }

    try {
      const response = await fetch(url, fetchOptions);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('PRODUCT_NOT_FOUND');
        }
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      return this.parseProductJson(data.product, domain);
    } catch (error) {
      throw error;
    }
  }


  /**
   * 解析 JSON 格式的商品数据
   */
  parseProductJson(product, storeDomain) {
    if (!product) return null;

    // 获取第一个可用变体的价格
    const firstVariant = product.variants?.[0] || {};
    const price = firstVariant.price ? `${firstVariant.price}` : '';
    const comparePrice = firstVariant.compare_at_price ? `${firstVariant.compare_at_price}` : '';
    
    // 计算总库存
    const totalInventory = product.variants?.reduce((sum, v) => {
      return sum + (v.inventory_quantity || 0);
    }, 0) || 0;

    // 提取所有图片（包含图片ID用于变体图片映射）
    const images = product.images?.map(img => ({
      id: img.id,
      src: img.src,
      position: img.position,
      alt: img.alt || '',
    })) || [];
    const imageUrls = images.map(img => img.src);

    // 提取属性定义（options）- 用于 WooCommerce 变体同步
    const options = product.options?.map(opt => ({
      name: opt.name,
      position: opt.position,
      values: opt.values || [],
    })) || [];

    // 提取变体信息（包含完整的 option1/2/3）
    const variants = product.variants?.map(v => ({
      id: v.id,
      title: v.title,
      price: v.price,
      compareAtPrice: v.compare_at_price,
      sku: v.sku,
      barcode: v.barcode || '',
      inventory: v.inventory_quantity,
      available: v.available,
      option1: v.option1 || null,
      option2: v.option2 || null,
      option3: v.option3 || null,
      weight: v.weight || 0,
      weightUnit: v.weight_unit || 'kg',
      imageId: v.image_id || null,
      requiresShipping: v.requires_shipping,
      taxable: v.taxable,
    })) || [];

    return {
      productId: String(product.id),
      handle: product.handle,
      title: product.title,
      vendor: product.vendor || '',
      productType: product.product_type || '',
      price,
      comparePrice,
      descriptionHtml: product.body_html || '',
      description: this.stripHtml(product.body_html || ''),
      images: JSON.stringify(imageUrls),
      imagesData: JSON.stringify(images),
      image: imageUrls[0] || '',
      options: JSON.stringify(options),
      variants: JSON.stringify(variants),
      variantCount: variants.length,
      totalInventory,
      tags: product.tags?.join(', ') || '',
      createdAt: product.created_at,
      updatedAt: product.updated_at,
      url: `https://${storeDomain}/products/${product.handle}`,
      storeDomain,
    };
  }

  /**
   * 移除 HTML 标签
   */
  stripHtml(html) {
    if (!html) return '';
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 从 HTML 页面获取商品详细信息（材质、产地、尺码建议等）
   * @param {string} productUrl - 商品 URL
   * @param {object} settings - 设置对象
   * @param {boolean} isRetry - 是否为重试请求（用于 error 模式 UA 轮换）
   */
  async fetchProductDetails(productUrl, settings = {}, isRetry = false) {
    const timeout = settings.timeout || 30000;
    
    const headers = {
      'User-Agent': this.getUA(settings, isRetry),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache',
    };

    const fetchOptions = { 
      headers,
      signal: AbortSignal.timeout(timeout),
    };

    if (settings.proxyEnabled) {
      const proxyUrl = this.getProxy(settings);
      if (proxyUrl) {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        fetchOptions.agent = new HttpsProxyAgent(proxyUrl);
      }
    }

    try {
      const response = await fetch(productUrl, fetchOptions);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const html = await response.text();
      
      // 解析详细描述（材质、产地等）
      const detailedDescription = this.parseProductDetails(html);
      
      // 解析尺码建议
      const sizeAndFit = this.parseSizeAndFit(html);
      
      return {
        success: true,
        detailedDescription,
        sizeAndFit,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 从 HTML 解析产品详细规格
   */
  parseProductDetails(html) {
    // 尝试多种常见的 Shopify 模板结构
    const patterns = [
      // Victoria Beckham 风格
      /class="product__details"[^>]*><li>(.*?)<\/ul>/gs,
      // 通用 accordion 风格
      /data-ga-el="productDetailsDescription"[^>]*>.*?<ul[^>]*>(.*?)<\/ul>/gs,
      // 其他常见结构
      /class="product-description"[^>]*>(.*?)<\/div>/gs,
      /id="product-description"[^>]*>(.*?)<\/div>/gs,
    ];

    for (const pattern of patterns) {
      const matches = [...html.matchAll(pattern)];
      if (matches.length > 0) {
        // 找到包含材质信息的匹配
        for (const match of matches) {
          const content = match[1] || match[0];
          // 检查是否包含典型的产品规格关键词
          if (/viscose|cotton|polyester|silk|wool|made in|fabrication|material/i.test(content)) {
            // 清理 HTML 标签，保留列表结构
            const cleaned = content
              .replace(/<li[^>]*>/gi, '\n• ')
              .replace(/<\/li>/gi, '')
              .replace(/<[^>]+>/g, '')
              .replace(/[ \t]+/g, ' ')  // 只替换空格和制表符，保留换行
              .replace(/\n\s+/g, '\n')  // 清理换行后的空白
              .trim();
            return cleaned;
          }
        }
      }
    }

    return '';
  }

  /**
   * 从 HTML 解析尺码建议
   */
  parseSizeAndFit(html) {
    const patterns = [
      // Size & Fit accordion
      /data-ga-variable-title="Size &amp; Fit"[^>]*>.*?<ul[^>]*class="product__details"[^>]*>(.*?)<\/ul>/gs,
      /class="size-and-fit"[^>]*>(.*?)<\/div>/gs,
      /id="size-fit"[^>]*>(.*?)<\/div>/gs,
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(html);
      if (match) {
        const content = match[1] || match[0];
        const cleaned = content
          .replace(/<li[^>]*>/gi, '\n• ')
          .replace(/<\/li>/gi, '')
          .replace(/<[^>]+>/g, '')
          .replace(/[ \t]+/g, ' ')  // 只替换空格和制表符，保留换行
          .replace(/\n\s+/g, '\n')  // 清理换行后的空白
          .trim();
        if (cleaned.length > 10) {
          return cleaned;
        }
      }
    }

    return '';
  }

  /**
   * 获取店铺所有集合（Collections）
   */
  async fetchCollections(storeUrl, settings = {}) {
    const domain = this.normalizeStoreUrl(storeUrl);
    const url = `https://${domain}/collections.json`;
    
    const headers = {
      'User-Agent': this.getRandomUA(),
      'Accept': 'application/json',
    };

    const fetchOptions = { headers };

    if (settings.proxyEnabled) {
      const proxyUrl = this.getProxy(settings);
      if (proxyUrl) {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        fetchOptions.agent = new HttpsProxyAgent(proxyUrl);
      }
    }

    try {
      const response = await fetch(url, fetchOptions);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      const collections = (data.collections || []).map(c => ({
        collectionId: String(c.id),
        handle: c.handle,
        title: c.title,
        description: this.stripHtml(c.body_html || ''),
        image: c.image?.src || '',
        publishedAt: c.published_at,
        updatedAt: c.updated_at,
      }));
      
      return {
        success: true,
        collections,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        collections: [],
      };
    }
  }

  /**
   * 获取某个集合下的商品列表
   */
  async fetchCollectionProducts(storeUrl, collectionHandle, settings = {}, page = 1, limit = 250) {
    const domain = this.normalizeStoreUrl(storeUrl);
    const url = `https://${domain}/collections/${collectionHandle}/products.json?limit=${limit}&page=${page}`;
    
    const headers = {
      'User-Agent': this.getRandomUA(),
      'Accept': 'application/json',
    };

    const fetchOptions = { headers };

    if (settings.proxyEnabled) {
      const proxyUrl = this.getProxy(settings);
      if (proxyUrl) {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        fetchOptions.agent = new HttpsProxyAgent(proxyUrl);
      }
    }

    try {
      const response = await fetch(url, fetchOptions);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      return {
        success: true,
        products: data.products || [],
        hasMore: (data.products || []).length === limit,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        products: [],
      };
    }
  }

  /**
   * 爬取某个集合下的所有商品
   */
  async scrapeCollection(storeId, collectionId, settings = {}, onProgress = null) {
    const db = getDb();
    const store = db.prepare('SELECT * FROM shopify_stores WHERE id = ?').get(storeId);
    const collection = db.prepare('SELECT * FROM shopify_collections WHERE id = ?').get(collectionId);
    
    if (!store) {
      throw new Error('店铺不存在');
    }
    if (!collection) {
      throw new Error('集合不存在');
    }

    const results = {
      total: 0,
      success: 0,
      failed: 0,
      products: [],
      collectionId,
    };

    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const listResult = await this.fetchCollectionProducts(store.domain, collection.handle, settings, page, 250);
      
      if (!listResult.success) {
        console.error(`获取集合商品列表失败 (page ${page}):`, listResult.error);
        break;
      }

      for (const product of listResult.products) {
        try {
          const parsed = this.parseProductJson(product, store.domain);
          if (parsed) {
            parsed.collectionId = collectionId;
            results.products.push(parsed);
            results.success++;
          }
        } catch (e) {
          results.failed++;
        }
        results.total++;
        
        if (onProgress) {
          onProgress(results);
        }
      }

      hasMore = listResult.hasMore;
      page++;

      // 请求间隔
      if (hasMore && settings.requestDelay) {
        await new Promise(resolve => setTimeout(resolve, settings.requestDelay));
      }
    }

    return results;
  }

  /**
   * 爬取店铺所有商品
   */
  async scrapeStore(storeId, settings = {}, onProgress = null) {
    const db = getDb();
    const store = db.prepare('SELECT * FROM shopify_stores WHERE id = ?').get(storeId);
    
    if (!store) {
      throw new Error('店铺不存在');
    }

    const results = {
      total: 0,
      success: 0,
      failed: 0,
      products: [],
    };

    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const listResult = await this.fetchProductList(store.domain, settings, page, 250);
      
      if (!listResult.success) {
        console.error(`获取商品列表失败 (page ${page}):`, listResult.error);
        break;
      }

      for (const product of listResult.products) {
        try {
          const parsed = this.parseProductJson(product, store.domain);
          if (parsed) {
            results.products.push(parsed);
            results.success++;
          }
        } catch (e) {
          results.failed++;
        }
        results.total++;
        
        if (onProgress) {
          onProgress(results);
        }
      }

      hasMore = listResult.hasMore;
      page++;

      // 请求间隔
      if (hasMore && settings.requestDelay) {
        await new Promise(resolve => setTimeout(resolve, settings.requestDelay));
      }
    }

    return results;
  }
}
