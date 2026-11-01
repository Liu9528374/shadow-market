/**
 * 市场数据层：只读静态 JSON（无后端、无构建）。
 *
 * 数据契约（schemaVersion 2，由构建流水线生成）：
 *   catalog/site.json        { spec, schemaVersion, generatedAt, items }
 *   catalog/categories.json  分类
 *   catalog/tags.json        标签（tag / aliases / label / labelEn）
 *   catalog/authors.json     作者（handle / name / bio / url / licenseDefault）
 *   catalog/licenses.json    许可（id / name / url / fullText / rightsNotes）
 *   catalog/resources.json   资源索引（卡片 + 明细 + versions[]）
 *   data/packages/*.shadowcourse                    规范课程包
 *   data/import/*.shadow.json / *.srt / *README.txt  派生导入产物（versions[0].importFiles）
 *   plugins/index.json + plugins/<type>/manifest.json 声明式资源类型（一切即插件）
 *
 * 兼容：catalog v2 文件缺失时自动回退旧 data/catalog.json（schemaVersion 1，只读兼容层），
 *       旧字段被归一化到同一内部模型，视图只消费统一模型。
 * 降级：真实目录 fetch 失败 → 抛错，由 app.js 展示「数据未生成」并提供演示夹具开关。
 */

export const DATA_URLS = Object.freeze({
  catalog: 'data/catalog.json',
  dir: 'catalog/',
  site: 'catalog/site.json',
  categories: 'catalog/categories.json',
  tags: 'catalog/tags.json',
  authors: 'catalog/authors.json',
  licenses: 'catalog/licenses.json',
  resources: 'catalog/resources.json',
  pluginsIndex: 'plugins/index.json',
  builtinWhitelist: 'data/plugins/builtin-whitelist.json',
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

export const DATA_HINT = 'node tools/catalog/build-catalog.mjs';

const state = {
  catalog: null,
  catalogError: null,
  fixture: false,
  loading: true,
  schemaVersion: 0,
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

/* ---------------- 通用 fetch ---------------- */

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

/** 可选文件：缺失/失败返回 null（不抛错、不 console.error） */
async function fetchJsonOptional(url) {
  try { return await fetchJson(url, { timeoutMs: 8000 }); } catch { return null; }
}

async function fetchTextOptional(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: 'no-cache', headers: { Accept: 'text/plain' } });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

/** 从 {spec,schemaVersion,generatedAt,items} 或裸数组/对象里取 items 数组 */
function itemsArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.items)) return raw.items;
  if (raw.items && typeof raw.items === 'object') return [raw.items];
  return [];
}

/** items 为对象时取对象本体（单一站点信息） */
function itemsObject(raw) {
  if (!raw || typeof raw !== 'object') return {};
  if (Array.isArray(raw.items)) return raw.items[0] || {};
  if (raw.items && typeof raw.items === 'object') return raw.items;
  return raw;
}

/* ---------------- 插件（资源类型）声明 ---------------- */

const KNOWN_PLUGIN_TYPES = ['course', 'subtitle', 'plugin'];

export async function loadPlugins() {
  state.plugins = [];
  state.pluginMap = new Map();
  state.pluginErrors = [];

  // 性能：登记表与已知类型 manifest 并行请求（少 1 个 RTT）；未知类型等登记表返回后再补拉
  const indexPromise = fetchJson(DATA_URLS.pluginsIndex).catch((err) => {
    state.pluginErrors.push({ url: DATA_URLS.pluginsIndex, message: describeError(err) });
    console.warn('[market] 插件登记表读取失败，使用内置降级渲染器:', describeError(err));
    return null;
  });
  const fetchManifest = async (manifestUrl) => {
    try {
      return { manifestUrl, manifest: await fetchJson(manifestUrl, { timeoutMs: 10000 }), error: null };
    } catch (err) {
      return { manifestUrl, manifest: null, error: describeError(err) };
    }
  };
  const knownResults = await Promise.all(KNOWN_PLUGIN_TYPES.map((id) => fetchManifest(`plugins/${id}/manifest.json`)));
  const index = await indexPromise;

  // 兼容两种登记表：{types:[{id,manifest,enabled}]}（v2）与 {plugins:["course",...]}（旧）
  const entries = [];
  if (Array.isArray(index?.types)) {
    for (const row of index.types) {
      if (!row) continue;
      const id = String(typeof row === 'string' ? row : row.id || '').replace(/[^a-z0-9._-]/gi, '');
      if (!id) continue;
      entries.push({ id, manifest: typeof row === 'object' && row.manifest ? String(row.manifest) : `plugins/${id}/manifest.json`, enabled: row.enabled !== false });
    }
  } else if (Array.isArray(index?.plugins)) {
    for (const id of index.plugins) {
      const safeId = String(id || '').replace(/[^a-z0-9._-]/gi, '');
      if (safeId) entries.push({ id: safeId, manifest: `plugins/${safeId}/manifest.json`, enabled: true });
    }
  }
  // 登记表里出现、但不在已知并行列表中的类型：补拉 manifest
  const knownSet = new Set(KNOWN_PLUGIN_TYPES);
  const extraEntries = entries.filter((entry) => !knownSet.has(entry.id)).slice(0, 32);
  const extraResults = await Promise.all(extraEntries.map((entry) => fetchManifest(entry.manifest)));
  const results = [...knownResults, ...extraResults];
  const enabledMap = new Map(entries.map((entry) => [entry.id, entry.enabled]));

  for (const row of results) {
    if (row.manifest && row.manifest.kind === 'resource-type' && row.manifest.id) {
      const manifest = normalizePlugin({ ...row.manifest, enabled: enabledMap.get(row.manifest.id) !== false });
      state.plugins.push(manifest);
      state.pluginMap.set(manifest.id, manifest);
    } else {
      state.pluginErrors.push({ url: row.manifestUrl, message: row.error || 'manifest 不完整' });
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

/** 内置资源类型的默认展示标签（插件清单未加载时的首屏兜底；清单加载后仍以清单为准） */
const BUILTIN_TYPE_LABELS = Object.freeze({
  course: { label: '课程包', labelEn: 'Course pack', icon: 'book-open' },
  subtitle: { label: '字幕包', labelEn: 'Subtitle pack', icon: 'file-text' },
  plugin: { label: '插件说明', labelEn: 'Plugin notes', icon: 'layers' },
  generic: { label: '通用资源', labelEn: 'Generic', icon: 'info' },
});

export function pluginFor(type) {
  const found = state.pluginMap.get(String(type || ''));
  if (found) return found;
  const fallback = BUILTIN_TYPE_LABELS[String(type || '')] || BUILTIN_TYPE_LABELS.generic;
  return { ...GENERIC_PLUGIN, id: String(type || 'generic'), label: fallback.label, labelEn: fallback.labelEn, icon: fallback.icon };
}

export function enabledPlugins() { return state.plugins.filter((p) => p.enabled); }

/* ---------------- 资源目录 ---------------- */

export async function loadCatalog({ fixture = false } = {}) {
  state.loading = true;
  state.catalogError = null;
  try {
    if (fixture) {
      const raw = await fetchJson(DATA_URLS.fixtureCatalog);
      state.catalog = normalizeLegacyCatalog(raw, { fixture: true });
      state.schemaVersion = 1;
    } else {
      try {
        state.catalog = await loadCatalogV2();
        state.schemaVersion = 2;
      } catch (errV2) {
        // v2 数据还没生成 → 兼容旧 data/catalog.json（只读兼容层）
        const raw = await fetchJson(DATA_URLS.catalog);
        state.catalog = normalizeLegacyCatalog(raw, { fixture: false });
        state.schemaVersion = 1;
        console.warn('[market] catalog v2 不可用，已回退旧 data/catalog.json：', errV2?.message || errV2);
      }
    }
    state.fixture = fixture;
    setFixtureFlag(fixture);
    state.catalogError = null;
    return state.catalog;
  } catch (err) {
    state.catalog = null;
    state.fixture = false;
    state.catalogError = { ...describeError(err), url: err?.url || (fixture ? DATA_URLS.fixtureCatalog : DATA_URLS.resources) };
    if (fixture) setFixtureFlag(false);
    throw state.catalogError;
  } finally {
    state.loading = false;
  }
}

async function loadCatalogV2() {
  const [siteRaw, categoriesRaw, tagsRaw, authorsRaw, licensesRaw, resourcesRaw] = await Promise.all([
    fetchJsonOptional(DATA_URLS.site),
    fetchJsonOptional(DATA_URLS.categories),
    fetchJsonOptional(DATA_URLS.tags),
    fetchJsonOptional(DATA_URLS.authors),
    fetchJsonOptional(DATA_URLS.licenses),
    fetchJsonOptional(DATA_URLS.resources),
  ]);
  const resourcesItems = itemsArray(resourcesRaw);
  if (!resourcesRaw || resourcesItems.length === 0) {
    throw new Error('catalog/resources.json 缺失或 items 为空');
  }
  return normalizeV2Catalog({ siteRaw, categoriesRaw, tagsRaw, authorsRaw, licensesRaw, resourcesRaw, resourcesItems });
}

function normalizeLicense(raw) {
  return {
    id: String(raw.id || raw.license || ''),
    name: String(raw.name || raw.id || ''),
    nameEn: String(raw.nameEn || raw.name || raw.id || ''),
    url: String(raw.url || ''),
    fullText: String(raw.fullText || ''),
    rightsNotes: String(raw.rightsNotes || raw.notes || ''),
  };
}

function normalizeTag(raw) {
  if (typeof raw === 'string') return { tag: raw, aliases: [], label: raw, labelEn: raw };
  const tag = String(raw.tag || raw.id || raw.name || '').trim();
  return {
    tag,
    aliases: Array.isArray(raw.aliases) ? raw.aliases.map(String) : [],
    label: String(raw.label || tag),
    labelEn: String(raw.labelEn || raw.label || tag),
    count: Number(raw.count) || 0,
  };
}

function normalizeAuthor(raw) {
  return {
    handle: String(raw.handle || raw.id || '').trim(),
    name: String(raw.name || raw.handle || ''),
    bio: String(raw.bio || raw.description || ''),
    bioEn: String(raw.bioEn || ''),
    url: String(raw.url || ''),
    licenseDefault: String(raw.licenseDefault || ''),
    avatarColor: String(raw.avatarColor || raw.color || '#E88A2E'),
  };
}

function normalizeCategory(raw, idx) {
  const id = String(raw.id || '').trim();
  return {
    id,
    label: String(raw.label || id),
    labelEn: String(raw.labelEn || raw.label || id),
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : idx,
    description: String(raw.description || ''),
    count: Number(raw.count) || 0,
  };
}

function normalizeVersion(raw) {
  const importFiles = raw?.importFiles && typeof raw.importFiles === 'object' ? raw.importFiles : {};
  const changelog = Array.isArray(raw?.changelog)
    ? raw.changelog.map(String).filter(Boolean)
    : String(raw?.changelog || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  return {
    version: String(raw?.version || ''),
    packageUrl: String(raw?.packageUrl || ''),
    sha256: String(raw?.sha256 || ''),
    sizeBytes: Number(raw?.sizeBytes) || 0,
    compat: raw?.compat && typeof raw.compat === 'object' ? { ...raw.compat } : {},
    changelog,
    publishedAt: String(raw?.publishedAt || raw?.updatedAt || ''),
    downloads: Number(raw?.downloads) || 0,
    importFiles: {
      shadowJson: String(importFiles.shadowJson || raw?.shadowJsonUrl || ''),
      srt: String(importFiles.srt || raw?.srtUrl || ''),
      readme: String(importFiles.readme || raw?.readmeUrl || ''),
    },
  };
}

function normalizeStats(raw, version) {
  const stats = raw && typeof raw === 'object' ? raw : {};
  return {
    sentences: Number(stats.sentences) || 0,
    durationSec: Number(stats.durationSec) || 0,
    words: Number(stats.words) || 0,
    sizeBytes: Number(stats.sizeBytes) || Number(version?.sizeBytes) || 0,
    sha256: String(stats.sha256 || version?.sha256 || ''),
  };
}

function normalizeResourceV2(raw, maps) {
  const id = String(raw.id || '');
  const author = String(raw.author || raw.creator || '');
  const category = String(raw.category || '');
  const license = String(raw.license || '');
  const versions = (Array.isArray(raw.versions) ? raw.versions : []).map(normalizeVersion);
  const version = versions[0] || normalizeVersion({});
  const pkg = normalizeStats(raw.stats, version);
  const categoryInfo = maps.categoryMap.get(category);
  const authorInfo = maps.authorMap.get(author);
  const licenseInfo = maps.licenseMap.get(license);
  const cover = raw.cover && typeof raw.cover === 'object' ? raw.cover : {};
  return {
    id,
    type: String(raw.type || 'unknown'),
    title: String(raw.title || id || '未命名资源'),
    subtitle: String(raw.subtitle || ''),
    description: String(raw.description || ''),
    category,
    categoryLabel: categoryInfo?.label || category,
    categoryLabelEn: categoryInfo?.labelEn || categoryInfo?.label || category,
    level: String(raw.level || ''),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String).slice(0, 24) : [],
    author,
    creator: author, // 兼容旧组件字段名
    authorName: authorInfo?.name || author,
    license,
    licenseName: licenseInfo?.name || license,
    rights: raw.rights && typeof raw.rights === 'object' ? { ...raw.rights } : {},
    mediaMode: String(raw.mediaMode || 'byom'),
    language: Array.isArray(raw.language) ? raw.language.map(String) : ['en'],
    points: Number(raw.points) || 0,
    free: raw.free !== false && !(Number(raw.points) > 0),
    platforms: Array.isArray(raw.platforms) ? raw.platforms.map(String) : [],
    requires: raw.requires && typeof raw.requires === 'object' ? { ...raw.requires } : {},
    cover: {
      color1: String(cover.color1 || '#3A2410'),
      color2: String(cover.color2 || '#E88A2E'),
      image: String(cover.image || ''),
    },
    stats: pkg,
    readme: String(raw.readme || ''),
    mediaName: String(raw.mediaName || ''),
    versions,
    version: version.version,
    packageUrl: String(raw.packageUrl || version.packageUrl || ''),
    importFiles: version.importFiles,
    changelog: version.changelog,
    downloads: Number(raw.downloads ?? version.downloads) || 0,
    featured: raw.featured === true,
    createdAt: String(raw.createdAt || version.publishedAt || ''),
    updatedAt: String(raw.updatedAt || version.publishedAt || ''),
    importFilesAvailable: Boolean(version.importFiles.shadowJson || version.importFiles.srt),
    fixture: false,
  };
}

function normalizeV2Catalog({ siteRaw, categoriesRaw, tagsRaw, authorsRaw, licensesRaw, resourcesRaw, resourcesItems }) {
  const site = itemsObject(siteRaw);
  const categories = itemsArray(categoriesRaw).map(normalizeCategory).filter((c) => c.id);
  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const authors = itemsArray(authorsRaw).map(normalizeAuthor).filter((a) => a.handle);
  const authorMap = new Map(authors.map((a) => [a.handle, a]));
  const licenses = itemsArray(licensesRaw).map(normalizeLicense).filter((l) => l.id);
  const licenseMap = new Map(licenses.map((l) => [l.id, l]));
  const tags = itemsArray(tagsRaw).map(normalizeTag).filter((tg) => tg.tag);
  const tagMap = new Map(tags.map((tg) => [tg.tag.toLowerCase(), tg]));

  const resources = resourcesItems.map((r) => normalizeResourceV2(r, { categoryMap, authorMap, licenseMap })).filter((r) => r.id);
  // 兜底派生：资源里出现但 authors/ licenses 未见到的作者与许可（不崩）
  for (const r of resources) {
    if (!authorMap.has(r.author) && r.author) {
      const derived = normalizeAuthor({ handle: r.author, name: r.author });
      authors.push(derived);
      authorMap.set(derived.handle, derived);
    }
    if (!licenseMap.has(r.license) && r.license) {
      const derived = normalizeLicense({ id: r.license, name: r.license });
      licenses.push(derived);
      licenseMap.set(derived.id, derived);
    }
    const cat = categoryMap.get(r.category);
    if (!cat && r.category) {
      const derived = normalizeCategory({ id: r.category, label: r.category }, categories.length);
      categories.push(derived);
      categoryMap.set(derived.id, derived);
    }
  }
  // 分类/标签计数（以资源实际数量为准）
  for (const c of categories) c.count = resources.filter((r) => r.category === c.id).length;
  for (const tg of tags) tg.count = resources.filter((r) => r.tags.some((x) => x.toLowerCase() === tg.tag.toLowerCase())).length;
  const tagCounts = new Map();
  for (const r of resources) for (const tag of r.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);

  return {
    spec: resourcesRaw.spec || 'shadow.market.resources',
    schemaVersion: 2,
    generatedAt: String(resourcesRaw.generatedAt || site.generatedAt || ''),
    fixture: false,
    site: {
      name: String(site.name || 'SHADOW 市场'),
      nameEn: String(site.nameEn || 'SHADOW Market'),
      tagline: String(site.tagline || '全免费 · 积分兑换 · 本地优先'),
      taglineEn: String(site.taglineEn || ''),
      description: String(site.description || ''),
      descriptionEn: String(site.descriptionEn || ''),
      baseUrl: String(site.baseUrl || ''),
      version: String(site.version || ''),
      build: String(site.build || site.version || ''),
      locales: Array.isArray(site.languages) ? site.languages.map(String) : ['zh-CN', 'en'],
      nav: Array.isArray(site.nav) ? site.nav : [],
    },
    categories,
    categoryMap,
    authors,
    authorMap,
    creators: authors, // 兼容旧组件字段名
    creatorMap: authorMap,
    licenses,
    licenseMap,
    tags,
    tagMap,
    tagCounts,
    resources,
  };
}

function normalizeLegacyCatalog(raw, { fixture }) {
  if (!raw || (raw.spec !== 'shadow.market.catalog' && !Array.isArray(raw.resources))) {
    const err = new Error(`目录格式不识别：spec=${raw && raw.spec ? raw.spec : '缺失'}（期望 shadow.market.catalog 或 catalog/resources.json）`);
    throw err;
  }
  const categories = (Array.isArray(raw.categories) ? raw.categories : []).map((c, idx) => ({
    ...normalizeCategory(c, idx),
    count: Number(c.count) || 0,
  })).filter((c) => c.id);
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  const authors = (Array.isArray(raw.creators) ? raw.creators : Array.isArray(raw.authors) ? raw.authors : []).map(normalizeAuthor).filter((a) => a.handle);
  const authorMap = new Map(authors.map((a) => [a.handle, a]));

  const licenseRegistry = new Map();
  const licensesRaw = Array.isArray(raw.licenses) ? raw.licenses : [];
  for (const l of licensesRaw) {
    const lic = normalizeLicense(l);
    if (lic.id) licenseRegistry.set(lic.id, lic);
  }
  if (licenseRegistry.size === 0 && Array.isArray(raw.resources)) {
    for (const r of raw.resources) {
      const id = String(r.license || '');
      if (id && !licenseRegistry.has(id)) licenseRegistry.set(id, normalizeLicense({ id, name: id }));
    }
  }
  const licenses = Array.from(licenseRegistry.values());
  const licenseMap = new Map(licenses.map((l) => [l.id, l]));

  const tagsRaw = new Map();
  const resources = (Array.isArray(raw.resources) ? raw.resources : []).map((r, idx) => {
    const id = String(r.id || `unknown-${idx}`);
    const author = String(r.creator || r.author || '');
    const category = String(r.category || '');
    const categoryInfo = categoryMap.get(category);
    const authorInfo = authorMap.get(author);
    const stats = r.stats && typeof r.stats === 'object' ? r.stats : {};
    const packageUrl = String(r.packageUrl || '');
    const version = normalizeVersion({
      version: r.version || '',
      packageUrl,
      sha256: stats.sha256 || '',
      sizeBytes: stats.sizeBytes || 0,
      changelog: [],
      publishedAt: r.updatedAt || r.packageUpdatedAt || '',
    });
    const tags = Array.isArray(r.tags) ? r.tags.map(String) : [];
    for (const tg of tags) if (!tagsRaw.has(tg)) tagsRaw.set(tg, normalizeTag({ tag: tg }));
    return {
      id,
      type: String(r.type || 'course'),
      title: String(r.title || id || '未命名资源'),
      subtitle: String(r.subtitle || ''),
      description: String(r.description || ''),
      category,
      categoryLabel: categoryInfo?.label || category,
      categoryLabelEn: categoryInfo?.labelEn || categoryInfo?.label || category,
      level: String(r.level || ''),
      tags,
      author,
      creator: author,
      authorName: authorInfo?.name || author,
      license: String(r.license || ''),
      licenseName: licenseMap.get(String(r.license || ''))?.name || String(r.license || ''),
      rights: r.rights && typeof r.rights === 'object' ? { ...r.rights } : {},
      mediaMode: String(r.mediaMode || 'byom'),
      language: Array.isArray(r.language) ? r.language.map(String) : ['en'],
      points: Number(r.points) || 0,
      free: r.free !== false && !(Number(r.points) > 0),
      platforms: Array.isArray(r.platforms) ? r.platforms.map(String) : [],
      requires: r.requires && typeof r.requires === 'object' ? r.requires : {},
      cover: {
        color1: String(r.cover?.color1 || '#3A2410'),
        color2: String(r.cover?.color2 || '#E88A2E'),
        image: String(r.cover?.image || ''),
      },
      stats: normalizeStats(stats, version),
      readme: String(r.readme || ''),
      mediaName: String(r.mediaName || ''),
      versions: [version],
      version: version.version,
      packageUrl,
      importFiles: version.importFiles,
      changelog: version.changelog,
      downloads: Number(r.downloads) || 0,
      featured: r.featured === true,
      createdAt: String(r.createdAt || ''),
      updatedAt: String(r.updatedAt || r.packageUpdatedAt || ''),
      importFilesAvailable: Boolean(version.importFiles.shadowJson || version.importFiles.srt),
      fixture: fixture || r.fixture === true,
    };
  });

  const tags = Array.from(tagsRaw.values());
  const tagMap = new Map(tags.map((tg) => [tg.tag.toLowerCase(), tg]));
  for (const tg of tags) tg.count = resources.filter((r) => r.tags.some((x) => x.toLowerCase() === tg.tag.toLowerCase())).length;
  for (const c of categories) c.count = resources.filter((r) => r.category === c.id).length;

  return {
    spec: raw.spec || 'shadow.market.catalog',
    schemaVersion: Number(raw.schemaVersion) || 1,
    generatedAt: String(raw.generatedAt || ''),
    fixture: Boolean(fixture),
    site: {
      name: String(raw.site?.name || 'SHADOW 市场'),
      nameEn: 'SHADOW Market',
      tagline: String(raw.site?.tagline || '全免费 · 积分兑换 · 本地优先'),
      taglineEn: '',
      baseUrl: String(raw.site?.baseUrl || ''),
      version: String(raw.site?.version || ''),
      build: String(raw.site?.version || ''),
    },
    categories,
    categoryMap,
    authors,
    authorMap,
    creators: authors,
    creatorMap: authorMap,
    licenses,
    licenseMap,
    tags,
    tagMap,
    tagCounts: new Map(tags.map((tg) => [tg.tag, tg.count])),
    resources,
  };
}

/* ---------------- 查询工具 ---------------- */

export function resourceById(id) {
  if (!state.catalog) return null;
  return state.catalog.resources.find((r) => r.id === String(id)) || null;
}

export function creatorByHandle(handle) {
  return authorByHandle(handle);
}

export function authorByHandle(handle) {
  if (!state.catalog) return null;
  return state.catalog.authorMap.get(String(handle || '').replace(/^@/, '')) || null;
}

export function categoryById(id) {
  if (!state.catalog) return null;
  return state.catalog.categoryMap.get(String(id || '')) || null;
}

export function licenseById(id) {
  if (!state.catalog) return null;
  return state.catalog.licenseMap.get(String(id || '')) || null;
}

export function getAllTags() { return state.catalog?.tags || []; }

/** 标签信息：标签本身或别名匹配（大小写不敏感）；未登记也返回兜底对象 */
export function tagInfo(name) {
  const key = String(name || '').trim();
  if (!key || !state.catalog) return { tag: key, label: key, labelEn: key, aliases: [], count: 0 };
  const direct = state.catalog.tagMap.get(key.toLowerCase());
  if (direct) return direct;
  for (const tg of state.catalog.tags) {
    if (tg.aliases.some((a) => String(a).toLowerCase() === key.toLowerCase())) return tg;
  }
  return { tag: key, label: key, labelEn: key, aliases: [], count: 0 };
}

/** 按标签过滤资源（含别名与大小写不敏感） */
export function resourcesByTag(name) {
  const info = tagInfo(name);
  const candidates = new Set([info.tag, ...(info.aliases || []), String(name || '')].map((x) => String(x).toLowerCase()));
  return (state.catalog?.resources || []).filter((r) => r.tags.some((tag) => candidates.has(String(tag).toLowerCase())));
}

export function resourcesByAuthor(handle) {
  return (state.catalog?.resources || []).filter((r) => r.author === String(handle || '').replace(/^@/, ''));
}

export function resourcesByCategory(categoryId) {
  return (state.catalog?.resources || []).filter((r) => r.category === String(categoryId || ''));
}

export function typeCounts() {
  const counts = new Map();
  for (const r of state.catalog?.resources || []) counts.set(r.type, (counts.get(r.type) || 0) + 1);
  return counts;
}

/** 推荐位：featured 优先，否则按更新时间取前 N（P0 无编辑后台，取构建结果） */
export function featuredResources(limit = 3) {
  const list = state.catalog?.resources || [];
  const flagged = list.filter((r) => r.featured);
  const base = flagged.length ? flagged : list.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return base.slice(0, limit);
}

export function latestResources(limit = 6) {
  return (state.catalog?.resources || [])
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, limit);
}

/** 站点级变更（changelog 页）：来自 site.json 的 changelog/releases；缺失则用 generatedAt */
export function siteChangelog() {
  const site = state.catalog?.site || {};
  const raw = state.catalog?.site?.changelog || site.releases;
  if (Array.isArray(raw)) {
    return raw.map((row, idx) => ({
      version: String(row.version || row.id || `build-${idx + 1}`),
      date: String(row.date || row.publishedAt || ''),
      changes: Array.isArray(row.changes) ? row.changes.map(String) : String(row.changes || '').split(/\n+/).filter(Boolean),
    }));
  }
  return [{
    version: site.version || site.build || 'P0',
    date: state.catalog?.generatedAt || '',
    changes: ['P0 静态市场：资源目录 / 分类 / 标签 / 收藏 / 双语 / PWA 离线'],
  }];
}

export function getSiteInfo() {
  return state.catalog?.site || { name: 'SHADOW 市场', tagline: '' };
}

/** 该资源的版本载体是否为 .shadowcourse 课程包（plugin 类是声明式 JSON，不是课程包） */
export function isCoursePackage(resource) {
  const url = String(resource?.packageUrl || resource?.versions?.[0]?.packageUrl || '');
  return /\.shadowcourse$/i.test(url);
}

/** 声明式资源（类型为 plugin / 载体是 JSON 白名单）：不 fetch 包、不展示 .shadow.json/.srt */
export function isDeclarativeResource(resource) {
  if (!resource) return false;
  if (resource.type === 'plugin') return true;
  const url = String(resource.packageUrl || '');
  return Boolean(url) && !isCoursePackage(resource);
}

export function getLicenses() { return state.catalog?.licenses || []; }
export function getAuthors() { return state.catalog?.authors || []; }

/* ---------------- 搜索 / 排序 ---------------- */

/**
 * 搜索别名：让中英关键词互相命中；标签登记表（catalog/tags.json）的 aliases 也会并入。
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

function aliasesFor(token) {
  const out = new Set(SEARCH_ALIASES[token] || []);
  const info = tagInfo(token);
  for (const a of info.aliases || []) out.add(String(a).toLowerCase());
  if (info.tag && info.tag.toLowerCase() !== token) out.add(info.tag.toLowerCase());
  return Array.from(out);
}

function resourceHaystack(resource) {
  if (resource.__haystack) return resource.__haystack;
  const author = state.catalog?.authorMap.get(resource.author);
  const category = state.catalog?.categoryMap.get(resource.category);
  const license = state.catalog?.licenseMap.get(resource.license);
  const plugin = pluginFor(resource.type);
  const parts = [
    resource.id, resource.title, resource.subtitle, resource.description,
    resource.tags.join(' '), resource.level, resource.category,
    category?.label || '', category?.labelEn || '',
    resource.author, author?.name || '', author?.bio || '',
    resource.type, plugin.label, plugin.labelEn,
    resource.license, license?.name || '',
  ];
  resource.__haystack = parts.join('\n').toLowerCase();
  return resource.__haystack;
}

export function searchResources(query, { category = '', type = '', tag = '' } = {}) {
  let list = state.catalog?.resources || [];
  if (category) list = list.filter((r) => r.category === category);
  if (type) list = list.filter((r) => r.type === type);
  if (tag) list = resourcesByTag(tag);
  const tokenGroups = String(query || '').trim().toLowerCase().split(/[\s,，、/]+/).filter(Boolean).slice(0, 8);
  if (tokenGroups.length) {
    list = list.filter((r) => {
      const hay = resourceHaystack(r);
      return tokenGroups.every((token) => {
        const variants = [token, ...aliasesFor(token)];
        return variants.some((v) => hay.includes(v));
      });
    });
  }
  return list;
}

export const SORTS = Object.freeze([
  { id: 'updated', label: '最近更新', labelEn: 'Recently updated' },
  { id: 'name', label: '名称 A→Z', labelEn: 'Name A→Z' },
  { id: 'downloads', label: '下载量', labelEn: 'Downloads' },
  { id: 'sentences', label: '句子数', labelEn: 'Sentences' },
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

/* ---------------- 课程包 / 导入产物 ---------------- */

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

/** 读取 README 备选源：versions[0].importFiles.readme（包内 readme 不可用时的降级） */
export async function loadReadmeText(resource) {
  const url = resource?.importFiles?.readme;
  const text = await fetchTextOptional(url);
  return text ? text.trim() : null;
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
