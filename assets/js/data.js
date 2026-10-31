/**
 * 市场数据层：只读静态 JSON（无后端、无构建）。
 *
 * 真实数据契约：docs/52 §3
 *   data/catalog.json                      资源目录（索引/卡片）
 *   data/packages/<id>.shadowcourse        课程包（详情页必须再 fetch，句子/时长/README 以包为准）
 *   plugins/index.json + plugins/<type>/manifest.json   资源类型声明（"一切即插件"）
 *
 * 降级：真实目录 fetch 失败（数据未生成 / 静态托管缺文件）→ 抛错由视图展示「数据未生成」，
 *       并提供「加载演示夹具」开关（assets/dev-fixtures/，页面持续显示"演示夹具"标记，不冒充真数据）。
 */

export const DATA_URLS = Object.freeze({
  catalog: 'data/catalog.json',
  pluginsIndex: 'plugins/index.json',
  fixtureCatalog: 'assets/dev-fixtures/catalog.json',
});

const FIXTURE_FLAG = 'shadow.market.fixture.v1';

/** 未知资源类型的降级渲染器（不崩、不白屏） */
export const GENERIC_PLUGIN = Object.freeze({
  manifestVersion: 1,
  kind: 'resource-type',
  id: 'generic',
  label: '通用资源',
  labelEn: 'Generic',
  description: '未注册的资源类型：市场无法识别其插件清单，使用通用卡片与降级详情展示。',
  icon: 'box',
  color: '#8b949e',
  fileExt: [],
  detailTabs: ['readme', 'files', 'versions'],
  cardBadges: ['free'],
  statsFields: [],
  install: { mode: 'download-only', deepLink: '' },
  permissions: { network: false, filesystem: false, microphone: false },
  enabled: true,
  fallback: true,
});

const state = {
  catalog: null,
  catalogError: null,
  fixture: false,
  loading: true,
  plugins: [],
  pluginMap: new Map(),
  pluginErrors: [],
  packages: new Map(), // packageUrl → { status, pkg, error, bytes }
};

export function getState() { return state; }

export function isFixtureMode() {
  if (state.fixture) return true;
  try { return sessionStorage.getItem(FIXTURE_FLAG) === '1'; } catch { return false; }
}

function setFixtureFlag(on) {
  try {
    if (on) sessionStorage.setItem(FIXTURE_FLAG, '1');
    else sessionStorage.removeItem(FIXTURE_FLAG);
  } catch { /* 隐私模式忽略 */ }
}

/* ---------------- 插件（资源类型）声明 ---------------- */

async function fetchJson(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-cache', headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
      err.status = res.status;
      err.url = url;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function loadPlugins() {
  state.plugins = [];
  state.pluginMap = new Map();
  state.pluginErrors = [];
  let index = null;
  try {
    index = await fetchJson(DATA_URLS.pluginsIndex);
  } catch (err) {
    state.pluginErrors.push({ url: DATA_URLS.pluginsIndex, message: describeError(err) });
    console.warn('[market] 插件登记表读取失败，使用内置降级渲染器:', describeError(err));
  }

  const ids = Array.isArray(index?.plugins) ? index.plugins.slice(0, 64) : ['course', 'plugin', 'subtitle'];
  const results = await Promise.all(ids.map(async (id) => {
    const safeId = String(id).replace(/[^a-z0-9._-]/gi, '');
    try {
      const manifest = await fetchJson(`plugins/${safeId}/manifest.json`);
      return { id: safeId, manifest, error: null };
    } catch (err) {
      return { id: safeId, manifest: null, error: describeError(err) };
    }
  }));

  for (const row of results) {
    if (row.manifest && row.manifest.kind === 'resource-type' && row.manifest.id) {
      const manifest = normalizePlugin(row.manifest);
      state.plugins.push(manifest);
      state.pluginMap.set(manifest.id, manifest);
    } else {
      state.pluginErrors.push({ url: `plugins/${row.id}/manifest.json`, message: row.error || 'manifest 不完整' });
    }
  }

  if (state.plugins.length === 0) {
    // 极端降级：插件目录不可用也不能白屏——至少注册 course 类型
    const minimal = normalizePlugin({ ...GENERIC_PLUGIN, id: 'course', label: '课程包', icon: 'book', detailTabs: ['readme', 'files', 'versions'] });
    state.plugins.push(minimal);
    state.pluginMap.set('course', minimal);
  }
  return state.plugins;
}

function normalizePlugin(raw) {
  const id = String(raw.id || 'unknown');
  const tabs = Array.isArray(raw.detailTabs) && raw.detailTabs.length ? raw.detailTabs.map(String) : ['readme', 'files', 'versions'];
  return Object.freeze({
    manifestVersion: raw.manifestVersion ?? 1,
    kind: raw.kind || 'resource-type',
    id,
    label: String(raw.label || id),
    labelEn: String(raw.labelEn || id),
    description: String(raw.description || ''),
    icon: String(raw.icon || 'box'),
    color: String(raw.color || '#8b949e'),
    fileExt: Array.isArray(raw.fileExt) ? raw.fileExt.map(String) : [],
    detailTabs: tabs,
    cardBadges: Array.isArray(raw.cardBadges) ? raw.cardBadges.map(String) : ['free'],
    statsFields: Array.isArray(raw.statsFields) ? raw.statsFields.map(String) : [],
    install: raw.install && typeof raw.install === 'object' ? { ...raw.install } : { mode: 'download-only', deepLink: '' },
    permissions: raw.permissions && typeof raw.permissions === 'object' ? { ...raw.permissions } : {},
    enabled: raw.enabled !== false,
    fallback: raw.fallback === true,
  });
}

export function pluginFor(type) {
  return state.pluginMap.get(String(type || '')) || GENERIC_PLUGIN;
}

export function enabledPlugins() { return state.plugins.filter((p) => p.enabled); }

/* ---------------- 资源目录 ---------------- */

export async function loadCatalog({ fixture = false } = {}) {
  state.loading = true;
  state.catalogError = null;
  const url = fixture ? DATA_URLS.fixtureCatalog : DATA_URLS.catalog;
  try {
    const raw = await fetchJson(url);
    if (!raw || raw.spec !== 'shadow.market.catalog') {
      throw new Error(`目录格式不识别：spec=${raw && raw.spec ? raw.spec : '缺失'}（期望 shadow.market.catalog）`);
    }
    if (!Array.isArray(raw.resources)) throw new Error('目录缺少 resources 数组');
    state.catalog = normalizeCatalog(raw, { fixture });
    state.fixture = fixture;
    setFixtureFlag(fixture);
    state.catalogError = null;
    return state.catalog;
  } catch (err) {
    state.catalog = null;
    state.fixture = false;
    state.catalogError = { ...describeError(err), url, fixtureTried: fixture };
    if (fixture) setFixtureFlag(false);
    throw state.catalogError;
  } finally {
    state.loading = false;
  }
}

function normalizeCatalog(raw, { fixture }) {
  const categories = (Array.isArray(raw.categories) ? raw.categories : []).map((c) => ({
    id: String(c.id || ''),
    label: String(c.label || c.id || ''),
    labelEn: String(c.labelEn || ''),
    count: Number(c.count) || 0,
  })).filter((c) => c.id);

  const creators = (Array.isArray(raw.creators) ? raw.creators : []).map((c) => ({
    handle: String(c.handle || ''),
    name: String(c.name || c.handle || ''),
    bio: String(c.bio || ''),
    avatarColor: String(c.avatarColor || '#2EE6A8'),
  })).filter((c) => c.handle);

  const creatorMap = new Map(creators.map((c) => [c.handle, c]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  const resources = (Array.isArray(raw.resources) ? raw.resources : []).map((r, idx) => {
    const stats = r.stats && typeof r.stats === 'object' ? r.stats : {};
    return {
      id: String(r.id || `unknown-${idx}`),
      type: String(r.type || 'unknown'),
      title: String(r.title || r.id || '未命名资源'),
      subtitle: String(r.subtitle || ''),
      description: String(r.description || ''),
      category: String(r.category || ''),
      level: String(r.level || ''),
      tags: Array.isArray(r.tags) ? r.tags.map(String).slice(0, 12) : [],
      creator: String(r.creator || ''),
      license: String(r.license || ''),
      version: String(r.version || ''),
      points: Number(r.points) || 0,
      free: r.free !== false,
      updatedAt: r.updatedAt || r.packageUpdatedAt || '',
      createdAt: r.createdAt || '',
      downloads: Number(r.downloads) || 0,
      stats: {
        sentences: Number(stats.sentences) || 0,
        durationSec: Number(stats.durationSec) || 0,
        words: Number(stats.words) || 0,
      },
      cover: {
        color1: String(r.cover?.color1 || '#1B4D3E'),
        color2: String(r.cover?.color2 || '#2EE6A8'),
      },
      packageUrl: String(r.packageUrl || ''),
      readme: String(r.readme || ''),
      requires: r.requires && typeof r.requires === 'object' ? r.requires : {},
      fixture: fixture || r.fixture === true,
      categoryLabel: categoryMap.get(String(r.category || ''))?.label || '',
      creatorName: creatorMap.get(String(r.creator || ''))?.name || String(r.creator || ''),
    };
  });

  return {
    spec: raw.spec,
    schemaVersion: raw.schemaVersion ?? 1,
    generatedAt: String(raw.generatedAt || ''),
    fixture: Boolean(fixture),
    site: {
      name: String(raw.site?.name || 'SHADOW 市场'),
      tagline: String(raw.site?.tagline || ''),
      baseUrl: String(raw.site?.baseUrl || ''),
    },
    categories,
    creators,
    creatorMap,
    categoryMap,
    resources,
  };
}

export function resourceById(id) {
  if (!state.catalog) return null;
  return state.catalog.resources.find((r) => r.id === String(id)) || null;
}

export function creatorByHandle(handle) {
  if (!state.catalog) return null;
  return state.catalog.creatorMap.get(String(handle || '').replace(/^@/, '')) || null;
}

export function categoryById(id) {
  if (!state.catalog) return null;
  return state.catalog.categoryMap.get(String(id || '')) || null;
}

export function typeCounts() {
  const counts = new Map();
  for (const r of state.catalog?.resources || []) counts.set(r.type, (counts.get(r.type) || 0) + 1);
  return counts;
}

/* ---------------- 搜索 / 排序 ---------------- */

/**
 * 搜索别名：让中英关键词互相命中（P0 静态站无全文索引，只做演示级别名）。
 * 例：搜 "coffee" 命中「在咖啡店点单」，搜 "面试" 命中 interview。
 */
const SEARCH_ALIASES = {
  coffee: ['咖啡', 'café', 'cafe'],
  咖啡: ['coffee', 'cafe', 'café'],
  cafe: ['咖啡', 'coffee'],
  café: ['咖啡', 'coffee'],
  direction: ['问路', '方向', 'directions'],
  directions: ['问路', '方向', 'direction'],
  问路: ['direction', 'directions', 'way'],
  interview: ['面试', '自我介绍', 'interviewing'],
  面试: ['interview', '自我介绍'],
  podcast: ['播客', '听力'],
  播客: ['podcast', '听力'],
  movie: ['影视', '电影', '片段'],
  影视: ['movie', 'film', '片段'],
  shadowing: ['跟读', '影子跟读'],
  跟读: ['shadowing', 'shadow'],
  travel: ['旅行', '出行'],
  旅行: ['travel', 'trip'],
  daily: ['日常', '会话'],
  日常: ['daily'],
  work: ['职场', '工作'],
  职场: ['work', 'job'],
  byom: ['自备媒体', '媒体'],
  自备媒体: ['byom'],
};

function resourceHaystack(resource) {
  if (resource.__haystack) return resource.__haystack;
  const creator = state.catalog?.creatorMap.get(resource.creator);
  const category = state.catalog?.categoryMap.get(resource.category);
  const parts = [
    resource.id, resource.title, resource.subtitle, resource.description,
    resource.tags.join(' '), resource.level, resource.category,
    category?.label || '', category?.labelEn || '',
    resource.creator, creator?.name || '',
    resource.type, pluginFor(resource.type).label,
  ];
  resource.__haystack = parts.join('\n').toLowerCase();
  return resource.__haystack;
}

function queryTerms(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/[\s,，、/]+/).filter(Boolean).slice(0, 8);
  const terms = [];
  for (const token of tokens) {
    terms.push(token);
    for (const alias of SEARCH_ALIASES[token] || []) {
      if (!terms.includes(alias.toLowerCase())) terms.push(alias.toLowerCase());
    }
  }
  return terms;
}

export function searchResources(query, { category = '', type = '' } = {}) {
  const all = state.catalog?.resources || [];
  let list = all;
  if (category) list = list.filter((r) => r.category === category);
  if (type) list = list.filter((r) => r.type === type);
  const terms = queryTerms(query);
  if (terms.length) {
    const tokenGroups = String(query).trim().toLowerCase().split(/[\s,，、/]+/).filter(Boolean).slice(0, 8);
    list = list.filter((r) => {
      const hay = resourceHaystack(r);
      return tokenGroups.every((token) => {
        const variants = [token, ...(SEARCH_ALIASES[token] || []).map((a) => String(a).toLowerCase())];
        return variants.some((v) => hay.includes(v));
      });
    });
  }
  return list;
}

export const SORTS = Object.freeze([
  { id: 'updated', label: '最近更新' },
  { id: 'name', label: '名称 A→Z' },
  { id: 'downloads', label: '下载量' },
  { id: 'sentences', label: '句子数' },
]);

export function sortResources(list, sort = 'updated') {
  const copy = list.slice();
  switch (sort) {
    case 'name':
      copy.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
      break;
    case 'downloads':
      copy.sort((a, b) => b.downloads - a.downloads || a.title.localeCompare(b.title, 'zh-Hans-CN'));
      break;
    case 'sentences':
      copy.sort((a, b) => (b.stats?.sentences || 0) - (a.stats?.sentences || 0) || a.title.localeCompare(b.title, 'zh-Hans-CN'));
      break;
    case 'updated':
    default:
      copy.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      break;
  }
  return copy;
}

/* ---------------- 课程包 ---------------- */

/** 详情页必须 fetch 包文件：句子预览/字数/时长/README 以包为准 */
export async function loadPackage(packageUrl, { force = false } = {}) {
  const url = String(packageUrl || '');
  if (!url) return { status: 'missing', pkg: null, error: '该资源没有 packageUrl（可能不是课程包类型）' };
  if (!force && state.packages.has(url)) return state.packages.get(url);

  const entry = { status: 'loading', pkg: null, error: null, bytes: null, url };
  state.packages.set(url, entry);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal, cache: 'no-cache', headers: { Accept: 'application/json' } });
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    let pkg;
    try {
      pkg = JSON.parse(text);
    } catch {
      throw Object.assign(new Error('包文件不是合法 JSON（P0 格式为单文件 JSON）'), { code: 'E_JSON' });
    }
    if (!pkg || pkg.spec !== 'shadow.course') {
      throw Object.assign(new Error(`包格式不识别：spec=${pkg && pkg.spec ? pkg.spec : '缺失'}（期望 shadow.course）`), { code: 'E_SCHEMA' });
    }
    if (!Array.isArray(pkg.sentences) || pkg.sentences.length === 0) {
      throw Object.assign(new Error('包内 sentences 为空或缺失'), { code: 'E_SCHEMA' });
    }
    const good = {
      status: 'ok', pkg, url, bytes: new Blob([text]).size, error: null,
      stats: computePackageStats(pkg),
    };
    state.packages.set(url, good);
    return good;
  } catch (err) {
    const failed = { status: 'error', pkg: null, error: describeError(err), url, bytes: null };
    state.packages.set(url, failed);
    return failed;
  }
}

export function computePackageStats(pkg) {
  const sentences = Array.isArray(pkg?.sentences) ? pkg.sentences : [];
  const text = sentences.map((s) => String(s?.text || '')).join(' ');
  // 保留撇号（That'll / I've 算 1 个词），与课程包 README 的「词数」口径一致
  const words = text.split(/[\s,.;:!?"()\[\]]+/).filter((w) => /[a-zA-Z0-9]/.test(w)).length;
  const ends = sentences.map((s) => Number(s?.end)).filter((n) => Number.isFinite(n));
  const starts = sentences.map((s) => Number(s?.start)).filter((n) => Number.isFinite(n));
  const lastEnd = ends.length ? Math.max(...ends) : 0;
  const firstStart = starts.length ? Math.min(...starts) : 0;
  return {
    sentences: sentences.length,
    words,
    durationSec: Math.max(0, lastEnd - firstStart),
    timelineEnd: lastEnd,
    hasWords: sentences.some((s) => Array.isArray(s?.words) && s.words.length > 0),
  };
}

export function clearPackageCache() { state.packages.clear(); }

export function describeError(err) {
  if (!err) return { message: '未知错误' };
  if (err.name === 'AbortError') return { code: 'E_TIMEOUT', message: '请求超时（20 秒）：网络或本地服务无响应' };
  const status = err.status ? `HTTP ${err.status}` : '';
  if (err.code) return { code: err.code, message: `${status ? `${status} · ` : ''}${err.message}`, status: err.status };
  return { message: `${status ? `${status} · ` : ''}${err.message || String(err)}`, status: err.status };
}

/** 数据缺失时展示的生成命令提示（真实命令由 shadowcourse 提供） */
export const DATA_HINT = 'node tools/shadowcourse/build-packages.mjs';
