(() => {
  const items = [...document.querySelectorAll('.uk-workbench-top-bar > .uk-flex-column')];
  const last = items[items.length - 1];
  last.querySelector('button')?.click();
  return { clicked: last.textContent.trim(), total: items.length };
})()
