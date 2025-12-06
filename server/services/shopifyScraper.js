import { getDb } from '../db/index.js';

/**
 * Shopify 爬取器 - 支持 JSON API 和 HTML 解析
 */
export class ShopifyScraper {
  constructor() {
    this.proxyIndex = 0;
    this.proxyUsageCount = {};
  }

  /**
   * 获取随机 User-Agent
   */
  getRandomUA() {
    const uas = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    ];
    return uas[Math.floor(Math.random() * uas.length)];
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
    const price = firstVariant.price ? `$${firstVariant.price}` : '';
    const comparePrice = firstVariant.compare_at_price ? `$${firstVariant.compare_at_price}` : '';
    
    // 计算总库存
    const totalInventory = product.variants?.reduce((sum, v) => {
      return sum + (v.inventory_quantity || 0);
    }, 0) || 0;

    // 提取所有图片
    const images = product.images?.map(img => img.src) || [];

    // 提取变体信息
    const variants = product.variants?.map(v => ({
      id: v.id,
      title: v.title,
      price: v.price,
      compareAtPrice: v.compare_at_price,
      sku: v.sku,
      inventory: v.inventory_quantity,
      available: v.available,
    })) || [];

    return {
      productId: String(product.id),
      handle: product.handle,
      title: product.title,
      vendor: product.vendor || '',
      productType: product.product_type || '',
      price,
      comparePrice,
      description: this.stripHtml(product.body_html || ''),
      images: JSON.stringify(images),
      image: images[0] || '',
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
