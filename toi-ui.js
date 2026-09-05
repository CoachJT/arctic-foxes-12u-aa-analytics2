/* TOI workflow integrated with existing game storage, video, sync and Undo. */
'use strict';
const T314=FoxesTOI,v314=$('#gameVideo');
let mode314='manual',detector314=null,analyzing314=false,zoneDraft314=null,drawing314=false,drag314=null,corner314=null,lastMedia314=v314.currentTime,lastSample314=-1,skipSeek314=false,debug314=false;
function game314(){return {id:state.currentGameId,players:state.players,syncPoints:state.syncPoints,filmClips:state.filmClips,strength:state.strength,toi314:state.toi314};}
function ensure314(){if(!state.toi314)state.toi314={zones:{},candidates:[],groundTruth:[]};return T314.data({toi314:state.toi314});}
function stamp314(t){if(t==null||!Number.isFinite(Number(t)))return '—';return `${String(Math.floor(t/60)).padStart(2,'0')}:${(t%60).toFixed(2).padStart(5,'0')}`;}
function msg314(s){$('#toiMessage314').textContent=s;}
function commit314(fn){try{if(!state.currentGameId)throw Error('Select a saved game in My Games first.');const next=T314.apply(game314(),fn);snapshot();state.players=next.players;state.toi314=next.toi314;save();render();renderTOI314();msg314('Saved to this game.');return true;}catch(e){msg314(e.message);return false;}}
function media314(){if(!state.currentGameId)throw Error('Select a saved game first.');if(!currentClipId()||!Number.isFinite(v314.duration)||v314.duration<=0)throw Error('Add a playable clip first.');if(ensure314().seekReview)throw Error('Review the active-shift seek before changing ON/OFF state.');return {clipId:currentClipId(),videoTime:v314.currentTime};}
function toggle314(id){try{const media=media314(),p=state.players.find(p=>p.id===id);commit314(g=>T314.transition(g,{playerId:id,direction:p.shifts.some(s=>!s.ended)?'OFF':'ON',...media}));}catch(e){msg314(e.message);}}
const shell314=document.createElement('section');shell314.id='toiControls314';
shell314.innerHTML=`<div class="toi-top314"><strong>TIME ON ICE</strong><button data-mode314="manual" class="active">Manual Track</button><button data-mode314="auto">Auto Track (Alpha)</button><button id="toiUndo314">Undo Tracking</button><button id="toiSyncJump314">Game Clock Sync</button></div><div id="toiMessage314" role="status"></div><div id="seekReview314"></div><div id="manual314"><div id="roster314"></div><div class="toi-live314"><div><h3 id="onIceCount314">ON ICE NOW</h3><div id="onIce314"></div></div><div><h3>LIVE GAME TOI</h3><div id="liveTOI314"></div></div></div></div><div id="autoCompact314" hidden><details class="film-help413"><summary>Help</summary><p>Auto Track finds movement locally. Assign and confirm players before recording ice time. Confidence scores describe the available evidence, not accuracy.</p></details><button id="autoStart314">Start Local Analysis</button><button id="autoStop314">Cancel Analysis</button><label><input type="checkbox" id="autoDebug314"> Debug View</label><button id="autoSetup314">Bench zone</button><span id="autoProgress314" role="status">Stopped</span></div>`;
$('#tagOverlayWrap').appendChild(shell314);
// Preserve all legacy event controls in a collapsible secondary section.
const eventDetails314=document.createElement('details');eventDetails314.id='eventDetails314';eventDetails314.innerHTML='<summary>Event tagging & group controls</summary>';
const legacyRow314=$('#precision312').querySelectorAll('.row')[1];legacyRow314.replaceWith(eventDetails314);eventDetails314.appendChild(legacyRow314);
const panel314=document.createElement('section');panel314.id='toiPanel314';panel314.className='card';
panel314.innerHTML=`<h2>Ice Time</h2><details class="film-help413"><summary>Help</summary><p>Use Pause ice time at a whistle; the video keeps playing. Resume when play restarts. Pausing the video also stops time. Finish each shift within its clip; gaps between clips are not counted.</p><p>Select a shift to replay or edit it. Older clock-only shifts stay saved and need video times before editing.</p></details><details id="zoneDetails314"><summary>Bench zone</summary><p>Draw a line along the bench entrance. Choose the bench side, then save. Redraw after the camera moves.</p><button id="drawZone314">Draw line</button><label hidden>Boundary <select id="zoneAxis314"><option value="y">Horizontal</option><option value="x">Vertical</option></select></label><label>Bench side <select id="zoneSide314"><option value="low">Top / Left</option><option value="high">Bottom / Right</option></select></label><button id="saveZone314">Save line</button><button id="resetZone314">Clear line</button><p id="zoneStatus314"></p></details><h3>Auto Track</h3><div id="autoSummary314"></div><button id="refreshQueue314">Refresh</button><div id="queue314"></div><h3 id="shiftHeading413">Shifts</h3><div id="shiftLog314"></div><div id="shiftEditor314"></div><button id="finalize314">Finalize ice time</button><div id="finalizeStatus314" role="status"></div><div id="toiSummary314"></div>`;
$('#filmCard').appendChild(panel314);
const debugCanvas314=document.createElement('canvas');debugCanvas314.id='crossingCanvas314';$('#tagOverlayWrap').appendChild(debugCanvas314);
const sampleCanvas314=document.createElement('canvas'),sampleContext314=sampleCanvas314.getContext('2d',{willReadFrequently:true});
function renderLive314(){
 if(!$('#roster314'))return;const g=game314(),guard=ensure314().seekReview,t=guard?.from??v314.currentTime,cid=currentClipId(),rows=T314.shifts(g),active=rows.filter(s=>!s.ended);
 $('#roster314').innerHTML=['F','D','G'].map(pos=>`<div><h3>${pos==='F'?'FORWARDS':pos==='D'?'DEFENSE':'GOALIES'}</h3><div class="roster-buttons314">${state.players.filter(p=>p.pos===pos).map(p=>{const s=active.find(s=>s.playerId===p.id);return `<button data-player314="${esc(p.id)}" class="${s?'on314':''}" aria-pressed="${!!s}"><strong>#${esc(p.number)} ${esc(p.name)}</strong><span>${s?`ON • ${s.legacy?'Legacy open shift':stamp314(T314.duration(s,t,cid))}`:'OFF'}</span></button>`;}).join('')}</div></div>`).join('');
 $('#onIceCount314').textContent=`ON ICE NOW — ${active.length}`;
 $('#onIce314').innerHTML=active.map(s=>`<div class="position-${esc(s.position)}">${esc(s.position)} #${esc(s.jerseyNumber)} ${esc(s.playerName)} <b>${s.legacy?'Review legacy start':s.startClipId!==cid?'Other clip':stamp314(T314.duration(s,t,cid))}</b></div>`).join('')||'<span class="sub">No players marked ON</span>';
 $('#liveTOI314').innerHTML=T314.summary(g,t,cid).filter(r=>r.total>0).slice(0,7).map(r=>`<div>#${esc(r.player.number)} ${esc(r.player.name)} <b>${stamp314(r.total)}</b></div>`).join('')||'<span class="sub">Track a shift to begin.</span>';
 $('#toiUndo314').disabled=!state.history?.length;
 $('#seekReview314').innerHTML=guard?`<strong>Active shift seek: ${stamp314(guard.from)} → ${stamp314(v314.currentTime)}</strong><p>ON timestamps have not changed. Continuing includes the skipped video interval in TOI. A backward seek before ON cannot close the shift.</p><button id="returnSeek314">Return to previous video time</button><button id="acceptSeek314">Acknowledge seek & continue</button>`:'';
 if(guard){$('#returnSeek314').onclick=()=>{skipSeek314=true;v314.currentTime=guard.from;delete state.toi314.seekReview;save();renderLive314();};$('#acceptSeek314').onclick=()=>{delete state.toi314.seekReview;save();renderLive314();};}
}
function options314(selected){return state.players.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>#${esc(p.number)} ${esc(p.name)}</option>`).join('');}
function confidence314(c){return c==null?'Manual':`${c>=.75?'HIGH':c>=.55?'MEDIUM':'LOW'} · ${(c*100).toFixed(0)} evidence score`;}
function renderTOI314(){
 ensure314();syncZone314();renderLive314();const g=game314(),d=state.toi314,rows=T314.shifts(g),cs=d.candidates;
 $('#autoSummary314').textContent=`Crossings ${cs.length} · High ${cs.filter(c=>c.confidence>=.75).length} · Needs review ${cs.filter(c=>c.status==='review').length} · Rejected ${cs.filter(c=>c.status==='rejected').length} · Unknown ${cs.filter(c=>!c.assignedPlayerId&&c.status!=='rejected').length} · Confirmed ${cs.filter(c=>c.status==='confirmed').length}`;
 $('#queue314').innerHTML=cs.filter(c=>c.status==='review').map(c=>`<div class="candidate314" data-candidate314="${esc(c.id)}"><strong>UNKNOWN PLAYER · ${esc(c.direction)} · ${stamp314(c.videoTime)}</strong><span>${confidence314(c.confidence)}</span><button data-jump-candidate314="${esc(c.id)}">Review video (−4 sec)</button><label>Assign player <select data-assign314><option value="">Choose player</option>${options314('')}</select></label><label>Video seconds <input data-time314 type="number" min="0" step=".25" value="${c.videoTime.toFixed(2)}"></label><label>Direction <select data-direction314><option ${c.direction==='ON'?'selected':''}>ON</option><option ${c.direction==='OFF'?'selected':''}>OFF</option></select></label><button data-confirm314="${esc(c.id)}">Confirm</button><button data-reject314="${esc(c.id)}">Reject</button></div>`).join('')||'<p class="sub">No detections waiting for review.</p>';
 $('#shiftLog314').innerHTML=rows.length?table312(['Player','Period','ON / OFF (video)','Duration','Source','Status'],rows.map(s=>row312([`<button data-shift314="${esc(s.shiftId)}">#${esc(s.jerseyNumber)} ${esc(s.playerName)}</button>`,esc(s.gameClockOn?.period||s.period||'—'),`${stamp314(s.videoOnTime)} / ${s.ended?stamp314(s.videoOffTime):'ON'}`,s.ended?`${stamp314(s.duration)}${s.duration>65?' · LONG SHIFT — Review':''}`:'Active',esc(s.source),s.legacy?'Legacy preserved':s.confirmed?`Confirmed · ${confidence314(s.confidence)}`:'Needs review']))):'<p class="sub">No shifts recorded yet.</p>';
 $('#shiftHeading413').hidden=!rows.length;
 $('#toiSummary314').innerHTML=rows.some(s=>s.ended&&s.confirmed)?table312(['Player','Total TOI','Shifts','Average','Longest','Shortest','By period (anchored)'],T314.summary(g,null,null,true).map(r=>row312([`#${esc(r.player.number)} ${esc(r.player.name)}`,stamp314(r.total),r.count,stamp314(r.average),stamp314(r.longest),stamp314(r.shortest),Object.entries(r.byPeriod).map(([p,t])=>`P${esc(p)} ${stamp314(t)}`).join(' · ')||'—']))):'';
 $('#finalizeStatus314').textContent=d.finalizedAt?`Finalized ${new Date(d.finalizedAt).toLocaleString()}. Corrections remain available.`:rows.length?'Confirm completed shifts, then finalize.':'';
 $('#finalize314').hidden=!rows.length;
 const z=d.zones[currentClipId()];$('#zoneStatus314').textContent=zoneDraft314?'Unsaved line. Choose Save line.':z?`Zone saved for ${activeFilmClip()?.name||'this clip'} · ${z.axis==='x'?'vertical':'horizontal'} boundary`:'No line saved for this clip.';
}
function jump314(clip,t){v314.pause();if(clip!==currentClipId()){stop314();loadFilmClip(clip);v314.addEventListener('loadedmetadata',()=>{v314.currentTime=Math.min(t,v314.duration);},{once:true});}else v314.currentTime=Math.min(t,v314.duration||t);}
function editor314(id){const s=T314.shifts(game314()).find(s=>s.shiftId===id);if(!s)return;
 $('#shiftEditor314').innerHTML=`<h3>Precision Shift Editor</h3><label>Player <select id="editPlayer314">${options314(s.playerId)}</select></label><label>Clip <select id="editClip314">${state.filmClips.map(c=>`<option value="${esc(c.id)}" ${c.id===s.startClipId?'selected':''}>${esc(c.name||c.label)}</option>`).join('')}</select></label>${['On','Off'].map(k=>`<label>${k.toUpperCase()} video seconds <input id="edit${k}314" type="number" min="0" step=".25" value="${s['video'+k+'Time']??''}"></label><div>${[-1,-.25,.25,1].map(n=>`<button data-adjust314="${k}" data-delta314="${n}">${n>0?'+':''}${n} sec ${k}</button>`).join('')}</div>`).join('')}<p id="editPreview314"></p><button id="applyEdit314">Save / Confirm Shift</button><button id="deleteShift314">Delete Shift</button><button id="jumpShift314">Jump to ON</button><p class="sub">Enter times explicitly for legacy clock-only shifts. Corrections save both video and derived game-clock timestamps.</p>`;
 const preview=()=>{$('#editPreview314').textContent=`ON ${stamp314(Number($('#editOn314').value))} · OFF ${stamp314(Number($('#editOff314').value))} · SHIFT ${(Number($('#editOff314').value)-Number($('#editOn314').value)).toFixed(2)} sec`;};preview();
 $('#shiftEditor314').querySelectorAll('input').forEach(e=>e.oninput=preview);
 const apply=()=>{const on=$('#editOn314').value,off=$('#editOff314').value,cid=$('#editClip314').value,c=state.filmClips.find(c=>c.id===cid);if(c?.duration&&(Number(off)>c.duration||Number(on)>c.duration)){msg314('Timestamp exceeds this clip’s duration.');return false;}return commit314(g=>T314.edit(g,{shiftId:id,playerId:$('#editPlayer314').value,on,off,clipId:cid}));};
 $('#applyEdit314').onclick=apply;$('#deleteShift314').onclick=()=>{if(commit314(g=>T314.remove(g,id)))$('#shiftEditor314').innerHTML='';};$('#jumpShift314').onclick=()=>{if(s.videoOnTime!=null)jump314(s.startClipId,s.videoOnTime);else msg314('This legacy shift has no video anchor.');};
 $('#shiftEditor314').querySelectorAll('[data-adjust314]').forEach(b=>b.onclick=()=>{const el=$('#edit'+b.dataset.adjust314+'314');el.value=Math.max(0,Number(el.value)+Number(b.dataset.delta314)).toFixed(2);preview();if($('#editOn314').value!==''&&$('#editOff314').value!=='')apply();});
 if(s.videoOnTime!=null)jump314(s.startClipId,s.videoOnTime);
}
function stop314(message='Stopped. Review saved candidates below.'){analyzing314=false;detector314=null;$('#autoProgress314').textContent=message;renderTOI314();}
let zoneContext314='';
function syncZone314(){
 const key=JSON.stringify([state.currentGameId,currentClipId()]);
 if(key!==zoneContext314){zoneContext314=key;zoneDraft314=null;drawing314=false;drag314=null;corner314=null;analyzing314=false;detector314=null;lastSample314=-1;$('#autoProgress314').textContent='Stopped. Bench zone loaded for this clip.';}
 const z=zoneDraft314||ensure314().zones[currentClipId()];
 $('#zoneAxis314').value=z?.axis||'y';$('#zoneSide314').value=z?.benchLow===false?'high':'low';
 return z;
}
function zone314(){syncZone314();return zoneDraft314||ensure314().zones[currentClipId()];}
function paint314(){
 const legacyCanvas=$('#tagOverlayCanvas');legacyCanvas.style.pointerEvents=zoneDrawing?'auto':'none';legacyCanvas.style.height=v314.clientHeight+'px';
 const w=v314.videoWidth||16,h=v314.videoHeight||9,boxW=v314.clientWidth,boxH=v314.clientHeight,scale=Math.min(boxW/w,boxH/h);
 Object.assign(debugCanvas314.style,{left:`${v314.offsetLeft+(boxW-w*scale)/2}px`,top:`${v314.offsetTop+(boxH-h*scale)/2}px`,width:`${w*scale}px`,height:`${h*scale}px`,display:debug314||drawing314?'block':'none',pointerEvents:drawing314?'auto':'none'});
 debugCanvas314.width=320;debugCanvas314.height=Math.max(1,Math.round(320*h/w));const c=debugCanvas314.getContext('2d'),cw=debugCanvas314.width,ch=debugCanvas314.height,z=zone314();if(!z)return;
 c.strokeStyle='#ff6672';c.lineWidth=2;c.strokeRect(z.x*cw,z.y*ch,z.width*cw,z.height*ch);c.beginPath();if(z.axis==='x'){c.moveTo(z.boundary*cw,z.y*ch);c.lineTo(z.boundary*cw,(z.y+z.height)*ch);}else{c.moveTo(z.x*cw,z.boundary*ch);c.lineTo((z.x+z.width)*cw,z.boundary*ch);}c.stroke();c.fillStyle='white';c.font='10px sans-serif';c.fillText(`BENCH ${z.benchLow?'top/left':'bottom/right'} | ICE opposite`,z.x*cw,z.y*ch+12);
 for(const b of detector314?.regions||[]){c.strokeStyle='#94e4b9';c.strokeRect(b.left*cw,b.top*ch,b.width*cw,b.height*ch);c.fillText(`Track ${b.id} ${b.side>0?'ICE':'BENCH'}`,b.left*cw,b.top*ch-3);}
 const recent=ensure314().candidates.at(-1);if(recent)c.fillText(`Track ${recent.trackId} ${recent.direction} ${stamp314(recent.videoTime)} ${confidence314(recent.confidence)}`,5,ch-8);
}
function loop314(){
 try{paint314();if(analyzing314&&!v314.paused&&!v314.seeking&&v314.readyState>=2&&Math.abs(v314.currentTime-lastSample314)>=.1){lastSample314=v314.currentTime;
  const w=320,h=Math.max(1,Math.round(w*v314.videoHeight/v314.videoWidth));sampleCanvas314.width=w;sampleCanvas314.height=h;sampleContext314.drawImage(v314,0,0,w,h);
  const events=detector314.frame(sampleContext314.getImageData(0,0,w,h).data,w,h,v314.currentTime);if(events.length){const g=game314();events.forEach(c=>T314.candidate(g,{...c,clipId:currentClipId(),videoName:activeFilmClip()?.name}));save();}
  $('#autoProgress314').textContent=`Analyzing ${stamp314(v314.currentTime)} / ${stamp314(v314.duration)} · ${Math.round(v314.currentTime/v314.duration*100)}% · ${ensure314().candidates.length} candidates`;
 }}catch(e){stop314(`Analysis stopped: ${e.message}. Manual shifts are unchanged.`);}requestAnimationFrame(loop314);
}
$('#toiControls314').addEventListener('click',e=>{const p=e.target.closest('[data-player314]');if(p)toggle314(p.dataset.player314);const mode=e.target.closest('[data-mode314]');if(mode){mode314=mode.dataset.mode314;$('#manual314').hidden=mode314!=='manual';$('#autoCompact314').hidden=mode314!=='auto';document.querySelectorAll('[data-mode314]').forEach(b=>b.classList.toggle('active',b===mode));}});
$('#toiUndo314').onclick=()=>{$('#undo').click();renderTOI314();};
$('#toiSyncJump314').onclick=()=>{if(document.fullscreenElement||$('#tagOverlayWrap').classList.contains('tag-fullscreen'))exitTagFullscreen();$('#syncPeriod').closest('.card')?.scrollIntoView({block:'center'});};
$('#toiPanel314').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
 if(b.dataset.shift314)editor314(b.dataset.shift314);
 if(b.dataset.jumpCandidate314){const c=ensure314().candidates.find(c=>c.id===b.dataset.jumpCandidate314);jump314(c.clipId,Math.max(0,c.videoTime-4));}
 if(b.dataset.confirm314){const box=b.closest('[data-candidate314]');commit314(g=>T314.review(g,{id:b.dataset.confirm314,action:'confirm',playerId:box.querySelector('[data-assign314]').value,videoTime:box.querySelector('[data-time314]').value,direction:box.querySelector('[data-direction314]').value}));}
 if(b.dataset.reject314)commit314(g=>T314.review(g,{id:b.dataset.reject314,action:'reject'}));
});
$('#refreshQueue314').onclick=renderTOI314;
$('#finalize314').onclick=()=>{const rows=T314.shifts(game314());if(rows.some(s=>!s.ended)||ensure314().candidates.some(c=>c.status==='review')||ensure314().seekReview||Object.values(ensure314().whistles||{}).some(spans=>spans.some(p=>p.end==null))){msg314('Resume any paused ice-time clock, finish/correct open shifts, resolve seeks, and confirm or reject the review queue before finalizing.');return;}commit314(g=>{T314.data(g).finalizedAt=Date.now();});};
$('#autoStart314').onclick=()=>{try{syncZone314();media314();if(zoneDraft314||drawing314)throw Error('Save the bench zone before starting analysis.');const z=ensure314().zones[currentClipId()];if(!z)throw Error('Save a bench zone for this clip first.');detector314=new FoxesCrossing.Detector(z);analyzing314=true;lastSample314=-1;v314.play().catch(e=>stop314(e.message));}catch(e){msg314(e.message);}};
$('#autoStop314').onclick=()=>stop314();$('#autoDebug314').onchange=e=>debug314=e.target.checked;
$('#autoSetup314').onclick=()=>{exitTagFullscreen();$('#zoneDetails314').open=true;$('#zoneDetails314').scrollIntoView({block:'center'});};
$('#drawZone314').onclick=()=>{try{media314();}catch(e){msg314(e.message);return;}stop314();v314.pause();drawing314=true;debug314=true;$('#autoDebug314').checked=true;zoneDraft314=null;drag314=null;corner314=null;$('#gameVideo').scrollIntoView({block:'center'});msg314('Drag a line, or click its two ends. Then Save line.');};
function linePoint414(e){const r=debugCanvas314.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};}
debugCanvas314.onpointerdown=e=>{if(!drawing314)return;drag314=linePoint414(e);debugCanvas314.setPointerCapture(e.pointerId);};
debugCanvas314.onpointermove=e=>{if(!drawing314||!(corner314||drag314))return;const a=corner314||drag314,b=linePoint414(e);try{zoneDraft314=T314.benchLine({x1:a.x,y1:a.y,x2:b.x,y2:b.y},$('#zoneSide314').value==='low');paint314();}catch(_){};};
debugCanvas314.onpointerup=e=>{if(!drawing314||!drag314)return;const b=linePoint414(e),a=corner314||drag314;
 if(!corner314&&Math.hypot(b.x-a.x,b.y-a.y)<.01){corner314=a;drag314=null;msg314('Click the other end of the line.');return;}
 try{zoneDraft314=T314.benchLine({x1:a.x,y1:a.y,x2:b.x,y2:b.y},$('#zoneSide314').value==='low');drag314=null;corner314=null;drawing314=false;renderTOI314();msg314('Line drawn. Check the bench side, then Save line.');}catch(error){drag314=null;msg314(error.message);}
};
debugCanvas314.onpointercancel=()=>{zoneDraft314=null;drawing314=false;drag314=null;corner314=null;renderTOI314();};
$('#zoneSide314').onchange=()=>{const z=zone314();if(!z){msg314('Draw a line first.');return;}stop314();zoneDraft314={...z,benchLow:$('#zoneSide314').value==='low'};renderTOI314();};
$('#saveZone314').onclick=()=>{try{const m=media314(),z=zone314();
 if(drawing314)throw Error('Finish drawing the bench region first.');
 if(commit314(g=>T314.saveZone(g,m.clipId,{...z,videoName:activeFilmClip()?.name,widthPixels:v314.videoWidth,heightPixels:v314.videoHeight,updatedAt:Date.now()}))){zoneDraft314=null;stop314('Zone saved. Ready to start local analysis.');msg314('Bench zone saved for this clip.');}
}catch(e){msg314(e.message);}};
$('#resetZone314').onclick=()=>{syncZone314();if(commit314(g=>{delete T314.data(g).zones[currentClipId()];})){zoneDraft314=null;drawing314=false;drag314=null;corner314=null;stop314('Bench zone removed for this clip.');}};
v314.addEventListener('timeupdate',()=>{if(!v314.seeking)lastMedia314=v314.currentTime;renderLive314();});
v314.addEventListener('seeking',()=>{detector314?.reset();if(skipSeek314){skipSeek314=false;return;}if(T314.shifts(game314()).some(s=>!s.ended&&s.toiSchema===314)){v314.pause();ensure314().seekReview=ensure314().seekReview||{from:lastMedia314,clipId:currentClipId()};save();renderLive314();}});
v314.addEventListener('ended',()=>{if(analyzing314)stop314('Analysis reached clip end. Review candidates before finalizing.');});
v314.addEventListener('emptied',()=>{zoneDraft314=null;drawing314=false;drag314=null;corner314=null;stop314('Clip changed. Analysis stopped.');});
v314.addEventListener('loadedmetadata',()=>{syncZone314();renderTOI314();});
const baseRender314=render;render=function(){baseRender314();renderTOI314();};
const baseDuration314=shiftDuration;shiftDuration=function(s){if(s.toiSchema===314){if(s.ended)return FoxesIceTime.seconds(s);return s.startClipId===currentClipId()?FoxesIceTime.seconds(s,ensure314().seekReview?.from??v314.currentTime):0;}return baseDuration314(s);};
const baseCurrent314=currentShiftDuration;currentShiftDuration=function(p){const s=activeShift(p);return s?.toiSchema===314?shiftDuration(s):baseCurrent314(p);};
const baseOpen314=openWorkspace;openWorkspace=function(name){baseOpen314(name);if(name==='film')renderTOI314();};
// Existing bench/group controls share the new video engine when film is loaded.
function filmReady314(){return state.useVideoTime&&currentClipId()&&Number.isFinite(v314.duration)&&v314.duration>0;}
const oldToggle314=togglePlayer;togglePlayer=function(id,history=true){if(filmReady314()||state.players.find(p=>p.id===id)?.shifts.some(s=>!s.ended&&s.toiSchema===314))return toggle314(id);return oldToggle314(id,history);};
const oldStart314=startPlayerShift;startPlayerShift=function(p){if(!filmReady314())return oldStart314(p);try{T314.transition(game314(),{playerId:p.id,direction:'ON',...media314()});}catch(e){msg314(e.message);}};
const oldEnd314=endPlayer;endPlayer=function(p){if(!activeShift(p)||activeShift(p).toiSchema!==314)return oldEnd314(p);try{T314.transition(game314(),{playerId:p.id,direction:'OFF',...media314()});}catch(e){msg314(e.message);}};
const oldLine314=switchLine;switchLine=function(name){if(!filmReady314())return oldLine314(name);try{const media=media314(),group=name.startsWith('F')?'F':'D';commit314(g=>{g.players.filter(p=>p.pos===group&&p.shifts.some(s=>!s.ended)).forEach(p=>T314.transition(g,{playerId:p.id,direction:'OFF',...media}));for(const n of state.lines[name]||[]){const p=g.players.find(p=>String(p.number).trim()===String(n).trim());if(p)T314.transition(g,{playerId:p.id,direction:'ON',...media});}});}catch(e){msg314(e.message);}};
const oldTagShift314=applyTagShiftAction292;applyTagShiftAction292=function(playerId,action,t,clipId,history=true){if(!clipId&&!filmReady314())return oldTagShift314(playerId,action,t,clipId,history);try{media314();const next=T314.apply(game314(),g=>T314.transition(g,{playerId,direction:action,videoTime:t,clipId:clipId||currentClipId()}));if(history)snapshot();state.players=next.players;state.toi314=next.toi314;return true;}catch(e){msg314(e.message);return false;}};
$('#applyChange').addEventListener('click',e=>{if(!filmReady314())return;e.stopImmediatePropagation();try{const media=media314();if(commit314(g=>{for(const id of state.changeOff)T314.transition(g,{playerId:id,direction:'OFF',...media});for(const id of state.changeOn)T314.transition(g,{playerId:id,direction:'ON',...media});})){state.changeOff=[];state.changeOn=[];render();}}catch(err){msg314(err.message);}},{capture:true});
$('#livePickApply').addEventListener('click',e=>{if(!filmReady314())return;e.stopImmediatePropagation();try{const media=media314();if(!livePickSelected.length)throw Error('Choose the players changing first.');if(commit314(g=>{for(const id of livePickSelected)T314.transition(g,{playerId:id,direction:livePickAction,...media});}))closeLivePicker();}catch(err){msg314(err.message);}},{capture:true});
const undoBase314=$('#undo').onclick;$('#undo').onclick=()=>{const pending=structuredClone(ensure314().candidates);undoBase314();const d=ensure314();for(const c of pending)if(!d.candidates.some(x=>x.id===c.id)&&c.status==='review')d.candidates.push(c);save();renderTOI314();};
ensure314();renderTOI314();requestAnimationFrame(loop314);
