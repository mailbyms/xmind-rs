// Screenshot one skeleton sample as rendered by *this* app, for a side-by-side
// look against `scripts/shot-xmind.mjs`'s output.
//
//   node scripts/shot-ours.mjs matrix treetable ...
//
// Requires the app on CDP 9223. Output: target/verify/ours-<name>.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = process.env.CDP_PORT || 9223;
const SAMPLE_DIR = resolve('target/skeleton-samples');
const OUT = resolve('target/verify');
mkdirSync(OUT, { recursive: true });

const names = process.argv.slice(2);
if (!names.length) {
  console.log('usage: node scripts/shot-ours.mjs <sample...>');
  process.exit(1);
}

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error(`no page on CDP ${PORT}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve: done, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : done(m.result);
  }
});
const send = (method, params = {}) => new Promise((done, reject) => {
  const mid = ++id;
  pending.set(mid, { resolve: done, reject });
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));
const ev = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(String(res.exceptionDetails.exception?.description ?? ''));
  return res.result.value;
};
const invoke = (cmd, args = {}) =>
  ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Emulation.setDeviceMetricsOverride', {
  width: 1500, height: 950, deviceScaleFactor: 1, mobile: false,
});

for (const name of names) {
  await invoke('doc_open', { path: resolve(SAMPLE_DIR, `${name}.xmind`) });
  await wait(700);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot?.data) {
    writeFileSync(resolve(OUT, `ours-${name}.png`), Buffer.from(shot.data, 'base64'));
    console.log(`${name}: target/verify/ours-${name}.png`);
  } else {
    console.log(`${name}: screenshot failed`);
  }
}
ws.close();
