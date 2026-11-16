// Open a shipped popover and dump the class list of every tile/swatch inside it,
// plus the inner HTML of the entries that look selected.
// Usage: node scripts/pop-classes.mjs "<selector>" [max]
const selector = process.argv[2];
const max = Number(process.argv[3] || 8);
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
await new Promise((r) => ws.addEventListener('open', r));
for (const type of ['keyDown', 'keyUp']) {
  await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
}
await new Promise((r) => setTimeout(r, 150));

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
  const nodes = [...root.querySelectorAll('button, li, div[class*="tile"], div[class*="swatch"], div[class*="color"]')];
  const rows = nodes.slice(0, 60).map((e) => {
    const b = e.getBoundingClientRect();
    return e.tagName.toLowerCase() + ' [' + String(e.className) + '] '
      + Math.round(b.width) + 'x' + Math.round(b.height);
  });
  const sel = nodes.filter((e) => /selected|checked|active|\\bon\\b/.test(String(e.className)))
    .map((e) => String(e.className) + ' >>> ' + e.innerHTML.slice(0, 400));
  return { rows, sel };
})()`);
if (out.error) { console.error('NO POPOVER'); process.exit(1); }
console.log(out.rows.slice(0, max).join('\n'));
console.log('--- rows total', out.rows.length);
console.log('--- selected:\n' + (out.sel.join('\n') || '(none)'));
ws.close();
process.exit();
