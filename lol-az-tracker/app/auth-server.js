"use strict";
// Login methods for LoLphabet (zero dependencies, Node 18+):
//   Google, Discord, username + password, email magic link, plus linking them to one account.
// Which ones are on is set with LOGIN_TYPES (see docker-compose.yml / .env.example). server.js loads this file.
const crypto=require("crypto");

module.exports=function initAuth(ctx){
  const {db,persist,send,body,baseUrl,clientIp,TTL,rmImg}=ctx, env=process.env;

  // ---------- configuration ----------
  const NAMES={google:"google",discord:"discord",
    password:"password","username and password":"password","username password":"password","email and password":"password","email password":"password",email:"password",
    magic:"magic","magic link":"magic",magiclink:"magic","email link":"magic"};
  const norm=s=>String(s).toLowerCase().replace(/[&\/+_-]+/g," ").replace(/\s+/g," ").trim();
  function parseTypes(raw){
    let s=String(raw||"").trim(), list=null;
    if(s.startsWith("[")){try{list=JSON.parse(s)}catch(e){}}
    if(!Array.isArray(list)) list=s.replace(/^\[|\]$/g,"").split(/[,;|]/);
    const out=[], bad=[];
    for(const x of list.map(v=>norm(String(v).replace(/^["'\s]+|["'\s]+$/g,""))).filter(Boolean)){
      const t=NAMES[x]; if(!t) bad.push(x); else if(!out.includes(t)) out.push(t);
    }
    return {out,bad};
  }
  const G_ID=env.GOOGLE_CLIENT_ID||"", D_ID=env.DISCORD_CLIENT_ID||"", D_SECRET=env.DISCORD_CLIENT_SECRET||"";
  const RESEND_KEY=env.RESEND_API_KEY||"", MAIL_FROM=env.MAIL_FROM||"", REPLY_TO=env.MAIL_REPLY_TO||env.CONTACT_EMAIL||"";
  const MAIL_LIMIT=parseInt(env.MAIL_DAILY_LIMIT,10)||90;          // Resend's free plan allows 100 a day; stay under it
  const RESEND_API=env.RESEND_API_URL||"https://api.resend.com", DISCORD_API=env.DISCORD_API_URL||"https://discord.com/api";
  const GOOGLE_TOKENINFO=env.GOOGLE_TOKENINFO_URL||"https://oauth2.googleapis.com/tokeninfo?access_token=";
  const GOOGLE_USERINFO=env.GOOGLE_USERINFO_URL||"https://www.googleapis.com/oauth2/v3/userinfo";
  const UA="LoLphabet (https://lolphabet.app)";

  const raw=env.LOGIN_TYPES;
  const parsed=parseTypes(raw===undefined||String(raw).trim()===""?(G_ID?"google":""):raw);
  const problems=[];
  if(parsed.bad.length) problems.push("LOGIN_TYPES has unknown entries: "+parsed.bad.map(x=>'"'+x+'"').join(", ")+'. Use any of: Google, Discord, Password (or "Username and password"), Magic link.');
  const TYPES=parsed.out, ON=Object.fromEntries(["google","discord","password","magic"].map(t=>[t,TYPES.includes(t)]));
  const need=(on,names)=>{ if(on) for(const n of names) if(!env[n]) problems.push(n+" is required because it is needed by the login types you enabled."); };
  need(ON.google,["GOOGLE_CLIENT_ID"]);
  need(ON.discord,["DISCORD_CLIENT_ID","DISCORD_CLIENT_SECRET","SITE_URL"]);
  need(ON.password||ON.magic,["RESEND_API_KEY","MAIL_FROM"]);
  if(problems.length){
    console.error("\nLogin configuration problem(s):\n - "+problems.join("\n - ")+"\n\nFix your .env / docker-compose.yml and restart.\n");
    process.exit(1);
  }

  db.authTokens=db.authTokens||{};
  // Accounts created before multiple login types existed were all Google accounts keyed by the Google ID.
  for(const k in db.users){const u=db.users[k]; if(!u.v){u.v=2; if(!u.google) u.google=k; if(u.email&&!u.gmail) u.gmail=u.email; if(!u.custom) u.nameFrom="google"}}
  persist();

  // ---------- small helpers ----------
  const sha=x=>crypto.createHash("sha256").update(x).digest("hex");
  const EMAIL_RE=/^[^\s@<>()\[\]\\,;:"]+@[^\s@<>()\[\]\\,;:"]+\.[^\s@<>()\[\]\\,;:"]{2,}$/;
  const cleanEmail=e=>{e=String(e||"").trim().toLowerCase();return e.length<=200&&EMAIL_RE.test(e)?e:""};
  const cleanName=n=>String(n||"").replace(/[\u0000-\u001f<>]/g," ").replace(/\s+/g," ").trim().slice(0,40);
  const cleanHandle=n=>{n=String(n||"").trim().replace(/\s+/g," ");return /^[A-Za-z0-9][A-Za-z0-9 _.-]{1,28}[A-Za-z0-9]$/.test(n)?n:""};
  const escH=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const hasData=o=>!!o&&Object.values(o).some(r=>r&&typeof r==="object"&&Object.keys(r).length);
  const fail=(res,code,msg,extra)=>{send(res,code,Object.assign({error:msg},extra||{}));return true};
  const ok=(res,obj)=>{send(res,200,obj||{ok:true});return true};
  const ERR={
    TOO_MANY:"Too many attempts. Please wait a while and try again.",
    BAD_LINK:"This link is invalid or has expired. Please request a new one.",
    has_google:"A different Google account is already linked to this account. Unlink it first.",
    has_discord:"A different Discord account is already linked to this account. Unlink it first.",
    LAST:"That's your only way to sign in. Link another sign-in method first."
  };

  const hits=new Map();
  function rl(key,max,ms){const n=Date.now(),a=(hits.get(key)||[]).filter(t=>n-t<ms);if(a.length>=max){hits.set(key,a);return false}a.push(n);hits.set(key,a);return true}
  setInterval(()=>{const n=Date.now();for(const [k,a] of hits) if(!a.length||n-a[a.length-1]>36e5) hits.delete(k)},6e5).unref();

  // One-time tokens (email links, OAuth state, hand-over codes). Only the SHA-256 of the token is stored.
  function mkToken(rec,ttl){
    const t=crypto.randomBytes(32).toString("base64url"), now=Date.now();
    for(const k in db.authTokens) if(db.authTokens[k].exp<now) delete db.authTokens[k];
    db.authTokens[sha(t)]=Object.assign({},rec,{exp:now+ttl}); persist(); return t;
  }
  function getToken(t,types,consume){
    t=String(t||""); if(!/^[\w-]{20,80}$/.test(t)) return null;
    const k=sha(t), r=db.authTokens[k]; if(!r) return null;
    if(consume){delete db.authTokens[k];persist()}
    return r.exp>Date.now()&&(!types||types.includes(r.type))?r:null;
  }

  // Passwords: scrypt with a per-user salt.
  const scrypt=(pw,salt)=>new Promise((res,rej)=>crypto.scrypt(pw,salt,64,{N:16384,r:8,p:1},(e,k)=>e?rej(e):res(k)));
  async function hashPw(pw){const s=crypto.randomBytes(16);return {s:s.toString("base64"),h:(await scrypt(pw,s)).toString("base64")}}
  async function checkPw(pw,rec){const k=await scrypt(pw,Buffer.from(rec.s,"base64")),h=Buffer.from(rec.h,"base64");return h.length===k.length&&crypto.timingSafeEqual(h,k)}
  const DUMMY={s:crypto.randomBytes(16).toString("base64"),h:crypto.randomBytes(64).toString("base64")};   // so unknown users cost the same time as known ones

  // ---------- users ----------
  const find=f=>Object.keys(db.users).find(k=>f(db.users[k]));
  const byGoogle=id=>find(u=>u.google===id), byDiscord=id=>find(u=>u.discord&&u.discord.id===id);
  const byEmail=e=>e?find(u=>String(u.email||"").toLowerCase()===e):undefined;
  const byHandle=h=>find(u=>u.handle&&u.handle.toLowerCase()===String(h).toLowerCase());
  function createUser(f){
    const id="u_"+crypto.randomBytes(12).toString("hex"), name=cleanName(f.name)||(f.email?f.email.split("@")[0].slice(0,40):"Player");
    db.users[id]={v:2,progress:{},name,given:cleanName(f.given)||name};
    if(f.email) db.users[id].email=f.email;
    return id;
  }
  const labelOf=u=>u.email||(u.discord&&"Discord: "+u.discord.name)||u.handle||u.given||u.name||"";
  function sessionFor(uid,isNew){
    const u=db.users[uid], now=Date.now();
    for(const k in db.sessions) if(db.sessions[k].exp<now) delete db.sessions[k];
    const token=crypto.randomBytes(32).toString("hex"); db.sessions[token]={sub:uid,exp:now+TTL}; persist();
    return {token,name:u.name,given:u.given,email:u.email||"",label:labelOf(u),isNew:!!isNew};
  }
  const dropSessions=(uid,except)=>{for(const k in db.sessions) if(db.sessions[k].sub===uid&&k!==except) delete db.sessions[k]};
  const usable=u=>{const a=[];
    if(ON.google&&u.google) a.push("google"); if(ON.discord&&u.discord) a.push("discord");
    if(ON.password&&u.pw&&(u.email||u.handle)) a.push("password"); if(ON.magic&&u.email) a.push("magic"); return a};

  function attach(u,kind,id){
    if(kind==="google"){
      if(!u.google) u.google=id.id;
      if(u.google===id.id){
        const prev=u.gmail; u.gmail=id.email||prev;
        const other=id.email&&byEmail(id.email);
        if(id.email&&id.verified&&(!u.email||u.email===prev)&&(!other||db.users[other]===u)) u.email=id.email;
      }
    }else if(kind==="discord"){
      if(!u.discord||u.discord.id===id.id) u.discord={id:id.id,name:id.name};
      if(!u.email&&id.email&&id.verified&&!byEmail(id.email)) u.email=id.email;
    }
  }
  // Sign in with Google/Discord: known identity -> that account; else an account with the same VERIFIED email; else a new account.
  function oauthLogin(kind,id){
    let uid=kind==="google"?byGoogle(id.id):byDiscord(id.id);
    if(!uid&&id.email&&id.verified) uid=byEmail(id.email);
    if(uid){
      const u=db.users[uid]; attach(u,kind,id);
      if(kind==="google"&&u.google===id.id&&u.nameFrom==="google"&&!u.custom){u.name=id.name||u.name;u.given=id.given||u.name}   // Google keeps the name in sync until the person edits it
      persist(); return {uid,isNew:false};
    }
    uid=createUser({name:id.name,given:id.given,email:id.verified?id.email:""});
    attach(db.users[uid],kind,id); if(kind==="google") db.users[uid].nameFrom="google"; persist(); return {uid,isNew:true};
  }
  // Link from Settings while signed in.
  function linkIdentity(uid,kind,id){
    const u=db.users[uid];
    if(kind==="google"&&u.google&&u.google!==id.id) return {err:"has_google"};
    if(kind==="discord"&&u.discord&&u.discord.id!==id.id) return {err:"has_discord"};
    const other=kind==="google"?byGoogle(id.id):byDiscord(id.id);
    if(other&&other!==uid) return {conflict:other};
    attach(u,kind,id); persist(); return {ok:true};
  }
  // Fold account `src` into `dst` (both proven by the same person in this session). keep: "mine" (dst's progress) | "theirs" (src's).
  function mergeUsers(dst,src,keep){
    const T=db.users[dst], S=db.users[src];
    if(S.google&&!T.google){T.google=S.google;T.gmail=S.gmail}
    if(S.discord&&!T.discord) T.discord=S.discord;
    if(S.pw&&!T.pw){T.pw=S.pw;if(S.handle&&!T.handle)T.handle=S.handle}
    if(!T.email&&S.email) T.email=S.email;
    if(keep==="theirs"||!hasData(T.progress)) T.progress=S.progress;
    if(S.share){delete db.shares[S.share];rmImg(S.share)}
    for(const k in db.templates) if(db.templates[k].sub===src) db.templates[k].sub=dst;
    dropSessions(src); delete db.users[src]; persist();
  }

  // ---------- providers ----------
  async function googleIdent(access_token){
    const ti=await fetch(GOOGLE_TOKENINFO+encodeURIComponent(access_token)), info=await ti.json();
    if(!ti.ok||(info.aud!==G_ID&&info.azp!==G_ID)) return null;
    const ui=await fetch(GOOGLE_USERINFO,{headers:{Authorization:"Bearer "+access_token}}), p=await ui.json();
    if(!ui.ok||!p.sub||(info.sub&&info.sub!==p.sub)||p.email_verified===false) return null;
    const name=cleanName(p.name||p.email)||"Player";
    return {id:String(p.sub),email:cleanEmail(p.email),verified:p.email_verified===true,name,given:cleanName(p.given_name)||name};
  }
  const discordRedirect=req=>baseUrl(req)+"/auth/discord/callback";
  const discordUrl=(req,state)=>"https://discord.com/oauth2/authorize?"+new URLSearchParams({client_id:D_ID,response_type:"code",redirect_uri:discordRedirect(req),scope:"identify email",state}).toString().replace(/\+/g,"%20");
  async function discordIdent(code,req){
    const r=await fetch(DISCORD_API+"/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json","User-Agent":UA},
      body:new URLSearchParams({client_id:D_ID,client_secret:D_SECRET,grant_type:"authorization_code",code,redirect_uri:discordRedirect(req)})});
    const t=await r.json().catch(()=>({})); if(!r.ok||!t.access_token) throw new Error("token exchange failed ("+r.status+")");
    const ur=await fetch(DISCORD_API+"/users/@me",{headers:{Authorization:"Bearer "+t.access_token,"User-Agent":UA}}), p=await ur.json().catch(()=>({}));
    if(!ur.ok||!p.id) throw new Error("profile fetch failed ("+ur.status+")");
    const name=cleanName(p.global_name||p.username)||"Player";
    return {id:String(p.id),email:cleanEmail(p.email),verified:p.verified===true,name,given:name};
  }

  // ---------- email (Resend) ----------
  async function sendMail(to,subject,c){
    const day=new Date().toISOString().slice(0,10); if(!db.mail||db.mail.day!==day) db.mail={day,n:0};
    if(db.mail.n>=MAIL_LIMIT) throw Object.assign(new Error("daily limit"),{limit:true});
    db.mail.n++; persist();
    const msg={from:MAIL_FROM,to:[to],subject,text:c.text,html:c.html}; if(REPLY_TO) msg.reply_to=REPLY_TO;
    let r; try{r=await fetch(RESEND_API+"/emails",{method:"POST",headers:{Authorization:"Bearer "+RESEND_KEY,"Content-Type":"application/json","User-Agent":UA},body:JSON.stringify(msg)})}
    catch(e){db.mail.n--;throw e}
    if(!r.ok){db.mail.n--;throw new Error("Resend "+r.status+": "+(await r.text()).slice(0,300))}
  }
  async function mail(res,to,subject,c){
    try{await sendMail(to,subject,c);return true}
    catch(e){
      console.log("mail error:",e.message);
      fail(res,e.limit?503:502,e.limit?"Email sending has hit its daily limit. Try again tomorrow or use another sign-in method.":"Couldn't send the email right now. Please try again in a few minutes.");
      return false;
    }
  }
  function mailBody(title,intro,btn,link,note){
    return {
      text:title+"\n\n"+intro+"\n\n"+btn+":\n"+link+"\n\n"+note+"\n\n- LoLphabet",
      html:'<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1c1b18"><h2 style="margin:0 0 12px">'+escH(title)+'</h2><p style="line-height:1.5">'+escH(intro)+'</p><p style="margin:24px 0"><a href="'+escH(link)+'" style="background:#d4af37;color:#111;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px;display:inline-block">'+escH(btn)+'</a></p><p style="font-size:13px;color:#6f6b60">Or paste this link into your browser:<br><span style="word-break:break-all">'+escH(link)+'</span></p><p style="font-size:13px;color:#6f6b60">'+escH(note)+'</p></div>'
    };
  }
  const MIN=60e3;

  // ---------- routes that don't need a session ----------
  async function pub(req,res,url){
    const m=req.method, ip=clientIp(req);
    if(url==="/api/config") return ok(res,{googleClientId:ON.google?G_ID:"",login:TYPES});

    if(url==="/api/login"&&m==="POST"){                                   // Google (kept at its original path)
      if(!ON.google) return fail(res,404,"Google sign-in is not enabled");
      if(!rl("login:"+ip,60,15*MIN)) return fail(res,429,ERR.TOO_MANY);
      const {access_token}=await body(req); if(!access_token) return fail(res,400,"missing token");
      const id=await googleIdent(access_token); if(!id) return fail(res,401,"invalid token");
      const r=oauthLogin("google",id); return ok(res,sessionFor(r.uid,r.isNew));
    }

    if(url==="/api/auth/magic"&&m==="POST"){
      if(!ON.magic) return fail(res,404,"Magic links are not enabled");
      const b=await body(req), email=cleanEmail(b.email);
      if(!email) return fail(res,400,"Enter a valid email address.");
      if(!rl("mail:"+email,5,60*MIN)||!rl("mailip:"+ip,15,60*MIN)) return fail(res,429,ERR.TOO_MANY);
      const t=mkToken({type:"magic",email,name:cleanName(b.username||b.name)},15*MIN);
      if(!await mail(res,email,"Your LoLphabet sign-in link",mailBody("Sign in to LoLphabet","Click the button to sign in. If you don't have an account yet, one is created for you.","Sign in",baseUrl(req)+"/#magic="+t,"This link works once and expires in 15 minutes. If you didn't ask for it, you can ignore this email."))) return true;
      return ok(res);
    }

    if(url==="/api/auth/register"&&m==="POST"){
      if(!ON.password) return fail(res,404,"Password sign-in is not enabled");
      const b=await body(req), handle=cleanHandle(b.username), email=cleanEmail(b.email), pw=String(b.password||"");
      if(!handle) return fail(res,400,"Choose a username of 3 to 30 characters: letters, numbers, spaces, dots, dashes or underscores.");
      if(!email) return fail(res,400,"Enter a valid email address.");
      if(pw.length<8||pw.length>200) return fail(res,400,"Your password needs to be at least 8 characters.");
      if(!rl("reg:"+ip,10,60*MIN)||!rl("mail:"+email,5,60*MIN)) return fail(res,429,ERR.TOO_MANY);
      if(byHandle(handle)) return fail(res,409,"That username is taken. Please choose another.");
      const base=baseUrl(req);
      if(byEmail(email)){
        if(!await mail(res,email,"You already have a LoLphabet account",mailBody("You already have an account","Someone (hopefully you) tried to create a LoLphabet account with this email address, but one already exists. You can sign in with a magic link or reset your password from the login window.","Open LoLphabet",base+"/","If this wasn't you, you can ignore this email. Nothing has changed."))) return true;
      }else{
        const t=mkToken({type:"signup",email,handle,pw:await hashPw(pw)},60*MIN);
        if(!await mail(res,email,"Confirm your LoLphabet account",mailBody("Confirm your email","Click the button to finish creating your LoLphabet account as “"+handle+"”.","Confirm and sign in",base+"/#signup="+t,"This link works once and expires in 1 hour. If you didn't sign up, you can ignore this email."))) return true;
      }
      return ok(res);
    }

    if(url==="/api/auth/password"&&m==="POST"){
      if(!ON.password) return fail(res,404,"Password sign-in is not enabled");
      const b=await body(req), login=String(b.login||"").trim().toLowerCase().slice(0,200), pw=String(b.password||"").slice(0,200);
      if(!login||!pw) return fail(res,400,"Enter your username or email and your password.");
      if(!rl("pw:"+ip,30,15*MIN)||!rl("pwl:"+login,8,15*MIN)) return fail(res,429,ERR.TOO_MANY);
      const uid=byHandle(login)||byEmail(login), u=uid&&db.users[uid];
      const good=await checkPw(pw,u&&u.pw||DUMMY);
      if(!u||!u.pw||!good) return fail(res,401,"Wrong username/email or password.");
      return ok(res,sessionFor(uid,false));
    }

    if(url==="/api/auth/forgot"&&m==="POST"){
      if(!ON.password) return fail(res,404,"Password sign-in is not enabled");
      const email=cleanEmail((await body(req)).email);
      if(!email) return fail(res,400,"Enter a valid email address.");
      if(!rl("mail:"+email,5,60*MIN)||!rl("mailip:"+ip,15,60*MIN)) return fail(res,429,ERR.TOO_MANY);
      const uid=byEmail(email);
      if(uid){
        const t=mkToken({type:"reset",uid},30*MIN);
        if(!await mail(res,email,"Reset your LoLphabet password",mailBody("Reset your password","Click the button to choose a new password for your LoLphabet account.","Choose a new password",baseUrl(req)+"/#reset="+t,"This link works once and expires in 30 minutes. If you didn't ask for it, you can ignore this email and your password stays as it is."))) return true;
      }
      return ok(res);                                                       // same answer whether or not the email has an account
    }

    if(url==="/api/auth/reset"&&m==="POST"){
      if(!ON.password) return fail(res,404,"Password sign-in is not enabled");
      const b=await body(req), pw=String(b.password||"");
      if(pw.length<8||pw.length>200) return fail(res,400,"Your password needs to be at least 8 characters.");
      if(!rl("verify:"+ip,30,60*MIN)) return fail(res,429,ERR.TOO_MANY);
      const rec=getToken(b.token,["reset"],true), u=rec&&db.users[rec.uid];
      if(!u) return fail(res,400,ERR.BAD_LINK);
      u.pw=await hashPw(pw); dropSessions(rec.uid); persist();             // a reset signs every other device out
      return ok(res,sessionFor(rec.uid,false));
    }

    if(url==="/api/auth/verify"&&m==="POST"){
      if(!rl("verify:"+ip,30,60*MIN)) return fail(res,429,ERR.TOO_MANY);
      const rec=getToken((await body(req)).token,["magic","signup","addemail","exchange"],true);
      if(!rec) return fail(res,400,ERR.BAD_LINK);
      if(rec.type==="exchange"){ if(!db.users[rec.uid]) return fail(res,400,ERR.BAD_LINK); return ok(res,sessionFor(rec.uid,rec.isNew)); }
      if(rec.type==="magic"){
        let uid=byEmail(rec.email), isNew=false;
        if(!uid){uid=createUser({name:rec.name,email:rec.email});isNew=!rec.name}
        return ok(res,sessionFor(uid,isNew));
      }
      if(rec.type==="signup"){
        if(byHandle(rec.handle)||byEmail(rec.email)) return fail(res,409,"That username or email was taken in the meantime. Please sign up again.");
        const uid=createUser({name:rec.handle,email:rec.email}); Object.assign(db.users[uid],{handle:rec.handle,pw:rec.pw});
        return ok(res,sessionFor(uid,false));
      }
      if(rec.type==="addemail"){
        const u=db.users[rec.uid]; if(!u) return fail(res,400,ERR.BAD_LINK);
        const o=byEmail(rec.email); if(o&&o!==rec.uid) return fail(res,409,"That email address is already used by another account.");
        if(!u.email) u.email=rec.email;
        return ok(res,sessionFor(rec.uid,false));
      }
    }

    if(url==="/api/auth/discord/start"&&m==="POST"){
      if(!ON.discord) return fail(res,404,"Discord sign-in is not enabled");
      if(!rl("dstart:"+ip,30,60*MIN)) return fail(res,429,ERR.TOO_MANY);
      return ok(res,{url:discordUrl(req,mkToken({type:"dstate",mode:"login"},10*MIN))});
    }
    if(url==="/auth/discord/callback"&&m==="GET"){
      const q=new URL(req.url,"http://x").searchParams, base=baseUrl(req);
      const go=h=>{res.writeHead(302,{Location:base+"/#"+h,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"});res.end();return true};
      if(!ON.discord) return go("autherr=disabled");
      if(!rl("dcb:"+ip,30,15*MIN)) return go("autherr=failed");
      const st=getToken(q.get("state"),["dstate"],true);
      if(!st) return go("autherr=expired");
      if(q.get("error")||!q.get("code")) return go("autherr=cancelled");
      let id; try{id=await discordIdent(q.get("code"),req)}catch(e){console.log("discord:",e.message);return go("autherr=failed")}
      if(st.mode==="link"){
        if(!db.users[st.uid]) return go("autherr=failed");
        const r=linkIdentity(st.uid,"discord",id);
        if(r.err) return go("autherr="+r.err);
        if(r.conflict) return go("merge="+mkToken({type:"merge",uid:st.uid,other:r.conflict,kind:"discord"},10*MIN));
        return go("linked=discord");
      }
      const r=oauthLogin("discord",id);
      return go("exchange="+mkToken({type:"exchange",uid:r.uid,isNew:r.isNew},2*MIN));
    }
    return false;
  }

  // ---------- routes for a signed-in user (`sub` is their user id) ----------
  async function authed(req,res,url,sub){
    const m=req.method, u=db.users[sub], ip=clientIp(req);
    if(!u) return false;
    if(url==="/api/account"&&m==="GET")
      return ok(res,{email:u.email||"",name:u.given||u.name,handle:u.handle||"",hasPassword:!!u.pw,
        google:u.google?{email:u.gmail||""}:null,discord:u.discord?{name:u.discord.name}:null});

    if(url==="/api/account/email"&&m==="POST"){
      if(!ON.password&&!ON.magic) return fail(res,404,"Email sign-in is not enabled");
      if(u.email) return fail(res,400,"This account already has an email address.");
      const email=cleanEmail((await body(req)).email); if(!email) return fail(res,400,"Enter a valid email address.");
      if(byEmail(email)) return fail(res,409,"That email address is already used by another account. Sign in to that account and link this one from its Settings instead.");
      if(!rl("mail:"+email,5,60*MIN)||!rl("mailip:"+ip,15,60*MIN)) return fail(res,429,ERR.TOO_MANY);
      const t=mkToken({type:"addemail",uid:sub,email},60*MIN);
      if(!await mail(res,email,"Confirm your email for LoLphabet",mailBody("Confirm your email","Click the button to add this email address to your LoLphabet account.","Confirm email",baseUrl(req)+"/#addemail="+t,"This link works once and expires in 1 hour. If you didn't ask for it, you can ignore this email."))) return true;
      return ok(res);
    }

    if(url==="/api/account/password"&&m==="PUT"){
      if(!ON.password) return fail(res,404,"Password sign-in is not enabled");
      const b=await body(req), pw=String(b.password||"");
      if(!u.email) return fail(res,400,"Add an email address first. It's used for password resets.");
      if(pw.length<8||pw.length>200) return fail(res,400,"Your password needs to be at least 8 characters.");
      if(!rl("pwchg:"+sub,10,15*MIN)) return fail(res,429,ERR.TOO_MANY);
      if(u.pw&&!await checkPw(String(b.current||"").slice(0,200),u.pw)) return fail(res,403,"Your current password is wrong.");
      const want=String(b.username||"").trim();
      if(want){const h=cleanHandle(want); if(!h) return fail(res,400,"Usernames are 3 to 30 characters: letters, numbers, spaces, dots, dashes or underscores.");
        const o=byHandle(h); if(o&&o!==sub) return fail(res,409,"That username is taken. Please choose another."); u.handle=h}
      else delete u.handle;
      u.pw=await hashPw(pw); dropSessions(sub,(req.headers.authorization||"").replace("Bearer ","")); persist();
      return ok(res);
    }

    let lm=url.match(/^\/api\/account\/link\/(google|discord|password)$/);
    if(lm&&m==="DELETE"){
      const k=lm[1], copy=Object.assign({},u); if(k==="password"){delete copy.pw;delete copy.handle}else delete copy[k];
      if(!usable(copy).length) return fail(res,400,ERR.LAST);
      if(k==="password"){delete u.pw;delete u.handle}else{delete u[k];if(k==="google")delete u.gmail}
      persist(); return ok(res);
    }
    if(url==="/api/account/link/google"&&m==="POST"){
      if(!ON.google) return fail(res,404,"Google sign-in is not enabled");
      if(!rl("link:"+sub,20,15*MIN)) return fail(res,429,ERR.TOO_MANY);
      const id=await googleIdent((await body(req)).access_token); if(!id) return fail(res,401,"invalid token");
      const r=linkIdentity(sub,"google",id);
      if(r.err) return fail(res,409,ERR[r.err],{code:r.err});
      if(r.conflict) return fail(res,409,"in_use",{code:"in_use",merge:mkToken({type:"merge",uid:sub,other:r.conflict,kind:"google"},10*MIN)});
      return ok(res);
    }
    if(url==="/api/account/link/discord/start"&&m==="POST"){
      if(!ON.discord) return fail(res,404,"Discord sign-in is not enabled");
      if(!rl("link:"+sub,20,15*MIN)) return fail(res,429,ERR.TOO_MANY);
      return ok(res,{url:discordUrl(req,mkToken({type:"dstate",mode:"link",uid:sub},10*MIN))});
    }
    if(url==="/api/account/merge/info"&&m==="POST"){
      const rec=getToken((await body(req)).token,["merge"],false), S=rec&&rec.uid===sub&&db.users[rec.other];
      if(!S) return fail(res,400,ERR.BAD_LINK);
      return ok(res,{kind:rec.kind,name:S.given||S.name,email:S.email||"",otherHas:hasData(S.progress),mineHas:hasData(u.progress)});
    }
    if(url==="/api/account/merge"&&m==="POST"){
      const b=await body(req), rec=getToken(b.token,["merge"],true);
      if(!rec||rec.uid!==sub||!db.users[rec.other]||rec.other===sub||!["mine","theirs"].includes(b.keep)) return fail(res,400,ERR.BAD_LINK);
      mergeUsers(sub,rec.other,b.keep); return ok(res);
    }
    return false;
  }

  return {types:TYPES,on:ON,pub,authed};
};
