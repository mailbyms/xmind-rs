(() => {
  const dump = (el, depth = 0) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className).slice(0, 80),
      rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      text: (el.textContent || '').trim().slice(0, 30),
      css: { fs: cs.fontSize, fw: cs.fontWeight, lh: cs.lineHeight, color: cs.color, mt: cs.marginTop, mb: cs.marginBottom, ff: cs.fontFamily.slice(0, 30) },
      kids: depth < 2 ? [...el.children].map((c) => dump(c, depth + 1)) : undefined,
    };
  };
  const items = [...document.querySelectorAll('.uk-workbench-top-bar > .uk-flex-column')];
  const out = { count: items.length, items: [] };
  for (const el of items.slice(0, 3)) out.items.push(dump(el));
  // status bar
  const sb = document.querySelector('.uk-workbench-status-bar') || document.querySelector('[class*="status-bar"]');
  out.statusBar = dump(sb, 0);
  out.statusHtml = sb?.outerHTML.slice(0, 1200);
  return out;
})()
