// Read the shipped canvas colours while a 配色方案 is active, to tell whether
// card #1 (active) is a real single-colour theme or just a selected swatch.
const P = Number(process.env.CDP_PORT || 9222);
const list = await (await fetch(`http://127.0.0.1:${P}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html\?/.test(t.url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const q = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && q.has(m.id)) { q.get(m.id)(m.result); q.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const ev = (x) => new Promise((r) => {
  const i = ++id; q.set(i, r);
  ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: x, returnByValue: true, awaitPromise: true } }));
}).then((r) => r.result?.value);

const EXPR = `(() => {
  const chips = [...document.querySelectorAll('.color-list-preview > div')].map(d => getComputedStyle(d).backgroundColor);
  const nodes = [...document.querySelectorAll('[data-view-id^="topic-node:"]')].slice(0, 9).map(g => ({
    id: g.getAttribute('data-view-id').slice(11, 19),
    fills: [...g.querySelectorAll('path')].map(p => p.getAttribute('fill')).filter(v => v && v !== 'none').slice(0, 3),
    strokes: [...g.querySelectorAll('path')].map(p => p.getAttribute('stroke')).filter(v => v && v !== 'none').slice(0, 2),
  }));
  const cards = [...document.querySelectorAll('.uk-card.uk-card-selectable')].map(c => c.classList.contains('uk-active'));
  return {
    trigger: (document.querySelector('button[title="选择配色方案。"]')?.innerText || '').trim(),
    chips, nodes, cards,
  };
})()`;
console.log(JSON.stringify(await ev(EXPR), null, 1));
ws.close();
