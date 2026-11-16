(() => {
  const sub = [...document.querySelectorAll('.uk-format-panel-sub-section')].find((el) => (el.textContent || '').includes('全局字体'));
  const btn = sub.querySelector('button');
  const after = getComputedStyle(btn, '::after');
  return JSON.stringify({
    html: btn.outerHTML.replace(/\s+/g, ' ').slice(0, 900),
    after: { content: after.content, bg: after.backgroundImage.slice(0, 200), w: after.width, h: after.height, pos: after.position, right: after.right, top: after.top },
  }, null, 1);
})()
