(() => {
  const ul = document.querySelector('.uk-format-panel .uk-tab-capsule') || document.querySelector('.uk-workbench-right .uk-tab-capsule');
  if (!ul) return 'no tabs';
  const items = [...ul.children];
  (items[0].querySelector('a') || items[0]).click();
  return 'ok ' + items.map((li) => li.textContent.trim()).join('/');
})()
