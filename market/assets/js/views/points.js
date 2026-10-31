/** 积分页（P1 本地演示）：余额 / 签到 / 练习打卡 / 兑换 / 我的资源 / 积分流水 */

import { el, fmtNum, fmtDate, fmtRelative, signed } from '../dom.js';
import { icon } from '../icons.js';
import { getState, resourceById } from '../data.js';
import { pageHead, emptyState, demoBanner, toast, openModal } from '../components.js';
import { MarketPoints, POINTS_RULES } from '../points.js';
import { navigate } from '../router.js';

const DEMO_REDEEM_ITEM = {
  id: 'demo.subtitle-neon',
  title: '字幕样式包 · 霓虹（P1 兑换演示）',
  type: 'subtitle',
  points: 30,
  demo: true,
  description: '这是一个本地演示项：不对应 catalog.json 中的真实资源，用来演示「积分兑换 → 我的资源」流程。P0 全部真实资源都是 0 积分的。',
};

function statChip(iconName, label, value) {
  return el('span', { class: 'res-meta' }, icon(iconName, 13), label, ' ', el('b', { style: { color: 'var(--fg)' }, text: String(value) }));
}

function balanceCard(paint) {
  const points = MarketPoints.getPoints();
  const deviceId = MarketPoints.getDeviceId();
  const signin = MarketPoints.signInStatus();
  const practice = MarketPoints.practiceStatus();
  const mine = MarketPoints.getMyResources().length;
  const ledgerCount = MarketPoints.getLedger().length;

  const card = el('section', { class: 'points-balance-card', 'data-testid': 'points-balance-card' },
    el('div', { class: 'points-balance-label' }, icon('diamond', 14), '当前积分（本地演示）'),
    el('div', { class: 'points-balance-num', 'data-testid': 'points-balance' }, fmtNum(points), el('span', { class: 'points-balance-unit', text: '积分' })),
    el('div', { class: 'points-balance-meta' }, `匿名设备 ${deviceId.slice(0, 18)}… · 积分只保存在本机浏览器`),
    el('div', { class: 'row', style: { marginTop: '12px', gap: '14px' } },
      statChip('message', '流水', ledgerCount),
      statChip('book', '我的资源', mine),
      statChip('check', '今日签到', signin.done ? '已完成' : '未完成'),
    ),
    el('div', { class: 'points-actions' },
      el('button', {
        class: `btn ${signin.done ? '' : 'btn-primary'}`, type: 'button', disabled: signin.done ? true : null,
        'data-testid': 'signin-btn',
        onclick: () => {
          const result = MarketPoints.signIn();
          if (result.ok) toast(`签到成功 +${POINTS_RULES.signIn} 积分（P1 本地演示，当前 ${result.balance} 分）`, { kind: 'success' });
          else toast('今天已经签到过了，明天再来（本地演示同一天只能签一次）', { kind: 'warn' });
          paint();
        },
      }, icon('check', 14), signin.done ? '今日已签到' : `每日签到 +${POINTS_RULES.signIn}`),
      el('button', {
        class: `btn ${practice.done ? '' : ''}`.trim(), type: 'button', disabled: practice.done ? true : null,
        'data-testid': 'practice-btn',
        onclick: () => {
          const result = MarketPoints.practiceCheckIn();
          if (result.ok) toast(`练习打卡成功 +${POINTS_RULES.practice} 积分（P1 本地演示，当前 ${result.balance} 分）`, { kind: 'success' });
          else toast('今天已经打过卡了（P1 无练习器回传，这里是本地按钮）', { kind: 'warn' });
          paint();
        },
      }, icon('play', 13), practice.done ? '今日已打卡' : `练习打卡 +${POINTS_RULES.practice}`),
    ),
    el('p', { class: 'points-note' },
      'P1 本地演示：签到 / 打卡 / 导入回调都由本地浏览器记录，没有后端账号、不采集行为数据。正式版会换成 MarketPoints 适配器的 /api 实现。',
    ),
  );
  return card;
}

function rulesCard() {
  return el('section', { class: 'points-action-card' },
    el('h2', { class: 'points-action-title' }, icon('sparkles', 14), '积分规则（P1 本地演示）'),
    el('ul', { class: 'points-rule-list' },
      el('li', {}, el('b', { text: `每日签到 +${POINTS_RULES.signIn}` }), '：每天一次，本地日历日去重'),
      el('li', {}, el('b', { text: `练习打卡 +${POINTS_RULES.practice}` }), '：每天一次（P1 无练习器回传，用按钮模拟）'),
      el('li', {}, el('b', { text: `导入成功 +${POINTS_RULES.importReward}` }), '：每个资源一次；在详情页导入后手动记录'),
      el('li', {}, el('b', { text: '兑换扣积分' }), '：P0 真实资源全部 0 积分（全免费）；积分>0 的演示资源才需要兑换'),
      el('li', {}, el('b', { text: '不可购买 / 提现 / 转让' }), '：积分只是免费获取的兑换凭证，不做支付、充值、抽成'),
    ),
    el('div', { class: 'notice notice-warn', style: { marginTop: '12px' } },
      icon('alert', 15, 'notice-icon'),
      el('div', {}, el('strong', { text: '没有后端。' }), '清除浏览器数据或点设置页「清除本地演示数据」后，积分与流水会归零。'),
    ),
  );
}

function myResourcesSection(paint) {
  const items = MarketPoints.getMyResources();
  const section = el('section', { class: 'points-section', 'data-testid': 'my-resources' },
    el('h2', { class: 'points-section-title', text: '我的资源' }),
    el('p', { class: 'points-section-sub' }, `已获取 ${items.length} 个资源（本地记录；P0 全部免费，不依赖账号）`),
  );
  if (items.length === 0) {
    section.append(emptyState({
      iconName: 'book',
      title: '还没有我的资源',
      desc: '在资源详情页点「下载」或「一键导入」会自动加入我的资源（只记录在本机浏览器）。',
      actions: [{ label: '去探索资源', href: '#/', kind: 'primary', icon: 'compass' }],
    }));
    return section;
  }
  const list = el('div', { class: 'my-resources' });
  for (const item of items) {
    const resource = resourceById(item.id);
    list.append(el('div', { class: 'my-resource', 'data-testid': 'my-resource-row' },
      el('span', { class: 'res-icon', style: { width: '32px', height: '32px', borderRadius: '7px', background: 'var(--accent-muted)', color: 'var(--accent)' } }, icon('book', 16)),
      el('div', { class: 'my-resource-body' },
        resource
          ? el('a', { class: 'my-resource-title', href: `#/resource/${encodeURIComponent(item.id)}` }, item.title)
          : el('span', { class: 'my-resource-title', style: { color: 'var(--fg)' } }, item.title),
        el('div', { class: 'my-resource-meta' },
          `${item.via === 'import' ? '导入' : item.via === 'redeem' ? '兑换' : item.via === 'download' ? '下载' : '获取'} · ${fmtRelative(item.addedAt)}`,
          resource ? '' : ' · 不在当前目录（可能是演示项或已下架）',
        ),
      ),
      resource
        ? el('a', { class: 'btn btn-sm', href: `#/resource/${encodeURIComponent(item.id)}` }, '打开')
        : null,
    ));
  }
  section.append(list);
  return section;
}

function redeemSection(paint) {
  const catalog = getState().catalog;
  const redeemables = (catalog?.resources || []).filter((r) => r.points > 0);
  const items = redeemables.length ? redeemables : [DEMO_REDEEM_ITEM];
  const points = MarketPoints.getPoints();

  const section = el('section', { class: 'points-section', 'data-testid': 'redeem-section' },
    el('h2', { class: 'points-section-title', text: '积分兑换' }),
    el('p', { class: 'points-section-sub', text: redeemables.length ? '以下资源需要积分兑换（P1 本地演示，兑换只在本机记账）' : '当前目录全部资源都是 0 积分（P0 全免费），下面用本地演示项演示兑换流程' }),
  );
  const list = el('div', { class: 'res-list' });
  for (const item of items) {
    const already = MarketPoints.hasMyResource(item.id);
    const canAfford = points >= item.points;
    list.append(el('div', { class: 'res-card', 'data-testid': 'redeem-card' },
      el('div', { class: 'res-card-head' },
        el('span', { class: 'res-icon', style: { background: 'linear-gradient(135deg, #3D2B4D, #C77DFF)' } }, icon('captions', 22)),
        el('div', { class: 'res-head-text' },
          el('div', { class: 'res-title-row' },
            el('span', { class: 'res-title' }, item.title),
            el('span', { class: 'badge badge-points' }, icon('diamond', 11), `${item.points} 积分`),
            item.demo ? el('span', { class: 'badge badge-demo' }, '演示项') : null,
            already ? el('span', { class: 'badge badge-free' }, icon('check', 11), '已兑换') : null,
          ),
          el('div', { class: 'res-sub', text: item.demo ? '本地兑换演示项 · 不对应 catalog.json 真实资源' : (item.subtitle || '') }),
        ),
      ),
      item.demo ? null : el('p', { class: 'res-desc', text: item.description || '' }),
      el('div', { class: 'row' },
        el('button', {
          class: 'btn btn-primary btn-sm', type: 'button', disabled: already || !canAfford ? true : null,
          'data-testid': 'redeem-demo-btn',
          onclick: () => {
            const resource = item.demo
              ? { ...item }
              : item;
            const result = MarketPoints.redeem(resource);
            if (result.ok) toast(`兑换成功：${item.title}（扣除 ${item.points} 积分，本地演示）`, { kind: 'success' });
            else if (result.reason === 'E_INSUFFICIENT') toast(`积分不足：需要 ${item.points} 分，当前 ${MarketPoints.getPoints()} 分。先签到 / 打卡赚积分。`, { kind: 'warn' });
            else if (result.reason === 'E_DUPLICATE') toast('已经兑换过了（每个演示项一次）', { kind: 'warn' });
            else toast('兑换失败：' + result.reason, { kind: 'error' });
            paint();
          },
        }, icon('diamond', 13), already ? '已兑换' : canAfford ? '兑换（本地演示）' : '积分不足'),
        el('span', { class: 'points-note', text: `当前 ${MarketPoints.getPoints()} 积分` }),
      ),
    ));
  }
  section.append(list);
  return section;
}

function ledgerSection() {
  const ledger = MarketPoints.getLedger();
  const section = el('section', { class: 'points-section', 'data-testid': 'ledger' },
    el('h2', { class: 'points-section-title', text: '积分流水' }),
    el('p', { class: 'points-section-sub' }, `共 ${ledger.length} 条记录（新的在前；只保存在本机 localStorage · ${'shadow.market.points.v1'}）`),
  );
  if (ledger.length === 0) {
    section.append(el('div', { class: 'ledger-table' }, el('div', { class: 'ledger-empty', text: '还没有流水。点上面的「每日签到 +5」开始（P1 本地演示）。' })));
    return section;
  }
  const table = el('table', { class: 'ledger-table', 'data-testid': 'ledger-table' },
    el('thead', {}, el('tr', {},
      el('th', { text: '时间' }), el('th', { text: '动作' }), el('th', { text: '说明' }),
      el('th', { text: '积分', style: { textAlign: 'right' } }), el('th', { text: '余额', style: { textAlign: 'right' } }),
    )),
  );
  const tbody = el('tbody');
  for (const entry of ledger) {
    tbody.append(el('tr', { 'data-testid': 'ledger-row' },
      el('td', {}, el('span', { class: 'ledger-time', title: fmtDate(entry.at), text: fmtRelative(entry.at) })),
      el('td', {}, el('span', { class: 'badge', text: entry.action })),
      el('td', {}, el('span', { class: 'ledger-reason', text: MarketPoints.describeEntry(entry) })),
      el('td', { class: 'num' }, el('span', { class: entry.delta >= 0 ? 'ledger-amount-plus' : 'ledger-amount-minus', text: signed(entry.delta) })),
      el('td', { class: 'num', text: entry.balanceAfter === null ? '—' : String(entry.balanceAfter) }),
    ));
  }
  table.append(tbody);
  section.append(table);
  return section;
}

export function renderPoints(view) {
  view.replaceChildren();
  const state = getState();
  const paint = () => renderPoints(view);

  view.append(pageHead({
    title: '积分',
    sub: '全免费资源的兑换凭证：免费获取、不可购买 / 提现 / 转让。P1 只做本地演示，无后端账号。',
    actions: [{ label: '积分规则说明', onClick: () => openRules(), icon: 'info' }],
  }));

  view.append(demoBanner(
    '<strong>P1 本地演示 · 无账号后端</strong>　积分只保存在本机浏览器（localStorage），不采集行为；<strong>积分不可购买 / 提现 / 转让</strong>。清除浏览器数据会丢失积分与流水。',
    { iconName: 'alert' },
  ));

  if (!state.catalog) {
    view.append(emptyState({
      iconName: 'database',
      title: '资源目录未加载',
      desc: '积分页的「可兑换资源」来自 data/catalog.json；目录缺失时仍可使用本地点数功能。',
      actions: [{ label: '返回首页重试', href: '#/', kind: 'primary' }],
    }));
  }

  view.append(el('div', { class: 'points-grid' }, balanceCard(paint), rulesCard()));
  if (state.catalog) view.append(redeemSection(paint));
  view.append(myResourcesSection(paint));
  view.append(ledgerSection());
}

function openRules() {
  openModal({
    title: 'P1 本地积分演示说明',
    body: el('div', {},
      el('p', {}, '这不是账户系统、也不是支付系统。当前页面所有积分行为都由 ', el('code', { text: 'MarketPoints' }), ' 适配器写在本机 localStorage（键名 ', el('code', { text: 'shadow.market.points.v1' }), '）。'),
      el('ul', { class: 'points-rule-list', style: { marginTop: '10px' } },
        el('li', {}, `每日签到 +${POINTS_RULES.signIn}，练习打卡 +${POINTS_RULES.practice}，导入成功 +${POINTS_RULES.importReward}（每资源一次）`),
        el('li', {}, 'P0 真实资源全部 0 积分（全免费）；积分 > 0 的资源才需要兑换'),
        el('li', {}, '积分不可购买、不可提现、不可转让；没有支付、充值、抽成、DRM'),
        el('li', {}, '正式版将把适配器替换为 /api 实现，页面交互不变'),
      ),
      el('p', { style: { marginTop: '12px' } }, '清除本地演示数据：设置 → 危险区 → 清除本地演示数据。'),
    ),
    actions: [{ label: '知道了', kind: 'primary' }],
  });
}
