(function () {
  const out = { url: location.href, viewport: [innerWidth, innerHeight], panels: [] };

  function box(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
      bg: cs.backgroundColor, color: cs.color,
      fs: cs.fontSize, fw: cs.fontWeight, lh: cs.lineHeight,
      pad: cs.padding, br: cs.borderRadius, bd: cs.border,
      disp: cs.display, pos: cs.position,
      text: (el.textContent || '').trim().slice(0, 40),
      cls: String(el.className || '').slice(0, 90),
      tag: el.tagName.toLowerCase(),
    };
  }

  // find candidate right panels: fixed/absolute near right edge, tall
  const all = Array.from(document.querySelectorAll('body *'));
  const cands = all.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 200 && r.width < 400 && r.height > 400 &&
      r.right > innerWidth - 60 && r.left > innerWidth - 500;
  });
  out.panels = cands.slice(0, 12).map((el) => box(el));

  // any element whose text is exactly 样式 / 演说 / 画布
  const labels = ['样式', '演说', '画布', '格式', '大纲', '结构', '风格'];
  out.labels = [];
  for (const el of all) {
    const t = (el.textContent || '').trim();
    if (!labels.includes(t)) continue;
    if (el.children.length > 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    // climb to nearest clickable ancestor
    let p = el, chain = [];
    for (let i = 0; i < 4 && p; i++) { chain.push(box(p)); p = p.parentElement; }
    out.labels.push({ text: t, self: box(el), chain });
  }
  return JSON.stringify(out);
})()
