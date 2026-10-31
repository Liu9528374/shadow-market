/** 导入说明页：一键导入协议（docs/52 §4）、探测演示、降级 3 步、BYOM / 部署 / 自定义端口 */

import { el, fmtDate } from '../dom.js';
import { icon } from '../icons.js';
import { getState } from '../data.js';
import { pageHead, toast } from '../components.js';
import { probeLocalStudio, getAppPortOverride, LOCAL_APP_DEFAULT_RANGE } from '../importer.js';

function stepsList() {
  return el('ol', { class: 'steps' },
    el('li', {},
      el('div', {},
        el('div', { class: 'step-title', text: '下载课程包 .shadowcourse' }),
        el('div', { class: 'step-desc' }, '纯 JSON 单文件（通常 < 200 KB），不含媒体；在任意资源详情页点「下载 .shadowcourse」，或从市场目录直接取文件。'),
      )),
    el('li', {},
      el('div', {},
        el('div', { class: 'step-title', text: '打开 SHADOW Studio 桌面应用' }),
        el('div', { class: 'step-desc' }, '市场与 SHADOW Studio 是两个独立产品：市场是 Web 资源入口，桌面端只保留「导入课程包」这一薄接口，不在工具里塞商店 UI。'),
      )),
    el('li', {},
      el('div', {},
        el('div', { class: 'step-title', text: '把文件拖进窗口，或使用菜单「导入课程包…」' }),
        el('div', { class: 'step-desc' }, '导入后按提示选择你本地的音频 / 视频（BYOM）；也可以先用「仅文本模式」看句子、翻译与时间轴。导入不跑 ASR、不上传数据、不联网（除了 ?import= 取包）。'),
      )),
  );
}

function probeCard() {
  const dot = el('span', { class: 'probe-dot', dataset: { state: 'idle' } });
  const title = el('div', { class: 'probe-text' },
    el('div', { text: '尚未检测本机 SHADOW Studio' }),
    el('div', { class: 'probe-hint', text: `点击「检测本机服务」会探测 127.0.0.1:${LOCAL_APP_DEFAULT_RANGE.start}–${LOCAL_APP_DEFAULT_RANGE.end}/api/health（单端口 300ms 超时，no-cors）` }),
  );
  const btn = el('button', {
    class: 'btn btn-primary btn-sm', type: 'button', 'data-testid': 'probe-local-app',
    onclick: async () => {
      const override = getAppPortOverride();
      btn.disabled = true;
      dot.dataset.state = 'loading';
      title.replaceChildren(
        el('div', { text: override ? `正在检测指定端口 127.0.0.1:${override}…` : '正在探测本机 SHADOW Studio…' }),
        el('div', { class: 'probe-hint', text: '浏览器网络探测不会上传任何数据；若探测失败，控制台会出现 1 条网络层 ERR_CONNECTION_REFUSED 日志（浏览器固有，不是脚本错误）。' }),
      );
      const result = await probeLocalStudio();
      btn.disabled = false;
      if (result.port) {
        dot.dataset.state = 'ok';
        title.replaceChildren(
          el('div', {}, '检测到 SHADOW Studio：', el('strong', { text: `127.0.0.1:${result.port}` })),
          el('div', { class: 'probe-hint', text: `深链格式：http://127.0.0.1:${result.port}/?import=<课程包绝对URL> 。在任意课程详情页点「一键导入」即可直接打开。` }),
        );
        toast(`检测到 SHADOW Studio（127.0.0.1:${result.port}），去课程详情页一键导入吧`, { kind: 'success', timeout: 4200 });
      } else {
        dot.dataset.state = 'fail';
        const tried = result.tried.join(', ');
        title.replaceChildren(
          el('div', { text: result.override ? `指定端口 ${result.override} 未检测到 SHADOW Studio` : '没有检测到本机 SHADOW Studio' }),
          el('div', { class: 'probe-hint' },
            result.mixedContent
              ? '当前页面是 https，浏览器会拦截对 http://127.0.0.1 的探测（混合内容限制）→ 自动降级为下载 + 手动导入。'
              : `已探测端口：${tried}。没检测到也没关系：详情页的一键导入会自动降级为下载 + 3 步说明。`,
          ),
        );
      }
    },
  }, icon('search', 13), '检测本机服务');

  return el('section', { class: 'card' },
    el('div', { class: 'probe-status' }, dot, title, btn),
    el('p', { class: 'points-note' },
      '高级用法：自定义端口可用 URL 参数覆盖，例如 ',
      el('code', { text: '?appPort=18770#/resource/<id>' }),
      ' 或 hash 内 ',
      el('code', { text: '#/resource/<id>?appPort=18770' }),
      '，此时只探测该端口，不再扫描默认区间（方便联调/自定义端口，也不会干扰其它进程）。',
    ),
  );
}

export function renderImport(view) {
  const state = getState();
  view.replaceChildren();

  view.append(pageHead({
    title: '一键导入到 SHADOW Studio',
    sub: '市场是独立 Web 产品：不内嵌商店、不执行插件代码。桌面端只保留「导入课程包」薄接口 —— 探测本地服务 → 深链导入，探测不到自动降级为下载。',
    actions: [{ label: '去探索资源', href: '#/', icon: 'compass' }],
  }));

  const left = el('div', {},
    el('section', { class: 'card' },
      el('h2', { class: 'card-title' }, icon('upload', 15), ' 一键导入原理（P0 协议）'),
      el('p', { class: 'card-desc', text: 'Web 详情页按钮按 docs/52 §4 执行：①探测本机服务；②探测到则打开工具深链；③探测不到自动降级下载；④包 URL 同源静态文件，工具跨域 fetch 需要 CORS（serve.mjs 已带 Access-Control-Allow-Origin: *）。' }),
      el('pre', { class: 'code-block' }, `1. 探测: fetch('http://127.0.0.1:18765..18775/api/health', { mode: 'no-cors' })  // 单端口 300ms 超时
2. 打开: location.href = 'http://127.0.0.1:<port>/?import=' + encodeURIComponent(<包绝对URL>)
3. 降级: 下载 .shadowcourse + 3 步说明（下载 → 打开 SHADOW Studio → 拖进窗口）
4. 工具侧导入不跑 ASR；BYOM 选本地媒体；不上传任何数据`),
      el('p', { class: 'points-note', text: '包 URL = new URL(resource.packageUrl, location.href)；例如 http://127.0.0.1:18920/data/packages/com.shadow.course.cafe-order.shadowcourse' }),
    ),
    el('section', { class: 'card' },
      el('h2', { class: 'card-title' }, icon('download', 15), ' 探测不到时：下载 + 手动导入（3 步）'),
      stepsList(),
    ),
  );

  const right = el('div', {},
    probeCard(),
    el('section', { class: 'card' },
      el('h2', { class: 'card-title' }, icon('shield', 15), ' 边界与诚实说明'),
      el('ul', { class: 'points-rule-list' },
        el('li', {}, el('strong', { text: 'BYOM：' }), '市场不托管影视媒体、不上传用户媒体；课程包内只有文本 / 时间轴 / 翻译 / 练习配置。'),
        el('li', {}, el('strong', { text: '纯数据：' }), '包是单文件 JSON，不执行脚本、不允许内联 HTML；README 按白名单 Markdown 渲染。'),
        el('li', {}, el('strong', { text: '不跑 ASR：' }), '句子时间轴随包提供，导入后直接用；媒体由用户本地选择。'),
        el('li', {}, el('strong', { text: '部署注意：' }), '市场部署到任意静态托管（GitHub Pages / 对象存储）即可；https 页面探测 http://127.0.0.1 会被浏览器拦截 → 自动走下载降级，这是浏览器安全限制，不是市场故障。'),
      ),
    ),
    el('section', { class: 'card' },
      el('h2', { class: 'card-title' }, icon('database', 15), ' 当前数据源'),
      el('p', { class: 'card-desc' },
        state.catalog
          ? `目录已加载（${state.fixture ? '演示夹具' : '真实 data/catalog.json'}）· ${state.catalog.resources.length} 个资源 · 生成于 ${fmtDate(state.catalog.generatedAt)}。`
          : '资源目录未加载，详情页的下载 / 导入入口不可用；请先启动本地服务或检查 data/catalog.json。',
      ),
      el('p', { class: 'points-note' }, '本地启动：', el('code', { text: 'node market/serve.mjs' }), '（默认 http://127.0.0.1:18920/，端口占用自动 +1..+20）。'),
    ),
  );

  view.append(el('div', { class: 'import-grid' }, left, right));
}
