// Real-app verification for 「导出分支为…」/「打印分支…」: the export must be
// cropped to the selected branch, and the PNG/PDF encoders must actually have
// something to draw. Everything goes through the shipped app over CDP.
// Usage: node scripts/ui-branch-export.mjs
import { mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = process.env.CDP_PORT || 9223;
const outdir = resolve('target/verify');
mkdirSync(outdir, { recursive: true });
const reportPath = resolve(outdir, 'branch-export.json');
const mdPath = resolve(outdir, 'branch.md');
const rootMdPath = resolve(outdir, 'branch-root.md');
const bytesPath = resolve(outdir, 'branch-bytes.bin');
for (const file of [mdPath, rootMdPath, bytesPath]) {
  if (existsSync(file)) rmSync(file);
}

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('no page on CDP port');
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
// Pin a deterministic viewport: the desktop window may be tiny (or huge), and
// a box-selection rectangle / toolbar click must stay inside the visible canvas.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1500, height: 950, deviceScaleFactor: 0, mobile: false,
}).catch(() => {});

const ev = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    throw new Error(String(res.exceptionDetails.exception?.description ?? res.exceptionDetails));
  }
  return res.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const invoke = (cmd, args = {}) =>
  ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);
const key = async (type, k, code, vk, modifiers = 0) => {
  await send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, modifiers });
};
const undo = async () => {
  await key('keyDown', 'z', 'KeyZ', 90, 2);
  await key('keyUp', 'z', 'KeyZ', 90, 2);
  await wait(200);
};

const fail = [];
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fail.push(label);
};
const report = {};
const layout = () => invoke('doc_layout');

console.log('分支裁剪导出 真机验证');

for (let i = 0; i < 24; i += 1) {
  const state = await layout();
  if (state.nodes.length === 5 && !state.nodes.some((n) => n.title === '分支子主题')) break;
  await undo();
}
const base = await layout();
const root = base.nodes.find((n) => !n.parentId);
const siblings = base.nodes
  .filter((n) => n.parentId === root.id && !n.cell && n.side === 'right')
  .sort((a, b) => a.childIndex - b.childIndex);
ok('起点是干净的 5 主题文档', base.nodes.length === 5 && siblings.length >= 2,
  `${base.nodes.length} 节点 / ${siblings.length} 个右侧分支`);

const branchNode = siblings[0];
const others = siblings.slice(1);
// Give the branch a child, so the crop has to keep a real subtree.
await invoke('doc_add_child', { id: branchNode.id, title: '分支子主题' });
await wait(360);
const grown = await layout();
ok('为分支添加了一个子主题', grown.nodes.length === 6,
  `${grown.nodes.length} 节点`);
const childTitle = '分支子主题';

const svg = await invoke('doc_branch_svg', { id: branchNode.id });
report.svgLength = svg.length;
ok('分支 SVG 已生成', typeof svg === 'string' && svg.startsWith('<?xml')
  && svg.includes('<svg '), `${svg.length} 字节`);
ok('分支 SVG 含本分支主题与子主题',
  svg.includes(branchNode.title) && svg.includes(childTitle));
ok('分支 SVG 不含中心主题与其它兄弟',
  !svg.includes(`>${root.title}<`) && others.every((n) => !svg.includes(`>${n.title}<`)),
  others.map((n) => n.title).join(' / '));
const dims = svg.match(/width="(\d+)" height="(\d+)"/);
ok('分支 SVG 带实际画布尺寸', Boolean(dims) && Number(dims[1]) > 100 && Number(dims[2]) > 40,
  dims ? `${dims[1]}x${dims[2]}` : 'missing');

// Markdown keeps the subtree, drops everything else.
await invoke('doc_export_branch', { path: mdPath, format: 'md', id: branchNode.id });
const md = readFileSync(mdPath, 'utf8');
report.markdown = md.trim().split('\n');
ok('Markdown 以分支主题为唯一标题', md.trim().split('\n')[0] === `# ${branchNode.title}`,
  md.trim().split('\n')[0]);
ok('Markdown 保留子主题', md.includes(`- ${childTitle}`));
ok('Markdown 不含其它分支', others.every((n) => !md.includes(n.title)),
  others.map((n) => n.title).join(' / '));

// The root is its own branch: exporting it keeps the whole map.
await invoke('doc_export_branch', { path: rootMdPath, format: 'md', id: root.id });
const rootMd = readFileSync(rootMdPath, 'utf8');
ok('导出中心主题时保留全部分支',
  others.every((n) => rootMd.includes(n.title)) && rootMd.includes(`- ${childTitle}`),
  `${rootMd.trim().split('\n').length - 1} 行`);

// PNG / PDF bytes are produced in the WebView; this is the bridge they use.
const payload = 'xmind-rs branch export\n';
await invoke('doc_write_bytes', {
  path: bytesPath,
  base64Data: Buffer.from(payload, 'utf8').toString('base64'),
});
ok('doc_write_bytes 原样落盘二进制', readFileSync(bytesPath, 'utf8') === payload);

let badId = 'accepted';
try { await invoke('doc_export_branch', { path: mdPath, format: 'md', id: 'no-such-topic' }); }
catch (error) { badId = `rejected:${String(error)}`; }
ok('未知主题 id 被拒绝', badId.startsWith('rejected'), badId);

// The rasteriser the PNG/PDF path uses: draw the branch SVG onto a canvas.
const raster = await ev(`(async () => {
  const svg = await window.__TAURI_INTERNALS__.invoke('doc_branch_svg', { id: ${JSON.stringify(branchNode.id)} });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = () => res(null); img.onerror = () => rej(new Error('decode')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) ink += 1;
    }
    return JSON.stringify({
      width: canvas.width, height: canvas.height,
      ink: ink / (canvas.width * canvas.height),
      pdfReady: typeof CompressionStream === 'function',
    });
  } finally { URL.revokeObjectURL(url); }
})()`).then((s) => JSON.parse(s));
report.raster = raster;
ok('分支 SVG 能在 WebView 里栅格化（尺寸与声明一致）',
  raster.width === Number(dims?.[1]) && raster.height === Number(dims?.[2]),
  `${raster.width}x${raster.height}`);
ok('栅格结果确实画出了内容（墨迹占比 1%~95%）',
  raster.ink > 0.01 && raster.ink < 0.95, `ink=${(raster.ink * 100).toFixed(2)}%`);
ok('WebView 提供 CompressionStream（PDF 路径可用）', raster.pdfReady === true);

// Clean up the extra child so the script can run again.
await undo();
await wait(240);

import('node:fs').then(({ writeFileSync }) => {
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n${fail.length ? `FAILED: ${fail.length}` : 'ALL PASS'} — ${reportPath}`);
  if (fail.length) { console.log(fail.join('\n')); process.exitCode = 1; }
  ws.close();
});
