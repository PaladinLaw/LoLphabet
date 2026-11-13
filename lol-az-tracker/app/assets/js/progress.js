const ordered=()=>CHAMPS;
// Champions temporarily marked "unavailable" (banned / picked in champ select) are skipped by Next up.
// Stored per list + mode in that run's __meta.skip. Cleared when the Next up champion is won or lost.
function listNext(L){const sk=meta().skip||[]; return L.find(c=>!get(c.name).won&&!sk.includes(c.name))||L.find(c=>!get(c.name).won);}
// A champion clicked in the list is "focused": Next up shows it (with a warning) instead of the real next champion.
// Stored per list + mode in that run's __meta.focus. Ignored in Hard/Insanity (only the next champion may be played) and in read-only share views.
function availNext(L){
  if(isNuz()){const f=!READONLY&&meta().focus; return f&&!nzDead(f)?L.find(x=>x.name===f)||null:null}   // Nuzlocke: Now playing is whichever living champion you opened
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
// ---- Nuzlocke: play any champion as often as you like. Wins are counted but never complete a champion. Lose and it "falls" for good; the list is done when the last one falls. ----
// Per champion (in the list's Nuzlocke run): wins = number of wins, dead = true once it has lost, diedOn = date. games = wins + 1 for a dead champion.
const nzDead=n=>!!(st()[n]&&st()[n].dead), nzWins=n=>(st()[n]&&st()[n].wins)||0;
const nzCount=()=>{const L=CHAMPS; let dead=0,wins=0; for(const c of L){const s=st()[c.name]; if(s){wins+=s.wins||0; if(s.dead)dead++}} return {total:L.length,dead,alive:L.length-dead,wins}};
function nzSync(s){s.games=(s.wins||0)+(s.dead?1:0)}
function nzWin(name){const s=get(name); if(s.dead) return; s.wins=(s.wins||0)+1; nzSync(s); if(isRandNuz()) nzRandFocus(name); else if(meta().rolled===name) delete meta().rolled; touch(); save(); render();}
function nzUndoWin(name){const s=get(name); if(s.dead||!s.wins) return; s.wins--; nzSync(s); touch(); save(); render();}
async function nzDie(name){
  const s=get(name); if(s.dead) return; const n0=nzCount(), w=s.wins||0, last=n0.alive===1;
  if(!await confirmDlg("Lost with "+name+"?",name+" falls and is greyed out for good: it can't be picked or edited again. Its "+w+" win"+(w===1?" stays":"s stay")+" in your stats."+(last?"\n\nThis is your last champion, so the run (and this list) will be complete.":""),"Fallen",true)) return;
  s.dead=true; s.diedOn=today(); nzSync(s); const m=meta(); if(m.focus===name) delete m.focus; if(m.rolled===name) delete m.rolled; m.last={champ:name,wins:w,date:today()};
  touch(); save(); render();
  if(last){const c=nzCount(); await info("Nuzlocke complete","Your last champion has fallen. "+c.wins+" win"+(c.wins===1?"":"s")+" across "+c.total+" champions on "+label(role)+".");}
}
// ---- Nuzlocke dice roll: same as clicking a champion in the list, but you close your eyes first. Only living champions on the list you are on. ----
const nzAlive=()=>CHAMPS.filter(c=>!nzDead(c.name));
// A dice-rolled champion is locked in: no rerolls, no switching, no choosing another. The lock ends when you win or lose with it. Random Nuzlocke is always locked (the app picks).
function nzRolled(){ const m=(all[pkey(role)]||{}).__meta||{}; return !!(isNuz()&&!isRandNuz()&&m.rolled&&m.rolled===m.focus&&!nzDead(m.rolled)&&CHAMPS.some(c=>c.name===m.rolled)); }
const nzLock=()=>isRandNuz()||nzRolled();
function nzRollName(exclude){ let p=nzAlive(); const o=exclude?p.filter(c=>c.name!==exclude):p; if(o.length) p=o; return p.length?p[Math.floor(Math.random()*p.length)].name:null; }
function nzRandFocus(exclude){ const n=nzRollName(exclude); if(n) meta().focus=n; return n; }   // Random Nuzlocke: pick the next champion (never a fallen one, and not the one just played unless it's the only one left)
function nzRoll(){ if(READONLY||!isNuz()||isRandNuz()) return; if(nzRolled()) return; const n=nzRollName(); if(!n) return; const m=meta(); m.focus=n; m.rolled=n; save(); render(); }
// Random Nuzlocke always has a champion open: the first time the mode is shown (or after the list changes) one is rolled.
function ensureRandPick(){
  if(READONLY||!isRandNuz()||view!=="role") return;
  const f=((all[pkey(role)]||{}).__meta||{}).focus;
  if(f&&!nzDead(f)&&CHAMPS.some(c=>c.name===f)) return;
  if(nzAlive().length&&nzRandFocus(null)) save();
}
const loseRun=name=>isNuz()?nzDie(name):isHard()?hardLose(name):hcLose(name);
async function editNote(name){
  const s=get(name);
  const v=await ask({title:"Note for "+name,body:"A short note, e.g. “ranked win, 12 kills” or a clip link.",cancel:null,
    input:{value:s.note||"",placeholder:"Add a note…",max:140},buttons:[{label:"Cancel",value:null},{label:"Save",cls:"pri",input:true}]});
  if(v===null) return;
  if(v) s.note=v.slice(0,140); else delete s.note;
  save(); render();
}
const CAT_ONE={roles:"Role",races:"Race",classes:"Class",regions:"Region",all:"All champs",custom:"Custom list"};
const ROLL_ICON='<svg aria-hidden="true" viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="2.5"/><circle cx="5.5" cy="5.5" r=".6" fill="currentColor"/><circle cx="10.5" cy="5.5" r=".6" fill="currentColor"/><circle cx="8" cy="8" r=".6" fill="currentColor"/><circle cx="5.5" cy="10.5" r=".6" fill="currentColor"/><circle cx="10.5" cy="10.5" r=".6" fill="currentColor"/></svg>';
const STATS_ICON='<svg aria-hidden="true" viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13.5h12"/><path d="M3.5 12V8.5h2V12M7 12V4.5h2V12M10.5 12V2.5h2V12"/></svg>';
// Three searchable dropdowns (list type -> list -> challenge) plus Stats / Settings, which stay visible on every screen size.
function renderNav(){
  const cat=catOf(role), away=view==="stats"||view==="settings"||view==="about"||view==="roll", build=view==="build";
  const crow=CATS.find(c=>c[0]===cat)||CATS[0], won=r=>entriesFor(r).filter(e=>e.s.won).length;
  $("cats").innerHTML=away?`<button type="button" class="back" data-home="1">← Back</button>`
    :ddHTML("cat",{label:crow[1],sub:"List type",ph:"Search list types…",pick:pickCat,
      items:CATS.map(([id,lab])=>{const n=keysIn(id).length; return {v:id,label:lab,on:id===cat,desc:id==="all"?"Every champion, A-Z":id==="custom"&&!n?"Make your own list":n+(n===1?" list":" lists")}})});
  const rollBtn=(view==="role"||view==="roll")&&!isNuz()?`<button type="button" data-r="__roll" class="${view==="roll"?"on":""}" title="Roll a random role and champion" aria-label="Roll a random role and champion">${ROLL_ICON}<span class="lb">Dice Roll</span></button>`:"";   // Roll lives on the main views, not on Stats / Settings
  $("navbtns").innerHTML=rollBtn+`<button type="button" data-r="__stats" class="${view==="stats"?"on":""}" title="Stats" aria-label="Stats">${STATS_ICON}<span class="lb">Stats</span></button>`
    +`<button type="button" data-r="__settings" class="${view==="settings"?"on":""}" title="Settings" aria-label="Settings"><span class="ic" aria-hidden="true">⚙</span><span class="lb">Settings</span></button>`;
  $("tabs").hidden=away||build||cat==="all"; $("modes").hidden=away||build;
  $("tabs").innerHTML=ddHTML("list",{label:label(role),sub:LISTS[role]?`${CAT_ONE[cat]} · ${won(role)}/${LISTS[role].length} ${isNuz()?"fallen":"won"}`:CAT_ONE[cat],ph:"Search lists…",aria:"Search "+CAT_ONE[cat].toLowerCase()+" lists",pick:pickList,
    items:keysIn(cat).map(r=>({v:r,label:label(r),on:r===role,meta:`${won(r)}/${LISTS[r].length}`})).concat(cat==="custom"?[{v:"__new",label:"＋ New list",cls:"new"}]:[])});
  const mm=MODES.find(m=>m[0]===mode)||MODES[0];
  $("modes").innerHTML=ddHTML("mode",{label:mm[1],sub:"Challenge mode",ph:"Search challenges…",pick:pickMode,
    items:MODES.map(([id,lab,tip])=>({v:id,label:lab,desc:tip,on:id===mode}))});
}
