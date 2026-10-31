/**
 * 自写安全 Markdown 渲染器（不依赖第三方库，不使用 innerHTML 注入用户内容）。
 *
 * 安全策略（P0 市场只渲染课程包 readme，纯数据、不可信）：
 *  - 所有文本一律走 textContent；块级结构用 DOM API 构建，绝不拼 HTML 字符串后注入；
 *  - 支持白名单语法：标题 / 段落 / 无序·有序列表 / 引用 / 代码块 / 表格 / 分隔线 /
 *    粗体 / 斜体 / 行内代码 / 链接 / 删除线；
 *  - 链接只允许 http(s)、mailto: 与站内相对路径；javascript:/data:/vbscript:/file: 等一拒不渲染为链接；
 *  - 外链统一 rel="noopener noreferrer nofollow"，target="_blank"；
 *  - 不执行任何脚本、不加载远程图片（仅允许 http(s) 图片地址，且为 <img loading="lazy">）；
 *  - 未识别语法按纯文本显示，不抛错。
 */

const MAX_INPUT = 200_000;

const RE_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_HR = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const RE_UL = /^\s{0,3}[-*+]\s+(.*)$/;
const RE_OL = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;
const RE_QUOTE = /^\s{0,3}>\s?(.*)$/;
const RE_FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w-]*)\s*$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

function isSafeHref(href) {
  const raw = String(href || '').trim();
  if (!raw) return null;
  if (raw.startsWith('#')) return raw;
  if (raw.startsWith('/') || raw.startsWith('./') || raw.startsWith('../')) return raw;
  try {
    const u = new URL(raw, 'https://shadow.invalid/');
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') return raw;
  } catch { /* fallthrough */ }
  return null;
}

function isSafeImgSrc(src) {
  try {
    const u = new URL(String(src || '').trim(), 'https://shadow.invalid/');
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch { return null; }
}

/** 行内语法解析（在纯文本基础上构建节点，杜绝 HTML 注入） */
function appendInline(parent, text) {
  const src = String(text ?? '');
  if (!src) return parent;

  // 顺序：行内代码 → 图片 → 链接 → 粗体 → 斜体 → 删除线
  const tokenRe = /(`[^`\n]+`)|(!\[[^\]\n]*\]\([^)\s]+\))|(\[[^\]\n]*\]\([^)\s]+\))|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~\n]+~~)/g;
  let last = 0;
  let m;
  while ((m = tokenRe.exec(src)) !== null) {
    if (m.index > last) parent.append(document.createTextNode(src.slice(last, m.index)));
    const token = m[0];
    if (token.startsWith('`')) {
      const code = document.createElement('code');
      code.textContent = token.slice(1, -1).trim();
      parent.append(code);
    } else if (token.startsWith('![')) {
      const mm = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token);
      const src2 = mm ? isSafeImgSrc(mm[2]) : null;
      if (src2) {
        const img = document.createElement('img');
        img.src = src2;
        img.alt = mm[1] || '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        parent.append(img);
      } else {
        parent.append(document.createTextNode(token));
      }
    } else if (token.startsWith('[')) {
      const mm = /^\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token);
      const href = mm ? isSafeHref(mm[2]) : null;
      if (href) {
        const a = document.createElement('a');
        a.href = href;
        if (/^(https?:|mailto:)/i.test(href)) {
          a.target = '_blank';
          a.rel = 'noopener noreferrer nofollow';
        }
        appendInline(a, mm[1] || href);
        parent.append(a);
      } else {
        // 不安全链接：退化为纯文本（保留可读性，不生成可点击链接）
        parent.append(document.createTextNode(token));
      }
    } else if (token.startsWith('**') || token.startsWith('__')) {
      const strong = document.createElement('strong');
      appendInline(strong, token.slice(2, -2));
      parent.append(strong);
    } else if (token.startsWith('~~')) {
      const del = document.createElement('del');
      appendInline(del, token.slice(2, -2));
      parent.append(del);
    } else {
      const em = document.createElement('em');
      appendInline(em, token.slice(1, -1));
      parent.append(em);
    }
    last = m.index + token.length;
  }
  if (last < src.length) parent.append(document.createTextNode(src.slice(last)));
  return parent;
}

/** 把一行拆成表格单元格（去掉首尾 |） */
function splitTableRow(line) {
  let s = String(line).trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function parseAlign(sepLine) {
  return splitTableRow(sepLine).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return 'left';
  });
}

/** 渲染 Markdown → DocumentFragment（调用方包一层 .md 容器） */
export function renderMarkdown(input, opts = {}) {
  const frag = document.createDocumentFragment();
  let md = typeof input === 'string' ? input : '';
  if (md.length > MAX_INPUT) md = `${md.slice(0, MAX_INPUT)}\n\n…（内容过长，已截断）`;
  md = md.replace(/\r\n?/g, '\n');
  if (!md.trim()) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = opts.emptyText || '本资源没有提供 README。';
    frag.append(p);
    return frag;
  }

  const lines = md.split('\n');
  let i = 0;

  const blank = (s) => !String(s).trim();

  while (i < lines.length) {
    const line = lines[i];

    if (blank(line)) { i += 1; continue; }

    // 代码块
    const fence = RE_FENCE.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const lang = (fence[2] || '').toLowerCase();
      const codeLines = [];
      i += 1;
      while (i < lines.length) {
        const close = new RegExp(`^\\s{0,3}${marker}{3,}\\s*$`).exec(lines[i]);
        if (close) { i += 1; break; }
        codeLines.push(lines[i]);
        i += 1;
      }
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (lang) code.dataset.lang = lang;
      code.textContent = codeLines.join('\n');
      pre.append(code);
      frag.append(pre);
      continue;
    }

    // 标题
    const heading = RE_HEADING.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 6);
      const h = document.createElement(`h${level}`);
      appendInline(h, heading[2]);
      frag.append(h);
      i += 1;
      continue;
    }

    // 分隔线
    if (RE_HR.test(line)) {
      frag.append(document.createElement('hr'));
      i += 1;
      continue;
    }

    // 引用块（连续 > 行）
    if (RE_QUOTE.test(line)) {
      const quoteLines = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) {
        quoteLines.push(RE_QUOTE.exec(lines[i])[1]);
        i += 1;
      }
      const bq = document.createElement('blockquote');
      const p = document.createElement('p');
      appendInline(p, quoteLines.join('\n').replace(/\n{2,}/g, '\n\n'));
      // 引用内换行保留为 <br>
      p.innerHTML = '';
      const parts = quoteLines.join('\n').split('\n');
      parts.forEach((part, idx) => {
        if (idx > 0) p.append(document.createElement('br'));
        appendInline(p, part);
      });
      bq.append(p);
      frag.append(bq);
      continue;
    }

    // 表格：当前行含 | 且下一行是分隔行
    if (line.includes('|') && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1])) {
      const align = parseAlign(lines[i + 1]);
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      splitTableRow(line).forEach((cell, idx) => {
        const th = document.createElement('th');
        if (align[idx]) th.style.textAlign = align[idx];
        appendInline(th, cell);
        headRow.append(th);
      });
      thead.append(headRow);
      table.append(thead);
      i += 2;
      const tbody = document.createElement('tbody');
      while (i < lines.length && lines[i].includes('|') && !blank(lines[i])) {
        const tr = document.createElement('tr');
        splitTableRow(lines[i]).forEach((cell, idx) => {
          const td = document.createElement('td');
          if (align[idx]) td.style.textAlign = align[idx];
          appendInline(td, cell);
          tr.append(td);
        });
        tbody.append(tr);
        i += 1;
      }
      table.append(tbody);
      frag.append(table);
      continue;
    }

    // 无序列表
    if (RE_UL.test(line)) {
      const ul = document.createElement('ul');
      while (i < lines.length && RE_UL.test(lines[i])) {
        const li = document.createElement('li');
        appendInline(li, RE_UL.exec(lines[i])[1]);
        ul.append(li);
        i += 1;
        // 子项（缩进列表）简化为同层续行
      }
      frag.append(ul);
      continue;
    }

    // 有序列表
    if (RE_OL.test(line)) {
      const ol = document.createElement('ol');
      let startNum = Number(RE_OL.exec(line)[1]);
      while (i < lines.length && RE_OL.test(lines[i])) {
        const li = document.createElement('li');
        appendInline(li, RE_OL.exec(lines[i])[2]);
        ol.append(li);
        i += 1;
      }
      if (startNum !== 1) ol.start = startNum;
      frag.append(ol);
      continue;
    }

    // 段落：收集到空行或下一个块级结构
    const paraLines = [];
    while (i < lines.length && !blank(lines[i])) {
      const l = lines[i];
      if (paraLines.length > 0 && (RE_HEADING.test(l) || RE_HR.test(l) || RE_FENCE.test(l) || RE_QUOTE.test(l) || RE_UL.test(l) || RE_OL.test(l))) break;
      if (l.includes('|') && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1])) break;
      paraLines.push(l);
      i += 1;
    }
    if (paraLines.length === 0) { i += 1; continue; }
    const p = document.createElement('p');
    paraLines.forEach((part, idx) => {
      const hardBreak = / {2,}$/.test(part);
      const text = hardBreak ? part.replace(/ {2,}$/, '') : part;
      if (idx > 0) p.append(document.createTextNode(hardBreak ? '\n' : ' '));
      appendInline(p, text);
    });
    frag.append(p);
  }

  return frag;
}

/** 渲染到容器（自动加 .md 类） */
export function renderMarkdownInto(container, md, opts) {
  container.classList.add('md');
  container.replaceChildren(renderMarkdown(md, opts));
  return container;
}
