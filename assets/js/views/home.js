/**
 * 个人工作台（#/）
 * 设计依据：design/mockups/index.html（Obsidian & Amber · 个人工作台优先）。
 * 结构：问候 + 本机数据摘要 + 继续上次 + 为你推荐 2×2 + 最近动态；右栏：进入市场 CTA / 热门标签 / 合规。
 * 数据全部来自本机（localStorage: 积分/收藏/我的资源）+ 静态 catalog；无账号、无上传。
 */

import { el, fmtRelative } from '../dom.js';
import { icon } from '../icons.js';
import { t, pickLang } from '../i18n.js';
import { getState, featuredResources, latestResources, resourceById, getAllTags } from '../data.js';
import { MarketPoints } from '../points.js';
import { resourceCard, sectionHead, emptyCard } from './ui.js';

const APP_VERSION = 'v2.0';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return t('夜深了');
  if (hour < 12) return t('上午好');
  if (hour < 18) return t('下午好');
  return t('晚上好');
}

/** 连续练习天数：按 ledger 中 practice 的去重日期从今天/昨天往回数 */
function practiceStreak() {
  try {
    const days = new Set(MarketPoints.getLedger()
      .filter((e) => e.action === 'practice' && e.dedupeKey)
      .map((e) => String(e.dedupeKey).replace('practice:', '')));
    if (days.size === 0) return 0;
    const dayKey = (d) => {
      const p = (x) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    let streak = 0;
    const cursor = new Date();
    if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (days.has(dayKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  } catch { return 0; }
}

function greetingNode(points) {
  return el('section', { class: 'page-head dash-greet' },
    el('div', { class: 'profile-hero' },
      el('img', { class: 'avatar-lg', src: 'assets/brand/logo-128.png', width: '56', height: '56', alt: '', 'aria-hidden': 'true' }),
      el('div', { class: 'profile-name' },
        el('span', { class: 'eyebrow', text: t('本机访客 · 未登录') }),
        el('h1', { class: 'name', text: `${greeting()}，${t('影子练习者')}` }),
        el('span', { class: 'meta', text: `${t('今天也练 10 分钟吧')} · ${t('本机积分')} ${points} · ${t('数据仅保存在本机')}` }),
      ),
    ),
    el('div', { class: 'dash-greet-actions' },
      el('a', { class: 'btn btn-secondary', href: '#/favorites?tab=downloads' }, icon('file-text', 16), t('我的资源')),
      el('a', { class: 'btn btn-secondary', href: '#/market' }, icon('compass', 16), t('去市场逛逛')),
    ),
  );
}

function statRow(points, favorites, downloads, streak) {
  return el('section', { class: 'stat-row', 'aria-label': t('我的数据') },
    el('div', { class: 'stat stat-accent' },
      el('span', { class: 'stat-value' }, String(points), el('span', { class: 'unit', text: t('积分') })),
      el('span', { class: 'stat-label', text: t('签到 / 打卡获取') }),
    ),
    el('div', { class: 'stat' },
      el('span', { class: 'stat-value', text: String(favorites) }),
      el('span', { class: 'stat-label', text: t('收藏资源') }),
    ),
    el('div', { class: 'stat' },
      el('span', { class: 'stat-value', text: String(downloads) }),
      el('span', { class: 'stat-label', text: t('已下载课程包') }),
    ),
    el('div', { class: 'stat' },
      el('span', { class: 'stat-value' }, String(streak), el('span', { class: 'unit', text: t('天') })),
      el('span', { class: 'stat-label', text: t('连续练习') }),
    ),
  );
}

function continueSection() {
  const myResources = MarketPoints.getMyResources();
  const latest = myResources[0] || null;
  const resource = latest ? resourceById(latest.id) : null;
  const section = el('section', { class: 'section' },
    sectionHead(t('继续上次'), t('从上次的句子继续，不需要重新找媒体'), { href: '#/favorites?tab=downloads', label: t('全部记录') }),
  );

  if (resource) {
    const version = resource.versions?.[0] || {};
    const coverClass = `cover-${(String(resource.id).length % 5) + 1}`;
    section.append(el('div', { class: 'card continue-card' },
      el('div', { class: `continue-cover cover ${coverClass}`, style: { width: '132px' } }),
      el('div', { class: 'continue-body' },
        el('span', { class: 'continue-title', text: resource.title }),
        el('span', { class: 'continue-meta', text: `${resource.subtitle || ''} · ${resource.level || ''} · ${t('上次打开')}：${fmtRelative(latest.at)}` }),
        el('span', { class: 'continue-meta', text: `${t('导入文件')}：${version.version ? `v${version.version}` : '—'} · ${t('BYOM 纯数据包')}` }),
      ),
      el('div', { class: 'continue-actions' },
        el('a', { class: 'btn btn-secondary btn-sm', href: `#/resource/${encodeURIComponent(resource.id)}?tab=files` }, t('查看导入文件')),
        el('a', { class: 'btn btn-primary btn-sm', href: `#/resource/${encodeURIComponent(resource.id)}` }, t('继续练习')),
      ),
    ));
  } else {
    section.append(el('div', { class: 'card continue-card continue-card--empty' },
      el('div', { class: 'continue-cover cover cover-2' }),
      el('div', { class: 'continue-body' },
        el('span', { class: 'continue-title', text: t('还没有练习记录') }),
        el('span', { class: 'continue-meta', text: t('去市场挑一个课程包，下载导入文件后这里会显示「继续上次」。') }),
      ),
      el('div', { class: 'continue-actions' },
        el('a', { class: 'btn btn-primary btn-sm', href: '#/market' }, icon('compass', 16), t('去市场逛逛')),
      ),
    ));
  }
  return section;
}

function recommendSection() {
  let list = featuredResources(4);
  if (!list.length) list = latestResources(4);
  if (list.length === 0) {
    return el('section', { class: 'section' },
      sectionHead(t('为你推荐'), t('全部免费 · 本地优先')),
      emptyCard({ iconName: 'compass', title: t('资源目录还是空的'), desc: t('数据生成后，这里会出现推荐的课程包与字幕包。'), action: { href: '#/market', label: t('打开市场') } }),
    );
  }
  const grid = el('div', { class: 'res-grid' });
  list.forEach((resource, idx) => grid.append(resourceCard(resource, { variant: 'dashboard', index: idx })));
  return el('section', { class: 'section' },
    sectionHead(t('为你推荐'), t('根据你的难度与最近浏览 · 全部免费'), { href: '#/market', label: t('查看全部') }),
    grid,
  );
}

function activityEvents() {
  const events = [];
  try {
    for (const entry of MarketPoints.getLedger()) {
      events.push({ at: entry.at, kind: entry.action, text: entry.label || entry.action, delta: entry.delta });
    }
    for (const item of MarketPoints.getMyResources()) {
      events.push({ at: item.at, kind: 'download', text: `${t('下载导入文件')} · ${item.title}` });
    }
  } catch { /* ignore */ }
  return events.filter((e) => e.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 5);
}

function activitySection() {
  const events = activityEvents();
  const body = el('div', { class: 'card card-pad' });
  if (events.length === 0) {
    body.append(el('p', { class: 'small muted', text: t('还没有本机动态：签到、打卡、收藏或下载导入文件后会记录在这里。') }));
  } else {
    const timeline = el('div', { class: 'timeline' });
    for (const event of events) {
      const text = el('span', { class: 'timeline-text' });
      if (event.delta) {
        text.append(`${event.text} `, el('b', { text: `${event.delta > 0 ? '+' : ''}${event.delta} ${t('积分')}` }));
      } else {
        text.append(event.text);
      }
      timeline.append(el('div', { class: 'timeline-item' },
        el('span', { class: 'timeline-time', text: fmtRelative(event.at) }),
        text,
      ));
    }
    body.append(timeline);
  }
  return el('section', { class: 'section' },
    sectionHead(t('最近动态'), '', { href: '#/favorites?tab=downloads', label: t('全部') }),
    body,
  );
}

/** 工作台右栏：进入市场 CTA / 热门标签 / 合规 */
export function renderRail() {
  const tags = getAllTags().slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 5);
  const frag = document.createDocumentFragment();

  const cta = el('a', { class: 'cta-market', href: '#/market' },
    el('span', { class: 'cta-eyebrow', text: 'Market' }),
    el('h3', { text: t('进入市场') }),
    el('p', { text: t('发现免费课程 / 字幕 / 插件资源，全部 BYOM、下载即用。') }),
    el('span', { class: 'wave', html: '<svg viewBox="0 0 160 60" aria-hidden="true"><g fill="currentColor"><rect x="2" y="23" width="22" height="10" rx="5"/><rect x="36" y="14" width="9" height="34" rx="4.5"/><rect x="55" y="4" width="9" height="52" rx="4.5"/><rect x="74" y="17" width="9" height="28" rx="4.5"/><rect x="93" y="23" width="22" height="10" rx="5"/></g></svg>' }),
    el('span', { class: 'cta-foot' },
      el('span', { class: 'micro', style: { opacity: '.8' }, text: t('全免费 · 无抽成') }),
      el('span', { class: 'cta-arrow' }, icon('arrow-right', 18)),
    ),
  );
  frag.append(cta);

  frag.append(el('div', { class: 'rail-card' },
    el('p', { class: 'rail-title', text: t('热门标签') }),
    el('div', { class: 'tag-row' }, tags.map((tag) => el('a', {
      class: 'chip',
      href: `#/tag/${encodeURIComponent(tag.tag)}`,
    }, pickLang(tag.label, tag.labelEn), el('span', { class: 'count', text: String(tag.count || 0) })))),
  ));

  frag.append(el('div', { class: 'rail-card compliance-card' },
    el('p', { class: 'rail-title', text: t('为什么可以放心用') }),
    el('ul', { class: 'stack-8' },
      el('li', { class: 'row small muted', style: { gap: '9px' } }, icon('shield', 16, 'rail-check'), t('不托管任何影视媒体（BYOM）')),
      el('li', { class: 'row small muted', style: { gap: '9px' } }, icon('gift', 16, 'rail-check'), t('全免费 · 积分不可购买/转让')),
      el('li', { class: 'row small muted', style: { gap: '9px' } }, icon('user', 16, 'rail-check'), t('无强制登录 · 数据只在本机')),
    ),
    el('a', { class: 'text-link small', href: '#/privacy', style: { marginTop: '12px', display: 'inline-block' }, text: t('隐私与合规说明') }),
  ));
  return frag;
}

export function renderDashboard(view) {
  const state = getState();
  view.replaceChildren();
  const points = MarketPoints.getPoints();
  const favorites = MarketPoints.getFavorites().length;
  const downloads = MarketPoints.getMyResources().length;
  const streak = practiceStreak();

  if (!state.catalog) {
    view.append(el('section', { class: 'page-head' },
      el('div', { class: 'profile-name' },
        el('h1', { class: 'name', text: `${greeting()}，${t('影子练习者')}` }),
        el('span', { class: 'meta', text: t('资源目录尚未加载，请稍后重试。') }),
      ),
    ));
    view.append(emptyCard({
      iconName: 'help-circle',
      title: t('数据未加载'),
      desc: t('请确认本地服务已启动（node market/serve.mjs）或数据目录已生成。'),
      action: { href: '#/market', label: t('重试进入市场') },
    }));
    return;
  }

  view.append(greetingNode(points));
  view.append(statRow(points, favorites, downloads, streak));
  view.append(continueSection());
  view.append(recommendSection());
  view.append(activitySection());
  view.append(el('p', { class: 'footer-note' },
    el('span', { text: `SHADOW ${t('市场')} · ${t('全免费')}` }),
    el('span', { text: `BYOM · ${t('不托管媒体')}` }),
    el('span', { text: t('无强制登录') }),
    el('span', { text: APP_VERSION }),
  ));
}

export default renderDashboard;
