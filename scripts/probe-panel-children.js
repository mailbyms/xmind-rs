(() => {
  const panel = document.querySelector('.uk-format-panel');
  if (!panel) return JSON.stringify({ error: 'no panel' });
  const f = (v) => Math.round(v * 100) / 100;
  const info = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(), cls: String(el.getAttribute('class') || '').slice(0, 46),
      y: f(r.y), h: f(r.height), mt: cs.marginTop, mb: cs.marginBottom,
    };
  };
  return JSON.stringify([...panel.children].map(info), null, 1);
})()
