// Open a file in the running app and report the markers/image each shallow node
// parsed to.  Usage: node scripts/check-read.mjs <file.xmind>
const PORT = process.env.CDP_PORT || 9223;
const file = process.argv[2];
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const ev = (expression) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });

await ev(`window.__TAURI_INTERNALS__.invoke('doc_open', { path: ${JSON.stringify(file)} })`);
const res = await ev(`window.__TAURI_INTERNALS__.invoke('doc_layout').then((l) => JSON.stringify(l.nodes.filter((n) => n.depth < 2).map((n) => [n.title, n.markers, n.image ? 'img' : ''])))`);
console.log(res?.result?.value ?? JSON.stringify(res));
ws.close();
