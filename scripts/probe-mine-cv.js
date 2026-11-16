(() => {
  const panel = document.querySelector('.fp');
  if (!panel) return JSON.stringify({ error: 'no panel' });
  const box = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(), cls: String(el.getAttribute('class') || '').slice(0, 46),
      y: Math.round(r.y), h: Math.round(r.height), w: Math.round(r.width),
      mt: cs.marginTop, mb: cs.marginBottom, pt: cs.paddingTop, pb: cs.paddingBottom,
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 16),
    };
  };
  const scroll = panel.querySelector('.fp-scroll');
  const secs = [...scroll.children].map(box);
  const first = scroll.querySelector('.fp-section');
  const kids = first ? [...first.children].map((c) => ({ ...box(c), kids: [...c.children].map(box) })) : [];
  return JSON.stringify({ secs, kids }, null, 1);
})()
