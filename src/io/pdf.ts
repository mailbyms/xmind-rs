/**
 * Minimal one-page PDF with a single image XObject — no PDF library.
 *
 * The pixels come from a canvas (RGB, 8 bit per channel), are deflated with the
 * platform `CompressionStream` and embedded as `/FlateDecode`, so the bitmap is
 * lossless and the page keeps the canvas' pixel aspect ratio (1px = 0.75pt).
 * This module stays free of DOM/Tauri imports so it can be unit-tested in Node.
 */

export async function deflateBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const Ctor = (globalThis as unknown as {
    CompressionStream?: new (format: string) => unknown;
  }).CompressionStream;
  if (!Ctor) throw new Error('当前环境不支持 PDF 压缩，请改用 SVG 导出');
  // TS 5.9 types `Uint8Array` over `ArrayBufferLike`; a Blob only accepts an
  // `ArrayBuffer`-backed view, which is what we always hand it here.
  const stream = new Blob([bytes as unknown as BlobPart]).stream()
    .pipeThrough(new Ctor('deflate') as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function buildPdfFromRgb(
  rgb: Uint8Array, width: number, height: number,
): Promise<Uint8Array> {
  if (rgb.length !== width * height * 3) {
    throw new Error('像素数据与尺寸不匹配');
  }
  const pixels = await deflateBytes(rgb);
  const pageW = (width * 0.75).toFixed(2);
  const pageH = (height * 0.75).toFixed(2);
  const content = new TextEncoder().encode(`q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`);

  const objects: Array<{ header: string; body?: Uint8Array }> = [
    { header: '<< /Type /Catalog /Pages 2 0 R >>' },
    { header: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    {
      header: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] `
        + '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
    },
    {
      header: `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} `
        + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${pixels.length} >>`,
      body: pixels,
    },
    { header: `<< /Length ${content.length} >>`, body: content },
  ];

  const chunks: Uint8Array[] = [];
  const ascii = (text: string) => new TextEncoder().encode(text);
  let offset = 0;
  const push = (bytes: Uint8Array) => { chunks.push(bytes); offset += bytes.length; };
  push(ascii('%PDF-1.4\n'));
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(offset);
    push(ascii(`${index + 1} 0 obj\n${object.header}\n`));
    if (object.body) {
      push(ascii('stream\n'));
      push(object.body);
      push(ascii('\nendstream\n'));
    }
    push(ascii('endobj\n'));
  });
  const xrefAt = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const start of offsets) xref += `${String(start).padStart(10, '0')} 00000 n \n`;
  push(ascii(xref));
  push(ascii(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
    + `startxref\n${xrefAt}\n%%EOF\n`));

  const out = new Uint8Array(offset);
  let cursor = 0;
  for (const part of chunks) { out.set(part, cursor); cursor += part.length; }
  return out;
}
