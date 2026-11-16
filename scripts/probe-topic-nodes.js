// Dump topic-ish nodes from the original map canvas.
(() => {
  const info = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  const fo = [...document.querySelectorAll('foreignObject')];
  const gs = [...document.querySelectorAll('g')];
  const classCounts = {};
  gs.forEach((g) => { const c = String(g.getAttribute('class') || ''); if (c) classCounts[c] = (classCounts[c] || 0) + 1; });
  const svg = document.querySelector('.sheet-viewer svg');
  return {
    foreignObjectCount: fo.length,
    foSample: fo.slice(0, 10).map((e) => ({ text: (e.textContent || '').trim().slice(0, 40), r: info(e) })),
    gCount: gs.length,
    classes: Object.entries(classCounts).sort((a, b) => b[1] - a[1]).slice(0, 25),
    bigSvg: svg ? info(svg) : null,
    sheetHtml: (document.querySelector('.sheet-viewer')?.innerHTML || '').slice(0, 900),
  };
})()
