// ---- Roll: not a challenge and nothing is saved. Picks a random role, then a random champion from it, for when you just want something to play. ----
const ROLL_ROLES=["Top","Jungle","Mid","Bot / ADC","Support"];
let rollLast=null, rollT=null, rollOpener=null;
function rollPick(){
  const roles=ROLL_ROLES.filter(r=>LISTS[r]&&LISTS[r].length); if(!roles.length) return null;
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
  rollLast=p;
  if(matchMedia("(prefers-reduced-motion: reduce)").matches){ rollShow(p,true); return; }
  a.disabled=true; let n=0;
  rollT=setInterval(()=>{                                     // a short shuffle before it lands
    if(++n>=9){ clearInterval(rollT); rollShow(p,true); a.disabled=false; a.focus(); return; }
    const r=ROLL_ROLES[Math.floor(Math.random()*ROLL_ROLES.length)], L=LISTS[r]||[]; if(L.length) rollShow({role:r,name:L[Math.floor(Math.random()*L.length)].name},false);
  },70);
}
function openRoll(){ rollOpener=document.activeElement; $("rollm").hidden=false; rollGo(); }
function closeRoll(){ clearInterval(rollT); $("rollm").hidden=true; $("rollagain").disabled=false; if(rollOpener&&rollOpener.focus) rollOpener.focus(); }
$("rollagain").onclick=rollGo; $("rollclose").onclick=closeRoll; $("rollx").onclick=closeRoll;
$("rollm").addEventListener("click",e=>{if(e.target===$("rollm")) closeRoll()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("rollm").hidden) closeRoll()});
