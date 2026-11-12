let pwEdit=false, emailEdit=false;
function methodsHtml(){
  if(acct===undefined){ loadAcct(); return "<h3>Sign-in methods</h3><p><small>Loading…</small></p>"; }
  if(!acct) return "";
  const on=k=>logins.includes(k), rows=[];
  const row=(lab,sub,btns)=>`<div class="row"><span class="mlab">${lab}${sub?`<small>${sub}</small>`:""}</span>${btns||""}</div>`;
  if(on("google")){
    if(!acct.google&&!gReady&&!gLoading) loadGIS(()=>{},()=>{});
    rows.push(acct.google?row("Google",esc(acct.google.email||"Linked"),`<button class="danger" data-s="unlink" data-k="google">Unlink</button>`)
      :row("Google","Not linked",`<button data-s="link-google">Link Google</button>`));
  }
  if(on("discord")) rows.push(acct.discord?row("Discord",esc(acct.discord.name),`<button class="danger" data-s="unlink" data-k="discord">Unlink</button>`)
      :row("Discord","Not linked",`<button data-s="link-discord">Link Discord</button>`));
  if(on("password")||on("magic")){
    const why=[on("magic")?"magic links":"",on("password")?"password resets":""].filter(Boolean).join(" and ");
    rows.push(emailEdit
      ?`<div class="row"><input class="fld" id="semail" type="email" placeholder="you@example.com" autocomplete="email" maxlength="200"><button data-s="email-send">Send confirmation</button><button data-s="email-cancel">Cancel</button><small id="amsg"></small></div>`
      :acct.email?row("Email",esc(acct.email)+" · used for "+why)
      :row("Email","None yet. Add one for "+why,`<button data-s="email-add">Add email</button>`));
  }
  if(on("password")){
    if(pwEdit) rows.push(`<div class="row pwf">${acct.hasPassword?`<input class="fld" id="spw-cur" type="password" placeholder="Current password" autocomplete="current-password" maxlength="200">`:""}<input class="fld" id="spw-new" type="password" placeholder="New password (8+ characters)" autocomplete="new-password" maxlength="200"><input class="fld" id="spw-user" placeholder="Username (optional)" autocomplete="username" maxlength="30" value="${esc(acct.handle||(acct.hasPassword?"":acct.name||""))}"><button class="pri" data-s="pw-save">Save</button><button data-s="pw-cancel">Cancel</button><small id="amsg"></small></div>`);
    else if(acct.hasPassword) rows.push(row("Username &amp; password",acct.handle?"Log in with “"+esc(acct.handle)+"” or your email":"Log in with your email",`<button data-s="pw-edit">Change</button><button class="danger" data-s="unlink" data-k="password">Remove</button>`));
    else rows.push(row("Username &amp; password",acct.email?"Not set":"Add an email first",acct.email?`<button data-s="pw-edit">Add password</button>`:""));
  }
  return `<h3>Sign-in methods</h3><p><small>Link more ways to log in to this same account and progress. <span id="amsg2"></span></small></p>${rows.join("")}`;
}
function renderSettings(){
  if(view!=="settings") return;
  const lists=all.__lists||[]; let theme="auto"; try{theme=localStorage.getItem(THEME_KEY)||"auto"}catch(e){}
  const acctHtml=session
    ?`<p>Logged in as <b>${esc(session.label||session.email||"")}</b></p>
      ${nameEdit
        ?`<div class="row"><input class="fld" id="sname" maxlength="40" value="${esc(session.given||session.name||"")}"><button data-s="savename">Save name</button><small id="smsg"></small></div>`
        :`<div class="row"><span>Name: <b>${esc(session.given||session.name||"")}</b></span><button data-s="editname">Edit</button><small id="smsg"></small></div>`}`
    :authOn?`<p>You're not logged in. Progress is saved in this browser only.</p><button class="pri" data-s="login">Log in / Sign up</button>`
    :`<p>Accounts aren't available on this site. Progress is saved in this browser only.</p>`;
  const link=shareTok?location.origin+"/s/"+shareTok:"";
  const share=session?(shareTok===undefined?(loadShare(),"<p><small>Loading…</small></p>"):shareTok
    ?`<p>Anyone with this link can view your progress, but can't change anything.</p>
      <div class="row"><input class="fld" id="slink" readonly value="${esc(link)}" style="flex:1;min-width:200px"><button data-s="copyshare">Copy</button><small id="cmsg"></small></div>
      <div class="row"><button data-s="newshare">New link</button><button class="danger" data-s="stopshare">Stop sharing</button></div>`
    :`<p>Create a link your friends can open to see your progress. It's read-only.</p><button data-s="mkshare">Create share link</button>`)
    :authOn?"<p><small>Log in to create a share link.</small></p>":"<p><small>Sharing needs an account.</small></p>";
  $("settings").innerHTML=`<h3>Account</h3>${acctHtml}
    ${session&&authOn?methodsHtml():""}
    <h3>Share your progress</h3>${share}
    <h3>Preferences</h3><div class="row"><label for="stheme">Theme</label><select class="fld" id="stheme">${["auto","light","dark"].map(t=>`<option value="${t}"${t===theme?" selected":""}>${t[0].toUpperCase()+t.slice(1)}</option>`).join("")}</select></div>
    <h3>Your lists</h3>${lists.map(l=>`<div class="row"><span>${esc(l.name)} <small>(${l.champs.length} champions)</small></span><button data-s="editlist" data-id="${l.id}">Edit</button><button class="danger" data-s="dellist" data-id="${l.id}">Delete</button></div>`).join("")||"<p><small>No custom lists yet.</small></p>"}
    <button data-s="newlist">＋ New list</button>
    <h3>Your data</h3><div class="row"><button data-s="export">Export</button><button data-s="import">Import</button><button class="pri" data-s="save" style="margin-left:auto">Save</button></div>
    <div style="background:#d9534f;color:#fff;font-weight:700;letter-spacing:.6px;text-transform:uppercase;padding:10px 16px;margin:22px -16px 0">Danger Zone</div>
    <div class="row" style="margin-top:14px"><button class="danger" data-s="resetall">Reset all progress</button>${session?'<button class="danger" data-s="delacct">Delete account</button>':""}</div>`;
}
let nameEdit=false;
$("settings").addEventListener("click",async e=>{
  const b=e.target.closest("button"); if(!b) return; const a=b.dataset.s, id=b.dataset.id;
  if(a==="login") openAuth();
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
    const ok=await ask({title:"Delete your account?",body:"This permanently deletes your account and saved progress from the server. Progress stored in this browser is kept.\n\nType DELETE to confirm.",type:"DELETE",cancel:false,
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
