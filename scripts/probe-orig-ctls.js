(() => {
  const panel = document.querySelector('.uk-format-panel');
  const btns = [...panel.querySelectorAll('button, input, .uk-combo-box, .uk-seg, [uk-popover], [uk-contextual-popover]')];
  const rows = btns.map((e, i) => {
    const b = e.getBoundingClientRect();
    return {
      i,
      tag: e.tagName.toLowerCase(),
      cls: String(e.className).slice(0, 80),
      r: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
      t: (e.innerText || e.value || '').trim().slice(0, 20),
      id: e.id || '',
      title: (e.getAttribute('title') || '').slice(0, 30),
      type: e.type || '',
      dis: e.disabled ? 1 : 0,
    };
  }).filter((r) => r.r[2] > 0);
  return JSON.stringify(rows.filter((r) => !/uk-color-picker-button/.test(r.cls)), null, 0);
})()
