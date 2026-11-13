// ---- Next up: build data from /api/builds (collected weekly by the separate lol-meta-collector; never fetched from OP.GG in the browser) ----
const POSMAP={"Top":"TOP","Jungle":"JUNGLE","Mid":"MID","Bot / ADC":"ADC","Support":"SUPPORT"};   // role list -> collector position
const POSNAME={TOP:"top",JUNGLE:"jungle",MID:"mid",ADC:"adc",SUPPORT:"support"}, POSORDER=["TOP","JUNGLE","MID","ADC","SUPPORT"];
let bopen={runes:false}, pospick={}, BUILDS={}, BPEND={};
if(!READONLY)try{const o=JSON.parse(localStorage.getItem("lol-az-bopen"));if(o&&typeof o==="object")bopen=Object.assign(bopen,o);const p=JSON.parse(localStorage.getItem("lol-az-pospick"));if(p&&typeof p==="object")pospick=p}catch(e){}
const bsave=()=>{if(READONLY)return;try{localStorage.setItem("lol-az-bopen",JSON.stringify(bopen));localStorage.setItem("lol-az-pospick",JSON.stringify(pospick))}catch(e){}};
const bkey=(n,p)=>n+"|"+(p||"*");
const pct=v=>typeof v==="number"&&isFinite(v)?v.toFixed(1)+"%":"–", nfmt=v=>typeof v==="number"&&isFinite(v)?Math.round(v).toLocaleString():"–";
function loadBuild(name,pos){
  const k=bkey(name,pos), e=BUILDS[k];
  if(BPEND[k]||(e&&Date.now()-e.t<6e5)) return;                       // cached for 10 min; refreshed quietly after that
  BPEND[k]=1;
  fetch("/api/builds?champion="+encodeURIComponent(name)+(pos?"&position="+pos:"")).then(r=>r.ok?r.json():Promise.reject(r.status))
    .then(j=>{BUILDS[k]={t:Date.now(),j}})
    .catch(()=>{if(!BUILDS[k])BUILDS[k]={t:Date.now()-5.5e5,j:{state:"error"}}})   // an error is retried after ~50 s
    .finally(()=>{delete BPEND[k];renderNext()});
}
let BPOS={};   // champion -> positions the collector has (kept so the chips stay put while another position loads)
const posChips=(list,sel)=>`<span class="k">Position</span><div class="nxr">${POSORDER.filter(p=>list.some(x=>x.position===p)).map(p=>`<button class="pc${p===sel?" on":""}" data-bt="pos" data-p="${p}" aria-pressed="${p===sel}">${POSNAME[p]}</button>`).join("")}</div>`;
const btip=x=>[x.name,x.pick_rate!=null?pct(x.pick_rate)+" pick":"",x.win_rate!=null?pct(x.win_rate)+" win":"",x.sample_size?nfmt(x.sample_size)+" games":""].filter(Boolean).join(" · ");
const bimg=(x,c)=>`<span class="bi ${c||""}" title="${esc(btip(x))}">${x.image?`<img src="${esc(x.image)}" alt="${esc(x.name||"")}" onerror="this.remove()">`:""}</span>`;
function freshHtml(d){
  if(!d) return "";
  const dt=d.collected_at?new Date(d.collected_at):null, when=dt&&isFinite(dt)?dt.toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"}):"date unknown";
  const dd=d.age_days==null?null:Math.floor(d.age_days), age=dd==null?"":dd<1?" (today)":" ("+dd+" day"+(dd===1?"":"s")+" ago)", w=[];
  if(d.from==="archive") w.push("The latest collection was empty or failed, so this is the last good snapshot.");
  if(d.stale) w.push(d.age_days==null?"The collection date is unknown.":"This data is more than "+d.stale_after_days+" days old, so the collector may have stopped.");
  return `<div class="nxm full">Build data: <a href="https://op.gg" target="_blank" rel="noopener noreferrer">OP.GG</a> · ${esc(d.rank||"")} · Last Updated ${esc(when)}</div>`;
}
// ---- Rune page: the full rune trees come from Riot Data Dragon (same host as the champion icons); the collector's build only says which runes are picked ----
let RD=null; try{RD=JSON.parse(localStorage.getItem("lol-az-runes"))}catch(e){}
let RDPEND=false;
function loadRunes(){
  if(RDPEND||(RD&&RD.trees&&RD.t&&Date.now()-RD.t<864e5)) return; RDPEND=true;
  (DD&&DD.ver?Promise.resolve(DD.ver):fetch("https://ddragon.leagueoflegends.com/api/versions.json").then(r=>r.json()).then(v=>v[0]))
    .then(ver=>fetch("https://ddragon.leagueoflegends.com/cdn/"+ver+"/data/en_US/runesReforged.json"))
    .then(r=>r.json()).then(d=>{
      RD={t:Date.now(),trees:d.map(t=>({id:t.id,name:t.name,icon:t.icon,slots:t.slots.map(sl=>sl.runes.map(x=>({id:x.id,name:x.name,icon:x.icon})))}))};
      try{localStorage.setItem("lol-az-runes",JSON.stringify(RD))}catch(e){}
    }).catch(()=>{}).finally(()=>{RDPEND=false;renderNext()});
}
const RIMG="https://ddragon.leagueoflegends.com/cdn/img/", SHIMG="https://raw.communitydragon.org/latest/game/assets/perks/statmods/";
const SHARDS=[[5008,5005,5007],[5008,5010,5001],[5011,5013,5001]];   // offense / flex / defense rows
const SHN={5008:["Adaptive Force","statmodsadaptiveforceicon"],5005:["Attack Speed","statmodsattackspeedicon"],5007:["Ability Haste","statmodscdrscalingicon"],5010:["Move Speed","statmodsmovementspeedicon"],5001:["Scaling Health","statmodshealthscalingicon"],5011:["Health","statmodshealthplusicon"],5013:["Tenacity and Slow Resist","statmodstenacityicon"]};
const sameR=(a,b)=>(a.id!=null&&b.id!=null&&String(a.id)===String(b.id))||(a.name&&b.name&&a.name.toLowerCase()===b.name.toLowerCase());
const ri=(src,name,on,c)=>`<span class="ri ${c}${on?" on":""}" title="${esc(name)}"><img src="${esc(src)}" alt="${esc(name)}" onerror="this.remove()"></span>`;
function runePage(r){
  if(!RD||!RD.trees||!r.primary_style) return "";
  const find=st=>st&&RD.trees.find(t=>sameR(t,st)), pt=find(r.primary_style), stt=r.secondary_style?find(r.secondary_style):null;
  if(!pt||!r.primary.some(x=>pt.slots.some(sl=>sl.some(y=>sameR(x,y))))) return "";       // ids/names don't line up -> flat fallback
  const head=t=>`<div class="rh"><img src="${RIMG+esc(t.icon)}" alt="" onerror="this.remove()"><b>${esc(t.name)}</b></div>`;
  const rowsOf=(t,sel,from)=>t.slots.slice(from).map((sl,i)=>`<div class="rr${from===0&&i===0?" ks":""}">${sl.map(x=>ri(RIMG+x.icon,x.name,sel.some(y=>sameR(x,y)),from===0&&i===0?"ks":"")).join("")}</div>`).join("");
  const sh=r.stat_shards||[], shRows=SHARDS.map((ids,i)=>{const p=sh[i], pid=p&&p.id!=null&&ids.includes(Number(p.id))?Number(p.id):(p&&ids.find(id=>SHN[id][0].toLowerCase()===String(p.name||"").toLowerCase()));
    return `<div class="rr shr">${ids.map(id=>ri(SHIMG+SHN[id][1]+".png",SHN[id][0],id===pid,"sh")).join("")}</div>`}).join("");
  return `<div class="rpg"><div class="rcol">${head(pt)}${rowsOf(pt,r.primary,0)}</div><div class="rcol">${stt?head(stt)+rowsOf(stt,r.secondary,1):""}<div class="rsh">${shRows}</div></div></div>`;
}
function buildRows(j,fixed){
  const b=j.build, rows=[];
  if(!fixed&&j.positions&&j.positions.length) rows.push(posChips(j.positions,j.position));
  if(b.summoner_spells.length){
    const ss=b.summoner_spells.slice(), fi=ss.findIndex(x=>/^flash$/i.test(x.name||""));
    if(fi>=0&&fi!==ss.length-1) ss.push(ss.splice(fi,1)[0]);          // Flash goes last (right) by default
    if(bopen.swap) ss.reverse();                                        // user's swap toggle
    rows.push(`<span class="k">Summoners</span><div class="nxr">${ss.map(s=>bimg(s)).join("")}${ss.length>1?`<button class="sw" data-bt="swap" title="Swap summoner spell order" aria-label="Swap summoner spell order">⇄</button>`:""}</div>`);
  }
  if(b.skill_order.length){
    const maxOrder=(Array.isArray(b.skill_max_order)?b.skill_max_order:[]).join(" → ");
    const levels=b.skill_order.map((k,i)=>`<span class="skill-step" title="Level ${i+1}: ${esc(k)}"><small>${i+1}</small><i${k==="R"?' class="r"':""}>${esc(k)}</i></span>`).join("");
    rows.push(`<span class="k">Level-up order</span><div class="skill-sequence" aria-label="Skill levels 1 to ${b.skill_order.length}">${levels}</div>`);
    if(maxOrder) rows.push(`<span class="k">Max priority</span><div class="skill-max" aria-label="Max abilities in this order">${esc(maxOrder)}</div>`);
  }
  const seen=new Set(), sitAll=["fourth","fifth","sixth","last"].flatMap(k=>b.situational_items[k]||[]).filter(x=>{const id=x.id!=null?x.id:x.name; if(seen.has(id))return false; seen.add(id); return true});
  // Two rows: "Starting Items" (starting items, then a labelled Boots group), and "Items" (the actual build: core, then situational).
  const grp=(t,l)=>`<span class="grp" title="${t}">${l.map(x=>bimg(x)).join("")}</span>`, boots=b.core_items.boots;
  if(b.starting_items.length||boots.length) rows.push(`<span class="k">Starting Items</span><div class="nxr">${b.starting_items.length?grp("Starting items",b.starting_items):""}${boots.length?`<span class="lbl">Boots:</span>${grp("Boots",boots)}`:""}</div>`);
  const buildGroups=[["Core items",b.core_items.items],["Situational items",sitAll]].filter(g=>g[1].length);
  if(buildGroups.length) rows.push(`<span class="k">Items</span><div class="nxr">${buildGroups.map(g=>grp(g[0],g[1])).join('<span class="sep">›</span>')}</div>`);
  const r=b.runes; loadRunes();
  if(r&&r.primary_style&&r.primary.length){
    rows.push(`<div class="full rsp" aria-hidden="true"></div>`);          // keeps the row height the old "Runes" link used to take
    const page=runePage(r), tip=r.sample_size?`Rune page: ${pct(r.pick_rate)} pick · ${pct(r.win_rate)} win · ${nfmt(r.sample_size)} games`:"";
    if(page) rows.push(`<div class="rp side" title="${esc(tip)}">${page}</div>`);
    else if(!(RD&&RD.trees)&&RDPEND){}                                       // rune trees still loading: show nothing rather than flashing the flat list
    else{
      const tree=(s,a)=>`<span class="rs">${bimg(s,"st")}${esc(s.name)}</span>${a.map(x=>bimg(x,"rn")).join("")}`;
      rows.push(`<div class="rp full"><div class="nxr">${tree(r.primary_style,r.primary)}${r.secondary_style?`<span class="sep">+</span>${tree(r.secondary_style,r.secondary)}`:""}</div>`
        +(r.stat_shards.length?`<div class="nxr"><span>Shards</span>${r.stat_shards.map(x=>`<span class="rs">${bimg(x,"sh")}<span style="font-weight:400">${esc(x.name)}</span></span>`).join("")}</div>`:"")
        +(tip?`<div class="nxm" style="margin-top:8px">${tip}</div>`:"")+`</div>`);
    }
  }
  return rows.join("");
}
// R = a Roll result ({role}): shown in the same banner with its build, but it reads and writes nothing in your lists.
function nextBox(cur,hc,m,won,total,R){
  const nz=!R&&isNuz();
  const fixed=R?true:!!POSMAP[role], want=R?(POSMAP[R.role]||""):(POSMAP[role]||pospick[cur.name]||"");     // role lists fix the position; other lists use the user's chip (or the most-played position, shown openly)
  loadBuild(cur.name,want);
  const e=BUILDS[bkey(cur.name,want)], j=e&&e.j, ok=j&&j.state==="ok", pos=(j&&j.position)||want, letter=esc(cur.name[0]);
  const ic=iconUrl(cur.name)||(ok&&j.champion_icon)||"", st=ok?j.statistics:null;
  const att=R?0:get(cur.name).games, real=R?null:listNext(ordered()), warn=(!R&&!READONLY&&!isLock()&&!nz&&real&&real.name!==cur.name)?`<div class="nxw" role="status">⚠ <strong>This isn’t the next champion in your list.</strong> The next one is <strong>${esc(real.name)}</strong>. <button class="un-c" data-a="bf">Switch back to ${esc(real.name)}</button></div>`:"";
  const sk=R?[]:(m.skip||[]), left=R?[]:ordered().filter(c=>!get(c.name).won), nSk=left.filter(c=>sk.includes(c.name)).length, canSkip=!nz&&left.filter(c=>!sk.includes(c.name)).length>1;
  let panel;
  if(j&&j.positions&&j.positions.length) BPOS[cur.name]=j.positions;
  if(!j) panel=`<div class="nxm full">Loading build…</div>`+(!fixed&&BPOS[cur.name]?posChips(BPOS[cur.name],want):"");
  else if(ok) panel=buildRows(j,fixed)+freshHtml(j.data);
  else{
    const chips=!fixed&&j.positions&&j.positions.length?posChips(j.positions,""):"";
    const avail=fixed&&j.positions&&j.positions.length?" Collected for: "+POSORDER.filter(p=>j.positions.some(x=>x.position===p)).map(p=>POSNAME[p]).join(", ")+".":"";
    const msg=j.state==="no_position"?`No build data for ${esc(cur.name)} in ${esc(POSNAME[pos]||"that position")}.${avail}`
      :j.state==="no_champion"?`No build data for ${esc(cur.name)} yet.`
      :j.state==="no_data"?"No build data has been collected yet.":"Build data isn’t available right now.";
    panel=`<div class="nxm full" style="font-size:13px">${msg}</div>${chips}${j.state==="error"||j.state==="no_data"?"":freshHtml(j.data)}`;
  }
  return `<div class="nxh"><div class="nxl"><div class="nxi${ic?"":" noimg"}"><span>${letter}</span>${ic?`<img src="${esc(ic)}" alt="" onerror="var p=this.parentNode;this.remove();p.classList.add('noimg')">`:""}<i>${letter}</i></div>
    <div><div class="nxk">${R?"ROLLED":nz?"NOW PLAYING":"NEXT UP"}${!R&&isHC()?" · run "+((m.resets||0)+1):""}</div><div class="nxn"><b>${esc(cur.name)}</b><span class="nxp">(${esc(R?R.role.toLowerCase():(pos?(POSNAME[pos]||pos)+" - ":"")+(nz?nzWins(cur.name)+" win"+(nzWins(cur.name)===1?"":"s")+" · "+nzCount().alive+" alive":(total-won)+" left to go"))})</span></div>
    ${st?`<div class="nxs"><span>Pick Rate: <b>${pct(st.pick_rate)}</b></span><span>Win Rate: <b>${pct(st.win_rate)}</b></span><span title="Games analysed for this champion in this position">Sample Size: <b>${nfmt(st.games)}</b></span></div>`:""}</div></div>
    <div class="nb">${nSk?`<span>${nSk} unavailable <button class="un-c" data-a="uc" title="Make all champions available again">clear</button></span>`:""}${R?rollButtons():nz?nzButtons(cur):hc
      ?`<div class="nbg"><button class="danger nb-loss nbl" data-a="x">${LOSTLAB()}</button><button class="pri nbr" data-a="w">✓ Complete</button>${canSkip?'<button class="un-b nbr" data-a="u" title="Banned or picked? Skip to the next available champion for now">Picked / Banned</button>':""}</div>`
      :`<div class="nbg"><button class="danger nb-loss nbl" data-a="l" title="Log a loss (adds an attempt, same as the + button on the champion's card)">✗ Loss</button><button class="pri nbr" data-a="w">✓ Complete</button><span class="nat nbl">${att} attempt${att===1?"":"s"}</span>${canSkip?'<button class="un-b nbr" data-a="u" title="Banned or picked? Skip to the next available champion for now">Picked / Banned</button>':""}</div>`}</div></div>
    ${warn}
    <div class="nxb">${panel}${R?'<div class="nxm full">Random pick. It isn’t part of any challenge, so your lists and progress are untouched.</div>':""}</div>`;
}
// Nuzlocke: Now playing shows a win / died pair instead of Complete / Loss, and a summary box when no champion is open.
function nzButtons(cur){const w=nzWins(cur.name);
  return `<div class="nbg"><button class="danger nb-loss nbl" data-a="x" title="Lost with ${esc(cur.name)}: this champion dies for good">☠ Died</button><button class="pri nbr" data-a="w">✓ Win</button><span class="nat nbl">${w} win${w===1?"":"s"}</span><button class="un-b nbr" data-a="bf" title="Close this and pick another champion">Choose another</button></div>`;}
function nzBox(){
  const c=nzCount(), plural=n=>n+" win"+(n===1?"":"s");
  if(!c.total) return `<div class="nxh"><div><b>${role.startsWith("class:")?"Loading class data…":"This list is empty"}</b></div></div>`;
  if(!c.alive){
    let best=null; for(const x of CHAMPS){const w=nzWins(x.name); if(w&&(!best||w>best.w)) best={n:x.name,w}}
    return `<div class="nxh"><div><div class="nxk">NUZLOCKE</div><div class="nxn"><b>Run complete ☠</b></div><div class="nxm">Every champion has fallen: ${plural(c.wins)} in total${best?", best was "+esc(best.n)+" with "+plural(best.w):""}. Use Reset to start a new run on this list.</div></div></div>`;
  }
  return `<div class="nxh"><div><div class="nxk">NUZLOCKE</div><div class="nxn"><b>${READONLY?"Run in progress":"Pick your champion"}</b></div><div class="nxm">${READONLY?"":"Click any living champion below to play it. "}${c.alive} alive · ${c.dead} fallen · ${plural(c.wins)}</div></div></div>`;
}
const rollButtons=()=>`<div class="nbg"><button class="pri nbr" data-a="rr">Roll again</button><button class="un-b nbr" data-a="rb">Back to my lists</button></div>`;
// The side rune panel is absolutely positioned, so make sure the build area is always at least as tall as it is (the banner grows instead of the runes spilling out).
function fitRunes(){
  const b=document.querySelector("#next .nxb"), r=b&&b.querySelector(".rp.side"), g=r&&r.querySelector(".rpg"); if(!b) return;
  b.style.minHeight="";
  if(r&&g&&getComputedStyle(r).position==="absolute"){const cs=getComputedStyle(r);
    b.style.minHeight=Math.ceil(r.offsetTop+g.offsetHeight+parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom)+parseFloat(cs.borderTopWidth)+parseFloat(cs.borderBottomWidth))+"px";}
}
function renderNext(){ renderNext0(); fitRunes(); }
function renderNext0(){
  if(view==="roll"&&ROLLED){ $("next").innerHTML=nextBox({name:ROLLED.name},false,{},0,0,{role:ROLLED.role}); return; }
  const L=ordered(), hc=isLock(), m=meta(), won=L.filter(c=>get(c.name).won).length, total=L.length, cur=availNext(L);
  if(isNuz()){ $("next").innerHTML=cur?nextBox(cur,hc,m,won,total):nzBox(); return; }
  $("next").innerHTML=cur?nextBox(cur,hc,m,won,total)
    :`<div class="nxh"><div><b>${total?"A–Z complete 🎉":role.startsWith("class:")?"Loading class data…":"This list is empty"}</b></div></div>`;
}
