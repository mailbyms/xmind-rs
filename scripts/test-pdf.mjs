// Unit check for the PDF writer used by 「导出分支为 > PDF」.
// `src/io/pdf.ts` is DOM-free, so it can be bundled with esbuild and exercised
// in Node: structure, xref offsets and the Flate image stream are all verified.
// Usage: node scripts/test-pdf.mjs
import { inflateSync } from 'node:zlib';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: ['src/io/pdf.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
  logLevel: 'silent',
});
const code = bundle.outputFiles[0].text;
const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const fail = [];
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) fail.push(label);
};

console.log('分支导出 PDF 编码');
ok('模块导出 buildPdfFromRgb', typeof mod.buildPdfFromRgb === 'function');

// 3×2 pixels: red, green, blue / white, black, grey.
const rgb = Uint8Array.from([
  255, 0, 0, 0, 255, 0, 0, 0, 255,
  255, 255, 255, 0, 0, 0, 128, 128, 128,
]);
const pdf = await mod.buildPdfFromRgb(rgb, 3, 2);
const text = Buffer.from(pdf).toString('latin1');
ok('以 %PDF-1.4 开头', text.startsWith('%PDF-1.4'), text.slice(0, 8));
ok('以 %%EOF 结束', text.trimEnd().endsWith('%%EOF'));
ok('包含 Catalog / Pages / Page', text.includes('/Type /Catalog')
  && text.includes('/Type /Pages') && text.includes('/Type /Page'));
ok('图像 XObject 尺寸与色彩空间正确',
  text.includes('/Subtype /Image /Width 3 /Height 2')
  && text.includes('/ColorSpace /DeviceRGB') && text.includes('/BitsPerComponent 8'));
ok('页面尺寸按 1px = 0.75pt', text.includes('/MediaBox [0 0 2.25 1.50]'),
  (text.match(/\/MediaBox \[[^\]]+\]/) ?? [''])[0]);

// xref must point at the real object headers.
const xrefAt = Number((text.match(/startxref\n(\d+)/) ?? [])[1]);
ok('startxref 指向 xref 表', text.slice(xrefAt, xrefAt + 4) === 'xref', String(xrefAt));
const entries = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
ok('xref 有 5 个在用对象', entries.length === 5, `${entries.length}`);
const headersOk = entries.every((offset, index) =>
  text.slice(offset, offset + `${index + 1} 0 obj`.length) === `${index + 1} 0 obj`);
ok('每个 xref 偏移都落在对应的 "N 0 obj" 上', headersOk);

// The image stream must inflate back to the exact RGB bytes.
const imageAt = entries[3];
const streamAt = text.indexOf('stream\n', imageAt) + 'stream\n'.length;
const length = Number((text.slice(imageAt).match(/\/Length (\d+)/) ?? [])[1]);
const raw = pdf.subarray(streamAt, streamAt + length);
let pixels = null;
try { pixels = inflateSync(Buffer.from(raw)); } catch (error) { pixels = null; console.log(error.message); }
ok('/FlateDecode 流可解压', Boolean(pixels));
ok('解压后与原 RGB 像素逐字节一致',
  Boolean(pixels) && Buffer.compare(pixels, Buffer.from(rgb)) === 0,
  pixels ? `${pixels.length} bytes` : '-');

let rejected = false;
try { await mod.buildPdfFromRgb(new Uint8Array(3), 2, 2); } catch { rejected = true; }
ok('像素长度与尺寸不符时抛错', rejected);

console.log(`\n${fail.length ? `FAILED: ${fail.length}` : 'ALL PASS'}`);
if (fail.length) process.exitCode = 1;
