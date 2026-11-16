(() => {
  const el = document.querySelector('.outliner-central-topic');
  if (!el) return 'none';
  const r = el.getBoundingClientRect();
  const t = el.querySelector('.outliner-topic-title');
  const cs = getComputedStyle(el);
  return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height, bg: cs.backgroundColor, titleX: t.getBoundingClientRect().x, titleBg: getComputedStyle(t).backgroundColor, cls: t.className });
})()
