function ordered(){
  if(!isRand()) return CHAMPS;
  const names=CHAMPS.map(c=>c.name), m=meta();
  if(READONLY&&!m.order) return CHAMPS;
  const o=(m.order||[]).filter(n=>names.includes(n)), miss=names.filter(n=>!o.includes(n));
  if(!m.order||miss.length||o.length!==m.order.length){
    for(let i=miss.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[miss[i],miss[j]]=[miss[j],miss[i]]}
    m.order=o.concat(miss); save();
  }
  return m.order.map(n=>({name:n}));
}
// Champions temporarily marked "unavailable" (banned / picked in champ select) are skipped by Next up.
// Stored per list + mode in that run's __meta.skip. Cleared when the Next up champion is won or lost.
function listNext(L){const sk=meta().skip||[]; return L.find(c=>!get(c.name).won&&!sk.includes(c.name))||L.find(c=>!get(c.name).won);}
// A champion clicked in the list is "focused": Next up shows it (with a warning) instead of the real next champion.
// Stored per list + mode in that run's __meta.focus. Ignored in Hard/Insanity (only the next champion may be played) and in read-only share views.
function availNext(L){
  if(!READONLY&&!isLock()){const f=meta().focus; if(f){const c=L.find(x=>x.name===f); if(c&&!get(f).won) return c;}}
  return listNext(L);
}
// Remember which list/mode was played most recently (share links use it to open on the list you're actually busy with).
const touch=()=>{meta().t=Date.now(); queueShareImage()};
function clearSkip(name,wasCur){const m=meta(); if(!m.skip) return;
  if(wasCur) delete m.skip; else {m.skip=m.skip.filter(n=>n!==name); if(!m.skip.length) delete m.skip;}}
const nextUp=()=>availNext(ordered());
async function hcLose(name){
  const run=st(), m=meta(), w=ordered().filter(c=>get(c.name).won).length;
  if(!await confirmDlg("Lost with "+name+"?","Your run ends at "+w+" win"+(w===1?"":"s")+" and you start again from the beginning.","Restart run",true)) return;
  delete m.skip; m.t=Date.now(); queueShareImage(); m.resets=(m.resets||0)+1; m.best=Math.max(m.best||0,w); m.last={champ:name,date:today(),wins:w};
  for(const c of CHAMPS){const n=run[c.name]&&run[c.name].note; delete run[c.name]; if(n) run[c.name]={won:false,date:null,games:0,note:n}}
  if(isRand()) delete m.order;
  save(); render();
}
async function hardLose(name){
  const L=ordered(), i=L.findIndex(c=>c.name===name), m=meta(); let p=-1;
  for(let k=i-1;k>=0;k--) if(get(L[k].name).won){p=k;break}
  const prev=p>=0?L[p].name:null;
  if(!await confirmDlg("Lost with "+name+"?",prev?"You go back to "+prev+" and have to win with it again before you can try "+name+" again.":"You haven’t won anything yet, so this just logs the loss and you try "+name+" again.","Log loss",true)) return;
  get(name).games++; m.t=Date.now(); queueShareImage();
  if(prev){const ps=get(prev); ps.won=false; ps.date=null; m.setbacks=(m.setbacks||0)+1; m.last={champ:name,back:prev,date:today()};}
  clearSkip(name,true); save(); render();
}
const LOSTLAB=()=>isHard()?"✗ Lost - Back one":"✗ Lost - Restart";
const loseRun=name=>isHard()?hardLose(name):hcLose(name);
async function editNote(name){
  const s=get(name);
  const v=await ask({title:"Note for "+name,body:"A short note, e.g. “ranked win, 12 kills” or a clip link.",cancel:null,
    input:{value:s.note||"",placeholder:"Add a note…",max:140},buttons:[{label:"Cancel",value:null},{label:"Save",cls:"pri",input:true}]});
  if(v===null) return;
  if(v) s.note=v.slice(0,140); else delete s.note;
  save(); render();
}
const CAT_ONE={roles:"Role",races:"Race",classes:"Class",regions:"Region",all:"All champs",custom:"Custom list"};
const STATS_ICON='<svg aria-hidden="true" viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13.5h12"/><path d="M3.5 12V8.5h2V12M7 12V4.5h2V12M10.5 12V2.5h2V12"/></svg>';
// Three searchable dropdowns (list type -> list -> challenge) plus Stats / Settings, which stay visible on every screen size.
function renderNav(){
  const cat=catOf(role), away=view==="stats"||view==="settings"||view==="about", build=view==="build";
  const crow=CATS.find(c=>c[0]===cat)||CATS[0], won=r=>entriesFor(r).filter(e=>e.s.won).length;
  $("cats").innerHTML=away?`<button type="button" class="back" data-home="1">← Back</button>`
    :ddHTML("cat",{label:crow[1],sub:"List type",ph:"Search list types…",pick:pickCat,
      items:CATS.map(([id,lab])=>{const n=keysIn(id).length; return {v:id,label:lab,on:id===cat,desc:id==="all"?"Every champion, A–Z":id==="custom"&&!n?"Make your own list":n+(n===1?" list":" lists")}})});
  $("navbtns").innerHTML=`<button type="button" data-r="__stats" class="${view==="stats"?"on":""}" title="Stats" aria-label="Stats">${STATS_ICON}<span class="lb">Stats</span></button>`
    +`<button type="button" data-r="__settings" class="${view==="settings"?"on":""}" title="Settings" aria-label="Settings"><span class="ic" aria-hidden="true">⚙</span><span class="lb">Settings</span></button>`;
  $("tabs").hidden=away||build||cat==="all"; $("modes").hidden=away||build;
  $("tabs").innerHTML=ddHTML("list",{label:label(role),sub:LISTS[role]?`${CAT_ONE[cat]} · ${won(role)}/${LISTS[role].length} won`:CAT_ONE[cat],ph:"Search lists…",aria:"Search "+CAT_ONE[cat].toLowerCase()+" lists",pick:pickList,
    items:keysIn(cat).map(r=>({v:r,label:label(r),on:r===role,meta:`${won(r)}/${LISTS[r].length}`})).concat(cat==="custom"?[{v:"__new",label:"＋ New list",cls:"new"}]:[])});
  const mm=MODES.find(m=>m[0]===mode)||MODES[0];
  $("modes").innerHTML=ddHTML("mode",{label:mm[1],sub:"Challenge mode",ph:"Search challenges…",pick:pickMode,
    items:MODES.map(([id,lab,tip])=>({v:id,label:lab,desc:tip,on:id===mode}))});
}
