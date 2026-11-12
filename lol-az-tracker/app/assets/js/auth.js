// ---- Optional accounts: Google, Discord, username + password, magic link (which are on comes from /api/config) ----
let session=null, authOn=false, gReady=false, tokenClient, pushT, visitN=0, gcid="", gLoading=false, gMode="login", logins=[], acct, acctLoading=false, resetTok="";
try{session=JSON.parse(localStorage.getItem("lol-az-session"))}catch(e){}
const api=(m,u,b)=>fetch(u,{method:m,headers:{"Content-Type":"application/json",...(session?{Authorization:"Bearer "+session.token}:{})},body:b===undefined?undefined:JSON.stringify(b)})
  .then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(j.error||r.status),{status:r.status,merge:j.merge,code:j.code});return j});
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
function gFail(msg){ if(gMode==="link") info("Couldn't link Google",msg); else setMsg(msg); }
function loadGIS(ok,fail){
  if(gReady) return ok(); if(gLoading) return; gLoading=true;
  const sc=document.createElement("script"); sc.src="https://accounts.google.com/gsi/client";
  sc.onload=()=>{
    tokenClient=google.accounts.oauth2.initTokenClient({client_id:gcid,scope:"openid email profile",
      callback:r=>{ if(r&&r.access_token){ gMode==="link"?linkGoogleTok(r.access_token):login(r.access_token) } else gFail("Google sign-in failed. Please try again.") },
      error_callback:e=>{ if(e&&e.type!=="popup_closed") gFail("Google sign-in was blocked. Allow popups for this site and try again.") }});
    gReady=true; gLoading=false; ok();};
  sc.onerror=()=>{gLoading=false; fail&&fail()};
  document.head.appendChild(sc);
}
const setMsg=(t,good)=>{const e=$("me"); e.textContent=t||""; e.classList.toggle("ok",!!good)};
const netErr=x=>x&&x.status?x.message:"Network error. Check your connection and try again.";
const GSVG=`<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;
const LABEL={google:"Google",discord:"Discord",password:"Username & password",magic:"Email magic link"};
const fld=(n,ph,o={})=>`<input class="fld" name="${n}" placeholder="${ph}" ${o.type?'type="'+o.type+'" ':""}autocomplete="${o.ac||"off"}" ${o.max?'maxlength="'+o.max+'" ':""}${o.req===false?"":"required "}${o.val?'value="'+esc(o.val)+'"':""}>`;
function authView(v){
  const box=$("gbtn"); setMsg("");
  const back=logins.length>1&&v!=="menu"?`<button type="button" class="alink" data-a="menu">← Other ways to sign in</button>`:"";
  const sw=(to,txt)=>`<button type="button" class="alink" data-a="${to}">${txt}</button>`;
  const form=(f,fields,btn,extra)=>`<form class="af" data-f="${f}">${fields}<button class="pri" type="submit">${btn}</button>${extra||""}</form>${back}`;
  if(v==="menu"){
    $("mt").textContent="Log in / Sign up";
    $("mp").textContent="Choose how to log in. Your account is created automatically the first time, and any progress already in this browser is saved to it.";
    const btn=t=>t==="google"?`<button class="gsi" id="gbt" data-a="google" disabled>${GSVG}<span>Sign in with Google</span></button>`
      :t==="discord"?`<button class="abtn dc" data-a="discord">Continue with Discord</button>`
      :t==="password"?`<button class="abtn" data-a="password">Username &amp; password</button>`
      :`<button class="abtn" data-a="magic">Email me a magic link</button>`;
    const social=logins.filter(t=>t==="google"||t==="discord"), email=logins.filter(t=>t==="magic"||t==="password");   // one-click options first, typing options after
    box.innerHTML=social.map(btn).join("")+(social.length&&email.length?`<div class="adiv"><span>or use your email</span></div>`:"")+email.map(btn).join("");
    if(logins.includes("google")){
      const wire=()=>{const b=$("gbt"); if(b) b.disabled=false};
      if(gReady) wire(); else loadGIS(wire,()=>setMsg("Couldn't load Google sign-in. Check your connection and try again."));
    }
  }else if(v==="password"){
    $("mt").textContent="Log in"; $("mp").textContent="Log in with your username or email and your password.";
    box.innerHTML=form("password",fld("login","Username or email",{ac:"username"})+fld("password","Password",{type:"password",ac:"current-password",max:200}),"Log in",
      `<div class="alinks">${sw("forgot","Forgot password?")}${sw("signup","Create an account")}</div>`);
  }else if(v==="signup"){
    $("mt").textContent="Create an account"; $("mp").textContent="Your username is also your display name. We'll email you a link to confirm your address.";
    box.innerHTML=form("signup",fld("username","Username",{ac:"username",max:30})+fld("email","Email",{type:"email",ac:"email",max:200})+fld("password","Password (8+ characters)",{type:"password",ac:"new-password",max:200}),"Create account",
      `<div class="alinks">${sw("password","I already have an account")}</div>`);
  }else if(v==="magic"){
    $("mt").textContent="Email me a link"; $("mp").textContent="No password needed. We'll email you a link that logs you in. New here? One is created for you.";
    box.innerHTML=form("magic",fld("email","Email",{type:"email",ac:"email",max:200})+fld("username","Username (for new accounts)",{ac:"nickname",max:40,req:false}),"Send link");
  }else if(v==="forgot"){
    $("mt").textContent="Reset your password"; $("mp").textContent="Enter your email and we'll send you a link to choose a new password.";
    box.innerHTML=form("forgot",fld("email","Email",{type:"email",ac:"email",max:200}),"Send reset link",`<div class="alinks">${sw("password","Back to log in")}</div>`);
  }else if(v==="reset"){
    $("mt").textContent="Choose a new password"; $("mp").textContent="Pick a new password for your account. You'll be logged in afterwards.";
    box.innerHTML=`<form class="af" data-f="reset">${fld("password","New password (8+ characters)",{type:"password",ac:"new-password",max:200})}<button class="pri" type="submit">Save password</button></form>`;
  }
  const f=box.querySelector("input"); if(f&&v!=="menu") f.focus();
}
function authDone(title,msg){
  $("mt").textContent=title; $("mp").textContent=msg; $("gbtn").innerHTML=`<button type="button" class="abtn" data-a="close">Close</button>`; setMsg("");
}
function openAuth(){
  $("modal").hidden=false;
  authView(logins.length===1&&(logins[0]==="password"||logins[0]==="magic")?logins[0]:"menu");
}
const closeAuth=()=>{$("modal").hidden=true};
$("mx").onclick=closeAuth;
$("modal").addEventListener("click",e=>{if(e.target===$("modal"))closeAuth()});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeAuth()});
function googleStart(mode){
  gMode=mode; const go=()=>tokenClient.requestAccessToken({prompt:"select_account"});
  if(gReady) go(); else loadGIS(go,()=>gFail("Couldn't load Google sign-in. Check your connection and try again."));
}
async function discordStart(mode){
  try{ const r=await api("POST",mode==="link"?"/api/account/link/discord/start":"/api/auth/discord/start",{}); location.href=r.url; }
  catch(x){ const m=netErr(x); if(mode==="link") info("Couldn't link Discord",m); else setMsg(m); }
}
$("gbtn").addEventListener("click",e=>{
  const b=e.target.closest("[data-a]"); if(!b) return; const a=b.dataset.a;
  if(a==="google") googleStart("login"); else if(a==="discord") discordStart("login"); else if(a==="close") closeAuth(); else authView(a);
});
$("gbtn").addEventListener("submit",async e=>{
  e.preventDefault(); const f=e.target, k=f.dataset.f, d=Object.fromEntries(new FormData(f)), btn=f.querySelector("button[type=submit]");
  setMsg(""); btn.disabled=true;
  try{
    if(k==="password") await finishLogin(await api("POST","/api/auth/password",d));
    else if(k==="reset") await finishLogin(await api("POST","/api/auth/reset",{token:resetTok,password:d.password}));
    else if(k==="signup"){ await api("POST","/api/auth/register",d); authDone("Check your email","We've sent a confirmation link to "+d.email+". Open it to finish creating your account. It expires in 1 hour."); }
    else if(k==="magic"){ await api("POST","/api/auth/magic",d); authDone("Check your email","We've sent a login link to "+d.email+". It works once and expires in 15 minutes."); }
    else if(k==="forgot"){ await api("POST","/api/auth/forgot",d); authDone("Check your email","If an account exists for "+d.email+", we've sent a link to reset its password. It expires in 30 minutes."); }
  }catch(x){ setMsg(netErr(x)); btn.disabled=false; }
});
async function linkGoogleTok(tok){
  try{ await api("POST","/api/account/link/google",{access_token:tok}); acct=undefined; renderSettings(); }
  catch(x){
    if(x.status===409&&x.merge) return doMerge(x.merge);
    info("Couldn't link Google",netErr(x));
  }
}
async function chooseName(){
  const n=await ask({title:"Choose your display name",body:"This is the name shown at the top of the page. You can change it any time in Settings.",
    input:{value:session.given||session.name||"",placeholder:"Display name",max:40},
    buttons:[{label:"Continue",cls:"pri",input:true}]});
  const name=(n||"").trim();
  if(name&&name!==(session.given||session.name)){
    try{const r=await api("PUT","/api/profile",{name}); session.name=session.given=r.name; localStorage.setItem("lol-az-session",JSON.stringify(session));}catch(e){}
  }
}
async function finishLogin(s){
  session=s; shareTok=undefined; acct=undefined;
  const isNew=session.isNew; delete session.isNew;
  localStorage.setItem("lol-az-session",JSON.stringify(session));
  closeAuth();
  if(isNew) await chooseName();
  renderAuth(); await pull(true);
}
const login=tok=>api("POST","/api/login",{access_token:tok}).then(finishLogin).catch(x=>{session=null;setMsg("Sign-in failed. Please try again.")});
function signOut(){
  if(session) api("POST","/api/logout",{}).catch(()=>{});
  session=null; shareTok=undefined; acct=undefined; try{localStorage.removeItem("lol-az-session")}catch(e){}
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
async function loadAcct(){
  if(acctLoading) return; acctLoading=true;
  api("GET","/api/account").then(r=>{acct=r}).catch(e=>{acct=null;if(e.status===401)signOut()}).finally(()=>{acctLoading=false;renderSettings()});
}
// Returning from an email link or from Discord: the address ends in #magic=…, #discord… etc. Cleared straight away so it isn't kept in history.
const AUTHERR={expired:"That sign-in attempt expired. Please try again.",cancelled:"Sign-in was cancelled.",failed:"Sign-in failed. Please try again.",disabled:"That sign-in method isn't available.",
  has_google:"A different Google account is already linked to this account. Unlink it first.",has_discord:"A different Discord account is already linked to this account. Unlink it first."};
async function doMerge(tok){
  if(!session){ await info("Log in first","Log in to the account you want to keep, then link again from Settings."); return; }
  let m; try{ m=await api("POST","/api/account/merge/info",{token:tok}) }catch(e){ await info("That link expired","Please try linking again from Settings."); return; }
  const k=LABEL[m.kind]||"sign-in";
  const keep=await ask({title:"That "+k+" login belongs to another account",cancel:null,
    body:"“"+m.name+"”"+(m.email?" ("+m.email+")":"")+" already uses it.\n\nTo link it here, the two accounts are combined into this one and the other account is deleted.\n\nThis account "+(m.mineHas?"has":"has no")+" saved progress. The other account "+(m.otherHas?"has":"has no")+" saved progress. Which progress do you want to keep? The other is discarded, so Export first if unsure.",
    buttons:[{label:"Cancel",value:null},{label:"Keep this account's",value:"mine"},{label:"Use the other's",value:"theirs",cls:"pri"}]});
  if(!keep) return;
  try{ await api("POST","/api/account/merge",{token:tok,keep}); acct=undefined; await pull(false); renderAuth(); await info("Accounts linked","The "+k+" login is now part of this account."); }
  catch(x){ await info("Couldn't link the accounts",netErr(x)); }
}
async function handleHash(){
  const m=location.hash.match(/^#(magic|signup|addemail|exchange|reset|merge|linked|autherr)=([\w-]+)$/); if(!m||READONLY) return;
  history.replaceState(null,"",location.pathname+location.search);
  const k=m[1], v=m[2];
  if(k==="reset"){ resetTok=v; $("modal").hidden=false; authView("reset"); }
  else if(k==="merge") doMerge(v);
  else if(k==="linked"){ acct=undefined; view="settings"; render(); info("Linked",(LABEL[v]||"Sign-in method")+" is now linked to your account."); }
  else if(k==="autherr"){ if(session){view="settings";render()} info("Couldn't sign in",AUTHERR[v]||AUTHERR.failed); }
  else{
    try{ await finishLogin(await api("POST","/api/auth/verify",{token:v})); }
    catch(x){ info("Couldn't sign in",x.status?x.message:netErr(x)); }
  }
}
if(!READONLY) fetch("/api/config").then(r=>r.ok?r.json():Promise.reject()).then(cfg=>{
  logins=Array.isArray(cfg.login)?cfg.login:(cfg.googleClientId?["google"]:[]);
  if(!logins.length) return;
  authOn=true; renderAuth();
  gcid=cfg.googleClientId||"";
  if(session) pull(false).catch(e=>{if(e.status===401)signOut()});
  handleHash(); addEventListener("hashchange",handleHash);
}).catch(()=>{});
