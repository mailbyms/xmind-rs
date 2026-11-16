// Dump the geometry + computed styles of a shipped popover down to its leaves.
// Opens the popover by clicking `selector`, walks the DOM inside it (depth 3),
// and prints one line per node so the CSS can be reproduced exactly.
// Usage: node scripts/pop-metrics.mjs "<selector>" [depth]
const selector = process.argv[2];
const depth = Number(process.argv[3] || 3);
const PORT = process.env.CDP_PORT || 9222;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = (process.env.CDP_TARGET_ID && list.find((t) => t.id === process.env.CDP_TARGET_ID))
  ?? list.find((t) => t.type === 'page' && /editor\.html/.test(t.url))
  ?? list.find((t) => t.type === 'page');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'eval error');
  return res.result.value;
};
const esc = async () => {
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  }
  await new Promise((r) => setTimeout(r, 150));
};
await new Promise((r) => ws.addEventListener('open', r));

await esc();
const opened = await evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return { error: 'missing' };
  el.scrollIntoView({ block: 'center' });
  el.click();
  return { ok: true };
})()`);
if (opened.error) { console.error('OPEN FAIL', selector); process.exit(1); }
await new Promise((r) => setTimeout(r, 400));

const out = await evaluate(`(() => {
  const vis = [...document.querySelectorAll('[class*="uk-pop"], [class*="uk-menu"]')]
    .map((e) => ({ e, b: e.getBoundingClientRect() }))
    .filter(({ e, b }) => b.width > 30 && b.height > 16
      && !/overlay/.test(String(e.className))
      && b.width < innerWidth - 8 && b.height < innerHeight - 8);
  if (!vis.length) return { error: 'no popover' };
  vis.sort((a, b) => b.b.width * b.b.height - a.b.width * a.b.height);
  const root = vis[0].e;

  const pick = (cs, keys) => keys.map((k) => k + '=' + cs.getPropertyValue(k)).join('; ');
  const KEYS = ['padding','gap','row-gap','column-gap','border-radius','background-color',
    'box-shadow','border','display','grid-template-columns','font-size','font-weight',
    'line-height','color','margin','width','height','backdrop-filter','overflow','align-items'];

  const lines = [];
  const walk = (el, level) => {
    if (!el || level > ${depth}) return;
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    lines.push('  '.repeat(level) + '<' + el.tagName.toLowerCase()
      + (el.className ? '.' + String(el.className).trim().replace(/\\s+/g, '.') : '')
      + '> ' + [Math.round(b.width), Math.round(b.height)].join('x')
      + ' @' + [Math.round(b.x), Math.round(b.y)].join(',')
      + ' | ' + pick(cs, KEYS));
    let kids = [...el.children];
    // Collapse a long sibling list: keep first 3 children and count the rest.
    if (kids.length > 3) kids = [...kids.slice(0, 3), null];
    for (const kid of kids) {
      if (kid === null) { lines.push('  '.repeat(level + 1) + '… ' + (el.children.length - 3) + ' more'); continue; }
      walk(kid, level + 1);
    }
  };
  walk(root, 0);
  return { r: [Math.round(vis[0].b.x), Math.round(vis[0].b.y), Math.round(vis[0].b.width), Math.round(vis[0].b.height)],
    cls: String(root.className), lines };
})()`);
if (out.error) { console.error('NO POPOVER'); process.exit(1); }
console.log('ROOT', out.cls, out.r.join(' '));
console.log(out.lines.join('\n'));
ws.close();
process.exit();
