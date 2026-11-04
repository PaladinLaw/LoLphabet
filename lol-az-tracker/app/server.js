// Zero-dependency server (Node 18+). Serves index.html and saves progress per Google account.
//   GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com node server.js
const http=require("http"),fs=require("fs"),path=require("path"),crypto=require("crypto"),zlib=require("zlib");
const PORT=process.env.PORT||3081, CID=process.env.GOOGLE_CLIENT_ID||"";
const FILE=process.env.DATA_FILE||path.join(__dirname,"data.json");
const TTL=90*864e5;
const SITE="LoLphabet", CONTACT=process.env.CONTACT_EMAIL||"";
const contact=CONTACT?`<a href="mailto:${CONTACT}">${CONTACT}</a>`:"the person who runs this site";
const FAVICON="data:image/png;base64,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";
const page=(title,body,desc)=>`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | ${SITE}</title><meta name="description" content="${desc}"><meta name="robots" content="index, follow"><!--CANON--><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="96x96" href="/favicon-96.png">
<style>:root{color-scheme:light dark}body{font:16px/1.6 system-ui,sans-serif;max-width:700px;margin:40px auto;padding:0 16px}h1{font-size:26px}h2{font-size:18px;margin-top:28px}a{color:#b8860b}small{color:gray}</style></head>
<body><p><a href="/">&larr; ${SITE}</a></p><h1>${title}</h1><small>Last updated: November 2026</small>${body}</body></html>`;
const PRIVACY=page("Privacy Policy",`
<p>${SITE} (“the site”) is a small hobby project run by PaladinLaw (“we”, “us”) for tracking League of Legends A-Z challenge progress. This policy explains what personal information we handle, why, and what rights you have. It is written to meet the UK GDPR, the EU GDPR, South Africa's POPIA and California's CCPA/CPRA.</p>
<h2>Who is responsible</h2>
<p>PaladinLaw is the controller of your personal information (the “responsible party” under POPIA). Contact: ${contact}.</p>
<h2>What we process, and why</h2>
<p><b>If you don't log in:</b> your progress, custom lists and preferences stay in your own browser. We never receive them.</p>
<p><b>If you log in with Google:</b> we receive your Google account ID, name and email address, and we store them along with your display name, your tracker progress, lists and notes, and a login session token. We use this only to run your account. Lawful basis: providing the service you asked for (contract).</p>
<p><b>If you create a share link or a shared list link:</b> anyone with the link can see your display name and the progress or list you shared (read-only for progress). You can switch a progress link off, or delete your account, at any time. Lawful basis: your choice to share.</p>
<p><b>Visitor counter:</b> when a page loads, our server combines your IP address and browser details with a random key that changes every day, turns the result into a one-way hash, and uses it only to avoid counting the same device twice in a day. Nothing is stored on your device, your raw IP address is not kept, and the hashes are deleted when the daily key changes (within 24 hours). Only the running total is kept. Lawful basis: legitimate interests (a simple visitor count that can't be inflated by refreshing).</p>
<p><b>Technical logs:</b> the hosting setup, and any network service in front of it (such as a reverse proxy or tunnel), may keep standard connection logs for security and troubleshooting.</p>
<h2>Cookies and local storage</h2>
<p>The site sets <b>no cookies</b>. It stores a few items in your browser's local storage, all strictly necessary for features you use: your progress and lists, your preferences (theme, challenge mode, role-list source, build panel position and open/closed state, collapsed hints), your login session if you sign in (up to 90 days), short-lived cached champion data from Riot (about 24 hours), and a note that you've seen the cookie notice. There is no analytics, advertising or social-media tracking. You can clear all of it from “Cookie preferences” in the footer.</p>
<h2>Other companies involved</h2>
<p><b>Google:</b> the Google sign-in script is loaded only after you click Log in / Sign up. Google's own privacy policy applies to that sign-in.</p>
<p><b>Riot Games and CommunityDragon:</b> champion, item, summoner spell and rune icons, and champion data, are loaded directly from Riot's public Data Dragon service (and a few stat-shard icons from the community-run CommunityDragon service), so those servers receive your IP address and browser details when a page loads. Lawful basis: legitimate interests (showing the champion images the site is built around).</p>
<p><b>OP.GG:</b> the suggested builds and statistics shown under Next up are collected by our own server from OP.GG about once a week and stored on that server. Your browser never contacts OP.GG, and no information about you is sent to OP.GG.</p>
<p>Google and Riot are based in the United States, so this may involve transfers outside the UK, EEA and South Africa, which those companies cover with their own safeguards.</p>
<h2>We don't sell or share your data</h2>
<p>We do not sell or share personal information, show ads, or use it for profiling. Because there is nothing to opt out of, browser signals such as Global Privacy Control have no effect on what happens, and nothing is processed differently if you send one.</p>
<h2>How long we keep it</h2>
<p>Account data and saved progress are kept until you delete your account (Settings, then Delete account). Login sessions expire after 90 days. Shared list links last until your account is deleted. Visitor-counter hashes last under 24 hours.</p>
<h2>Your rights</h2>
<p>Depending on where you live, you may have the right to access, correct, delete, restrict or export your data, to object to processing based on legitimate interests, and to withdraw consent. Most of this you can do yourself under Settings (export, edit your name, delete your account); for anything else contact ${contact}. You can also complain to your regulator: the UK Information Commissioner's Office (ico.org.uk), your EU data protection authority, or South Africa's Information Regulator (inforegulator.org.za). California residents can ask us what we hold, to correct it, or to delete it, and we will not treat you differently for doing so.</p>
<h2>Children</h2>
<p>The site isn't aimed at children under 13, and we don't knowingly collect their information.</p>
<h2>Security and changes</h2>
<p>We keep data on a server we control and use reasonable measures to protect it, but no system is perfectly secure. We may update this policy; the date at the top shows when it last changed.</p>`,"How LoLphabet, the League of Legends A–Z Challenge by PaladinLaw, collects, uses and protects your personal information, and the rights you have over it.");
const TERMS=page("Terms of Service",`
<p>By using ${SITE} you agree to these terms. If you don't agree, please don't use the site.</p>
<h2>The service</h2>
<p>This is a free, personal hobby project provided for friends and fellow players, “as is” and “as available”. We don't guarantee it will always be online, error-free, or that your data will never be lost. Use Export in Settings to keep a backup.</p>
<h2>Who can use it</h2>
<p>You must be at least 13 years old. If you create an account, keep your Google account secure; you're responsible for activity under it.</p>
<h2>Acceptable use</h2>
<p>Don't try to disrupt the site, scrape it at volume, access other people's data, or post notes, list names or links that are unlawful, abusive or infringe others' rights. We may remove content or accounts, or shut the site down, at any time.</p>
<h2>Your content</h2>
<p>Your progress, notes and lists remain yours. You give us permission to store them and, if you create a share link, to show them to people who have the link.</p>
<h2>Privacy</h2>
<p>How your information is handled is described in the <a href="/privacy">Privacy Policy</a>.</p>
<h2>Liability</h2>
<p>To the extent the law allows, we aren't liable for losses arising from using or being unable to use the site. Nothing in these terms limits any rights you have by law that can't be excluded.</p>
<h2>Not affiliated with Riot Games or OP.GG</h2>
<p>Build data shown under Next up comes from OP.GG, and ${SITE} isn't affiliated with OP.GG. ${SITE} isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</p>
<h2>Changes and governing law</h2>
<p>We may update these terms; continued use means you accept the updated version. These terms are governed by the laws of South Africa, without affecting any mandatory consumer rights you have where you live.</p>
<h2>Contact</h2>
<p>${contact}.</p>`,"The terms of service for using LoLphabet, the free League of Legends A–Z Challenge tracker by PaladinLaw, including accounts, acceptable use, liability and governing law.");

// ---- SEO / performance helpers ----
const FAVICON_BUF=Buffer.from(FAVICON.replace(/^data:image\/png;base64,/,""),"base64");
const HOME_TITLE="LoLphabet | Free League of Legends A–Z Challenge Tracker";
const ABOUT_TITLE="About LoLphabet | League of Legends A–Z Challenge Tracker";
const ABOUT_DESC="What LoLphabet is, what you can track (roles, races, classes, regions, custom lists), how the four challenge modes work and how your progress is saved.";
const HOME_DESC="Free League of Legends A–Z Challenge tracker. Win a game with every champion by role, race, class or region, track progress, share it and see popular builds.";
const fileMtime=f=>{try{return fs.statSync(path.join(__dirname,f)).mtime}catch(e){return new Date()}};
const jsonLd=base=>'<script type="application/ld+json">'+JSON.stringify({"@context":"https://schema.org","@graph":[
  {"@type":"WebSite","@id":base+"/#website","url":base+"/","name":"LoLphabet","alternateName":"LoLphabet: The League of Legends A–Z Challenge","description":HOME_DESC,"inLanguage":"en","publisher":{"@id":base+"/#author"}},
  {"@type":"WebApplication","@id":base+"/#app","url":base+"/","name":"LoLphabet","alternateName":"The League of Legends A–Z Challenge","description":HOME_DESC,"applicationCategory":"GameApplication","operatingSystem":"Any (web browser)","isAccessibleForFree":true,"inLanguage":"en","image":base+"/assets/og-image.png?v=2","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},"author":{"@id":base+"/#author"},"isPartOf":{"@id":base+"/#website"},
   "featureList":["League of Legends A–Z Challenge champion tracker","Role, race, class and region champion lists","Custom champion lists you can share","Classic, Random, Hard and Insanity challenge modes","Progress statistics and shareable progress links","Popular champion builds, pick rates and win rates"]},
  {"@type":"Person","@id":base+"/#author","name":"PaladinLaw"}
]}).replace(/</g,"\\u003c")+'</script>';
// Pre-rendered page cache: each page is built once per (host, source-file version) and stored with its gzip/brotli forms and ETag.
const PAGE_CACHE=new Map();
function servePage(req,res,key,version,build,extra){
  const ck=key+"|"+version;
  let e=PAGE_CACHE.get(ck);
  if(!e){
    if(PAGE_CACHE.size>60) PAGE_CACHE.clear();
    const buf=Buffer.from(build(),"utf8");
    e={buf,gz:zlib.gzipSync(buf,{level:9}),br:zlib.brotliCompressSync(buf,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:9}}),etag:'"'+crypto.createHash("sha1").update(buf).digest("base64url").slice(0,20)+'"'};
    PAGE_CACHE.set(ck,e);
  }
  const h={"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-cache","ETag":e.etag,"Vary":"Accept-Encoding",...(extra||{})};
  if(req.headers["if-none-match"]===e.etag){res.writeHead(304,h);return res.end()}
  const ae=String(req.headers["accept-encoding"]||"");
  let body=e.buf;
  if(/\bbr\b/.test(ae)){h["Content-Encoding"]="br";body=e.br}
  else if(/\bgzip\b/.test(ae)){h["Content-Encoding"]="gzip";body=e.gz}
  h["Content-Length"]=body.length;
  res.writeHead(200,h); res.end(body);
}
const html=(res,h)=>{res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(h)};

let db={users:{},sessions:{}};
try{db=JSON.parse(fs.readFileSync(FILE,"utf8"))}catch(e){}
db.shares=db.shares||{}; db.templates=db.templates||{}; db.visits=db.visits||{total:0,day:"",salt:"",seen:{},ip:{}};
const persist=()=>fs.writeFileSync(FILE,JSON.stringify(db));
const send=(res,code,obj)=>{res.writeHead(code,{"Content-Type":"application/json","X-Robots-Tag":"noindex"});res.end(JSON.stringify(obj))};
const body=req=>new Promise((ok,no)=>{let b="";req.on("data",c=>{b+=c;if(b.length>1e6){no(new Error("too big"));req.destroy()}});
  req.on("end",()=>{try{ok(JSON.parse(b||"{}"))}catch(e){no(e)}})});
const token=req=>(req.headers.authorization||"").replace("Bearer ","");
const userOf=req=>{const s=db.sessions[token(req)];return s&&s.exp>Date.now()?s.sub:null};

const SITE_URL=(process.env.SITE_URL||"").replace(/\/+$/,"");   // set SITE_URL=https://your.domain for fixed canonical URLs
const baseUrl=req=>SITE_URL||(String(req.headers["x-forwarded-proto"]||"http").split(",")[0].trim()+"://"+(req.headers["x-forwarded-host"]||req.headers.host||"localhost"));
// ---- Visitor counter: cookieless. A visitor = one hash of (daily random salt + IP + browser) per day. ----
const clientIp=req=>String(req.headers["cf-connecting-ip"]||String(req.headers["x-forwarded-for"]||"").split(",")[0]||req.socket.remoteAddress||"").trim();
function countVisit(req){
  const V=db.visits, day=new Date().toISOString().slice(0,10);
  if(V.day!==day){V.day=day;V.salt=crypto.randomBytes(16).toString("hex");V.seen={};V.ip={};}
  const h=x=>crypto.createHash("sha256").update(V.salt+"|"+x).digest("hex").slice(0,24);
  const ip=clientIp(req), a=h(ip+"|"+String(req.headers["user-agent"]||"")), b=h(ip);
  if(V.seen[a]) return V.seen[a];                 // same device already counted today (refreshing doesn't add)
  if((V.ip[b]||0)>=5) return V.total;             // many "new" browsers from one address in a day: don't inflate
  V.total++; V.seen[a]=V.total; V.ip[b]=(V.ip[b]||0)+1; persist(); return V.total;
}
// ---- Role lists: refreshed daily from open champion data (lolstaticdata via Meraki CDN) ----
const ROLES_URL=process.env.ROLES_URL||"https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json";
const POS={TOP:"Top",JUNGLE:"Jungle",MIDDLE:"Mid",BOTTOM:"Bot / ADC",SUPPORT:"Support"};
async function refreshRoles(){
  try{
    const r=await fetch(ROLES_URL,{signal:AbortSignal.timeout(20000)}); if(!r.ok) throw new Error("HTTP "+r.status);
    const j=await r.json(), arr=Array.isArray(j)?j:Object.values(j), lists={};
    for(const p of Object.values(POS)) lists[p]=[];
    for(const c of arr) if(c&&c.name&&Array.isArray(c.positions)) for(const p of c.positions) if(POS[String(p).toUpperCase()]) lists[POS[String(p).toUpperCase()]].push(c.name);
    for(const k in lists){ lists[k]=[...new Set(lists[k])].sort((a,b)=>a.localeCompare(b,"en",{sensitivity:"base"})); if(lists[k].length<10) throw new Error("suspicious data for "+k); }
    db.roles={updated:Date.now(),source:ROLES_URL,lists}; persist(); console.log("roles refreshed:",Object.entries(lists).map(([k,a])=>k+" "+a.length).join(", "));
  }catch(e){console.log("roles refresh failed:",e.message)}
}
// ---- Champion builds: read-only view of the lol-meta-collector output (the collector runs as its own container) ----
// COLLECTOR_DIR is the collector's output_dir (it contains current/ and archive/). Mount it read-only.
const COLLECTOR_DIR=process.env.COLLECTOR_DIR||"/collector";
const BUILD_STALE_DAYS=Math.max(1,Number(process.env.BUILD_STALE_DAYS)||14);   // collector runs weekly; 2x that = stale
const BUILD_RECHECK_MS=30000;                                                   // how often the cache re-checks the files' mtimes
const IMG_HOSTS=new Set(["ddragon.leagueoflegends.com","raw.communitydragon.org"]);
const POSITIONS=["TOP","JUNGLE","MID","ADC","SUPPORT"];
const nkey=s=>String(s==null?"":s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const num=v=>typeof v==="number"&&isFinite(v)?v:null;
const safeImg=u=>{try{const x=new URL(String(u));return x.protocol==="https:"&&IMG_HOSTS.has(x.hostname)?x.href:null}catch(e){return null}};
const readJson=f=>JSON.parse(fs.readFileSync(f,"utf8"));
const mtimeOf=f=>{try{return fs.statSync(f).mtimeMs}catch(e){return 0}};
const BUILDS={checked:0,sig:"",index:new Map(),meta:null,assets:null,from:"none",total:0,skipped:0,dir:""};

function loadSnapshot(dir){                              // -> {records,meta,assets} or null when the snapshot is unusable/empty
  try{
    const recs=readJson(path.join(dir,"champions.json"));
    if(!Array.isArray(recs)||!recs.length) return null;
    let meta=null,assets=null;
    try{meta=readJson(path.join(dir,"metadata.json"))}catch(e){}
    try{assets=readJson(path.join(dir,"static-assets.json"))}catch(e){}
    return {records:recs,meta,assets};
  }catch(e){return null}
}
function snapshotDirs(){                                  // current first, then archive snapshots newest-first
  const out=[{dir:path.join(COLLECTOR_DIR,"current"),from:"current"}];
  try{
    const arc=path.join(COLLECTOR_DIR,"archive");
    const names=fs.readdirSync(arc).filter(n=>fs.statSync(path.join(arc,n)).isDirectory());
    names.sort((a,b)=>(b.match(/\d{8}T\d{6}Z$/)||[b])[0].localeCompare((a.match(/\d{8}T\d{6}Z$/)||[a])[0]));
    for(const n of names) out.push({dir:path.join(arc,n),from:"archive"});
  }catch(e){}
  return out;
}
function loadBuilds(force){
  const now=Date.now(); if(!force&&now-BUILDS.checked<BUILD_RECHECK_MS) return; BUILDS.checked=now;
  const cur=path.join(COLLECTOR_DIR,"current");
  const sig=["champions.json","metadata.json","static-assets.json"].map(f=>mtimeOf(path.join(cur,f))).join("|")+"|"+mtimeOf(path.join(COLLECTOR_DIR,"archive"));
  if(!force&&sig===BUILDS.sig) return; BUILDS.sig=sig;
  let snap=null,from="none",dir="";
  for(const c of snapshotDirs()){ snap=loadSnapshot(c.dir); if(snap){from=c.from;dir=c.dir;break} }
  const index=new Map(); let skipped=0,total=0;
  if(snap) for(const r of snap.records){
    if(!r||!r.champion||!r.position||!r.build||!r.statistics||!POSITIONS.includes(String(r.position).toUpperCase())){skipped++;continue}
    const pos=String(r.position).toUpperCase();
    const keys=[...new Set([nkey(r.champion),nkey(r.champion_id)])].filter(Boolean);
    let e=keys.map(k=>index.get(k)).find(Boolean)||{name:r.champion,positions:new Map()};   // name and Data Dragon id share ONE entry
    for(const k of keys) index.set(k,e);
    e.positions.set(pos,r); total++;
  }
  BUILDS.index=index; BUILDS.meta=snap&&snap.meta; BUILDS.assets=snap&&snap.assets; BUILDS.from=index.size?from:"none"; BUILDS.total=total; BUILDS.skipped=skipped; BUILDS.dir=dir;
  console.log("builds loaded:",index.size?`${total} records from ${from} (${dir})${skipped?`, ${skipped} skipped`:""}`:"none available (collector output missing or empty)");
}
function rankLabel(m){ const r=m&&m.build_rank_filter; if(!r) return "unknown rank filter"; return /^provider default/i.test(r)?"OP.GG default rank":String(r).replace(/_plus$/i,"+").replace(/^./,c=>c.toUpperCase()); }
function buildFresh(){
  const m=BUILDS.meta||{}; let at=m.collected_at;
  if(!at){ let best=0; for(const e of BUILDS.index.values()) for(const r of e.positions.values()){const t=Date.parse(r.collected_at); if(t>best) best=t} at=best?new Date(best).toISOString():null; }
  const age=at&&isFinite(Date.parse(at))?(Date.now()-Date.parse(at))/864e5:null;
  const req=num(m.requested_records), ok=num(m.successful_records), failed=num(m.failed_records);
  return {from:BUILDS.from,collected_at:at,age_days:age==null?null:Math.round(age*10)/10,stale:age==null||age>BUILD_STALE_DAYS,stale_after_days:BUILD_STALE_DAYS,
    rank:rankLabel(m),assets_patch:m.data_dragon_patch||null,requested:req,successful:ok,failed,
    incomplete:req!=null&&ok!=null?ok<req*0.9:false,source:{name:"OP.GG",url:"https://op.gg"}};
}
// Resolve an image from the shared static-assets manifest when a record's own URL is missing or not on an allowed host.
const manifestImg=(kind,id)=>{const m=BUILDS.assets&&BUILDS.assets[kind]; const e=m&&m[String(id)]; return e?safeImg(e.image):null};
function trimEntry(x,kind){
  if(!x||typeof x!=="object") return null;
  return {id:x.id==null?null:x.id,name:typeof x.name==="string"?x.name:"",image:safeImg(x.image)||(x.id!=null?manifestImg(kind,x.id):null),
    style:typeof x.style==="string"?x.style:undefined,pick_rate:num(x.pick_rate),win_rate:num(x.win_rate),sample_size:num(x.sample_size)};
}
const trimList=(a,kind)=>(Array.isArray(a)?a:[]).map(x=>trimEntry(x,kind)).filter(Boolean);
function trimBuild(b){                                    // only what the frontend needs; provider_payload never leaves the server
  const ru=b.runes||{}, sit={};
  for(const k of ["fourth","fifth","sixth","last"]){ const l=trimList(b.situational_items&&b.situational_items[k],"items"); if(l.length) sit[k]=l; }
  return {
    starting_items:trimList(b.starting_items,"items"),
    core_items:{boots:trimList(b.core_items&&b.core_items.boots,"items"),items:trimList(b.core_items&&b.core_items.items,"items")},
    situational_items:sit,
    summoner_spells:trimList(b.summoner_spells,"summoner_spells"),
    runes:{primary_style:trimEntry(ru.primary_style,"rune_styles"),secondary_style:trimEntry(ru.secondary_style,"rune_styles"),
      primary:trimList(ru.primary,"runes"),secondary:trimList(ru.secondary,"runes"),stat_shards:trimList(ru.stat_shards,"stat_shards"),
      pick_rate:num(ru.pick_rate),win_rate:num(ru.win_rate),sample_size:num(ru.sample_size)},
    skill_order:(Array.isArray(b.skill_order)?b.skill_order:[]).map(String).filter(k=>/^[QWER]$/.test(k)),
    skill_max_order:(Array.isArray(b.skill_max_order)?b.skill_max_order:[]).map(String).filter(k=>/^[QWE]$/.test(k)),
  };
}
function buildResponse(champion,position){
  loadBuilds(); const fresh=buildFresh();
  const entry=BUILDS.index.get(nkey(champion));
  if(!BUILDS.index.size) return {state:"no_data",champion,data:fresh};
  if(!entry) return {state:"no_champion",champion,data:fresh};
  const positions=[...entry.positions.entries()].map(([p,r])=>({position:p,games:num(r.statistics&&r.statistics.games)||0})).sort((a,b)=>b.games-a.games);
  const auto=!position, pos=position||positions[0].position, r=entry.positions.get(pos);
  if(!r) return {state:"no_position",champion:entry.name,position:pos,positions,data:fresh};
  const s=r.statistics||{};
  return {state:"ok",champion:entry.name,position:pos,position_auto:auto,positions,
    statistics:{win_rate:num(s.win_rate),pick_rate:num(s.pick_rate),ban_rate:num(s.ban_rate),games:num(s.games),tier:num(s.tier)},
    champion_icon:safeImg(r.assets&&r.assets.champion_icon),build:trimBuild(r.build),record_collected_at:r.collected_at||null,data:fresh};
}
loadBuilds(true);
http.createServer(async(req,res)=>{
  try{
    const url=req.url.split("?")[0];
    if(url==="/index.html"){res.writeHead(301,{Location:"/"});return res.end()}   // one URL for the landing page
    if(url==="/about/"||url==="/privacy/"||url==="/terms/"){res.writeHead(301,{Location:url.slice(0,-1)});return res.end()}
    if(url==="/favicon.ico"||url==="/favicon-96.png"){res.writeHead(200,{"Content-Type":"image/png","Cache-Control":"public, max-age=86400","Content-Length":FAVICON_BUF.length});return res.end(FAVICON_BUF)}
    if(url==="/"||url==="/about"||url.startsWith("/s/")||url.startsWith("/t/")){
      const about=url==="/about", priv=url!=="/"&&!about, base=baseUrl(req);          // private share/template views are never indexed
      const ver=String(fileMtime("index.html").getTime());
      return servePage(req,res,(priv?"priv":about?"about":"home")+"|"+base,ver,()=>{
        let page=fs.readFileSync(path.join(__dirname,"index.html"),"utf8").replace(/%SITE_URL%/g,base)
          .replace("<!--ROBOTS-->",priv?'<meta name="robots" content="noindex, nofollow">':'<meta name="robots" content="index, follow, max-image-preview:large">')
          .replace("<!--CANONICAL-->",priv?"":`<link rel="canonical" href="${base}${about?"/about":"/"}">`)
          .replace("<!--JSONLD-->",priv?"":jsonLd(base));
        if(about){
          page=page.replace(/(<meta property="og:url" content=")[^"]*"/,'$1'+base+'/about"')
            .replace(/<title>[^<]*<\/title>/,"<title>"+ABOUT_TITLE+"</title>")
            .replace(/(<meta name="description" content=")[^"]*"/,'$1'+ABOUT_DESC+'"')
            .replace(/(<meta property="og:title" content=")[^"]*"/,'$1'+ABOUT_TITLE+'"')
            .replace(/(<meta property="og:description" content=")[^"]*"/,'$1'+ABOUT_DESC+'"')
            .replace(/(<meta name="twitter:title" content=")[^"]*"/,'$1'+ABOUT_TITLE+'"')
            .replace(/(<meta name="twitter:description" content=")[^"]*"/,'$1'+ABOUT_DESC+'"')
            // /about has its own H1 ("About LoLphabet"); the header tagline becomes a plain paragraph there
            .replace('<h1 id="tl" class="tl">The League of Legends A–Z Challenge</h1>','<p id="tl" class="tl">The League of Legends A–Z Challenge</p>')
            .replace('<h2 id="about-h">About LoLphabet</h2>','<h1 id="about-h">About LoLphabet</h1>');
        }
        return page;
      },priv?{"X-Robots-Tag":"noindex, nofollow"}:{});
    }
    if(url==="/robots.txt"){res.writeHead(200,{"Content-Type":"text/plain; charset=utf-8"});return res.end("User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: "+baseUrl(req)+"/sitemap.xml\n")}
    if(url==="/sitemap.xml"){
      const base=baseUrl(req), d=f=>fileMtime(f).toISOString().slice(0,10);
      // lastmod = date of the source file that page is built from (index.html for the app pages, server.js for the legal pages)
      const pages=[["/",d("index.html")],["/about",d("index.html")],["/privacy",d("server.js")],["/terms",d("server.js")]];
      res.writeHead(200,{"Content-Type":"application/xml; charset=utf-8","Cache-Control":"public, max-age=3600"});
      return res.end('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+pages.map(([p,lm])=>"<url><loc>"+base+p+"</loc><lastmod>"+lm+"</lastmod></url>").join("\n")+"\n</urlset>\n");
    }
    if(url==="/manifest.webmanifest"){
      res.writeHead(200,{"Content-Type":"application/manifest+json; charset=utf-8"});
      return res.end(JSON.stringify({id:"/",name:"LoLphabet",short_name:"LoLphabet",description:"LoLphabet is a League of Legends completion tracker and A–Z challenge.",start_url:"/",scope:"/",display:"standalone",background_color:"#0f1318",theme_color:"#0f1318",
        icons:[{src:"/assets/icon-192.png",sizes:"192x192",type:"image/png",purpose:"any maskable"},{src:"/assets/icon-512.png",sizes:"512x512",type:"image/png",purpose:"any maskable"}]}));
    }
    const am=url.match(/^\/assets\/([\w-]+\.png)$/);
    if(am){const f=path.join(__dirname,"assets",am[1]); if(fs.existsSync(f)){res.writeHead(200,{"Content-Type":"image/png","Cache-Control":"public, max-age=86400"});return res.end(fs.readFileSync(f))}}
    if(url==="/privacy"||url==="/terms"){
      const b=baseUrl(req), src=url==="/privacy"?PRIVACY:TERMS;
      return servePage(req,res,url+"|"+b,"v",()=>src.replace("<!--CANON-->",`<link rel="canonical" href="${b}${url}">`));
    }
    if(url==="/api/visit"&&req.method==="POST") return send(res,200,{n:countVisit(req),total:db.visits.total});
    if(url==="/api/roles"&&req.method==="GET") return db.roles?send(res,200,db.roles):send(res,404,{error:"not ready"});
    if(url==="/api/builds"&&req.method==="GET"){
      const q=new URL(req.url,"http://x").searchParams, champ=String(q.get("champion")||"").slice(0,60), pos=String(q.get("position")||"").toUpperCase();
      if(!champ) return send(res,400,{error:"champion is required"});
      if(pos&&!POSITIONS.includes(pos)) return send(res,400,{error:"position must be one of "+POSITIONS.join(", ")});
      res.setHeader("Cache-Control","no-cache"); return send(res,200,buildResponse(champ,pos));
    }
    if(url==="/api/builds/status"&&req.method==="GET"){
      loadBuilds(); res.setHeader("Cache-Control","no-cache");
      return send(res,200,{state:BUILDS.index.size?"ok":"no_data",collector_dir:COLLECTOR_DIR,loaded_from:BUILDS.dir||null,records:BUILDS.total,skipped_records:BUILDS.skipped,champions:BUILDS.index.size?new Set([...BUILDS.index.values()]).size:0,data:buildFresh()});
    }
    if(url==="/api/config") return send(res,200,{googleClientId:CID});
    if(url==="/api/login"&&req.method==="POST"){
      if(!CID) return send(res,500,{error:"GOOGLE_CLIENT_ID not set"});
      const {access_token}=await body(req);
      if(!access_token) return send(res,400,{error:"missing token"});
      // Check the token was issued to OUR client, then fetch the profile.
      const ti=await fetch("https://oauth2.googleapis.com/tokeninfo?access_token="+encodeURIComponent(access_token));
      const info=await ti.json();
      if(!ti.ok||(info.aud!==CID&&info.azp!==CID)) return send(res,401,{error:"invalid token"});
      const ui=await fetch("https://www.googleapis.com/oauth2/v3/userinfo",{headers:{Authorization:"Bearer "+access_token}});
      const p=await ui.json();
      if(!ui.ok||!p.sub||(info.sub&&info.sub!==p.sub)||p.email_verified===false) return send(res,401,{error:"invalid token"});
      const t={sub:p.sub,name:p.name,given_name:p.given_name,email:p.email};
      const isNew=!db.users[t.sub];
      const u=db.users[t.sub]=db.users[t.sub]||{progress:{}};
      if(!u.custom){u.name=t.name||t.email; u.given=t.given_name||u.name;}
      u.email=t.email;
      for(const k in db.sessions) if(db.sessions[k].exp<Date.now()) delete db.sessions[k];
      const tok=crypto.randomBytes(32).toString("hex");
      db.sessions[tok]={sub:t.sub,exp:Date.now()+TTL};
      persist();
      return send(res,200,{token:tok,name:u.name,given:u.given,email:u.email,isNew});
    }
    const sm=url.match(/^\/api\/shared\/([\w-]+)$/);
    if(sm&&req.method==="GET"){
      const owner=db.users[db.shares[sm[1]]];
      if(!owner) return send(res,404,{error:"not found"});
      return send(res,200,{name:owner.given||owner.name,data:owner.progress});
    }
    const tm=url.match(/^\/api\/template\/([\w-]+)$/);
    if(tm&&req.method==="GET"){
      const t=db.templates[tm[1]]; if(!t) return send(res,404,{error:"not found"});
      return send(res,200,{name:t.name,champs:t.champs,by:t.by});
    }
    if(!url.startsWith("/api/")){
      res.writeHead(404,{"Content-Type":"text/html; charset=utf-8","X-Robots-Tag":"noindex"});
      return res.end(page("Page not found",'<p>That page does not exist. <a href="/">Go to the LoLphabet A–Z Challenge tracker</a>.</p>',"Page not found.").replace('content="index, follow"','content="noindex"').replace("<!--CANON-->",""));
    }
    const sub=userOf(req);
    if(!sub) return send(res,401,{error:"not signed in"});
    if(url==="/api/progress"&&req.method==="GET") return send(res,200,{data:db.users[sub].progress,name:db.users[sub].given||db.users[sub].name});
    if(url==="/api/progress"&&req.method==="PUT"){
      const data=await body(req);
      if(!data||typeof data!=="object"||Array.isArray(data)) return send(res,400,{error:"bad data"});
      db.users[sub].progress=data; persist(); return send(res,200,{ok:true});
    }
    if(url==="/api/template"&&req.method==="POST"){
      const b=await body(req), u=db.users[sub];
      const name=String(b.name||"").trim().slice(0,30), champs=Array.isArray(b.champs)?b.champs.map(x=>String(x).trim().slice(0,40)).filter(Boolean).slice(0,400):[];
      if(!name||!champs.length) return send(res,400,{error:"name and champions required"});
      if(Object.values(db.templates).filter(t=>t.sub===sub).length>=100) return send(res,429,{error:"too many shared lists"});
      const tok=crypto.randomBytes(9).toString("base64url");
      db.templates[tok]={sub,name,champs,by:u.given||u.name,created:Date.now()}; persist();
      return send(res,200,{token:tok});
    }
    if(url==="/api/share"){
      const u=db.users[sub];
      if(req.method==="GET") return send(res,200,{token:u.share||null});
      if(req.method==="POST"){
        if(u.share) delete db.shares[u.share];
        u.share=crypto.randomBytes(18).toString("base64url"); db.shares[u.share]=sub; persist();
        return send(res,200,{token:u.share});
      }
      if(req.method==="DELETE"){ if(u.share) delete db.shares[u.share]; u.share=null; persist(); return send(res,200,{ok:true}); }
    }
    if(url==="/api/profile"&&req.method==="PUT"){
      const n=String((await body(req)).name||"").trim().slice(0,40);
      if(!n) return send(res,400,{error:"name required"});
      const u=db.users[sub]; u.name=u.given=n; u.custom=true; persist(); return send(res,200,{name:n});
    }
    if(url==="/api/account"&&req.method==="DELETE"){
      {const o=db.users[sub]; if(o&&o.share) delete db.shares[o.share]; for(const k in db.templates) if(db.templates[k].sub===sub) delete db.templates[k];} delete db.users[sub]; for(const k in db.sessions) if(db.sessions[k].sub===sub) delete db.sessions[k];
      persist(); return send(res,200,{ok:true});
    }
    if(url==="/api/logout"&&req.method==="POST"){delete db.sessions[token(req)];persist();return send(res,200,{ok:true})}
    send(res,404,{error:"not found"});
  }catch(e){send(res,500,{error:String(e.message||e)})}
}).listen(PORT,()=>{refreshRoles(); setInterval(refreshRoles,864e5).unref(); console.log("LoL A-Z tracker on http://localhost:"+PORT+(CID?"":"  (no GOOGLE_CLIENT_ID: sign-in disabled)"));});
