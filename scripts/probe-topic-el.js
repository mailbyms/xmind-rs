(() => {
  const hits = [];
  for (const el of document.querySelectorAll('*')) {
    const t = (el.textContent || '').trim();
    if (t === '中心主题' || t === '分支主题 1') hits.push(el);
  }
  const info = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(), cls: String(el.getAttribute('class') || ''),
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      fs: cs.fontSize, ff: cs.fontFamily.slice(0, 40), color: cs.color, bg: cs.backgroundColor,
      parent: el.parentElement ? el.parentElement.tagName + '.' + String(el.parentElement.getAttribute('class') || '') : null,
      gp: el.parentElement?.parentElement ? el.parentElement.parentElement.tagName + '.' + String(el.parentElement.parentElement.getAttribute('class') || '') : null,
    };
  };
  return JSON.stringify({ n: hits.length, items: hits.slice(0, 4).map(info) }, null, 1);
})()
