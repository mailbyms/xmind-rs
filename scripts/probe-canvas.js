(function(){
  const r=(el)=>{const b=el.getBoundingClientRect();return [Math.round(b.y),Math.round(b.height)];};
  const sec=document.querySelector('.fp-section');
  const kids=[...sec.children].map(el=>[el.className.slice(0,14), ...r(el)]);
  const fields=[...document.querySelectorAll('.fp-field,.fp-inline')].slice(0,6).map(el=>[el.className.slice(0,12), ...r(el)]);
  return JSON.stringify({kids,fields});
})()
