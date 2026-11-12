function entriesFor(r){return LISTS[r].map(c=>({name:c.name,s:(all[pkey(r)]||{})[c.name]||{won:false,games:0,date:null}}))}
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
function renderStats(){
  $("stats").hidden=view!=="stats"; $("roleView").hidden=view!=="role"; $("settings").hidden=view!=="settings"; $("builder").hidden=view!=="build";
  if(view!=="stats") return;
  const keys=Object.keys(LISTS), infos=keys.map(listInfo), shown=infos.filter(i=>sf[i.state]);
  const cnt=st=>infos.filter(i=>i.state===st).length;
  const chip=(k,lab)=>`<button type="button" class="chip${sf[k]?" on":""}" data-sf="${k}" aria-pressed="${sf[k]}">${lab} <small>${cnt(k)}</small></button>`;
  const byList=shown.length?`<div class="tw"><table><tr><th>List</th><th>Won</th><th>Games</th><th>Avg</th></tr>${shown.map(i=>{
      const w=i.es.filter(e=>e.s.won);
      return `<tr><td>${esc(label(i.r))}<small class="ct">${esc(catLab(i.r))}</small></td><td class="nw">${i.won}/${i.total}${mbar(i.won,i.total)}</td><td>${i.games}</td><td>${w.length?(w.reduce((a,e)=>a+e.s.games,0)/w.length).toFixed(2):"–"}</td></tr>`}).join("")}</table></div>`
    :`<div class="empty">${infos.some(i=>i.state!=="zero")?"No lists match these filters.":"Nothing tracked yet. Win a game and it shows up here."}</div>`;
  const runs=(title,head,cell)=>shown.length?`<h3>${title}</h3><div class="tw"><table><tr><th>List</th>${head.map(h=>`<th>${h}</th>`).join("")}</tr>${shown.map(i=>{const mm=(all[pkey(i.r)]||{}).__meta||{};return `<tr><td>${esc(label(i.r))}</td>${cell(mm,i.won).map(c=>`<td>${c}</td>`).join("")}</tr>`}).join("")}</table></div>`:"";
  const cur=pickedList(), ci=listInfo(cur);
  $("stats").innerHTML=`<p class="smode"><small>Showing ${esc(MODES.find(m=>m[0]===mode)[1])} progress.</small></p>
    <h3>All lists</h3><div class="tg">${tiles(keys.flatMap(entriesFor))}</div>
    <h3>By list</h3>
    <div class="chips sfc" role="group" aria-label="Which lists to show">${chip("prog","In progress")}${chip("done","Completed")}${chip("zero","Not started")}</div>
    ${byList}
    ${isHC()?runs("Insanity runs",["Current run","Best run","Restarts"],(mm,w)=>[w,Math.max(mm.best||0,w),mm.resets||0]):""}
    ${isHard()?runs("Hard runs",["Won","Setbacks"],(mm,w)=>[w,mm.setbacks||0]):""}
    <h3>Per list</h3>
    ${ddHTML("stats",{label:label(cur),sub:`${catLab(cur)} · ${ci.won}/${ci.total} won`,ph:"Search lists…",aria:"Search lists",pick:v=>{sPick=v; renderStats()},
      items:keys.map(r=>{const i=listInfo(r); return {v:r,label:label(r),group:catLab(r),meta:`${i.won}/${i.total}`,on:r===cur}})})}
    <div class="tg">${tiles(ci.es)}</div>`;
}
$("stats").addEventListener("click",e=>{
  const f=e.target.closest("[data-sf]"); if(f){sf[f.dataset.sf]=!sf[f.dataset.sf]; sfSave(); renderStats()}
});

addEventListener("popstate",()=>{if(READONLY)return;const p=location.pathname;if(p==="/"||p==="/about"){view=p==="/about"?"about":"role";render()}});
