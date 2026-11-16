(function(){const uls=[...document.querySelectorAll('.fp-tabs')];return JSON.stringify({count:uls.length, each:uls.map(u=>[...u.querySelectorAll('button')].map(b=>b.textContent.trim()))});})()
