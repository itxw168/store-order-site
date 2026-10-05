# Haven Shop ✨ 小商店在线点单 / 商品画册系统

面向**海外市场小微商店**的通用型在线点单与商品展示网站 —— 一套代码适配**任何品类**（二次元周边、饰品、美妆、服饰、手作、餐饮菜单……），可直接**替代传统纸质画册点单**：顾客打开一个链接即可浏览商品、查看价格与库存，并通过 **WhatsApp 直接下单**。

**核心亮点**

- 🏪 **通用不挑行业**：分类、商品、文案、配色全部可在后台自由配置
- 📖 **替代传统画册**：改价 / 上新即时生效，无需重印；一个链接 = 一本随时更新的电子画册
- ☁️ **无需服务器**：零构建、零运行时依赖，全托管于 Cloudflare（Pages + Functions + D1 + R2），免费额度即可满足小店日常
- 📣 **社交分享开箱即用**：内置 Open Graph / Twitter Card，链接粘贴到 **WhatsApp / Instagram / X (Twitter)** 即自动生成图文预览卡片
- 🛠 **可自由二开**：MIT 协议，纯原生 HTML / JS 单文件结构，不用构建工具也能改
- 🌐 **多语言**：前台默认西班牙语（墨西哥）、后台中文，字典可扩展；货币默认 MXN，可二开替换

> 前台以西语（墨西哥）为主、中文为辅；后台以中文为主、西语为辅。全站统一货币：墨西哥比索（MXN）。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![Haven Shop](og-image.jpg)

---

## 🔗 在线演示

| 入口 | 地址 | 说明 |
|---|---|---|
| 🌐 前台（顾客端） | **https://demo.itxw.asia/** | 西语 / 中文切换、分类浏览、实时搜索、分享卡片 |
| 🛠 后台管理 | **https://demo.itxw.asia/admin/** | 体验密码：`have@2026` |

> ⚠️ 演示后台为公开体验环境，请勿恶意修改或删除演示数据。

---

## ✨ 功能特性

### 前台（`index.html` + `catalogo.html`）
- 首页：Hero、树形分类导航、商品网格、预售专区、本周销量 TOP3、社区好评、社区入口、客服/门店信息
- 「全部商品目录」独立页，支持搜索词跨页传递
- 无限级树形分类（分组节点 / 叶子节点），分组自动递归聚合子分类商品
- 实时搜索（SKU / 西语名 / 中文名）、商品详情弹窗（大图 + 复制 SKU）
- 库存三档徽章（充足 / 紧张 / 售罄）、新品/热卖/限定角标
- 中/西双语切换，API 失败自动回退内置演示数据（15s 超时保护）
- 移动端适配（刘海屏安全区、分类 chips 横向滚动、响应式网格）
- 社交分享：内置 OG / Twitter Card 元数据，WhatsApp / Instagram / X (Twitter) 粘贴链接自动生成图文卡片

### 后台（`admin/index.html`，单文件 SPA）
- 登录鉴权（时序安全比较 + 7 天 JWT-lite Token）
- 数据总览：今日 / 本周 / 本月 / 近 7 日 / 近 30 日 销量·销售额·利润 + 库存预警
- 商品管理：CRUD、分页搜索、批量删除、上下架、R2 图片上传（预签名直传 + 中转兜底）
- 分类管理：无限级树形表格、展开折叠、层级校验、编码自动生成
- 库存盘点：5 个快捷动作（卖 1 件 / 备注销售 / +入库 1 / 备注入库 / 校正）、批量出入库向导、负库存拦截
- 销售流水：分页查询、时间范围筛选、批量清理、CSV 导出
- 站点内容：预售专区、TOP3 榜单（自动/手动）、社区好评、社区入口、客服与门店信息配置
- 商品画册：按分类生成 A4 打印版画册（可直接打印 / 导出 PDF）
- 系统信息：R2 存储统计、孤立图片清理（dryRun）、一键全库 JSON 备份

### 后端（Cloudflare Pages Functions）
- 无状态 JWT-lite 鉴权（HMAC-SHA256 + WebCrypto，零 npm 依赖）
- 统一中间件：CORS、`/api/admin/*` Token 拦截、全局异常统一 JSON 化
- 公开 API：分类、商品、站点设置、销量榜单
- 图片：R2 预签名直传优先，Functions 中转上传兜底（≤8MB，MIME 白名单）

---

## 🏗 技术架构

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | 原生 HTML5 + Vanilla JS + Tailwind CSS (Play CDN) | 无框架、无构建步骤 |
| 后端 | Cloudflare Pages Functions | 原生 ES Module，`functions/` 目录自动路由 |
| 数据库 | Cloudflare D1（SQLite） | `migrations/` 按编号顺序迁移 |
| 存储 | Cloudflare R2 | 图片对象存储 + 预签名直传 |
| 依赖 | 仅 devDependency `acorn`（本地 JS 语法检查） | 无运行时依赖 |

```
请求 → Pages 静态资源（index.html / catalogo.html / admin/）
     → functions/_middleware.js（CORS + 鉴权 + 异常兜底）
     → functions/api/*（业务处理）
     → D1（数据） + R2（图片）
```

---

## 🚀 本地开发

**前置要求**：Node.js 18+、npm、Cloudflare 账号（`wrangler` 会按需 `npx` 调用）。

```bash
# 1. 安装本地开发依赖（仅 acorn，可选）
npm install

# 2. 应用本地数据库迁移（首次）
npx wrangler d1 migrations apply haven-db --local

# 3. 配置本地密钥（至少需要管理员密码）
#    新建 .dev.vars 文件：
#    ADMIN_PASSWORD=your-password

# 4. 启动本地开发服务器（含 Functions + 本地 D1/R2 模拟）
npx wrangler pages dev . --local
```

访问：

| 地址 | 说明 |
|---|---|
| http://localhost:8788/ | 前台首页 |
| http://localhost:8788/catalogo | 全部商品目录 |
| http://localhost:8788/admin/ | 后台管理 |
| http://localhost:8788/ping | 绑定状态自检 |

**内联 JS 语法检查**（提交前建议执行）：

```bash
node scripts/check-inline-js.mjs
```

---

## ☁️ 部署到 Cloudflare Pages

1. **创建资源**
   ```bash
   npx wrangler d1 create haven-db        # 记录返回的 database_id
   npx wrangler r2 bucket create haven-shop-imgs
   ```
2. **填写配置**：把 `wrangler.toml` 中的占位符替换为你的真实值：
   - `database_id` → 上一步返回的 D1 ID
   - `bucket_name` → 你的 R2 桶名
   - `R2_PUBLIC_PREFIX` → R2 公网访问域名（如 `https://img.example.com/`）
3. **执行生产迁移**：`npx wrangler d1 migrations apply haven-db --remote`
4. **设置管理员密码**：`npx wrangler pages secret put ADMIN_PASSWORD -e production`
5. **部署**：`npx wrangler pages deploy . --project-name=<你的项目名> --branch=main`
6. **验证**：访问 `https://<你的域名>/ping` 确认 D1 / R2 / 环境变量绑定全部正常

> 详细部署流程、自定义域名、缓存策略、故障排查见 [项目技术文档.md](项目技术文档.md)。

---

## 📁 目录结构

| 路径 | 说明 |
|---|---|
| `index.html` | 前台首页（西语默认） |
| `catalogo.html` | 全部商品目录页 |
| `admin/index.html` | 后台管理 SPA（单文件） |
| `functions/_middleware.js` | 全局中间件（CORS / 鉴权 / 异常兜底） |
| `functions/_utils.js` | 工具库（响应构造 / JWT-lite / R2 URL / SKU 生成） |
| `functions/api/*` | 公开 API（分类 / 商品 / 设置 / 榜单） |
| `functions/api/admin/*` | 管理 API（登录 / 商品 / 分类 / 库存 / 设置 / 上传） |
| `migrations/*.sql` | D1 数据库迁移脚本 |
| `scripts/*.mjs` | 本地开发辅助脚本（迁移 / 种子数据 / JS 语法检查） |
| `项目技术文档.md` | 完整技术文档（架构 / API / 部署 / 排障） |
| `_headers` / `_redirects` | Cloudflare Pages 缓存头与路由配置 |
| `wrangler.toml` | Cloudflare 绑定配置（需替换占位符） |

---

## 🔌 API 概览

| 接口 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/ping` | GET | — | 绑定状态自检 |
| `/api/categories` | GET | — | 公开分类（`?includeStats=1` 附商品数） |
| `/api/products` | GET | — | 公开商品（分类 / 关键词 / 分页） |
| `/api/settings` | GET | — | 公开站点设置 |
| `/api/top-sales` | GET | — | 本周销量 TOP3 榜单 |
| `/api/admin/login` | POST | — | 管理员登录 |
| `/api/admin/products` | POST | Bearer | 商品管理（list/get/create/update/delete/toggleActive/genSku） |
| `/api/admin/categories` | POST | Bearer | 分类管理（树形 CRUD / 编码生成 / 移动） |
| `/api/admin/stock` | POST | Bearer | 库存调整 / 流水 / 统计 / CSV 导出 |
| `/api/admin/settings` | POST | Bearer | 系统设置 / 存储统计 / 孤图清理 / 备份 |
| `/api/admin/upload-sign` | POST | Bearer | R2 预签名上传 |
| `/api/admin/upload/:key` | PUT / DELETE | Bearer | 中转上传 / 删除图片 |

统一响应结构：`{ ok: true, data, message }` 或 `{ ok: false, error, code }`。

---

## 🛠 二次开发指南

本项目刻意保持 **零构建 + 纯原生代码**，任何人都可以按需改造后自用或商用（MIT 协议）：

| 想改什么 | 改哪里 |
|---|---|
| 店铺名 / 文案 / 多语言字典 | `index.html` / `catalogo.html` / `admin/index.html` 内的 `I18N` 字典 |
| 主题配色 / 字体 | 各页面 `<head>` 中的 `tailwind.config` 色板 + 内联 `<style>` |
| 分类与商品数据 | 后台「分类管理 / 商品管理」可视化维护，或直接操作 D1 |
| 首页模块（预售 / 榜单 / 好评 / 客服） | 后台「站点内容」面板可视化配置 |
| 货币单位（默认 MXN） | 前端与 `functions/` 中按 `price_mxn` / `MXN` 全局替换 |
| 后端接口行为 | `functions/` 下对应文件（原生 ES Module，改完直接部署） |
| 数据库结构 | `migrations/` 新增编号 SQL（如 `009_xxx.sql`） |

> 修改后执行 `node scripts/check-inline-js.mjs` 做一次内联 JS 语法自检，再部署即可。

---

## 📄 开源协议

[MIT License](LICENSE) © 2026 itxwTeam · https://itxw.cc/

> 注：`migrations/` 中内置的演示商品数据（含第三方 IP 名称）仅用于功能演示，正式使用请替换为你自己的商品数据。

---

## English Overview

**Haven Shop** is an online ordering / product-catalog website for **small stores worldwide** — suitable for **any product category** and a drop-in replacement for traditional printed catalogs. Customers open a single link to browse products, check prices & stock, and order directly via **WhatsApp**.

It requires **no server of your own**: build-free, dependency-free, and fully hosted on **Cloudflare's serverless stack — Pages + Functions + D1 + R2** (the free tier is enough for small shops).

**Highlights**
- Works for any store type; categories, products, copy and theme are fully configurable from the admin panel
- Share-ready: Open Graph / Twitter Card built in — paste the link into WhatsApp, Instagram or X (Twitter) to get a rich preview card
- Bilingual storefront (Spanish-MX default / Chinese), tree categories, product search, presale section, weekly TOP3, reviews & contact sections
- Single-file admin SPA: dashboard, products, categories, inventory & sales logs, site content, printable A4 catalog, storage tools & JSON backup
- Stateless JWT-lite auth (HMAC-SHA256 via WebCrypto), unified JSON API, R2 presigned direct upload
- MIT licensed and easy to fork & customize (no build step)

**Live demo**: [Storefront](https://demo.itxw.asia/) · [Admin panel](https://demo.itxw.asia/admin/) (demo password: `have@2026`)

**Quick start**: `npm install` → `npx wrangler d1 migrations apply haven-db --local` → create `.dev.vars` with `ADMIN_PASSWORD=...` → `npx wrangler pages dev . --local`.

**Deploy**: fill placeholders in `wrangler.toml` (`database_id` / `bucket_name` / `R2_PUBLIC_PREFIX`), run remote migrations, set the `ADMIN_PASSWORD` secret, then `npx wrangler pages deploy`.

Licensed under [MIT](LICENSE) © 2026 itxwTeam.