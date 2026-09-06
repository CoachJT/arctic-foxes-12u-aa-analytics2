const sample = {
  leaders: [
    ['17', 'Mia Chen', 'Forward · 14 GP', '18', 'Goals'],
    ['9', 'Sofia Park', 'Forward · 14 GP', '16', 'Points'],
    ['31', 'Avery Brooks', 'Goalie · 9 GP', '91.4%', 'Save %'],
    ['4', 'Noah Williams', 'Defense · 14 GP', '+11', 'Plus / minus']
  ],
  recent: [['North Shore Storm', 'Jan 18 · Home', '4–2', 'W'], ['Riverside Ravens', 'Jan 11 · Away', '2–3', 'L'], ['Metro Blades', 'Jan 04 · Home', '5–1', 'W'], ['Pine Valley Jets', 'Dec 21 · Away', '3–2', 'W']]
};

const viewNames = {command:'Command Center', schedule:'Schedule', stats:'Team Stats', players:'Player Profiles', games:'Game Center', scouting:'Scouting', reports:'Coach Reports', admin:'Admin', settings:'Settings'};
const app = document.querySelector('#app');
const nav = document.querySelectorAll('.nav-item');

function shell(title, subtitle, body, action='') {
  return `<div class="page-head"><div><div class="eyebrow">Arctic Foxes · Sample workspace</div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>${body}`;
}
function cardTitle(title, link='') { return `<div class="card-title"><h2>${title}</h2>${link ? `<a href="#">${link} →</a>` : ''}</div>`; }
function leaderRows() { return sample.leaders.map(([n,name,meta,value,label]) => `<div class="leader"><span class="jersey">#${n}</span><div><strong>${name}</strong><small>${meta}</small></div><span class="leader-value">${value}</span></div>`).join(''); }
function recentRows() { return sample.recent.map(([team,date,score,result]) => `<div class="game-row"><div><strong>${team}</strong><small>${date}</small></div><span class="score">${score}</span><span class="result ${result==='W'?'win':'loss'}">${result === 'W' ? 'WIN' : 'LOSS'}</span><span class="arrow">›</span></div>`).join(''); }

function command() {
  return shell('Good morning, Coach.', 'Here is the team picture for your next decision.', `<div class="grid hero-grid">
    <section class="card next-game">${cardTitle('NEXT GAME', 'Game prep')}<div class="game-top"><div class="opponent"><div class="opponent-mark">RV</div><div><p>Saturday · January 24, 2026</p><h2>Riverside Ravens</h2><p>Northstar Ice Arena · 10:30 AM</p></div></div><span class="home-pill">Home</span></div><div class="game-date"><strong>02 <span>days</span> · 14 <span>hours</span></strong><span>Game 15 of 24 · Regular season</span></div><div class="game-meta"><div>LAST MEETING<b>W 3–1</b></div><div>OPPONENT RECORD<b>8–5–1</b></div><div>PREP STATUS<b style="color:var(--gold)">In progress</b></div></div></section>
    <section class="card record-card">${cardTitle('SEASON RECORD', 'View schedule')}<div class="record"><span class="record-number">10<span>–</span>3<span>–</span>1</span><div class="record-copy"><strong>2nd in Metro North</strong>4-game unbeaten streak<br>68% points percentage</div></div><div class="record-bars">${[1,1,1,1,1,1,1,1,1,1,0,0,1,1].map(x=>`<i style="${x?'':'background:var(--red)'}"></i>`).join('')}</div><div class="record-legend"><span>Oct 04</span><span>Last 14 games</span><span>Jan 18</span></div></section>
  </div><div class="grid stat-grid"><div class="card stat-card"><small>GOALS FOR / GAME</small><strong>3.86</strong><span>↑ 0.42 vs last 5</span></div><div class="card stat-card"><small>GOALS AGAINST / GAME</small><strong>2.14</strong><span>↑ Best in division</span></div><div class="card stat-card"><small>POWER PLAY</small><strong>24.6%</strong><span>↑ 6.1% this month</span></div><div class="card stat-card"><small>TEAM EFFORT</small><strong>8.4 <small>/ 10</small></strong><span>↑ Trending up</span></div></div>
  <div class="grid split"><section class="card">${cardTitle('TEAM TRENDS', 'Open analytics')}<div class="trend-chart">${[39,52,46,65,57,73,68,84,77,92].map((h,i)=>`<div class="bar-col"><i style="height:${h}%"></i><b>${['O4','O11','N1','N8','N15','N22','D6','D13','J4','J18'][i]}</b></div>`).join('')}</div></section><section class="card">${cardTitle('TOP PLAYERS', 'All players')}${leaderRows()}</section></div>
  <section class="card recent">${cardTitle('RECENT GAMES', 'Game Center')}${recentRows()}</section>`);
}

function schedule() {
  const games = [['JAN 24','Riverside Ravens','Home · Northstar Ice Arena · 10:30 AM','UP NEXT'],['JAN 31','Easton Eagles','Away · Easton Community Rink · 2:00 PM','SCHEDULED'],['FEB 07','Cedar Valley Huskies','Home · Northstar Ice Arena · 11:15 AM','SCHEDULED'],['FEB 14','Metro Blades','Away · Metroplex Ice Center · 4:30 PM','SCHEDULED']];
  return shell('Schedule', 'Plan the weeks ahead and keep the bench aligned.', `<section class="card"><div class="actions" style="justify-content:flex-end;margin-bottom:18px"><button class="btn primary">＋ Add event</button><button class="btn">Export</button></div><div class="schedule-list">${games.map((g,i)=>`<div class="schedule-item"><div class="schedule-date"><strong>${g[0]}</strong>2026</div><div><h3>${g[1]}</h3><p>${g[2]}</p></div><span class="tag">${g[3]}</span></div>`).join('')}</div></section>`);
}
function stats() {
  const rows = [['Goals for','54','3.86','+0.42','trend-up'],['Goals against','30','2.14','−0.31','trend-up'],['Shots on goal','386','27.6','+3.8','trend-up'],['Power play goals','14','24.6%','+6.1%','trend-up'],['Penalty kill','31','82.4%','−1.2%','trend-down']];
  return shell('Team Stats', 'A quick view of the sample season profile.', `<div class="grid stat-grid"><div class="card stat-card"><small>RECORD</small><strong>10–3–1</strong><span>68% points</span></div><div class="card stat-card"><small>SHOTS / GAME</small><strong>27.6</strong><span>↑ 3.8 vs last month</span></div><div class="card stat-card"><small>FACE-OFFS</small><strong>51.8%</strong><span>↑ 2.4% this season</span></div><div class="card stat-card"><small>AVG. ICE TIME</small><strong>13:42</strong><span>Across 14 games</span></div></div><section class="card">${cardTitle('Season overview', 'Download CSV')}<div class="table-wrap"><table class="data-table"><thead><tr><th>Metric</th><th>Total</th><th>Average / rate</th><th>Change</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td class="${r[4]}">${r[3]}</td></tr>`).join('')}</tbody></table></div></section>`);
}
function players() {
  const players = [['17','Mia Chen','Forward','18','16','+8'],['9','Sofia Park','Forward','12','16','+9'],['4','Noah Williams','Defense','3','11','+11'],['22','Emma Rodriguez','Forward','9','12','+6'],['31','Avery Brooks','Goalie','—','—','—'],['6','Lucas Martin','Defense','2','7','+4']];
  return shell('Player Profiles', 'Sample roster view for coaching conversations.', `<section class="card">${cardTitle('Roster · 14 players', 'Manage roster')}<div class="table-wrap"><table class="data-table"><thead><tr><th>Player</th><th>Position</th><th>Goals</th><th>Points</th><th>+ / −</th><th>Status</th></tr></thead><tbody>${players.map(p=>`<tr><td><div class="player-cell"><span class="player-photo">${p[0]}</span><strong>${p[1]}</strong></div></td><td class="role">${p[2]}</td><td>${p[3]}</td><td>${p[4]}</td><td class="trend-up">${p[5]}</td><td><span class="tag">Active</span></td></tr>`).join('')}</tbody></table></div></section>`);
}
function admin() {
  const roles = [['Owner / Head Coach','Full team workspace access, billing, and permissions.','Assigned · Coach Morgan'],['Assistant Coach','Team stats, game center, scouting, and reports.','Available to assign'],['Goalie Coach','Goalie profiles, video notes, and position reports.','Available to assign'],['Team Manager','Schedule, roster details, and team communications.','Available to assign'],['Read Only','View-only access to approved team content.','Available to assign'],['Future Player / Parent access','A future focused view for individual player updates.','Planned · Not active']];
  return shell('Admin', 'Set up the people and access model for the team.', `<div class="callout" style="margin-bottom:16px"><strong>Future access model.</strong> This is a visual prototype only. Accounts, invitations, and real authentication will arrive with the cloud backend.</div><section class="card">${cardTitle('Accounts, roles & permissions', 'View audit log')}<div class="grid role-grid">${roles.map(r=>`<div class="role-card"><h3>${r[0]}</h3><p>${r[1]}</p><span class="role-status">${r[2]}</span></div>`).join('')}</div></section>`);
}
function generic(view) { const titles={games:['Game Center','One place for game-day details and post-game review.'],scouting:['Scouting','Prepare opponent notes and share the plan with the bench.'],reports:['Coach Reports','Turn team observations into clear, shareable reports.'],settings:['Settings','Configure the team hub experience and future integrations.']}; const [title,sub]=titles[view]; return shell(title,sub,`<section class="card empty-view"><div class="empty-icon">${view==='settings'?'⚙':'✦'}</div><h2>${view==='settings'?'Workspace preferences':'Your next workspace layer'}</h2><p>This local prototype reserves the workflow for ${title.toLowerCase()}. The cloud version will connect this surface to synced analytics, schedules, scouting notes, reports, and player information.</p></section>`); }
function render(view='command') { app.innerHTML = view==='command'?command():view==='schedule'?schedule():view==='stats'?stats():view==='players'?players():view==='admin'?admin():generic(view); document.querySelector('#viewCrumb').textContent=viewNames[view]; nav.forEach(item=>{item.classList.toggle('active',item.dataset.view===view); item.toggleAttribute('aria-current',item.dataset.view===view)}); document.querySelector('#sidebar').classList.remove('open'); document.querySelector('#scrim').classList.remove('show'); window.scrollTo(0,0); }
nav.forEach(item=>item.addEventListener('click',()=>render(item.dataset.view)));
document.querySelector('#openSidebar').addEventListener('click',()=>{document.querySelector('#sidebar').classList.add('open');document.querySelector('#scrim').classList.add('show')});
document.querySelector('#closeSidebar').addEventListener('click',()=>{document.querySelector('#sidebar').classList.remove('open');document.querySelector('#scrim').classList.remove('show')});
document.querySelector('#scrim').addEventListener('click',()=>document.querySelector('#closeSidebar').click());
render();
