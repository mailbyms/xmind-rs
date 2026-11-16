(() => {
  const out = [];
  const walk = (el, depth) => {
    if (depth > 4 || out.length > 120) return;
    for (const c of el.children) {
      const r = c.getBoundingClientRect();
      out.push({
        d: depth, tag: c.tagName.toLowerCase(),
        id: c.id || '', cls: String(c.className || '').slice(0, 80),
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      });
      walk(c, depth + 1);
    }
  };
  walk(document.body, 0);
  return JSON.stringify({ vp: [innerWidth, innerHeight], n: out.length, nodes: out });
})()
