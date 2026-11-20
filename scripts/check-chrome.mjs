// Regression: the top bar must show the app mark right of the menu button,
// and the bottom status bar must show the packaged app version at its right
// end.  Both are chrome-only assertions; they never inspect the document.
//
//   CDP_PORT=9233 node scripts/check-chrome.mjs
//
// Requires the app on CDP with any .xmind open.
const PORT = process.env.CDP_PORT || 9223;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error(`no page on CDP ${PORT}`);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve: done, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : done(m.result);
  }
});
const send = (method, params = {}) => new Promise((done, reject) => {
  const mid = ++id;
  pending.set(mid, { resolve: done, reject });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));
const ev = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(String(res.exceptionDetails.exception?.description ?? ''));
  return res.result.value;
};

const c = await ev(`(() => {
  const q = (s) => document.querySelector(s);
  const r = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10,
      w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10,
      right: Math.round(b.right * 10) / 10, bottom: Math.round(b.bottom * 10) / 10,
      cx: Math.round((b.x + b.right) / 2 * 10) / 10 };
  };
  const menu = q('.menu-btn'), glyph = q('.menu-btn svg'),
    icon = q('.app-icon'), title = q('.titlebar-title'),
    left = q('.titlebar-left'), toolbar = q('.toolbar'), name = q('.doc-name'),
    bar = q('.statusbar'), version = q('.sb-version'),
    groups = [...document.querySelectorAll('.toolbar > .tool-group')],
    styleTab = [...document.querySelectorAll('button')]
      .find((b) => (b.textContent || '').trim() === '样式');
  return {
    menu: r(menu), glyph: r(glyph), icon: { ...r(icon), complete: icon?.complete,
      natural: icon?.naturalWidth, src: icon?.getAttribute('src'),
      title: icon?.getAttribute('title'), tag: icon?.tagName },
    title: r(title), left: r(left), toolbar: r(toolbar), name: r(name),
    mainGroup: r(groups[0]), formatGroup: r(groups[groups.length - 1]),
    style: r(styleTab),
    bar: r(bar), version: { ...r(version), text: version?.textContent?.trim(),
      tip: version?.getAttribute('title') },
  };
})()`);

const round = (v) => Math.round(v * 10) / 10;
let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}     ${label}${detail ? '  ' + detail : ''}`);
};

console.log(JSON.stringify(c, null, 1));
check(c.icon.tag === 'IMG', '应用图标是 <img>');
check(!!c.icon.src && c.icon.complete === true && c.icon.natural > 0,
  '图标资源已加载', `natural=${c.icon.natural}`);
check(c.icon.x >= c.menu.right - 0.5, '图标在菜单按钮右侧',
  `menu.right=${c.menu.right} icon.x=${c.icon.x}`);
check(c.icon.right <= c.title.x + 0.5, '图标在文档标题左侧',
  `icon.right=${c.icon.right} title.x=${c.title.x}`);
check(Math.abs(c.icon.h - c.glyph.h) <= 0.5, '图标高度与菜单图标一致',
  `app=${c.icon.h} menu=${c.glyph.h}`);
check(Math.abs(c.icon.y - c.glyph.y) <= 0.5, '图标顶部与菜单图标对齐',
  `app=${c.icon.y} menu=${c.glyph.y}`);
check(c.toolbar.x >= c.left.right - 0.5, '工具栏未被图标挤到重叠',
  `left.right=${c.left.right} toolbar.x=${c.toolbar.x}`);
check(c.name.w > 40, '文档名仍可读', `w=${c.name.w}`);

const mid = c.style ? (c.name.cx + c.style.cx) / 2 : Number.NaN;
check(!!c.style && Math.abs(c.mainGroup.cx - mid) <= 6,
  '主工具组居中于文件名与样式之间',
  `group=${c.mainGroup.cx} midpoint=${round(mid)}`);
check(c.formatGroup.x >= c.mainGroup.right, '格式按钮仍位于主工具组右侧',
  `main.right=${c.mainGroup.right} format.x=${c.formatGroup.x}`);

check(/^v\d+\.\d+\.\d+/.test(c.version.text || ''), '状态栏显示语义化版本号',
  `text=${JSON.stringify(c.version.text)}`);
check((c.version.tip || '').includes('XMind RS'), '版本号有关于提示', `tip=${c.version.tip}`);
check(c.version.x >= c.bar.x && c.version.right <= round(c.bar.right + 0.5) &&
  c.version.y >= c.bar.y && c.version.bottom <= round(c.bar.bottom + 0.5),
  '版本号位于状态栏内');
check(c.version.x > c.toolbar.x, '版本号在状态栏右端', `x=${c.version.x}`);

ws.close();
if (failures) throw new Error(`${failures} chrome assertion(s) failed`);
console.log('ALL PASS');
