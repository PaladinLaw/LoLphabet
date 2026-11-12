let nameEdit=false, pwEdit=false, emailEdit=false, sTab=null;
// Settings has three tabs: Account (profile, sign-in methods, sharing, delete), Preferences (theme, lists), Data (export/import, reset).
const sr=(l,a)=>`<div class="sr"><div class="sl">${l}</div>${a?`<div class="sa">${a}</div>`:""}</div>`;
const card=(t,body,cls)=>`<section class="scard${cls?" "+cls:""}">${t?`<h3>${t}</h3>`:""}${body}</section>`;
function profileCard(){
  const nm=esc(session.given||session.name||""), on=k=>logins.includes(k);
  const why=[on("magic")?"magic links":"",on("password")?"password resets":""].filter(Boolean).join(" and ");
  const name=nameEdit
    ?`<div class="sr sf"><input class="fld" id="sname" maxlength="40" value="${nm}" aria-label="Display name"><button class="pri" data-s="savename">Save</button><button class="qbtn" data-s="cancelname">Cancel</button><small id="smsg"></small></div>`
    :sr(`Name: <b>${nm}</b><small id="smsg"></small>`,`<button data-s="editname">Edit</button>`);
  const em=(acct?acct.email:session.email)||"";
  let email;
  if(acct===undefined) email=sr(`Email: <small>Loading…</small>`);
  else if(emailEdit) email=`<div class="sr sf"><input class="fld" id="semail" type="email" placeholder="you@example.com" autocomplete="email" maxlength="200" aria-label="Email address"><button class="pri" data-s="email-send">Send link</button><button class="qbtn" data-s="email-cancel">Cancel</button><small id="amsg"></small></div>`;
  else if(em) email=sr(`Email: <b>${esc(em)}</b> <span class="vok">✓ verified</span>${why?`<small>Used for ${why}</small>`:""}`);
  else email=sr(`Email: <b>none yet</b>${why?`<small>Add one for ${why}</small>`:""}`,why?`<button data-s="email-add">Add email</button>`:"");
  return card("Profile",name+email);
}
function methodsCard(){
  if(acct===undefined) return card("Sign-in methods",`<p class="sm">Loading…</p>`);
  if(!acct) return "";
  const on=k=>logins.includes(k), rows=[];
  if(on("google")){
    if(!acct.google&&!gReady&&!gLoading) loadGIS(()=>{},()=>{});
    rows.push(acct.google?sr(`<b>Google</b><small>${esc(acct.google.email||"Linked")}</small>`,`<button class="qbtn" data-s="unlink" data-k="google">Unlink</button>`)
      :sr(`<b>Google</b><small>Not linked</small>`,`<button data-s="link-google">Link</button>`));
  }
  if(on("discord")) rows.push(acct.discord?sr(`<b>Discord</b><small>${esc(acct.discord.name)}</small>`,`<button class="qbtn" data-s="unlink" data-k="discord">Unlink</button>`)
      :sr(`<b>Discord</b><small>Not linked</small>`,`<button data-s="link-discord">Link</button>`));
  if(on("password")){
    if(pwEdit) rows.push(`<div class="sr sf">${acct.hasPassword?`<input class="fld" id="spw-cur" type="password" placeholder="Current password" autocomplete="current-password" maxlength="200">`:""}<input class="fld" id="spw-new" type="password" placeholder="New password (8+ characters)" autocomplete="new-password" maxlength="200"><input class="fld" id="spw-user" placeholder="Username (optional)" autocomplete="username" maxlength="30" value="${esc(acct.handle||(acct.hasPassword?"":acct.name||""))}"><button class="pri" data-s="pw-save">Save</button><button class="qbtn" data-s="pw-cancel">Cancel</button><small id="amsg"></small></div>`);
    else if(acct.hasPassword) rows.push(sr(`<b>Username &amp; password</b><small>${acct.handle?"Log in with “"+esc(acct.handle)+"” or your email":"Log in with your email"}</small>`,`<button data-s="pw-edit">Change</button><button class="qbtn" data-s="unlink" data-k="password">Remove</button>`));
    else rows.push(sr(`<b>Username &amp; password</b><small>${acct.email?"Not set":"Add an email first (Profile above)"}</small>`,acct.email?`<button data-s="pw-edit">Add</button>`:""));
  }
  return rows.length?card("Sign-in methods",`<p class="sm">Link more ways to log in to this same account and progress.</p>`+rows.join("")):"";
}
function shareCard(){
  const link=shareTok?location.origin+"/s/"+shareTok:"";
  if(shareTok===undefined){ loadShare(); return card("Share your progress",`<p class="sm">Loading…</p>`); }
  return card("Share your progress",shareTok
    ?`<p class="sm">Anyone with this link can view your progress, but can't change anything.</p>
      <div class="sr sf"><input class="fld" id="slink" readonly value="${esc(link)}" aria-label="Share link"><button data-s="copyshare">Copy</button><small id="cmsg"></small></div>
      <div class="sr"><div class="sl"></div><div class="sa"><button data-s="newshare">New link</button><button class="qbtn" data-s="stopshare">Stop sharing</button></div></div>`
    :`<p class="sm">Create a link your friends can open to see your progress. It's read-only.</p><div class="row"><button data-s="mkshare">Create share link</button></div>`);
}
function accountTab(){
  if(!session) return card("Account",authOn
    ?`<p class="sm">You're not logged in. Progress is saved in this browser only. Log in to sync it across devices and to share it.</p><div class="row"><button class="pri" data-s="login">Log in / Sign up</button></div>`
    :`<p class="sm">Accounts aren't available on this site. Progress is saved in this browser only.</p>`);
  if(authOn&&acct===undefined) loadAcct();
  return profileCard()+(authOn?methodsCard():"")+shareCard()
    +card("Delete account",`<p class="sm">Permanently deletes your account and everything saved with it on our server: your progress, custom lists and share link. This can't be undone. Progress saved in this browser is kept.</p><div class="row"><button class="danger" data-s="delacct">Delete account</button></div>`,"dz");
}
function prefsTab(){
  const lists=all.__lists||[]; let theme="auto"; try{theme=localStorage.getItem(THEME_KEY)||"auto"}catch(e){}
  return card("Appearance",`<div class="sr"><div class="sl"><label for="stheme">Theme</label></div><div class="sa"><select class="fld" id="stheme">${["auto","light","dark"].map(t=>`<option value="${t}"${t===theme?" selected":""}>${t[0].toUpperCase()+t.slice(1)}</option>`).join("")}</select></div></div>`)
    +card("Your lists",(lists.map(l=>sr(`<b>${esc(l.name)}</b><small>${l.champs.length} champions</small>`,`<button data-s="editlist" data-id="${l.id}">Edit</button><button class="qbtn" data-s="dellist" data-id="${l.id}">Delete</button>`)).join("")||`<p class="sm">No custom lists yet.</p>`)
      +`<div class="row"><button data-s="newlist">＋ New list</button></div>`);
}
function dataTab(){
  return card("Your data",`<p class="sm">Take a copy of your progress, or load one back in.</p><div class="row"><button data-s="export">Export</button><button data-s="import">Import</button></div>`)
    +card("Reset all progress",`<p class="sm">Clears every list${session?", including your saved account progress":""}. Your custom lists are kept. This can't be undone.</p><div class="row"><button class="danger" data-s="resetall">Reset all progress</button></div>`,"dz");
}
function renderSettings(){
  if(view!=="settings") return;
  const tabs=[...(authOn?[["account","Account"]]:[]),["prefs","Preferences"],["data","Data"]];
  const tab=tabs.some(t=>t[0]===sTab)?sTab:tabs[0][0];
  $("settings").innerHTML=`<div class="stabs" role="tablist">${tabs.map(([k,l])=>`<button role="tab" aria-selected="${k===tab}" class="${k===tab?"on":""}" data-s="tab" data-t="${k}">${l}</button>`).join("")}</div>`
    +(tab==="account"?accountTab():tab==="prefs"?prefsTab():dataTab())
    +`<div class="row"><button class="pri" data-s="save" style="margin-left:auto">Save</button></div>`;
}
$("settings").addEventListener("click",async e=>{
  const b=e.target.closest("button"); if(!b) return; const a=b.dataset.s, id=b.dataset.id;
  if(a==="login") openAuth();
  else if(a==="tab"){ sTab=b.dataset.t; renderSettings(); window.scrollTo&&window.scrollTo(0,0); }
  else if(a==="cancelname"){ nameEdit=false; renderSettings(); }
  else if(a==="signout") signOut();
  else if(a==="link-google"){ if(!gReady) return info("Google is still loading","Give it a second and try again."); googleStart("link"); }
  else if(a==="link-discord") discordStart("link");
  else if(a==="unlink"){
    const k=b.dataset.k;
    if(!await confirmDlg("Unlink "+LABEL[k]+"?","You won't be able to log in with it any more. Your progress isn't affected.","Unlink",true)) return;
    try{ await api("DELETE","/api/account/link/"+k); acct=undefined; renderSettings(); }
    catch(x){ await info("Couldn't unlink",netErr(x)); }
  }
  else if(a==="pw-edit"){ pwEdit=true; renderSettings(); const i=$("spw-cur")||$("spw-new"); if(i)i.focus(); }
  else if(a==="pw-cancel"){ pwEdit=false; renderSettings(); }
  else if(a==="pw-save"){
    const body={password:$("spw-new").value,username:$("spw-user").value}; if($("spw-cur")) body.current=$("spw-cur").value;
    try{ await api("PUT","/api/account/password",body); pwEdit=false; acct=undefined; renderSettings(); info("Password saved","You can now log in with it."); }
    catch(x){ $("amsg").textContent=netErr(x); }
  }
  else if(a==="email-add"){ emailEdit=true; renderSettings(); const i=$("semail"); if(i)i.focus(); }
  else if(a==="email-cancel"){ emailEdit=false; renderSettings(); }
  else if(a==="email-send"){
    const em=$("semail").value.trim(); if(!em) return;
    try{ await api("POST","/api/account/email",{email:em}); emailEdit=false; renderSettings(); info("Check your email","We sent a confirmation link to "+em+". Open it to add the address to your account."); }
    catch(x){ $("amsg").textContent=netErr(x); }
  }
  else if(a==="savename"){
    const n=$("sname").value.trim(); if(!n) return;
    try{const r=await api("PUT","/api/profile",{name:n}); session.name=session.given=r.name;
      localStorage.setItem("lol-az-session",JSON.stringify(session)); nameEdit=false; renderAuth();
    }catch(x){$("smsg").textContent="Couldn't save ("+(x.status||"network error")+")"}
  }
  else if(a==="editname"){ nameEdit=true; renderSettings(); const i=$("sname"); if(i){i.focus();i.select()} }
  else if(a==="delacct"){
    const ok=await ask({title:"Delete your account?",body:"This permanently deletes your account and everything saved with it on our server: your progress, custom lists and share link. It can't be undone.\n\nProgress saved in this browser is kept. Use Export (Data tab) first if you want a copy of your account data.\n\nType DELETE to confirm.",type:"DELETE",cancel:false,
      buttons:[{label:"Cancel",value:false},{label:"Delete account",value:true,cls:"danger",needs:true}]});
    if(ok){try{await api("DELETE","/api/account"); signOut()}catch(x){await info("Couldn't delete the account","Error "+(x.status||"network")+". A 404 means the server.js on your host is out of date: replace it and restart the container.")}}
  }
  else if(a==="mkshare"||a==="newshare"){
    if(a==="newshare"&&!await confirmDlg("Create a new link?","Your current link will stop working.","Create new link",false)) return;
    try{const r=await api("POST","/api/share"); shareTok=r.token; renderSettings(); uploadShareImage()}
    catch(x){await info("Couldn't create the link","Error "+(x.status||"network")+". A 404 means the server.js on your host is out of date: replace it and restart the container.")}
  }
  else if(a==="stopshare"){
    if(!await confirmDlg("Stop sharing?","The link will stop working for everyone who has it.","Stop sharing",true)) return;
    try{await api("DELETE","/api/share"); shareTok=null; renderSettings()}catch(x){await info("Couldn't stop sharing","Error "+(x.status||"network"))}
  }
  else if(a==="copyshare"){
    const i=$("slink"); i.select(); uploadShareImage();
    try{await navigator.clipboard.writeText(i.value)}catch(x){document.execCommand&&document.execCommand("copy")}
    $("cmsg").textContent="Copied";
  }
  else if(a==="save"){ view="role"; render(); window.scrollTo&&window.scrollTo(0,0); }
  else if(a==="newlist") openBuilder(null);
  else if(a==="editlist") openBuilder("c:"+id);
  else if(a==="dellist") deleteList(id);
  else if(a==="export") $("exp").click();
  else if(a==="import") $("imp").click();
  else if(a==="resetall"){
    if(!await confirmDlg("Reset all progress?","Every list will be cleared"+(session?", including your saved account progress":"")+". Your custom lists are kept.","Reset everything",true)) return;
    for(const k in all) if(k!=="__lists") delete all[k]; save(); render();}
});
$("settings").addEventListener("change",e=>{if(e.target.id==="stheme"){try{localStorage.setItem(THEME_KEY,e.target.value)}catch(x){} applyTheme()}});
$("editlist").onclick=()=>openBuilder(role);
