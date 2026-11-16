(() => {
  const rows = [];
  for (const fo of document.querySelectorAll('foreignObject')) {
    const r = fo.getBoundingClientRect();
    if (r.width < 20 || r.height < 10) continue;
    const text = (fo.textContent || '').trim().slice(0, 18);
    if (!text) continue;
    rows.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), text });
    if (rows.length >= 6) break;
  }
  return JSON.stringify({ n: rows.length, rows }, null, 1);
})()
