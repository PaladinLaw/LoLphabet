// ---- Optional Google accounts (only active when served by server.js) ----
let session=null, authOn=false, gReady=false, tokenClient, pushT, visitN=0, gcid="", gLoading=false;
try{session=JSON.parse(localStorage.getItem("lol-az-session"))}catch(e){}
const api=(m,u,b)=>fetch(u,{method:m,headers:{"Content-Type":"application/json",...(session?{Authorization:"Bearer "+session.token}:{})},body:b===undefined?undefined:JSON.stringify(b)})
  .then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(j.error||r.status),{status:r.status});return j});
const setSync=t=>{const e=$("sync");if(e)e.textContent=t==="Sync failed"?t:""};
function push(){
  if(!session) return;
  setSync("Saving…"); clearTimeout(pushT);
  pushT=setTimeout(()=>api("PUT","/api/progress",all).then(()=>setSync("Saved")).catch(e=>{
    if(e.status===401) signOut(); else setSync("Sync failed");}),600);
}
const hasData=o=>o&&Object.values(o).some(r=>r&&typeof r==="object"&&Object.keys(r).length);
async function pull(fresh){
  const {data,name}=await api("GET","/api/progress");
  if(name&&session){session.name=session.given=name;try{localStorage.setItem("lol-az-session",JSON.stringify(session))}catch(e){}renderAuth();}
  if(hasData(data)){
    if(fresh&&hasData(all)&&JSON.stringify(all)!==JSON.stringify(data)){
      const useAcct=await ask({title:"Which progress do you want to keep?",body:"This browser and your account both have saved progress.\n\nUsing your account's progress replaces what's in this browser. Keeping this browser's progress overwrites your account.",
        buttons:[{label:"Keep this browser's",value:false},{label:"Use my account's",value:true,cls:"pri"}]});
      if(!useAcct){push();return;}
    }
    all=data; rebuildLists(); try{localStorage.setItem(KEY,JSON.stringify(all))}catch(e){} render();
  } else push();
  setSync("Saved");
}
function loadGIS(ok,fail){
  if(gReady) return ok(); if(gLoading) return; gLoading=true;
  const sc=document.createElement("script"); sc.src="https://accounts.google.com/gsi/client";
  sc.onload=()=>{
    tokenClient=google.accounts.oauth2.initTokenClient({client_id:gcid,scope:"openid email profile",
      callback:r=>{if(r&&r.access_token)login(r.access_token);else $("me").textContent="Google sign-in failed. Please try again."},
      error_callback:e=>{if(e&&e.type!=="popup_closed")$("me").textContent="Google sign-in was blocked. Allow popups for this site and try again."}});
    gReady=true; gLoading=false; ok();};
  sc.onerror=()=>{gLoading=false; fail&&fail()};
  document.head.appendChild(sc);
}
function openAuth(){
  $("mt").textContent="Log in / Sign up";
  $("mp").textContent="Continue with Google. Your account is created automatically the first time, and any progress already in this browser is saved to it.";
  $("me").textContent=""; $("gbtn").innerHTML=""; $("modal").hidden=false;
  $("gbtn").innerHTML=`<button class="gsi" id="gbt"><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg><span>Sign in with Google</span></button>`;
  const wire=()=>{$("gbt").disabled=false; $("gbt").onclick=()=>{$("me").textContent="";tokenClient.requestAccessToken({prompt:"select_account"})}};
  if(gReady) wire();
  else{$("gbt").disabled=true; loadGIS(wire,()=>{$("me").textContent="Couldn't load Google sign-in. Check your connection and try again."});}
}
const closeAuth=()=>{$("modal").hidden=true};
$("mx").onclick=closeAuth;
$("modal").addEventListener("click",e=>{if(e.target===$("modal"))closeAuth()});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeAuth()});
async function chooseName(){
  const n=await ask({title:"Choose your display name",body:"This is the name shown at the top of the page. You can change it any time in Settings.",
    input:{value:session.given||session.name||"",placeholder:"Display name",max:40},
    buttons:[{label:"Continue",cls:"pri",input:true}]});
  const name=(n||"").trim();
  if(name&&name!==(session.given||session.name)){
    try{const r=await api("PUT","/api/profile",{name}); session.name=session.given=r.name; localStorage.setItem("lol-az-session",JSON.stringify(session));}catch(e){}
  }
}
async function login(credential){
  try{
    session=await api("POST","/api/login",{access_token:credential}); shareTok=undefined;
    const isNew=session.isNew; delete session.isNew;
    localStorage.setItem("lol-az-session",JSON.stringify(session));
    closeAuth();
    if(isNew) await chooseName();
    renderAuth(); await pull(true);
  }catch(e){
    session=null;
    $("me").textContent="Sign-in failed. Please try again.";
  }
}
function signOut(){
  if(session) api("POST","/api/logout",{}).catch(()=>{});
  session=null; shareTok=undefined; try{localStorage.removeItem("lol-az-session")}catch(e){}
  renderAuth();
}
function renderVisits(){ $("visits").textContent=visitN?"You are visitor #"+visitN.toLocaleString():""; }
function renderAuth(){
  renderSettings(); updateFooter();
  const el=$("auth");
  $("opt2").hidden=!authOn; $("opts").hidden=!!session;
  if(session){
    el.innerHTML=`<span>Hi, ${esc(session.given||session.name||"there")}</span><small id="sync"></small><button id="so">Sign out</button>`;
    $("so").onclick=signOut;
  }else{
    el.innerHTML=authOn?'<button id="bl" class="pri">Log in / Sign up</button>':"";
    if(authOn) $("bl").onclick=openAuth;
  }
}
if(!READONLY) fetch("/api/config").then(r=>r.ok?r.json():Promise.reject()).then(cfg=>{
  if(!cfg.googleClientId) return;
  authOn=true; renderAuth();
  gcid=cfg.googleClientId;
  if(session) pull(false).catch(e=>{if(e.status===401)signOut()});
}).catch(()=>{});

