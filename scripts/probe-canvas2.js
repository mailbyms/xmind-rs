(() => {
  const panel = document.querySelector('.uk-format-panel');
  if (!panel) return JSON.stringify({ error: 'no panel' });
  const secs = [...panel.querySelectorAll('.fp-section')];
  const box = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 60),
      y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width),
      mt: cs.marginTop, mb: cs.marginBottom, pt: cs.paddingTop, pb: cs.paddingBottom,
    };
  };
  const first = secs[0];
  return JSON.stringify({
    sections: secs.map(box),
    firstKids: first ? [...first.children].map(box) : [],
  }, null, 1);
})()
