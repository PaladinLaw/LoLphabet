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
    "Press <b>✓ Win</b> (or <b>＋ Win</b> on its card) each time you win. Wins are counted, but they never complete a champion. Use <b>−</b> if you logged one by mistake.",
    "Lose a game and press <b>☠ Died</b>: that champion is gone for good. It is greyed out and can't be picked or edited again.",
    "The run is over when you lose with your last champion. Progress shows how many have fallen, and Stats show your wins, deaths and best champion."
  ]
};
function renderHowto(){
  const b=document.querySelector("#howto .body"), mm=MODES.find(m=>m[0]===mode)||MODES[0];
  if(!b) return;
  const html=`<b>${esc(mm[1])}</b> · ${esc(mm[2])}<br>`+(HOWTO[mode]||HOWTO.classic).join("<br>")+`<br>Not sure what to play? Press <b>Roll</b> for a random role and champion, shown with its build and kept separate from your lists.<br>See our <a href="/about" id="aboutlink">about section</a> for more details`;
  if(b.dataset.m===mode&&b.dataset.ok) return;       // only touch the DOM when the mode changed
  b.dataset.m=mode; b.dataset.ok="1"; b.innerHTML=html;
  const l=$("aboutlink"); if(l) l.onclick=e=>{e.preventDefault();view="about";render();window.scrollTo&&window.scrollTo(0,0)};
}
