(function(){
  return JSON.stringify([...document.querySelectorAll('.fp-tabs > li')].map(li=>{
    const cs=getComputedStyle(li,'::before');
    return {t:li.textContent.trim(), cls:li.className,
      bar: cs.display==='none'?'none':`${cs.borderLeftWidth} ${cs.borderLeftColor} top=${cs.top} h=${cs.height}`};
  }));
})()
