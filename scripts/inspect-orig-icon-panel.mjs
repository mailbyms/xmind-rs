import { writeFile, mkdir } from 'node:fs/promises';

const port = process.env.CDP_PORT || '9222';
const outDir = process.env.OUT_DIR || 'target/verify';

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((x) => /editor\.html/.test(x.url) && !/editor-frame/.test(x.url));
if (!page) throw new Error('editor tab not found');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id;
  pending.set(i, resolve);
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => {
    if (pending.has(i)) {
      pending.delete(i);
      reject(new Error(`timeout ${method}`));
    }
  }, 15000);
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
};

await mkdir(outDir, { recursive: true });
const html = await ev(`document.querySelector('.icon-panel')?.outerHTML || null`);
if (!html) throw new Error('icon-panel not found');
await writeFile(`${outDir}/orig-icon-panel.html`, html);

const stats = await ev(`(() => {
  const panel = document.querySelector('.icon-panel');
  const texts = [...panel.querySelectorAll('*')]
    .filter((e) => e.children.length === 0 && (e.textContent || '').trim())
    .map((e) => ({ tag: e.tagName, cls: typeof e.className === 'string' ? e.className : '', text: e.textContent.trim() }));
  const titled = [...panel.querySelectorAll('[title]')]
    .map((e) => ({ tag: e.tagName, cls: typeof e.className === 'string' ? e.className : '', title: e.title, html: e.outerHTML.slice(0, 500) }));
  const imgs = [...panel.querySelectorAll('img')].map((e) => {
    const r = e.getBoundingClientRect();
    return { src: e.src.split('/').slice(-2).join('/'), w: r.width, h: r.height, title: e.title, cls: e.className };
  });
  const svgs = [...panel.querySelectorAll('svg')].map((e) => {
    const r = e.getBoundingClientRect();
    return { w: r.width, h: r.height, cls: e.getAttribute('class'), html: e.outerHTML.slice(0, 260) };
  });
  return { text: panel.innerText, texts, titled, imgs, svgs, panelRect: panel.getBoundingClientRect().toJSON() };
})()`);
await writeFile(`${outDir}/orig-icon-panel-stats.json`, JSON.stringify(stats, null, 2));
console.log('PANEL_TEXT', stats.text);
console.log('TEXTS', JSON.stringify(stats.texts, null, 2));
console.log('TITLED_COUNT', stats.titled.length);
console.log('IMGS', JSON.stringify(stats.imgs.slice(0, 12), null, 2), 'total', stats.imgs.length);
console.log('SVGS', JSON.stringify(stats.svgs.slice(0, 6), null, 2), 'total', stats.svgs.length);
console.log('SAVED', `${outDir}/orig-icon-panel.html`, `${outDir}/orig-icon-panel-stats.json`);
ws.close();
