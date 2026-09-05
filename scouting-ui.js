'use strict';
(() => {
const S=FoxesScouting,V=FoxesScoutingVault,root=document.querySelector('#root'),bridge=window.scoutingBridge;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=s=>root.querySelector(s),today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const fmt=v=>v==null?'—':Number.isInteger(v)?String(v):Number(v).toFixed(2);
const statuses=['Following','Watch again','Tryout invite','Evaluate further'];
let secret=null,data=null,revision=null,seasonData={},rows=[],selected='',year='',team='',query='',watchOnly=false,foxNumber='',token=0,lastActivity=Date.now(),busy=false,dirty=false;
let profileDirty=false,evaluationDirty=false;
const empty=()=>({version:1,profiles:{},links:{},rosters:{},foxes:{}});
function status(text,error=false){const el=$('#status');if(el){el.textContent=text;el.className=error?'error':'';}}
function canLeave(){return !dirty||confirm('Discard the unsaved form changes?');}
function lock(message=''){
 token++;secret=null;data=null;seasonData={};rows=[];selected='';revision=null;busy=false;dirty=false;
 gate(message);
}
async function gate(message=''){
 const request=token;
 root.innerHTML='<section class="gate"><div class="mark">AF / PRIVATE</div><h1>Scouting & Tryouts</h1><p>Opening secure storage…</p></section>';
 try{
  if(!bridge)throw Error('Open this window from the Arctic Foxes desktop app.');
  const saved=await bridge.read();if(token!==request)return;
  const setup=!saved.blob;
  root.innerHTML=`<section class="gate"><div class="mark">AF / PRIVATE</div><span class="eyebrow">Your coaching workspace</span><h1>Scouting & Tryouts</h1><p class="muted">${setup?'Create a password for your private player notes, watchlist, and tryout evaluations.':'Enter your password to open your scouting workspace.'}</p><form id="unlockForm"><label>Password<input id="password" type="password" autocomplete="${setup?'new-password':'current-password'}" required ${setup?'minlength="10"':''}></label>${setup?'<label>Confirm password<input id="confirmPassword" type="password" autocomplete="new-password" minlength="10" required></label>':''}<button class="primary" type="submit">${setup?'Create private workspace':'Unlock workspace'}</button></form><p id="status" role="status">${esc(message)}</p><p class="muted">${setup?'Use at least 10 characters. Keep this password safe: there is no password recovery. ':''}Locks after 5 minutes of inactivity, on minimize, or when Windows locks. Unsaved form edits are cleared when locked.</p><p class="muted">Private information is stored encrypted on this computer, separately from your regular season backups.</p></section>`;
  $('#unlockForm').onsubmit=async e=>{
   e.preventDefault();if(busy)return;const password=$('#password').value;
   if(setup&&password!==$('#confirmPassword').value){status('Passwords do not match.',true);return;}
   busy=true;$('#unlockForm button').disabled=true;status('Opening…');
   try{
    const opened=setup?await V.create(password,empty()):await V.open(password,saved.blob);
    if(token!==request)return;
    let rev=saved.revision;
    if(setup){rev=(await bridge.write(opened.blob,rev)).revision;}
    if(token!==request)return;
    secret={key:opened.key,salt:opened.salt};data=setup?empty():opened.data;revision=rev;
    const raw=await bridge.season();if(token!==request)return;seasonData=raw?JSON.parse(raw):{};
    busy=false;lastActivity=Date.now();year=year||S.season(today());render();
   }catch(err){if(token!==request)return;busy=false;status(setup?err.message:'Could not unlock. Check the password; the encrypted file may also be damaged.',true);if($('#unlockForm button'))$('#unlockForm button').disabled=false;}
  };
 }catch(err){if(token===request)root.innerHTML=`<section class="gate"><h1>Scouting is unavailable</h1><p>${esc(err.message)}</p></section>`;}
}
async function persist(next){
 if(!secret||busy)throw Error('Wait for the current save to finish.');
 busy=true;const request=token,session=secret,base=revision;
 try{const blob=await V.seal(next,session.key,session.salt);const result=await bridge.write(blob,base);if(token!==request)return false;data=next;revision=result.revision;dirty=false;return true;}
 finally{if(token===request)busy=false;}
}
function games(){return (seasonData.savedGames||[]).map(g=>data.rosters?.[g.id]?{...g,command31:{...g.command31,opponentRoster:data.rosters[g.id]}}:g);}
function allRows(){return S.collect(games(),data);}
function table(headers,body){return `<div class="tablewrap"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;}
function foxes(){return FoxesAnalytics.season((seasonData.savedGames||[]).filter(g=>S.season(g.date)===year),seasonData.players||[]);}
function options(values,current){return values.map(v=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(v)}</option>`).join('');}
function render(){
 if(!secret)return;profileDirty=false;evaluationDirty=false;rows=allRows();
 const years=[...new Set([S.season(today()),...games().map(g=>S.season(g.date))])].sort().reverse();
 const teams=[...new Set(rows.filter(p=>p.season===year).map(p=>p.team))].sort();if(!teams.includes(team))team='';
 const shown=rows.filter(p=>p.season===year&&(!team||p.team===team)&&(!query||S.norm(`${p.name} ${p.numbers.join(' ')} ${p.team}`).includes(S.norm(query)))&&(!watchOnly||p.meta.status&&p.meta.status!=='Following'));
 if(!shown.some(p=>p.id===selected))selected=shown[0]?.id||'';
 root.innerHTML=`<div class="shell"><header class="topbar"><div><span class="eyebrow">Arctic Foxes / Private workspace</span><h1>Scouting & Tryouts</h1><p class="muted">Follow the player. Build the evidence. Find the fit.</p></div><div class="actions"><button id="importRoster">Import opponent roster</button><button id="refresh">Refresh stats</button><button id="lock">Lock workspace</button></div></header><div class="filters"><label>Season<select id="season">${options(years,year)}</select></label><label>Team<select id="team"><option value="">All local teams</option>${options(teams,team)}</select></label><label>Find player<input id="search" placeholder="Name, team, or jersey" value="${esc(query)}"></label><button id="watch" aria-pressed="${watchOnly}">${watchOnly?'Watchlist only':'Show watchlist'}</button></div><p class="muted">${shown.length} players · Rosters establish identity; scoresheets establish recorded stats. No rating is assigned from a roster alone.</p><p id="status" role="status"></p><div id="importPanel"></div><div class="layout"><aside class="panel roster" aria-label="Opponent players">${shown.map(p=>`<button class="player" data-player="${esc(p.id)}" aria-pressed="${p.id===selected}"><span class="number">${esc(p.numbers.join('/'))}</span><span><strong>${esc(p.name)}</strong><small>${esc(p.team)} · ${esc(p.position||'Position unknown')}</small><small>${p.games.length} scoresheet${p.games.length===1?'':'s'} · ${esc(p.meta.status||'Following')}${p.warnings.length?' · Review identity':''}</small></span></button>`).join('')||'<div class="empty"><h3>No players here yet</h3><p>Import a roster or save an opponent scoresheet in the main app, then refresh.</p></div>'}</aside><section id="profile">${selected?profile(rows.find(p=>p.id===selected)):'<div class="panel empty"><h2>Your scouting notebook starts here</h2><p>Existing opponent scoresheets appear automatically. Import a roster to include players with no recorded stats.</p></div>'}</section></div></div>`;
 $('#lock').onclick=()=>lock();$('#watch').onclick=()=>{if(canLeave()){watchOnly=!watchOnly;dirty=false;render();}};
 $('#season').onchange=e=>{if(canLeave()){year=e.target.value;selected='';dirty=false;render();}else e.target.value=year;};
 $('#team').onchange=e=>{if(canLeave()){team=e.target.value;dirty=false;render();}else e.target.value=team;};
 $('#search').onchange=e=>{if(canLeave()){query=e.target.value;dirty=false;render();}else e.target.value=query;};
 root.querySelectorAll('[data-player]').forEach(b=>b.onclick=()=>{if(canLeave()){selected=b.dataset.player;dirty=false;render();}});
 $('#refresh').onclick=async()=>{if(!canLeave())return;const request=token;try{const raw=await bridge.season();if(token!==request)return;seasonData=raw?JSON.parse(raw):{};dirty=false;render();status('Updated from the saved season. Private notes are preserved.');}catch(e){status(e.message,true);}};
 $('#importRoster').onclick=()=>{if(canLeave()){dirty=false;importer();}};
 if(selected)bindProfile(rows.find(p=>p.id===selected));
}
function profile(p){
 const meta=p.meta,observations=meta.evaluations||[];
 return `<article class="panel"><span class="eyebrow">${esc(p.season)} · ${esc(p.team)}</span><h2>#${esc(p.numbers.join(' / #'))} ${esc(p.name)}</h2><span class="badge">${p.games.length?'Recorded against the Foxes':'Roster only · No game stats'}</span><span class="badge">${observations.length} coach observations</span>${p.warnings.map(w=>`<p class="notice">${esc(w)}</p>`).join('')}<div class="metrics">${[['Goals',p.totals.g,p.coverage.g],['Assists',p.totals.a,p.coverage.a],['Points',p.totals.pts,p.coverage.pts],['PIM',p.totals.pim,p.coverage.pim]].map(([name,v,n])=>`<div class="metric"><small>${name}</small><strong>${fmt(v)}</strong><small>${n} games with this stat</small></div>`).join('')}</div><form id="profileForm" class="formgrid"><label>Watchlist<select id="profileStatus">${options(statuses,meta.status||'Following')}</select></label><label>Position<select id="position">${options(['','F','D','G','C','LW','RW'],p.position)}</select></label><label>Birth year<input id="birthYear" inputmode="numeric" maxlength="4" value="${esc(p.birthYear)}" placeholder="Unknown"></label><label>Roster fit / current focus<input id="fit" value="${esc(meta.fit||'')}" placeholder="What do we need to learn?"></label><label class="wide">Season notes<textarea id="notes" placeholder="Strengths, development needs, and examples…">${esc(meta.notes||'')}</textarea></label><div class="wide"><button class="primary" type="submit">Save private profile</button></div></form><details><summary>Sources & game history</summary>${table(['Date','Source','Name / number'],p.sources.map(s=>`<tr><td>${esc(s.date||'Undated')}</td><td>${esc(s.kind)} · ${esc(s.label)}</td><td>#${esc(s.number)} ${esc(s.name)}</td></tr>`).join(''))}${table(['Date','G','A','PTS','PIM'],p.games.map(g=>`<tr><td>${esc(g.date)}</td>${['g','a','pts','pim'].map(k=>`<td>${fmt(g[k])}</td>`).join('')}</tr>`).join(''))}</details>${p.conflicts.length?`<details><summary>Review possible identity matches</summary><p>Link only if these are the same player. Different players sharing a jersey must stay separate.</p><label>Same player as<select id="identityTarget">${p.conflicts.map(id=>{const q=rows.find(r=>r.id===id);return `<option value="${esc(id)}">#${esc(q.numbers.join('/'))} ${esc(q.name)}</option>`;}).join('')}</select></label><button id="linkIdentity">Confirm same player</button></details>`:''}</article><article class="panel"><h2>Compare with a Foxes player</h2><p class="muted">Opponent stats are from games against us. Foxes stats cover their recorded season games. These are different samples, not a head-to-head ranking.</p><label>Foxes player<select id="foxPlayer"><option value="">Choose a player</option>${foxes().map(f=>`<option value="${esc(f.p.number)}" ${String(f.p.number)===foxNumber?'selected':''}>#${esc(f.p.number)} ${esc(f.p.name)} · ${esc(f.p.pos)}</option>`).join('')}</select></label><div id="comparison"></div></article><article class="panel"><h2>Observations & tryouts</h2><p class="muted">1 = needs development · 3 = meets your expectations · 5 = standout. Leave unobserved skills blank. Assessments are your observations, not automatic ability ratings.</p><form id="evaluationForm" class="formgrid"><label>Evaluate<select id="evaluationTarget"><option value="opponent">${esc(p.name)}</option>${foxNumber?'<option value="foxes">Selected Foxes player</option>':''}</select></label><label>Date<input id="evaluationDate" type="date" value="${today()}" required></label><label>Setting<select id="evaluationType">${options(['Game observation','Tryout','Practice'],'Game observation')}</select></label>${S.skills.map(s=>`<label>${s}<select data-skill="${s}"><option value="">Not observed</option>${options(['1','2','3','4','5'],'')}</select></label>`).join('')}<label class="wide">Specific examples<textarea id="evaluationNotes" placeholder="What happened, and what should we watch next?"></textarea></label><div class="wide"><button class="primary" type="submit">Save dated observation</button></div></form><h3>${esc(p.name)} · observation history</h3>${observations.slice().reverse().map(e=>`<div class="observation"><strong>${esc(e.date)} · ${esc(e.type)}</strong><p>${Object.entries(e.ratings).map(([s,v])=>`${esc(s)} ${v}/5`).join(' · ')}</p><p>${esc(e.notes)}</p></div>`).join('')||'<p class="muted">No coach observations yet.</p>'}</article>`;
}
function compare(p){
 const f=foxes().find(r=>String(r.p.number)===foxNumber);if(!f){$('#comparison').innerHTML='';return;}
 const own=data.foxes?.[JSON.stringify([year,foxNumber])]||{},a=(p.meta.evaluations||[]).at(-1),b=(own.evaluations||[]).at(-1);
 const statRows=[['Position',p.position||'Unknown',f.p.pos],['Evidence',`${p.games.length} opponent scoresheets`,`${f.games.length} recorded games`],['Goals',fmt(p.totals.g),f.type==='goalie'?'Not comparable':fmt(f.g)],['Assists',fmt(p.totals.a),f.type==='goalie'?'Not comparable':fmt(f.a)],['Points / recorded game',fmt(p.pointsPerGame),f.type==='goalie'?'Not comparable':fmt(f.games.length?f.pts/f.games.length:null)],['Points coverage',`${p.coverage.pts} games with points entered`,`${f.games.length} recorded games`],['Penalty minutes',fmt(p.totals.pim),f.type==='goalie'?'Not comparable':fmt(f.pim)],['Latest coach assessment',a?`${a.date} · ${a.type}`:'None yet',b?`${b.date} · ${b.type}`:'None yet'],...S.skills.map(s=>[s,a?.ratings?.[s]?`${a.ratings[s]}/5`:'Not observed',b?.ratings?.[s]?`${b.ratings[s]}/5`:'Not observed'])];
 $('#comparison').innerHTML=table(['Evidence',p.name,f.p.name],statRows.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join(''))+'<p class="muted">Missing stats stay unknown. Skills show the most recent dated assessment; blank skills are not filled from older observations.</p>';
}
function draft(form){return [...root.querySelectorAll(form+' input,'+form+' select,'+form+' textarea')].map(el=>({selector:el.id?'#'+el.id:`[data-skill="${el.dataset.skill}"]`,value:el.value}));}
function restoreDraft(values,kind){if(!values)return;for(const {selector,value} of values){if($(selector))$(selector).value=value;}dirty=true;if(kind==='profile')profileDirty=true;else evaluationDirty=true;status('Saved. The other form still has unsaved changes.');}
function bindProfile(p){
 compare(p);$('#profileForm').oninput=()=>{dirty=true;profileDirty=true;status('Unsaved profile changes.');};$('#evaluationForm').oninput=()=>{dirty=true;evaluationDirty=true;status('Unsaved observation.');};
 $('#profileForm').onsubmit=async e=>{e.preventDefault();try{const other=evaluationDirty?draft('#evaluationForm'):null;const birthYear=$('#birthYear').value.trim();if(birthYear&&!/^\d{4}$/.test(birthYear))throw Error('Use a four-digit birth year or leave blank.');const next=structuredClone(data);next.profiles[p.id]={...p.meta,identity:{id:p.id,season:p.season,team:p.team,name:p.name,number:p.number,numbers:p.numbers,position:p.position,birthYear:p.birthYear},status:$('#profileStatus').value,position:$('#position').value,birthYear,fit:$('#fit').value,notes:$('#notes').value};if(await persist(next)){render();status('Private profile saved and encrypted.');restoreDraft(other,'evaluation');}}catch(e){status(e.message,true);}};
 $('#foxPlayer').onchange=e=>{if(!canLeave()){e.target.value=foxNumber;return;}foxNumber=e.target.value;dirty=false;render();};
 $('#evaluationForm').onsubmit=async e=>{e.preventDefault();try{const other=profileDirty?draft('#profileForm'):null;const assessment=S.evaluation({date:$('#evaluationDate').value,type:$('#evaluationType').value,notes:$('#evaluationNotes').value,ratings:Object.fromEntries([...root.querySelectorAll('[data-skill]')].map(el=>[el.dataset.skill,el.value]))});const next=structuredClone(data),own=$('#evaluationTarget').value==='foxes',map=own?(next.foxes||(next.foxes={})):next.profiles,id=own?JSON.stringify([year,foxNumber]):p.id;map[id]={...map[id],...(!own?{identity:{id:p.id,season:p.season,team:p.team,name:p.name,number:p.number,numbers:p.numbers,position:p.position,birthYear:p.birthYear}}:{}),evaluations:[...(map[id]?.evaluations||[]),assessment]};if(await persist(next)){render();status('Dated observation saved and encrypted.');restoreDraft(other,'profile');}}catch(e){status(e.message,true);}};
 if($('#linkIdentity'))$('#linkIdentity').onclick=async()=>{if(!canLeave())return;try{const to=$('#identityTarget').value;const next=S.link(data,rows,p.id,to);if(await persist(next)){selected=to;render();status('Identity linked. Source records and stats are preserved.');}}catch(e){status(e.message,true);}};
}
function importer(){
 const available=seasonData.savedGames||[];
 if(!available.length){status('Create a game in the main app before attaching an opponent roster.',true);return;}
 const host=$('#importPanel');host.innerHTML=`<section class="panel"><h2>Import an opponent roster</h2><p>Choose the game and review every name and number. A roster adds identities, never invented game stats. Roster details saved here stay private.</p><div class="formgrid"><label>Game<select id="rosterGame">${available.map(g=>`<option value="${esc(g.id)}">${esc(g.date)} · ${esc(g.opponent)}</option>`).join('')}</select></label><label>Team name<input id="rosterTeam"></label><label>CSV / TSV file<input type="file" id="rosterFile" accept=".csv,.tsv,.txt"></label><label>Roster photo<input type="file" id="rosterPhoto" accept="image/png,image/jpeg"></label><label class="wide">Paste roster: number, name, position, birth year<textarea id="rosterPaste" placeholder="15,Branson Winfield,F,\n38,Adin Farrow,,"></textarea></label></div><div class="actions"><button id="previewRoster">Review roster</button><button id="cancelRoster">Cancel</button></div><p id="rosterStatus" role="status"></p><div id="rosterReview"></div></section>`;
 let draft=null,version=0;
 const updateTeam=()=>{const g=available.find(g=>g.id===$('#rosterGame').value);$('#rosterTeam').value=S.teamName(data.rosters?.[g.id]?.team||g.opponent);draft=null;version++;$('#rosterReview').innerHTML='';};updateTeam();$('#rosterGame').onchange=updateTeam;
 const tell=t=>{if($('#rosterStatus'))$('#rosterStatus').textContent=t;};
 const show=(players,sourceName,image='')=>{
  const gameId=$('#rosterGame').value,teamName=$('#rosterTeam').value.trim();
  if(!teamName){tell('Enter the opponent team name.');return;}
  draft={gameId,team:teamName,sourceName,image};
  $('#rosterReview').innerHTML=`<h3>Confirm ${esc(teamName)} · ${players.length} rows</h3>${image?'<img id="rosterPreviewImage" class="photo" alt="Uploaded roster for review">':''}${table(['#','Player','Position','Birth year',''],players.map(p=>`<tr>${['number','name','position','birthYear'].map(k=>`<td><input class="${k==='name'?'name':''}" aria-label="${k}" data-roster-field="${k}" value="${esc(p[k]||'')}"></td>`).join('')}<td><button type="button" data-remove-row>Remove row</button></td></tr>`).join(''))}<button class="primary" id="confirmRoster">Confirm and save roster</button>`;
  if(image)$('#rosterPreviewImage').src=image;
  root.querySelectorAll('[data-remove-row]').forEach(b=>b.onclick=()=>b.closest('tr').remove());
  $('#confirmRoster').onclick=async()=>{try{if(!draft||draft.gameId!==$('#rosterGame').value||draft.team!==$('#rosterTeam').value.trim())throw Error('The selected game or team changed. Review the roster again.');const players=S.roster([...$('#rosterReview tbody').children].map(tr=>Object.fromEntries([...tr.querySelectorAll('input')].map(el=>[el.dataset.rosterField,el.value]))));const next=structuredClone(data);next.rosters=next.rosters||{};next.rosters[draft.gameId]={team:draft.team,sourceName:draft.sourceName,players,updatedAt:new Date().toISOString()};if(await persist(next)){year=S.season(available.find(g=>g.id===draft.gameId).date);render();status(`${players.length} roster identities saved. Existing scoresheet stats feed matching profiles automatically.`);}}catch(e){tell(e.message);}};
 };
 $('#previewRoster').onclick=()=>{try{show(S.parse($('#rosterPaste').value),'Pasted roster');}catch(e){tell(e.message);}};
 $('#cancelRoster').onclick=()=>{version++;host.innerHTML='';};
 $('#rosterFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;const task=++version,session=token;try{if(f.size>1024*1024)throw Error('Choose a roster file smaller than 1 MB.');const raw=await f.text();if(task!==version||session!==token||!$('#rosterReview'))return;show(S.parse(raw),f.name);}catch(e){tell(e.message);}};
 $('#rosterPhoto').onchange=async e=>{const f=e.target.files[0];if(!f)return;const task=++version,session=token;tell('Reading the photo. Every result must be reviewed before saving.');try{if(f.size>12*1024*1024)throw Error('Choose a photo smaller than 12 MB.');const result=await bridge.photo(new Uint8Array(await f.arrayBuffer()));if(task!==version||session!==token||!$('#rosterReview'))return;const players=S.photo(result.words);if(!players.length){tell('No roster rows recognized. Use a clear, upright photo or paste the names and numbers.');return;}show(players,f.name,result.image);tell('Check every name and number against the photo, including any handwritten corrections.');}catch(e){tell(e.message);}};
 host.scrollIntoView({block:'start'});
}
for(const name of ['pointerdown','keydown','input','wheel'])document.addEventListener(name,()=>{lastActivity=Date.now();},{passive:true});
setInterval(()=>{if(secret&&Date.now()-lastActivity>=300000)lock('Locked after 5 minutes of inactivity.');},1000);
bridge?.onLock?.(()=>lock('Workspace locked.'));
async function refreshQuietly(){if(!secret||busy||dirty||$('#rosterReview'))return;const request=token;try{const raw=await bridge.season();if(token!==request||dirty||busy||$('#rosterReview'))return;const next=raw?JSON.parse(raw):{};if(JSON.stringify(next)!==JSON.stringify(seasonData)){seasonData=next;render();status('Opponent profiles updated from the saved season.');}}catch(e){status('Could not refresh season stats: '+e.message,true);}}
window.addEventListener('focus',refreshQuietly);setInterval(refreshQuietly,15000);
window.addEventListener('beforeunload',e=>{if(secret&&dirty){e.preventDefault();e.returnValue='Unsaved scouting edits';}});
gate();
})();

