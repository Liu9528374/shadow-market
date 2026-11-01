/**
 * 积分中心（#/points）· P1 本地演示
 * 余额 + 免费须知 + 3 个获取动作 + 积分流水 + 规则摘要 + 兑换演示
 * 数据源：MarketPoints（localStorage，无后端账号）
 */

import { el, elFromHtml, fmtDate, fmtRelative, signed, dayKey } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { getState } from '../data.js';
import { MarketPoints, POINTS_RULES } from '../points.js';
import { toast, confirmDialog } from '../components.js';

const DEMO_REDEEM_ITEM = {
  id: 'demo.subtitle-neon',
  title: '字幕样式包 · 霓虹（P1 兑换演示）',
  type: 'subtitle',
  points: 30,
  demo: true,
  description: '本地演示项：不对应 catalog 中的真实资源，用来演示「积分兑换 → 我的资源」流程。P0 全部真实资源都是 0 积分的。',
};

function pageHead({ eyebrow, title, lead, actions = [] }) {
  return el('div', { class: 'page-head-row' },
    el('section', { class: 'page-head' },
      eyebrow ? el('span', { class: 'eyebrow', text: eyebrow }) : null,
      el('h1', { text: title }),
      lead ? el('p', { class: 'lead', text: lead }) : null,
    ),
    actions.length ? el('div', { class: 'page-actions' }, actions) : null,
  );
}

function sectionHead(title, sub, extra = null) {
  return el('div', { class: 'section-head' },
    el('div', {},
      el('h2', { class: 'section-title', text: title }),
      sub ? el('p', { class: 'section-sub', text: sub }) : null,
    ),
    extra,
  );
}

function waveSvg(cls = 'points-hero-wave') {
  return elFromHtml(`<svg class="${cls}" viewBox="0 0 160 60" aria-hidden="true"><g fill="currentColor"><rect x="2" y="23" width="22" height="10" rx="5"/><rect x="36" y="14" width="9" height="34" rx="4.5"/><rect x="55" y="4" width="9" height="52" rx="4.5"/><rect x="74" y="17" width="9" height="28" rx="4.5"/><rect x="93" y="23" width="22" height="10" rx="5"/></g></svg>`);
}

function actionCard({ iconName, reward, title, desc, meta, button, done = false }) {
  return el('div', { class: `point-action${done ? ' is-done' : ''}`.trim() },
    el('div', { class: 'point-action-top' },
      el('span', { class: 'point-action-icon' }, icon(iconName, 19)),
      el('span', { class: 'point-reward', text: `+${reward}` }),
    ),
    el('span', { class: 'point-action-title', text: title }),
    el('p', { class: 'point-action-desc', text: desc }),
    el('div', { class: 'point-action-meta' }, icon(done ? 'check' : 'clock', 12), done ? t('今日已完成') : meta),
    button,
  );
}

function ledgerSection(repaint) {
  const ledger = MarketPoints.getLedger();
  const section = el('section', { class: 'section', 'data-testid': 'ledger-section' },
    sectionHead(t('积分流水'), t('只记录动作与积分变化，不记录学习内容；新的在前。')),
  );
  if (ledger.length === 0) {
    section.append(el('div', { class: 'card empty-inline' },
      el('div', { class: 'empty', style: { padding: '36px 20px' } },
        el('span', { class: 'empty-title', text: t('还没有积分流水') }),
        el('span', { class: 'empty-text', text: t('点上面的「签到」或「练习打卡」开始积攒积分（P1 本地演示）。') }),
      ),
    ));
    return section;
  }
  const card = el('div', { class: 'card ledger', 'data-testid': 'ledger' });
  const groups = new Map();
  for (const entry of ledger) {
    const key = dayKey(new Date(entry.at));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const today = dayKey();
  const yesterday = dayKey(new Date(Date.now() - 86400000));
  const labelOf = (key) => (key === today ? t('今天') : key === yesterday ? t('昨天') : key);
  for (const [key, entries] of groups) {
    const group = el('div', { class: 'ledger-group' }, el('div', { class: 'ledger-day', text: labelOf(key) }));
    const list = el('div', { class: 'list' });
    for (const entry of entries) {
      const earn = entry.delta >= 0;
      list.append(el('div', { class: 'list-row', 'data-testid': 'ledger-row' },
        el('div', { class: `list-cover ${earn ? 'is-earn' : 'is-spend'}`, 'aria-hidden': 'true' },
          icon(earn ? (entry.action === 'signin' ? 'check' : entry.action === 'import' ? 'upload' : 'play') : 'gift', 17)),
        el('div', { class: 'list-body' },
          el('span', { class: 'list-title', text: MarketPoints.describeEntry(entry) }),
          el('span', { class: 'list-sub', text: fmtRelative(entry.at) }),
        ),
        el('span', { class: `list-amount ${earn ? 'pos' : 'neg'}`.trim(), text: signed(entry.delta) }),
        el('span', { class: 'ledger-balance', text: entry.balanceAfter === null ? '—' : t('余额 {n}', { n: entry.balanceAfter }) }),
      ));
    }
    group.append(list);
    card.append(group);
  }
  card.append(el('div', { class: 'ledger-foot' },
    el('div', { class: 'row', style: { gap: '16px' } },
      el('a', { class: 'section-link', href: '#/favorites?tab=downloads' }, icon('folder', 14), t('我的资源')),
      el('a', { class: 'section-link', href: '#/settings/data' }, icon('trash', 14), t('清除本地数据')),
    ),
    el('span', { class: 'hint', text: t('本机演示 · 不产生真实交易') }),
  ));
  section.append(card);
  return section;
}

function rulesSection() {
  return el('section', { class: 'section' },
    sectionHead(t('积分规则'), t('P1 本地演示：所有积分行为都在本机记账，不可购买 / 转让 / 提现。')),
    el('div', { class: 'card', style: { padding: '20px 22px' } },
      el('ul', { class: 'rules-list' },
        el('li', {}, icon('check', 15), el('span', {}, t('每日签到'), ' ', el('b', { text: `+${POINTS_RULES.signIn}` }), '：每天一次，本地日历日去重')),
        el('li', {}, icon('check', 15), el('span', {}, t('完成练习打卡'), ' ', el('b', { text: `+${POINTS_RULES.practice}` }), '：每天一次（P1 无练习器回传，用按钮模拟）')),
        el('li', {}, icon('check', 15), el('span', {}, t('首次导入资源'), ' ', el('b', { text: `+${POINTS_RULES.importReward}` }), '：每个资源一次，在详情页导入后手动记录')),
        el('li', {}, icon('gift', 15), el('span', {}, t('兑换扣积分'), '：P0 真实资源全部 0 积分（全免费）；积分 > 0 的仅作演示')),
        el('li', {}, icon('shield', 15), el('span', {}, t('不可购买 / 转让 / 提现'), '：没有支付、充值、抽成入口，也不做排行榜与社交')),
      ),
      el('p', { class: 'hint', style: { marginTop: '14px' } },
        t('存储位置：本机 localStorage 键 '), el('code', { text: 'shadow.market.points.v1' }),
        t('；清除浏览器数据或设置页「清除本地数据」后归零。'),
      ),
    ),
  );
}

function redeemSection(repaint) {
  const catalog = getState().catalog;
  const redeemables = (catalog?.resources || []).filter((r) => r.points > 0);
  const items = redeemables.length ? redeemables : [DEMO_REDEEM_ITEM];
  const points = MarketPoints.getPoints();
  const grid = el('div', { class: 'redeem-grid' });
  for (const item of items) {
    const already = MarketPoints.hasMyResource(item.id);
    const canAfford = points >= item.points;
    grid.append(el('div', { class: 'redeem-card', 'data-testid': 'redeem-card' },
      el('div', { class: 'list-cover', 'aria-hidden': 'true' }, icon('gift', 17)),
      el('div', { class: 'redeem-body' },
        el('span', { class: 'redeem-title' }, item.title, item.demo ? el('span', { class: 'badge badge-soft', style: { marginLeft: '6px' }, text: t('演示项') }) : null),
        el('span', { class: 'redeem-sub', text: `${item.points} ${t('积分')} · ${already ? t('已兑换') : canAfford ? t('可兑换') : t('积分不足')}` }),
      ),
      el('button', {
        class: `btn btn-sm ${already ? '' : 'btn-secondary'}`.trim(), type: 'button',
        disabled: already || !canAfford ? true : null,
        'data-testid': 'redeem-demo-btn',
        onclick: () => {
          const result = MarketPoints.redeem(item);
          if (result.ok) toast(t('兑换成功：{title}（扣除 {n} 积分，本地演示）', { title: item.title, n: item.points }), { kind: 'success' });
          else if (result.reason === 'E_INSUFFICIENT') toast(t('积分不足：需要 {need} 分，当前 {have} 分。先签到 / 打卡赚积分。', { need: item.points, have: MarketPoints.getPoints() }), { kind: 'warn' });
          else if (result.reason === 'E_DUPLICATE') toast(t('已经兑换过了（每个演示项一次）'), { kind: 'warn' });
          else toast(t('兑换失败：{reason}', { reason: result.reason }), { kind: 'error' });
          repaint();
        },
      }, already ? t('已兑换') : canAfford ? t('兑换') : t('积分不足')),
    ));
  }
  return el('section', { class: 'section', 'data-testid': 'redeem-section' },
    sectionHead(t('积分兑换'), redeemables.length
      ? t('以下资源需要积分兑换（P1 本地演示，兑换只在本机记账）。')
      : t('当前目录全部资源都是 0 积分（P0 全免费）；下面用本地演示项演示兑换流程。')),
    grid,
  );
}

export function renderPoints(view) {
  view.replaceChildren();
  const repaint = () => renderPoints(view);
  const points = MarketPoints.getPoints();
  const signin = MarketPoints.signInStatus();
  const practice = MarketPoints.practiceStatus();
  const ledger = MarketPoints.getLedger();
  const myCount = MarketPoints.getMyResources().length;

  view.append(pageHead({
    eyebrow: t('POINTS · 本机演示'),
    title: t('积分中心'),
    lead: t('积分是免费资源的兑换凭证：免费获取，不可购买 / 转让 / 提现。P1 只做本地演示，没有后端账号。'),
    actions: [el('a', { class: 'btn btn-secondary btn-sm', href: '#/points#rules' }, icon('info', 14), t('积分规则'))],
  }));

  /* 余额 hero */
  const hero = el('section', { class: 'points-hero', 'data-testid': 'points-balance-card', 'aria-label': t('积分余额') },
    el('div', { class: 'points-hero-main' },
      el('span', { class: 'eyebrow', text: t('当前积分') }),
      el('div', { class: 'points-balance' },
        el('span', { class: 'value', 'data-testid': 'points-balance', text: String(points) }),
        el('span', { class: 'unit', text: t('积分') }),
      ),
      el('div', { class: 'points-caption' },
        el('span', { text: t('签到 / 打卡 / 首次导入获取') }),
        el('span', { class: 'inline-dot' }),
        el('span', { text: t('共 {n} 条流水', { n: ledger.length }) }),
        el('span', { class: 'inline-dot' }),
        el('span', { text: t('我的资源 {n} 个', { n: myCount }) }),
      ),
    ),
    el('div', { class: 'points-hero-side' },
      el('span', { class: 'pill-demo' }, icon('sparkles', 12), t('P1 本地演示 · 无后端')),
      waveSvg(),
      el('span', { class: 'hint', text: t('数据只保存在这台设备的 localStorage，清除浏览器数据即清空。') }),
    ),
  );
  view.append(hero);

  /* 3 个获取动作 */
  view.append(el('section', { class: 'section' },
    sectionHead(t('获取积分'), t('三个免费动作，没有任何付费入口。')),
    el('div', { class: 'points-actions' },
      actionCard({
        iconName: 'check', reward: POINTS_RULES.signIn,
        title: t('每日签到'), desc: t('每天签到一次，保持练习节奏。签到不消耗积分，也没有中断惩罚。'),
        meta: t('每天 00:00 重置'), done: signin.done,
        button: el('button', {
          class: `btn ${signin.done ? '' : 'btn-primary'}`.trim(), type: 'button',
          disabled: signin.done ? true : null, 'data-testid': 'signin-btn',
          onclick: () => {
            const result = MarketPoints.signIn();
            if (result.ok) toast(t('签到成功 +{n} 积分（P1 本地演示，当前 {balance} 分）', { n: POINTS_RULES.signIn, balance: result.balance }), { kind: 'success' });
            else toast(t('今天已经签到过了，明天再来（本地演示同一天只能签一次）'), { kind: 'warn' });
            repaint();
          },
        }, icon(signin.done ? 'check' : 'plus', 14), signin.done ? t('今日已签到') : t('签到')),
      }),
      actionCard({
        iconName: 'play', reward: POINTS_RULES.practice,
        title: t('完成练习打卡'), desc: t('在 SHADOW Studio 完成一次跟读练习，回到市场手动打卡（P1 本地演示，不读取练习数据）。'),
        meta: t('每日 1 次'), done: practice.done,
        button: el('button', {
          class: 'btn btn-secondary', type: 'button',
          disabled: practice.done ? true : null, 'data-testid': 'practice-btn',
          onclick: () => {
            const result = MarketPoints.practiceCheckIn();
            if (result.ok) toast(t('练习打卡成功 +{n} 积分（P1 本地演示，当前 {balance} 分）', { n: POINTS_RULES.practice, balance: result.balance }), { kind: 'success' });
            else toast(t('今天已经打过卡了（P1 无练习器回传，这里是本地按钮）'), { kind: 'warn' });
            repaint();
          },
        }, icon(practice.done ? 'check' : 'play', 14), practice.done ? t('今日已打卡') : t('去练习')),
      }),
      actionCard({
        iconName: 'upload', reward: POINTS_RULES.importReward,
        title: t('首次导入资源'), desc: t('第一次把市场资源导入 SHADOW Studio。每个资源只奖励一次，重复导入不重复计分。'),
        meta: t('每个资源限 1 次'), done: false,
        button: el('a', { class: 'btn btn-secondary', href: '#/import', 'data-testid': 'import-reward-link' }, icon('upload', 14), t('查看导入')),
      }),
    ),
  ));

  view.append(ledgerSection(repaint));
  view.append(rulesSection());
  view.append(redeemSection(repaint));

  view.append(el('p', { class: 'footer-note' },
    el('span', { text: t('SHADOW 市场 · 全免费') }),
    el('span', { text: t('积分不可购买 / 转让 / 提现') }),
    el('span', { text: t('无账号后端 · 数据仅本机') }),
  ));
}
