import { getDb } from '../db/index.js';

/**
 * 黑名单匹配器 - 高效匹配商品与黑名单
 */
export class BlacklistMatcher {
  constructor() {
    this.index = {
      brand: new Set(),
      product: new Set(),
      tro: new Set(),
      seller: new Set()
    };
    this.loaded = false;
  }

  /**
   * 解码 HTML 实体（支持多种格式）
   * @param {string} text - 要解码的文本
   * @returns {string} 解码后的文本
   */
  decodeHtmlEntities(text) {
    if (!text) return '';
    return text
      // 十六进制格式: &#x27; -> '
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
      // 十进制格式: &#39; -> '
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
      // 命名实体
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      // 处理可能的双重编码
      .replace(/&amp;#/g, '&#');
  }

  /**
   * 标准化文本（解码 + 小写 + 去除多余空格）
   * @param {string} text - 要标准化的文本
   * @returns {string} 标准化后的文本
   */
  normalizeText(text) {
    if (!text) return '';
    return this.decodeHtmlEntities(text).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * 从数据库加载黑名单到内存索引
   */
  loadBlacklist() {
    const db = getDb();
    const keywords = db.prepare('SELECT keyword, type FROM blacklist').all();
    
    // 清空现有索引
    this.index.brand.clear();
    this.index.product.clear();
    this.index.tro.clear();
    this.index.seller.clear();
    
    // 构建索引（解码 + 小写化）
    for (const { keyword, type } of keywords) {
      const normalizedKeyword = this.normalizeText(keyword);
      if (normalizedKeyword && this.index[type]) {
        this.index[type].add(normalizedKeyword);
      }
    }
    
    this.loaded = true;
    console.log(`黑名单已加载: brand=${this.index.brand.size}, product=${this.index.product.size}, tro=${this.index.tro.size}, seller=${this.index.seller.size}`);
  }

  /**
   * 匹配文本，返回命中的关键词数组
   * @param {string} text - 要匹配的文本
   * @param {string} type - 黑名单类型 (brand/product/tro/seller)
   * @returns {string[]} 命中的关键词数组
   */
  matchText(text, type) {
    if (!this.loaded) {
      this.loadBlacklist();
    }
    
    if (!text || !this.index[type]) {
      return [];
    }
    
    // 使用 normalizeText 对输入文本进行标准化（解码 HTML 实体 + 小写 + 去除多余空格）
    const normalizedText = this.normalizeText(text);
    const matched = [];
    
    for (const keyword of this.index[type]) {
      if (normalizedText.includes(keyword)) {
        matched.push(keyword);
      }
    }
    
    return matched;
  }

  /**
   * 从商品属性中提取 Brand 字段
   * @param {Object} product - 商品对象
   * @returns {string} Brand 值
   */
  extractBrandFromAttributes(product) {
    if (!product.attributes) return '';
    
    try {
      const attrs = typeof product.attributes === 'string' 
        ? JSON.parse(product.attributes) 
        : product.attributes;
      
      // 查找 Brand 字段（不区分大小写）
      for (const [key, value] of Object.entries(attrs)) {
        if (key.toLowerCase() === 'brand') {
          return value || '';
        }
      }
    } catch (e) {
      // 解析失败，返回空
    }
    
    return '';
  }

  /**
   * 匹配单个商品，返回完整匹配结果
   * @param {Object} product - 商品对象
   * @returns {Object} 匹配结果
   */
  match(product) {
    if (!this.loaded) {
      this.loadBlacklist();
    }
    
    // 合并商品文本内容（标题 + 五点描述 + 描述）
    let bulletText = '';
    if (product.bulletPoints) {
      try {
        const bullets = typeof product.bulletPoints === 'string' 
          ? JSON.parse(product.bulletPoints) 
          : product.bulletPoints;
        bulletText = Array.isArray(bullets) ? bullets.join(' ') : '';
      } catch (e) {
        bulletText = product.bulletPoints || '';
      }
    }
    
    const searchText = [
      product.title || '',
      bulletText,
      product.description || ''
    ].join(' ');
    
    // 提取商品属性中的 Brand 字段
    const brandFromAttrs = this.extractBrandFromAttributes(product);
    
    // 品牌匹配：标题 + 五点描述 + 描述 + 属性中的 Brand
    const brandSearchText = searchText + ' ' + brandFromAttrs;
    const matchedBrand = this.matchText(brandSearchText, 'brand');
    
    // 其他类型只匹配标题 + 五点描述 + 描述
    const matchedProduct = this.matchText(searchText, 'product');
    const matchedTro = this.matchText(searchText, 'tro');
    const matchedSeller = this.matchText(product.sellerName || '', 'seller');
    
    const hasViolation = matchedBrand.length > 0 || 
                         matchedProduct.length > 0 || 
                         matchedTro.length > 0 || 
                         matchedSeller.length > 0;
    
    return {
      brand: matchedBrand,
      product: matchedProduct,
      tro: matchedTro,
      seller: matchedSeller,
      hasViolation
    };
  }

  /**
   * 获取索引统计
   */
  getStats() {
    return {
      brand: this.index.brand.size,
      product: this.index.product.size,
      tro: this.index.tro.size,
      seller: this.index.seller.size,
      total: this.index.brand.size + this.index.product.size + this.index.tro.size + this.index.seller.size
    };
  }
}
