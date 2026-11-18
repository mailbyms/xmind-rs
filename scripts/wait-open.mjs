// Poll the original XMind editor until a topic appears, then print the result.
// Usage: node scripts/wait-open.mjs [seconds=25]
const LIMIT = Number(process.argv[2] ?? 25);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page = null;
for (let i = 0; i < 40 && !page; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
    page = list.filter((t) => t.type === 'page' && t.url.includes('/renderer/edi')).pop() ?? null;
  } catch {}
  if (!page) await sleep(250);
}
if (!page) { console.log('NO_PAGE'); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const ev = (expr) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } })); });

const t0 = Date.now();
let nodes = 0;
while (Date.now() - t0 < LIMIT * 1000) {
  const r = await ev(`document.querySelectorAll('[data-topic-id]').length`);
  nodes = r?.result?.value ?? 0;
  if (nodes > 0) break;
  await sleep(500);
}
const txt = (await ev(`document.body.innerText.slice(0,80)`))?.result?.value ?? '';
console.log(nodes > 0 ? `OPENED nodes=${nodes}` : `FAILED nodes=0 text=${JSON.stringify(txt)}`);
ws.close();
process.exit(nodes > 0 ? 0 : 1);
