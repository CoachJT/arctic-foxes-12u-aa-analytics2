'use strict';
const layers31={bench:true,tracks:false,motion:false,crossings:true};
const wrap31=$('#tagOverlayWrap'),tools31=document.createElement('div');tools31.className='film-tools31';
tools31.innerHTML=`<button id="fit31" aria-pressed="true">Fit</button><button id="fill31" aria-pressed="false">Fill</button><button id="theater31" aria-pressed="false">Theater</button><button id="fullscreen31">Fullscreen</button><button id="play31">Play / Pause</button><button id="back31">−5 sec</button><button id="forward31">+5 sec</button><details><summary>Overlays</summary>${Object.keys(layers31).map(k=>`<label><input type="checkbox" data-layer31="${k}" ${layers31[k]?'checked':''}>${k}</label>`).join('')}</details><details><summary>Tag a moment</summary><label>Tag <select id="bookmarkTag31">${['Goal','Chance','Turnover','Breakout','Forecheck','PP','PK','Good Play','Teaching Clip'].map(k=>`<option>${k}</option>`).join('')}</select></label><label>Player <select id="bookmarkPlayer31"></select></label><button id="bookmark31">Save Tag</button></details><span id="filmStatus31" role="status"></span>`;
wrap31.prepend(tools31);
// Group existing controls without replacing their handlers or changing saved analysis.
for(const [label,ids] of [['Playback',['back31','play31','forward31']],['View',['fit31','fill31','theater31','fullscreen31']]]){const group=document.createElement('div');group.className='film-control-group315';group.setAttribute('role','group');group.setAttribute('aria-label',label);for(const id of ids)group.appendChild(tools31.querySelector('#'+id));tools31.prepend(group);}
const playback=tools31.querySelector('[aria-label="Playback"]');tools31.prepend(playback);
$('#play31').textContent='Play';$('#play31').title='Play / pause (Space)';$('#back31').title='Back 5 seconds (Left arrow)';$('#forward31').title='Forward 5 seconds (Right arrow)';
for(const event of ['play','pause','ended'])v314.addEventListener(event,()=>{$('#play31').textContent=v314.paused?'Play':'Pause';});
const overlayLabels={bench:'Bench boundary',tracks:'Track labels',motion:'Motion boxes',crossings:'Latest crossing'};
tools31.querySelectorAll('[data-layer31]').forEach(input=>{input.parentElement.lastChild.textContent=overlayLabels[input.dataset.layer31];});

const analysis31=document.createElement('details');analysis31.id='analysis31';analysis31.innerHTML='<summary>Track ice time</summary>';$('#toiControls314').replaceWith(analysis31);analysis31.appendChild(shell314);
function fit31(fill){document.body.classList.toggle('film-fill31',fill);$('#fit31').setAttribute('aria-pressed',String(!fill));$('#fill31').setAttribute('aria-pressed',String(fill));}
$('#fit31').onclick=()=>fit31(false);$('#fill31').onclick=()=>fit31(true);
$('#theater31').onclick=()=>{$('#theater31').setAttribute('aria-pressed',String(document.body.classList.toggle('theater31')));};
// All fullscreen entry points share one viewport layout and exit behavior.
function syncFullscreen412(on){
 wrap31.classList.toggle('tag-fullscreen',on);
 document.body.classList.toggle('tag-fullscreen-open',on);
 $('#fullscreen31').textContent=on?'Exit fullscreen':'Fullscreen';
 $('#fullscreen31').setAttribute('aria-pressed',String(on));
 requestAnimationFrame(()=>{if(typeof paint314==='function')paint314();});
}
$('#tagFullscreenBtn').removeEventListener('click',enterTagFullscreen);
$('#exitTagFullscreen').removeEventListener('click',exitTagFullscreen);
enterTagFullscreen=async function(){
 syncFullscreen412(true);
 try{if(document.fullscreenElement!==wrap31)await wrap31.requestFullscreen();}
 catch(e){$('#filmStatus31').textContent='Expanded view active. Press Escape to exit.';}
};
exitTagFullscreen=async function(){
 try{if(document.fullscreenElement)await document.exitFullscreen();}
 finally{syncFullscreen412(false);}
};
document.addEventListener('fullscreenchange',()=>syncFullscreen412(document.fullscreenElement===wrap31));
$('#fullscreen31').onclick=()=>document.fullscreenElement||wrap31.classList.contains('tag-fullscreen')?exitTagFullscreen():enterTagFullscreen();
$('#tagFullscreenBtn').onclick=()=>enterTagFullscreen();
$('#exitTagFullscreen').onclick=()=>exitTagFullscreen();
$('#play31').onclick=()=>{if(v314.paused)v314.play().catch(e=>$('#filmStatus31').textContent=e.message);else v314.pause();};
const seek31=delta=>{if(Number.isFinite(v314.duration))v314.currentTime=Math.max(0,Math.min(v314.duration,v314.currentTime+delta));};$('#back31').onclick=()=>seek31(-5);$('#forward31').onclick=()=>seek31(5);
tools31.querySelectorAll('[data-layer31]').forEach(e=>e.onchange=()=>{layers31[e.dataset.layer31]=e.checked;debug314=true;});
tools31.querySelector('details:last-of-type').addEventListener('toggle',()=>{$('#bookmarkPlayer31').innerHTML='<option value="">Team</option>'+state.players.map(p=>`<option value="${esc(p.id)}">#${esc(p.number)} ${esc(p.name)}</option>`).join('');});
$('#bookmark31').onclick=()=>{try{const m=media314();snapshot();state.command31=state.command31||{};state.command31.bookmarks=state.command31.bookmarks||[];const p=state.players.find(p=>p.id===$('#bookmarkPlayer31').value);state.command31.bookmarks.push({id:crypto.randomUUID(),gameId:state.currentGameId,clipId:m.clipId,time:m.videoTime,tag:$('#bookmarkTag31').value,playerId:p?.id||null,playerName:p?.name||null,team:'Arctic Foxes',createdAt:Date.now()});save();$('#filmStatus31').textContent='Bookmark saved';}catch(e){$('#filmStatus31').textContent=e.message;}};
document.addEventListener('keydown',e=>{if(activeWorkspace!=='film'||e.target.closest('input,textarea,select,[contenteditable="true"]')||e.ctrlKey||e.metaKey||e.altKey)return;const keys={' ':()=>$('#play31').click(),ArrowLeft:()=>seek31(-5),ArrowRight:()=>seek31(5),t:()=>$('#theater31').click(),f:()=>$('#fullscreen31').click(),b:()=>$('#bookmark31').click(),Escape:()=>{exitTagFullscreen();document.body.classList.remove('theater31');$('#theater31').setAttribute('aria-pressed','false');}};if(keys[e.key]){e.preventDefault();e.stopImmediatePropagation();keys[e.key]();}},true);
const oldOpen31=openWorkspace;openWorkspace=function(name){if(name!=='film'){document.body.classList.remove('theater31');if(document.fullscreenElement||wrap31.classList.contains('tag-fullscreen'))exitTagFullscreen();}return oldOpen31(name);};
// Display transforms never enter detector sampling or saved normalized coordinates.
paint314=function(){
 const legacy=$('#tagOverlayCanvas');legacy.style.pointerEvents='none';legacy.style.display='none';
 const w=v314.videoWidth||16,h=v314.videoHeight||9,bw=v314.clientWidth,bh=v314.clientHeight,fill=document.body.classList.contains('film-fill31'),scale=(fill?Math.max:Math.min)(bw/w,bh/h);
 const geometry={left:`${v314.offsetLeft+(bw-w*scale)/2}px`,top:`${v314.offsetTop+(bh-h*scale)/2}px`,width:`${w*scale}px`,height:`${h*scale}px`};Object.assign(legacy.style,geometry);
 Object.assign(debugCanvas314.style,geometry,{display:v314.videoWidth>0&&v314.readyState>=1&&(debug314||drawing314)?'block':'none',pointerEvents:drawing314?'auto':'none'});
 debugCanvas314.width=320;debugCanvas314.height=Math.max(1,Math.round(320*h/w));const c=debugCanvas314.getContext('2d'),cw=debugCanvas314.width,ch=debugCanvas314.height,z=zone314();
 if(z&&(layers31.bench||drawing314)){
 const l=z.line||(z.axis==='x'?{x1:z.boundary,y1:z.y,x2:z.boundary,y2:z.y+z.height}:{x1:z.x,y1:z.boundary,x2:z.x+z.width,y2:z.boundary});
 c.strokeStyle='#ff6672';c.lineCap='round';c.lineWidth=2;c.beginPath();c.moveTo(l.x1*cw,l.y1*ch);c.lineTo(l.x2*cw,l.y2*ch);c.stroke();c.fillStyle='#ff6672';for(const [x,y] of [[l.x1,l.y1],[l.x2,l.y2]]){c.beginPath();c.arc(x*cw,y*ch,2.5,0,Math.PI*2);c.fill();}
 }
 c.fillStyle='white';c.font='10px sans-serif';for(const b of detector314?.regions||[]){if(layers31.motion){c.strokeStyle='#94e4b9';c.strokeRect(b.left*cw,b.top*ch,b.width*cw,b.height*ch);}if(layers31.tracks)c.fillText(`Track ${b.id}`,b.left*cw,b.top*ch-3);}
 const recent=ensure314().candidates.at(-1);if(layers31.crossings&&recent)c.fillText(`Track ${recent.trackId} ${recent.direction} ${stamp314(recent.videoTime)} ${confidence314(recent.confidence)}`,5,ch-8);
};
const draw31=$('#drawZone314').onclick;$('#drawZone314').onclick=()=>{fit31(false);draw31();};
fit31(false);
debug314=true;
// Keep setup and detailed review available without crowding the coaching view.
analysis31.appendChild($('#precision312'));
const review31=document.createElement('details');review31.id='review31';review31.innerHTML='<summary>Review</summary>';panel314.replaceWith(review31);review31.appendChild(panel314);
const sync31=$('#syncPeriod')?.closest('#filmCard > div');if(sync31){const details=document.createElement('details');details.innerHTML='<summary>Clock & tag settings</summary>';sync31.replaceWith(details);details.appendChild(sync31);}
const syncJump31=$('#toiSyncJump314').onclick;$('#toiSyncJump314').onclick=()=>{if(sync31?.parentElement?.tagName==='DETAILS')sync31.parentElement.open=true;syncJump31();};
const setup31=$('#autoSetup314').onclick;$('#autoSetup314').onclick=()=>{review31.open=true;setup31();};

// Keep detection controls and readiness visible while the analysis panel is closed.
const autoBar31=document.createElement('div');autoBar31.className='film-auto31';
autoBar31.innerHTML='<button id="filmAutoToggle31" type="button" aria-pressed="false">Start Auto Track</button><button id="filmAutoZone31" type="button">Bench Zone</button><button id="filmAutoReview31" type="button">Review crossings</button><span id="filmAutoState31" role="status" aria-live="polite"></span><details class="film-help413"><summary>Help</summary><p>Auto Track suggests bench crossings. Assign a player and confirm each one before it counts toward ice time.</p></details>';
tools31.after(autoBar31);
function renderFilmAuto31(){
 const data=ensure314(),clip=currentClipId(),ready=!!state.currentGameId&&!!clip&&Number.isFinite(v314.duration)&&v314.duration>0;
 const zone=data.zones[clip],pending=data.candidates.filter(c=>c.clipId===clip&&c.status==='review').length;
 const label=!state.currentGameId?'Select a saved game':!ready?'Load a playable clip':zoneDraft314||drawing314?'Save your bench zone':!zone?'Bench zone required':analyzing314?(v314.seeking?'Seeking · detection paused':v314.paused?'Paused · resumes with playback':v314.readyState<2?'Buffering · detection waiting':'Detecting bench crossings'):'Auto Track is off';
 const button=$('#filmAutoToggle31');button.textContent=analyzing314?'Stop Auto Track':'Start Auto Track';button.setAttribute('aria-pressed',String(analyzing314));
 const status=$('#filmAutoState31');if(status.textContent!==label)status.textContent=label;
 autoBar31.dataset.running=String(analyzing314&&!v314.paused&&!v314.seeking&&v314.readyState>=2);
 $('#filmAutoReview31').textContent=`Review (${pending})`;
}
$('#filmAutoToggle31').onclick=()=>{
 if(analyzing314){$('#autoStop314').click();renderFilmAuto31();return;}
 analysis31.open=true;$('#toiControls314 [data-mode314="auto"]').click();$('#autoStart314').click();renderFilmAuto31();
 if(analyzing314)analysis31.open=false;
};
$('#filmAutoZone31').onclick=()=>$('#autoSetup314').click();
$('#filmAutoReview31').onclick=()=>{review31.open=true;renderTOI314();$('#autoSummary314').scrollIntoView({block:'center'});};
const renderAutoBase31=renderTOI314;renderTOI314=function(){renderAutoBase31();renderFilmAuto31();};
for(const event of ['play','pause','playing','waiting','seeking','seeked','ended','emptied','loadedmetadata','timeupdate'])v314.addEventListener(event,renderFilmAuto31);
renderFilmAuto31();
// Film workstation: preserve the original video and analysis nodes and their handlers.
const side316=document.createElement('aside');side316.className='film-side316';side316.setAttribute('aria-label','Film analysis tools');
side316.innerHTML='<div class="film-side-heading316"><h2>Film tools</h2></div>';
const overlayPanel316=tools31.querySelector('details'),bookmarkPanel316=tools31.querySelector('details:last-of-type');
side316.append(bookmarkPanel316,overlayPanel316,autoBar31,analysis31,review31);
bookmarkPanel316.open=true;
wrap31.appendChild(side316);wrap31.classList.add('film-workstation316');
// A keyboard-accessible scrubber operates on the current clip only.
const transport316=document.createElement('div');transport316.className='film-transport316';
transport316.innerHTML='<div class="film-seek316"><span id="filmTime316">00:00</span><input id="filmSeek316" type="range" min="0" max="1" step="0.1" value="0" aria-label="Video position" disabled><span id="filmDuration316">00:00</span></div>';
transport316.appendChild(tools31);wrap31.appendChild(transport316);
const seekInput316=$('#filmSeek316');
function updateTransport316(){const duration=v314.duration,ready=Number.isFinite(duration)&&duration>0;seekInput316.disabled=!ready;seekInput316.max=ready?duration:1;seekInput316.value=ready?v314.currentTime:0;$('#filmTime316').textContent=stamp314(v314.currentTime||0);$('#filmDuration316').textContent=ready?stamp314(duration):'00:00';}
seekInput316.addEventListener('input',()=>{if(Number.isFinite(v314.duration))v314.currentTime=Math.min(v314.duration,Math.max(0,Number(seekInput316.value)));});
for(const event of ['timeupdate','loadedmetadata','durationchange','emptied'])v314.addEventListener(event,updateTransport316);
updateTransport316();
// Empty film stays compact; the existing Add Clip action remains available.
function filmReady316(){wrap31.classList.toggle('has-media316',!!v314.currentSrc||!!v314.getAttribute('src'));}
for(const event of ['loadedmetadata','emptied','loadstart'])v314.addEventListener(event,filmReady316);filmReady316();

const emptyVideo413=document.createElement('div');emptyVideo413.className='film-empty413';emptyVideo413.innerHTML='<strong>Add a video to begin</strong><button type="button">Add Clip</button>';emptyVideo413.querySelector('button').onclick=()=>chooseFilmClips();wrap31.appendChild(emptyVideo413);
const readyBase413=filmReady316;filmReady316=function(){readyBase413();emptyVideo413.hidden=!!v314.currentSrc||!!v314.getAttribute('src')||!!v314.srcObject;};
for(const event of ['loadedmetadata','emptied','loadstart'])v314.addEventListener(event,filmReady316);filmReady316();

// Retire the game-wide marker display; all visible bench lines belong to a clip.
drawBenchZone=function(){const c=$('#tagOverlayCanvas');c.getContext('2d').clearRect(0,0,c.width,c.height);c.style.display='none';zoneDrawing=false;};drawBenchZone();
$('#armBenchZone').onclick=()=>{$('#autoSetup314').click();$('#drawZone314').click();};
