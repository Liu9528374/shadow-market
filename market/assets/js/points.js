/**
 * MarketPoints · P1 本地积分演示适配器（无后端）
 *
 * 目的：把「积分」读写封装成一个可替换适配器，正式版只需把这个对象换成 /api 实现，
 *       页面代码不需要改。所有数据只存在本机 localStorage（匿名设备 ID），
 *       页面必须显著标注：P1 本地演示 · 无账号后端 · 积分不可购买/提现/转让。
 *
 * 规则（docs/52 §6）：每日签到 +5；练习打卡 +10；导入成功 +20（每个资源一次）；
 *                   兑换扣积分；我的资源；积分流水表。
 * 明确不做：充值、支付、提现、转让、排行榜、复杂风控。
 */

import { dayKey, fmtDate } from './dom.js';

export const POINTS_STORAGE_KEY = 'shadow.market.points.v1';
export const POINTS_RULES = Object.freeze({
  signIn: 5,
  practice: 10,
  importReward: 20,
  version: 1,
});

const listeners = new Set();
let cache = null;

function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function uuid() {
  try {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* fallthrough */ }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultStore() {
  const now = new Date().toISOString();
  return {
    version: POINTS_RULES.version,
    deviceId: `dev_${uuid()}`,
    createdAt: now,
    ledger: [],
    myResources: [],
    favorites: [],
  };
}

function sanitizeStore(raw) {
  const base = defaultStore();
  if (!raw || typeof raw !== 'object') return base;
  return {
    version: POINTS_RULES.version,
    deviceId: typeof raw.deviceId === 'string' && raw.deviceId ? raw.deviceId : base.deviceId,
    createdAt: raw.createdAt || base.createdAt,
    ledger: Array.isArray(raw.ledger)
      ? raw.ledger.filter((e) => e && typeof e === 'object' && Number.isFinite(Number(e.delta)))
        .slice(-300)
        .map((e) => ({
          id: String(e.id || uuid()),
          at: e.at || new Date().toISOString(),
          action: String(e.action || 'other'),
          label: String(e.label || ''),
          delta: Number(e.delta) || 0,
          balanceAfter: Number.isFinite(Number(e.balanceAfter)) ? Number(e.balanceAfter) : null,
          meta: e.meta && typeof e.meta === 'object' ? e.meta : {},
          dedupeKey: e.dedupeKey ? String(e.dedupeKey) : '',
        }))
      : [],
    myResources: Array.isArray(raw.myResources)
      ? raw.myResources.filter((r) => r && typeof r === 'object' && r.id)
        .slice(0, 200)
        .map((r) => ({
          id: String(r.id),
          title: String(r.title || r.id),
          type: String(r.type || ''),
          via: String(r.via || 'free'),
          addedAt: r.addedAt || new Date().toISOString(),
        }))
      : [],
    favorites: Array.isArray(raw.favorites) ? raw.favorites.map(String).slice(0, 200) : [],
  };
}

function readStore() {
  if (cache) return cache;
  let raw = null;
  try { raw = safeParse(localStorage.getItem(POINTS_STORAGE_KEY)); } catch { raw = null; }
  cache = sanitizeStore(raw);
  return cache;
}

function writeStore(next) {
  cache = next;
  try { localStorage.setItem(POINTS_STORAGE_KEY, JSON.stringify(next)); } catch { /* 隐私模式：内存态可用 */ }
  emit();
}

function emit() {
  const snapshot = {
    points: MarketPoints.getPoints(),
    ledger: MarketPoints.getLedger(),
    deviceId: MarketPoints.getDeviceId(),
  };
  for (const fn of listeners) {
    try { fn(snapshot); } catch (err) { console.warn('[market] points listener 异常', err); }
  }
  window.dispatchEvent(new CustomEvent('market:pointschanged', { detail: snapshot }));
}

function balanceOf(store) {
  return store.ledger.reduce((sum, e) => sum + (Number(e.delta) || 0), 0);
}

function pushEntry(store, entry) {
  const balanceAfter = balanceOf(store) + entry.delta;
  const record = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    balanceAfter,
    ...entry,
  };
  store.ledger.push(record);
  if (store.ledger.length > 300) store.ledger = store.ledger.slice(-300);
  return record;
}

function hasDedupe(store, key) {
  if (!key) return false;
  return store.ledger.some((e) => e.dedupeKey === key);
}

/* ---------------- 对外适配器接口（可整体替换为 /api 实现） ---------------- */

export const MarketPoints = {
  ruleLabel: {
    signIn: `每日签到 +${POINTS_RULES.signIn}`,
    practice: `练习打卡 +${POINTS_RULES.practice}`,
    importReward: `导入成功 +${POINTS_RULES.importReward}`,
  },

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  getDeviceId() { return readStore().deviceId; },
  getCreatedAt() { return readStore().createdAt; },

  getPoints() { return balanceOf(readStore()); },

  /** 积分流水（新的在前） */
  getLedger() {
    return readStore().ledger.slice().reverse().map((e) => ({ ...e }));
  },

  /** @returns {{ok:boolean, entry?:object, reason?:string}} */
  earn(action, points, { label = '', dedupeKey = '', meta = {} } = {}) {
    const amount = Number(points);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'E_AMOUNT' };
    const store = readStore();
    if (hasDedupe(store, dedupeKey)) return { ok: false, reason: 'E_DUPLICATE' };
    const entry = pushEntry(store, { action, label: label || action, delta: amount, dedupeKey, meta });
    writeStore(store);
    return { ok: true, entry, balance: balanceOf(store) };
  },

  /** @returns {{ok:boolean, entry?:object, reason?:string}} */
  spend(points, { label = '', dedupeKey = '', meta = {} } = {}) {
    const amount = Number(points);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'E_AMOUNT' };
    const store = readStore();
    if (hasDedupe(store, dedupeKey)) return { ok: false, reason: 'E_DUPLICATE' };
    if (balanceOf(store) < amount) return { ok: false, reason: 'E_INSUFFICIENT' };
    const entry = pushEntry(store, { action: 'redeem', label: label || '兑换资源', delta: -amount, dedupeKey, meta });
    writeStore(store);
    return { ok: true, entry, balance: balanceOf(store) };
  },

  /* 每日签到 */
  signInStatus() {
    const store = readStore();
    const today = dayKey();
    const signed = store.ledger.some((e) => e.action === 'signin' && e.dedupeKey === `signin:${today}`);
    return { done: signed, today };
  },
  signIn() {
    const today = dayKey();
    if (this.signInStatus().done) return { ok: false, reason: 'E_DUPLICATE' };
    return this.earn('signin', POINTS_RULES.signIn, {
      label: `每日签到（${today}）`,
      dedupeKey: `signin:${today}`,
    });
  },

  /* 练习打卡（本地演示按钮，P1 无练习器回传） */
  practiceStatus() {
    const today = dayKey();
    const done = readStore().ledger.some((e) => e.action === 'practice' && e.dedupeKey === `practice:${today}`);
    return { done, today };
  },
  practiceCheckIn() {
    const today = dayKey();
    if (this.practiceStatus().done) return { ok: false, reason: 'E_DUPLICATE' };
    return this.earn('practice', POINTS_RULES.practice, {
      label: `练习打卡（${today}）`,
      dedupeKey: `practice:${today}`,
    });
  },

  /* 导入成功回调（每个资源一次；由市场页在导入/下载成功后手动触发，P1 无桌面回调通道） */
  importRewardStatus(resourceId) {
    const key = `import:${resourceId}`;
    return { done: hasDedupe(readStore(), key), key };
  },
  rewardImport(resourceId, title = '') {
    const key = `import:${resourceId}`;
    if (hasDedupe(readStore(), key)) return { ok: false, reason: 'E_DUPLICATE' };
    return this.earn('import', POINTS_RULES.importReward, {
      label: `导入成功：${title || resourceId}`,
      dedupeKey: key,
      meta: { resourceId },
    });
  },

  /* 我的资源 */
  getMyResources() { return readStore().myResources.slice().reverse().map((r) => ({ ...r })); },
  hasMyResource(id) { return readStore().myResources.some((r) => r.id === String(id)); },
  addMyResource(resource, via = 'free') {
    const store = readStore();
    const id = String(resource?.id || '');
    if (!id || store.myResources.some((r) => r.id === id)) return { ok: false, reason: 'E_DUPLICATE' };
    store.myResources.push({
      id,
      title: String(resource.title || id),
      type: String(resource.type || ''),
      via,
      addedAt: new Date().toISOString(),
    });
    if (store.myResources.length > 200) store.myResources = store.myResources.slice(-200);
    writeStore(store);
    return { ok: true };
  },

  /* 收藏（本机，与我的资源分开） */
  isFavorite(id) { return readStore().favorites.includes(String(id)); },
  toggleFavorite(id) {
    const store = readStore();
    const key = String(id);
    const idx = store.favorites.indexOf(key);
    if (idx >= 0) store.favorites.splice(idx, 1);
    else store.favorites.push(key);
    writeStore(store);
    return { ok: true, favorite: idx < 0 };
  },
  getFavorites() { return readStore().favorites.slice(); },

  /** 兑换演示：扣积分并把资源记录进「我的资源」 */
  redeem(resource) {
    const cost = Number(resource?.points) || 0;
    if (cost <= 0) return { ok: false, reason: 'E_FREE' };
    const key = `redeem:${resource.id}`;
    const result = this.spend(cost, { label: `兑换：${resource.title}`, dedupeKey: key, meta: { resourceId: resource.id } });
    if (result.ok) this.addMyResource(resource, 'redeem');
    return result;
  },

  /** 清除全部本地演示数据（危险区） */
  resetAll() {
    cache = null;
    try { localStorage.removeItem(POINTS_STORAGE_KEY); } catch { /* ignore */ }
    writeStore(defaultStore());
    return { ok: true };
  },

  /** 导出本地演示数据（开发者设置用） */
  exportData() {
    const store = readStore();
    return {
      exportedAt: new Date().toISOString(),
      storageKey: POINTS_STORAGE_KEY,
      note: 'P1 本地演示数据（无后端账号）。积分不可购买/提现/转让。',
      deviceId: store.deviceId,
      createdAt: store.createdAt,
      points: balanceOf(store),
      ledger: store.ledger,
      myResources: store.myResources,
      favorites: store.favorites,
    };
  },

  /** 人类可读的流水说明 */
  describeEntry(entry) {
    return entry?.label || entry?.action || '—';
  },

  formatDate(iso) { return fmtDate(iso); },
};

// 便捷全局（页面/自测/未来 /api 适配都从这里取）
if (typeof window !== 'undefined') {
  window.MarketPoints = MarketPoints;
  window.__MARKET_POINTS_RULES__ = POINTS_RULES;
}
