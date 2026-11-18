// Attach to every XMind target as soon as it appears and dump console output.
// Usage: node scripts/probe-orig-console.mjs [seconds=30]
const SECONDS = Number(process.argv[2] ?? 30);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const seen = new Set();
const lines = [];

async function attach(t) {
  if (seen.has(t.id)) return;
  seen.add(t.id);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); return; }
    const tag = t.url.includes('editor-frame') ? 'frame' : t.url.includes('editor.html') ? 'editor' : 'other';
    if (m.method === 'Runtime.consoleAPICalled') {
      lines.push(`[${tag}:${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 800));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      lines.push(`[${tag}:EXC] ` + String(d.exception?.description ?? d.text).slice(0, 1500));
    }
    if (m.method === 'Log.entryAdded') {
      lines.push(`[${tag}:log:${m.params.entry.level}] ` + String(m.params.entry.text ?? '').slice(0, 600));
    }
  };
  await new Promise((r) => { ws.onopen = r; ws.onerror = r; });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Log.enable');
  // Re-announce existing buffered log entries where the runtime supports it.
  await send('Runtime.evaluate', { expression: '1', returnByValue: true });
}

const t0 = Date.now();
while (Date.now() - t0 < SECONDS * 1000) {
  try {
    const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
    for (const t of list) if (t.type === 'page') await attach(t);
  } catch {}
  await sleep(150);
}
console.log(lines.join('\n') || '(no console output)');
process.exit(0);
