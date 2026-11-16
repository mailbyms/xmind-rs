(() => {
  const at = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), t: (el.textContent||'').trim().slice(0, 20), x: r.x, y: r.y, w: r.width, h: r.height };
  };
  return JSON.stringify({ zoom: at(1115, 840), cnt: at(1040, 840), out: at(1176, 840), vw: innerWidth, vh: innerHeight }, null, 1);
})()
