(() => {
  const menu = document.querySelector('.zoom-menu');
  if (!menu) return 'no menu';
  const r = menu.getBoundingClientRect();
  return JSON.stringify({
    menu: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    items: [...menu.querySelectorAll('.zoom-item')].map((b) => {
      const q = b.getBoundingClientRect();
      return { t: b.textContent.trim(), x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.width), h: Math.round(q.height) };
    }),
  }, null, 1);
})()
