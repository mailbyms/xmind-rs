(() => {
  const sb = document.querySelector('.workbench-status-bar');
  const hits = [];
  for (const [x, y] of [[1200, 806], [1300, 806], [1390, 806], [1390, 800], [1160, 800]]) {
    const el = document.elementFromPoint(x, y);
    hits.push({ x, y, hit: el ? `${el.tagName}.${String(el.className).split(' ')[0]}` : null, text: (el?.textContent ?? '').trim().slice(0, 20) });
  }
  const panel = document.querySelector('.uk-panel.uk-workbench-right');
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('重设样式'));
  return {
    hits,
    statusRect: sb?.getBoundingClientRect().toJSON(),
    panelRect: panel?.getBoundingClientRect().toJSON(),
    resetRect: btn?.getBoundingClientRect().toJSON(),
    panelZ: panel ? getComputedStyle(panel).zIndex : null,
  };
})()
