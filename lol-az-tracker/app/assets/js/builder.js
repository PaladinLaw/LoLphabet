function loadRoles(){
  fetch("/api/roles").then(r=>r.ok?r.json():Promise.reject()).then(d=>{
    if(!d||!d.lists) return;
    ROLEDATA=d; try{localStorage.setItem("lol-az-roles",JSON.stringify(d))}catch(e){}
    rebuildLists(); render();
  }).catch(()=>{});
}
let bld=null;
function openBuilder(key){
  const l=key?(all.__lists||[]).find(x=>"c:"+x.id===key):null;
  bld={id:l?l.id:null,champs:new Set(l?l.champs:[]),q:""};
  view="build";
  $("builder").innerHTML=`<h3>${l?"Edit list":"New custom list"}</h3>
    <div class="row"><input class="fld" id="bname" maxlength="30" placeholder="List name (e.g. Mages)" value="${esc(l?l.name:"")}"></div>
    <div class="row"><input class="fld" type="search" id="bq" placeholder="Search champions…">
      <select class="fld" id="bfrom"><option value="">Start from a list…</option>${Object.keys(LISTS).filter(k=>!k.startsWith("c:")).map(r=>`<option value="${esc(r)}">${esc(label(r))}</option>`).join("")}</select>
      <button data-b="all">Select shown</button><button data-b="none">Clear</button></div>
    <small id="bcount"></small><div class="chips" id="bchips"></div>
    <div class="row"><button class="pri" data-b="save">Save list</button><button data-b="cancel">Cancel</button>${l?'<button class="danger" data-b="del" style="margin-left:auto">Delete list</button>':""}</div>
    <p class="err" id="berr"></p>`;
  render();
}
function drawChips(){
  if(view!=="build"||!bld) return;
  const q=bld.q.trim().toLowerCase(), ros=roster([...bld.champs]);
  const shown=ros.filter(n=>n.toLowerCase().includes(q)), exact=ros.some(n=>n.toLowerCase()===q);
  $("bchips").innerHTML=shown.map(n=>`<button class="chip ${bld.champs.has(n)?"on":""}" data-c="${esc(n)}">${esc(n)}</button>`).join("")
    +(q&&!exact?`<button class="chip" data-new="${esc(bld.q.trim())}">＋ Add “${esc(bld.q.trim())}” as a new champion</button>`:"");
  $("bcount").textContent=bld.champs.size+" selected · "+shown.length+" shown";
}
async function deleteList(id){
  const l=(all.__lists||[]).find(x=>x.id===id); if(!l) return;
  if(!await confirmDlg("Delete this list?",'"'+l.name+'" and its progress will be removed.',"Delete list",true)) return;
  all.__lists=all.__lists.filter(x=>x.id!==id); for(const k of Object.keys(all)) if(k==="c:"+id||k.startsWith("c:"+id+"|")) delete all[k];
  rebuildLists(); view="role"; save(); render();
}
$("builder").addEventListener("input",e=>{if(e.target.id==="bq"){bld.q=e.target.value;drawChips()}});
$("builder").addEventListener("change",e=>{
  if(e.target.id==="bfrom"&&e.target.value){bld.champs=new Set(LISTS[e.target.value].map(c=>c.name));e.target.value="";drawChips()}});
$("builder").addEventListener("click",e=>{
  const b=e.target.closest("button"); if(!b) return;
  if(b.dataset.c){const n=b.dataset.c; bld.champs.has(n)?bld.champs.delete(n):bld.champs.add(n); drawChips();}
  else if(b.dataset.new){bld.champs.add(b.dataset.new); bld.q=""; $("bq").value=""; drawChips();}
  else if(b.dataset.b==="all"){roster([...bld.champs]).filter(n=>n.toLowerCase().includes(bld.q.trim().toLowerCase())).forEach(n=>bld.champs.add(n)); drawChips();}
  else if(b.dataset.b==="none"){bld.champs.clear(); drawChips();}
  else if(b.dataset.b==="cancel"){view="role"; render();}
  else if(b.dataset.b==="del"){deleteList(bld.id);}
  else if(b.dataset.b==="save"){
    const err=m=>{$("berr").textContent=m}, name=$("bname").value.trim().slice(0,30);
    if(!name) return err("Give your list a name.");
    if(!bld.champs.size) return err("Pick at least one champion.");
    const lists=all.__lists||(all.__lists=[]);
    if(lists.some(l=>l.id!==bld.id&&l.name.toLowerCase()===name.toLowerCase())||Object.keys(LISTS).filter(k=>!k.startsWith("c:")).some(r=>label(r).toLowerCase()===name.toLowerCase())) return err("You already have a list with that name.");
    const champs=[...bld.champs].sort(cmp); let l=bld.id&&lists.find(x=>x.id===bld.id);
    if(l){l.name=name;l.champs=champs}else{l={id:Math.random().toString(36).slice(2,8),name,champs};lists.push(l)}
    rebuildLists(); role="c:"+l.id; CHAMPS=LISTS[role]; view="role"; save(); render();
  }
});
