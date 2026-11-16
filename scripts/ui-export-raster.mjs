// End-to-end check for 「导出分支为 > PNG / PDF」in the shipped app.
//
// Everything runs through the real code path: the topic context menu picks the
// format, `exportBranch()` rasterises the branch SVG at 2x, the browser encodes
// the PNG, and `buildPdfFromRgb` wraps the same pixels in a one-page PDF. Only
// the native `save()` dialog is pre-answered (`window.__XM_SAVE_PATH__`) because
// an OS file picker cannot be driven over CDP.
//
// The produced files are then inspected for real:
//   · PNG — signature, IHDR geometry, IDAT inflate, scanline unfilter, and the
//           pixels must actually contain ink (not a blank white canvas).
//   · PDF — trailer/xref integrity, /MediaBox matching 1px = 0.75pt, the
//           embedded image XObject geometry, and the deflated RGB stream must
//           decode byte-for-byte to the same pixels as the PNG.
//
//   node scripts/ui-export-raster.mjs
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const PORT = process.env.CDP_PORT || 9223;
const outdir = resolve('target/verify/export');
mkdirSync(outdir, { recursive: true });
const pngPath = resolve(outdir, 'branch.png');
const pdfPath = resolve(outdir, 'branch.pdf');
const reportPath = resolve(outdir, 'report.json');
for (const f of [pngPath, pdfPath, reportPath]) if (existsSync(f)) rmSync(f);

const fail = [];
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fail.push(label);
};

/* ----------------------------------------------------------------- CDP --- */
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
  if (res.exceptionDetails) {
    throw new Error(String(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? ''));
  }
  return res.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const invoke = (cmd, args = {}) =>
  ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);
const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const esc = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(150);
};

/** Centre of a visible menu row whose label matches `text`. */
const menuCentre = (text) => ev(`(() => {
  const want = ${JSON.stringify(text)};
  const rows = [...document.querySelectorAll('.xm-item')]
    .filter((el) => el.offsetParent !== null && !el.disabled);
  const label = (el) => (el.querySelector('.xm-label')?.textContent ?? '').trim();
  const hit = rows.find((el) => label(el) === want) ?? rows.find((el) => label(el).includes(want));
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`);

const [viewW, viewH] = (process.env.VIEW_SIZE || '1500x950').split('x').map(Number);
await send('Emulation.setDeviceMetricsOverride', {
  width: viewW, height: viewH, deviceScaleFactor: 1, mobile: false,
});
await wait(400);

/* ------------------------------------------------------- clean document --- */
const openMenu = async () => {
  const burger = await ev(`(() => {
    const el = document.querySelector('.menu-btn');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (!burger) throw new Error('hamburger button not found');
  await clickAt(burger.x, burger.y);
  await wait(260);
};

const resetDocument = async () => {
  await esc();
  await clickAt(120, Math.round(viewH / 2));
  await wait(220);
  await openMenu();
  for (const label of ['文件', '新建']) {
    const at = await menuCentre(label);
    if (!at) throw new Error(`menu item not found: ${label}`);
    await move(at.x, at.y);
    await wait(200);
    if (label === '新建') await clickAt(at.x, at.y);
  }
  await wait(900);
  await esc();
  await clickAt(120, Math.round(viewH / 2));
  await wait(250);
};

console.log('导出分支为 PNG / PDF 端到端验证');
await resetDocument();

const layout = await ev(`window.__TAURI_INTERNALS__.invoke('doc_layout')`);
ok('起点是干净的 5 主题文档', layout.nodes.length === 5, `${layout.nodes.length} 节点`);

const root = layout.nodes.find((n) => !n.parentId);
const branch = layout.nodes
  .filter((n) => n.parentId === root.id && !n.cell && n.side === 'right')
  .sort((a, b) => a.childIndex - b.childIndex)[0];
if (!branch) throw new Error('no right-hand branch to export');
ok('找到可导出的右侧分支', Boolean(branch), branch.title);

/* --------------------------------------------- drive the topic menu -------- */
/** Open the topic context menu on `title` and return the branch node box. */
const openTopicMenu = async (title) => {
  const at = await ev(`(() => {
    const want = ${JSON.stringify(title)};
    const node = [...document.querySelectorAll('.node')]
      .find((el) => (el.textContent ?? '').trim().startsWith(want));
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (!at) throw new Error(`topic not on canvas: ${title}`);
  await clickAt(at.x, at.y);
  await wait(150);
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: at.x, y: at.y, button: 'right', clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: at.x, y: at.y, button: 'right', clickCount: 1,
  });
  await wait(320);
  return at;
};

/** Walk 右键 → 导出分支为 → <label> and wait for the file to land. */
const exportVia = async (title, label, path) => {
  await esc();
  await ev(`window.__XM_SAVE_PATH__ = ${JSON.stringify(path)}`);
  await openTopicMenu(title);
  const parent = await menuCentre('导出分支为');
  if (!parent) throw new Error('context menu row 「导出分支为」 missing');
  await move(parent.x, parent.y);
  await wait(380);
  const item = await menuCentre(label);
  if (!item) throw new Error(`submenu row 「${label}」 missing`);
  await move(item.x, item.y);
  await wait(160);
  await clickAt(item.x, item.y);
  // Pointer clicks occasionally land while the row re-renders; fall back to a
  // synthetic click on the very same button, which still runs the menu handler.
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(path)) break;
    await wait(200);
    if (i === 2) {
      await ev(`(() => {
        const want = ${JSON.stringify(label)};
        const row = [...document.querySelectorAll('.xm-item')].find((el) => {
          const t = (el.querySelector('.xm-label')?.textContent ?? '').trim();
          return el.offsetParent !== null && t.includes(want);
        });
        if (row) row.click();
      })()`);
    }
  }
  for (let i = 0; i < 40; i += 1) {
    if (existsSync(path) && statSync(path).size > 0) break;
    await wait(250);
  }
  await esc();
  return { exists: existsSync(path), size: existsSync(path) ? statSync(path).size : 0 };
};

/* -------------------------------------------------------------- PNG pass --- */
const pngRun = await exportVia(branch.title, 'PNG', pngPath);
ok('PNG：菜单导出后文件已落地且非空', pngRun.exists && pngRun.size > 1000, `${pngRun.size} 字节`);

/** Decode an 8-bit RGB/RGBA non-interlaced PNG into { width, height, rgb }. */
function decodePng(bytes) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (Buffer.compare(bytes.subarray(0, 8), sig) !== 0) throw new Error('bad PNG signature');
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header) throw new Error('no IHDR');
  if (header.bitDepth !== 8 || header.interlace !== 0) {
    throw new Error(`unsupported PNG (depth ${header.bitDepth}, interlace ${header.interlace})`);
  }
  const channels = header.colorType === 6 ? 4 : header.colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`unsupported PNG colour type ${header.colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = header.width * channels;
  const out = Buffer.alloc(stride * header.height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad filter ${filter}`);
      cur[x] = v & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  const rgb = Buffer.alloc(header.width * header.height * 3);
  for (let i = 0, j = 0; i < out.length; i += channels) {
    rgb[j++] = out[i];
    rgb[j++] = out[i + 1];
    rgb[j++] = out[i + 2];
  }
  return { ...header, channels, rgb };
}

const pngBytes = readFileSync(pngPath);
let png = null;
try { png = decodePng(pngBytes); } catch (error) { console.log(`  png decode: ${error.message}`); }
ok('PNG：签名与 IHDR 可解析（8bit、非隔行）', Boolean(png),
  png ? `${png.width}x${png.height} colorType=${png.colorType}` : 'failed');
// The rasteriser draws the SVG at 2x unless that would exceed 8000px.
const branchSvg = await invoke('doc_branch_svg', { id: branch.id });
const svgDims = (branchSvg.match(/width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/) ?? [])
  .slice(1).map(Number);
const svgScale = Math.min(2, 8000 / Math.max(svgDims[0], svgDims[1]));
ok('PNG：尺寸等于分支 SVG 的 2 倍栅格',
  Boolean(png) && svgDims.length === 2
    && png.width === Math.round(svgDims[0] * svgScale)
    && png.height === Math.round(svgDims[1] * svgScale),
  png ? `${png.width}x${png.height} vs svg ${svgDims.join('x')} × ${svgScale.toFixed(2)}` : '-');

const inkStats = (rgb, width, height) => {
  let ink = 0;
  let minLum = 255;
  const colours = new Set();
  for (let i = 0; i < rgb.length; i += 3) {
    const r = rgb[i]; const g = rgb[i + 1]; const b = rgb[i + 2];
    const lum = (r * 299 + g * 587 + b * 114) / 1000;
    if (lum < minLum) minLum = lum;
    if (r < 245 || g < 245 || b < 245) {
      ink += 1;
      if (colours.size < 4096) colours.add((r << 16) | (g << 8) | b);
    }
  }
  return { ratio: ink / (width * height), minLum, colours: colours.size };
};
const pngInk = png ? inkStats(png.rgb, png.width, png.height) : { ratio: 0, minLum: 0, colours: 0 };
ok('PNG：确实画出了内容（墨迹 0.5%~95%）',
  pngInk.ratio > 0.005 && pngInk.ratio < 0.95, `ink=${(pngInk.ratio * 100).toFixed(2)}%`);
// The branch colour of a stock theme is a mid-tone fill, so "dark" is not the
// right test — what matters is that the raster is not a white sheet with a few
// anti-aliased specks: it needs real coverage plus a range of colours.
ok('PNG：不是空白白底（有饱和内容与多种颜色）',
  pngInk.minLum < 200 && pngInk.colours >= 20,
  `minLum=${pngInk.minLum.toFixed(0)} colours=${pngInk.colours}`);

/* -------------------------------------------------------------- PDF pass --- */
const pdfRun = await exportVia(branch.title, 'PDF', pdfPath);
ok('PDF：菜单导出后文件已落地且非空', pdfRun.exists && pdfRun.size > 1000, `${pdfRun.size} 字节`);

const pdfBytes = readFileSync(pdfPath);
const pdfText = pdfBytes.toString('latin1');
ok('PDF：以 %PDF-1.4 开头', pdfText.startsWith('%PDF-1.4'), pdfText.slice(0, 8));
ok('PDF：以 %%EOF 结尾', pdfText.trimEnd().endsWith('%%EOF'));
ok('PDF：包含 Catalog / Pages / Page', pdfText.includes('/Type /Catalog')
  && pdfText.includes('/Type /Pages') && pdfText.includes('/Type /Page'));
const xrefAt = Number((pdfText.match(/startxref\n(\d+)/) ?? [])[1]);
ok('PDF：startxref 指向 xref 表', pdfText.slice(xrefAt, xrefAt + 4) === 'xref', String(xrefAt));
const entries = [...pdfText.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
ok('PDF：xref 记录 5 个在用对象', entries.length === 5, `${entries.length}`);
ok('PDF：每个 xref 偏移都落在对应对象头',
  entries.every((off, i) => pdfText.slice(off, off + `${i + 1} 0 obj`.length) === `${i + 1} 0 obj`));

const imageAt = entries[3];
const imageHead = pdfText.slice(imageAt, imageAt + 400);
const pdfDims = (imageHead.match(/\/Width (\d+) \/Height (\d+)/) ?? []).slice(1).map(Number);
ok('PDF：内嵌图像尺寸与 PNG 一致',
  Boolean(png) && pdfDims[0] === png.width && pdfDims[1] === png.height,
  `${pdfDims.join('x')} vs ${png ? `${png.width}x${png.height}` : '-'}`);
ok('PDF：图像使用 DeviceRGB / 8bit',
  imageHead.includes('/ColorSpace /DeviceRGB') && imageHead.includes('/BitsPerComponent 8'));

const mediaBox = (pdfText.match(/\/MediaBox \[([^\]]+)\]/) ?? [])[1] ?? '';
const pt = mediaBox.trim().split(/\s+/).map(Number);
const wantW = png ? (png.width * 0.75).toFixed(2) : '';
const wantH = png ? (png.height * 0.75).toFixed(2) : '';
ok('PDF：页面尺寸按 1px = 0.75pt 折算',
  pt.length === 4 && Math.abs(pt[2] - Number(wantW)) < 0.02 && Math.abs(pt[3] - Number(wantH)) < 0.02,
  `${mediaBox} 期望 ${wantW} ${wantH}`);

const streamAt = pdfText.indexOf('stream\n', imageAt) + 'stream\n'.length;
const declared = Number((imageHead.match(/\/Length (\d+)/) ?? [])[1]);
let pdfPixels = null;
try {
  pdfPixels = inflateSync(pdfBytes.subarray(streamAt, streamAt + declared));
} catch (error) { console.log(`  pdf inflate: ${error.message}`); }
ok('PDF：/FlateDecode 流可解压', Boolean(pdfPixels),
  pdfPixels ? `${pdfPixels.length} 字节` : '-');
ok('PDF：解码长度等于 宽×高×3',
  Boolean(pdfPixels && png) && pdfPixels.length === png.width * png.height * 3,
  png && pdfPixels ? `${pdfPixels.length} vs ${png.width * png.height * 3}` : '-');
ok('PDF：像素与 PNG 逐字节一致',
  Boolean(pdfPixels && png) && Buffer.compare(Buffer.from(pdfPixels), png.rgb) === 0);

/* ------------------------------------------------ a branch with a subtree --- */
// The crop must grow with the branch instead of clipping or padding itself out.
await invoke('doc_add_child', { id: branch.id, title: '导出子主题' });
await wait(380);
const withChild = await invoke('doc_layout');
const childTopic = withChild.nodes.find((n) => n.title === '导出子主题');
ok('为分支添加了一个子主题', Boolean(childTopic), `${withChild.nodes.length} 节点`);
await invoke('doc_add_child', { id: childTopic.id, title: '导出孙主题' });
await wait(380);
const withGrandchild = await invoke('doc_layout');
const grandTopic = withGrandchild.nodes.find((n) => n.title === '导出孙主题');
ok('再添加一个孙主题（三层子树）', Boolean(grandTopic), `${withGrandchild.nodes.length} 节点`);

const png2Path = resolve(outdir, 'branch-subtree.png');
const pdf2Path = resolve(outdir, 'branch-subtree.pdf');
for (const f of [png2Path, pdf2Path]) if (existsSync(f)) rmSync(f);
const png2Run = await exportVia(branch.title, 'PNG', png2Path);
ok('子树 PNG：文件已落地', png2Run.exists && png2Run.size > 1000, `${png2Run.size} 字节`);
const png2 = existsSync(png2Path) ? decodePng(readFileSync(png2Path)) : null;
ok('子树 PNG：尺寸随内容变大（不再固定最小画布）',
  Boolean(png2 && png) && png2.width > png.width && png2.height > png.height,
  png2 ? `${png2.width}x${png2.height} vs ${png.width}x${png.height}` : '-');
const png2Ink = png2 ? inkStats(png2.rgb, png2.width, png2.height) : { ratio: 0 };
ok('子树 PNG：内容填满裁剪框（墨迹 5%~95%）',
  png2Ink.ratio > 0.05 && png2Ink.ratio < 0.95, `ink=${(png2Ink.ratio * 100).toFixed(2)}%`);

const pdf2Run = await exportVia(branch.title, 'PDF', pdf2Path);
ok('子树 PDF：文件已落地', pdf2Run.exists && pdf2Run.size > 1000, `${pdf2Run.size} 字节`);
const pdf2Text = existsSync(pdf2Path) ? readFileSync(pdf2Path).toString('latin1') : '';
const pdf2Box = (pdf2Text.match(/\/MediaBox \[([^\]]+)\]/) ?? [])[1] ?? '';
const pdf2Dims = (pdf2Text.match(/\/Width (\d+) \/Height (\d+)/) ?? []).slice(1).map(Number);
ok('子树 PDF：内嵌图像与 PNG 同尺寸且页面同步放大',
  Boolean(png2) && pdf2Dims[0] === png2.width && pdf2Dims[1] === png2.height
    && Math.abs(Number(pdf2Box.trim().split(/\s+/)[2]) - png2.width * 0.75) < 0.02,
  `${pdf2Dims.join('x')} box=${pdf2Box}`);

/* --------------------------------------------------- cancel the dialog ----- */
await invoke('doc_undo');
await invoke('doc_undo');
await wait(300);
await ev('window.__XM_SAVE_PATH__ = null');
await openTopicMenu(branch.title);
const parentAt = await menuCentre('导出分支为');
await move(parentAt.x, parentAt.y);
await wait(380);
const pngRow = await menuCentre('PNG');
const before = statSync(pngPath).mtimeMs;
const toastBefore = await ev(`JSON.stringify([...document.querySelectorAll('.xm-toast, .toast, .notice')]
  .map((el) => (el.textContent ?? '').trim()).filter(Boolean))`);
await clickAt(pngRow.x, pngRow.y);
await wait(1200);
await ev(`(() => { const row = [...document.querySelectorAll('.xm-item')].find((el) => ((el.querySelector('.xm-label')?.textContent ?? '').trim().includes('PNG'))); row?.click(); })()`);
await wait(1200);
const after = statSync(pngPath).mtimeMs;
ok('取消保存对话框时不写文件', after === before, `${before} → ${after}`);
const toastAfter = await ev(`JSON.stringify([...document.querySelectorAll('.xm-toast, .toast, .notice')]
  .map((el) => (el.textContent ?? '').trim()).filter(Boolean))`);
const errors = JSON.parse(toastAfter).filter((t) => t.includes('失败'));
ok('取消保存对话框时不弹错误提示', errors.length === 0,
  `before=${toastBefore} after=${toastAfter}`);
await esc();
await ev('delete window.__XM_SAVE_PATH__');

/* ------------------------------------------- 文件 → 导出 → PNG / PDF ------ */
// The whole sheet goes through the same pipeline; the central topic is the
// document, so the export must cover every branch.
const mapPngPath = resolve(outdir, 'map.png');
const mapPdfPath = resolve(outdir, 'map.pdf');
for (const f of [mapPngPath, mapPdfPath]) if (existsSync(f)) rmSync(f);

const exportViaMainMenu = async (label, path) => {
  await esc();
  await ev(`window.__XM_SAVE_PATH__ = ${JSON.stringify(path)}`);
  await clickAt(120, Math.round(viewH / 2));
  await wait(220);
  await openMenu();
  const row = await menuCentre('导出');
  if (!row) throw new Error('main menu row 「导出」 missing');
  await move(row.x, row.y);
  await wait(380);
  const item = await menuCentre(label);
  if (!item) throw new Error(`export submenu row 「${label}」 missing`);
  await move(item.x, item.y);
  await wait(140);
  await clickAt(item.x, item.y);
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(path)) break;
    await wait(200);
    if (i === 2) {
      await ev(`(() => {
        const want = ${JSON.stringify(label)};
        const row = [...document.querySelectorAll('.xm-item')].find((el) => {
          const t = (el.querySelector('.xm-label')?.textContent ?? '').trim();
          return el.offsetParent !== null && t === want;
        });
        if (row) row.click();
      })()`);
    }
  }
  for (let i = 0; i < 40; i += 1) {
    if (existsSync(path) && statSync(path).size > 0) break;
    await wait(250);
  }
  await esc();
  return { exists: existsSync(path), size: existsSync(path) ? statSync(path).size : 0 };
};

const menuPngRun = await exportViaMainMenu('PNG', mapPngPath);
ok('菜单 PNG：文件 → 导出 → PNG 已落地', menuPngRun.exists && menuPngRun.size > 1000,
  `${menuPngRun.size} 字节`);
const mapPng = existsSync(mapPngPath) ? decodePng(readFileSync(mapPngPath)) : null;
const mapSvg = await invoke('doc_branch_svg', { id: root.id });
const mapDims = (mapSvg.match(/width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/) ?? [])
  .slice(1).map(Number);
const mapScale = Math.min(2, 8000 / Math.max(mapDims[0], mapDims[1]));
ok('菜单 PNG：导出的是整张画布（比单分支宽）',
  Boolean(mapPng && png) && mapPng.width > png.width,
  mapPng ? `${mapPng.width}x${mapPng.height} vs branch ${png.width}` : '-');
ok('菜单 PNG：尺寸 = 整图 SVG × 2', Boolean(mapPng) && mapDims.length === 2
  && mapPng.width === Math.round(mapDims[0] * mapScale)
  && mapPng.height === Math.round(mapDims[1] * mapScale),
  mapPng ? `${mapPng.width}x${mapPng.height} vs svg ${mapDims.join('x')}` : '-');
const mapInk = mapPng ? inkStats(mapPng.rgb, mapPng.width, mapPng.height) : { ratio: 0, colours: 0 };
ok('菜单 PNG：内容非空（墨迹 0.5%~95%，多种颜色）',
  mapInk.ratio > 0.005 && mapInk.ratio < 0.95 && mapInk.colours >= 20,
  `ink=${(mapInk.ratio * 100).toFixed(2)}% colours=${mapInk.colours}`);

const menuPdfRun = await exportViaMainMenu('PDF', mapPdfPath);
ok('菜单 PDF：文件 → 导出 → PDF 已落地', menuPdfRun.exists && menuPdfRun.size > 1000,
  `${menuPdfRun.size} 字节`);
const mapPdfText = existsSync(mapPdfPath) ? readFileSync(mapPdfPath).toString('latin1') : '';
const mapPdfDims = (mapPdfText.match(/\/Width (\d+) \/Height (\d+)/) ?? []).slice(1).map(Number);
ok('菜单 PDF：内嵌图像与整图 PNG 一致',
  Boolean(mapPng) && mapPdfDims[0] === mapPng.width && mapPdfDims[1] === mapPng.height,
  `${mapPdfDims.join('x')}`);
const mapStreamAt = (() => {
  const at = mapPdfText.indexOf('/Subtype /Image');
  return mapPdfText.indexOf('stream\n', at) + 'stream\n'.length;
})();
const mapDeclared = Number((mapPdfText.match(/\/Length (\d+)/) ?? [])[1]);
let mapPixels = null;
try {
  mapPixels = inflateSync(readFileSync(mapPdfPath).subarray(mapStreamAt, mapStreamAt + mapDeclared));
} catch (error) { console.log(`  map pdf inflate: ${error.message}`); }
ok('菜单 PDF：像素与 PNG 逐字节一致',
  Boolean(mapPixels && mapPng) && Buffer.compare(Buffer.from(mapPixels), mapPng.rgb) === 0,
  mapPixels ? `${mapPixels.length} 字节` : '-');
await ev('delete window.__XM_SAVE_PATH__');

/* --------------------------------------------------------------- report --- */
const report = {
  branch: branch.title,
  png: png && {
    width: png.width, height: png.height, colorType: png.colorType,
    bytes: pngRun.size, ink: Number(pngInk.ratio.toFixed(4)), colours: pngInk.colours,
  },
  pdf: {
    bytes: pdfRun.size, mediaBox, image: pdfDims.join('x'),
    pixels: pdfPixels ? pdfPixels.length : 0,
    identicalToPng: Boolean(pdfPixels && png) && Buffer.compare(Buffer.from(pdfPixels), png.rgb) === 0,
  },
  subtree: png2 && {
    width: png2.width, height: png2.height,
    ink: Number(png2Ink.ratio.toFixed(4)),
    pdfBytes: pdf2Run.size, mediaBox: pdf2Box,
  },
  map: mapPng && {
    width: mapPng.width, height: mapPng.height,
    bytes: menuPngRun.size, ink: Number(mapInk.ratio.toFixed(4)),
    pdfBytes: menuPdfRun.size, image: mapPdfDims.join('x'),
    identicalToPng: Boolean(mapPixels && mapPng)
      && Buffer.compare(Buffer.from(mapPixels), mapPng.rgb) === 0,
  },
};
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\n${fail.length ? `FAILED: ${fail.length}` : 'ALL PASS'} — ${reportPath}`);
if (fail.length) { fail.forEach((f) => console.log(`  · ${f}`)); process.exitCode = 1; }
ws.close();
