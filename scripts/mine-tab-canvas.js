(() => {
  const b = [...document.querySelectorAll('.fp-tabs button')];
  if (b[2]) b[2].click();
  return b.map((x) => x.textContent.trim()).join('/');
})()
