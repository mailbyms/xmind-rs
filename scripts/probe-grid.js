(() => {
  const form = [...document.querySelectorAll('.uk-format-panel form')][0];
  if (!form) return JSON.stringify({ error: 'no form' });
  const box = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { tag: el.tagName.toLowerCase(), cls: String(el.getAttribute('class') || ''), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), mt: cs.marginTop, mb: cs.marginBottom, pt: cs.paddingTop, pb: cs.paddingBottom, gap: cs.rowGap, disp: cs.display, cols: cs.gridTemplateColumns, html: el.outerHTML.slice(0, 240) };
  };
  return JSON.stringify({ form: box(form), kids: [...form.children].map((c) => ({ ...box(c), kids: [...c.children].slice(0, 4).map(box) })) }, null, 1);
})()
