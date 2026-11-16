(() => JSON.stringify([...document.querySelectorAll('.ol-caret')].map((c) => {
  const r = c.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), open: c.className.includes('open') };
}), null, 1))()
