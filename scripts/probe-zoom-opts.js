(() => {
  const bar = document.querySelector('.workbench-status-bar');
  const btns = [...bar.querySelectorAll('button')];
  const zoom = btns.find((b) => b.textContent.includes('%'));
  const inst = zoom.__vue__;
  const sp = inst._setupProxy || {};
  const keys = Object.keys(sp);
  const out = { keys };
  for (const k of ['zoomOptions', 'zoomScaleLists', 'zoomControlLabel', 'zoomValue']) {
    let v = sp[k];
    if (v && typeof v === 'object' && 'value' in v && (v.__v_isRef || Array.isArray(v.value) || typeof v.value !== 'object')) v = v.value;
    try { out[k] = JSON.parse(JSON.stringify(v)); } catch (e) { out[k] = String(v); }
  }
  return JSON.stringify(out, null, 1);
})()
