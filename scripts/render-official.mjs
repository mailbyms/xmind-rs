/** 用 XMind 官方开源渲染器（xmind-viewer / SnowbrushRenderer）渲染样本，
 *  产出 SVG + JSON 报告 + 三方对照 HTML（官方 / XMind 桌面版 / 本应用）。
 *
 *  用法：node scripts/render-official.mjs [sample ...]
 *  不带参数时渲染 example.xmind 与 target/skeleton-samples/*.xmind。
 *
 *  官方渲染器目录默认 ../xmind-viewer-master，可用 XMIND_VIEWER_DIR 覆盖。
 *  它需要已经 `npm install && npm run build`（用到 dist/ 与 node_modules/jszip）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const viewerDir = path.resolve(process.env.XMIND_VIEWER_DIR || path.join(root, '..', 'xmind-viewer-master'));
const require = createRequire(import.meta.url);
const JSZip = require(path.join(viewerDir, 'node_modules', 'jszip'));
const { loadFromXMind, SnowbrushRenderer } = require(path.join(viewerDir, 'dist'));

const outDir = path.join(root, 'target', 'verify', 'official');
const verifyDir = path.join(root, 'target', 'verify');
fs.mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const samples = args.length
  ? args.map((a) => [path.basename(a, '.xmind'), path.resolve(a)])
  : [
      ['example', path.join(root, 'example.xmind')],
      ...fs.readdirSync(path.join(root, 'target', 'skeleton-samples'))
        .filter((f) => f.endsWith('.xmind'))
        .map((f) => [path.basename(f, '.xmind'), path.join(root, 'target', 'skeleton-samples', f)]),
    ];

const report = [];
for (const [name, file] of samples) {
  const row = { name, file: path.relative(root, file).replace(/\\/g, '/') };
  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const { sheets } = await loadFromXMind(zip);
    row.sheets = sheets.length;
    row.structure = sheets[0]?.rootTopic?.structureClass ?? '(default map)';
    row.hasTheme = !!sheets[0]?.theme;
    const renderer = new SnowbrushRenderer(sheets);
    const svg = renderer.render({ sheetIndex: 0 });
    const bounds = renderer.bounds;
    const markup = svg.svg();
    fs.writeFileSync(path.join(outDir, `${name}.svg`), markup);
    row.ok = true;
    row.bounds = {
      x: Math.round(bounds.x), y: Math.round(bounds.y),
      width: Math.round(bounds.width), height: Math.round(bounds.height),
    };
    row.texts = (markup.match(/<text/g) || []).length;
    row.paths = (markup.match(/<path/g) || []).length;
    row.svgWidth = Number((markup.match(/width="([\d.]+)"/) || [])[1] || 0);
    row.svgHeight = Number((markup.match(/height="([\d.]+)"/) || [])[1] || 0);
    row.plainTextShapes = (markup.match(/fill="#00000000"/g) || []).length;
  } catch (error) {
    row.ok = false;
    row.error = String(error?.message || error).slice(0, 200);
  }
  report.push(row);
  console.log(
    `${name.padEnd(16)} ${row.ok ? 'OK  ' : 'FAIL'} ` +
      (row.ok
        ? `bbox=${row.bounds.width}x${row.bounds.height} text=${row.texts} path=${row.paths} theme=${row.hasTheme} plain=${row.plainTextShapes} ${row.structure}`
        : row.error),
  );
}
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');

/* ------------------------------------------------------------ compare page --- */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const rel = (p) => path.relative(outDir, p).replace(/\\/g, '/');

const rows = report.filter((r) => r.ok).map((r) => {
  const markup = fs.readFileSync(path.join(outDir, `${r.name}.svg`), 'utf8');
  // svg.js 导出的静态 SVG 没有做屏幕缩放；用外层 scale 把整张图收进栏宽。
  const w = r.svgWidth || r.bounds.width + 10;
  const h = r.svgHeight || r.bounds.height + 10;
  const scale = Math.min(1, 470 / w, 400 / h);
  const official = `<div class="frame" style="width:${Math.ceil(w * scale)}px;height:${Math.ceil(h * scale)}px">
      <div style="transform:scale(${scale.toFixed(4)});transform-origin:top left;width:${w}px;height:${h}px">${markup}</div>
    </div>`;
  const shot = (label, file) => {
    const p = path.join(verifyDir, file);
    return fs.existsSync(p)
      ? `<div class="col"><div class="tag">${esc(label)}</div><img src="${esc(rel(p))}"></div>`
      : `<div class="col"><div class="tag">${esc(label)}</div><div class="missing">无截图</div></div>`;
  };
  return `<section><h2>${esc(r.name)} <small>${esc(r.structure)} · 官方 bbox ${r.bounds.width}×${r.bounds.height}</small></h2>
    <div class="row">
      <div class="col"><div class="tag">官方 xmind-viewer（2020 源码，本地 SVG）</div>${official}</div>
      ${shot('XMind 桌面版（原版）', `xmind-${r.name}.png`)}
      ${shot('本应用 xmind-rs', `ours-${r.name}.png`)}
    </div></section>`;
}).join('\n');

const failures = report.filter((r) => !r.ok)
  .map((r) => `<li><b>${esc(r.name)}</b> — ${esc(r.error)}</li>`).join('');

const page = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>官方 xmind-viewer 渲染评估</title><style>
body{margin:0;padding:20px;background:#fff;color:#222;font:14px/1.5 "Segoe UI","Microsoft YaHei",sans-serif}
h1{font-size:20px;margin:0 0 6px}h2{font-size:15px;margin:18px 0 8px}small{font-weight:400;color:#777;margin-left:8px}
.row{display:flex;gap:10px;align-items:flex-start}.col{flex:1;min-width:0;border:1px solid #e2e6ec;border-radius:6px;overflow:hidden;background:#fafbfc}
.tag{padding:5px 9px;background:#eef2f7;font-size:12px;color:#456}
.frame{overflow:hidden;margin:6px;background:#f7f7fa}.frame svg{display:block}
.col img{display:block;width:100%;height:auto}.missing{padding:24px;color:#aaa}
ul{background:#fff5f5;border:1px solid #f3c9c9;padding:12px 12px 12px 30px;border-radius:6px}
.summary{background:#f4f8ff;border:1px solid #d5e3fa;padding:10px 14px;border-radius:6px;margin:12px 0}
</style></head><body>
<h1>XMind 官方开源渲染器（xmind-viewer / Snowbrush）实测</h1>
<div class="summary">共 ${report.length} 个样本，成功 ${report.filter(r=>r.ok).length}，失败 ${report.filter(r=>!r.ok).length}。
三列依次为：官方 2020 渲染器输出的 SVG、XMind 桌面版原版截图、本应用截图。</div>
${failures ? `<h2>不支持 / 报错的骨架</h2><ul>${failures}</ul>` : ''}
${rows}
</body></html>`;
fs.writeFileSync(path.join(outDir, 'compare.html'), page);

console.log(`\n产物：${path.relative(root, outDir).replace(/\\/g,'/')}/  (report.json, *.svg, compare.html)`);
