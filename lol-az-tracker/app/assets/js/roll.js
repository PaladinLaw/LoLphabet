// ---- Roll: not a challenge and nothing is saved. Picks a random role, then a random champion from it, for when you just want something to play. ----
const ROLL_ROLES=["Top","Jungle","Mid","Bot / ADC","Support"];
let rollLast=null, rollT=null, ROLLED=null, rollSel="all", rollFresh=false;   // rollSel = "all" or one role; rollFresh = a roll happened since the popup opened   // ROLLED = the champion shown on the Roll page
const rollPool=()=>ROLL_ROLES.filter(r=>(rollSel==="all"||r===rollSel)&&LISTS[r]&&LISTS[r].length);
function rollPick(){
  const roles=rollPool(); if(!roles.length) return null;
  for(let i=0;i<6;i++){                                        // avoid showing the exact same result twice in a row
    const r=roles[Math.floor(Math.random()*roles.length)], L=LISTS[r], n=L[Math.floor(Math.random()*L.length)].name;
    if(!rollLast||rollLast.name!==n||rollLast.role!==r||i===5) return {role:r,name:n};
  }
}
function rollShow(p,final){
  const ic=iconUrl(p.name), res=$("rollres");
  res.innerHTML=`<div class="rolli${final?" fin":""}"><span>${esc(p.name[0])}</span>${ic?`<img src="${ic}" alt="" onerror="this.remove()">`:""}</div>
    <div class="rollt"><b>${esc(p.name)}</b><span class="rollr">${esc(p.role==="Bot / ADC"?"Bot / ADC":p.role)}</span></div>`;
}
function rollGo(){
  clearInterval(rollT); const p=rollPick(), a=$("rollagain");
  if(!p){ $("rollres").textContent="No champion data is loaded yet. Try again in a moment."; return; }
  rollLast=p; rollFresh=true; $("rollact").hidden=false;
  if(matchMedia("(prefers-reduced-motion: reduce)").matches){ rollShow(p,true); return; }
  a.disabled=true; let n=0;
  rollT=setInterval(()=>{                                     // a short shuffle before it lands
    if(++n>=9){ clearInterval(rollT); rollShow(p,true); a.disabled=false; a.focus(); return; }
    const pool=rollPool(), r=pool[Math.floor(Math.random()*pool.length)], L=(r&&LISTS[r])||[]; if(L.length) rollShow({role:r,name:L[Math.floor(Math.random()*L.length)].name},false);
  },70);
}
function rollSelDraw(){ document.querySelectorAll("#rollsel [data-rs]").forEach(b=>{const on=b.dataset.rs===rollSel; b.classList.toggle("on",on); b.setAttribute("aria-pressed",on)}); }
// Opening the popup only asks what to roll (all roles, or one); nothing rolls until a button is pressed.
function openRoll(){
  clearInterval(rollT); rollFresh=false; rollSelDraw();
  $("rollres").innerHTML='<span class="rollhint">Pick a role to roll, or choose All roles for a true dice roll.</span>';
  $("rollact").hidden=true; $("rollagain").disabled=false; $("rollm").hidden=false;
  const b=document.querySelector('#rollsel [data-rs].on'); b&&b.focus();
}
// Closing the popup (View build, ×, Esc or a click outside) takes you to the Roll page: the rolled champion and position in the Next up banner, with its build.
function closeRoll(){
  clearInterval(rollT); $("rollm").hidden=true; $("rollagain").disabled=false;
  if(rollFresh&&rollLast){ ROLLED=rollLast; view="roll"; render(); window.scrollTo&&window.scrollTo(0,0); }
}
$("rollagain").onclick=rollGo; $("rollclose").onclick=closeRoll; $("rollx").onclick=closeRoll;
$("rollm").addEventListener("click",e=>{if(e.target===$("rollm")) closeRoll()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("rollm").hidden) closeRoll()});
$("rollsel").addEventListener("click",e=>{const b=e.target.closest("[data-rs]"); if(!b) return; rollSel=b.dataset.rs; rollSelDraw(); rollGo();});   // choosing a role rolls it
