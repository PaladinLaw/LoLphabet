// ---- Searchable dropdown: used by the list-type / list / challenge pickers and the Stats page ----
// Callers rebuild their markup every time they render, so the open/search state lives here instead of in the DOM.
//   ddHTML(id, {label, sub, items:[{v,label,desc?,meta?,group?,on?,cls?}], pick(v), ph?, aria?})  ->  HTML string
const DDS={}; let ddOpenId=null, ddQ="";
const ddMatch=(it,q)=>!q||(it.label+" "+(it.group||"")+" "+(it.desc||"")).toLowerCase().includes(q);
function ddOpts(id){
  const c=DDS[id]; if(!c) return "";
  const q=ddQ.trim().toLowerCase(); let html="", last=null, n=0;
  for(const it of c.items){
    if(!ddMatch(it,q)) continue; n++;
    if(it.group&&it.group!==last){html+=`<div class="sgrp">${esc(it.group)}</div>`; last=it.group}
    html+=`<button type="button" role="option" class="sopt${it.on?" on":""}${it.cls?" "+it.cls:""}" data-ddv="${esc(it.v)}" aria-selected="${!!it.on}"><span class="so"><span>${esc(it.label)}</span>${it.desc?`<small class="sd">${esc(it.desc)}</small>`:""}</span>${it.meta?`<small>${esc(it.meta)}</small>`:""}</button>`;
  }
  return n?html:`<div class="empty">No matches.</div>`;
}
function ddHTML(id,c){
  DDS[id]=c; const open=ddOpenId===id;
  return `<div class="sel" id="dd-${id}"><button type="button" class="selbtn" data-dd="${id}" aria-haspopup="listbox" aria-expanded="${open}"><span class="sl"><b>${esc(c.label)}</b><small>${esc(c.sub||"")}</small></span><span class="car" aria-hidden="true">▾</span></button>`
    +`<div class="sdrop"${open?"":" hidden"}><div class="sdbox"><input type="search" class="ddq" placeholder="${esc(c.ph||"Search…")}" aria-label="${esc(c.aria||c.ph||"Search")}" autocomplete="off" value="${open?esc(ddQ):""}"><div class="sopts" role="listbox">${open?ddOpts(id):""}</div></div></div></div>`;
}
function ddSet(id,open){
  const w=document.getElementById("dd-"+id); if(!w) return;
  const d=w.querySelector(".sdrop"), b=w.querySelector(".selbtn"), i=w.querySelector(".ddq"), box=w.querySelector(".sopts");
  d.hidden=!open; b.setAttribute("aria-expanded",String(open));
  if(open){
    i.value=""; box.innerHTML=ddOpts(id);
    const on=box.querySelector(".sopt.on"); if(on) box.scrollTop=Math.max(0,on.offsetTop-box.clientHeight/2);
    if(matchMedia("(pointer:fine)").matches) i.focus();     // on phones, leave the keyboard down until they tap the search box
  }
}
function ddClose(){const id=ddOpenId; ddOpenId=null; ddQ=""; if(id) ddSet(id,false)}
function ddToggle(id){
  if(ddOpenId===id){ddClose(); return}
  const prev=ddOpenId; ddOpenId=id; ddQ=""; if(prev) ddSet(prev,false); ddSet(id,true);
}
document.addEventListener("click",e=>{
  const t=e.target.closest("[data-dd]"); if(t){ddToggle(t.dataset.dd); return}
  const o=e.target.closest("[data-ddv]");
  if(o){const w=o.closest(".sel"), c=w&&DDS[w.id.slice(3)]; ddClose(); if(c&&c.pick) c.pick(o.dataset.ddv); return}
  if(!ddOpenId) return;
  if(e.target.classList&&e.target.classList.contains("sdrop")){ddClose(); return}   // the dimmed area behind the phone sheet: close, and swallow the tap
  if(!e.target.closest(".sel")) ddClose();
});
document.addEventListener("input",e=>{
  if(!ddOpenId||!e.target.classList||!e.target.classList.contains("ddq")) return;
  ddQ=e.target.value; const w=document.getElementById("dd-"+ddOpenId); if(w) w.querySelector(".sopts").innerHTML=ddOpts(ddOpenId);
});
document.addEventListener("keydown",e=>{
  if(!ddOpenId) return; const w=document.getElementById("dd-"+ddOpenId); if(!w) return;
  if(e.key==="Escape"){ddClose(); const b=w.querySelector(".selbtn"); if(b) b.focus(); return}
  if(e.key==="Enter"&&e.target.classList&&e.target.classList.contains("ddq")){e.preventDefault(); const f=w.querySelector(".sopt"); if(f) f.click(); return}
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){
    const els=[w.querySelector(".ddq"),...w.querySelectorAll(".sopt")], i=els.indexOf(document.activeElement);
    if(i<0) return;
    e.preventDefault(); const n=els[Math.max(0,Math.min(els.length-1,i+(e.key==="ArrowDown"?1:-1)))]; if(n) n.focus();
  }
});
