(async () => {
  const bar = document.querySelector('.workbench-status-bar');
  const btns = [...bar.querySelectorAll('button')];
  const zoom = btns.find((b) => b.textContent.includes('%'));
  if (!zoom) return 'no zoom btn: ' + btns.map((b) => b.textContent.trim()).join('|');
  zoom.click();
  await new Promise((r) => setTimeout(r, 400));
  const pops = [...document.querySelectorAll('.uk-pop')].map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { cls: String(el.className).slice(0, 60), x: r.x, y: r.y, w: r.width, h: r.height, disp: cs.display, text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160) };
  }).filter((p) => p.disp !== 'none' || p.w > 0);
  return JSON.stringify({ pops, cls: zoom.className, aria: zoom.getAttribute('aria-expanded') }, null, 1);
})()
