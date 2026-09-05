/* 3.0.15 presentation only: reuse the existing save, navigation, rating and film functions. */
'use strict';
const UI313=FoxesInterface;
const iconPaths313={home:'M3 10 12 3l9 7v10H3Z M9 20v-7h6v7',schedule:'M5 5h14v16H5Z M8 2v6 M16 2v6 M5 10h14',mygames:'M6 3h12v18H6Z M9 7h6 M9 11h6 M9 15h4',film:'M3 5h18v14H3Z M3 9h18 M7 5v4 M12 5v4 M17 5v4 M10 12l5 2-5 2Z',tracking:'M12 5a8 8 0 1 0 0 16 8 8 0 0 0 0-16 M9 2h6 M12 9v5l3 2',season:'M4 20V10h4v10 M10 20V4h4v16 M16 20v-8h4v8',scout:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',quickstats:'M13 2 5 14h6l-1 8 9-13h-6Z',aifilm:'M4 5h12v14H4Z M16 10l5-3v10l-5-3 M8 9l5 3-5 3Z',analytics:'M3 3v18h18 M6 15l4-5 4 3 6-8',coachlab:'M8 3h8 M10 3v7L4 20h16L14 10V3 M8 15h8',develop:'M12 3 3 7l9 4 9-4Z M6 9v7c4 4 8 4 12 0V9 M21 7v9',updates:'M12 16V3 M7 8l5-5 5 5 M4 14v7h16v-7'};
function icon313(name){return `<span class="nav-icon313" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="${iconPaths313[name]||iconPaths313.mygames}"/></svg></span>`;}
function empty313(title,text,action,label,icon='mygames'){return `<div class="empty313">${icon313(icon)}<h3>${esc(title)}</h3><p>${esc(text)}</p>${action?`<button data-ui-go313="${action}">${esc(label)}</button>`:''}</div>`;}
function displayDate313(date){if(!date)return 'Date not set';const d=new Date(date+'T12:00:00');return Number.isNaN(d.getTime())?date:d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});}
function summaryScore313(s){return s.scored?`<span class="score313">${s.gf}–${s.ga}</span><span class="result313 ${s.result}">${s.result}</span>`:'<span class="sub">Score not recorded</span>';}
function playerName313(r){return `<span class="player-label313"><span class="jersey313">#${esc(r.p.number)}</span><span>${esc(r.p.name)}</span></span>`;}
player312=r=>`<button data-profile-number="${esc(r.p.number)}">${playerName313(r)}</button>`;
table312=(headers,rows)=>`<div class="table-wrap313" tabindex="0" aria-label="Scrollable stats table"><table class="lab-table"><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${headers.length}">No game stats recorded yet.</td></tr>`}</tbody></table></div>`;
function history313(history){
  const values=history.slice(-12),min=Math.min(...values)-2,max=Math.max(...values)+2;
  const points=values.map((v,i)=>`${4+i*102/Math.max(1,values.length-1)},${25-(v-min)*22/(max-min)}`).join(' ');
  return `<div class="history313"><svg viewBox="0 0 110 30" role="img" aria-label="Rating history ${history.map(v=>v.toFixed(1)).join(', ')}"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg><details><summary>History</summary><p>${history.map(v=>v.toFixed(1)).join(' → ')}</p></details></div>`;
}
ratings312=function(rows=season312()){
  const rated=rows.filter(r=>r.games.length);
  if(!rated.length)return empty313('Ratings appear after game stats are saved','Every player begins at 50.0. Save a game’s stats to see performance and movement.','mygames','Open My Games','analytics');
  return table312(['Player','Season Rating','Last Game','Movement','Rating history'],rows.map(r=>row312([
    player312(r),`<span class="rating-number313">${r.value.toFixed(1)}</span>`,r.games.length?r.games.at(-1).rating.toFixed(1):'—',
    `<span class="trend313 ${UI313.trend(r.delta)}">${r.delta>.05?'↗':r.delta<-.05?'↘':'→'} ${Math.abs(r.delta).toFixed(1)}</span>`,history313(r.history)])));
};
function renderCommand313(){
  const root=$('#commandCenter313');if(!root)return;
  const d=UI313.dashboard(state.savedGames||[],state.players,readSchedule301(),state.ratingWeights312),n=d.next;
  const leaderCard=(title,l,format,context,empty)=>`<article class="leader313"><span class="eyebrow313">${title}</span>${l?`<div class="leader-value313">${format(l.value)}</div>${player312(l.row)}<small>${l.ties>1?`Joint leader · ${l.ties} players. `:''}${context(l.row)}</small>`:`<div class="leader-value313">—</div><small>${empty}</small>`}</article>`;
  const coverage=d.scored?`${d.scored} scored game${d.scored===1?'':'s'}`:'Enter final scores';
  const metric=(label,value,note)=>`<div class="metric313"><span>${label}</span><strong>${value??'—'}</strong><small>${note}</small></div>`;
  root.innerHTML=`<div class="command-heading313"><div><h1>Coach Command Center</h1><p>Your team, game preparation, and season at a glance.</p></div><button data-ui-go313="mygames">Open My Games</button></div>
  <section class="next-game313" aria-label="Next game"><div class="next-top313"><div><span class="eyebrow313">Next game</span><h2>${n?`vs ${esc(n.opponent||'Opponent to be confirmed')}`:'Set up your next game'}</h2><div class="game-meta313">${n?`<span>${esc(displayDate313(n.date))}</span><span>${esc(n.time||'Time not set')}</span><span>${esc(n.location||'Location not set')}</span>`:'Add your schedule to put game-day preparation one click away.'}</div></div>${n?`<span class="badge">${esc(n.homeAway||n.status||'Scheduled')}</span>`:''}</div><div class="next-actions313">${n?`<button class="primary313" data-next-action313="plan">Game Plan</button><button data-next-action313="film">Film</button><button data-next-action313="tracking">Track</button><button data-next-action313="quickstats">Enter Stats</button>`:'<button class="primary313" data-ui-go313="addgame">Add Game</button><button data-ui-go313="schedule">Open Schedule</button>'}</div></section>
  <div class="section-head313"><h2>Team Snapshot</h2><button data-ui-go313="season">Season Stats →</button></div><section class="snapshot313" aria-label="Team snapshot">${metric('Games Played',d.played,'Games with recorded activity')}${metric('Record',d.record,`W–L–T · ${coverage}`)}${metric('Goals For',d.gf,coverage)}${metric('Goals Against',d.ga,coverage)}${metric('Team Rating',d.teamRating?.toFixed(1),'Average of players with ratings')}</section>
  <div class="section-head313"><h2>Performance Leaders</h2><span class="sub">From recorded game data</span></div><section class="leaders313" aria-label="Performance leaders">${leaderCard('Highest Foxes Rating',d.leaders.rating,v=>v.toFixed(1),r=>`${r.games.length} games rated`,'Save game stats to see ratings.')}${leaderCard('Biggest Rating Riser',d.leaders.riser,v=>'+'+v.toFixed(1),()=> 'Latest season-rating movement','No positive movement recorded.')}${leaderCard('Points Leader',d.leaders.points,v=>`${v} PTS`,r=>`${r.g} goals · ${r.a} assists`,'Enter scoring stats to see a leader.')}${leaderCard('TOI Efficiency',d.leaders.efficiency,v=>v.toFixed(1),()=> 'Points per 36 min · recorded TOI only','Points and TOI are needed.')}${leaderCard('Goalie SV% Leader',d.leaders.goalie,v=>(v*100).toFixed(1)+'%',r=>`${r.saves} saves on ${r.sa} shots`,'Enter goalie saves and GA.')}</section>
  <div class="section-head313"><h2>Recent Games</h2><button data-ui-go313="mygames">View all games →</button></div>${d.recent.length?`<section class="recent-list313">${d.recent.map(s=>`<button class="recent-game313" data-open-game313="${esc(s.game.id)}"><span><strong>vs ${esc(s.game.opponent||'Unnamed opponent')}</strong><small>${esc(displayDate313(s.game.date))}</small></span><span>${summaryScore313(s)}</span><span class="recent-status313"><small>${esc(s.status)}</small><span class="status-line313"><span>${s.stats?'Stats entered':'Stats needed'}</span><span>${s.film?`${s.film} film clips`:'No film'}</span><span>${s.shifts} shifts</span></span></span><span class="chevron313">→</span></button>`).join('')}</section>`:empty313('Add your first game','Create a game to organize stats, film, and player development.','addgame','Add Game')}`;
  root.querySelectorAll('[data-next-action313]').forEach(b=>b.onclick=()=>openNext313(n,b.dataset.nextAction313));
}
function openNext313(next,destination){
  let game=findSavedGameForSchedule301(next);
  if(!game){$('#createGameDate').value=next.date;$('#createOpponent').value=next.opponent||'';createSimpleGame();game=state.savedGames.find(g=>g.id===state.currentGameId);}
  if(!game)return;loadSavedGame(game.id);
  if(destination==='plan'){openWorkspace('scout');return;}
  openWorkspace(destination);
}
function polishGames313(){
  const game=state.savedGames.find(g=>g.id===state.currentGameId),hub=$('#gameHub312');
  if(game&&hub){
    const s=UI313.gameSummary(game),title=hub.querySelector('.card>h2');
    if(title){const head=document.createElement('div');head.className='selected-header313';head.innerHTML=`<div><span class="eyebrow313">Selected game</span><h2>vs ${esc(game.opponent||'Unnamed opponent')}</h2><div class="game-meta313"><span>${esc(displayDate313(game.date))}</span><span>${esc(s.status)}</span></div></div><div>${summaryScore313(s)}</div>`;title.replaceWith(head);}
    const tabs=hub.querySelector('.card>.row');if(tabs){tabs.classList.add('game-tabs313');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Game management');}
    hub.querySelectorAll('[data-game-tab312]').forEach(b=>{b.setAttribute('role','tab');b.setAttribute('aria-selected',String(b.dataset.gameTab312===gameView313));});
    if(gameView313==='overview'){const p=$('#gameDetail312')?.querySelectorAll('p')[1];if(p)p.innerHTML=summaryScore313(s);}
  }
  document.querySelectorAll('#savedGamesList .saved-game').forEach(card=>{
    card.classList.toggle('is-selected313',!!card.querySelector('.openSaved')&&card.querySelector('.openSaved').textContent==='Open Now');
  });
  if(!state.savedGames.length)$('#savedGamesList').innerHTML=empty313('Add your first game','Choose a date and opponent above to begin.','addgame','Create a game');
}
let gameView313='overview';
const baseHub313=renderGameHub312;
renderGameHub312=function(){gameView313='overview';baseHub313();polishGames313();};
const baseGameTab313=gameTab312;
gameTab312=function(tab){gameView313=tab;baseGameTab313(tab);polishGames313();};
const baseSaved313=renderSavedGames;
renderSavedGames=function(){baseSaved313();polishGames313();};
const baseSeason313=renderSeason312;
renderSeason312=function(){baseSeason313();const mount=$('#season312');if(!mount)return;
  if(!season312().some(r=>r.games.length)){const header=mount.querySelector('.workspace-page-head');header?.insertAdjacentHTML('afterend',empty313('Enter game stats to build season totals','Totals update automatically when a game is saved.','mygames','Open My Games','season'));}
};
function context313(){
  document.body.dataset.page=activeWorkspace;
  const c=UI313.actionContext(activeWorkspace,!!state.currentGameId,!!state.history?.length);
  const footer=$('.footerbar');footer.classList.toggle('contextual313',c.csv||c.undo);
  $('#undo').style.display=c.undo?'':'none';$('#exportCsv').style.display=c.csv?'':'none';
  $('#exportCsv').textContent='Export current game CSV';
  $('#undo312').disabled=!state.history?.length;
  document.querySelectorAll('#workspaceNav [data-workspace]').forEach(b=>{const selected=b.dataset.workspace===activeWorkspace;b.classList.toggle('active',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  $('#openUpdates').classList.toggle('active',activeWorkspace==='updates');
}
const baseOpen313=openWorkspace;
openWorkspace=function(name){
  if(name==='updates'){activeWorkspace='updates';document.querySelectorAll('.workspace').forEach(el=>el.classList.toggle('active',el.dataset.workspacePage==='updates'));window.scrollTo(0,0);ensureUpdateCenter302();refreshUpdateState();}
  else baseOpen313(name);
  if(name==='home')renderCommand313();context313();
};
const baseCoach313=updateCoachCenter;
updateCoachCenter=function(){baseCoach313();renderCommand313();context313();};
updateCoach312=renderCommand313;
const baseSave313=save;
save=function(){baseSave313();context313();};
const baseRender313=render;
render=function(){baseRender313();context313();};

document.body.classList.add('ui313');
$('.brand-season').textContent='2026–2027 Season';$('.brand-mark').textContent='COACH COMMAND CENTER';
const home=$('[data-workspace-page="home"]');
// Retain utility nodes and their existing event handlers, but move tracking tools off the dashboard.
const homeMount=$('#homePrimaryMount');
if(homeMount){[...homeMount.children].forEach(el=>{if(el.id==='coachSnapshot312')return;$('#trackingPageMount').appendChild(el);});}
home.innerHTML='<div id="commandCenter313"></div>';
const updates=document.createElement('section');updates.className='workspace';updates.dataset.workspacePage='updates';
updates.innerHTML=workspaceHeader('Updates','Keep your coaching platform current. Your saved season stays with you.')+'<div id="updatesMount313"></div><div class="card"><h2>About this app</h2><p>Arctic Foxes Hockey Analytics <strong id="installed313">3.0.15</strong></p><p class="sub">Updates install through the existing GitHub release channel. Your games, roster, and season data are stored separately from the application.</p><button id="aboutStorage313">Open Save Folder</button></div>';
document.querySelector('.app').appendChild(updates);
$('#aboutStorage313').onclick=openSeasonSaveFolder;
$('#openUpdates').removeEventListener('click',showUpdates);
$('#openUpdates').addEventListener('click',()=>openWorkspace('updates'));
// Existing updater events continue to power the update page; do not claim an unchecked state is current.
window.foxesStorage?.onUpdateState?.(s=>{if(s.currentVersion)$('#installed313').textContent=s.currentVersion;});
const sidebar=$('#workspaceNav'),current=$('#workspaceCurrent');
const groups=[['Everyday',[['home','Coach Center'],['schedule','Schedule'],['mygames','My Games'],['film','Film'],['tracking','Track'],['season','Season Stats'],['scout','Scout']]],['Tools',[['quickstats','Quick Stats'],['aifilm','Film Analysis'],['analytics','Analyze'],['coachlab','Coach Lab'],['develop','Develop']]],['System',[['updates','Updates']]]];
sidebar.insertAdjacentHTML('afterbegin','<div class="sidebar-brand313"><strong>ARCTIC FOXES</strong><span>COACHING PLATFORM</span></div>');
groups.forEach(([label,items])=>{const heading=document.createElement('div');heading.className='nav-section313';heading.textContent=label;sidebar.appendChild(heading);items.forEach(([id,label])=>{const b=id==='develop'?$('#workspacePlayerValue'):id==='updates'?$('#openUpdates'):sidebar.querySelector(`[data-workspace="${id}"]`);if(!b)return;const badge=b.querySelector('#updateNavBadge');b.innerHTML=icon313(id)+`<span>${label}</span>`;if(badge)b.appendChild(badge);b.setAttribute('aria-label',label);sidebar.appendChild(b);});});sidebar.appendChild(current);
$('#workspacePlayerValue').addEventListener('click',()=>{sidebar.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.id==='workspacePlayerValue'));});
$('#closePlayerValue').addEventListener('click',context313);
const weight=$('#weights312'),weightDetails=document.createElement('details');weightDetails.id='weights313';weightDetails.innerHTML='<summary>Rating Weights & calculation guide</summary>';weight.replaceWith(weightDetails);weightDetails.appendChild(weight);
// Keep clip-loading behavior, with a focused empty state inside the film page.
const filmEmpty=document.createElement('div');filmEmpty.id='filmEmpty313';$('#filmCard').prepend(filmEmpty);
const baseClips313=renderFilmClips;
renderFilmClips=function(){baseClips313();filmEmpty.innerHTML=(state.filmClips||[]).length?'':empty313('Add a LiveBarn clip','Load local film to review shifts, sync the game clock, and tag the action.','addfilm','Add LiveBarn Clip','film');};
document.addEventListener('click',e=>{
  const game=e.target.closest('[data-open-game313]');if(game){loadSavedGame(game.dataset.openGame313);return;}
  const action=e.target.closest('[data-ui-go313]')?.dataset.uiGo313;if(!action)return;
  if(action==='addfilm'){chooseFilmClips();return;}
  if(action==='addgame'){openWorkspace('mygames');$('#createOpponent').focus();$('#createOpponent').scrollIntoView({block:'center'});return;}
  openWorkspace(action);
});
renderCommand313();renderGameHub312();renderSeason312();renderFilmClips();context313();
