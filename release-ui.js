/* 3.0.12: integrate the existing workspaces with the shared saved-game model. */
'use strict';
const A312=FoxesAnalytics;
function normalizedGame312(g, legacy) {
  g.officialStats=A312.normalize(g.officialStats,g.players,legacy);
  g.statsSchema312=true;
}
function autoPrefs29(){v21Write(LAB_PREF_KEY,{mode:$('#labAutoMode')?.value||'off',debounce:Number($('#labAutoDebounce')?.value||750)});autoStatus29();}
function team29(g){const t=A312.normalize(g.officialStats,g.players).team,rs=A312.records(g);return {gf:t.goalsFor?.total||rs.filter(r=>r.type==='skater').reduce((n,r)=>n+r.g,0),ga:t.goalsAgainst?.total||rs.filter(r=>r.type==='goalie').reduce((n,r)=>n+r.ga,0),sf:t.shotsFor?.total||rs.filter(r=>r.type==='skater').reduce((n,r)=>n+r.shots,0),sa:t.shotsAgainst?.total||rs.filter(r=>r.type==='goalie').reduce((n,r)=>n+r.sa,0)};}
function report29(parent=false){openWorkspace('mygames');gameTab312('report');}
function insights29(){const m=$('#labInsights');if(m)m.innerHTML=ratings312();}
function migrate312() {
  const legacy=q295Load();
  const currentBefore=state.savedGames.find(g=>g.id===state.currentGameId);
  const currentLegacy=currentBefore?.statsSchema312?null:legacy[state.currentGameId];
  (state.savedGames||[]).forEach(g=>normalizedGame312(g,g.statsSchema312?null:legacy[g.id]));
  state.officialStats=A312.normalize(currentLegacy?{...state.officialStats,schema312:false}:state.officialStats,state.players,currentLegacy);
}
function season312(games=state.savedGames||[]) {return A312.season(games,state.players,state.ratingWeights312||A312.weights);}
function table312(headers,rows) {return `<div style="overflow:auto"><table class="lab-table"><thead><tr>${headers.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${headers.length}">No game stats yet.</td></tr>`}</tbody></table></div>`;}
function row312(values) {return `<tr>${values.map(x=>`<td>${x}</td>`).join('')}</tr>`;}
function player312(r) {return `<button data-profile-number="${esc(r.p.number)}">#${esc(r.p.number)} ${esc(r.p.name)}</button>`;}
function renderSeason312() {
  const mount=$('#season312');if(!mount)return;
  const rows=season312();
  mount.innerHTML=workspaceHeader('Season Stats','Automatically calculated from saved games. Edit a game in My Games to correct totals.')+
    `<div class="card"><h2>Skaters</h2>${table312(['Player','GP','G','A','PTS','SOG','S%','PIM','+/-','BLK','FO%','TOI'],rows.filter(r=>r.type==='skater').map(r=>row312([player312(r),r.gp,r.g,r.a,r.pts,r.shots,fmtPct(r.shotPct),r.pim,r.pm,r.blocks,r.fo?fmtPct(r.foPct):'—',formatSec(r.toi)])))}</div>`+
    `<div class="card"><h2>Goalies</h2>${table312(['Player','GP','MIN','Saves','SA','GA','SV%','GAA','W','L','T','SO'],rows.filter(r=>r.type==='goalie').map(r=>row312([player312(r),r.gp,r.min.toFixed(2),r.saves,r.sa,r.ga,r.sa?r.svPct.toFixed(3):'—',r.min?r.gaa.toFixed(2):'—',r.w,r.l,r.t,r.so])))}</div>`+
    `<div class="card"><h2>Foxes Player Rating</h2>${ratings312(rows)}</div>`;
}
function ratings312(rows=season312()) {
  return table312(['Player','Game Rating (selected)','Season Rating','Recent movement','Season rating history'],rows.map(r=>{
    const current=r.games.find(g=>g.id===state.currentGameId);
    return row312([player312(r),current?current.rating.toFixed(1):'—',r.value.toFixed(1),`${r.delta>=0?'+':''}${r.delta.toFixed(1)}`,r.history.map(n=>n.toFixed(1)).join(' → ')]);
  }));
}
function renderGameHub312() {
  const mount=$('#gameHub312');if(!mount)return;
  const game=state.savedGames.find(g=>g.id===state.currentGameId);
  mount.innerHTML=game?`<div class="card"><h2>${esc(game.date)} • ${esc(game.opponent)}</h2><div class="row">${[['overview','Overview'],['entry','Enter Stats'],['film','Film'],['tracking','Shifts / Ice Time'],['ratings','Player Ratings'],['report','Game Report']].map(([id,label])=>`<button data-game-tab312="${id}">${label}</button>`).join('')}</div><div id="gameDetail312" style="margin-top:16px"></div></div>`:'<div class="card">Create or open a saved game to enter stats, review film, and track development.</div>';
  mount.querySelectorAll('[data-game-tab312]').forEach(b=>b.onclick=()=>gameTab312(b.dataset.gameTab312));
  if(game)gameTab312('overview');
}
function gameTab312(tab) {
  if(tab==='entry'){openWorkspace('quickstats');return;}
  if(tab==='film'||tab==='tracking'){openWorkspace(tab);return;}
  const m=$('#gameDetail312'),g=state.savedGames.find(g=>g.id===state.currentGameId);if(!m||!g)return;
  if(tab==='ratings'){m.innerHTML=ratings312();return;}
  if(tab==='report') {
    const rows=A312.records(g);
    m.innerHTML=`<h3>Game Report • ${esc(g.opponent)}</h3>${table312(['Player','G / Saves','A / GA','SOG / SA','TOI / MIN','Game Rating'],rows.filter(r=>r.played).map(r=>row312([player312(r),r.type==='goalie'?r.saves:r.g,r.type==='goalie'?r.ga:r.a,r.type==='goalie'?r.sa:r.shots,r.type==='goalie'?r.min:formatSec(r.toi),A312.rate(r,state.ratingWeights312).value.toFixed(1)])))}<button id="printGame312">Print Game Report</button><button id="fullReport312">Open Coach Lab Report</button>`;
    $('#printGame312').onclick=()=>{document.body.classList.add('print-game312');window.print();document.body.classList.remove('print-game312');};
    $('#fullReport312').onclick=()=>{openWorkspace('coachlab');document.querySelector('[data-lab="report"]')?.click();report29(false);};return;
  }
  const team=team29(g);
  m.innerHTML=`<p>${esc(gameCompletionStatus(g))} • ${(g.filmClips||[]).length} film clips</p><p>Score: ${team.gf} – ${team.ga}</p><p>Stats, tags, shifts and film all belong to this saved game.</p><button id="official312">Official Stats / Import & Events</button><button id="clearStats312">Delete This Game’s Box Score</button>`;
  $('#official312').onclick=()=>openWorkspace('stats');
  $('#clearStats312').onclick=()=>{
    if(!confirm('Delete this game’s entered/imported box score? Film, event tags, shifts and other games are preserved. Event-derived stats will remain.'))return;
    state.officialStats=emptyOfficialStats();
    const legacy=q295Load();delete legacy[g.id];q295SaveAll(legacy);
    save();render();renderGameHub312();
  };
}
function renderEntry312() {
  const m=$('#quickStatsMount');if(!m)return;
  if(!state.savedGames.some(g=>g.id===state.currentGameId)){m.innerHTML=workspaceHeader('Enter Game Stats','Select or create a saved game in My Games first.')+'<button id="chooseGame312">My Games</button>';$('#chooseGame312').onclick=()=>openWorkspace('mygames');return;}
  const off=A312.normalize(state.officialStats,state.players);
  const input=(scope,p,key,value,step=1)=>`<input class="q295-input" data-entry312="${scope}" data-player312="${esc(p.number)}" data-field312="${key}" type="number" ${key==='plusMinus'?'':'min="0"'} step="${step}" value="${A312.number(value)}" aria-label="${esc(p.name)} ${key}">`;
  const skfields=['gp','g','a','shots','plusMinus','pim','fow','fol','blocks','toiMin','ch','tk','gv','ppg','ppp','shg','shp','gwg','gtg'];
  const gfields=['gp','min','saves','ga','w','l','t','so','g','a','ppg','ppp','shg','shp'];
  m.innerHTML=workspaceHeader('Enter Game Stats',`${esc(state.gameDate)} • ${esc(state.opponent)} — Save applies only to this game.`, '<button id="q295Save" class="good">Save Game Stats</button>')+
    '<p>GP: 1 if the player played, 0 if absent. TOI is minutes; film-tracked TOI is used unless you enter an override. Goalie S means saves; SA = saves + GA; GAA uses 36 minutes.</p><div id="entryStatus312" role="status"></div>'+
    `<form id="entryForm312"><div class="card"><h2>Skaters</h2>${table312(['Player','GP','G','A','SOG','+/-','PIM','FOW','FOL','BLK','TOI (min)','CH','TK','GV','PPG','PPP','SHG','SHP','GWG','GTG'],state.players.filter(p=>p.pos!=='G').map(p=>{const r=off.skaters[p.number]||{};return row312([`#${esc(p.number)} ${esc(p.name)}`,...skfields.map(k=>k==='toiMin'?`<input class="q295-input" type="number" min="0" step="0.01" data-entry312="skaters" data-player312="${esc(p.number)}" data-field312="toiMin" value="${r.toiMin??''}" placeholder="Film" aria-label="${esc(p.name)} TOI minutes">`:input('skaters',p,k,r[k],k==='pim'?.5:1))]);}))}</div>`+
    `<div class="card"><h2>Goalies</h2>${table312(['Player','GP','MIN','Saves','GA','W','L','T','SO','G','A','PPG','PPP','SHG','SHP'],state.players.filter(p=>p.pos==='G').map(p=>{const r=off.goalies[p.number]||{};return row312([`#${esc(p.number)} ${esc(p.name)}`,...gfields.map(k=>input('goalies',p,k,r[k],k==='min'?.01:1))]);}))}</div>`+
    `<div class="card"><h2>Team</h2>${['goalsFor','goalsAgainst','shotsFor','shotsAgainst'].map(k=>`<label>${k.replace(/([A-Z])/g,' $1')}<input class="q295-input" type="number" min="0" step="1" data-team312="${k}" value="${A312.number(off.team[k]?.total)}"></label>`).join('')}<div>${[['PP chances','ppChances'],['PP goals','ppSuccess'],['PK chances','pkChances'],['PK kills','pkSuccess'],['Faceoff wins','fow'],['Faceoff losses','fol']].map(([label,k])=>`<label>${label}<input class="q295-input" type="number" min="0" step="1" data-team-extra312="${k}" value="${A312.number(off.team[k])}"></label>`).join('')}</div>${['goalsFor','goalsAgainst'].map(k=>`<div>${['p1','p2','p3','ot'].map(period=>`<label>${k} ${period}<input class="q295-input" type="number" min="0" step="1" data-period-group312="${k}" data-period312="${period}" value="${A312.number(off.team[k]?.[period])}"></label>`).join('')}</div>`).join('')}</div></form>`;
  $('#q295Save').onclick=commitEntry312;
  m.querySelectorAll('[data-entry312]').forEach(el=>el.addEventListener('input',()=>{
    if(el.dataset.field312!=='gp'&&el.value!==''&&Number(el.value)!==0){const gp=m.querySelector(`[data-entry312="${el.dataset.entry312}"][data-player312="${el.dataset.player312}"][data-field312="gp"]`);if(gp)gp.value='1';}
  }));
}
function commitEntry312() {
  if(!state.currentGameId||!$('#entryForm312')?.reportValidity())return;
  const off=A312.normalize(state.officialStats,state.players);
  document.querySelectorAll('[data-entry312]').forEach(el=>{
    const r=off[el.dataset.entry312][el.dataset.player312] ||= {};
    if(el.dataset.field312==='toiMin'&&el.value===''){delete r.toiMin;delete r.toi;}else r[el.dataset.field312]=Number(el.value);
  });
  Object.values(off.skaters).forEach(r=>{r.fo=A312.number(r.fow)+A312.number(r.fol);});
  document.querySelectorAll('[data-team312]').forEach(el=>{off.team[el.dataset.team312]={...off.team[el.dataset.team312],total:Number(el.value)};});
  document.querySelectorAll('[data-team-extra312]').forEach(el=>off.team[el.dataset.teamExtra312]=Number(el.value));
  document.querySelectorAll('[data-period312]').forEach(el=>off.team[el.dataset.periodGroup312][el.dataset.period312]=Number(el.value));
  off.team.fo=A312.number(off.team.fow)+A312.number(off.team.fol);off.team.foPct=off.team.fo?off.team.fow/off.team.fo:0;
  off.team.ppPct=off.team.ppChances?off.team.ppSuccess/off.team.ppChances:0;off.team.pkPct=off.team.pkChances?off.team.pkSuccess/off.team.pkChances:0;
  off.imported=true;off.sourceName='game entry';
  // Keep legacy quick-entry metadata, but all readers use these canonical records.
  state.officialStats=A312.normalize(off,state.players);
  save();render();renderEntry312();$('#entryStatus312').textContent='Game stats saved. Season totals and ratings recalculated.';
}
function renderWeights312() {
  const m=$('#weights312');if(!m)return;
  const w=state.ratingWeights312||A312.weights;
  m.innerHTML=`<h2>Rating Weights</h2><p>Every player starts at 50.0. Game Ratings are bounded 0–100. Season Rating = (100 + sum of Game Ratings) / (2 + games played). History shows the recalculated season rating after each game. Missing TOI and non-participating faceoff categories are omitted and remaining weights are normalized. More minutes alone never add points.</p><p>Skater impact uses goals, assists, shots, points and shots per 36 minutes (minimum 3-minute sample), plus/minus, faceoff percentage, blocks and PIM. Goalies use a separate formula: save percentage 50%, GAA 25%, shot-rate performance 10%, result 10%, shutout 5%. Minutes and shots determine confidence. Ratings are coaching indicators, not scouting grades.</p><form id="weightForm312">${Object.keys(A312.weights).map(k=>`<label style="display:inline-block;margin:8px">${k}<input type="number" min="0" max="100" step="1" data-weight312="${k}" value="${w[k]}" style="width:65px">%</label>`).join('')}<button type="submit">Save Rating Weights</button><span id="weightStatus312" role="status"></span></form>`;
  $('#weightForm312').onsubmit=e=>{e.preventDefault();const next={};document.querySelectorAll('[data-weight312]').forEach(el=>next[el.dataset.weight312]=Number(el.value));if(Object.values(next).reduce((a,b)=>a+b,0)!==100){$('#weightStatus312').textContent='Weights must total 100%.';return;}state.ratingWeights312=next;save();renderSeason312();$('#weightStatus312').textContent='Saved. All ratings recalculated.';};
}
function updateCoach312() {
  const m=$('#coachSnapshot312');if(!m)return;
  const rows=season312(),sk=rows.filter(r=>r.type==='skater');
  const next=readSchedule301().filter(g=>(g.date||'')>=new Date().toLocaleDateString('en-CA')).sort((a,b)=>(a.date||'').localeCompare(b.date||''))[0];
  m.innerHTML=`<h2>Team Snapshot</h2><p>Next game: ${next?`${esc(next.date)} • ${esc(next.opponent)}`:'None scheduled'} • Season: ${sk.reduce((n,r)=>n+r.g,0)} goals, ${sk.reduce((n,r)=>n+r.shots,0)} shots</p><h3>Rating Movers</h3>${rows.filter(r=>r.games.length).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,5).map(r=>`<p>${player312(r)} ${r.value.toFixed(1)} (${r.delta>=0?'+':''}${r.delta.toFixed(1)})</p>`).join('')||'<p>Save game stats to see rating movement.</p>'}<p>Task: ${state.currentGameId?'Review the current game’s stats and film.':'Create or select a game in My Games.'}</p>`;
}
function setupFilm312() {
  const wrap=$('#tagOverlayWrap');
  const overlay=document.createElement('div');overlay.id='precision312';
  overlay.innerHTML=`<div class="row"><button id="analysis312">Enlarge / Fullscreen</button><span id="time312"></span>${[-1,-.25].map(n=>`<button data-seek312="${n}">${n} second</button>`).join('')}<button id="play312">Play / Pause</button>${[.25,1].map(n=>`<button data-seek312="${n}">+${n} second</button>`).join('')}</div><div class="row"><label>Player tag <select id="playerTag312"></select></label><label>Event tag <select id="eventTag312">${['shot','goal','chance','entry','takeaway','giveaway','block'].map(t=>`<option>${t}</option>`).join('')}</select></label><button id="tag312">Tag Event</button>${['F','D'].map(g=>['ON','OFF'].map(a=>`<button data-group312="${g}" data-action312="${a}">${g} ${a}</button>`).join('')).join('')}<button id="undo312">Undo</button><label><input id="pauseTag312" type="checkbox" checked> Pause on tag</label></div><div id="pickerMount312"></div>`;
  wrap.appendChild(overlay);
  $('#analysis312').onclick=()=>enterTagFullscreen();
  const v=$('#gameVideo');v.setAttribute('controlsList','nofullscreen');
  overlay.querySelectorAll('[data-seek312]').forEach(b=>b.onclick=()=>{v.pause();seekVideo(Number(b.dataset.seek312));});
  $('#play312').onclick=()=>{if(v.paused)v.play().catch(()=>{});else v.pause();};
  $('#tag312').onclick=()=>{if($('#pauseTag312').checked)v.pause();snapshot();$('#eventPlayer').value=$('#playerTag312').value;addEvent($('#eventTag312').value);};
  overlay.querySelectorAll('[data-group312]').forEach(b=>b.onclick=()=>{if($('#pauseTag312').checked)v.pause();openLivePicker(b.dataset.group312,b.dataset.action312);});
  $('#undo312').onclick=()=>$('#undo').click();
  v.addEventListener('timeupdate',()=>{$('#time312').textContent=`Video ${formatVideoTime(v.currentTime)} • ${formatGameStamp(gameClockForCurrentVideo())}`;});
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement && wrap.classList.contains('tag-fullscreen'))exitTagFullscreen();});
  refreshFilm312();
}
function refreshFilm312() {
  const s=$('#playerTag312');if(!s)return;const val=s.value;
  $('#time312').textContent=`Video ${formatVideoTime($('#gameVideo').currentTime)} • ${formatGameStamp(gameClockForCurrentVideo())}`;
  s.innerHTML=state.players.filter(p=>p.pos!=='G').map(p=>`<option value="${esc(p.id)}">#${esc(p.number)} ${esc(p.name)}</option>`).join('');if(state.players.some(p=>p.id===val&&p.pos!=='G'))s.value=val;
}
const oldSave312=save;
save=function(){oldSave312();renderSeason312();updateCoach312();};
const oldOpen312=openWorkspace;
openWorkspace=function(name){
  if(name==='mygames'||name==='season'){
    activeWorkspace=name;document.querySelectorAll('.workspace').forEach(el=>el.classList.toggle('active',el.dataset.workspacePage===name));
    document.querySelectorAll('#workspaceNav [data-workspace]').forEach(b=>b.classList.toggle('active',b.dataset.workspace===name));
    updateWorkspaceGameLabel();window.scrollTo(0,0);
  }else oldOpen312(name);
  if(name!=='film')restorePicker312();
  if(name==='mygames'){renderSavedGames();renderGameHub312();}
  if(name==='season')renderSeason312();
  if(name==='quickstats')renderEntry312();
};
q295Render=renderEntry312;q295Commit=commitEntry312;
const oldLoad312=loadSavedGame;
loadSavedGame=function(id){state.history=[];oldLoad312(id);refreshFilm312();openWorkspace('mygames');};
const oldDelete312=deleteSavedGame;
deleteSavedGame=function(id){oldDelete312(id);renderGameHub312();renderDashboard();};
const oldFs312=enterTagFullscreen,oldExit312=exitTagFullscreen;
let pickerHome312;
function mountPicker312(){const picker=$('#livePickBar');if(picker&&!pickerHome312){pickerHome312={parent:picker.parentNode,next:picker.nextSibling};$('#pickerMount312').appendChild(picker);}}
function restorePicker312(){const p=$('#livePickBar');if(pickerHome312){pickerHome312.parent.insertBefore(p,pickerHome312.next?.parentNode===pickerHome312.parent?pickerHome312.next:null);pickerHome312=null;}closeLivePicker();}
const oldPick312=openLivePicker;
openLivePicker=function(group,action){if(activeWorkspace==='film')mountPicker312();oldPick312(group,action);};
enterTagFullscreen=function(){mountPicker312();oldFs312();$('#tagOverlayWrap').requestFullscreen?.().catch(()=>{});};
exitTagFullscreen=function(){if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});oldExit312();restorePicker312();};
$('#tagFullscreenBtn').removeEventListener('click',oldFs312);$('#tagFullscreenBtn').addEventListener('click',()=>enterTagFullscreen());
$('#exitTagFullscreen').removeEventListener('click',oldExit312);$('#exitTagFullscreen').addEventListener('click',()=>exitTagFullscreen());
// Existing Develop and Profile views use the same per-game ratings.
function valueRows312(games,gameMode=false) {
  if(gameMode&&games.length===1)return A312.records(games[0]).filter(r=>r.played).map(r=>({...r,...A312.rate(r,state.ratingWeights312),driver:'Game impact',keyStats:r.type==='goalie'?`${r.saves} saves • ${r.ga} GA`:`${r.g}G ${r.a}A • ${r.shots} SOG`}));
  return season312(games).map(r=>({...r,driver:'Season impact',keyStats:r.type==='goalie'?`${r.saves} saves • ${r.ga} GA`:`${r.g}G ${r.a}A • ${r.shots} SOG`}));
}
const oldValuePage312=renderPlayerValuePage;
renderPlayerValuePage=function(){oldValuePage312();const rows=getValueScopeData();$('#playerValueBody').querySelectorAll('tr').forEach(tr=>{const num=tr.querySelector('[data-profile-number]')?.dataset.profileNumber,r=rows.find(r=>String(r.p.number)===num);if(!r)return;tr.cells[2].querySelector('.value-score').textContent=r.value.toFixed(1);if(r.type==='skater'){tr.cells[5].innerHTML=valueCategoryCell(r.scores.results);tr.cells[6].innerHTML=valueCategoryCell(r.scores.defense);tr.cells[8].innerHTML=valueCategoryCell(r.scores.efficiency);}});};
function applyDashboard312(d,games){const rows=A312.season(games,[],state.ratingWeights312),teams=games.map(team29);d.rows.forEach(row=>{const r=rows.find(r=>String(r.p.number)===String(row.p.number));if(!r)return;Object.assign(row.e,{goals:r.g,assists:r.a,shots:r.shots,blocks:r.blocks,pm:r.pm,grade:r.value});row.t.total=r.toi;});d.teamGoals=teams.reduce((n,t)=>n+t.gf,0);d.teamShots=teams.reduce((n,t)=>n+t.sf,0);d.blocks=rows.reduce((n,r)=>n+r.blocks,0);d.teamToi=rows.reduce((n,r)=>n+r.toi,0);return d;}
const oldAggregate312=aggregateAllSavedGames,oldCurrentDash312=dashboardDataCurrentState,oldGameDash312=dashboardDataForGame;
aggregateAllSavedGames=()=>applyDashboard312(oldAggregate312(),state.savedGames||[]);
dashboardDataCurrentState=()=>applyDashboard312(oldCurrentDash312(),[currentGameSnapshot()]);
dashboardDataForGame=g=>applyDashboard312(oldGameDash312(g),[g||currentGameSnapshot()]);
valueRowsForGames=games=>valueRows312(games,true);
getValueScopeData=function(){const scope=$('#valueScope')?.value||'season';return valueRows312(scope==='season'?state.savedGames:scope==='selected'?state.savedGames.filter(g=>g.id===$('#valueGameSelect').value):[currentGameSnapshot()],scope!=='season').sort((a,b)=>b.value-a.value);};
profileSeasonRecord=(number,games)=>valueRows312(games).find(r=>String(r.p.number)===String(number));
profileBreakdownRows=v=>Object.entries(v?.scores||{}).filter(([,v])=>v!=null);
playerValueTrendMap=function(){return new Map(season312().map(r=>[String(r.p.number),{dir:r.delta>0?'up':r.delta<0?'down':'same',delta:r.delta,label:r.history.map(n=>n.toFixed(1)).join(' → ')}]));};
const oldProfile312=renderPlayerProfile;
renderPlayerProfile=function(){oldProfile312();const r=profileSeasonRecord(activeProfileNumber,profileGamesForScope());if(r)$('#profileValue').textContent=r.value.toFixed(1);};

migrate312();
for(const [name,id] of [['mygames','gameHub312'],['season','season312']]){const section=document.createElement('section');section.className='workspace';section.dataset.workspacePage=name;section.innerHTML=name==='mygames'?workspaceHeader('My Games','Your per-game management hub.')+`<div id="${id}"></div>`:`<div id="${id}"></div><div class="card" id="weights312"></div>`;document.querySelector('.app').appendChild(section);if(name==='mygames')section.insertBefore($('#gameManagerCard'),$('#gameHub312'));}
const nav=$('#workspaceNav');
const my=document.createElement('button');my.type='button';my.dataset.workspace='mygames';my.textContent='My Games';my.onclick=()=>openWorkspace('mygames');nav.querySelector('[data-workspace="schedule"]').after(my);
const sn=nav.querySelector('[data-workspace="stats"]');sn.dataset.workspace='season';sn.textContent='Season Stats';
$('#coachAddGame').onclick=()=>openWorkspace('mygames');
const coach=document.createElement('div');coach.id='coachSnapshot312';coach.className='card';$('#homePrimaryMount').prepend(coach);
renderWeights312();renderSeason312();renderGameHub312();updateCoach312();setupFilm312();
$('#createGame').addEventListener('click',()=>{renderGameHub312();refreshFilm312();});
