var DD=null;
try{localStorage.removeItem("lol-az-rolesrc")}catch(e){}   // retired setting (Curated Lists was removed)
var ROLEDATA=null; try{ROLEDATA=JSON.parse(localStorage.getItem("lol-az-roles"))}catch(e){}
// Solid skull (no crossbones) used for "Fallen" in Nuzlocke; currentColor, sized by .sk in components.css
const SKULL='<svg class="sk" aria-hidden="true" viewBox="0 0 16 16" focusable="false"><path fill-rule="evenodd" d="M8 1C4.7 1 2.5 3.3 2.5 6.4c0 1.6.7 2.9 2 3.8V13c0 .6.4 1 1 1H6v-1.4h1V14h2v-1.4h1V14h.5c.6 0 1-.4 1-1v-2.8c1.3-.9 2-2.2 2-3.8C13.5 3.3 11.3 1 8 1zM5.6 5.2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zm4.8 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM8 8.6l-.9 1.8h1.8z"/></svg>';
const ALL_KEY="all:All champs";   // progress is stored under this key like any other list
const CLASS_KEYS=["Fighter","Mage","Assassin","Tank","Marksman","Support"].map(c=>"class:"+c);
const CATS=[["all","All champs",[ALL_KEY]],["roles","Roles",ROLE_KEYS],["classes","Classes",CLASS_KEYS],["regions","Regions",Object.keys(SETS).filter(k=>k.startsWith("region:"))],["races","Races",Object.keys(SETS).filter(k=>k.startsWith("race:"))],["custom","Custom",null]];
const catOf=r=>r.startsWith("race:")?"races":r.startsWith("region:")?"regions":r.startsWith("class:")?"classes":r.startsWith("all:")?"all":r.startsWith("c:")?"custom":"roles";
const keysIn=c=>c==="custom"?Object.keys(LISTS).filter(k=>k.startsWith("c:")):CATS.find(x=>x[0]===c)[2];
const lastIn={};
function classChamps(k){const t=k.slice(6);return DD&&DD.tags?Object.keys(DD.tags).filter(n=>DD.tags[n].includes(t)).sort((a,b)=>a.localeCompare(b,"en",{sensitivity:"base"})).map(name=>({name,role:k})):[]}

// ---- State ----
const SHARE=(location.pathname.match(/^\/s\/([\w-]+)/)||[])[1], READONLY=!!SHARE;
if(READONLY) document.body.classList.add("ro","loading");
const KEY="lol-az-tracker-v2";
let all={};              // role -> name -> {won:bool, date:string|null, games:number}
if(!READONLY)try{all=JSON.parse(localStorage.getItem(KEY))||{}}catch(e){}
if(!READONLY&&!all.Jungle){try{const old=JSON.parse(localStorage.getItem("lol-az-tracker-v1"));if(old)all.Jungle=old}catch(e){}}
let role="Top", CHAMPS, mode="classic";
if(!READONLY)try{const m=localStorage.getItem("lol-az-mode");if(["classic","hard","hardcore","nuzlocke"].includes(m))mode=m}catch(e){}
rebuildLists();
if(!READONLY)try{const r=localStorage.getItem("lol-az-role");if(LISTS[r])role=r}catch(e){}
CHAMPS=LISTS[role];
const save=()=>{if(READONLY)return;try{localStorage.setItem(KEY,JSON.stringify(all));localStorage.setItem("lol-az-role",role)}catch(e){}
  push();};
const MODES=[["classic","Classic","A–Z, alphabetical order"],["hard","Hard","lose a game and you go back one champion"],["hardcore","Insanity","lose a game and the whole run restarts"],["nuzlocke","Nuzlocke","play any champion; lose with one and it's gone for good"]];   // id "hardcore" is kept so existing Insanity (ex-Hardcore) progress is not lost
const pkey=r=>mode==="classic"?r:r+"|"+mode, isHC=()=>mode==="hardcore", isHard=()=>mode==="hard", isNuz=()=>mode==="nuzlocke", isLock=()=>isHC()||isHard();
const st=()=>all[pkey(role)]||(all[pkey(role)]={});
const meta=()=>st().__meta||(st().__meta={});
const get=n=>st()[n]||(st()[n]={won:false,date:null,games:0});
let filter="all",query="";

const $=id=>document.getElementById(id);
const esc=s=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const THEME_KEY="lol-az-theme";
function applyTheme(){let t="auto";try{t=localStorage.getItem(THEME_KEY)||"auto"}catch(e){}
  if(t==="auto")delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=t;}
function label(r){return r.startsWith("c:")?((all.__lists||[]).find(l=>"c:"+l.id===r)||{}).name||"Custom":r.includes(":")?r.split(":")[1]:r}
function rebuildLists(){
  const o={};for(const r in BUILTIN)o[r]=BUILTIN[r];
  if(ROLEDATA&&ROLEDATA.lists){
    for(const r of ROLE_KEYS){const a=ROLEDATA.lists[r]; if(!a||!a.length) continue;
      o[r]=a.map(name=>({name,role:r}));}
  }
  for(const k of CLASS_KEYS)o[k]=classChamps(k);
  {const names=new Set(roster()); if(ROLEDATA&&ROLEDATA.lists)for(const r in ROLEDATA.lists)(ROLEDATA.lists[r]||[]).forEach(n=>names.add(n)); o[ALL_KEY]=[...names].sort(cmp).map(name=>({name,role:ALL_KEY}));}
  for(const l of all.__lists||[])o["c:"+l.id]=l.champs.map(name=>({name,role:"c:"+l.id}));
  LISTS=o; if(!LISTS[role])role="Top"; CHAMPS=LISTS[role];
}
function roster(extra){
  const set=new Set(ROSTER.split(","));
  for(const r in BUILTIN)BUILTIN[r].forEach(c=>set.add(c.name));
  if(DD&&DD.ids)Object.keys(DD.ids).forEach(n=>set.add(n));
  (all.__lists||[]).forEach(l=>l.champs.forEach(n=>set.add(n)));
  (extra||[]).forEach(n=>set.add(n));
  return [...set].sort(cmp);
}
function ask(o){
  return new Promise(res=>{
    $("dt").textContent=o.title; $("dp").textContent=o.body||"";
    const inp=$("di"), bx=$("db"), inf=o.type||o.input; inp.hidden=!inf; inp.value=(o.input&&o.input.value)||""; inp.placeholder=o.type||(o.input&&o.input.placeholder)||""; inp.maxLength=(o.input&&o.input.max)||100; inp.readOnly=!!(o.input&&o.input.readonly); $("dimg").hidden=!o.img; if(o.img)$("dimg").src=o.img; $("dmc").classList.toggle("wide",!!o.img); inp.type=(o.input&&o.input.type)||"text"; inp.max=(o.input&&o.input.maxv)||""; bx.innerHTML="";
    inp.onkeydown=o.input?(e=>{if(e.key==="Enter")done(inp.value.trim())}):null;
    const key=e=>{if(e.key==="Escape"&&"cancel" in o)done(o.cancel)};
    const done=v=>{$("dlg").hidden=true;document.removeEventListener("keydown",key);inp.oninput=null;inp.onkeydown=null;res(v)};
    for(const b of o.buttons){const el=document.createElement("button");el.textContent=b.label;
      if(b.cls)el.className=b.cls; if(b.needs){el.dataset.n="1";el.disabled=true}
      el.onclick=()=>done(b.input?inp.value.trim():b.value); bx.appendChild(el)}
    inp.oninput=()=>bx.querySelectorAll("[data-n]").forEach(b=>b.disabled=inp.value!==o.type);
    document.addEventListener("keydown",key);
    $("dlg").hidden=false; if(inf){inp.focus(); if(inp.readOnly)inp.select()}
  });
}
const confirmDlg=(title,body,yes,danger)=>ask({title,body,cancel:false,buttons:[{label:"Cancel",value:false},{label:yes,value:true,cls:danger?"danger":"pri"}]});
const info=(title,body)=>ask({title,body,cancel:true,buttons:[{label:"OK",value:true,cls:"pri"}]});
let shareTok, shareLoading=false;
function loadShare(){
  if(shareLoading) return; shareLoading=true;
  api("GET","/api/share").then(r=>{shareTok=r.token||null}).catch(()=>{shareTok=null}).finally(()=>{shareLoading=false;renderSettings()});
}
DD=null;
try{DD=JSON.parse(localStorage.getItem("lol-az-dd"))}catch(e){}
function iconUrl(name){
  if(!DD||!DD.ver) return "";
  const id=(DD.ids&&DD.ids[name])||name.replace(/[^A-Za-z]/g,"");
  return "https://ddragon.leagueoflegends.com/cdn/"+DD.ver+"/img/champion/"+id+".png";
}
function loadDD(){
  if(DD&&DD.tags&&DD.t&&Date.now()-DD.t<864e5) return;
  fetch("https://ddragon.leagueoflegends.com/api/versions.json").then(r=>r.json()).then(v=>{
    const ver=v[0];
    return fetch("https://ddragon.leagueoflegends.com/cdn/"+ver+"/data/en_US/champion.json").then(r=>r.json()).then(d=>{
      const ids={},tags={}; for(const k in d.data){ids[d.data[k].name]=d.data[k].id;tags[d.data[k].name]=d.data[k].tags||[]}
      DD={ver,ids,tags,t:Date.now()};
      try{localStorage.setItem("lol-az-dd",JSON.stringify(DD))}catch(e){}
      rebuildLists(); render();
    });
  }).catch(()=>{});
}
async function editDate(name){
  const s=get(name), t=today();
  const v=await ask({title:"Edit completion date",body:"When did you actually win with "+name+"?",cancel:null,
    input:{value:s.date||t,type:"date",maxv:t},buttons:[{label:"Cancel",value:null},{label:"Save",cls:"pri",input:true}]});
  if(v&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&v<=t){s.date=v;save();render();}
}
const linkify=t=>esc(t).replace(/https?:\/\/[^\s<]+/g,u=>`<a href="${u}" target="_blank" rel="noopener noreferrer">${u.length>32?u.slice(0,30)+"…":u}</a>`);
let view="role";
if(!READONLY&&location.pathname==="/about")view="about";
