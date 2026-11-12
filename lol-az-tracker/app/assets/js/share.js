// ---- Sharing: the Share button copies your share link, which previews with a progress image (Open Graph) ----
const RAND_MODES=["random","randhc","randhard"], LOCK_MODES=["hardcore","randhc","hard","randhard"];
// The list + mode played most recently. Uses the per-run timestamp (__meta.t); older data without timestamps falls back to the run with the most wins.
function latestRun(d){
  let best=null;
  for(const k in d){
    if(k==="__lists"||!d[k]||typeof d[k]!=="object") continue;
    const i=k.lastIndexOf("|"), r=i<0?k:k.slice(0,i), md=i<0?"classic":k.slice(i+1);
    if(!LISTS[r]||!MODES.some(x=>x[0]===md)) continue;
    const t=(d[k].__meta&&d[k].__meta.t)||0, w=Object.keys(d[k]).filter(n=>n!=="__meta"&&d[k][n]&&d[k][n].won).length;
    if(!best||t>best.t||(t===best.t&&w>best.w)) best={role:r,mode:md,t,w};
  }
  return best&&(best.t||best.w)?best:null;
}
// Side-effect free summary of one run, used for the share image.
function runSnapshot(r,md){
  const names=(LISTS[r]||[]).map(c=>c.name), run=all[md==="classic"?r:r+"|"+md]||{}, m=run.__meta||{}, isW=n=>!!(run[n]&&run[n].won);
  let order=names; if(RAND_MODES.includes(md)&&m.order){const o=m.order.filter(n=>names.includes(n)); order=o.concat(names.filter(n=>!o.includes(n)))}
  const sk=m.skip||[], left=order.filter(n=>!isW(n));
  let nxt=left.find(n=>!sk.includes(n))||left[0]||null;
  if(!LOCK_MODES.includes(md)&&m.focus&&names.includes(m.focus)&&!isW(m.focus)) nxt=m.focus;
  return {role:r,mode:md,won:names.filter(isW).length,total:names.length,next:nxt,listName:label(r),modeName:MODES.find(x=>x[0]===md)[1]};
}
function shareTarget(){const t=latestRun(all); return runSnapshot(t?t.role:role,t?t.mode:mode)}
async function shareCanvas(sn){
  const who=session?(session.given||session.name):"";
  const cv=document.createElement("canvas"); cv.width=1200; cv.height=630; const g=cv.getContext("2d");
  const bg=g.createLinearGradient(0,0,1200,630); bg.addColorStop(0,"#16202e"); bg.addColorStop(1,"#0a0e14"); g.fillStyle=bg; g.fillRect(0,0,1200,630);
  g.strokeStyle="#d4af37"; g.lineWidth=6; g.strokeRect(24,24,1152,582);
  const img=new Image(); img.src=$("fav").href; await new Promise(r=>{img.onload=r;img.onerror=r}); g.drawImage(img,70,62,110,110);
  g.fillStyle="#e8e4d8"; g.font="bold 42px Georgia,serif"; g.fillText("LoLphabet",205,112);
  g.fillStyle="#8d9199"; g.font="28px system-ui,sans-serif"; g.fillText(location.host,205,156);
  g.fillStyle="#d4af37"; g.font="bold 170px Georgia,serif"; g.fillText(sn.won+" / "+sn.total,70,350);
  const line=(who?who+" is on ":"")+sn.listName+(sn.mode!=="classic"?" · "+sn.modeName:""); let fs=54; g.fillStyle="#e8e4d8";
  do{g.font="bold "+fs+"px system-ui,sans-serif";fs-=2}while(g.measureText(line).width>1060&&fs>24); g.fillText(line,70,432);
  g.fillStyle="#2a323d"; g.fillRect(70,470,1060,26); g.fillStyle="#5fcf8b"; g.fillRect(70,470,sn.total?1060*sn.won/sn.total:0,26);
  g.fillStyle="#8d9199"; g.font="32px system-ui,sans-serif"; g.fillText(sn.next?"Next up: "+sn.next:sn.total?"A–Z complete!":"",70,566);
  return cv;
}
// Renders the progress image and stores it on the server so the share link previews with it. Best effort: the link still works without it.
async function uploadShareImage(){
  try{
    const sn=shareTarget(), cv=await shareCanvas(sn);
    const img=cv.toDataURL("image/jpeg",0.9).split(",")[1];     // JPEG keeps the gradient image small (~100 KB); chat apps skip big preview images
    await api("PUT","/api/share/image",{img,desc:sn.listName+(sn.mode!=="classic"?" · "+sn.modeName:"")+": "+sn.won+" / "+sn.total+" won"});
    return true;
  }catch(e){return false}
}
// Keeps the share link's preview image up to date: after any win/loss/undo, re-render it and replace the stored one (debounced, only if you have a share link).
let imgT, imgBusy=false, imgDirty=false;
function queueShareImage(){
  if(READONLY||!session) return;
  clearTimeout(imgT);
  imgT=setTimeout(async()=>{
    if(shareTok===undefined){try{const r=await api("GET","/api/share"); shareTok=r.token||null}catch(e){return}}
    if(!shareTok) return;
    if(imgBusy){imgDirty=true;return}
    imgBusy=true; try{do{imgDirty=false; await uploadShareImage()}while(imgDirty)}finally{imgBusy=false}
  },3000);
}
// Copies text that may only be known after an async step. Passing a promise to ClipboardItem keeps the copy tied to the click (needed on Safari).
async function copyText(textPromise){
  try{
    if(window.ClipboardItem&&navigator.clipboard&&navigator.clipboard.write){
      await navigator.clipboard.write([new ClipboardItem({"text/plain":Promise.resolve(textPromise).then(t=>new Blob([t],{type:"text/plain"}))})]); return true;
    }
  }catch(e){}
  try{await navigator.clipboard.writeText(await textPromise); return true}catch(e){return false}
}
const shareFail=x=>info("Couldn't create the link","Error "+(x.status||"network")+". A 404 means the server.js on your host is out of date: replace it and restart the container.");
async function shareProgress(){
  if(!session){
    if(!authOn){await info("Sharing isn't available","Share links need an account, and accounts aren't available on this site.");return}
    const v=await ask({title:"Log in to share",body:"A share link lets anyone open your progress (read-only), and it needs a free account. Log in, then press Share again.",cancel:null,buttons:[{label:"Not now",value:null},{label:"Log in / Sign up",cls:"pri",value:"login"}]});
    if(v==="login") openAuth(); return;
  }
  let created=false;
  try{ if(shareTok===undefined){const r=await api("GET","/api/share"); shareTok=r.token||null} }
  catch(x){ if(x.status===401) return signOut(); await shareFail(x); return }
  if(!shareTok){
    const yes=await ask({title:"Create a share link?",cancel:false,
      body:"A share link lets anyone who has it see your progress (read-only). When you paste it in Discord or a chat, it shows a preview image of your progress.\n\nYou can stop sharing at any time from Settings.\n\nIf you'd rather not, that's fine, but your progress can only be shared if you create a share link.",
      buttons:[{label:"No thanks",value:false},{label:"Create link",cls:"pri",value:true}]});
    if(!yes) return;
    try{const r=await api("POST","/api/share"); shareTok=r.token; created=true; renderSettings()}catch(x){await shareFail(x); return}
  }
  const link=location.origin+"/s/"+shareTok;
  const copied=await copyText(uploadShareImage().then(()=>link));
  if(created||!copied){
    const v=await ask({title:created?"Share link created":"Your share link",cancel:null,
      body:(copied?"Link copied to your clipboard.":"Copy your link below.")+(created?" You can stop sharing at any time from Settings.":""),
      input:{value:link,readonly:true},buttons:[{label:"Close",value:null},{label:"Copy link",cls:"pri",input:true}]});
    if(v) await copyText(v);
  }else{
    const lab=()=>document.querySelector("#shimg .shl"); if(lab()){const old=lab().textContent; lab().textContent="✓ Link copied"; setTimeout(()=>{if(lab()) lab().textContent=old},2200);}
  }
}
$("shimg").onclick=shareProgress;
$("sharelist").onclick=async()=>{
  if(!session){await info("Log in to share lists","Sharing a list creates a link on the server, so you need to be logged in.");return}
  const l=(all.__lists||[]).find(x=>"c:"+x.id===role); if(!l) return;
  try{
    const r=await api("POST","/api/template",{name:l.name,champs:l.champs}), link=location.origin+"/t/"+r.token;
    const v=await ask({title:"Share this list",body:"Anyone with this link can add a copy of the list to their own tracker.",cancel:null,input:{value:link,readonly:true},buttons:[{label:"Close",value:null},{label:"Copy link",cls:"pri",input:true}]});
    if(v){try{await navigator.clipboard.writeText(v)}catch(x){} await info("Link copied",link)}
  }catch(x){await info("Couldn't create the link","Error "+(x.status||"network")+". A 404 means the server.js on your host is out of date: replace it and restart the container.")}
};
