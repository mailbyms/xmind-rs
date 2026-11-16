(() => {
  const d = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { tag: el.tagName.toLowerCase(), cls: String(el.getAttribute('class') || '').slice(0, 70), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], text: (el.textContent || '').trim().slice(0, 20) };
  };
  return JSON.stringify({
    atFormat: d(1307, 27),
    atCenter: d(740, 470),
    loading: [...document.querySelectorAll('[class*="loading"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return [String(el.getAttribute('class')).slice(0, 50), Math.round(r.width), Math.round(r.height)];
    }).slice(0, 6),
  }, null, 1);
})()
