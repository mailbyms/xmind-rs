(() => {
  const sub = [...document.querySelectorAll('.uk-format-panel-sub-section')].find((el) => (el.textContent || '').includes('全局字体'));
  const btn = sub.querySelector('button');
  return getComputedStyle(btn, '::after').backgroundImage;
})()
