# 4kvms.com 接口逆向分析与二次开发指南

> 本文档是对 `https://www.4kvms.com/` 的完整接口逆向分析，涵盖站点结构、播放源签名机制、各 API 请求/响应规范、分类码全表及二次开发示例，供后续开发参考。

---

## 目录

1. [站点概览](#1-站点概览)
2. [URL 路由结构](#2-url-路由结构)
3. [核心：播放源签名机制](#3-核心播放源签名机制)
4. [接口详解](#4-接口详解)
5. [分类码全表（taxonomy）](#5-分类码全表taxonomy)
6. [数据结构参考](#6-数据结构参考)
7. [二次开发指南](#7-二次开发指南)
8. [已知限制与注意事项](#8-已知限制与注意事项)
9. [关键文件清单](#9-关键文件清单)

---

## 1. 站点概览

| 项目 | 信息 |
|------|------|
| 站点名称 | 4k影视 |
| 主域名 | `https://www.4kvms.com/` |
| 备用域名 | `https://4kvm.site` |
| 弹幕 API | `https://4k.dmservce.org/api/v1/danmuku` |
| 视频流 CDN | `oss.douyinbit.com`（m3u8）、`dc.xhscdn.com`（分片，.png 伪装） |
| 前端框架 | Alpine.js + Artplayer + hls.js |
| 播放签名 | WebAssembly 模块（Rust/wasm-bindgen） |
| 服务端 | nginx，`Vary: Cookie` |

### 页面板块
首页包含：轮播推荐、今天热播、榜单排行、最近更新、人气排行榜、最新上架、近期热播剧、VIP影片、推荐片单、本季跟播新番、即将上映。

### 影片标签体系
- **画质**：4K、4k 4K播放
- **权限**：VIP、VIP 4k
- **状态**：独家、最新番、爽剧
- **更新**：全XX集（完结）、更新至XX集（连载）

---

## 2. URL 路由结构

| 路径 | 说明 |
|------|------|
| `/` | 首页（板块+列表） |
| `/filter?classify=&types=&areas=&years=&tags=&page=` | 筛选列表（浏览核心入口） |
| `/search?q=<关键字>` | 搜索 |
| `/play/<playId>` | 详情+播放页（playId 形如 `cgzq7f3tf`、`ch47wchlp`） |
| `/playlist/<id>` | 片单详情 |
| `/playlists` | 片单列表 |
| `/richlist` | 富豪榜 |
| `/movie` `/tv` `/anime` | 分类入口（等价 `/filter?classify=1/2/3`，但不支持 page 参数翻页，实际翻页须用 `/filter`） |
| `/register` `/forgot-password` `/login` | 用户相关 |
| `/video-test` | 播放检测 |
| `/page/4kshiplay` | 4K播放教程 |

> **注意**：`/movie`、`/tv`、`/anime` 是固定分类页，**不支持 `?page=` 翻页**（返回相同内容）。真正的可分页浏览必须用 `/filter?classify=X&page=N`。

---

## 3. 核心：播放源签名机制

这是整个逆向的关键。网站的播放源地址无法直接请求，必须通过 WebAssembly 模块对参数签名后，才能换取真实的 m3u8 地址。

### 3.1 签名流程

```
页面 HTML
  ├── <meta id="nb-st" content="1782224393225">     ← 签名 nonce（每次请求页面会变）
  └── x-data="...userlink:'X1VVXURfXQIDBw4FCgc7IUlZU0k='..."  ← 匿名访问令牌
                                        ↓
wasm.build_play_url(dataid, playId, quality, userlink)
                                        ↓
生成带签名的 URL：
  /video/play?p=<dataid>&v=<playId>&q=<quality>&s=<md5签名>&t=<时间戳>&k=<userlink>
                                        ↓
fetch 该 URL → 返回 JSON { code, data:{ quality_urls:[{url}] } }
                                        ↓
quality_urls[].url 即为 m3u8 地址
```

### 3.2 签名参数说明

| 参数 | 来源 | 示例 | 说明 |
|------|------|------|------|
| `p` (dataid) | 详情页每集的 `dataid` 属性 | `1551` | 数字 ID，每集不同 |
| `v` (playId) | URL 路径 `/play/<playId>` | `cgzq7f3tf` | 字符串 ID，每集不同 |
| `q` (quality) | 固定值 | `1080` | 清晰度：`1080`（免费）、`2160`/4K（需VIP） |
| `s` (签名) | wasm 计算 | `ab6ca925...` | 32位 MD5，由 wasm 内部生成 |
| `t` (时间戳) | `Date.now()` | `1782224835502` | 毫秒级时间戳 |
| `k` (play_key) | 页面 `userlink` | `X1VVXURf...` | 匿名访问令牌，**不能传 `0`**（会 401） |

### 3.3 wasm 模块

- **文件**：`/static/wasm/nbmovie_wasm.<hash>.js`（JS 胶水）+ `/static/wasm/nbmovie_wasm_bg.<hash>.wasm`（二进制）
- **技术**：Rust + wasm-bindgen 0.2.114
- **导出函数**：`build_play_url(dataid, secret_key, quality, play_key) -> string`
- **内部盐值**：`nbmovie2024secretkey`（从 wasm 二进制 strings 提取）
- **DOM 依赖**：wasm 内部会调用 `document.getElementById('nb-st').content` 和 `document.getElementById('nb-plt').content`（后者取 `Date.now()`），需提供 DOM shim。
- **wasm 用到的浏览器 API**：`getElementById`、`HTMLMetaElement` 实例检查、`Date.now()`、`window` 全局对象。

### 3.4 在 Node.js 中运行 wasm

```javascript
import fs from 'fs';

// 1. 提取到的 token（来自页面 HTML）
const tokens = {
  nbst: '1782224393225',           // <meta id="nb-st" content="...">
  userlink: 'X1VVXURfXQIDBw4FCgc7IUlZU0k=',  // x-data 中 userlink:'...'
};

// 2. DOM shim（wasm 内部会读这两个 meta）
globalThis.document = {
  getElementById: (id) => {
    if (id === 'nb-st') return { content: tokens.nbst };
    if (id === 'nb-plt') return { content: String(Date.now()) };
    return null;
  },
};
globalThis.window = globalThis;

// 3. 加载 wasm
const bytes = fs.readFileSync('nbmovie.wasm');
const mod = await import('./nbmovie_wasm.mjs');
mod.initSync(bytes);   // 传入字节，同步初始化

// 4. 生成签名 URL
const url = mod.build_play_url('1551', 'cgzq7f3tf', '1080', tokens.userlink);
// => /video/play?p=1551&v=cgzq7f3tf&q=1080&s=ab6ca925...&t=1782224835502&k=NlM7OS48...
```

### 3.5 token 获取与刷新

- **`nb-st`**：每次请求任意页面（首页/详情页）时，响应 HTML 中的 `<meta id="nb-st" content="...">` 会更新。需实时提取。
- **`userlink`**：在页面顶部导航的 `x-data` 属性中，格式 `userlink:'<base64串>'`。匿名用户每次也可能变化。
- **有效期**：`nb-st` 有效期较短（观察约几分钟到十几分钟）。当 `/video/play` 返回 `401 请提供访问令牌` 时，需重新抓取页面刷新 token 后重试。
- **建议**：缓存 token 5 分钟，401 时强制刷新一次。

### 3.6 关于逆向算法（备选方案）

如不想依赖 wasm 文件，可尝试自行逆向签名算法。从 wasm 提取的线索：
- 盐值：`nbmovie2024secretkey`
- URL 模板：`/video/play?p={dataid}&v={playId}&q={quality}&s={sign}&t={timestamp}&k={userlink}`
- 签名 `s` 为 32 位 MD5，推测由 `dataid + playId + quality + nbst + timestamp + userlink + 盐值` 拼接后 MD5（具体顺序需用 wasm 调试确认）。

**推荐做法**：直接复用 wasm 文件（本项目方案），无需逆向，且站点更新算法时只需替换 wasm 文件。

---

## 4. 接口详解

### 4.1 分类筛选列表

**用途**：浏览电影/电视剧/动漫/综艺，支持按类型、地区、年份筛选与分页。

```
GET https://www.4kvms.com/filter?classify=&types=&areas=&years=&tags=&page=
```

**请求参数**（全部可选，Query String）：

| 参数 | 说明 | 示例 |
|------|------|------|
| `classify` | 大分类：1电影 2电视剧 3动漫 4综艺 | `3` |
| `types` | 类型（可多值逗号分隔） | `11,12` |
| `areas` | 地区 | `11` |
| `years` | 年份 | `4` |
| `tags` | 标签：1=4k，36=院线 | `1` |
| `page` | 页码 | `1` |

**请求头**：
```
User-Agent: Mozilla/5.0 ...
Referer: https://www.4kvms.com/
```

**响应**：返回 HTML 页面，需解析。每页约 24 条。

**卡片 HTML 结构**：
```html
<a href="/play/cgzq7f3tf" class="block">
  <div class="relative aspect-[2/3] rounded-lg overflow-hidden bg-secondary/50">
    <img data-src="https://...封面.jpg" src="/static/images/placeholder-dark.svg"
         alt="凡人修仙传" class="lazy w-full h-full object-cover ...">
    <!-- 可选 badge / rating -->
  </div>
  ...
</a>
```

**解析要点**：
- `playId`：`href="/play/(playId)"`
- 标题：`<img alt="标题">`
- 封面：`<img data-src="...">`（注意 `&amp;` 需反转义；懒加载，真实地址在 `data-src`）
- badge 角标：`<span class="badge...">4k</span>`
- rating 评分：`<span...>(\d+\.\d)</span>`
- 分页总数：页面文本 `共 N 页` 或 `第 X 页 / 共 N 页，共 M 个结果`
- 分页链接用 HTML 编码 `&amp;page=`，正则匹配 `page=(\d+)` 即可

**解析正则示例**：
```javascript
const cards = [...html.matchAll(/<a href="\/play\/([a-z0-9]+)" class="block">([\s\S]*?)<\/a>/g)]
  .map(m => {
    const id = m[1], inner = m[2];
    return {
      id,
      title: (inner.match(/alt="([^"]+)"/) || [,''])[1],
      cover: (inner.match(/data-src="([^"]+)"/) || [,''])[1].replace(/&amp;/g, '&'),
      badge: (inner.match(/<span class="badge[^"]*">([^<]+)<\/span>/) || [,''])[1],
      rating: (inner.match(/(\d+\.\d)\s*<\/span>/) || [,''])[1],
    };
  });
```

---

### 4.2 搜索

```
GET https://www.4kvms.com/search?q=<URL编码的关键字>
```

**请求参数**：

| 参数 | 说明 |
|------|------|
| `q` | 搜索关键字，需 URL 编码 |

**响应**：HTML 页面，卡片结构与筛选列表相同。搜索无分页（单页结果）。

**示例**：`/search?q=凡人修仙传` → 返回 3 条结果（凡人修仙传、凡人歌、凡人修仙传第1季）。

---

### 4.3 详情与集数

```
GET https://www.4kvms.com/play/<playId>
```

**请求头**：
```
User-Agent: Mozilla/5.0 ...
Referer: https://www.4kvms.com/
```

**响应**：HTML 页面，包含元数据、集数列表、相关推荐。

#### 元数据结构
```html
<div class="col-span-1 text-gray-500">导演</div>
<div class="col-span-2 text-gray-300">伍镇焯 / 王裕仁</div>
```
可解析字段：导演、编剧、主演、类型、地区、语言、上映、片长、又名。

其他字段位置：
- 标题：`<h2 class="text-xl font-bold text-white">凡人修仙传</h2>` 或 `<title>`
- 封面：`<meta property="og:image" content="...">`
- 评分：`<span class="text-sm">9.1</span>` 后跟 `<span>评分</span>`
- 状态：`<p class="text-xs text-gray-500">更新至179/200集...</p>`
- 简介：`剧情简介` 后的 `<p class="text-xs text-gray-300 leading-relaxed">...</p>`

#### 集数结构（关键）

每集为一个 `<a>` 标签，含三个关键属性：

```html
<a href="/play/cgzq7f3tf"
   @click.prevent="handleEpisodeClick($el.getAttribute('href'), '1551', 1, 1)"
   data-line="1" data-episode="1" dataid="1551">
   1
</a>
```

| 属性 | 含义 | 用途 |
|------|------|------|
| `href="/play/(playId)"` | 该集的播放页 ID | 签名参数 `v` |
| `dataid="1551"` | 该集数字 ID | 签名参数 `p` |
| `data-episode="1"` | 集序号 | 显示用 |

**解析方法**：按 `<a ` 分割 HTML，分别匹配三个属性，按集序号排序。

```javascript
const episodes = [];
for (const blk of html.split('<a ')) {
  const hm = blk.match(/href="\/play\/([a-z0-9]+)"/);
  const dm = blk.match(/dataid="(\d+)"/);
  const em = blk.match(/data-episode="(\d+)"/);
  if (hm && dm && em) {
    episodes.push({ n: +em[1], dataid: dm[1], playId: hm[1] });
  }
}
episodes.sort((a, b) => a.n - b.n);
```

> 电影类（无集数）页面的集数列表为空，需用详情页 `playId` 本身 + 空 `dataid` 请求播放源。

#### 相关推荐
页面下方有推荐影片卡片，结构与列表卡片一致。

---

### 4.4 播放源地址

这是签名接口，需先通过 wasm 生成 URL。

```
GET https://www.4kvms.com/video/play?p=<dataid>&v=<playId>&q=<quality>&s=<签名>&t=<时间戳>&k=<userlink>
```

**请求头**：
```
User-Agent: Mozilla/5.0 ...
Referer: https://www.4kvms.com/play/<playId>
```

**响应**（JSON）：

```json
{
  "code": 200,
  "message": "OK",
  "data": {
    "play_id": 1551,
    "subtitle_url": "",
    "current_quality": 1,
    "quality_urls": [
      {
        "mtype": "m3u8",
        "bitrate": 2160000,
        "title": "4K",
        "description": "蓝光",
        "isvip": true,
        "locked": true,
        "url": "1"
      },
      {
        "mtype": "m3u8",
        "bitrate": 1080,
        "title": "1080p",
        "description": "超清",
        "isvip": false,
        "locked": false,
        "url": "https://oss.douyinbit.com/m3u8/2a54f8a0ff845cf9033e0747cc6a980b.m3u8"
      }
    ]
  }
}
```

**字段说明**：

| 字段 | 说明 |
|------|------|
| `code` | 200 成功，401 表示令牌失效需刷新 |
| `data.quality_urls` | 清晰度数组，从高到低 |
| `quality_urls[].url` | 播放地址；值为 `"1"` 表示锁定不可用 |
| `quality_urls[].locked` | 是否锁定（VIP） |
| `quality_urls[].isvip` | 是否需 VIP |
| `quality_urls[].mtype` | 媒体类型，固定 `m3u8` |

**筛选可用清晰度**：`url && url !== "1"` 即可播放。

**m3u8 播放**（⚠️ 有两个关键坑，必须处理才能播放）：

1. **CORS**：m3u8 与分片均返回 `Access-Control-Allow-Origin: *`，前端 hls.js 可直接跨域播放，无需代理。

2. **Referer 检查（关键！）**：部分分片 CDN（如 `dc.xhscdn.com`）**拒绝所有带 Referer 的请求**，返回 403。必须在 HTML `<head>` 中设置 `<meta name="referrer" content="no-referrer">`，否则这些 CDN 的分片全部 403 无法播放。4kvms 原站即有此 meta。其他 CDN（如 `file.icve.com.cn`）不检查 Referer，这就是为什么有些影视能播有些不能。

3. **PNG 伪装分片（关键！）**：所有分片文件都是 **1x1 PNG 头 + IEND 之后的 MPEG-TS 数据** 的伪装格式（`.png` 后缀，`content-type: image/png`，但实际是视频）。标准 hls.js 无法直接解析 PNG 签名开头的分片。需要自定义 loader 在分片加载后剥离 PNG 头（找到 `IEND` 标记，取其后的数据），只保留 TS 部分交给 hls.js 解析。剥离后的数据是标准 188 字节对齐的 MPEG-TS（`0x47` 同步字节）。

   ```javascript
   // 剥离 PNG 伪装头：找到 IEND(49 45 4E 44)，取其后 4 字节 CRC 之后的数据
   function stripPngHeader(arrayBuffer) {
     const u8 = new Uint8Array(arrayBuffer);
     if (u8[0] !== 0x89 || u8[1] !== 0x50 || u8[2] !== 0x4E || u8[3] !== 0x47) return null;
     for (let i = 8; i < u8.length - 7; i++) {
       if (u8[i]===0x49 && u8[i+1]===0x45 && u8[i+2]===0x4E && u8[i+3]===0x44)
         return u8.slice(i + 8).buffer; // IEND(4) + CRC(4) 之后是 TS
     }
     return null;
   }
   // hls.js 自定义 loader
   const Loader = Hls.DefaultConfig.loader;
   const PngStripLoader = class extends Loader {
     load(ctx, cfg, cb) {
       const orig = cb.onSuccess;
       cb.onSuccess = (resp, stats, c) => {
         if (resp.data instanceof ArrayBuffer) {
           const ts = stripPngHeader(resp.data);
           if (ts) resp.data = ts;
         }
         orig(resp, stats, c);
       };
       super.load(ctx, cfg, cb);
     }
   };
   new Hls({ fLoader: PngStripLoader });
   ```

4. m3u8 响应头：`content-type: application/vnd.apple.mpegurl`、`access-control-allow-methods: GET, OPTIONS`

5. 备用线路：`window._pdf`（base64 编码的 JSON 数组，含备用 CDN 域名如 `oss.douyinbit.com`、`myoss.douyinbit.top`），网络错误时切换 hostname。

**401 处理**：
- 响应 `401 请提供访问令牌` 表示 `nb-st` 过期或 `userlink` 无效。
- 解决：重新请求 `/` 或 `/play/<id>` 页面，提取新的 `nb-st` 和 `userlink`，重新签名后重试。

---

### 4.5 其他后端 API

从主 JS 提取的 `/api/` 端点（多数需登录态 Cookie）：

| 端点 | 方法 | 说明 | 登录 |
|------|------|------|------|
| `/api/vod/<id>/hits` | POST | 增加点击数 | 否 |
| `/api/vod/<id>/play` | POST | 增加播放数 | 否 |
| `/api/vod/<id>/viewer` | POST | 观看人数（body: `{sid}`） | 否 |
| `/api/votes/check?vod_id=` | GET | 检查点赞状态 | 否 |
| `/api/votes/add` | POST | 点赞/踩（body: `{vod_id,vote}`） | 是 |
| `/api/votes/remove?vod_id=` | DELETE | 取消点赞 | 是 |
| `/api/ratings/list?vod_id=&page=&page_size=` | GET | 评论列表 | 否 |
| `/api/ratings/my-rating?vod_id=` | GET | 我的评分 | 是 |
| `/api/favorites/check?play_url=` | GET | 检查收藏 | 是 |
| `/api/favorites/add` | POST | 收藏 | 是 |
| `/api/favorites/remove` | DELETE | 取消收藏 | 是 |
| `/api/playlists/my?page=&per_page=` | GET | 我的片单 | 是 |
| `/api/playlists/vods/add?id=` | POST | 加入片单 | 是 |
| `/api/watch-time/update` | POST | 上报观看进度 | 是 |
| `/api/watch-time/get?play_url=` | GET | 获取观看进度 | 是 |
| `/api/watch-time/history?page=&per_page=` | GET | 观看历史 | 是 |
| `/api/login` | POST | 登录 | - |
| `/api/register` | POST | 注册 | - |
| `/api/logout` | POST | 登出 | - |
| `/api/email-verify/send` | POST | 发送邮箱验证码 | - |
| `/api/email-verify/verify` | POST | 验证邮箱 | - |
| `/api/user/reset-password` | POST | 重置密码 | - |

**弹幕 API**（独立服务 `4k.dmservce.org`）：

| 端点 | 说明 |
|------|------|
| `GET /api/v1/danmuku/video/<video_id>.<episode>` | 获取弹幕 |
| `POST /api/v1/danmuku` | 发送弹幕 |
| `POST /api/v1/danmuku/<id>/like` | 点赞弹幕 |
| `POST /api/v1/danmuku/<id>/report` | 举报弹幕 |

其中 `video_id` 即详情页的数字 `vodid`（如 `cgzq7cao3`，注意与集 playId 不同，是整个影片的 ID）。

**登录态判断**：页面导航的 `x-data` 含 `isLoggedIn` 字段；Cookie 中存在 `session_token` 表示已登录。

---

## 5. 分类码全表（taxonomy）

### classify（大分类）

| 值 | 说明 |
|----|------|
| 1 | 电影 |
| 2 | 电视剧 |
| 3 | 动漫 |
| 4 | 综艺 |

### types（类型）

| 值 | 说明 | 值 | 说明 | 值 | 说明 |
|----|------|----|------|----|------|
| 1 | 剧情 | 2 | 悬疑 | 3 | 恐怖 |
| 4 | 惊悚 | 5 | 喜剧 | 6 | 爱情 |
| 9 | 犯罪 | 10 | 动作 | 11 | 动画 |
| 12 | 奇幻 | 13 | 音乐 | 14 | 科幻 |
| 15 | 历史 | 16 | 战争 | 18 | 冒险 |
| 19 | 家庭 | 20 | 纪录 | 23 | 西部 |
| 24 | 电视电影 | 25 | 情色 | 26 | 真人秀 |
| 27 | 古装 | 28 | 传记 | 29 | 同性 |
| 30 | 运动 | 31 | 武侠 | 32 | 歌舞 |
| 33 | 纪录片 | 34 | 灾难 | 35 | 短片 |

### areas（地区）

| 值 | 说明 | 值 | 说明 | 值 | 说明 |
|----|------|----|------|----|------|
| 5 | 美国 | 6 | 法国 | 7 | 中国 |
| 9 | unknown | 11 | 日本 | 12 | 韩国 |
| 14 | 中国香港 | 16 | 俄罗斯 | 17 | 波兰 |
| 18 | 德国 | 19 | 意大利 | 21 | 中国台湾 |
| 22 | 澳大利亚 | 24 | 西班牙 | 30 | 英国 |
| 32 | 加拿大 | 33 | 泰国 | 34 | 印度 |
| 41 | 丹麦 | 52 | 中国大陆 | 65 | 马来西亚 |
| 74 | 菲律宾 | 78 | 其他 | 79 | 瑞典 |
| 80 | 挪威 | 81 | 阿根廷 | 82 | 冰岛 |
| 83 | 保加利亚 | 84 | 爱尔兰 | 86 | 墨西哥 |

### years（年份，部分）

| 值 | 年份 | 值 | 年份 | 值 | 年份 |
|----|------|----|------|----|------|
| 1 | 2026 | 3 | 2025 | 4 | 2024 |
| 56 | 2023 | 13 | 2022 | 2 | 2021 |
| 6 | 2020 | 8 | 2019 | 9 | 2018 |
| 12 | 2017 | 11 | 2016 | 14 | 2015 |
| 43 | 2000 | 27 | 1994 | ... | （1949-2026 共75项） |

> 完整年份映射建议运行时从 `/filter` 页面动态解析，避免硬编码过期。

### tags（标签）

| 值 | 说明 |
|----|------|
| 1 | 4k |
| 36 | 院线 |

---

## 6. 数据结构参考

### 列表卡片项

```typescript
interface CardItem {
  id: string;        // playId，如 "cgzq7f3tf"
  title: string;     // 标题
  cover: string;     // 封面 URL（注意反转义 &amp;）
  badge: string;     // 角标，如 "4k"（可空）
  status: string;    // 更新状态，如 "更新至179集"（可空）
  rating: string;    // 评分，如 "9.1"（可空）
}
```

### 详情

```typescript
interface Detail {
  playId: string;      // 当前集 playId
  title: string;
  cover: string;
  rating: string;
  status: string;      // "更新至179/200集..."
  description: string; // 剧情简介
  director: string;
  writer: string;
  actors: string;
  type: string;        // "动画 / 奇幻 / 武侠"
  area: string;
  language: string;
  releaseDate: string;
  duration: string;
  alias: string;
  episodes: Episode[]; // 集数列表
  related: CardItem[]; // 相关推荐
}

interface Episode {
  n: number;         // 集序号
  dataid: string;    // 数字 ID，用于签名参数 p
  playId: string;    // 字符串 ID，用于签名参数 v
}
```

### 播放源响应

```typescript
interface PlayResponse {
  code: number;       // 200 成功，401 令牌失效
  message: string;
  data: {
    play_id: number;
    subtitle_url: string;
    current_quality: number;
    quality_urls: Quality[];
  };
}

interface Quality {
  mtype: string;       // "m3u8"
  bitrate: number;     // 1080 / 2160000
  title: string;       // "1080p" / "4K"
  description: string; // "超清" / "蓝光"
  isvip: boolean;
  locked: boolean;
  url: string;         // m3u8 地址，"1" 表示锁定
}
```

---

## 7. 二次开发指南

### 7.1 完整调用链路（以播放《凡人修仙传》第1集为例）

```
1. GET /play/cgzq7f3tf
   → 提取 nb-st、userlink、集数列表[{n:1,dataid:'1551',playId:'cgzq7f3tf'}]

2. wasm.build_play_url('1551', 'cgzq7f3tf', '1080', userlink)
   → /video/play?p=1551&v=cgzq7f3tf&q=1080&s=ab6ca925...&t=...&k=...

3. GET /video/play?...
   → { code:200, data:{ quality_urls:[{url:"https://oss.douyinbit.com/m3u8/xxx.m3u8"}] } }

4. hls.js 加载 m3u8 → 播放
```

### 7.2 Node.js 封装服务（本项目已实现）

本项目 `server.js` 已封装为 REST API，二次开发可直接调用：

```bash
# 列表
curl "http://localhost:3000/api/list?classify=3&page=1"

# 搜索
curl "http://localhost:3000/api/search?q=凡人修仙传"

# 详情
curl "http://localhost:3000/api/detail/cgzq7f3tf"

# 播放地址
curl "http://localhost:3000/api/play?dataid=1551&playId=cgzq7f3tf"
```

### 7.3 前端播放（hls.js）

```javascript
const res = await fetch(`/api/play?dataid=${dataid}&playId=${playId}`).then(r=>r.json());
const m3u8 = res.data.qualities[0].url;

const video = document.querySelector('video');
if (Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource(m3u8);
  hls.attachMedia(video);
  hls.on(Hls.Events.MANIFEST_PARSED, () => video.play());
} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
  video.src = m3u8;  // Safari 原生支持
  video.play();
}
```

### 7.4 Python 命令行播放器示例

```python
import re, subprocess, json

BASE = "https://www.4kvms.com"
UA = "Mozilla/5.0"

def curl(url):
    return subprocess.run(["curl","-sL","-A",UA,url],capture_output=True,text=True).stdout

# 1. 获取 token + 集数
html = curl(f"{BASE}/play/cgzq7f3tf")
nbst = re.search(r'<meta id="nb-st" content="([^"]+)"', html).group(1)
userlink = re.search(r"userlink:'([^']+)'", html).group(1)

eps = []
for blk in html.split('<a '):
    hm = re.search(r'href="/play/([a-z0-9]+)"', blk)
    dm = re.search(r'dataid="(\d+)"', blk)
    em = re.search(r'data-episode="(\d+)"', blk)
    if hm and dm and em:
        eps.append((int(em.group(1)), dm.group(1), hm.group(1)))
eps.sort()

# 2. 调用本地 Node 服务获取 m3u8（或直接跑 wasm）
dataid, playId = eps[0][1], eps[0][2]
resp = json.loads(curl(f"http://localhost:3000/api/play?dataid={dataid}&playId={playId}"))
m3u8 = resp["data"]["qualities"][0]["url"]

# 3. 用 mpv 播放
subprocess.run(["mpv", m3u8])
```

### 7.5 拓展方向

| 方向 | 实现思路 |
|------|----------|
| 命令行播放器 | Node/Python 调用 wasm 签名 → 拿 m3u8 → 调 `mpv <m3u8>` 播放 |
| 移动端 App | 后端 API 不变，前端换成 React Native / Flutter |
| 桌面客户端 | Electron 套壳现有前端 |
| 弹幕集成 | 调 `4k.dmservce.org/api/v1/danmuku/video/<vodid>.<集号>`，配合 Artplayer 弹幕插件 |
| 观看历史 | 本地 localStorage 存储 `{playId, position, duration}` |
| VIP 4K 播放 | 实现 `/api/login` 登录，携带 Cookie 请求 `q=2160` |
| 收藏/评分 | 登录后调 `/api/favorites/add`、`/api/ratings` |
| 续播 | 记录每集播放进度，进入详情时调进度接口或本地存储恢复 |

---

## 8. 已知限制与注意事项

1. **4K 需 VIP**：匿名用户只能播放 1080p。4K 清晰度 `locked=true`，需登录 VIP 账号。
2. **token 时效**：`nb-st` 有效期较短，`/video/play` 返回 401 时需重新抓页面刷新。
3. **userlink 必传**：签名参数 `k` 不能传 `0`，必须用页面提取的真实 `userlink`，否则 401。
4. **封面防盗链**：封面图通过 `gimg0.baidu.com` 代理，可正常显示；部分图片在 `4kvm.staticimgjs.org`。
5. **分页编码**：筛选页分页链接用 HTML 编码 `&amp;page=`，解析时注意。
6. **`/anime` 等不可分页**：`/movie`、`/tv`、`/anime` 不支持 `?page=`，必须用 `/filter`。
7. **反爬**：请求需带 `User-Agent` 和 `Referer`，否则可能被拒。
8. **备用域名**：主域名不可达时可尝试 `4kvm.site`；m3u8 CDN 故障时用 `window._pdf` 中的备用域名切换 hostname。
9. **wasm 版本**：站点更新后 wasm 文件 hash 会变，需重新下载 `/static/wasm/nbmovie_wasm.<新hash>.js` 和 `.wasm`，但 `build_play_url` 函数签名通常不变。
10. **合规**：本接口分析仅供学习交流，实际使用请遵守站点规则，支持正版。

---

## 9. 关键文件清单

### 站点资源文件（版本号会随站点更新变化）

| 文件 | 用途 |
|------|------|
| `/static/js/dist/app.ultra.min.<hash>.js` | 主应用 JS（含播放器逻辑、API 调用） |
| `/static/wasm/nbmovie_wasm.<hash>.js` | wasm JS 胶水代码 |
| `/static/wasm/nbmovie_wasm_bg.<hash>.wasm` | wasm 二进制（签名核心） |
| `/static/js/hls.min.last.<hash>.js` | hls.js 播放库 |
| `/static/js/artplayer.<hash>.js` | Artplayer 播放器 |
| `/static/js/artplayer-plugin-danmaku.min.<hash>.js` | 弹幕插件 |
| `/static/js/alpine.<hash>.js` | Alpine.js 框架 |
| `/static/js/comments.<hash>.js` | 评论模块 |

### 本项目文件

| 文件 | 用途 |
|------|------|
| `server.js` | Node.js 后端（wasm 签名 + HTML 解析 + REST API） |
| `wasm/nbmovie_wasm.mjs` | wasm JS 胶水（复用站点文件） |
| `wasm/nbmovie.wasm` | wasm 二进制（复用站点文件） |
| `public/index.html` | 前端页面 |
| `public/app.js` | 前端逻辑 |
| `public/style.css` | 样式 |

---

## 附录：实测数据样例

### 播放源请求示例
```
GET /video/play?p=1551&v=cgzq7f3tf&q=1080&s=ab6ca9258204fe15e466a8c6e31451e5&t=1782224835502&k=NlM7OS48N1RoY303JxRGIzcMBk4nNwE1I1kODw==
```

### 凡人修仙传实测
- playId: `cgzq7f3tf`（第1集）
- dataid: `1551`
- 总集数: 179 集（更新至179/200）
- 评分: 9.1
- 1080p m3u8: `https://oss.douyinbit.com/m3u8/2a54f8a0ff845cf9033e0747cc6a980b.m3u8`
- 4K: locked（需VIP）

### 签名盐
`nbmovie2024secretkey`（从 wasm 二进制提取）

### wasm build_play_url 四参数
`build_play_url(dataid, secret_key, quality, play_key)`
- `dataid` = 集数字 ID（如 `1551`）
- `secret_key` = 集 playId（如 `cgzq7f3tf`）
- `quality` = `1080`（免费）/ `2160`（4K VIP）
- `play_key` = 页面 `userlink`（匿名访问令牌）
