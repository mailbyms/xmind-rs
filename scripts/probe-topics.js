(() => {
  const topics = [...document.querySelectorAll('[class*="topic"]')].slice(0, 8).map((el) => {
    const r = el.getBoundingClientRect();
    return { cls: String(el.className).slice(0, 60), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 16) };
  });
  const sheet = document.querySelector('.sheet-viewer, .sheet, #sheet');
  return JSON.stringify({ topics, sheet: sheet ? sheet.className : null }, null, 0);
})()
