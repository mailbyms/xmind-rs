(() => {
  const bar = document.querySelector('.workbench-status-bar');
  const btns = [...bar.querySelectorAll('button')];
  const zoom = btns.find((b) => b.textContent.includes('%'));
  let inst = zoom.__vueParentComponent;
  const chain = [];
  let depth = 0;
  while (inst && depth < 8) {
    const s = inst.setupState || {};
    const keys = Object.keys(s);
    chain.push({ name: (inst.type && (inst.type.__name || inst.type.name)) || '?', keys });
    inst = inst.parent;
    depth++;
  }
  return JSON.stringify(chain, null, 1);
})()
