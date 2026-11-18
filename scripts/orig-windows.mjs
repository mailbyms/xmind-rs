// List every original-XMind editor window with its file and load state.
// Usage: node scripts/orig-windows.mjs
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const pages = list.filter((t) => t.type === 'page' && t.url.includes('/renderer/edi') && t.url.includes('isBrowserView=true'));
console.log('windows:', pages.length);
for (const t of pages) {
  const url = decodeURIComponent(t.url);
  const file = url.match(/source=file:\/\/\/(.+?)(&|$)/)?.[1] ?? url.match(/file:\/\/\/(.+?)(&|$)/)?.[1] ?? '?';
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); } };
  await new Promise((r) => (ws.onopen = r));
  const ev = (expr) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } })); });
  const expr = `JSON.stringify({ status: document.body.innerText.match(/主题: ?[0-9]+( \\/ [0-9]+)?/)?.[0] ?? null, topics: document.querySelectorAll('.topic').length, cancel: document.querySelectorAll('[class*=cancel]').length, modal: document.body.innerText.includes('打开失败') || document.body.innerText.includes('无法打开') })`;
  const r = await ev(expr);
  console.log(file.split('/').pop() + ' => ' + (r?.result?.value ?? JSON.stringify(r)));
  ws.close();
}
