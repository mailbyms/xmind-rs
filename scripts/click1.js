(async function(){
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const b=[...document.querySelectorAll('.fp-tabs button')];
  b[1].click();
  await sleep(400);
  const now=[...document.querySelectorAll('.fp-tabs button')].map(x=>x.textContent.trim()+(x.classList.contains('on')?':ON':''));
  const secs=[...document.querySelectorAll('.fp-section')].map(s=>s.textContent.trim().slice(0,12));
  return JSON.stringify({now,secs});
})()
