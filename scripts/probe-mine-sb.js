(() => {
  const info = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { t: (el.textContent || '').trim().slice(0, 16), cls: String(el.className).slice(0, 24), x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100, fs: cs.fontSize, fw: cs.fontWeight, pad: cs.padding };
  };
  const bar = document.querySelector('.statusbar');
  const line = document.querySelector('.sb-line');
  return JSON.stringify({
    vw: innerWidth, vh: innerHeight,
    bar: info(bar), line: info(line),
    sheet: info(document.querySelector('.sb-sheet')),
    items: [...document.querySelectorAll('.sb-right > *')].map(info),
  }, null, 1);
})()
