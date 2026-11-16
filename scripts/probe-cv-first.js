(() => {
  const panel = document.querySelector('.uk-format-panel');
  if (!panel) return JSON.stringify({ error: 'no panel' });
  const secs = [...panel.children].map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { tag: el.tagName.toLowerCase(), cls: String(el.getAttribute('class') || '').slice(0, 60), y: Math.round(r.y), h: Math.round(r.height), mt: cs.marginTop, mb: cs.marginBottom, pt: cs.paddingTop, pb: cs.paddingBottom };
  });
  const first = panel.querySelector('.uk-format-panel-section');
  const kids = first ? [...first.children].map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { tag: el.tagName.toLowerCase(), cls: String(el.getAttribute('class') || '').slice(0, 60), y: Math.round(r.y), h: Math.round(r.height), mt: cs.marginTop, mb: cs.marginBottom, pt: cs.paddingTop, pb: cs.paddingBottom, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24) };
  }) : [];
  return JSON.stringify({ secs, kids }, null, 1);
})()
