// Report per-target: url tail, hasFocus, doc title, panel presence.
const PORT = process.env.CDP_PORT || 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = list.filter((t) => t.type === 'page');
const probe = (page) => new Promise((resolve) => {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((r) => { const mid = ++id; pending.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params })); });
  ws.addEventListener('open', async () => {
    const res = await send('Runtime.evaluate', {
      expression: `JSON.stringify({focus: document.hasFocus(), vis: document.visibilityState, title: document.title, url: location.pathname.split('/').pop(), outliner: !!document.querySelector('.outliner-mode-container'), sb: !!document.querySelector('.workbench-status-bar'), vw: innerWidth, vh: innerHeight})`,
      returnByValue: true,
    });
    resolve({ id: page.id, value: res && res.result && res.result.value });
    ws.close();
  });
});
const out = [];
for (const p of pages) out.push({ id: p.id, url: p.url.split('/').pop(), info: await probe(p) });
console.log(JSON.stringify(out, null, 1));
process.exit();
