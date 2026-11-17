import { writeFileSync } from 'node:fs';
const PORT = process.env.CDP_PORT || '9244';
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const events = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  else if (m.method && /exceptionThrown|consoleAPICalled|log.entryAdded|loadingFailed/.test(m.method)) {
    events.push({ method: m.method, params: m.params });
  }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((ok) => {
  const mid = ++id; pending.set(mid, ok);
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Network.enable');
await send('Page.navigate', { url: 'http://tauri.localhost/' });
await new Promise((r) => setTimeout(r, 8000));
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  return r?.result?.value;
};
console.log('bodyLen', await ev('document.body.innerHTML.length'));
console.log('menu', await ev('!!document.querySelector(".menu-btn")'));
console.log('errors:', JSON.stringify(events, null, 1).slice(0, 4000));
writeFileSync('target/verify/underline/app-console.json', JSON.stringify(events, null, 1));
ws.close();
process.exit(0);
