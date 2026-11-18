// Regenerate sticker / illustration data + SVG assets from the shipped XMind.
//
//   node scripts/build-icon-assets.mjs
//
// Group membership comes from the live panel DOM (CDP 9222, panel must be open
// on the sticker or illustration tab); the SVGs come from app.asar. Generated
// files are machine-owned — do not hand-edit:
//   src/lib/icon-data.ts
//   public/stickers/**/*.svg
//   public/illustrations/**/*.svg
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.ORIG_PORT || 9222);
const ASAR = process.env.XMIND_ASAR || 'C:/Users/DM/AppData/Local/Programs/Xmind/resources/app.asar';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- asar asset extraction ------------------------------------------------
const asar = readFileSync(ASAR);
const pickleSize = asar.readUInt32LE(4);
const jsonSize = asar.readUInt32LE(12);
const header = JSON.parse(asar.subarray(16, 16 + jsonSize).toString('utf8'));
const dataBase = 8 + pickleSize;
function* walk(node, prefix = '') {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (entry.files) yield* walk(entry, p);
    else yield [p, entry];
  }
}
const files = new Map([...walk(header)]);
function extract(asarPath, outDir, sub) {
  const entry = files.get(asarPath);
  if (!entry) throw new Error(`asset missing in asar: ${asarPath}`);
  const bytes = asar.subarray(dataBase + Number(entry.offset), dataBase + Number(entry.offset) + Number(entry.size));
  const name = asarPath.split('/').pop();
  const outPath = join(ROOT, 'public', outDir, name);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, bytes);
  return `/${outDir}/${name}`;
}
const stickerPaths = [...files.keys()].filter((p) => p.startsWith('static/snowbird/resource/stickers/') && p.endsWith('.svg'));
const illustrationPaths = [...files.keys()].filter((p) => p.startsWith('static/snowbird/resource/illustrations/') && p.endsWith('.svg'));

// --- live panel DOM via CDP ----------------------------------------------
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && /editor\.html\?/.test(t.url) && /example\.xmind/.test(decodeURIComponent(t.url)));
if (!page) throw new Error('no example editor page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pm = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pm.has(m.id)) { pm.get(m.id)(m.result); pm.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((ok) => { const mid = ++id; pm.set(mid, ok); ws.send(JSON.stringify({ id: mid, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true }); return r.result?.value; };
const clickAt = async (x, y) => {
  for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type: t, x, y, button: t === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
};

const READ = `(() => {
  const panel = document.querySelector('.uk-icon-module');
  if (!panel) return null;
  const active = [...panel.querySelectorAll('.uk-tab li')].findIndex((li) => li.classList.contains('uk-active'));
  const groups = [...panel.querySelectorAll('.images .group')].map((g) => {
    const titleEl = [...g.children].find((c) => !(c.className || '').toString().includes('uk-flex') && (c.innerText || '').trim());
    const title = (titleEl?.innerText || '').trim();
    const items = [...g.querySelectorAll('.icon-image-item img')].map((img) => {
      const src = img.getAttribute('src') || '';
      const m = src.match(/resource\\/(stickers|illustrations)\\/([^/?#]+\\.svg)/);
      return m ? m[2] : null;
    }).filter(Boolean);
    return { title, items };
  }).filter((g) => g.items.length);
  return { active, groups };
})()`;

async function selectTab(index) {
  const pt = await ev(`(() => {const lis=[...document.querySelectorAll('.uk-icon-module .uk-tab li')];const e=lis[${index}];if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  if (!pt) throw new Error(`tab ${index} missing`);
  await clickAt(pt.x, pt.y);
  await sleep(700);
}

await selectTab(1);
const stickers = await ev(READ);
await selectTab(2);
const illustrations = await ev(READ);
ws.close();
if (!stickers?.groups?.length || !illustrations?.groups?.length) throw new Error('panel data missing — open the 插入 > 贴纸 panel first');

// --- write generated TS ---------------------------------------------------
for (const p of stickerPaths) extract(p, 'stickers');
for (const p of illustrationPaths) extract(p, 'illustrations');

const mk = (groups, dir) => groups.map((g) => ({
  id: g.title,
  title: g.title,
  items: g.items.map((name) => ({ id: name.replace(/\.svg$/, ''), icon: `/${dir}/${name}` })),
}));
const out = {
  stickers: mk(stickers.groups, 'stickers'),
  illustrations: mk(illustrations.groups, 'illustrations'),
};
const generated = `// GENERATED by scripts/build-icon-assets.mjs — do not edit by hand.\n`
  + `export interface IconItem { id: string; icon: string }\n`
  + `export interface IconGroup { id: string; title: string; items: IconItem[] }\n\n`
  + `export const STICKER_GROUPS: IconGroup[] = ${JSON.stringify(out.stickers, null, 2)};\n\n`
  + `export const ILLUSTRATION_GROUPS: IconGroup[] = ${JSON.stringify(out.illustrations, null, 2)};\n`;
writeFileSync(resolve(ROOT, 'src/lib/icon-data.ts'), generated);
console.log(`stickers ${out.stickers.length} groups / ${out.stickers.reduce((n, g) => n + g.items.length, 0)} items`);
console.log(`illustrations ${out.illustrations.length} groups / ${out.illustrations.reduce((n, g) => n + g.items.length, 0)} items`);
console.log(`asar assets ${stickerPaths.length} + ${illustrationPaths.length} SVGs`);
