(() => {
  const hits = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      if (/适应画布|实际大小|放大|缩小|缩放/.test(own)) {
        const r = el.getBoundingClientRect();
        hits.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 70), t: own.slice(0, 20), x: r.x, y: r.y, w: r.width, h: r.height, disp: getComputedStyle(el).display, vis: getComputedStyle(el).visibility });
      }
    }
  };
  walk(document);
  return JSON.stringify(hits.slice(0, 40), null, 1);
})()
