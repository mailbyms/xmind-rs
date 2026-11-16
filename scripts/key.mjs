// Press a single key with no modifiers on the app page.
// Usage: node scripts/key.mjs Tab [port]
const key = process.argv[2] || 'Tab';
const PORT = process.argv[3] || process.env.CDP_PORT || 9222;
const codes = { Tab: 9, Enter: 13, Escape: 27, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40 };
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const mid = ++id; pending.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params })); });
await new Promise((r) => ws.addEventListener('open', r));
const vk = codes[key] ?? key.toUpperCase().charCodeAt(0);
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
console.log('pressed', key);
ws.close();
process.exit();
