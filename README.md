# 4kvms 影视客户端

基于 [4kvms.com](https://www.4kvms.com/) 接口的影视客户端，支持浏览电视剧/动漫/电影/综艺、搜索、选集与在线播放（1080p）。

## 原理

网站的播放源通过一个 WebAssembly 模块 (`nbmovie_wasm`) 对请求参数签名后才能获取。本项目的核心是复用该 wasm 完成签名，从而拿到真实 m3u8 地址：

1. **列表/搜索**：抓取 `/filter?classify=&types=&areas=&years=&page=` 与 `/search?q=` 页面 HTML，解析卡片。
2. **详情/集数**：抓取 `/play/<playId>` 页面，解析元数据与每集的 `dataid` + `playId`。
3. **播放源**：
   - 从页面提取 `nb-st`（签名 nonce）与匿名 `userlink`（访问令牌）。
   - 调用 wasm `build_play_url(dataid, playId, quality, userlink)` 生成带签名的 `/video/play?p=&v=&q=&s=&t=&k=` URL。
   - 请求该 URL 返回 JSON，含 `quality_urls`（1080p 免费，4K 需 VIP）。
4. **播放**：m3u8 及分片均返回 `Access-Control-Allow-Origin: *`，前端用 hls.js 直接播放。

## 运行

```bash
npm install
npm start
# 打开 http://localhost:3000
```

## 接口

| 接口 | 说明 |
|------|------|
| `GET /api/list?classify=&types=&areas=&years=&page=` | 分类筛选列表 |
| `GET /api/search?q=` | 搜索 |
| `GET /api/detail/:playId` | 详情 + 集数列表 |
| `GET /api/play?dataid=&playId=` | 获取 m3u8 播放地址 |

### 分类码
- `classify`: 1=电影 2=电视剧 3=动漫 4=综艺
- `types` / `areas` / `years` 详见 `public/app.js`

## 技术栈

- 后端：Node.js + Express（ESM），运行 wasm 签名 + HTML 解析
- 前端：原生 JS + hls.js，深色响应式 UI
- 签名：复用站点 `nbmovie_wasm`（Rust/wasm-bindgen），无需逆向算法

## 说明

- 仅支持 1080p 及以下清晰度播放；4K 需站点 VIP 账号登录（本客户端未实现登录）。
- `nb-st` / `userlink` 会缓存并在 `/video/play` 返回 401 时自动刷新。
- 仅供学习交流，请支持正版。
