// Screenshot one skeleton sample as rendered by the shipped XMind, so layout
// differences can be judged visually (geometry alone misses brace/tree-table
// quirks).
//
//   node scripts/shot-xmind.mjs matrix treetable brace-right ...
//
// Output: target/verify/xmind-<name>.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const PORT = 9222;
const XMIND = 'C:/Users/DM/AppData/Local/Programs/Xmind/Xmind.exe';
const SAMPLE_DIR = resolve('target/skeleton-samples');
const OUT = resolve('target/verify');
mkdirSync(OUT, { recursive: true });

const names = process.argv.slice(2);
if (!names.length) {
  console.log('usage: node scripts/shot-xmind.mjs <sample...>');
  process.exit(1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return (await res.json()).filter((t) => t.type === 'page');
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  });
  const ready = new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  return { ws, ready, send };
}

// Fit the whole map: ask the app for its own zoom-to-fit shortcut first, then
// fall back to the current view.
const FIT = `(() => {
  const btn = document.querySelector('[data-testid="zoom-fit"], [title*="适应"], [title*="Fit"]');
  if (btn) btn.click();
  return !!btn;
})()`;

for (const name of names) {
  const file = resolve(SAMPLE_DIR, `${name}.xmind`);
  const before = new Set((await targets()).map((t) => t.url));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  spawn(XMIND, ['--allow-file-access-from-files', file], {
    detached: true, stdio: 'ignore', env,
  }).unref();

  let page = null;
  for (let i = 0; i < 60 && !page; i += 1) {
    await wait(500);
    const open = await targets();
    page = open.find((t) => !before.has(t.url)
      && /editor\.html/.test(t.url) && !/editor-frame/.test(t.url));
    // Opening a file that is already open just focuses its tab, so fall back to
    // the tab that carries this sample's name.
    if (!page) {
      page = open.find((t) => /editor\.html/.test(t.url)
        && !/editor-frame/.test(t.url)
        && decodeURIComponent(t.url).includes(`${name}.xmind`));
    }
  }
  if (!page) { console.log(`${name}: no editor tab`); continue; }

  const { ws, ready, send } = connect(page.webSocketDebuggerUrl);
  await ready;
  await send('Page.reload', { ignoreCache: false });
  await wait(3500);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1500, height: 950, deviceScaleFactor: 1, mobile: false,
  });
  await wait(2500);
  await send('Runtime.evaluate', { expression: FIT, returnByValue: true });
  await wait(1200);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot?.data) {
    writeFileSync(resolve(OUT, `xmind-${name}.png`), Buffer.from(shot.data, 'base64'));
    console.log(`${name}: target/verify/xmind-${name}.png`);
  } else {
    console.log(`${name}: screenshot failed`);
  }
  ws.close();
}
console.log('done');
