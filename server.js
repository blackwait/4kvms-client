import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://www.4kvms.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ---------- WASM 签名模块 ----------
let wasmMod = null;
let tokens = { nbst: '', userlink: '0', ts: 0 };

async function loadWasm() {
  if (wasmMod) return wasmMod;
  const bytes = fs.readFileSync(path.join(__dirname, 'wasm', 'nbmovie.wasm'));
  wasmMod = await import(path.join(__dirname, 'wasm', 'nbmovie_wasm.mjs'));
  setupDomShim();
  wasmMod.initSync(bytes);
  return wasmMod;
}

function setupDomShim() {
  globalThis.document = {
    getElementById: (id) => {
      if (id === 'nb-st') return { content: tokens.nbst };
      if (id === 'nb-plt') return { content: String(Date.now()) };
      return null;
    },
  };
  globalThis.window = globalThis;
}

function buildPlayUrl(dataid, playId, quality, playKey) {
  return wasmMod.build_play_url(String(dataid), String(playId), String(quality), String(playKey));
}

// ---------- 网络抓取 ----------
async function fetchText(url, extraHeaders = {}) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': BASE + '/', ...extraHeaders },
  });
  const text = await r.text();
  return { status: r.status, text };
}

// 从页面 HTML 提取 nb-st 与匿名 userlink
function extractTokens(html) {
  const m1 = html.match(/<meta id="nb-st" content="([^"]+)"/);
  const m2 = html.match(/userlink:'([^']+)'/);
  if (m1 && m2) tokens = { nbst: m1[1], userlink: m2[1], ts: Date.now() };
  return tokens;
}

async function ensureTokens(force = false) {
  if (!force && tokens.nbst && Date.now() - tokens.ts < 5 * 60 * 1000) return tokens;
  const { text } = await fetchText(BASE + '/');
  return extractTokens(text);
}

// ---------- HTML 解析 ----------
function unesc(s) {
  return (s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
}

// 解析列表卡片（filter / search 通用）
function parseCards(html) {
  const items = [];
  const re = /<a href="\/play\/([a-z0-9]+)" class="block">([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const id = m[1], inner = m[2];
    const title = unesc((inner.match(/alt="([^"]+)"/) || [, ''])[1]);
    const cover = unesc((inner.match(/data-src="([^"]+)"/) || inner.match(/src="([^"]+)"/) || [, ''])[1]);
    const badge = unesc((inner.match(/<span class="badge[^"]*">([^<]+)<\/span>/) || [, ''])[1]);
    const status = unesc((inner.match(/class="[^"]*text-gray[^"]*"[^>]*>(更新至[^<]*|全\d+集[^<]*)</) || [, ''])[1]);
    const rating = (inner.match(/(\d+\.\d)\s*<\/span>/) || [, ''])[1];
    if (id) items.push({ id, title, cover, badge, status, rating });
  }
  return items;
}

// 解析分页
function parsePagination(html) {
  // 优先用 "共 N 页" 文本
  const tm = html.match(/共\s*(\d+)\s*页/);
  if (tm) return { maxPage: parseInt(tm[1]) };
  // 回退：从分页链接解析（含 HTML 编码的 &amp;）
  const pages = [...html.matchAll(/page=(\d+)/g)].map(x => parseInt(x[1]));
  const max = pages.length ? Math.max(...pages) : 1;
  return { maxPage: max };
}

// 解析播放详情页
function parseDetail(html, playId) {
  const field = (label) => {
    const re = new RegExp(`<div class="col-span-1 text-gray-500">${label}</div>\\s*<div class="col-span-2 text-gray-300">([\\s\\S]*?)</div>`);
    const m = html.match(re);
    return m ? unesc(m[1]) : '';
  };
  const title = unesc((html.match(/<h2 class="text-xl font-bold text-white">([\s\S]*?)<\/h2>/) || [, ''])[1])
    || unesc((html.match(/<title>([^<]+)<\/title>/) || [, ''])[1].split(' - ')[0]);
  const cover = unesc((html.match(/<meta property="og:image" content="([^"]+)"/) || [, ''])[1]);
  const rating = (html.match(/<span class="text-sm">(\d+\.\d)<\/span>/) || [, ''])[1];
  const status = unesc((html.match(/<p class="text-xs text-gray-500">([^<]*集[^<]*)<\/p>/) || [, ''])[1]);
  const desc = unesc((html.match(/剧情简介[\s\S]*?<p class="text-xs text-gray-300 leading-relaxed">([\s\S]*?)<\/p>/) || [, ''])[1]);

  // 集数列表：每个 <a> 含 dataid / data-episode / href
  const episodes = [];
  for (const blk of html.split('<a ')) {
    const hm = blk.match(/href="\/play\/([a-z0-9]+)"/);
    const dm = blk.match(/dataid="(\d+)"/);
    const em = blk.match(/data-episode="(\d+)"/);
    if (hm && dm && em) {
      episodes.push({ n: parseInt(em[1]), dataid: dm[1], playId: hm[1] });
    }
  }
  episodes.sort((a, b) => a.n - b.n);

  // 相关推荐
  const related = [];
  const seen = new Set([playId]);
  const reRel = /<a href="\/play\/([a-z0-9]+)"[^>]*>[\s\S]*?<img[^>]*alt="([^"]+)"[\s\S]*?(?:data-src|src)="([^"]+)"/g;
  let rm;
  while ((rm = reRel.exec(html))) {
    if (!seen.has(rm[1]) && rm[2]) {
      seen.add(rm[1]);
      related.push({ id: rm[1], title: unesc(rm[2]), cover: unesc(rm[3]) });
      if (related.length >= 12) break;
    }
  }

  return {
    playId,
    title,
    cover,
    rating,
    status,
    description: desc,
    director: field('导演'),
    writer: field('编剧'),
    actors: field('主演'),
    type: field('类型'),
    area: field('地区'),
    language: field('语言'),
    releaseDate: field('上映'),
    duration: field('片长'),
    alias: field('又名'),
    episodes,
    related,
  };
}

// 解析播放源 JSON 响应
function parsePlayResponse(json) {
  if (json.code !== 200 || !json.data) throw new Error(json.message || '获取播放地址失败');
  const qualities = (json.data.quality_urls || []).map(q => ({
    title: q.title,
    description: q.description,
    url: q.url,
    mtype: q.mtype,
    locked: !!q.locked,
    isvip: !!q.isvip,
  })).filter(q => q.url && q.url !== '1');
  if (!qualities.length) throw new Error('无可播放的清晰度（4K 需 VIP）');
  return { playId: json.data.play_id, qualities };
}

// ---------- API ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 列表 / 筛选
app.get('/api/list', async (req, res) => {
  try {
    const { classify = '', types = '', areas = '', years = '', tags = '', page = 1 } = req.query;
    const qs = new URLSearchParams();
    if (classify) qs.set('classify', classify);
    if (types) qs.set('types', types);
    if (areas) qs.set('areas', areas);
    if (years) qs.set('years', years);
    if (tags) qs.set('tags', tags);
    qs.set('page', page);
    const { text } = await fetchText(`${BASE}/filter?${qs.toString()}`);
    const items = parseCards(text);
    const { maxPage } = parsePagination(text);
    res.json({ code: 200, items, page: parseInt(page), maxPage });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

// 搜索
app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ code: 200, items: [] });
    const { text } = await fetchText(`${BASE}/search?q=${encodeURIComponent(q)}`);
    const items = parseCards(text);
    res.json({ code: 200, items, q });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

// 详情 + 集数
app.get('/api/detail/:playId', async (req, res) => {
  try {
    const { playId } = req.params;
    const { text } = await fetchText(`${BASE}/play/${playId}`, { Referer: `${BASE}/` });
    extractTokens(text); // 顺便刷新 token
    const detail = parseDetail(text, playId);
    res.json({ code: 200, data: detail });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

// 播放地址（wasm 签名 + /video/play）
app.get('/api/play', async (req, res) => {
  try {
    const { dataid, playId, quality = '1080' } = req.query;
    if (!dataid || !playId) return res.status(400).json({ code: 400, message: '缺少 dataid 或 playId' });
    await loadWasm();

    const doResolve = async () => {
      await ensureTokens();
      const pathUrl = buildPlayUrl(dataid, playId, quality, tokens.userlink);
      const r = await fetch(`${BASE}${pathUrl}`, {
        headers: { 'User-Agent': UA, 'Referer': `${BASE}/play/${playId}` },
      });
      return { status: r.status, json: r.status === 200 ? await r.json() : null, text: r.status !== 200 ? await r.text() : '' };
    };

    let result = await doResolve();
    if (result.status === 401) {
      // token 过期，强制刷新后重试一次
      await ensureTokens(true);
      result = await doResolve();
    }
    if (result.status !== 200) throw new Error(`播放源请求失败 (${result.status}): ${result.text}`);
    res.json({ code: 200, data: parsePlayResponse(result.json) });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  try { await loadWasm(); console.log('WASM 签名模块已加载'); } catch (e) { console.error('WASM 加载失败:', e.message); }
  console.log(`4kvms 客户端运行于 http://localhost:${PORT}`);
});
