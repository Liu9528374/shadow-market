/** 导入说明页（#/import）：主路径 .shadow.json（5 步）/ 备选 .srt / 一键导入协议 / BYOM / 3 个坑 */

import { el, fmtDate } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { getState } from '../data.js';
import { probeLocalStudio, getAppPortOverride, LOCAL_APP_DEFAULT_RANGE } from '../importer.js';
import { toast } from '../components.js';

const STEPS_SHADOW_JSON = [
  ['下载 .shadow.json', '在任意资源详情页点「下载导入 → 下载 .shadow.json」（推荐主路径，唯一带翻译）。'],
  ['打开 SHADOW Studio（r19）', '市场与 SHADOW Studio 是两个独立产品：市场是 Web 资源入口，桌面端只保留「导入课程包」这一薄接口。'],
  ['File → Open Project…（Ctrl+O）', '在桌面端菜单选择 File → Open Project…，选中刚下载的 .shadow.json。'],
  ['把同名媒体拖进窗口', '桌面端会提示「把同名媒体拖进窗口」；把自备媒体重命名为课程页公示的名字后拖入。没有媒体时可选「仅文本模式」先看句子与翻译。'],
  ['播放 / 影子跟读练习', '播放时按句子高亮与翻译做影子跟读练习；录音/评分以桌面端版本能力为准。'],
];

const STEPS_SRT = [
  ['下载 .srt', '在详情页「下载导入」弹层中选择 .srt（无翻译，任何播放器 / 工具都可用）。'],
  ['先导入媒体', '在桌面端导入你的本地媒体（任意文件名）；字幕需要依附于一个 clip。'],
  ['File → Import Subtitle…', '选择 .srt 建立句子（无翻译）；之后可手工补翻译。'],
];

const PITFALLS = [
  '① 媒体名必须与课程页公示的媒体名逐字一致，否则会新建重复 clip。',
  '② 打开后不要点 Analyze / Generate Subtitles —— 会用「待转写」覆盖包里的句子。',
  '③ 媒体必须与句子时间轴同源（同一版本视频/音频），否则对不上口型。',
];

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

function card(title, iconName, ...children) {
  return el('section', { class: 'card', 'data-testid': `import-${title}` },
    el('h2', { class: 'card-title' }, iconName ? icon(iconName, 16) : null, title),
    ...children,
  );
}

function stepsList(steps) {
  return el('ol', { class: 'steps' }, steps.map(([title, desc]) => el('li', {},
    el('span', { class: 'step-title', text: t(title) }),
    el('span', { class: 'step-desc', text: t(desc) }),
  )));
}

function probeCard() {
  const dot = el('span', { class: 'probe-dot', dataset: { state: 'idle' } });
  const title = el('div', { class: 'probe-text' },
    el('div', { text: t('尚未检测本机 SHADOW Studio') }),
    el('div', { class: 'probe-hint', text: t('点击「检测本机服务」会探测 127.0.0.1:{start}–{end}/api/health（单端口 300ms 超时，no-cors），不上传任何数据。', { start: LOCAL_APP_DEFAULT_RANGE.start, end: LOCAL_APP_DEFAULT_RANGE.end }) }),
  );
  const btn = el('button', {
    class: 'btn btn-primary btn-sm', type: 'button', 'data-testid': 'probe-local-app',
    onclick: async () => {
      const override = getAppPortOverride();
      btn.disabled = true;
      dot.dataset.state = 'loading';
      title.replaceChildren(
        el('div', { text: override ? t('正在检测指定端口 127.0.0.1:{port}…', { port: override }) : t('正在探测本机 SHADOW Studio…') }),
        el('div', { class: 'probe-hint', text: t('浏览器网络探测不会上传任何数据；若探测失败，控制台会出现 1 条网络层 ERR_CONNECTION_REFUSED 日志（浏览器固有，不是脚本错误）。') }),
      );
      const result = await probeLocalStudio();
      btn.disabled = false;
      if (result.port) {
        dot.dataset.state = 'ok';
        title.replaceChildren(
          el('div', {}, `${t('检测到 SHADOW Studio')}：`, el('strong', { text: `127.0.0.1:${result.port}` })),
          el('div', { class: 'probe-hint', text: t('深链格式：http://127.0.0.1:{port}/?import=<课程包绝对 URL>。在任意课程详情页点「一键导入」即可直接打开。', { port: result.port }) }),
        );
        toast(t('检测到 SHADOW Studio（127.0.0.1:{port}），去课程详情页一键导入吧', { port: result.port }), { kind: 'success', timeout: 4200 });
      } else {
        dot.dataset.state = 'fail';
        title.replaceChildren(
          el('div', { text: result.override ? t('指定端口 {port} 未检测到 SHADOW Studio', { port: result.override }) : t('没有检测到本机 SHADOW Studio') }),
          el('div', { class: 'probe-hint' },
            result.mixedContent
              ? t('当前页面是 https，浏览器会拦截对 http://127.0.0.1 的探测（混合内容限制）→ 自动降级为下载 + 手动导入。')
              : t('已探测端口：{ports}。没检测到也没关系：详情页的一键导入会自动降级为下载 + 3 步说明。', { ports: result.tried.join(', ') }),
          ),
        );
      }
    },
  }, icon('search', 13), t('检测本机服务'));

  return card(t('检测本机服务'), 'shield',
    el('div', { class: 'probe-status' }, dot, title, btn),
    el('p', { class: 'hint', style: { marginTop: '10px' } },
      t('高级用法：自定义端口可用 URL 参数覆盖，例如 '),
      el('code', { text: '#/resource/<id>?appPort=18770' }),
      t('，此时只探测该端口，不再扫描默认区间（方便联调/自定义端口，也不会干扰其它进程）。'),
    ),
  );
}

export function renderImport(view) {
  const state = getState();
  view.replaceChildren();

  view.append(pageHead({
    eyebrow: t('IMPORT · BYOM 免 ASR'),
    title: t('一键导入到 SHADOW Studio'),
    lead: t('市场是独立 Web 产品：不内嵌商店、不执行插件代码。桌面端只保留「导入课程包」薄接口 —— 探测本地服务 → 深链导入，探测不到自动降级为下载。'),
    actions: [el('a', { class: 'btn btn-secondary btn-sm', href: '#/market' }, icon('compass', 14), t('去市场选资源'))],
  }));

  const main = el('div', { class: 'import-main' },
    card(t('主路径：.shadow.json（5 步）'), 'download',
      el('p', { class: 'card-desc', text: t('.shadow.json 是带翻译的工程文件：句子时间轴 + 中文翻译 + 练习配置，打开后即可练习；媒体自备（BYOM）。') }),
      stepsList(STEPS_SHADOW_JSON),
    ),
    card(t('备选路径：.srt（无翻译）'), 'file-text',
      stepsList(STEPS_SRT),
    ),
    card(t('一键导入原理（P0 协议）'), 'terminal',
      el('p', { class: 'card-desc', text: t('Web 详情页按钮按 docs/52 §4 执行：①探测本机服务；②探测到则打开工具深链；③探测不到自动降级下载；④包 URL 同源静态文件，工具跨域 fetch 需要 CORS（serve.mjs 已带 Access-Control-Allow-Origin: *）。') }),
      el('div', { class: 'codeblock' },
        el('div', { class: 'codeblock-head' }, el('span', { text: t('协议步骤') }), el('span', { text: 'fetch / location' })),
        el('pre', {}, "1. 探测: fetch('http://127.0.0.1:18765..18775/api/health', { mode: 'no-cors' })  // 单端口 300ms 超时\n2. 打开: location.href = 'http://127.0.0.1:<port>/?import=' + encodeURIComponent(<包绝对URL>)\n3. 降级: 下载 .shadowcourse + 3 步说明（下载 → 打开 SHADOW Studio → 拖进窗口）\n4. 工具侧导入不跑 ASR；BYOM 选本地媒体；不上传任何数据"),
      ),
      el('p', { class: 'hint' }, t('包 URL = new URL(resource.packageUrl, location.href)；例如 http://127.0.0.1:18920/data/packages/<id>.shadowcourse')),
    ),
    card(t('失败排查'), 'help-circle',
      el('ul', { class: 'bullets' },
        el('li', {}, t('下载的 .shadow.json 是 0 字节 / 打不开：检查静态托管是否允许下载 data/import/ 目录；可改用 .shadowcourse 或邮件反馈。')),
        el('li', {}, t('打开工程后提示媒体缺失：把媒体改成课程页公示的文件名再拖入；或先用「仅文本模式」。')),
        el('li', {}, t('一键导入没有反应：确认 SHADOW Studio 正在运行且允许本地服务；https 页面需用下载降级（浏览器混合内容限制）。')),
      ),
    ),
  );

  const side = el('aside', { class: 'import-side' },
    probeCard(),
    card(t('3 个坑'), 'help-circle',
      el('ul', { class: 'pitfalls' }, PITFALLS.map((text) => el('li', { text: t(text) }))),
    ),
    card(t('边界与诚实说明'), 'shield',
      el('ul', { class: 'bullets' },
        el('li', {}, el('b', { text: 'BYOM：' }), t('市场不托管影视媒体、不上传用户媒体；课程包内只有文本 / 时间轴 / 翻译 / 练习配置。')),
        el('li', {}, el('b', { text: `${t('纯数据')}：` }), t('包是单文件 JSON，不执行脚本、不允许内联 HTML；README 按白名单 Markdown 渲染。')),
        el('li', {}, el('b', { text: `${t('不跑 ASR')}：` }), t('句子时间轴随包提供，导入后直接用；媒体由用户本地选择。')),
        el('li', {}, el('b', { text: `${t('部署注意')}：` }), t('https 页面探测 http://127.0.0.1 会被浏览器拦截 → 自动走下载降级，这是浏览器安全限制，不是市场故障。')),
      ),
    ),
    card(t('当前数据源'), 'layers',
      el('p', { class: 'card-desc' },
        state.catalog
          ? `${t('目录已加载')}（${state.fixture ? t('演示夹具') : (state.schemaVersion === 2 ? 'catalog/ (v2)' : 'data/catalog.json（兼容层）')}）· ${state.catalog.resources.length} ${t('个资源')} · ${t('生成于')} ${fmtDate(state.catalog.generatedAt)}。`
          : t('资源目录未加载，详情页的下载 / 导入入口不可用；请先启动本地服务或检查 catalog/。'),
      ),
      el('p', { class: 'hint' }, `${t('本地启动')}：`, el('code', { text: 'node market/serve.mjs' }), t('（默认 http://127.0.0.1:18920/，端口占用自动 +1..+20）。')),
    ),
  );

  view.append(el('div', { class: 'import-layout' }, main, side));
  view.append(el('p', { class: 'footer-note' },
    el('span', { text: t('BYOM · 不上传用户媒体') }),
    el('a', { class: 'text-link', href: '#/contribute' }, t('投稿指南')),
    el('a', { class: 'text-link', href: '#/complaint' }, t('版权与投诉')),
  ));
}
