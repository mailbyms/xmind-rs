(() => {
  const rows = [...document.querySelectorAll('.outliner-topic-container.main-topic')].map((row) => {
    const t = row.querySelector('.outliner-topic-title');
    const inner = row.querySelector('.outliner-topic');
    const r = row.getBoundingClientRect();
    return {
      text: (t.textContent || '').trim(), x: Math.round(r.x), w: Math.round(r.width),
      innerPadLeft: getComputedStyle(inner).paddingLeft,
      titleX: Math.round(t.getBoundingClientRect().x),
      titleFs: getComputedStyle(t).fontSize, titleFw: getComputedStyle(t).fontWeight,
      dotX: Math.round(row.querySelector('.outliner-topic-dot').getBoundingClientRect().x),
    };
  });
  return JSON.stringify(rows, null, 1);
})()
