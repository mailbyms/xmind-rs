(() => {
  const sub = [...document.querySelectorAll('.uk-format-panel-sub-section')]
    .find((el) => (el.textContent || '').includes('全局字体'));
  if (!sub) return JSON.stringify({ error: 'none' });
  const box = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { tag: el.tagName.toLowerCase(), cls: String(el.getAttribute('class') || '').slice(0, 50), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), mt: cs.marginTop, mb: cs.marginBottom, lh: cs.lineHeight, fs: cs.fontSize };
  };
  const all = [];
  const walk = (el, d) => {
    if (d > 3) return;
    for (const c of el.children) { all.push({ d, ...box(c) }); walk(c, d + 1); }
  };
  walk(sub, 0);
  return JSON.stringify(all, null, 1);
})()
