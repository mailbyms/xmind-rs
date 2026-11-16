(() => {
  const row = document.querySelector('.outliner-topic-container.main-topic');
  const dot = row.querySelector('.outliner-topic-dot');
  const title = row.querySelector('.outliner-topic-title');
  const cs = getComputedStyle(dot);
  const before = getComputedStyle(dot, '::before');
  const after = getComputedStyle(dot, '::after');
  return JSON.stringify({
    dotHTML: dot.outerHTML.slice(0, 600),
    dotCSS: { w: cs.width, h: cs.height, bg: cs.backgroundColor, br: cs.borderRadius, pad: cs.padding, mar: cs.margin, disp: cs.display },
    before: { content: before.content, w: before.width, h: before.height, bg: before.backgroundColor, br: before.borderRadius, pos: before.position },
    after: { content: after.content, w: after.width, h: after.height, bg: after.backgroundColor, br: after.borderRadius },
    rowHTML: row.outerHTML.slice(0, 900),
    titleHTML: title.outerHTML.slice(0, 400),
  }, null, 1);
})()
