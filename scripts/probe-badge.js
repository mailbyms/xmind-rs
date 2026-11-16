(() => {
  const row = document.querySelector('.ol-row');
  return JSON.stringify({
    html: row.outerHTML.slice(0, 500),
    badges: [...document.querySelectorAll('.ol-badge')].map((b) => ({ t: b.textContent, r: (() => { const q = b.getBoundingClientRect(); return [Math.round(q.x), Math.round(q.y), Math.round(q.width), Math.round(q.height)]; })() })),
  }, null, 1);
})()
