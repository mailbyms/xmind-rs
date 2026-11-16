(async function(){
  const s=(ms)=>new Promise(r=>setTimeout(r,ms));
  document.querySelectorAll('.fp-tabs button')[0].click();
  await s(300);
  const before=[...document.querySelectorAll('.fp-head')].map(h=>({t:h.textContent.trim(),h:Math.round(h.getBoundingClientRect().height),open:h.classList.contains('open')}));
  document.querySelector('.fp-chev').click();
  await s(250);
  const after=[...document.querySelectorAll('.fp-head')].map(h=>({t:h.textContent.trim(),open:h.classList.contains('open')}));
  const rows=[...document.querySelectorAll('.fp-row')].length;
  return JSON.stringify({before,after,rows});
})()
