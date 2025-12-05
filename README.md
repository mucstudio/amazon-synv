# Amazon Scraper v2

基于 Vue 3 + Element Plus + Express + SQLite 的亚马逊商品爬取后台管理系统。

## 功能

- 📊 仪表盘 - 数据统计、快速爬取
- 📋 任务管理 - 创建、取消、重试、删除任务
- 📦 商品数据 - 搜索、筛选、导出 CSV（同一 ASIN 自动覆盖更新）
- 🔗 代理管理 - 添加、测试、删除代理
- 🚫 黑名单管理 - 品牌、卖家、TRO、产品关键词黑名单
- 🔍 扫描任务 - 批量扫描商品匹配黑名单
- ⚙️ 系统设置 - 并发数、请求间隔、代理轮换、验证码处理

## 系统要求

- Node.js >= 18.x
- npm >= 9.x
- Windows / Linux / macOS

## 安装步骤

### 1. 克隆项目

```bash
git clone <repository-url>
cd amazon-scraper-v2
```

### 2. 安装依赖

```bash
npm install
```

> 注意：`better-sqlite3` 需要编译原生模块，Windows 用户需要安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

### 3. 启动服务

**开发模式（推荐调试）：**
```bash
npm run dev
```
- 前端热更新: http://localhost:5173
- 后端 API: http://localhost:3000

**生产模式：**
```bash
npm run build
npm start
```
- 访问: http://localhost:3000

### 4. 首次使用

1. 打开浏览器访问系统
2. 进入「系统设置」配置：
   - Amazon 域名（默认 amazon.com）
   - 邮编（影响价格和配送信息）
   - 并发数（建议 5-10）
   - 请求间隔（建议 1000-2000ms）
3. 可选：添加代理（避免 IP 封禁）
4. 在仪表盘输入 ASIN 开始爬取

## 目录结构

```
amazon-scraper-v2/
├── src/                  # 前端源码 (Vue 3)
│   ├── views/            # 页面组件
│   ├── api/              # API 接口
│   ├── router/           # 路由配置
│   └── App.vue           # 根组件
├── server/               # 后端源码 (Express)
│   ├── routes/           # API 路由
│   ├── services/         # 业务逻辑（爬虫、任务、扫描）
│   └── db/               # 数据库初始化
├── data/                 # 数据目录
│   ├── scraper.db        # SQLite 数据库（自动创建）
│   └── html/             # 保存的 HTML 文件
└── dist/                 # 前端构建输出
```

## 技术栈

- 前端: Vue 3, Element Plus, Vue Router, Axios
- 后端: Express, Better-sqlite3, Playwright（验证码处理）
- 构建: Vite

## 常见问题

### Q: better-sqlite3 安装失败？
A: Windows 需要安装 C++ 编译工具：
```bash
npm install --global windows-build-tools
```
或安装 Visual Studio Build Tools 并选择 "C++ 桌面开发"。

### Q: 遇到验证码怎么办？
A: 系统设置中可配置验证码处理方式：
- `auto`: 自动弹出浏览器，人工完成后继续
- `skip`: 跳过需要验证码的请求
- `retry`: 更换指纹后重试

### Q: 如何避免 IP 封禁？
A: 
1. 添加代理池（支持 HTTP/SOCKS5）
2. 增加请求间隔（建议 2000ms+）
3. 降低并发数（建议 3-5）

### Q: 数据库在哪里？
A: `data/scraper.db`，首次启动自动创建。可直接用 SQLite 工具查看。

## 更新日志

### v2.1
- 同一 ASIN 多次采集自动覆盖更新
- 新增 `updatedAt` 字段记录更新时间
- 修复卖家名称提取错误

### v2.0
- 新增黑名单管理
- 新增扫描任务功能
- 新增库存、卖家、配送天数提取
