(() => {
  const info = (el, d = 0) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { d, tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 26), x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100, fs: cs.fontSize, fw: cs.fontWeight, lh: cs.lineHeight, bg: cs.backgroundColor, pad: cs.padding, mar: cs.margin, t: (el.textContent || '').trim().slice(0, 10) };
  };
  const out = [info(document.querySelector('.ol-inner')), info(document.querySelector('.ol-central')), info(document.querySelector('.ol-central-title'))];
  [...document.querySelectorAll('.ol-row')].slice(0, 3).forEach((row) => {
    out.push(info(row));
    [...row.children].forEach((c) => out.push(info(c)));
  });
  return JSON.stringify(out, null, 1);
})()
