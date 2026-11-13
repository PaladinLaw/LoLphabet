function swapTag(id,tag){const e=document.getElementById(id); if(!e||e.tagName.toLowerCase()===tag)return; const n=document.createElement(tag); for(const a of e.attributes)n.setAttribute(a.name,a.value); n.innerHTML=e.innerHTML; e.replaceWith(n);}
// Nuzlocke card: any living champion can be played. A fallen champion is greyed out and inert (can't be selected or edited).
function nzCard(c,s,isCur){
  const w=s.wins||0, wl=w+" win"+(w===1?"":"s"), dead=!!s.dead;
  const sub=dead?`${SKULL}Fallen ${s.diedOn||""} • ${wl}`:(w?wl:"&nbsp;");
  const acts=dead||(nzLock()&&!isCur)?"":`<button data-a="m" title="Remove a victory"${w?"":" disabled"}>−</button><button data-a="w" class="wb" title="Log a victory">＋ Victory</button><button data-a="x" class="danger" title="Lost with ${esc(c.name)}: this champion falls">${SKULL}Fallen</button>`;
  return `<div class="c ${dead?"dead":""} ${isCur?"cur":""}"${dead?" inert":""} data-n="${esc(c.name)}">
      <div class="l"><span>${esc(c.name[0])}</span>${iconUrl(c.name)?`<img src="${iconUrl(c.name)}" alt="" loading="lazy" onerror="this.remove()">`:""}</div>
      <div class="n"><div>${esc(c.name)}</div><small>${sub}</small>${s.note?`<small class="nt">${linkify(s.note)}</small>`:""}</div>
      ${dead?'<div class="ck" title="Fallen">'+SKULL+'</div>':""}
      <div class="g">${dead?"":`<button data-a="n" title="${s.note?"Edit note":"Add a note"}">✎</button>`}${acts}</div>
    </div>`;
}
function render(){
  if(view==="roll"&&!ROLLED) view="role";
  renderHowto();
  if(!READONLY){const p=location.pathname;
    if(view==="about"&&p!=="/about")history.pushState(null,"","/about");
    else if(view!=="about"&&p==="/about")history.pushState(null,"","/");}
  ensureRandPick(); renderStats(); renderSettings(); drawChips(); renderNav();
  $("about").hidden=view!=="about";
  if(!READONLY){
    const T={stats:"Stats | LoLphabet",settings:"Settings | LoLphabet",build:"List builder | LoLphabet",about:"About LoLphabet | League of Legends A-Z Challenge Tracker",roll:"Roll a champion | LoLphabet"};
    document.title=T[view]||"LoLphabet | Free League of Legends A-Z Challenge Tracker";
    // one H1 per view: the tagline on the home view, "About LoLphabet" on /about
    const ab=view==="about"; swapTag("tl",ab?"p":"h1"); swapTag("about-h",ab?"h1":"h2");
  }
  $("editlist").hidden=!role.startsWith("c:"); $("sharelist").hidden=!role.startsWith("c:");
  const nz=isNuz(), L=ordered(), hc=isLock(), m=meta(), done=n=>nz?!!get(n).dead:!!get(n).won, won=L.filter(c=>done(c.name)).length, total=L.length;
  const cur=availNext(L);
  const fb=k=>document.querySelector('[data-f="'+k+'"]'); fb("todo").textContent=nz?"Alive":"To do"; fb("win").textContent=nz?"Fallen":"Won";
  $("fill").style.width=(total?won/total*100:0)+"%";
  $("count").textContent=won+" / "+total+(nz?" fallen":" won"); $("pct").textContent=(total?Math.round(won/total*100):0)+"%";
  $("grid").classList.toggle("rnd",nzLock());
  renderNext();
  const q=query.toLowerCase(), skl=m.skip||[];
  const list=L.filter(c=>{const w=done(c.name);return (filter==="all"||(filter==="win"?w:!w)) && c.name.toLowerCase().includes(q)});
  $("grid").innerHTML=list.length?list.map(c=>{
    const s=get(c.name), isCur=!!cur&&cur.name===c.name, locked=hc&&!s.won&&!isCur;
    if(nz) return nzCard(c,s,isCur);
    const sub=s.won?`Won ${s.date||""} <button class="ed" data-a="d" title="Edit date">✎</button> • ${s.games} attempt${s.games===1?"":"s"}`:(s.games?`${s.games} loss${s.games===1?"":"es"}`:"&nbsp;");
    const acts=hc
      ?(s.won?'<button data-a="w" class="wb">↺ Undo</button>':isCur?'<button data-a="x" class="danger">'+LOSTLAB()+'</button><button data-a="w" class="wb">✓ Complete</button>':"")
      :`<button data-a="m" title="${s.won?"Remove an attempt":"Remove a logged loss"}">−</button><button data-a="p" title="${s.won?"Add an attempt":"Log a loss"}">+</button><button data-a="w" class="wb">${s.won?"↺ Undo":"✓ Complete"}</button>`;
    const bn=!READONLY&&!s.won&&!isCur&&skl.includes(c.name);
    return `<div class="c ${s.won?"win":""} ${isCur?"cur":""} ${locked?"locked":""} ${bn?"bn":""}"${bn?" inert":""} data-n="${esc(c.name)}">
      <div class="l"><span>${esc(c.name[0])}</span>${iconUrl(c.name)?`<img src="${iconUrl(c.name)}" alt="" loading="lazy" onerror="this.remove()">`:""}</div>
      <div class="n"><div>${esc(c.name)}</div><small>${sub}</small>${s.note?`<small class="nt">${linkify(s.note)}</small>`:""}</div>
      ${s.won?'<div class="ck" title="Completed">✓</div>':""}
      ${bn?'<div class="rib">Picked / Banned</div>':""}
      <div class="g"><button data-a="n" title="${s.note?"Edit note":"Add a note"}">✎</button>${acts}</div>
    </div>`}).join(""):`<div class="empty" style="grid-column:1/-1">${role.startsWith("class:")&&!total?"Loading class data…":"No champions match."}</div>`;
}

const today=()=>{const d=new Date();return new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
$("grid").addEventListener("click",e=>{
  const card=e.target.closest(".c"); if(!card||READONLY||card.classList.contains("bn")||e.target.closest("a")) return;
  if(isNuz()){                                    // Nuzlocke: any living champion; wins never complete it; a loss kills it
    const nm=card.dataset.n, a=e.target.closest("button")?.dataset.a; if(nzDead(nm)) return;
    if(nzLock()&&a!=="n"&&nm!==(nextUp()||{}).name) return;      // Random Nuzlocke / a dice roll: only the champion that was picked for you can be played
    if(a==="n") editNote(nm); else if(a==="w") nzWin(nm); else if(a==="m") nzUndoWin(nm); else if(a==="x") nzDie(nm);
    else if(!a){ if(nzLock()) return; meta().focus=nm; save(); render(); $("next").scrollIntoView({behavior:"smooth",block:"start"}); }
    return;
  }
  const name=card.dataset.n, s=get(name), a=e.target.closest("button")?.dataset.a, cur=nextUp(), real=listNext(ordered());
  if(a==="d"){editDate(name);return}
  if(a==="n"){editNote(name);return}
  if(a==="x"){loseRun(name);return}
  if(isLock()&&!s.won&&(!cur||cur.name!==name)) return;
  if(!a){                                    // clicking the champion itself only opens it in Next up; it no longer marks it complete
    if(isLock()||s.won) return;
    if(!cur||cur.name!==name){const m=meta(); if(real&&real.name===name) delete m.focus; else m.focus=name; save(); render();}
    $("next").scrollIntoView({behavior:"smooth",block:"start"});
    return;
  }
  const wasCur=(!!cur&&cur.name===name)||(!!real&&real.name===name);
  if(a==="p"){ s.games++; clearSkip(name,wasCur); touch(); }
  else if(a==="m"){ s.games=Math.max(s.won?1:0,s.games-1); touch(); }
  else if(!s.won){ s.won=true; s.date=today(); s.games++; clearSkip(name,wasCur); if(meta().focus===name) delete meta().focus; touch(); }
  else { s.won=false; s.date=null; s.games=Math.max(0,s.games-1); touch(); }
  save(); render();
});
$("next").addEventListener("click",e=>{
  const t=e.target.closest("[data-bt]");                       // build panel controls (also work in read-only share views)
  if(t){const k=t.dataset.bt, cur=nextUp();
    if(k==="swap") bopen.swap=!bopen.swap;
    else if(k==="pos"&&cur&&POSORDER.includes(t.dataset.p)) pospick[cur.name]=t.dataset.p;
    bsave(); renderNext(); return;}
  const b=e.target.closest("button");
  if(b&&b.dataset.a==="nzr"){nzRoll();return}                     // Nuzlocke dice roll (shown while no champion is open)
  if(b&&view==="roll"){ if(b.dataset.a==="rr") openRoll(); else if(b.dataset.a==="rb"){view="role";render();window.scrollTo&&window.scrollTo(0,0)} return; }   // Roll page buttons
  if(!b||READONLY) return;
  const cur=nextUp(); if(!cur) return;
  if(isNuz()&&b.dataset.a==="w"){nzWin(cur.name);return}
  if(isRandNuz()&&b.dataset.a==="rpb"){nzRandFocus(cur.name); save(); render(); return}   // picked / banned: no penalty, just roll the next one
  if(b.dataset.a==="x") loseRun(cur.name);
  else if(b.dataset.a==="u"){const m=meta(); m.skip=(m.skip||[]).concat(cur.name); if(m.focus===cur.name) delete m.focus; save(); render();}
  else if(b.dataset.a==="l"){const s=get(cur.name); s.games++; clearSkip(cur.name,true); touch(); save(); render();}   // same as the + (add an attempt) button on the champion's card
  else if(b.dataset.a==="bf"){if(nzLock()) return; delete meta().focus; save(); render();}
  else if(b.dataset.a==="uc"){delete meta().skip; save(); render();}
  else if(b.dataset.a==="w"){const s=get(cur.name); if(!s.won){s.won=true;s.date=today();s.games++;clearSkip(cur.name,true);if(meta().focus===cur.name) delete meta().focus;touch();save();render();}}
});
function pickCat(id){
  const keys=keysIn(id);
  if(id==="custom"&&!keys.length){ openBuilder(null); return; }
  role=keys.includes(lastIn[id])?lastIn[id]:keys[0]; CHAMPS=LISTS[role]; view="role"; save(); render();
}
function pickList(r){
  if(r==="__new"){ openBuilder(null); return; }
  view="role"; role=r; lastIn[catOf(r)]=r; CHAMPS=LISTS[role]; save(); render();
}
function pickMode(m){
  mode=m; try{localStorage.setItem("lol-az-mode",mode)}catch(x){}
  if(view==="settings"||view==="build") view="role"; render();
}
function navClick(e){                                   // Back / Stats / Settings buttons (the dropdowns handle themselves, see dropdown.js)
  const b=e.target.closest("button"); if(!b) return; const d=b.dataset;
  if(d.home){ view="role"; render(); return; }
  if(d.r==="__roll"){ openRoll(); return; }
  if(d.r==="__stats"){ view="stats"; sMode=null; }
  else if(d.r==="__settings"){ if(view!=="settings") sTab=null; view="settings"; nameEdit=false; }   // opening Settings always starts on the first tab (Account, or Preferences when accounts are off)
  else return;
  render();
}
$("cats").addEventListener("click",navClick); $("navbtns").addEventListener("click",navClick);
$("q").addEventListener("input",e=>{query=e.target.value;render()});
document.querySelectorAll("[data-f]").forEach(b=>b.addEventListener("click",()=>{
  filter=b.dataset.f;
  document.querySelectorAll("[data-f]").forEach(x=>x.classList.toggle("on",x===b));
  render();
}));
$("exp").onclick=()=>{
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([JSON.stringify(all,null,2)],{type:"application/json"}));
  a.download="lol-az-progress.json";a.click();
};
$("imp").onclick=()=>{
  const i=document.createElement("input");i.type="file";i.accept="application/json";
  i.onchange=()=>i.files[0].text().then(t=>{
    try{const d=JSON.parse(t);if(d&&typeof d==="object"){if(d.Jungle||d.Top||d.__lists)all=d;else all[role]=d;rebuildLists();save();render();}}catch(e){info("Import failed","That file isn't a valid progress export.")}
  });i.click();
};
$("rst").onclick=async()=>{if(await confirmDlg("Reset this list?","All progress on "+label(role)+" will be cleared"+(session?", including in your account":"")+".","Reset list",true)){all[pkey(role)]={};save();render();}};

