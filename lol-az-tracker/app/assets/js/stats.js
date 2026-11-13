function entriesFor(r){return LISTS[r].map(c=>{
  const s=(all[pkey(r)]||{})[c.name]||{won:false,games:0,date:null};
  // Nuzlocke: "won" means fallen, so progress bars, filters and the done/in-progress states work unchanged; wins are counted separately.
  return {name:c.name,s:isNuz()?{won:!!s.dead,dead:!!s.dead,wins:s.wins||0,games:(s.wins||0)+(s.dead?1:0),date:s.diedOn||null}:s};
})}
function nzTiles(es){
  const wins=es.reduce((a,e)=>a+e.s.wins,0), games=es.reduce((a,e)=>a+e.s.games,0), dead=es.filter(e=>e.s.dead), alive=es.filter(e=>!e.s.dead);
  const best=[...es].sort((a,b)=>b.s.wins-a.s.wins)[0], bestAlive=[...alive].sort((a,b)=>b.s.wins-a.s.wins)[0];
  const wk=Date.now()-7*864e5, week=dead.filter(e=>e.s.date&&new Date(e.s.date).getTime()>=wk).length;
  const T=[["Total wins",wins],["Games played",games],["Win rate",games?Math.round(wins/games*100)+"%":"–"],
    ["Champions fallen",dead.length+" / "+es.length],["Still alive",alive.length],
    ["Avg wins before dying",dead.length?(dead.reduce((a,e)=>a+e.s.wins,0)/dead.length).toFixed(2):"–"],
    ["Most wins",best&&best.s.wins?best.name+" ("+best.s.wins+")":"–"],["Most wins (alive)",bestAlive&&bestAlive.s.wins?bestAlive.name+" ("+bestAlive.s.wins+")":"–"],
    ["Died without a win",dead.filter(e=>!e.s.wins).length],["Fell this week",week]];
  return T.map(([l,v])=>`<div class="t"><small>${l}</small><b>${esc(String(v))}</b></div>`).join("");
}
function tiles(es){
  const won=es.filter(e=>e.s.won), games=es.reduce((a,e)=>a+e.s.games,0), left=es.length-won.length;
  const avg=won.length?won.reduce((a,e)=>a+e.s.games,0)/won.length:0;
  const first=won.filter(e=>e.s.games===1).length;
  const sorted=[...won].sort((a,b)=>a.s.games-b.s.games), hard=sorted[sorted.length-1];
  const stuck=es.filter(e=>!e.s.won&&e.s.games>0).sort((a,b)=>b.s.games-a.s.games)[0];
  const wk=Date.now()-7*864e5;
  const week=won.filter(e=>e.s.date&&new Date(e.s.date).getTime()>=wk).length;
  const dates=won.map(e=>e.s.date).filter(Boolean).sort();
  let pace="–",eta="–";
  if(!left&&es.length) eta="Done";
  else if(dates.length){
    const days=Math.max(7,(Date.now()-new Date(dates[0]).getTime())/864e5), pw=won.length/days*7;
    pace=pw.toFixed(1)+" / wk"; eta=new Date(Date.now()+left/pw*7*864e5).toISOString().slice(0,10);
  }
  const T=[["Win rate",games?Math.round(won.length/games*100)+"%":"–"],["Games played",games],["Losses",games-won.length],
    ["Avg attempts / win",won.length?avg.toFixed(2):"–"],["First-try wins",won.length?first+" ("+Math.round(first/won.length*100)+"%)":"–"],
    ["Fewest attempts",sorted[0]?sorted[0].name+" ("+sorted[0].s.games+")":"–"],["Most attempts",hard?hard.name+" ("+hard.s.games+")":"–"],
    ["Stuck on",stuck?stuck.name+" ("+stuck.s.games+" losses)":"–"],["Won this week",week],["Pace",pace],
    ["Est. games left",won.length?Math.round(avg*left):"–"],["Est. finish",eta]];
  return T.map(([l,v])=>`<div class="t"><small>${l}</small><b>${esc(String(v))}</b></div>`).join("");
}
// ---- Stats page: a summary, a filtered "By list" table, and a single searchable "Per list" picker ----
const SF_KEY="lol-az-stats-filter";
let sf={prog:true,done:true,zero:false};                       // which list states "By list" shows; lists nobody has touched are hidden by default
try{const o=JSON.parse(localStorage.getItem(SF_KEY)); if(o&&typeof o==="object")for(const k in sf)if(typeof o[k]==="boolean")sf[k]=o[k]}catch(e){}
let sPick=null;                                                // Per list: chosen list key (null = the list you're on)
const catLab=r=>(CATS.find(c=>c[0]===catOf(r))||[0,""])[1];
function listInfo(r){
  const es=entriesFor(r), won=es.filter(e=>e.s.won).length, games=es.reduce((a,e)=>a+e.s.games,0);
  return {r,es,won,total:es.length,games,state:(!es.length||(!won&&!games))?"zero":won===es.length?"done":"prog"};
}
const sfSave=()=>{try{localStorage.setItem(SF_KEY,JSON.stringify(sf))}catch(e){}};
const mbar=(w,t)=>`<i class="mb"><i style="width:${t?Math.round(w/t*100):0}%"></i></i>`;
function pickedList(){return LISTS[sPick]?sPick:(LISTS[role]?role:Object.keys(LISTS)[0])}
// Same order as the main page's pickers: list types in CATS order, lists in each type's own order.
const sKeysIn=c=>(keysIn(c)||[]).filter(k=>LISTS[k]), sLast={};
const sOrdered=()=>CATS.flatMap(c=>sKeysIn(c[0]));
function sPickCat(c){const ks=sKeysIn(c); if(!ks.length) return; sPick=ks.includes(sLast[c])?sLast[c]:ks[0]; renderStats()}
let sMode=null;                       // which mode's stats the Stats page shows (null = the mode you're playing); picking one here never changes your challenge mode
function renderStats(){
  const real=mode; if(view==="stats"&&sMode&&MODES.some(m=>m[0]===sMode)) mode=sMode;
  try{renderStatsBody()}finally{mode=real}
}
function renderStatsBody(){
  $("stats").hidden=view!=="stats"; $("roleView").hidden=view!=="role"&&view!=="roll"; $("roleView").classList.toggle("rollmode",view==="roll"); $("settings").hidden=view!=="settings"; $("builder").hidden=view!=="build";
  if(view!=="stats") return;
  const nzs=isNuz(), tl=nzs?nzTiles:tiles, keys=sOrdered(), infos=keys.map(listInfo), shown=infos.filter(i=>sf[i.state]);
  const cnt=st=>infos.filter(i=>i.state===st).length;
  const chip=(k,lab)=>`<button type="button" class="chip${sf[k]?" on":""}" data-sf="${k}" aria-pressed="${sf[k]}">${lab} <small>${cnt(k)}</small></button>`;
  const byList=shown.length?`<div class="tw"><table><tr><th>List</th>${nzs?"<th>Fallen</th><th>Wins</th><th>Games</th>":"<th>Won</th><th>Games</th><th>Avg</th>"}</tr>${shown.map(i=>{
      const w=i.es.filter(e=>e.s.won);
      return `<tr><td>${esc(label(i.r))}<small class="ct">${esc(catLab(i.r))}</small></td><td class="nw">${i.won}/${i.total}${mbar(i.won,i.total)}</td>${nzs?`<td>${i.es.reduce((a,e)=>a+e.s.wins,0)}</td><td>${i.games}</td>`:`<td>${i.games}</td><td>${w.length?(w.reduce((a,e)=>a+e.s.games,0)/w.length).toFixed(2):"–"}</td>`}</tr>`}).join("")}</table></div>`
    :`<div class="empty">${infos.some(i=>i.state!=="zero")?"No lists match these filters.":"Nothing tracked yet. Win a game and it shows up here."}</div>`;
  const runs=(title,head,cell)=>shown.length?`<h3>${title}</h3><div class="tw"><table><tr><th>List</th>${head.map(h=>`<th>${h}</th>`).join("")}</tr>${shown.map(i=>{const mm=(all[pkey(i.r)]||{}).__meta||{};return `<tr><td>${esc(label(i.r))}</td>${cell(mm,i.won).map(c=>`<td>${c}</td>`).join("")}</tr>`}).join("")}</table></div>`:"";
  const cur=pickedList(), ci=listInfo(cur), cat=catOf(cur), crow=CATS.find(c=>c[0]===cat)||CATS[0]; sLast[cat]=cur;
  const catDD=ddHTML("stcat",{label:crow[1],sub:"List type",ph:"Search list types…",pick:sPickCat,
    items:CATS.filter(c=>sKeysIn(c[0]).length).map(([id,lab])=>{const n=sKeysIn(id).length; return {v:id,label:lab,on:id===cat,desc:id==="all"?"Every champion, A–Z":n+(n===1?" list":" lists")}})});
  const listDD=cat==="all"?"":ddHTML("stlist",{label:label(cur),sub:`${CAT_ONE[cat]} · ${ci.won}/${ci.total} ${nzs?"fallen":"won"}`,ph:"Search lists…",aria:"Search "+CAT_ONE[cat].toLowerCase()+" lists",pick:v=>{sPick=v; renderStats()},
    items:sKeysIn(cat).map(r=>{const i=listInfo(r); return {v:r,label:label(r),meta:`${i.won}/${i.total}`,on:r===cur}})});
  $("stats").innerHTML=`<div class="stabs" role="tablist" aria-label="Challenge mode">${MODES.map(([id,lab])=>`<button type="button" role="tab" aria-selected="${id===mode}" class="${id===mode?"on":""}" data-sm="${id}">${esc(lab)}</button>`).join("")}</div>
    <p class="smode"><small>Each mode keeps its own progress, so these stats are for ${esc(MODES.find(m=>m[0]===mode)[1])} only.</small></p>
    <h3>All lists</h3><div class="tg">${tl(keys.flatMap(entriesFor))}</div>
    <h3>By list</h3>
    <div class="chips sfc" role="group" aria-label="Which lists to show">${chip("prog","In progress")}${chip("done","Completed")}${chip("zero","Not started")}</div>
    ${byList}
    ${isHC()?runs("Insanity runs",["Current run","Best run","Restarts"],(mm,w)=>[w,Math.max(mm.best||0,w),mm.resets||0]):""}
    ${isHard()?runs("Hard runs",["Won","Setbacks"],(mm,w)=>[w,mm.setbacks||0]):""}
    <h3>Per list</h3>
    <div class="sdd"><div>${catDD}</div>${listDD?`<div>${listDD}</div>`:""}</div>
    <div class="tg">${tl(ci.es)}</div>`;
}
$("stats").addEventListener("click",e=>{
  const sm=e.target.closest("[data-sm]"); if(sm){sMode=sm.dataset.sm; renderStats(); return}
  const f=e.target.closest("[data-sf]"); if(f){sf[f.dataset.sf]=!sf[f.dataset.sf]; sfSave(); renderStats()}
});

addEventListener("popstate",()=>{if(READONLY)return;const p=location.pathname;if(p==="/"||p==="/about"){view=p==="/about"?"about":"role";render()}});
