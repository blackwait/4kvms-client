// ---------- 分类与筛选 taxonomy ----------
const CLASSIFY = [
  { v: '', t: '全部' },
  { v: '3', t: '动漫' },
  { v: '2', t: '电视剧' },
  { v: '1', t: '电影' },
  { v: '4', t: '综艺' },
];
const TYPES = [
  ['', '全部类型'], ['1', '剧情'], ['2', '悬疑'], ['3', '恐怖'], ['4', '惊悚'], ['5', '喜剧'],
  ['6', '爱情'], ['9', '犯罪'], ['10', '动作'], ['11', '动画'], ['12', '奇幻'], ['14', '科幻'],
  ['15', '历史'], ['16', '战争'], ['18', '冒险'], ['19', '家庭'], ['27', '古装'], ['28', '传记'],
  ['30', '运动'], ['31', '武侠'], ['33', '纪录片'], ['34', '灾难'], ['35', '短片'],
];
const AREAS = [
  ['', '全部地区'], ['5', '美国'], ['7', '中国'], ['52', '中国大陆'], ['11', '日本'], ['12', '韩国'],
  ['14', '中国香港'], ['21', '中国台湾'], ['30', '英国'], ['18', '德国'], ['24', '西班牙'],
  ['33', '泰国'], ['34', '印度'], ['6', '法国'], ['16', '俄罗斯'], ['78', '其他'],
];
const YEARS = [
  ['', '全部年份'], ['1', '2026'], ['3', '2025'], ['4', '2024'], ['56', '2023'], ['13', '2022'],
  ['2', '2021'], ['6', '2020'], ['8', '2019'], ['9', '2018'], ['12', '2017'], ['11', '2016'],
  ['14', '2015'], ['15', '2014'], ['22', '2013'], ['10', '2012'], ['25', '2010'],
];

const state = {
  classify: '', types: '', areas: '', years: '',
  page: 1, maxPage: 1, keyword: '',
  detail: null, hls: null,
};

const $ = (id) => document.getElementById(id);
const api = (p) => fetch(p).then(r => r.json());
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2500);
}
function imgSrc(url) { return url ? url.replace(/&amp;/g, '&') : '/placeholder.svg'; }
function showView(v) {
  $('browseView').classList.toggle('hidden', v !== 'browse');
  $('detailView').classList.toggle('hidden', v !== 'detail');
  if (v === 'browse') $('filterBar').style.display = '';
}

// ---------- 分类 tabs ----------
function renderTabs() {
  $('classifyTabs').innerHTML = CLASSIFY.map(c =>
    `<button class="tab ${c.v === state.classify ? 'active' : ''}" data-v="${c.v}">${c.t}</button>`
  ).join('');
  $('classifyTabs').querySelectorAll('.tab').forEach(b => b.onclick = () => {
    state.classify = b.dataset.v; state.page = 1;
    state.keyword = ''; $('searchInput').value = '';
    renderTabs(); loadList();
  });
}

// ---------- 筛选栏 ----------
function renderFilters() {
  const mk = (key, opts) => `<select data-key="${key}">` +
    opts.map(([v, t]) => `<option value="${v}" ${v === state[key] ? 'selected' : ''}>${t}</option>`).join('') + `</select>`;
  $('filterBar').innerHTML = mk('types', TYPES) + mk('areas', AREAS) + mk('years', YEARS);
  $('filterBar').querySelectorAll('select').forEach(s => s.onchange = () => {
    state[s.dataset.key] = s.value; state.page = 1; loadList();
  });
}

// ---------- 列表 ----------
async function loadList() {
  showView('browse');
  const grid = $('grid');
  grid.innerHTML = '<div class="loading">加载中...</div>';
  $('pagination').innerHTML = '';
  const params = new URLSearchParams();
  if (state.classify) params.set('classify', state.classify);
  if (state.types) params.set('types', state.types);
  if (state.areas) params.set('areas', state.areas);
  if (state.years) params.set('years', state.years);
  params.set('page', state.page);
  try {
    const res = await api('/api/list?' + params.toString());
    if (res.code !== 200) throw new Error(res.message);
    state.maxPage = res.maxPage || 1;
    renderGrid(res.items, grid);
    renderPagination();
  } catch (e) {
    grid.innerHTML = `<div class="error">加载失败：${e.message}</div>`;
  }
}

function renderGrid(items, container) {
  if (!items.length) { container.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  container.innerHTML = items.map(it => `
    <div class="card" data-id="${it.id}">
      <div class="poster">
        <img src="${imgSrc(it.cover)}" loading="lazy" onerror="this.src='/placeholder.svg'">
        ${it.badge ? `<span class="badge">${it.badge}</span>` : ''}
        ${it.rating ? `<span class="rating">★ ${it.rating}</span>` : ''}
      </div>
      <div class="card-title">${it.title || ''}</div>
      <div class="card-status">${it.status || ''}</div>
    </div>`).join('');
  container.querySelectorAll('.card').forEach(c => c.onclick = () => openDetail(c.dataset.id));
}

function renderPagination() {
  const p = state.page, max = state.maxPage;
  const el = $('pagination');
  if (max <= 1) { el.innerHTML = ''; return; }
  const btn = (label, page, dis, act) =>
    `<button ${dis ? 'disabled' : ''} data-p="${page}" class="${act ? 'active' : ''}">${label}</button>`;
  let html = btn('上一页', p - 1, p <= 1, false);
  const range = [];
  for (let i = Math.max(1, p - 2); i <= Math.min(max, p + 2); i++) range.push(i);
  if (range[0] > 1) html += `<span class="dots">...</span>`;
  range.forEach(i => html += btn(i, i, false, i === p));
  if (range[range.length - 1] < max) html += `<span class="dots">...</span>`;
  html += btn('下一页', p + 1, p >= max, false);
  html += `<span class="page-info">${p} / ${max}</span>`;
  el.innerHTML = html;
  el.querySelectorAll('button').forEach(b => b.onclick = () => {
    if (b.disabled) return;
    state.page = parseInt(b.dataset.p); loadList(); window.scrollTo(0, 0);
  });
}

// ---------- 搜索 ----------
$('searchForm').onsubmit = (e) => {
  e.preventDefault();
  state.keyword = $('searchInput').value.trim();
  if (!state.keyword) return;
  showView('browse');
  $('filterBar').style.display = 'none';
  const grid = $('grid');
  grid.innerHTML = '<div class="loading">搜索中...</div>';
  $('pagination').innerHTML = '';
  api('/api/search?q=' + encodeURIComponent(state.keyword)).then(res => {
    if (res.code !== 200) throw new Error(res.message);
    renderGrid(res.items, grid);
    state.maxPage = 1;
  }).catch(e => { grid.innerHTML = `<div class="error">搜索失败：${e.message}</div>`; });
};

// ---------- 详情 ----------
async function openDetail(playId) {
  showView('detail');
  window.scrollTo(0, 0);
  try {
    const res = await api('/api/detail/' + playId);
    if (res.code !== 200) throw new Error(res.message);
    state.detail = res.data;
    renderDetail(res.data);
  } catch (e) {
    toast('详情加载失败：' + e.message);
    showView('browse');
  }
}

function renderDetail(d) {
  $('detailCover').src = imgSrc(d.cover);
  $('detailCover').onerror = function () { this.src = '/placeholder.svg'; };
  $('detailTitle').textContent = d.title;
  $('detailMeta').innerHTML = [
    d.rating ? `<span class="rating-big">★ ${d.rating}</span>` : '',
    d.releaseDate, d.area, d.type,
  ].filter(Boolean).map(x => `<span>${x}</span>`).join(' <em>·</em> ');
  $('detailDesc').textContent = d.description;
  const infoRows = [
    ['导演', d.director], ['编剧', d.writer], ['主演', d.actors],
    ['语言', d.language], ['片长', d.duration], ['又名', d.alias],
  ].filter(([, v]) => v);
  $('detailInfo').innerHTML = infoRows.map(([k, v]) =>
    `<div class="info-row"><span class="info-k">${k}</span><span class="info-v">${v}</span></div>`).join('');
  $('epStatus').textContent = d.status || '';

  const epEl = $('episodes');
  if (d.episodes.length === 0) {
    epEl.innerHTML = `<button class="ep" data-dataid="" data-playid="${d.playId}" data-n="1">播放</button>`;
  } else {
    epEl.innerHTML = d.episodes.map(ep =>
      `<button class="ep" data-n="${ep.n}" data-dataid="${ep.dataid}" data-playid="${ep.playId}">${ep.n}</button>`
    ).join('');
  }
  epEl.querySelectorAll('.ep').forEach(b => b.onclick = () =>
    playEpisode(b.dataset.dataid, b.dataset.playid, parseInt(b.dataset.n)));

  renderGrid(d.related, $('related'));
  const first = d.episodes[0] || { dataid: '', playId: d.playId, n: 1 };
  playEpisode(first.dataid, first.playId, first.n);
}

// ---------- PNG 伪装分片剥离 ----------
// 4kvms 的视频分片伪装成 1x1 PNG：PNG头+IEND 之后才是真正的 MPEG-TS 数据。
// 标准 hls.js 看到 PNG 签名无法解析，需自定义 loader 剥离 PNG 头。
function stripPngHeader(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  // PNG 签名: 89 50 4E 47 0D 0A 1A 0A
  if (u8.length < 16 || u8[0] !== 0x89 || u8[1] !== 0x50 || u8[2] !== 0x4E || u8[3] !== 0x47) {
    return null; // 不是 PNG，无需处理
  }
  // 查找 IEND 标记 (49 45 4E 44)，其后 4 字节 CRC 之后即为 TS 数据
  for (let i = 8; i < u8.length - 7; i++) {
    if (u8[i] === 0x49 && u8[i + 1] === 0x45 && u8[i + 2] === 0x4E && u8[i + 3] === 0x44) {
      return u8.slice(i + 8).buffer; // 跳过 IEND(4) + CRC(4)
    }
  }
  return null;
}

// 自定义 fragment loader：加载分片后剥离 PNG 伪装头
const DefaultLoader = (Hls.defaultConfig && Hls.defaultConfig.loader) || (Hls.DefaultConfig && Hls.DefaultConfig.loader);
const PngStripLoader = class extends DefaultLoader {
  load(context, config, callbacks) {
    const origOnSuccess = callbacks.onSuccess;
    callbacks.onSuccess = function (response, stats, ctx) {
      if (response.data instanceof ArrayBuffer) {
        const stripped = stripPngHeader(response.data);
        if (stripped) response.data = stripped;
      }
      origOnSuccess(response, stats, ctx);
    };
    super.load(context, config, callbacks);
  }
};

// ---------- 播放 ----------
async function playEpisode(dataid, playId, n) {
  document.querySelectorAll('.ep').forEach(b =>
    b.classList.toggle('active', b.dataset.playid === playId));
  const video = $('player');
  const loading = $('playerLoading');
  loading.style.display = 'block';
  loading.textContent = `加载第 ${n} 集...`;
  try {
    const res = await api(`/api/play?dataid=${dataid}&playId=${playId}`);
    if (res.code !== 200) throw new Error(res.message);
    const q = res.data.qualities[0];
    loadStream(video, q.url);
    document.title = `${state.detail ? state.detail.title : ''} 第${n}集 - 4kvms`;
  } catch (e) {
    loading.style.display = 'none';
    loading.textContent = '加载中...';
    toast('播放失败：' + e.message);
  }
}

function loadStream(video, url) {
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  if (Hls.isSupported()) {
    const hls = new Hls({ maxBufferLength: 30, fLoader: PngStripLoader });
    state.hls = hls;
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      $('playerLoading').style.display = 'none';
      video.play().catch(() => {
        // autoplay 被阻止，提示用户点击播放
        $('playerLoading').style.display = 'block';
        $('playerLoading').textContent = '点击播放';
        $('playerLoading').onclick = () => { video.play(); $('playerLoading').style.display = 'none'; };
      });
    });
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        $('playerLoading').style.display = 'block';
        $('playerLoading').textContent = '播放出错：' + (data.details || data.type) + '，可尝试切换集数';
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    $('playerLoading').style.display = 'none';
    video.play().catch(() => {});
  } else {
    $('playerLoading').textContent = '浏览器不支持 HLS 播放';
  }
}

// ---------- 返回 ----------
$('backBtn').onclick = () => {
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  $('player').removeAttribute('src');
  $('player').load();
  showView('browse');
  document.title = '4kvms 影视客户端';
};
$('brand').onclick = () => $('backBtn').click();

// ---------- 初始化 ----------
renderTabs();
renderFilters();
loadList();
