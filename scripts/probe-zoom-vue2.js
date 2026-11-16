(() => {
  const bar = document.querySelector('.workbench-status-bar');
  const btns = [...bar.querySelectorAll('button')];
  const zoom = btns.find((b) => b.textContent.includes('%'));
  const keys = Object.keys(zoom);
  let inst = zoom.__vue__;
  const out = { keys, hasVue: !!inst };
  if (inst) {
    const s = inst.zoomOptions || (inst.$setupState && inst.$setupState.zoomOptions);
    out.opts = s && JSON.parse(JSON.stringify(s));
    out.btnKeys = Object.keys(inst).slice(0, 40);
  }
  return JSON.stringify(out, null, 1);
})()
