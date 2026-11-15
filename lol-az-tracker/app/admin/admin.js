"use strict";
// LoLphabet admin panel. Everything is built with createElement / textContent (names and notes come from users, so nothing is ever
// parsed as HTML), and there are no inline scripts or styles, which the page's Content-Security-Policy forbids.
(()=>{
const root=document.getElementById("root");
const SK="lol-az-session", TK="lol-admin-unlock";
let session=null; try{session=JSON.parse(localStorage.getItem(SK))}catch(e){}
let adminToken=""; try{adminToken=sessionStorage.getItem(TK)||""}catch(e){}
const saveTok=t=>{adminToken=t||""; try{t?sessionStorage.setItem(TK,t):sessionStorage.removeItem(TK)}catch(e){}};
let idleSec=1200, lastOk=Date.now(), timer=null, idleEl=null, pgEl=null, navSeq=0;

const MODES={classic:"Classic",hard:"Hard",hardcore:"Insanity",nuzlocke:"Nuzlocke",randnuz:"Random Nuzlocke"};
const modeOf=k=>{const i=k.indexOf("|");return i<0?"classic":k.slice(i+1)}, NUZ=m=>m==="nuzlocke"||m==="randnuz";
const CLASS_KEYS=["Fighter","Mage","Assassin","Tank","Marksman","Support"].map(c=>"class:"+c);
// Every list the app has (the same set the player sees), for the "show all lists" switch.
function allKeys(prog){
  const custom=(Array.isArray(prog.__lists)?prog.__lists:[]).filter(l=>l&&l.id).map(l=>"c:"+l.id);
  return [...ROLE_KEYS,"all:All champs",...CLASS_KEYS,...Object.keys(BUILTIN).filter(k=>k.includes(":")),...custom];
}
function listLabel(prog,l){ if(l.startsWith("c:")){const c=(Array.isArray(prog.__lists)?prog.__lists:[]).find(x=>x&&"c:"+x.id===l); return c&&c.name||"Custom list"} return l.includes(":")?l.split(":")[1]:l }
const validKey=(key,prog)=>allKeys(prog).includes(key.split("|")[0])&&!!MODES[modeOf(key)];

// ---------- tiny helpers ----------
function h(tag,props,...kids){
  const e=document.createElement(tag);
  if(props) for(const k in props){const v=props[k]; if(v==null||v===false) continue;
    if(k==="class") e.className=v; else if(k==="text") e.textContent=v; else if(k.startsWith("on")) e.addEventListener(k.slice(2),v);
    else if(k==="value") e.value=v; else if(k==="checked") e.checked=!!v; else if(k==="disabled") e.disabled=!!v; else e.setAttribute(k,v===true?"":v)}
  for(const c of kids.flat(2)){ if(c==null||c===false) continue; e.append(c.nodeType?c:document.createTextNode(String(c))) }
  return e;
}
const pad=n=>String(n).padStart(2,"0");
const fmt=t=>{if(!t)return"never";const d=new Date(t);return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+" "+pad(d.getHours())+":"+pad(d.getMinutes())};
const ago=t=>{if(!t)return"never";const s=(Date.now()-t)/1e3; if(s<90)return"just now"; if(s<5400)return Math.round(s/60)+" min ago"; if(s<129600)return Math.round(s/3600)+" h ago"; const d=Math.round(s/86400); return d<60?d+" days ago":Math.round(d/30)+" months ago"};
const bytes=b=>b<1024?b+" B":b<1048576?(b/1024).toFixed(1)+" KB":(b/1048576).toFixed(1)+" MB";
const isObj=o=>!!o&&typeof o==="object"&&!Array.isArray(o);
const isReal=x=>isObj(x)&&!!(x.won||x.date||x.games>0||x.note||x.wins>0||x.dead);
const copy=t=>{try{navigator.clipboard.writeText(t).then(()=>toast("Copied"),()=>toast("Couldn't copy",true))}catch(e){toast("Couldn't copy",true)}};
function toast(msg,bad){const t=h("div",{class:"toast"+(bad?" bad":""),role:"status",text:msg}); let box=document.getElementById("toasts"); if(!box){box=h("div",{id:"toasts"});document.body.append(box)} box.append(t); setTimeout(()=>t.remove(),bad?6000:3500)}
async function run(btn,fn){ if(btn) btn.disabled=true; try{return await fn()}catch(e){ if(!e.silent) toast(e.message||"Something failed",true) } finally{ if(btn) btn.disabled=false } }

async function api(method,path,body){
  const hd={"X-Admin":"1","Content-Type":"application/json"}; if(session&&session.token) hd.Authorization="Bearer "+session.token; if(adminToken) hd["X-Admin-Token"]=adminToken;
  const r=await fetch("/api/admin/"+path,{method,headers:hd,body:body===undefined?undefined:JSON.stringify(body),cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer"});
  const j=await r.json().catch(()=>({}));
  if(r.status===423){saveTok(""); showLock("Locked. Enter the passphrase again."); throw Object.assign(new Error("locked"),{status:423,silent:true})}
  if(!r.ok) throw Object.assign(new Error(j.error||("Error "+r.status)),{status:r.status,code:j.code});
  lastOk=Date.now(); return j;
}

// ---------- dialogs ----------
function modal(title,build,wide){
  return new Promise(resolve=>{
    const prev=document.activeElement, ov=h("div",{class:"ov"}), box=h("div",{class:"box"+(wide?" wide":""),role:"dialog","aria-modal":"true","aria-label":title});
    const onKey=e=>{if(e.key==="Escape")close(null)};
    const close=v=>{document.removeEventListener("keydown",onKey);ov.remove();if(prev&&prev.focus)prev.focus();resolve(v)};
    document.addEventListener("keydown",onKey); ov.addEventListener("mousedown",e=>{if(e.target===ov)close(null)});
    box.append(h("h2",{text:title})); build(box,close); ov.append(box); document.body.append(ov);
    const f=box.querySelector("input:not([readonly]),textarea,select,button"); if(f) f.focus();
  });
}
function confirmBox(title,text,label,o={}){
  return modal(title,(box,close)=>{
    box.append(h("p",{text}));
    let inp=null; if(o.typed){inp=h("input",{type:"text",placeholder:o.typed,autocomplete:"off"}); box.append(h("p",{class:"small muted",text:'Type "'+o.typed+'" to confirm.'}),inp)}
    const ok=h("button",{class:"btn "+(o.danger?"danger":"pri"),text:label,disabled:!!o.typed,onclick:()=>close(true)});
    if(inp) inp.addEventListener("input",()=>{ok.disabled=inp.value!==o.typed});
    box.append(h("div",{class:"row end mt"},h("button",{class:"btn",text:"Cancel",onclick:()=>close(null)}),ok));
  });
}
function promptBox(title,label,value,o={}){
  return modal(title,(box,close)=>{
    const inp=h("input",{type:"text",value:value||"",maxlength:o.max||60,autocomplete:"off"});
    inp.addEventListener("keydown",e=>{if(e.key==="Enter")close(inp.value.trim())});
    box.append(h("label",{class:"fld"},h("span",{text:label}),inp),o.help?h("p",{class:"small muted",text:o.help}):document.createComment(""),
      h("div",{class:"row end mt"},h("button",{class:"btn",text:"Cancel",onclick:()=>close(null)}),h("button",{class:"btn pri",text:"Save",onclick:()=>close(inp.value.trim())})));
  });
}
function showLink(title,link,note){
  return modal(title,(box,close)=>{
    const inp=h("input",{type:"text",value:link,readonly:true,class:"mono"}); inp.addEventListener("focus",()=>inp.select());
    box.append(h("p",{text:note}),inp,h("div",{class:"row end mt"},h("button",{class:"btn",text:"Copy",onclick:()=>copy(link)}),h("button",{class:"btn pri",text:"Done",onclick:()=>close(true)})));
  });
}

// ---------- champion icons (Data Dragon) ----------
let DD=null, ROLES=null;
// A list's champions, worked out the same way the app does it (data.js is the app's own file). null = can't tell yet.
const cmpN=(a,b)=>a.localeCompare(b,"en",{sensitivity:"base"});
function members(key,prog){
  const l=key.split("|")[0], names=a=>a.map(c=>c.name), uniq=a=>a&&[...new Set(a)];
  if(ROLE_KEYS.includes(l)){ if(ROLES===null) return null; const a=ROLES[l]; return uniq(a&&a.length?a:names(BUILTIN[l]||[])) }
  if(l.startsWith("class:")){ if(!DD||!DD.tags) return null; return Object.keys(DD.tags).filter(n=>DD.tags[n].includes(l.slice(6))) }
  if(l.startsWith("c:")){ const c=(Array.isArray(prog.__lists)?prog.__lists:[]).find(x=>x&&"c:"+x.id===l); return c&&Array.isArray(c.champs)?uniq(c.champs):null }
  if(l.startsWith("all:")){ if(!DD||!DD.tags||ROLES===null) return null;
    const set=new Set(ROSTER.split(",")); for(const r in BUILTIN) BUILTIN[r].forEach(c=>set.add(c.name)); Object.keys(DD.ids).forEach(n=>set.add(n));
    for(const r in ROLES) (ROLES[r]||[]).forEach(n=>set.add(n)); (Array.isArray(prog.__lists)?prog.__lists:[]).forEach(x=>x&&(x.champs||[]).forEach(n=>set.add(n))); return [...set] }
  if(BUILTIN[l]) return names(BUILTIN[l]);
  return null;
}
function loadDD(){
  fetch("/api/roles").then(r=>r.ok?r.json():null).then(d=>{ROLES=d&&d.lists?d.lists:{}; if(S.tab==="progress"&&S.d) renderDetail()}).catch(()=>{ROLES={}});
  if(DD) return; DD={ver:"",ids:{}};
  fetch("https://ddragon.leagueoflegends.com/api/versions.json").then(r=>r.json()).then(v=>fetch("https://ddragon.leagueoflegends.com/cdn/"+v[0]+"/data/en_US/champion.json").then(r=>r.json()).then(d=>{
    const ids={},tags={}; for(const k in d.data){ids[d.data[k].name]=d.data[k].id; tags[d.data[k].name]=d.data[k].tags||[]} DD={ver:v[0],ids,tags}; if(S.tab==="progress"&&S.d) renderDetail();
  })).catch(()=>{});
}
const iconUrl=n=>DD&&DD.ver&&DD.ids[n]?"https://ddragon.leagueoflegends.com/cdn/"+DD.ver+"/img/champion/"+DD.ids[n]+".png":"";

// ---------- screens: not found / lock / shell ----------
function notFound(){
  clearInterval(timer); document.body.className="nf"; document.title="Page not found | LoLphabet";
  root.replaceChildren(h("p",{},h("a",{href:"/",text:"\u2190 LoLphabet"})),h("h1",{text:"Page not found"}),h("small",{text:"Last updated: November 2026"}),
    h("p",{},"That page does not exist. ",h("a",{href:"/",text:"Go to the LoLphabet A-Z Challenge tracker"}),"."));
}
function showLock(msg){
  clearInterval(timer); document.body.className="app"; document.title="Admin | LoLphabet";
  const inp=h("input",{type:"password",placeholder:"Passphrase",autocomplete:"off","aria-label":"Admin passphrase"}), err=h("p",{class:"bad small",role:"alert",text:msg||""});
  const go=async()=>{ if(!inp.value) return; await run(btn,async()=>{ try{ const r=await api("POST","unlock",{passphrase:inp.value}); inp.value=""; saveTok(r.token); idleSec=r.idleSeconds||1200; lastOk=Date.now(); startApp() }catch(e){ if(e.silent) return; err.textContent=e.message; inp.value=""; inp.focus() } }) };
  const btn=h("button",{class:"btn pri",text:"Unlock",onclick:go}); inp.addEventListener("keydown",e=>{if(e.key==="Enter")go()});
  root.replaceChildren(h("div",{class:"lock card"},h("h2",{text:"Admin"}),h("p",{class:"muted",text:"Enter the admin passphrase."}),inp,err,btn));
  inp.focus();
}
function lockNow(msg){ api("POST","lock").catch(()=>{}).finally(()=>{saveTok(""); showLock(typeof msg==="string"?msg:"")}) }
// One click: lock the panel (the server forgets the unlock token), then go back to the main site.
function exitAdmin(){ api("POST","lock").catch(()=>{}).finally(()=>{saveTok(""); location.assign("/")}) }
function tick(){
  if(!idleEl) return; const left=Math.max(0,idleSec-(Date.now()-lastOk)/1e3);
  idleEl.firstChild.textContent=pad(Math.floor(left/60))+":"+pad(Math.floor(left%60)); idleEl.lastChild.firstChild.style.width=Math.min(100,left/idleSec*100)+"%"; idleEl.classList.toggle("low",left<120);
  if(left<=0) lockNow("Locked after being idle.");
}

const S={showAll:false,view:"dash",users:[],total:0,q:"",filter:"all",sort:"played",sel:null,d:null,tab:"overview",prog:null,pkey:"",pq:"",merge:{},hist:null};
const VIEWS=[["dash","Dashboard"],["users","Users"],["dupes","Duplicates"],["audit","Audit log"],["recovery","Recovery"]];
function startApp(){
  document.body.className="app"; document.title="Admin | LoLphabet"; loadDD();
  const nav=h("nav",{class:"nav","aria-label":"Sections"},VIEWS.map(([id,t])=>h("button",{"data-v":id,class:S.view===id?"on":"",text:t,onclick:()=>setView(id)})));
  idleEl=h("div",{class:"idle",title:"The panel locks itself after this much quiet time"},h("span",{text:"--:--"}),h("i",{},h("b")));
  pgEl=h("main",{class:"pg"});
  root.replaceChildren(h("header",{class:"top"},h("div",{class:"brand"},"LoLphabet ",h("span",{text:"Admin"})),nav,h("div",{class:"grow"}),idleEl,
    h("button",{class:"btn sm",text:"Lock and exit",title:"Lock the admin panel and go back to the site",onclick:e=>{e.target.disabled=true;exitAdmin()}})),pgEl);
  clearInterval(timer); timer=setInterval(tick,1000); tick(); setView(S.view);
}
function setView(v){
  S.view=v; const my=++navSeq;
  for(const b of document.querySelectorAll(".nav button")) b.classList.toggle("on",b.dataset.v===v);
  pgEl.replaceChildren(h("p",{class:"muted",text:"Loading\u2026"}));
  const f={dash:dashView,users:usersView,dupes:dupesView,audit:auditView,recovery:recoveryView}[v];
  Promise.resolve().then(()=>f(my)).catch(e=>{if(!e.silent&&my===navSeq) pgEl.replaceChildren(h("p",{class:"bad",text:e.message}))});
}

// ---------- dashboard ----------
function openUsers(filter,sort){ S.filter=filter||"all"; S.sort=sort||"played"; S.q=""; S.sel=null; S.d=null; setView("users") }
async function dashView(my){
  const o=await api("GET","overview"); if(my!==navSeq) return;
  const pct=n=>o.users?Math.round(n/o.users*100):0, go=(n,f,so)=>n>0?()=>openUsers(f,so):null;
  const up=o.uptime>86400?Math.round(o.uptime/86400)+" days":o.uptime>3600?Math.round(o.uptime/3600)+" hours":Math.round(o.uptime/60)+" minutes";
  const big=(value,label,sub,on)=>h(on?"button":"div",{class:"bigstat",onclick:on},h("b",{text:String(value)}),h("span",{text:label}),h("small",{text:sub||"\u00a0"}));
  const line=(label,value,on)=>h(on?"button":"div",{class:"line",onclick:on},h("span",{text:label}),h("b",{text:String(value)}),on?h("i",{"aria-hidden":"true",text:"\u203a"}):null);
  const meth=(label,n,f)=>h(n>0?"button":"div",{class:"meth",onclick:n>0?()=>openUsers(f):null},h("div",{class:"t"},h("span",{text:label}),h("b",{text:String(n)}),h("small",{text:pct(n)+"%"})),h("div",{class:"bar"},h("b")));
  const mw=[meth("Google",o.google,"google"),meth("Discord",o.discord,"discord"),meth("Username and password",o.password,"password"),meth("Email only (magic link)",o.emailOnly,"emailonly")];
  mw.forEach((el,i)=>{el.querySelector(".bar b").style.width=pct([o.google,o.discord,o.password,o.emailOnly][i])+"%"});
  const attn=[];
  if(o.noLogin) attn.push(h("div",{class:"note warn"},o.noLogin+" account"+(o.noLogin===1?" has":"s have")+" no working sign-in method right now (for example because a login type is switched off): ",
    o.noLoginList.map(x=>h("button",{class:"btn sm quiet",text:x.name||x.id,onclick:()=>navTo(x.id)}))));
  if(o.dupGroups) attn.push(h("div",{class:"note warn"},o.dupGroups+" possible duplicate group"+(o.dupGroups===1?"":"s")+". ",h("button",{class:"btn sm",text:"Review",onclick:()=>setView("dupes")})));
  const orph=o.orphan.shares+o.orphan.templates+o.orphan.sessions+o.orphan.meta;
  pgEl.replaceChildren(
    attn.length?h("div",{class:"card mb"},h("h2",{text:"Needs attention"}),attn):h("div",{class:"status"},h("span",{class:"dot"}),"All good. Nothing needs your attention."),
    h("div",{class:"bigs"},
      big(o.users,"Accounts","signed up so far",go(o.users,"all")),
      big(o.active7,"Active this week",pct(o.active7)+"% of accounts",go(o.active7,"active7","login")),
      big(o.new30,"New this month",o.new7+" in the last 7 days"+(o.activeUnknown?" \u00b7 "+o.activeUnknown+" older accounts aren't dated":""),go(o.new30,"new30","new"))),
    h("div",{class:"dash"},
      h("div",{class:"card"},h("h2",{text:"How people sign in"}),mw,h("p",{class:"small muted",text:"Accounts can use more than one method, so these overlap."})),
      h("div",{class:"card"},h("h2",{text:"Usage and sharing"}),
        line("Signed-in devices",o.sessions),line("Progress share links",o.shares,go(o.shares,"shared")),line("Shared custom lists",o.templates),
        line("Visitors, all time",o.visits),line("Suspended accounts",o.suspended,go(o.suspended,"suspended"))),
      h("div",{class:"card"},h("h2",{text:"Server"}),
        line("Database",bytes(o.dataBytes)),line("Uptime",up),line("Emails sent today",o.mail.n),line("Login types on",o.login.length?o.login.join(", "):"none"),
        line("Panel locks after",Math.round(o.idleSeconds/60)+" min idle"),line("Node",o.node),
        orph?h("p",{class:"small muted",text:"Leftover records from deleted or merged accounts (harmless): "+o.orphan.shares+" share links, "+o.orphan.templates+" shared lists, "+o.orphan.sessions+" sessions, "+o.orphan.meta+" admin notes."}):null)));
}
function navTo(id){ S.view="users"; S.sel=null; S.d=null; for(const b of document.querySelectorAll(".nav button")) b.classList.toggle("on",b.dataset.v==="users"); S.q=id; pgEl.replaceChildren(); usersView(++navSeq).then(()=>selectUser(id)) }

// ---------- users: list ----------
let listEl=null, detailEl=null, moreBtn=null, countEl=null;
async function loadUsers(append){
  const off=append?S.users.length:0;
  const r=await api("GET","users?"+new URLSearchParams({q:S.q,filter:S.filter,sort:S.sort,offset:off,limit:50}));
  S.users=append?S.users.concat(r.users):r.users; S.total=r.total; renderList();
}
const provTags=x=>[x.p.google&&h("span",{class:"tag g",title:"Google",text:"G"}),x.p.discord&&h("span",{class:"tag d",title:"Discord",text:"D"}),x.p.password&&h("span",{class:"tag p",title:"Username and password",text:"PW"}),x.p.email&&h("span",{class:"tag e",title:"Has an email address",text:"@"})];
function renderList(){
  if(!listEl) return;
  listEl.replaceChildren(...(S.users.length?S.users.map(x=>h("button",{class:"u"+(S.sel===x.id?" on":""),onclick:()=>selectUser(x.id)},
    h("div",{class:"row"},h("b",{class:"grow",text:x.name||"(no name)"}),x.admin?h("span",{class:"tag gold",text:"admin"}):null,x.suspended?h("span",{class:"tag red",text:"suspended"}):null),
    h("div",{class:"sub"},provTags(x)," ",x.wins+" wins \u00b7 played "+ago(x.last)))):[h("div",{class:"empty",text:"No accounts match."})]));
  countEl.textContent=S.users.length+" of "+S.total; moreBtn.hidden=S.users.length>=S.total;
}
async function usersView(my){
  const q=h("input",{type:"search",placeholder:"Search name, email, username, IDs\u2026","aria-label":"Search accounts",value:S.q});
  let t; q.addEventListener("input",()=>{clearTimeout(t); t=setTimeout(()=>{S.q=q.value.trim(); run(null,()=>loadUsers(false))},250)});
  const filt=h("select",{"aria-label":"Filter"},[["all","All accounts"],["google","Has Google"],["discord","Has Discord"],["password","Has a password"],["emailonly","Email only"],["empty","No wins yet"],["suspended","Suspended"],["nologin","No working login"],["dupes","Possible duplicates"],["admin","Admin"],["new7","New in 7 days"],["new30","New in 30 days"],["active7","Active in 7 days"],["shared","Has a share link"]].map(([v,l])=>h("option",{value:v,text:l,selected:S.filter===v})));
  const sort=h("select",{"aria-label":"Sort"},[["played","Last played"],["login","Last sign-in"],["new","Newest"],["name","Name"],["wins","Most wins"]].map(([v,l])=>h("option",{value:v,text:l,selected:S.sort===v})));
  filt.addEventListener("change",()=>{S.filter=filt.value;run(null,()=>loadUsers(false))}); sort.addEventListener("change",()=>{S.sort=sort.value;run(null,()=>loadUsers(false))});
  listEl=h("div",{class:"items"}); countEl=h("span",{class:"small muted"}); moreBtn=h("button",{class:"btn sm",text:"Load more",hidden:true,onclick:e=>run(e.target,()=>loadUsers(true))});
  detailEl=h("div");
  pgEl.replaceChildren(h("div",{class:"split"},h("div",{class:"card list"},h("div",{class:"tools"},q,h("div",{class:"row"},filt,sort),h("div",{class:"row"},countEl,h("div",{class:"grow"}),moreBtn)),listEl),detailEl));
  await loadUsers(false); if(my!==navSeq) return; renderDetail();
}
async function selectUser(id){
  S.sel=id; S.prog=null; S.pkey=""; S.hist=null; if(S.merge.target!==id) S.merge={}; renderList();
  detailEl.replaceChildren(h("p",{class:"muted",text:"Loading\u2026"}));
  try{ S.d=await api("GET","users/"+encodeURIComponent(id)); }catch(e){ if(!e.silent) toast(e.message,true); S.sel=null; S.d=null; renderList() }
  renderDetail();
}
function patchRow(d){ const i=S.users.findIndex(x=>x.id===d.id); if(i>=0) S.users[i]=Object.assign({},S.users[i],d); renderList() }
async function act(path,body,msg){
  const r=await api("POST","users/"+encodeURIComponent(S.sel)+"/"+path,body);
  if(r.deleted){ toast(msg||"Done"); S.sel=null; S.d=null; await loadUsers(false); renderDetail(); return r }
  if(r.user){ S.d=r.user; patchRow(r.user) }
  if(S.tab==="progress"&&S.prog) await loadProgress();
  toast(msg||"Saved"); renderDetail(); return r;
}

// ---------- users: detail ----------
const TABS=[["overview","Overview"],["logins","Logins & merge"],["progress","Progress"],["sessions","Sessions & sharing"],["actions","Security & account"],["history","History"]];
function renderDetail(){
  if(!detailEl) return;
  const d=S.d;
  if(!d){ detailEl.replaceChildren(h("div",{class:"card empty",text:"Pick an account on the left."})); return }
  const tabs=h("div",{class:"tabs",role:"tablist"},TABS.map(([id,t])=>h("button",{role:"tab","aria-selected":S.tab===id?"true":"false",class:S.tab===id?"on":"",text:t,onclick:()=>{S.tab=id;renderDetail()}})));
  const body={overview:tOverview,logins:tLogins,progress:tProgress,sessions:tSessions,actions:tActions,history:tHistory}[S.tab](d);
  detailEl.replaceChildren(h("div",{class:"card"},
    h("div",{class:"row"},h("h2",{class:"grow",text:d.name||"(no name)"}),d.admin?h("span",{class:"tag gold",text:"admin"}):null,d.suspended?h("span",{class:"tag red",text:"suspended"}):null,provTags(d)),
    h("div",{class:"mono muted",text:d.id}),tabs,body));
}
const kv=(k,v,a)=>[h("div",{class:"k",text:k}),h("div",{class:"grow"},v),h("div",{class:"act"},a||null)];

function tOverview(d){
  const note=h("textarea",{maxlength:2000,placeholder:"Private note about this account (only you can see it)"}); note.value=d.note||"";
  return h("div",{},
    h("div",{class:"kv"},
      kv("Display name",d.name||"-",h("button",{class:"btn sm",text:"Edit",onclick:async()=>{const v=await promptBox("Display name","New display name",d.name,{max:40}); if(v) run(null,()=>act("rename",{name:v},"Name changed"))}})),
      kv("Username",d.handle||(d.hasPassword?"-":"no password login"),d.hasPassword?h("button",{class:"btn sm",text:"Edit",onclick:async()=>{const v=await promptBox("Username","New username",d.handle,{max:30,help:"3 to 30 characters: letters, numbers, spaces, dots, dashes, underscores."}); if(v) run(null,()=>act("handle",{handle:v},"Username changed"))}}):null),
      kv("Email",d.email||"-",h("button",{class:"btn sm",text:d.email?"Edit":"Add",onclick:async()=>{const v=await promptBox("Email address","Email",d.email,{max:200}); if(v) run(null,()=>act("email",{email:v},"Email saved"))}})),
      kv("User ID",h("span",{class:"mono",text:d.id}),h("button",{class:"btn sm quiet",text:"Copy",onclick:()=>copy(d.id)})),
      kv("Google",d.google?h("span",{},d.google.email||"(no email)"," ",h("span",{class:"mono muted",text:d.google.id})):"not linked"),
      kv("Discord",d.discord?h("span",{},d.discord.name," ",h("span",{class:"mono muted",text:d.discord.id})):"not linked"),
      kv("Password login",d.hasPassword?"yes":"no"),
      kv("Can sign in with",d.usable.length?d.usable.map(x=>({google:"Google",discord:"Discord",password:"password",magic:"magic link"}[x])).join(", "):h("span",{class:"bad",text:"nothing (locked out)"})),
      kv("Account created",d.created?fmt(d.created)+" ("+ago(d.created)+")":"before sign-up dates were recorded"),
      kv("Last sign-in",d.lastLogin?fmt(d.lastLogin)+" ("+ago(d.lastLogin)+")":"unknown"),
      kv("Last played",d.last?fmt(d.last)+" ("+ago(d.last)+")":"never"),
      kv("Wins / lists started",d.wins+" wins across "+d.lists+" list"+(d.lists===1?"":"s")),
      kv("Signed-in devices",String(d.sessions)),
      kv("Progress share link",d.shareToken?"on"+(d.shareDesc?" ("+d.shareDesc+")":""):"off")),
    h("h3",{text:"Private note"}),note,
    h("div",{class:"row end mt"},h("button",{class:"btn",text:"Save note",onclick:e=>run(e.target,()=>act("note",{note:note.value},"Note saved"))})));
}

// ----- logins & merge -----
function loginRow(label,val,kind,d){
  const b=h("button",{class:"btn sm",text:"Unlink",onclick:async e=>{
    const first=await confirmBox("Unlink "+label,"Remove the "+label+" login from "+(d.name||"this account")+"? Their progress stays. They will be signed out of all devices.","Unlink",{danger:true}); if(!first) return;
    await run(e.target,async()=>{ try{ await act("unlink",{kind},label+" unlinked") }catch(err){
      if(err.code==="last"){ if(await confirmBox("Lock them out?","This is the account's only way to sign in. If you unlink it nobody can sign in to this account until you link a login through a merge.","Unlink anyway",{danger:true})) await act("unlink",{kind,force:true},label+" unlinked"); }
      else throw err } }) }});
  return kv(label,val,b);
}
function tLogins(d){
  const rows=[
    d.google?loginRow("Google",h("span",{},d.google.email||"(no email)"," ",h("span",{class:"mono muted",text:d.google.id})),"google",d):kv("Google",h("span",{class:"muted",text:"not linked"})),
    d.discord?loginRow("Discord",h("span",{},d.discord.name," ",h("span",{class:"mono muted",text:d.discord.id})),"discord",d):kv("Discord",h("span",{class:"muted",text:"not linked"})),
    d.hasPassword?loginRow("Password",h("span",{},d.handle?"username "+d.handle:"no username"),"password",d):kv("Password",h("span",{class:"muted",text:"not set"})),
    d.email?loginRow("Email",h("span",{},d.email," ",h("span",{class:"muted small",text:"(magic links and password resets go here)"})),"email",d):kv("Email",h("span",{class:"muted",text:"none"}))];
  return h("div",{},h("div",{class:"kv"},rows),mergeBox(d));
}
function mergeBox(d){
  const M=S.merge, wrap=h("div",{},h("h3",{text:"Merge two accounts"}),
    h("p",{class:"muted",text:"For when someone signed up twice, say with Discord and again with Google. Merging folds one account into the other so both logins open the same progress."}));
  const q=h("input",{type:"search",placeholder:"Find the other account by name, email or ID\u2026","aria-label":"Find other account"}), res=h("div",{class:"mt"});
  let t; q.addEventListener("input",()=>{clearTimeout(t); t=setTimeout(async()=>{ const v=q.value.trim(); if(v.length<2){res.replaceChildren();return}
    await run(null,async()=>{ const r=await api("GET","users?"+new URLSearchParams({q:v,limit:8})); res.replaceChildren(...r.users.filter(x=>x.id!==d.id).map(x=>h("button",{class:"u",onclick:()=>{S.merge={target:d.id,other:x.id,flip:false,strat:"combine"};renderDetail()}},h("b",{text:x.name||"(no name)"})," ",provTags(x),h("div",{class:"sub",text:(x.email||x.discordName||x.id)+" \u00b7 "+x.wins+" wins"})))) }) },250)});
  wrap.append(q,res);
  if(M.other&&M.target===d.id){
    const prev=h("div",{class:"mt"},h("p",{class:"muted",text:"Loading preview\u2026"})); wrap.append(prev);
    const tid=M.flip?M.other:d.id, sid=M.flip?d.id:M.other;
    api("GET","merge-preview?"+new URLSearchParams({target:tid,source:sid})).then(p=>{
      const col=(x,title)=>h("div",{class:"card"},h("div",{class:"muted small",text:title}),h("b",{text:x.name||"(no name)"})," ",provTags(x),h("div",{class:"mono muted",text:x.id}),
        h("div",{class:"small mt",text:x.wins+" wins \u00b7 "+x.lists+" lists \u00b7 played "+ago(x.last)}),h("div",{class:"small muted",text:x.email||x.discordName||""}));
      const strat=M.strat||"combine", rad=(v,l,sub)=>h("label",{class:"opt"},h("input",{type:"radio",name:"strat",value:v,checked:strat===v,onchange:()=>{M.strat=v}})," ",h("b",{text:l}),h("div",{class:"small muted",text:sub}));
      const go=h("button",{class:"btn pri",text:"Merge",disabled:p.block.length>0,onclick:async e=>{
        if(!await confirmBox("Merge accounts","\""+(p.source.name||p.source.id)+"\" will be folded into \""+(p.target.name||p.target.id)+"\" and then deleted. Both logins will open the surviving account. A backup of both is saved first.","Merge",{danger:true})) return;
        await run(e.target,async()=>{ const r=await api("POST","merge",{target:tid,source:sid,strategy:M.strat||"combine"}); toast("Accounts merged"); S.merge={}; await loadUsers(false); await selectUser(r.id) }) }});
      prev.replaceChildren(h("div",{class:"cols"},col(p.target,"Kept"),col(p.source,"Folded in, then deleted")),
        h("div",{class:"row mt"},h("button",{class:"btn sm",text:"\u21c5 Swap which one is kept",onclick:()=>{M.flip=!M.flip;renderDetail()}}),h("button",{class:"btn sm quiet",text:"Cancel",onclick:()=>{S.merge={};renderDetail()}})),
        p.block.map(x=>h("div",{class:"note bad",text:x})),p.warn.map(x=>h("div",{class:"note warn",text:x})),
        h("h3",{text:"What happens to progress"}),
        rad("combine","Combine, best of both","A champion counts as won or fallen if it is on either account, with the earlier date and the higher counts. Custom lists from both are kept."),
        rad("target","Keep only the kept account's progress","The folded-in account's progress is dropped."),
        rad("source","Keep only the folded-in account's progress","The kept account's progress is replaced by it."),
        h("div",{class:"row end mt"},go));
    }).catch(e=>prev.replaceChildren(h("p",{class:"bad",text:e.message})));
  }
  return wrap;
}

// ----- progress -----
async function loadProgress(){
  S.prog=await api("GET","users/"+encodeURIComponent(S.sel)+"/progress");
  if(!(S.prog.keys.some(k=>k.key===S.pkey)||(S.showAll&&validKey(S.pkey,S.prog.data)))) S.pkey=(S.prog.keys[0]||{}).key||"";
}
function champDialog(key,champ,entry){
  const nz=NUZ(modeOf(key)), s=entry||{};
  return modal("Edit "+champ,(box,close)=>{
    box.append(h("p",{class:"muted small",text:key+" \u00b7 "+MODES[modeOf(key)]}));
    const note=h("textarea",{maxlength:1000}); note.value=s.note||"";
    let get;
    if(nz){
      const wins=h("input",{type:"number",min:0,max:9999,value:String(s.wins|0)}), dead=h("input",{type:"checkbox",checked:!!s.dead}), when=h("input",{type:"date",value:s.diedOn||""});
      box.append(h("label",{class:"fld"},h("span",{text:"Wins"}),wins),h("label",{class:"ck"},dead," Fallen (lost with this champion)"),h("label",{class:"fld"},h("span",{text:"Fell on"}),when));
      get=()=>({wins:parseInt(wins.value,10)||0,dead:dead.checked,diedOn:dead.checked?(when.value||null):null,note:note.value});
    }else{
      const won=h("input",{type:"checkbox",checked:!!s.won}), when=h("input",{type:"date",value:s.date||""}), games=h("input",{type:"number",min:0,max:9999,value:String(s.games|0)});
      box.append(h("label",{class:"ck"},won," Won with this champion"),h("label",{class:"fld"},h("span",{text:"Won on (blank = today)"}),when),h("label",{class:"fld"},h("span",{text:"Games played"}),games));
      get=()=>({won:won.checked,date:won.checked?(when.value||null):null,games:parseInt(games.value,10)||0,note:note.value});
    }
    box.append(h("label",{class:"fld"},h("span",{text:"Note"}),note),
      h("div",{class:"row mt"},entry?h("button",{class:"btn danger",text:"Remove entry",onclick:()=>close({remove:true})}):null,h("div",{class:"grow"}),h("button",{class:"btn",text:"Cancel",onclick:()=>close(null)}),h("button",{class:"btn pri",text:"Save",onclick:()=>close({set:get()})})));
  });
}
async function editChamp(key,champ,entry){
  const r=await champDialog(key,champ,entry); if(!r) return;
  await run(null,()=>act("champ",r.remove?{key,champ,remove:true}:{key,champ,set:r.set},r.remove?champ+" entry removed":champ+" saved"));
}
function tProgress(d){
  const wrap=h("div");
  if(!S.prog){ wrap.append(h("p",{class:"muted",text:"Loading\u2026"})); loadProgress().then(renderDetail).catch(e=>{if(!e.silent)toast(e.message,true)}); return wrap }
  const keys=S.prog.keys, data=S.prog.data;
  const tally=(k,sum)=>{ const m=members(k,data), t=m?" / "+m.length:"", run=isObj(data[k])?data[k]:{}, on=m?m:Object.keys(run);
    let won=0,dead=0,wins=0; for(const n of on){ const e=run[n]; if(!isObj(e)) continue; if(e.won) won++; if(e.dead) dead++; wins+=(e.wins|0) }   // only champions that are on the list
    return NUZ(modeOf(k))?dead+t+" fallen, "+wins+" wins":won+t+" won" };
  const sums=new Map(keys.map(k=>[k.key,k]));
  if(S.showAll&&!S.pkey) S.pkey=ROLE_KEYS[0];
  let pick;
  if(!S.showAll) pick=h("select",{"aria-label":"List"},keys.map(k=>h("option",{value:k.key,selected:k.key===S.pkey,text:k.label+" \u00b7 "+MODES[k.mode]+" \u00b7 "+tally(k.key)})));
  else pick=h("select",{"aria-label":"List"},Object.keys(MODES).map(m=>h("optgroup",{label:MODES[m]},allKeys(data).map(l=>{ const k=l+(m==="classic"?"":"|"+m);
    return h("option",{value:k,selected:k===S.pkey,text:listLabel(data,l)+" \u00b7 "+(sums.has(k)?tally(k):"empty")}) }))));
  pick.addEventListener("change",()=>{S.pkey=pick.value;S.pq="";renderDetail()});
  const sw=h("input",{type:"checkbox",role:"switch",checked:S.showAll,"aria-label":"Show all lists"});
  sw.addEventListener("change",()=>{ S.showAll=sw.checked; S.pq=""; if(!S.showAll&&!sums.has(S.pkey)) S.pkey=(keys[0]||{}).key||""; renderDetail() });
  wrap.append(h("div",{class:"row"},pick,h("span",{class:"small muted",text:S.showAll?"Showing every list, including empty ones.":"Only lists with saved progress are shown."}),h("label",{class:"sw small"},sw,h("span",{class:"knob","aria-hidden":"true"})," Show all lists")));
  const key=S.pkey;
  if(!key){ wrap.append(h("p",{class:"empty",text:"No progress saved for this account yet. Turn on 'Show all lists' to open an empty list."})); }
  else{
    const run_=isObj(data[key])?data[key]:{}, nz=NUZ(modeOf(key)), meta=isObj(run_.__meta)?run_.__meta:{}, blank={won:false,date:null,games:0};
    const mem=members(key,data), entryNames=Object.keys(run_).filter(n=>n!=="__meta"&&isObj(run_[n]));
    let main, stale=[];
    if(mem){ const set=new Set(mem); main=[...mem].sort(cmpN); stale=entryNames.filter(n=>!set.has(n)&&isReal(run_[n])).sort(cmpN) }
    else main=entryNames.filter(n=>isReal(run_[n])).sort(cmpN);
    const q=h("input",{type:"search",placeholder:"Filter champions\u2026",value:S.pq,"aria-label":"Filter champions"}), only=h("input",{type:"checkbox",checked:!!S.ponly});
    q.addEventListener("input",()=>{S.pq=q.value;renderRows()}); only.addEventListener("change",()=>{S.ponly=only.checked;renderRows()});
    const tb=h("tbody"), tb2=h("tbody"), staleBox=h("div");
    const rowFor=(n,isStale)=>{ const e=isObj(run_[n])?run_[n]:null, s=e||blank, url=iconUrl(n);
      const state=nz?(s.dead?h("span",{class:"bad",text:"Fallen"+(s.diedOn?" "+s.diedOn:"")}):h("span",{class:"ok",text:"Alive"})):(s.won?h("span",{class:"ok",text:"Won"+(s.date?" "+s.date:"")}):h("span",{class:"muted",text:"Not won"}));
      const quick=isStale?h("button",{class:"btn sm danger",text:"Remove",title:"Delete this stale entry",onclick:e2=>run(e2.target,()=>act("champ",{key,champ:n,remove:true},n+" entry removed"))})
        :nz?(s.dead?h("button",{class:"btn sm",text:"Revive",title:"Undo 'Fallen'",onclick:e2=>run(e2.target,()=>act("champ",{key,champ:n,set:{dead:false}},n+" revived"))}):h("button",{class:"btn sm",text:"Mark fallen",onclick:e2=>run(e2.target,()=>act("champ",{key,champ:n,set:{dead:true}},n+" marked fallen"))}))
        :(s.won?h("button",{class:"btn sm",text:"Undo win",onclick:e2=>run(e2.target,()=>act("champ",{key,champ:n,set:{won:false}},n+" win undone"))}):h("button",{class:"btn sm",text:"Mark won",onclick:e2=>run(e2.target,()=>act("champ",{key,champ:n,set:{won:true}},n+" marked won"))}));
      return h("tr",{},h("td",{},url?h("img",{class:"ic",src:url,alt:"",loading:"lazy",width:28,height:28}):h("span",{class:"ic"})),h("td",{},h("b",{text:n}),s.note?h("div",{class:"small muted",text:s.note.length>80?s.note.slice(0,80)+"\u2026":s.note}):null),
        h("td",{},state),h("td",{class:"small muted",text:nz?(s.wins|0)+" wins":(s.games|0)+" games"}),h("td",{},h("div",{class:"row end"},quick,isStale?null:h("button",{class:"btn sm quiet",text:"Edit",onclick:()=>editChamp(key,n,e)}))))};
    const head=h("thead",{},h("tr",{},h("th",{text:""}),h("th",{text:"Champion"}),h("th",{text:"State"}),h("th",{text:"Count"}),h("th",{})));
    const renderRows=()=>{ const f=S.pq.trim().toLowerCase(), ok=n=>(!f||n.toLowerCase().includes(f))&&(!S.ponly||isReal(run_[n]));
      const shown=main.filter(ok); tb.replaceChildren(...(shown.length?shown.map(n=>rowFor(n,false)):[h("tr",{},h("td",{colspan:5,class:"empty",text:main.length?"No champion matches.":"Nothing recorded on this list yet."}))]));
      const st=stale.filter(ok); staleBox.replaceChildren(...(st.length?[h("h3",{text:"Not on this list in the app"}),h("p",{class:"small muted",text:"These champions have saved progress here but aren't on the list any more (for example the list changed). They don't show up for the player."}),
        h("div",{class:"tw"},h("table",{},head.cloneNode(true),(()=>{tb2.replaceChildren(...st.map(n=>rowFor(n,true)));return tb2})()))]:[])) };
    renderRows();
    if(!mem) wrap.append(h("p",{class:"note",text:"The full champion list for this one isn't available yet, so only champions with progress are shown."}));
    wrap.append(h("div",{class:"row mt"},q,h("label",{class:"ck small"},only," Only with progress"),h("div",{class:"grow"})),
      h("div",{class:"tw mt"},h("table",{},head,tb)),staleBox);
    const mrows=[["Last played",meta.t?fmt(meta.t)+" ("+ago(meta.t)+")":null],["Restarts",meta.resets],["Best run",meta.best],["Setbacks",meta.setbacks],["Last loss",meta.last&&meta.last.champ],["Now playing (focused)",meta.focus],["Dice-rolled (locked)",meta.rolled],["Skipped",Array.isArray(meta.skip)&&meta.skip.length?meta.skip.join(", "):null]].filter(r=>r[1]!=null&&r[1]!=="");
    if(mrows.length) wrap.append(h("h3",{text:"Run details"}),h("div",{class:"kv"},mrows.map(([k,v])=>kv(k,String(v)))));
    const locks=meta.focus||meta.rolled||(Array.isArray(meta.skip)&&meta.skip.length);
    wrap.append(h("div",{class:"row mt"},
      h("button",{class:"btn",text:"Clear locks",disabled:!locks,title:"Un-sticks a dice-rolled or random champion and clears 'now playing' and skips",onclick:async e=>{ if(await confirmBox("Clear locks","Clears the focused, dice-rolled and skipped champions on this list. Wins and losses are untouched.","Clear")) run(e.target,()=>act("list/clear-locks",{key},"Locks cleared")) }}),
      h("button",{class:"btn danger",text:"Reset this list\u2026",disabled:!entryNames.length&&!Object.keys(meta).length,onclick:async()=>{
        const r=await modal("Reset "+key,(box,close)=>{ const kn=h("input",{type:"checkbox",checked:true}); box.append(h("p",{text:"Wipes every win, loss and run detail on this list and mode for "+(d.name||"this account")+". A backup is saved first, so it can be undone from History."}),h("label",{class:"ck"},kn," Keep their notes"),
          h("div",{class:"row end mt"},h("button",{class:"btn",text:"Cancel",onclick:()=>close(null)}),h("button",{class:"btn danger",text:"Reset list",onclick:()=>close({keepNotes:kn.checked})}))) });
        if(r) run(null,()=>act("list/reset",{key,keepNotes:r.keepNotes},"List reset")) }})));
  }
  const raw=h("textarea",{spellcheck:"false",class:"mono"}); raw.value=JSON.stringify(data,null,1); raw.style.minHeight="220px";
  wrap.append(h("h3",{text:"Whole account"}),h("div",{class:"row"},
    h("button",{class:"btn",text:"Download progress (JSON)",onclick:e=>run(e.target,async()=>{ const hd={"X-Admin":"1"}; if(session&&session.token) hd.Authorization="Bearer "+session.token; hd["X-Admin-Token"]=adminToken;
      const r=await fetch("/api/admin/users/"+encodeURIComponent(d.id)+"/export",{headers:hd,cache:"no-store"}); if(!r.ok) throw new Error("Export failed"); const url=URL.createObjectURL(await r.blob());
      const a=h("a",{href:url,download:"lolphabet-"+(d.name||d.id).replace(/[^\w-]+/g,"_")+"-progress.json"}); document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),2000) })}),
    h("button",{class:"btn danger",text:"Reset ALL progress\u2026",onclick:async()=>{
      const r=await modal("Reset all progress",(box,close)=>{ const kl=h("input",{type:"checkbox",checked:true}), t=h("input",{type:"text",placeholder:d.name||d.id,autocomplete:"off"}), ok=h("button",{class:"btn danger",text:"Reset everything",disabled:true,onclick:()=>close({keepLists:kl.checked,confirm:t.value})});
        t.addEventListener("input",()=>{ok.disabled=t.value!==(d.name||d.id)}); box.append(h("p",{text:"Wipes every list and mode for this account. A backup is saved first."}),h("label",{class:"ck"},kl," Keep their custom lists"),h("p",{class:"small muted",text:'Type "'+(d.name||d.id)+'" to confirm.'}),t,h("div",{class:"row end mt"},h("button",{class:"btn",text:"Cancel",onclick:()=>close(null)}),ok)) });
      if(r) run(null,()=>act("progress/reset-all",r,"All progress reset")) }})),
    h("details",{class:"mt"},h("summary",{text:"Advanced: edit the raw JSON"}),h("p",{class:"small muted",text:"This is exactly what is stored for the account. Be careful: a typo can hide progress. A backup is saved first."}),raw,
      h("div",{class:"row end mt"},h("button",{class:"btn",text:"Save raw JSON",onclick:async e=>{ let data2; try{data2=JSON.parse(raw.value)}catch(err){return toast("That isn't valid JSON: "+err.message,true)}
        if(await confirmBox("Replace progress","Replace this account's whole saved progress with what is in the box?","Replace",{danger:true})) run(e.target,()=>act("progress/raw",{data:data2},"Progress replaced")) }}))));
  wrap.append(h("p",{class:"small muted mt",text:"After a fix, their open browser tab reloads the corrected copy the next time it syncs. Any play they do in that stale tab before then is discarded so it can't overwrite your fix."}));
  return wrap;
}

// ----- sessions & sharing -----
function tSessions(d){
  return h("div",{},
    h("h3",{text:"Signed-in devices"}),
    d.sessionList.length?h("div",{class:"tw"},h("table",{},h("thead",{},h("tr",{},h("th",{text:"Signed in"}),h("th",{text:"Expires"}),h("th",{}))),
      h("tbody",{},d.sessionList.map(s=>h("tr",{},h("td",{text:fmt(s.signedIn)+" ("+ago(s.signedIn)+")"}),h("td",{text:fmt(s.exp)}),h("td",{},h("div",{class:"row end"},h("button",{class:"btn sm",text:"Sign out",onclick:e=>run(e.target,()=>act("signout",{session:s.id},"Device signed out"))})))))))):h("p",{class:"muted",text:"No active sessions."}),
    d.sessionList.length?h("div",{class:"row mt"},h("button",{class:"btn",text:"Sign out everywhere",onclick:e=>run(e.target,()=>act("signout",{},"Signed out everywhere"))})):null,
    h("h3",{text:"Progress share link"}),
    d.shareToken?h("div",{},h("div",{class:"mono",text:location.origin+"/s/"+d.shareToken}),h("div",{class:"row mt"},h("button",{class:"btn sm",text:"Copy link",onclick:()=>copy(location.origin+"/s/"+d.shareToken)}),
      h("button",{class:"btn sm danger",text:"Turn off",onclick:async e=>{ if(await confirmBox("Turn off share link","Anyone using the old link will see a not-found page. The user can switch sharing back on in Settings.","Turn off",{danger:true})) run(e.target,()=>act("share",{},"Share link turned off")) }}))):h("p",{class:"muted",text:"Sharing is off."}),
    h("h3",{text:"Shared custom lists"}),
    d.templates.length?h("div",{class:"tw"},h("table",{},h("thead",{},h("tr",{},h("th",{text:"List"}),h("th",{text:"Champions"}),h("th",{text:"Created"}),h("th",{}))),
      h("tbody",{},d.templates.map(t=>h("tr",{},h("td",{},h("b",{text:t.name}),h("div",{class:"mono muted",text:location.origin+"/t/"+t.token})),h("td",{text:String(t.count)}),h("td",{text:t.created?fmt(t.created):"-"}),
        h("td",{},h("div",{class:"row end"},h("button",{class:"btn sm danger",text:"Delete",onclick:async e=>{ if(await confirmBox("Delete shared list","Delete \""+t.name+"\"? Its link stops working.","Delete",{danger:true})) run(e.target,()=>act("template/delete",{token:t.token},"Shared list deleted")) }})))))))):h("p",{class:"muted",text:"No shared lists."}));
}

// ----- security & account -----
function tActions(d){
  const reason=h("input",{type:"text",placeholder:"Reason (only you see it)",maxlength:200,value:d.suspendedReason||"",class:"grow"});
  return h("div",{},
    h("h3",{text:"Password"}),
    !d.config.password?h("p",{class:"note",text:"Password sign-in is switched off in LOGIN_TYPES, so resets are unavailable."}):h("div",{},
      h("p",{class:"muted",text:"Resetting never shows or sets a password. The person picks a new one from a single-use link that works for 30 minutes; every other device is signed out when they do."}),
      h("div",{class:"row"},
        h("button",{class:"btn",text:"Email a reset link",disabled:!d.email,title:d.email?"":"This account has no email address",onclick:async e=>{ if(await confirmBox("Email a reset link","Send a password-reset email to "+d.email+"? This uses one of today's emails.","Send")) run(e.target,async()=>{ const r=await api("POST","users/"+encodeURIComponent(d.id)+"/reset-password",{mode:"email"}); toast("Reset email sent to "+r.sentTo) }) }}),
        h("button",{class:"btn",text:"Create a one-time link\u2026",onclick:e=>run(e.target,async()=>{ const r=await api("POST","users/"+encodeURIComponent(d.id)+"/reset-password",{mode:"link"});
          await showLink("One-time reset link",r.link,"Send this to "+(d.name||"them")+" privately (for example in a Discord DM). Anyone who has it can set a new password for this account, so treat it like a password. It works once and expires in "+r.minutes+" minutes."+(r.warning?" "+r.warning:"")) })}))),
    h("h3",{text:"Suspend"}),
    h("p",{class:"muted",text:d.suspended?"This account is suspended"+(d.suspendedReason?": "+d.suspendedReason:"")+" (since "+fmt(d.suspendedAt)+"). They can't sign in or save anything.":"Blocks sign-in and signs them out everywhere. Their progress is kept. You can undo it any time."}),
    d.admin?h("p",{class:"note",text:"The admin account can't be suspended."}):h("div",{class:"row"},d.suspended?null:reason,
      d.suspended?h("button",{class:"btn",text:"Lift suspension",onclick:e=>run(e.target,()=>act("suspend",{suspended:false},"Suspension lifted"))}):h("button",{class:"btn danger",text:"Suspend account",onclick:async e=>{ if(await confirmBox("Suspend account","Suspend "+(d.name||d.id)+"? They are signed out at once.","Suspend",{danger:true})) run(e.target,()=>act("suspend",{suspended:true,reason:reason.value},"Account suspended")) }})),
    h("div",{class:"zone"},h("h3",{text:"Delete account"}),
      h("p",{class:"muted",text:"Removes the account, its progress, share link and shared lists for good. A full backup is saved first, so it can be brought back from the Recovery tab."}),
      d.admin?h("p",{class:"note",text:"The admin account can't be deleted from here."}):h("button",{class:"btn danger",text:"Delete this account\u2026",onclick:async e=>{ if(await confirmBox("Delete account","Delete "+(d.name||d.id)+" and everything on it?","Delete account",{danger:true,typed:d.name||d.id})) run(e.target,()=>act("delete",{confirm:d.name||d.id},"Account deleted")) }})));
}

// ----- history -----
async function tHistoryLoad(){ const [b,a]=await Promise.all([api("GET","users/"+encodeURIComponent(S.sel)+"/backups"),api("GET","audit?"+new URLSearchParams({target:S.sel,limit:40}))]); S.hist={backups:b.backups,audit:a.entries} }
const auditRows=(rows,showTarget)=>h("div",{class:"tw"},h("table",{},h("thead",{},h("tr",{},h("th",{text:"When"}),h("th",{text:"Action"}),showTarget?h("th",{text:"Account"}):null,h("th",{text:"From"}),h("th",{text:"Details"}))),
  h("tbody",{},rows.length?rows.map(r=>h("tr",{},h("td",{text:fmt(r.t)}),h("td",{},h("span",{class:r.ok?"":"bad",text:r.action+(r.ok?"":" (failed)")})),showTarget?h("td",{class:"mono",text:r.target||""}):null,h("td",{class:"mono",text:r.ip||""}),h("td",{class:"small muted",text:r.detail?JSON.stringify(r.detail):""}))):[h("tr",{},h("td",{colspan:5,class:"empty",text:"Nothing yet."}))])));
function tHistory(d){
  if(!S.hist){ tHistoryLoad().then(renderDetail).catch(e=>{if(!e.silent)toast(e.message,true)}); return h("p",{class:"muted",text:"Loading\u2026"}) }
  const restore=(b,scope)=>async e=>{ const full=scope==="record";
    if(await confirmBox(full?"Restore full account":"Restore progress",(full?"Put the whole account (logins, name, progress) back to how it was ":"Put this account's progress back to how it was ")+fmt(b.ts)+"? The current state is backed up first.","Restore",{danger:true}))
      run(e.target,async()=>{ await api("POST","restore",{uid:d.id,file:b.file,scope}); toast("Restored"); await selectUser(d.id) }) };
  return h("div",{},h("h3",{text:"Backups"}),h("p",{class:"muted small",text:"A copy is taken automatically before every change you make here (the last 40 are kept per account)."}),
    h("div",{class:"tw"},h("table",{},h("thead",{},h("tr",{},h("th",{text:"Taken"}),h("th",{text:"Before"}),h("th",{text:"Size"}),h("th",{}))),
      h("tbody",{},S.hist.backups.length?S.hist.backups.map(b=>h("tr",{},h("td",{text:fmt(b.ts)}),h("td",{text:b.action}),h("td",{text:bytes(b.size)}),h("td",{},h("div",{class:"row end"},h("button",{class:"btn sm",text:"Restore progress",onclick:restore(b,"progress")}),h("button",{class:"btn sm",text:"Restore whole account",onclick:restore(b,"record")}))))):[h("tr",{},h("td",{colspan:4,class:"empty",text:"No backups yet."}))]))),
    h("h3",{text:"Admin actions on this account"}),auditRows(S.hist.audit,false));
}

// ---------- duplicates / audit / recovery ----------
async function dupesView(my){
  const r=await api("GET","duplicates"); if(my!==navSeq) return;
  pgEl.replaceChildren(h("div",{class:"card"},h("h2",{text:"Possible duplicate accounts"}),
    h("p",{class:"muted",text:"Accounts that share an email address, or (weaker) a display name. Same email usually means the same person who signed up two ways."}),
    r.groups.length?r.groups.map(g=>h("div",{class:"card"},h("div",{class:"row"},h("b",{class:"grow",text:g.why}),g.weak?h("span",{class:"tag",text:"weak match"}):null),
      g.users.map(x=>h("div",{class:"row mt"},h("b",{text:x.name||"(no name)"}),provTags(x),h("span",{class:"small muted grow",text:x.wins+" wins \u00b7 played "+ago(x.last)+" \u00b7 "+(x.email||x.discordName||x.id)}),h("button",{class:"btn sm",text:"Open",onclick:()=>navTo(x.id)}))),
      g.users.length===2?h("div",{class:"row end mt"},h("button",{class:"btn sm pri",text:"Compare and merge",onclick:()=>{S.tab="logins"; S.merge={target:g.users[0].id,other:g.users[1].id,flip:false,strat:"combine"}; navTo(g.users[0].id)}})):null)):h("p",{class:"empty",text:"No duplicates found."})));
}
async function auditView(my){
  const q=h("input",{type:"search",placeholder:"Filter (action, account ID, IP\u2026)","aria-label":"Filter audit log"}), box=h("div");
  const load=async()=>{ const r=await api("GET","audit?"+new URLSearchParams({q:q.value.trim(),limit:300})); box.replaceChildren(auditRows(r.entries,true)) };
  let t; q.addEventListener("input",()=>{clearTimeout(t);t=setTimeout(()=>run(null,load),300)});
  if(my!==navSeq) return;
  pgEl.replaceChildren(h("div",{class:"card"},h("h2",{text:"Audit log"}),h("p",{class:"muted",text:"Every unlock attempt and every change made from this panel, newest first. It is stored in /data/admin/audit.log."}),h("div",{class:"row mb"},q,h("button",{class:"btn",text:"Refresh",onclick:()=>run(null,load)})),box));
  await load();
}
async function recoveryView(my){
  const r=await api("GET","recovery"); if(my!==navSeq) return;
  pgEl.replaceChildren(h("div",{class:"card"},h("h2",{text:"Deleted and merged-away accounts"}),h("p",{class:"muted",text:"Accounts that no longer exist but still have a backup. Restoring brings back the account with its logins, progress, share link and shared lists; they sign in again as normal."}),
    r.rows.length?h("div",{class:"tw"},h("table",{},h("thead",{},h("tr",{},h("th",{text:"Name"}),h("th",{text:"Logins"}),h("th",{text:"Backed up"}),h("th",{text:"Because"}),h("th",{}))),
      h("tbody",{},r.rows.map(x=>h("tr",{},h("td",{},h("b",{text:x.name||"(no name)"}),h("div",{class:"mono muted",text:x.uid})),h("td",{},[x.google&&"Google",x.discord&&"Discord",x.email&&x.email].filter(Boolean).join(", ")),h("td",{text:fmt(x.ts)}),h("td",{text:x.action}),
        h("td",{},h("div",{class:"row end"},h("button",{class:"btn sm",text:"Restore",onclick:async e=>{ if(await confirmBox("Restore account","Bring back \""+(x.name||x.uid)+"\"?","Restore")) run(e.target,async()=>{ await api("POST","restore",{uid:x.uid,file:x.file,scope:"record"}); toast("Account restored"); await recoveryView(navSeq) }) }})))))))):h("p",{class:"empty",text:"Nothing to recover."})));
}

// ---------- start ----------
(async()=>{
  if(!session||!session.token) return notFound();
  try{ const w=await api("GET","whoami"); idleSec=w.idleSeconds||1200; if(w.unlocked){lastOk=Date.now();startApp()} else showLock("") }
  catch(e){ if(e.status!==423) notFound() }
})();
})();
