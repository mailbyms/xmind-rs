// Open a .xmind through the app's IPC and save it to a new path, so we can check
// what the writer actually produces.  Usage: node scripts/resave.mjs <in> <out>
const PORT = process.env.CDP_PORT || 9223;
const [, , input, output] = process.argv;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const ev = (expression) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });

const opened = await ev(`window.__TAURI_INTERNALS__.invoke('doc_open', { path: ${JSON.stringify(input)} }).then(s => s.path)`);
console.log('opened:', JSON.stringify(opened?.result?.value ?? opened));
const saved = await ev(`window.__TAURI_INTERNALS__.invoke('doc_save', { path: ${JSON.stringify(output)} }).then(s => s.path)`);
console.log('saved:', JSON.stringify(saved?.result?.value ?? saved));
ws.close();
