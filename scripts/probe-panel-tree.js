(() => {
  const p = document.querySelector('.uk-format-panel') || document.querySelector('.uk-workbench-right');
  if (!p) return JSON.stringify({ error: 'none' });
  const out = [];
  const walk = (el, d) => {
    if (d > 3 || out.length > 60) return;
    const r = el.getBoundingClientRect();
    out.push({ d, tag: el.tagName.toLowerCase(), cls: String(el.getAttribute('class') || '').slice(0, 70), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 18) });
    for (const c of el.children) walk(c, d + 1);
  };
  walk(p, 0);
  return JSON.stringify({ top: String(p.getAttribute('class')).slice(0, 60), out }, null, 1);
})()
