(() => {
  const dot = document.querySelector('.outliner-topic-dot');
  const cs = getComputedStyle(dot);
  const props = ['backgroundImage','backgroundColor','boxShadow','border','outline','width','height','margin','borderRadius'];
  const out = {};
  props.forEach((p) => { out[p] = cs[p]; });
  // hover state classes present?
  const row = dot.closest('.outliner-topic-container');
  out.rowHTMLStart = row.outerHTML.slice(0, 120);
  return JSON.stringify(out, null, 1);
})()
