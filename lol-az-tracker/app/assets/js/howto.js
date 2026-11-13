// ---- "How it works" under the title: explains the challenge mode that is selected right now ----
const HOWTO={
  classic:[
    "Win a game with every champion on the list, working through them in alphabetical order.",
    "Next up shows the next champion. Press <b>✓ Complete</b> when you win with it, or <b>✗ Loss</b> to log a lost attempt.",
    "Banned, or taken in champ select? Press <b>Picked / Banned</b> to skip it for now, or click any champion in the list to open it in Next up instead.",
    "On a champion's card, <b>+</b> and <b>−</b> add or remove attempts and <b>✎</b> adds a note."
  ],
  hard:[
    "Same list, same alphabetical order, but only the Next up champion can be played.",
    "Press <b>✓ Complete</b> when you win. If you lose, press <b>✗ Lost - Back one</b>: the last champion you completed is un-completed, and you have to win with it again before you can retry the one you lost with.",
    "Lose before you've won anything and the loss is simply logged.",
    "<b>Picked / Banned</b> skips a champion for now without counting as a loss. Stats track your setbacks."
  ],
  hardcore:[
    "Same list, same alphabetical order, and only the Next up champion can be played. One loss ends the run.",
    "Press <b>✓ Complete</b> when you win. If you lose, press <b>✗ Lost - Restart</b> and the whole run starts again from the first champion. Your notes are kept.",
    "<b>Picked / Banned</b> skips a champion for now without counting as a loss.",
    "Stats track your current run, your best run and how many times you've restarted."
  ],
  nuzlocke:[
    "Play any champion on the list, in any order, as many times as you like. Click a champion to open it under <b>Now playing</b>.",
    "Press <b>✓ Victory</b> (or <b>＋ Victory</b> on its card) each time you win. Victories are counted, but they never complete a champion. Use <b>−</b> if you logged one by mistake.",
    "Lose a game and press <b>"+SKULL+" Fallen</b>: that champion is gone for good. It is greyed out and can't be picked or edited again.",
    "The run is over when you lose with your last champion. Progress shows how many have fallen, and Stats show your wins, fallen champions and best champion."
  ]
};
// ---- Opens by itself the first time you see each mode; after that it stays the way you left it, per mode. ----
// HW.modes[mode] is "open" / "closed" once you've seen that mode; HW.auto is the "Show How it works for new modes" setting (Settings > Preferences).
const HW_KEY="lol-az-howto-v2";
let HW={auto:true,modes:{}}, hwMode=null, hwProg=false;
try{const o=JSON.parse(localStorage.getItem(HW_KEY));
  if(o&&typeof o==="object"){HW.auto=o.auto!==false; if(o.modes&&typeof o.modes==="object")HW.modes=o.modes}
  else{const old=localStorage.getItem("lol-az-howto"); if(old==="1"||old==="0")HW.modes.classic=old==="1"?"open":"closed"}}catch(e){}   // old single open/closed flag counts as Classic already seen
const hwSave=()=>{if(READONLY)return; try{localStorage.setItem(HW_KEY,JSON.stringify(HW))}catch(e){}};
function hwSync(){
  const hw=$("howto"); if(!hw||hwMode===mode||(view!=="role"&&view!=="roll")) return;       // only count a mode as "seen" when the panel is actually on screen
  hwMode=mode; let want=HW.modes[mode];
  if(want===undefined){ if(HW.auto&&!READONLY){want="open"; HW.modes[mode]="open"; hwSave()} else want="closed" }
  const o=want==="open"; if(hw.open!==o){hwProg=true; hw.open=o}                           // hwProg: ignore the toggle event this change fires, it isn't the user's choice
}
$("howto").addEventListener("toggle",()=>{
  if(hwProg){hwProg=false; return}
  if(READONLY) return; HW.modes[mode]=$("howto").open?"open":"closed"; hwSave();
});
function hwLink(){const a=$("hwauto"); if(a) a.textContent=HW.auto?"Don't show me this again":"Show this automatically for new modes"}
function hwToggleAuto(){
  HW.auto=!HW.auto; hwSave(); hwLink();
  if(!HW.auto) $("howto").open=false;                                                         // turning it off also closes it (the toggle event records "closed" for this mode)
}
function renderHowto(){
  const b=document.querySelector("#howto .body"), mm=MODES.find(m=>m[0]===mode)||MODES[0];
  if(!b) return;
  hwSync();
  const html=`<b>${esc(mm[1])}</b> · ${esc(mm[2])}<br>`+(HOWTO[mode]||HOWTO.classic).join("<br>")+`<br>Not sure what to play? Press <b>Roll</b> for a random role and champion, shown with its build and kept separate from your lists.<br>See our <a href="/about" id="aboutlink">about section</a> for more details · <a href="#" id="hwauto"></a>`;
  if(b.dataset.m===mode&&b.dataset.ok){hwLink(); return}       // only touch the DOM when the mode changed
  b.dataset.m=mode; b.dataset.ok="1"; b.innerHTML=html;
  const l=$("aboutlink"); if(l) l.onclick=e=>{e.preventDefault();view="about";render();window.scrollTo&&window.scrollTo(0,0)};
  const h=$("hwauto"); if(h) h.onclick=e=>{e.preventDefault(); hwToggleAuto()};
  hwLink();
}
