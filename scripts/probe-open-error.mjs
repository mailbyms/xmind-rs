// Attach to the original XMind editor page as early as possible and dump every
// console message / exception for N seconds. Usage: node scripts/probe-open-error.mjs [seconds]
const SECONDS = Number(process.argv[2] ?? 30);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page = null;
for (let i = 0; i < 120 && !page; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
    page = list.filter((t) => t.type === 'page' && t.url.includes('/renderer/edi')).pop() ?? null;
  } catch {}
  if (!page) await sleep(200);
}
if (!page) { console.log('no editor page'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const out = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    out.push('[' + m.params.type + '] ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 600));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    out.push('[EXC] ' + (d.exception?.description ?? d.text).slice(0, 1200));
  }
  if (m.method === 'Log.entryAdded') {
    const e2 = m.params.entry;
    out.push('[log:' + e2.level + '] ' + (e2.text ?? '').slice(0, 400) + ' ' + (e2.url ?? ''));
  }
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) return { __err: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r?.result?.value;
};

await send('Runtime.enable');
await send('Log.enable');

const t0 = Date.now();
while (Date.now() - t0 < SECONDS * 1000) {
  await sleep(1000);
  const state = await ev(`JSON.stringify({nodes: document.querySelectorAll('[data-topic-id]').length, txt: document.body.innerText.slice(0,60)})`);
  process.stdout.write('.');
  if (typeof state === 'string' && !state.includes('"nodes":0')) { console.log('\nLOADED ' + state); break; }
}
console.log('\n--- console ---');
console.log(out.join('\n') || '(empty)');
const final = await ev(`JSON.stringify({nodes: document.querySelectorAll('[data-topic-id]').length, txt: document.body.innerText.slice(0,120)})`);
console.log('final: ' + final);
ws.close();
