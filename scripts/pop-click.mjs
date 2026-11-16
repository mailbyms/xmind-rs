// Click a popover item: open the toggle, then click the item by text or index.
// Usage: node scripts/pop-click.mjs "<toggle selector>" "<item text>" [index]
const PORT = process.env.CDP_PORT || 9222;
const selector = process.argv[2];
const needle = process.argv[3] ?? '';
const index = Number(process.argv[4] ?? 0);

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

const open = await evaluate(`(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.getBoundingClientRect().width > 0)[0];
  if (!el) return { error: 'toggle missing' };
  el.scrollIntoView({ block: 'center' });
  el.click();
  return { ok: true };
})()`);
if (open.error) { console.error(JSON.stringify(open)); process.exit(1); }
await new Promise((r) => setTimeout(r, 320));

const hit = await evaluate(`(() => {
  const vis = [...document.querySelectorAll('[class*="uk-pop"], [class*="uk-menu"]')]
    .map((e) => ({ e, b: e.getBoundingClientRect() }))
    .filter(({ e, b }) => b.width > 30 && b.height > 16 && !/overlay/.test(String(e.className)));
  if (!vis.length) return { error: 'no popover' };
  vis.sort((a, b) => b.b.width * b.b.height - a.b.width * a.b.height);
  const pop = vis[0].e;
  const items = [...pop.querySelectorAll('li > button, button')].filter((b) => b.getBoundingClientRect().height > 10);
  const needle = ${JSON.stringify(needle)};
  let target = needle
    ? items.find((b) => (b.innerText || '').trim() === needle) ?? items.find((b) => (b.innerText || '').includes(needle))
    : items[${index}];
  if (!target) return { error: 'item missing', have: items.map((b) => (b.innerText || '').trim()).slice(0, 20) };
  const text = (target.innerText || '').trim();
  target.click();
  return { ok: true, text };
})()`);
console.log(JSON.stringify(hit));
await new Promise((r) => setTimeout(r, 400));
ws.close();
process.exit();
