const TPL=(location.pathname.match(/^\/t\/([\w-]+)/)||[])[1];
if(TPL&&!READONLY){
  fetch("/api/template/"+TPL).then(r=>r.ok?r.json():Promise.reject()).then(async t=>{
    history.replaceState(null,"","/");
    if(!await confirmDlg("Add shared list?",(t.by||"Someone")+" shared the list “"+t.name+"” with "+t.champs.length+" champions. Add a copy to your lists?","Add list",false)) return;
    const lists=all.__lists||(all.__lists=[]); let name=t.name.slice(0,30), n=2;
    const taken=x=>lists.some(l=>l.name.toLowerCase()===x.toLowerCase())||Object.keys(LISTS).filter(k=>!k.startsWith("c:")).some(k=>label(k).toLowerCase()===x.toLowerCase());
    while(taken(name)) name=t.name.slice(0,26)+" ("+(n++)+")";
    const l={id:Math.random().toString(36).slice(2,8),name,champs:t.champs.slice().sort(cmp)}; lists.push(l);
    rebuildLists(); role="c:"+l.id; CHAMPS=LISTS[role]; view="role"; save(); render();
  }).catch(()=>info("Link not found","That shared list link is invalid or has been removed."));
}
const goHome=()=>{if(READONLY){location.href="/";return} view="role"; render(); window.scrollTo&&window.scrollTo(0,0)};
$("home").onclick=goHome; $("home").onkeydown=e=>{if(e.key==="Enter")goHome()};
if(READONLY){
  $("snote").hidden=false; $("snote").textContent="Loading…";
  fetch("/api/shared/"+SHARE).then(r=>r.ok?r.json():Promise.reject()).then(d=>{
    all=d.data||{}; rebuildLists(); role="Top"; CHAMPS=LISTS[role];
    {const t=latestRun(all); if(t){role=t.role; mode=t.mode; CHAMPS=LISTS[role]}}   // open on the list/mode the owner last played, not always Top
    lastIn[catOf(role)]=role;
    $("snote").innerHTML="Viewing <b>"+esc(d.name||"a friend")+"</b>'s progress (read-only). <a href=\"/\">Track your own</a>";
    document.title=(d.name||"A friend")+"'s progress | LoLphabet"; document.body.classList.remove("loading"); render();
  }).catch(()=>{$("snote").innerHTML="This share link is invalid or has been turned off. <a href=\"/\">Go to the tracker</a>"});
}
$("loginlink").onclick=e=>{e.preventDefault();openAuth()};
$("aboutlink").onclick=e=>{e.preventDefault();view="about";render();window.scrollTo&&window.scrollTo(0,0)};
function updateFooter(){
  $("fnote").textContent=READONLY?"":session
    ?"Your progress is saved to your account and synced across all your devices. Export/Import is there if you want a backup."
    :"Progress is saved in this browser (localStorage). Use Export/Import to move it between devices.";
}
const hw=$("howto");
try{if(localStorage.getItem("lol-az-howto")==="1")hw.open=true}catch(e){}
hw.addEventListener("toggle",()=>{try{localStorage.setItem("lol-az-howto",hw.open?"1":"0")}catch(e){}});
lastIn[catOf(role)]=role;
applyTheme();
render(); updateFooter();
fetch("/api/visit",{method:"POST"}).then(r=>r.ok?r.json():Promise.reject()).then(d=>{visitN=d.n;renderVisits()}).catch(()=>{});
$("yr").textContent=new Date().getFullYear();
function cookieDetails(){
  return ask({title:"Cookies & stored data",cancel:null,
    body:"Cookies: this site sets none.\n\nStored on your device (essential): your progress and lists, your preferences (theme, challenge mode, role-list source, build panel position and open/closed state, collapsed hints), and your login session if you sign in.\n\nOptional cookies: none. There is no analytics, advertising or social-media tracking, and nothing is sold or shared. Global Privacy Control signals are respected, because there is nothing to opt out of.\n\nThird parties: champion icons load from Riot Games, and Google's script loads only when you choose to log in.\n\nThe visitor counter uses no cookie or stored ID.",
    buttons:[{label:"Close",value:null},{label:"Clear data stored here",cls:"danger",value:"clear"}]
  }).then(async v=>{
    if(v==="clear"&&await confirmDlg("Clear everything stored here?","This removes your progress, lists, preferences and login from this browser. Anything saved to your account is not affected.","Clear it all",true)){try{localStorage.clear()}catch(e){} location.reload()}
  });
}
{let seen=false; try{seen=!!localStorage.getItem("lol-az-notice")}catch(e){}
 $("cbar").hidden=seen;
 $("cok").onclick=()=>{try{localStorage.setItem("lol-az-notice","1")}catch(e){} $("cbar").hidden=true};
 $("cdet").onclick=cookieDetails; $("cookieprefs").onclick=e=>{e.preventDefault();cookieDetails()};}
loadDD(); loadRoles();
