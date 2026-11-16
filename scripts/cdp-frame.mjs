// CDP driver bound to the editor frame (the page that owns the sheet + format panel).
// Usage: node scripts/cdp.mjs <file.js>
// The file is evaluated in the editor page; whatever it exports is printed as JSON.
import { readFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || 9222;

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

async function pick() {
  const list = await targets();
  const page = list.find((t) => t.type === 'page' && /editor-frame\.html/.test(t.url))
    ?? list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target: ' + JSON.stringify(list.map((t) => t.url)));
  return page.webSocketDebuggerUrl;
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  return {
    ready,
    send(method, params = {}) {
      const mid = ++id;
      return new Promise((resolve, reject) => {
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    },
    close() { ws.close(); },
  };
}

const file = process.argv[2];
if (!file) throw new Error('usage: node scripts/cdp.mjs <expr.js>');
const source = readFileSync(file, 'utf8');

const cdp = connect(await pick());
await cdp.ready;
const res = await cdp.send('Runtime.evaluate', {
  expression: source,
  awaitPromise: true,
  returnByValue: true,
  allowUnsafeEvalBlockedByCSP: true,
});
if (res.exceptionDetails) {
  console.error('EVAL ERROR', JSON.stringify(res.exceptionDetails, null, 2));
  process.exitCode = 1;
} else {
  const value = res.result.value;
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}
cdp.close();
process.exit();
