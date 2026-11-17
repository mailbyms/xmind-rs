import { writeFileSync } from 'node:fs';
const PORT = process.env.CDP_PORT || '9244';
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((ok) => {
  const mid = ++id; pending.set(mid, ok);
  ws.send(JSON.stringify({ id: mid, method, params }));
});
console.log('navigate', JSON.stringify(await send('Page.navigate', { url: 'http://tauri.localhost/' })));
await new Promise((r) => setTimeout(r, 4000));
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  return r?.result?.value;
};
console.log('bodyLen', await ev('document.body.innerHTML.length'));
console.log('menu', await ev('!!document.querySelector(".menu-btn")'));
console.log('html', await ev('document.documentElement.outerHTML.slice(0, 300)'));
ws.close();
process.exit(0);
