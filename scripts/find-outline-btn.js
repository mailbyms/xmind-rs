(() => {
  const btns = [...document.querySelectorAll('.workbench-status-bar button')];
  const b = btns.find((x) => x.textContent.trim() === '大纲' || x.textContent.trim() === '思维导图');
  if (!b) return 'none: ' + btns.map((x) => x.textContent.trim()).join('|');
  const r = b.getBoundingClientRect();
  return JSON.stringify({ t: b.textContent.trim(), cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height });
})()
