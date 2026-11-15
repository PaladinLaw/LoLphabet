"use strict";
// Hidden admin panel for LoLphabet (zero dependencies, Node 18+). server.js loads this file.
//
// How it is locked down (all of these must pass, otherwise the request behaves as if the address does not exist):
//   1. The panel lives at a secret address (ADMIN_PATH). It is never linked, never in robots.txt or the sitemap, and sent with noindex headers.
//   2. Every /api/admin/* call needs a normal signed-in session that belongs to an account listed in ADMIN_USER_IDS.
//      For anyone else the routes simply do not exist (same answer as any unknown URL).
//   3. A second factor you know: ADMIN_PASSPHRASE. Unlocking gives a short-lived token that lives in server memory only,
//      is tied to the session it was issued for, and expires after ADMIN_IDLE_MINUTES of silence (8 hours at most).
//   4. Strict rate limits and a lockout on passphrase attempts, an Origin check and a custom header on every call (no CSRF),
//      a strict CSP on the page, and an audit log of everything that happens.
//   5. Every change snapshots the account first, so mistakes can be undone from the History tab.
const crypto=require("crypto"),fs=require("fs"),path=require("path");

module.exports=function initAdmin(ctx){
  const {db,persist,body,baseUrl,clientIp,userOf,token,AUTH,rmImg,TTL,FILE}=ctx, env=process.env, U=AUTH.util;
  const OFF={enabled:false,route:async()=>false};

  // ---------- configuration ----------
  const ADMIN_PATH=String(env.ADMIN_PATH||"").trim().replace(/^\/+|\/+$/g,"");
  const IDS=new Set(String(env.ADMIN_USER_IDS||"").split(/[\s,;]+/).filter(Boolean));
  const PASS=String(env.ADMIN_PASSPHRASE||"");
  if(!ADMIN_PATH&&!IDS.size&&!PASS){console.log("Admin panel: off (set ADMIN_PATH, ADMIN_USER_IDS and ADMIN_PASSPHRASE to turn it on)");return OFF}
  const problems=[];
  if(!/^[A-Za-z0-9_-]{16,64}$/.test(ADMIN_PATH)) problems.push("ADMIN_PATH must be 16 to 64 letters, numbers, - or _ (it is the secret address of the panel).");
  if(!IDS.size) problems.push("ADMIN_USER_IDS is empty (the internal user id of the admin account, see the README).");
  if(PASS.length<8) problems.push("ADMIN_PASSPHRASE must be at least 8 characters.");
  if(problems.length){console.error("\nAdmin panel NOT started:\n - "+problems.join("\n - ")+"\n");return OFF}
  const IDLE=Math.max(2,parseInt(env.ADMIN_IDLE_MINUTES,10)||20)*60e3, ABS=8*36e5, MIN=60e3;

  db.adminMeta=db.adminMeta||{};
  const DIR=path.join(path.dirname(FILE),"admin"), BK=path.join(DIR,"backups"), AUDIT=path.join(DIR,"audit.log");
  try{fs.mkdirSync(BK,{recursive:true,mode:0o700})}catch(e){console.log("admin dir:",e.message)}

  // ---------- small helpers ----------
  const sha=x=>crypto.createHash("sha256").update(x).digest();
  const safeEq=(a,b)=>crypto.timingSafeEqual(sha(String(a)),sha(String(b)));
  const hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const isObj=o=>!!o&&typeof o==="object"&&!Array.isArray(o);
  const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
  const has=uid=>hasOwn(db.users,uid);
  const isAdminId=uid=>IDS.has(uid);
  const today=()=>new Date().toISOString().slice(0,10);
  const validDate=s=>typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s+"T00:00:00Z"))&&s<=new Date(Date.now()+864e5).toISOString().slice(0,10);
  const safeId=s=>String(s).replace(/[^\w-]/g,"_");
  const mask=e=>{e=String(e||"");const i=e.indexOf("@");return i<2?e:e[0]+"***"+e.slice(i-1)};
  const KEY_RE=/^[\w .:&'|+\/-]{1,80}$/, NAME_RE=/^[\p{L}\p{N} .'&-]{1,40}$/u;
  const MODE_NUZ=m=>m==="nuzlocke"||m==="randnuz";
  const modeOf=k=>{const i=k.indexOf("|");return i<0?"classic":k.slice(i+1)};
  const metaOf=uid=>db.adminMeta[uid]||(db.adminMeta[uid]={});

  const SEC={"Cache-Control":"no-store, no-cache, must-revalidate","Pragma":"no-cache","X-Robots-Tag":"noindex, nofollow, noarchive, nosnippet","Referrer-Policy":"no-referrer",
    "X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Resource-Policy":"same-origin",
    "Permissions-Policy":"camera=(), microphone=(), geolocation=(), payment=(), usb=()"};
  const CSP="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https://ddragon.leagueoflegends.com; connect-src 'self' https://ddragon.leagueoflegends.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  const out=(res,code,obj,extra)=>{res.writeHead(code,{...SEC,"Content-Type":"application/json; charset=utf-8",...(extra||{})});res.end(JSON.stringify(obj));return true};

  const hits=new Map();
  function rl(key,max,ms){const n=Date.now(),a=(hits.get(key)||[]).filter(t=>n-t<ms);if(a.length>=max){hits.set(key,a);return false}a.push(n);hits.set(key,a);return true}
  setInterval(()=>{const n=Date.now();for(const [k,a] of hits) if(!a.length||n-a[a.length-1]>36e5) hits.delete(k);for(const [k,r] of tokens) if(r.exp<n||r.abs<n) tokens.delete(k)},5*MIN).unref();
  let failures=[];                                   // timestamps of wrong passphrases (global lockout)
  const lockedOut=()=>{const n=Date.now();failures=failures.filter(t=>n-t<36e5);return failures.length>=10};

  // ---------- audit log (append-only file next to the data) ----------
  function audit(req,actor,action,target,detail,ok){
    const rec={t:Date.now(),by:actor||null,action,target:target||null,ip:req?clientIp(req):null,ok:ok!==false,detail:detail||null};
    try{
      try{if(fs.statSync(AUDIT).size>5e6) fs.renameSync(AUDIT,AUDIT+".1")}catch(e){}
      fs.appendFileSync(AUDIT,JSON.stringify(rec)+"\n",{mode:0o600});
    }catch(e){console.log("audit write failed:",e.message)}
  }
  function readAudit(limit,target,q){
    let lines=[]; for(const f of [AUDIT+".1",AUDIT]){try{lines=lines.concat(fs.readFileSync(f,"utf8").split("\n"))}catch(e){}}
    const outp=[]; q=String(q||"").toLowerCase();
    for(let i=lines.length-1;i>=0&&outp.length<limit;i--){
      if(!lines[i]) continue; let r; try{r=JSON.parse(lines[i])}catch(e){continue}
      if(target&&r.target!==target) continue;
      if(q&&!JSON.stringify(r).toLowerCase().includes(q)) continue;
      outp.push(r);
    }
    return outp;
  }

  // ---------- snapshots: taken before every change so it can be undone ----------
  function snapshot(uid,action,coalesceMs){
    const u=db.users[uid]; if(!u) return null;
    const dir=path.join(BK,safeId(uid)); fs.mkdirSync(dir,{recursive:true,mode:0o700});
    let files=fs.readdirSync(dir).filter(f=>/\.json$/.test(f)).sort();
    const act=safeId(action).slice(0,30);
    if(coalesceMs&&files.length){const last=files[files.length-1], m=last.match(/^(\d+)-([\w-]+)-[0-9a-f]{4}\.json$/); if(m&&m[2]===act&&Date.now()-(+m[1])<coalesceMs) return last}
    const ts=Date.now(), f=ts+"-"+act+"-"+crypto.randomBytes(2).toString("hex")+".json", tpl={};
    for(const k in db.templates) if(db.templates[k].sub===uid) tpl[k]=db.templates[k];
    fs.writeFileSync(path.join(dir,f),JSON.stringify({v:1,ts,action,uid,user:u,templates:tpl,meta:db.adminMeta[uid]||null}),{mode:0o600});
    files.push(f); while(files.length>40){try{fs.unlinkSync(path.join(dir,files.shift()))}catch(e){break}}
    return f;
  }
  function listBackups(uid){
    const dir=path.join(BK,safeId(uid)); let files=[]; try{files=fs.readdirSync(dir).filter(f=>/^\d+-[\w-]+-[0-9a-f]{4}\.json$/.test(f))}catch(e){}
    return files.sort().reverse().map(f=>{const m=f.match(/^(\d+)-([\w-]+)-[0-9a-f]{4}\.json$/); let size=0; try{size=fs.statSync(path.join(dir,f)).size}catch(e){} return {file:f,ts:+m[1],action:m[2],size}});
  }
  function readBackup(uid,file){
    if(!/^\d+-[\w-]+-[0-9a-f]{4}\.json$/.test(String(file))) return null;
    try{const s=JSON.parse(fs.readFileSync(path.join(BK,safeId(uid),file),"utf8")); return s&&s.uid===uid&&isObj(s.user)?s:null}catch(e){return null}
  }

  // ---------- progress helpers ----------
  // db.users[id].progress = { "<list>" or "<list>|<mode>": { "<champion>": {won,date,games,note,wins,dead,diedOn}, __meta:{...} }, __lists:[custom lists] }
  const ensureProg=u=>(isObj(u.progress)?u.progress:(u.progress={}));
  const runKeys=p=>Object.keys(p).filter(k=>!k.startsWith("__")&&isObj(p[k]));
  const bump=u=>{u.rev=(u.rev||0)+1};                         // tells open browser tabs that their copy is stale
  function labelOf(p,k){const l=k.split("|")[0]; if(l.startsWith("c:")){const c=(Array.isArray(p.__lists)?p.__lists:[]).find(x=>x&&("c:"+x.id)===l);return c&&c.name||"Custom list"} return l.includes(":")?l.split(":")[1]:l}
  // The app creates a blank entry ({won:false,games:0}) for any champion it merely looks at. Those are not progress and are ignored here.
  const real=s=>isObj(s)&&!!(s.won||s.date||(s.games|0)>0||s.note||(s.wins|0)>0||s.dead);
  function sumKey(p,k){
    const run=p[k], mode=modeOf(k); let entries=0,won=0,dead=0,wins=0,games=0;
    for(const n of Object.keys(run)){ if(n==="__meta") continue; const s=run[n]; if(!real(s)) continue; entries++; games+=(s.games|0);
      if(MODE_NUZ(mode)){wins+=(s.wins|0); if(s.dead) dead++} else if(s.won) won++; }
    const mt=isObj(run.__meta)?(+run.__meta.t||0):0;
    return {key:k,label:labelOf(p,k),mode,entries,won,dead,wins,games,last:mt||null};
  }
  function sessIndex(){const ix={},now=Date.now();for(const k in db.sessions){const s=db.sessions[k]; if(s.exp<=now) continue; const r=ix[s.sub]||(ix[s.sub]={n:0,max:0}); r.n++; if(s.exp>r.max) r.max=s.exp} return ix}
  function light(uid,six){
    const u=db.users[uid], p=isObj(u.progress)?u.progress:{}; let wins=0,last=0,lists=0;
    for(const k of runKeys(p)){const s=sumKey(p,k); wins+=MODE_NUZ(s.mode)?s.wins:s.won; if(s.last&&s.last>last) last=s.last; if(s.entries) lists++}
    const se=(six||sessIndex())[uid]||{n:0,max:0}, ll=Math.max(u.lastLogin||0,se.max?se.max-TTL:0)||null, md=db.adminMeta[uid]||{};
    return {id:uid,name:u.given||u.name||"",handle:u.handle||"",email:u.email||"",
      p:{google:!!u.google,discord:!!u.discord,password:!!u.pw,email:!!u.email},discordName:u.discord?u.discord.name:"",
      wins,lists,last:last||null,created:u.created||null,lastLogin:ll,sessions:se.n,suspended:!!md.suspended,admin:isAdminId(uid),hasNote:!!md.note,share:!!u.share};
  }
  function dupGroups(){
    const g=new Map(), add=(key,why,weak,uid)=>{let r=g.get(key); if(!r) g.set(key,r={why,weak,ids:new Set()}); r.ids.add(uid)};
    for(const uid of Object.keys(db.users)){
      const u=db.users[uid];
      for(const e of [u.email,u.gmail]) if(e) add("e:"+String(e).toLowerCase(),"Same email address: "+e,false,uid);
      const n=String(u.given||u.name||"").trim().toLowerCase(); if(n.length>=3&&n!=="player") add("n:"+n,"Same display name: "+(u.given||u.name),true,uid);
    }
    const six=sessIndex(), res=[];
    for(const r of g.values()) if(r.ids.size>1) res.push({why:r.why,weak:r.weak,users:[...r.ids].map(id=>light(id,six))});
    return res.sort((a,b)=>a.weak-b.weak);
  }
  function combineChamp(a,b,mode){
    if(!a.note&&b.note) a.note=b.note;
    if(MODE_NUZ(mode)){
      a.wins=Math.max(a.wins|0,b.wins|0); a.dead=!!(a.dead||b.dead);
      if(a.dead){const d=[a.dead&&a.diedOn,b.dead&&b.diedOn].filter(Boolean).sort(); a.diedOn=d[0]||today()} else delete a.diedOn;
      a.games=a.wins+(a.dead?1:0);
    }else{
      const aw=!!a.won, bw=!!b.won; a.won=aw||bw;
      if(a.won){const d=[aw&&a.date,bw&&b.date].filter(Boolean).sort(); a.date=d[0]||a.date||b.date||today()} else a.date=null;
      a.games=Math.max(a.games|0,b.games|0);
    }
  }
  // "Best of both": a champion counts as won / fallen if it is on either account, with the earliest date and the higher counts.
  function combineProgress(A,B){
    const out=clone(isObj(A)?A:{}); B=isObj(B)?B:{};
    for(const k of Object.keys(B)){
      if(k==="__lists"){const have=new Set((out.__lists||[]).map(l=>l&&l.id)); out.__lists=(Array.isArray(out.__lists)?out.__lists:[]).concat((Array.isArray(B.__lists)?B.__lists:[]).filter(l=>l&&!have.has(l.id)).map(clone)); continue}
      if(k.startsWith("__")){if(!hasOwn(out,k)) out[k]=clone(B[k]); continue}
      const rb=B[k]; if(!isObj(rb)) continue;
      if(!hasOwn(out,k)||!isObj(out[k])){out[k]=clone(rb); continue}
      const ra=out[k], mode=modeOf(k);
      for(const n of Object.keys(rb)){
        if(n==="__meta"){ if(!isObj(ra.__meta)||(isObj(rb.__meta)&&(+rb.__meta.t||0)>(+ra.__meta.t||0))) ra.__meta=clone(rb.__meta); continue }
        if(!isObj(rb[n])) continue;
        if(!hasOwn(ra,n)||!isObj(ra[n])) ra[n]=clone(rb[n]); else combineChamp(ra[n],rb[n],mode);
      }
    }
    return out;
  }
  function cleanFields(f,nz){
    const set={}, bad=m=>({err:m});
    for(const k of Object.keys(f)){
      const v=f[k];
      if(k==="note"){ const n=String(v==null?"":v).replace(/[\u0000-\u001f]/g," ").trim().slice(0,1000); set.note=n; }
      else if(k==="won"||k==="dead"){ if(typeof v!=="boolean") return bad(k+" must be true or false."); if(k==="won"&&nz) return bad("'won' is not used in Nuzlocke."); if(k==="dead"&&!nz) return bad("'dead' only applies to Nuzlocke."); set[k]=v }
      else if(k==="date"||k==="diedOn"){ if(v!==null&&!validDate(v)) return bad(k+" must be a date like 2026-11-14."); if(k==="date"&&nz) return bad("'date' is not used in Nuzlocke."); if(k==="diedOn"&&!nz) return bad("'diedOn' only applies to Nuzlocke."); set[k]=v }
      else if(k==="games"||k==="wins"){ if(!Number.isInteger(v)||v<0||v>9999) return bad(k+" must be a whole number from 0 to 9999."); if(k==="wins"&&!nz) return bad("'wins' only applies to Nuzlocke."); set[k]=v }
      else return bad("Unknown field "+k+".");
    }
    return {set};
  }
  function applyChamp(s,set,nz){
    for(const k of Object.keys(set)){ if(k==="note"){ if(set.note) s.note=set.note; else delete s.note } else s[k]=set[k] }
    if(nz){ s.wins=s.wins|0; if(s.dead){ if(!s.diedOn) s.diedOn=today() } else delete s.diedOn; s.games=s.wins+(s.dead?1:0); if(!("won" in s)) s.won=false; if(!("date" in s)) s.date=null }
    else { if(s.won){ if(!s.date) s.date=today(); if(!(s.games>0)) s.games=1 } else s.date=null }
  }

  // ---------- unlock tokens (memory only) ----------
  const tokens=new Map();
  function issue(uid,req){
    const t=crypto.randomBytes(32).toString("base64url"), now=Date.now();
    tokens.set(sha(t).toString("hex"),{uid,sess:sha(token(req)).toString("hex"),exp:now+IDLE,abs:now+ABS}); return t;
  }
  function unlocked(req,uid){
    const t=String(req.headers["x-admin-token"]||""); if(!/^[\w-]{20,80}$/.test(t)) return false;
    const k=sha(t).toString("hex"), r=tokens.get(k), now=Date.now();
    if(!r) return false;
    if(r.exp<now||r.abs<now||r.uid!==uid||r.sess!==sha(token(req)).toString("hex")){tokens.delete(k);return false}
    r.exp=now+IDLE; return true;
  }

  // ---------- user detail ----------
  function detail(uid,req){
    const u=db.users[uid], p=isObj(u.progress)?u.progress:{}, md=db.adminMeta[uid]||{}, now=Date.now();
    const sessions=Object.keys(db.sessions).filter(k=>db.sessions[k].sub===uid&&db.sessions[k].exp>now)
      .map(k=>({id:sha(k).toString("hex").slice(0,12),signedIn:db.sessions[k].exp-TTL,exp:db.sessions[k].exp})).sort((a,b)=>b.signedIn-a.signedIn);
    const templates=Object.keys(db.templates).filter(k=>db.templates[k].sub===uid).map(k=>({token:k,name:db.templates[k].name,count:(db.templates[k].champs||[]).length,created:db.templates[k].created||null}));
    const keys=runKeys(p).map(k=>sumKey(p,k)).filter(k=>k.entries).sort((a,b)=>(b.last||0)-(a.last||0)||a.label.localeCompare(b.label));
    const custom=(Array.isArray(p.__lists)?p.__lists:[]).filter(Boolean).map(l=>({id:l.id,name:l.name,count:(l.champs||[]).length}));
    const usable=U.usable(u);
    return Object.assign(light(uid),{
      given:u.given||"",nameFull:u.name||"",customName:!!u.custom,nameFrom:u.nameFrom||"",v:u.v||null,
      google:u.google?{id:u.google,email:u.gmail||""}:null,discord:u.discord?{id:u.discord.id,name:u.discord.name}:null,
      hasPassword:!!u.pw,usable,locks:{password:!!u.pw,google:!!u.google,discord:!!u.discord,email:!!u.email},
      note:md.note||"",suspendedReason:md.reason||"",suspendedAt:md.at||null,rev:u.rev||0,
      shareToken:u.share||null,shareDesc:u.shareDesc||"",sessionList:sessions,templates,keys,custom,backups:listBackups(uid).length,
      config:{password:!!AUTH.on.password,magic:!!AUTH.on.magic,google:!!AUTH.on.google,discord:!!AUTH.on.discord}});
  }
  function removeUser(uid){
    const o=db.users[uid]; if(o&&o.share){delete db.shares[o.share]; rmImg(o.share)}
    for(const k in db.templates) if(db.templates[k].sub===uid) delete db.templates[k];
    for(const k in db.sessions) if(db.sessions[k].sub===uid) delete db.sessions[k];
    delete db.users[uid]; delete db.adminMeta[uid];
  }
  function mergePreview(tid,sid){
    if(!has(tid)||!has(sid)||tid===sid) return {err:"Pick two different accounts."};
    const T=db.users[tid], S=db.users[sid], block=[], warn=[];
    if(isAdminId(sid)) block.push("The admin account can only be the one that is kept, not the one that is absorbed.");
    if(T.google&&S.google) block.push("Both accounts have a Google login. Unlink one of them first, otherwise it would be lost.");
    if(T.discord&&S.discord) block.push("Both accounts have a Discord login. Unlink one of them first, otherwise it would be lost.");
    if(T.pw&&S.pw) warn.push("Both have a password login. The password and username of the absorbed account are discarded.");
    if(T.email&&S.email&&T.email.toLowerCase()!==S.email.toLowerCase()) warn.push("The accounts have different emails. The absorbed account's email ("+S.email+") is discarded.");
    if(T.share&&S.share) warn.push("Both have a progress share link. The absorbed account's link stops working.");
    if(U.hasData(T.progress)&&U.hasData(S.progress)) warn.push("Both accounts have progress. Pick how to treat it below.");
    const t=light(tid), s=light(sid);
    return {target:t,source:s,block,warn};
  }

  // ---------- routing ----------
  async function route(req,res,url){
    if(url.startsWith("/api/admin/")||url==="/api/admin") return api(req,res,url);
    const parts=url.slice(1).split("/");
    if(parts[0].length===ADMIN_PATH.length&&safeEq(parts[0],ADMIN_PATH)){
      if(req.method!=="GET"&&req.method!=="HEAD") return false;
      const f=parts[1]===undefined||parts[1]===""?"admin.html":parts[1]==="admin.js"?"admin.js":parts[1]==="admin.css"?"admin.css":null;
      if(!f||parts.length>2) return false;
      let s; try{s=fs.readFileSync(path.join(__dirname,"admin",f),"utf8")}catch(e){return false}
      if(f==="admin.html") s=s.replace(/%ADMIN_PATH%/g,ADMIN_PATH);
      const ct=f.endsWith(".js")?"text/javascript; charset=utf-8":f.endsWith(".css")?"text/css; charset=utf-8":"text/html; charset=utf-8";
      res.writeHead(200,{...SEC,"Content-Type":ct,"Content-Security-Policy":CSP}); res.end(req.method==="HEAD"?undefined:s); return true;
    }
    return false;
  }

  async function api(req,res,url){
    const uid=userOf(req);
    if(!uid||!isAdminId(uid)||!has(uid)) return false;               // not the admin: this route does not exist
    const m=req.method, ip=clientIp(req), me=uid;
    if(req.headers["x-admin"]!=="1") return false;
    const fail=(code,msg,extra)=>out(res,code,Object.assign({error:msg},extra||{}));
    if(m!=="GET"&&m!=="HEAD"){                                       // CSRF: same-origin only
      const o=req.headers.origin;
      if(o){let h=""; try{h=new URL(o).host}catch(e){} const mine=String(req.headers["x-forwarded-host"]||req.headers.host||"").split(",")[0].trim(); if(h!==mine) return fail(403,"bad origin")}
    }
    if(!rl("adm-api:"+uid,600,MIN)) return fail(429,"Slow down.");
    try{
      const sub=url.slice("/api/admin/".length), q=new URL(req.url,"http://x").searchParams;
      if(sub==="whoami"&&m==="GET") return out(res,200,{admin:true,name:db.users[uid].given||db.users[uid].name,unlocked:unlocked(req,uid),idleSeconds:IDLE/1000});
      if(sub==="unlock"&&m==="POST"){
        if(lockedOut()||!rl("adm-ip:"+ip,15,15*MIN)||!rl("adm-u:"+uid,6,15*MIN)){audit(req,me,"unlock","",{why:"rate limited"},false); return fail(429,"Too many attempts. Try again later.")}
        const b=await body(req);
        if(!safeEq(String(b.passphrase||"").slice(0,500),PASS)){failures.push(Date.now()); audit(req,me,"unlock","",{why:"wrong passphrase"},false); return fail(401,"Wrong passphrase.")}
        failures=[]; audit(req,me,"unlock",""); return out(res,200,{token:issue(uid,req),idleSeconds:IDLE/1000});
      }
      if(sub==="lock"&&m==="POST"){const t=String(req.headers["x-admin-token"]||""); tokens.delete(sha(t).toString("hex")); audit(req,me,"lock",""); return out(res,200,{ok:true})}
      if(!unlocked(req,uid)) return out(res,423,{error:"locked",code:"locked"});

      // ----- dashboard -----
      if(sub==="overview"&&m==="GET"){
        const ids=Object.keys(db.users), now=Date.now(), six=sessIndex(), d=864e5;
        const o={users:ids.length,google:0,discord:0,password:0,emailOnly:0,noLogin:0,suspended:0,new7:0,new30:0,active7:0,activeUnknown:0};
        const noLogin=[];
        for(const id of ids){const u=db.users[id], l=light(id,six);
          if(u.google) o.google++; if(u.discord) o.discord++; if(u.pw) o.password++; if(!u.google&&!u.discord&&!u.pw&&u.email) o.emailOnly++;
          if(!U.usable(u).length){o.noLogin++; if(noLogin.length<20) noLogin.push({id,name:l.name})}
          if(l.suspended) o.suspended++;
          if(l.created){ if(now-l.created<7*d) o.new7++; if(now-l.created<30*d) o.new30++ } else o.activeUnknown++;
          if(Math.max(l.last||0,l.lastLogin||0)>now-7*d) o.active7++;
        }
        const orphan={shares:Object.keys(db.shares).filter(t=>!has(db.shares[t])).length,templates:Object.keys(db.templates).filter(t=>!has(db.templates[t].sub)).length,
          sessions:Object.keys(db.sessions).filter(t=>!has(db.sessions[t].sub)).length,meta:Object.keys(db.adminMeta).filter(k=>!has(k)).length};
        let dataBytes=0; for(const x of ["","-wal"]) try{dataBytes+=fs.statSync(FILE+x).size}catch(e){}
        return out(res,200,Object.assign(o,{sessions:Object.values(db.sessions).filter(s=>s.exp>now).length,shares:Object.keys(db.shares).length,templates:Object.keys(db.templates).length,
          visits:db.visits?db.visits.total:0,mail:{n:db.mail&&db.mail.day===today()?db.mail.n:0},dataBytes,orphan,noLoginList:noLogin,dupGroups:dupGroups().length,
          login:AUTH.types,uptime:Math.round(process.uptime()),node:process.version,idleSeconds:IDLE/1000,now}));
      }

      // ----- user list -----
      if(sub==="users"&&m==="GET"){
        const needle=String(q.get("q")||"").trim().toLowerCase().slice(0,100), filter=q.get("filter")||"all", sort=q.get("sort")||"played";
        const off=Math.max(0,parseInt(q.get("offset"),10)||0), lim=Math.min(200,Math.max(1,parseInt(q.get("limit"),10)||50)), six=sessIndex();
        const nowT=Date.now(), dup=filter==="dupes"?new Set(dupGroups().flatMap(g=>g.users.map(x=>x.id))):null;
        let rows=[];
        for(const id of Object.keys(db.users)){
          const u=db.users[id];
          if(needle){const hay=[id,u.name,u.given,u.handle,u.email,u.gmail,u.google,u.discord&&u.discord.id,u.discord&&u.discord.name].filter(Boolean).join("\n").toLowerCase(); if(!hay.includes(needle)) continue}
          const l=light(id,six);
          if(filter==="google"&&!l.p.google) continue; if(filter==="discord"&&!l.p.discord) continue; if(filter==="password"&&!l.p.password) continue;
          if(filter==="emailonly"&&(l.p.google||l.p.discord||l.p.password||!l.p.email)) continue;
          if(filter==="suspended"&&!l.suspended) continue; if(filter==="empty"&&l.wins) continue; if(filter==="admin"&&!l.admin) continue;
          if(filter==="nologin"&&U.usable(u).length) continue; if(filter==="dupes"&&!dup.has(id)) continue;
          if(filter==="new7"&&!(l.created&&nowT-l.created<7*864e5)) continue; if(filter==="new30"&&!(l.created&&nowT-l.created<30*864e5)) continue;
          if(filter==="active7"&&!(Math.max(l.last||0,l.lastLogin||0)>nowT-7*864e5)) continue; if(filter==="shared"&&!l.share) continue;
          rows.push(l);
        }
        const by={played:(a,b)=>(b.last||0)-(a.last||0),new:(a,b)=>(b.created||0)-(a.created||0),name:(a,b)=>a.name.localeCompare(b.name,"en",{sensitivity:"base"}),wins:(a,b)=>b.wins-a.wins,login:(a,b)=>(b.lastLogin||0)-(a.lastLogin||0)};
        rows.sort(by[sort]||by.played);
        return out(res,200,{total:rows.length,users:rows.slice(off,off+lim)});
      }
      if(sub==="duplicates"&&m==="GET") return out(res,200,{groups:dupGroups()});
      if(sub==="audit"&&m==="GET") return out(res,200,{entries:readAudit(Math.min(500,parseInt(q.get("limit"),10)||200),q.get("target")||"",q.get("q")||"")});
      if(sub==="merge-preview"&&m==="GET"){const r=mergePreview(String(q.get("target")||""),String(q.get("source")||"")); return r.err?fail(400,r.err):out(res,200,r)}

      if(sub==="merge"&&m==="POST"){
        const b=await body(req), tid=String(b.target||""), sid=String(b.source||""), strat=String(b.strategy||"");
        const pv=mergePreview(tid,sid); if(pv.err) return fail(400,pv.err); if(pv.block.length) return fail(409,pv.block[0]);
        if(!["combine","target","source"].includes(strat)) return fail(400,"Pick how to treat the progress.");
        const T=db.users[tid], S=db.users[sid], tProg=clone(T.progress), sProg=clone(S.progress);
        snapshot(tid,"merge-into"); snapshot(sid,"merge-from");
        const md=db.adminMeta[sid]; if(md&&md.note){const tm=metaOf(tid); tm.note=((tm.note?tm.note+"\n":"")+"[merged from "+(S.given||S.name||sid)+"] "+md.note).slice(0,2000)}
        U.mergeUsers(tid,sid,strat==="source"?"theirs":"mine");
        T.progress=strat==="combine"?combineProgress(tProg,sProg):strat==="source"?(sProg||{}):(tProg||{});
        if(T.created&&S.created) T.created=Math.min(T.created,S.created); else if(!T.created&&S.created) T.created=S.created;
        delete db.adminMeta[sid]; bump(T); persist();
        audit(req,me,"merge",tid,{absorbed:sid,absorbedName:S.given||S.name,strategy:strat});
        return out(res,200,{ok:true,id:tid});
      }
      if(sub==="restore"&&m==="POST"){
        const b=await body(req), rid=String(b.uid||""), snap=readBackup(rid,b.file), scope=b.scope==="progress"?"progress":"record";
        if(!snap) return fail(404,"That backup could not be read.");
        const exists=has(rid); if(!exists&&scope==="progress") return fail(400,"The account no longer exists. Restore the full record instead.");
        if(scope==="record"){                                         // never let a restored record take over an identity another account owns now
          const R=snap.user, clash=[];
          for(const id of Object.keys(db.users)){ if(id===rid) continue; const o=db.users[id];
            if(R.google&&o.google===R.google) clash.push("Google login"); if(R.discord&&o.discord&&o.discord.id===R.discord.id) clash.push("Discord login");
            if(R.email&&o.email&&o.email.toLowerCase()===R.email.toLowerCase()) clash.push("email address"); if(R.handle&&o.handle&&o.handle.toLowerCase()===R.handle.toLowerCase()) clash.push("username"); }
          if(clash.length) return fail(409,"Another account now uses this backup's "+[...new Set(clash)].join(", ")+". Merge or unlink that first.");
        }
        if(exists) snapshot(rid,"pre-restore");
        const cur=exists?db.users[rid]:null;
        if(scope==="progress") cur.progress=clone(snap.user.progress)||{};
        else{
          db.users[rid]=clone(snap.user);
          const u=db.users[rid]; if(u.share){ if(db.shares[u.share]&&db.shares[u.share]!==rid) delete u.share; else db.shares[u.share]=rid }
          for(const k of Object.keys(snap.templates||{})) if(!db.templates[k]) db.templates[k]=clone(snap.templates[k]);
          if(snap.meta) db.adminMeta[rid]=clone(snap.meta);
          if(cur&&cur.rev) db.users[rid].rev=Math.max(db.users[rid].rev||0,cur.rev);
        }
        bump(db.users[rid]); persist(); audit(req,me,"restore",rid,{file:b.file,scope,recreated:!exists});
        return out(res,200,{ok:true,id:rid});
      }
      if(sub==="recovery"&&m==="GET"){
        const rows=[]; let dirs=[]; try{dirs=fs.readdirSync(BK)}catch(e){}
        for(const d of dirs){
          const files=listBackups(d); if(!files.length) continue; const newest=files[0];
          const snap=readBackup(d,newest.file); if(!snap||has(snap.uid)) continue;
          rows.push({uid:snap.uid,name:snap.user.given||snap.user.name||"",email:snap.user.email||"",google:!!snap.user.google,discord:!!snap.user.discord,file:newest.file,ts:newest.ts,action:newest.action});
        }
        return out(res,200,{rows:rows.sort((a,b)=>b.ts-a.ts)});
      }

      // ----- one user -----
      const um=sub.match(/^users\/([\w-]+)(?:\/([\w/-]+))?$/);
      if(!um) return false;
      const tid=um[1], act=um[2]||"";
      if(!has(tid)) return fail(404,"No such account.");
      const u=db.users[tid], name=u.given||u.name||tid, isAdm=isAdminId(tid);
      if(!act&&m==="GET") return out(res,200,detail(tid,req));
      if(act==="progress"&&m==="GET"){const p=ensureProg(u); return out(res,200,{data:p,keys:runKeys(p).map(k=>sumKey(p,k)).filter(k=>k.entries).sort((a,b)=>(b.last||0)-(a.last||0)||a.label.localeCompare(b.label))})}
      if(act==="export"&&m==="GET"){audit(req,me,"export",tid); return out(res,200,{exportedAt:Date.now(),id:tid,name,progress:u.progress||{}},{"Content-Disposition":'attachment; filename="lolphabet-'+safeId(name).slice(0,30)+'-progress.json"'})}
      if(act==="backups"&&m==="GET") return out(res,200,{backups:listBackups(tid)});
      if(m!=="POST"&&m!=="PUT") return false;
      const b=await body(req);
      const done=(action,detailObj)=>{persist(); audit(req,me,action,tid,detailObj); return out(res,200,{ok:true,user:detail(tid,req)})};

      if(act==="champ"){
        const key=String(b.key||""), champ=String(b.champ||"");
        if(!KEY_RE.test(key)||key==="__proto__"||key.startsWith("__")||!NAME_RE.test(champ)) return fail(400,"Bad list or champion name.");
        const prog=ensureProg(u), nz=MODE_NUZ(modeOf(key));
        if(b.remove){
          if(!isObj(prog[key])||!hasOwn(prog[key],champ)) return fail(404,"There is no entry for that champion.");
          snapshot(tid,"edit-champ",10*MIN); delete prog[key][champ]; bump(u); return done("remove-champ",{key,champ});
        }
        const c=cleanFields(isObj(b.set)?b.set:{},nz); if(c.err) return fail(400,c.err);
        snapshot(tid,"edit-champ",10*MIN);
        if(!isObj(prog[key])) prog[key]={};
        const run=prog[key], s=hasOwn(run,champ)&&isObj(run[champ])?run[champ]:(run[champ]={won:false,date:null,games:0});
        const before=clone(s); applyChamp(s,c.set,nz); bump(u);
        return done("edit-champ",{key,champ,before:{won:before.won,wins:before.wins,dead:before.dead,games:before.games},after:{won:s.won,wins:s.wins,dead:s.dead,games:s.games}});
      }
      if(act==="list/reset"){
        const key=String(b.key||""), prog=ensureProg(u);
        if(!KEY_RE.test(key)||key.startsWith("__")||!hasOwn(prog,key)||!isObj(prog[key])) return fail(404,"That list has no progress.");
        snapshot(tid,"reset-list");
        if(b.keepNotes){const n={}; for(const c of Object.keys(prog[key])){const s=prog[key][c]; if(c!=="__meta"&&isObj(s)&&s.note) n[c]={won:false,date:null,games:0,note:s.note}} prog[key]=n}
        else delete prog[key];
        bump(u); return done("reset-list",{key,keepNotes:!!b.keepNotes});
      }
      if(act==="list/clear-locks"){
        const key=String(b.key||""), prog=ensureProg(u);
        if(!KEY_RE.test(key)||key.startsWith("__")||!isObj(prog[key])||!isObj(prog[key].__meta)) return fail(404,"Nothing to clear on that list.");
        snapshot(tid,"clear-locks"); for(const f of ["focus","rolled","skip"]) delete prog[key].__meta[f];
        bump(u); return done("clear-locks",{key});
      }
      if(act==="progress/reset-all"){
        if(String(b.confirm||"")!==name) return fail(400,"Type the account name to confirm.");
        snapshot(tid,"reset-all"); const p=ensureProg(u), keep=b.keepLists!==false&&Array.isArray(p.__lists)?p.__lists:null;
        u.progress=keep?{__lists:keep}:{}; bump(u); return done("reset-all",{keepLists:!!keep});
      }
      if(act==="progress/raw"){
        const d=b.data; if(!isObj(d)) return fail(400,"Progress must be a JSON object.");
        if(JSON.stringify(d).length>900000) return fail(400,"That is too big.");
        for(const k of Object.keys(d)){ if(k==="__proto__") return fail(400,"Bad key."); if(k==="__lists"){ if(!Array.isArray(d[k])) return fail(400,"__lists must be an array.") } else if(!isObj(d[k])) return fail(400,"'"+k+"' must be an object.") }
        snapshot(tid,"raw-edit"); u.progress=d; bump(u); return done("raw-edit",{keys:Object.keys(d).length});
      }
      if(act==="rename"){
        const n=U.cleanName(b.name); if(!n) return fail(400,"Enter a name."); const old=name;
        snapshot(tid,"rename"); u.name=u.given=n; u.custom=true; return done("rename",{from:old,to:n});
      }
      if(act==="handle"){
        const h=U.cleanHandle(b.handle); if(!h) return fail(400,"Usernames are 3 to 30 characters: letters, numbers, spaces, dots, dashes or underscores.");
        if(!u.pw) return fail(400,"This account has no password login, so it has no username.");
        const o=U.byHandle(h); if(o&&o!==tid) return fail(409,"That username is taken."); snapshot(tid,"set-username"); const old=u.handle; u.handle=h; return done("set-username",{from:old,to:h});
      }
      if(act==="email"){
        const e=U.cleanEmail(b.email); if(!e) return fail(400,"Enter a valid email address.");
        const o=U.byEmail(e); if(o&&o!==tid) return fail(409,"Another account already uses that email."); snapshot(tid,"set-email"); const old=u.email||""; u.email=e; return done("set-email",{from:mask(old),to:mask(e)});
      }
      if(act==="note"){const n=String(b.note||"").replace(/[\u0000-\u0008\u000b-\u001f]/g," ").slice(0,2000); const md=metaOf(tid); if(n) md.note=n; else delete md.note; return done("note",{len:n.length})}
      if(act==="unlink"){
        const kind=String(b.kind||""); if(!["google","discord","password","email"].includes(kind)) return fail(400,"Unknown login type.");
        if(kind==="google"&&!u.google||kind==="discord"&&!u.discord||kind==="password"&&!u.pw||kind==="email"&&!u.email) return fail(400,"That login isn't linked.");
        const copy=Object.assign({},u); if(kind==="password"){delete copy.pw;delete copy.handle} else if(kind==="google"){delete copy.google;delete copy.gmail} else delete copy[kind];
        if(!U.usable(copy).length&&!b.force) return fail(409,"That is the account's only way to sign in. Tick 'allow locking them out' if you really mean it.",{code:"last"});
        snapshot(tid,"unlink-"+kind);
        if(kind==="password"){delete u.pw;delete u.handle} else if(kind==="google"){delete u.google;delete u.gmail} else delete u[kind];
        if(b.signout!==false) U.dropSessions(tid);
        bump(u); return done("unlink",{kind,forced:!!b.force});
      }
      if(act==="reset-password"){
        if(!AUTH.on.password) return fail(400,"Password sign-in isn't enabled in LOGIN_TYPES.");
        if(b.mode==="link"){
          const t=U.mkToken({type:"reset",uid:tid},30*MIN); audit(req,me,"reset-link",tid,{});
          return out(res,200,{ok:true,link:baseUrl(req)+"/#reset="+t,minutes:30,warning:(!u.email&&!u.handle)?"This account has no email or username, so even with a password it couldn't sign in with one.":""});
        }
        if(!u.email) return fail(400,"This account has no email address. Use the one-time link instead.");
        try{await U.sendMail(u.email,"Reset your LoLphabet password",U.mailBody("Reset your password","A LoLphabet admin started a password reset for your account. Click the button to choose a new password.","Choose a new password",baseUrl(req)+"/#reset="+U.mkToken({type:"reset",uid:tid},30*MIN),"This link works once and expires in 30 minutes. If you weren't expecting it, you can ignore this email and your password stays as it is."))}
        catch(e){audit(req,me,"reset-email",tid,{error:e.limit?"daily limit":"send failed"},false); return fail(e.limit?503:502,e.limit?"The daily email limit has been reached.":"The email couldn't be sent.")}
        audit(req,me,"reset-email",tid,{to:mask(u.email)}); return out(res,200,{ok:true,sentTo:mask(u.email)});
      }
      if(act==="signout"){
        if(b.session){const k=Object.keys(db.sessions).find(k=>db.sessions[k].sub===tid&&sha(k).toString("hex").slice(0,12)===String(b.session)); if(!k) return fail(404,"That session is gone."); delete db.sessions[k]; return done("signout-one",{})}
        U.dropSessions(tid); return done("signout-all",{});
      }
      if(act==="suspend"){
        if(isAdm) return fail(400,"The admin account can't be suspended.");
        const md=metaOf(tid);
        if(b.suspended){ snapshot(tid,"suspend"); md.suspended=true; md.reason=String(b.reason||"").slice(0,200); md.at=Date.now(); U.dropSessions(tid) }
        else{ delete md.suspended; delete md.reason; delete md.at }
        return done(b.suspended?"suspend":"unsuspend",{reason:md.reason||""});
      }
      if(act==="share"){
        if(!u.share) return fail(400,"No share link."); snapshot(tid,"disable-share");
        delete db.shares[u.share]; rmImg(u.share); u.share=null; delete u.shareDesc; return done("disable-share",{});
      }
      if(act==="template/delete"){
        const t=String(b.token||""); if(!hasOwn(db.templates,t)||db.templates[t].sub!==tid) return fail(404,"No such shared list.");
        snapshot(tid,"delete-template"); const nm=db.templates[t].name; delete db.templates[t]; return done("delete-template",{name:nm});
      }
      if(act==="delete"){
        if(isAdm) return fail(400,"The admin account can't be deleted from here.");
        if(String(b.confirm||"")!==name) return fail(400,"Type the account name to confirm.");
        snapshot(tid,"delete"); removeUser(tid); persist(); audit(req,me,"delete",tid,{name}); return out(res,200,{ok:true,deleted:true});
      }
      return false;
    }catch(e){
      console.log("admin error:",e&&e.stack||e);
      if(/JSON|too big/i.test(String(e&&e.message))) return fail(400,"Bad request.");
      return fail(500,"Something went wrong. Check the server log.");
    }
  }

  console.log("Admin panel: on (secret address set, "+IDS.size+" admin account"+(IDS.size===1?"":"s")+", passphrase required, idle lock "+IDLE/MIN+" min)");
  return {enabled:true,route,_test:{combineProgress,cleanFields,applyChamp}};
};
