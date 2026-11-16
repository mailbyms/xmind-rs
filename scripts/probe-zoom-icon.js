(() => {
  const btns = [...document.querySelectorAll('.workbench-status-bar button')];
  const zoom = btns.find((b) => b.textContent.includes('%'));
  const svg = zoom.querySelector('svg');
  return JSON.stringify({ html: svg.outerHTML, vb: svg.getAttribute('viewBox'), stroke: getComputedStyle(svg).stroke, color: getComputedStyle(svg).color }, null, 1);
})()
