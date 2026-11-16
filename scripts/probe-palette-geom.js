(() => {
  const panel = document.querySelector('.uk-format-panel');
  const sub = [...panel.querySelectorAll('.uk-format-panel-sub-section')]
    .find((el) => (el.textContent || '').includes('配色方案'));
  if (!sub) return JSON.stringify({ error: 'no palette section' });
  const box = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { tag: el.tagName.toLowerCase(), cls: String(el.getAttribute('class') || ''), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), mt: cs.marginTop, mb: cs.marginBottom, pt: cs.paddingTop, pb: cs.paddingBottom, gap: cs.gap, disp: cs.display, cols: cs.gridTemplateColumns };
  };
  const kids = [...sub.children].map((c) => ({ ...box(c), kids: [...c.children].slice(0, 12).map(box) }));
  return JSON.stringify({ sub: box(sub), kids }, null, 1);
})()
