(() => {
  return JSON.stringify([...document.querySelectorAll('.node')].map((n) => {
    const r = n.getBoundingClientRect();
    return { t: (n.textContent || '').trim().slice(0, 12), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
  }), null, 1);
})()
