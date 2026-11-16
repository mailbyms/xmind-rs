(() => {
  const ul = document.querySelector('.uk-format-panel .uk-tab-capsule') || document.querySelector('.uk-workbench-right .uk-tab-capsule');
  if (!ul) return 'no tabs';
  const items = [...ul.children];
  const target = items[2];
  (target.querySelector('a') || target).click();
  return 'clicked ' + items.map((li) => li.textContent.trim()).join('/');
})()
