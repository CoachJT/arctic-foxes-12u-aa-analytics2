'use strict';
const layers31={bench:true,tracks:true,motion:true,crossings:true};
const wrap31=$('#tagOverlayWrap'),tools31=document.createElement('div');tools31.className='film-tools31';
tools31.innerHTML=`<button id="fit31" aria-pressed="true">Fit Entire Video</button><button id="fill31" aria-pressed="false">Fill</button><button id="theater31" aria-pressed="false">Theater</button><button id="fullscreen31">Fullscreen</button><button id="play31">Play / Pause</button><button id="back31">−5 sec</button><button id="forward31">+5 sec</button><details><summary>Overlays</summary>${Object.keys(layers31).map(k=>`<label><input type="checkbox" data-layer31="${k}" checked>${k}</label>`).join('')}</details><details><summary>Bookmark / Tag</summary><label>Tag <select id="bookmarkTag31">${['Goal','Chance','Turnover','Breakout','Forecheck','PP','PK','Good Play','Teaching Clip'].map(k=>`<option>${k}</option>`).join('')}</select></label><label>Association <select id="bookmarkPlayer31"></select></label><button id="bookmark31">Save Bookmark</button></details><span id="filmStatus31" role="status"></span>`;
wrap31.prepend(tools31);
const analysis31=document.createElement('details');analysis31.id='analysis31';analysis31.innerHTML='<summary>Analysis panel · Manual / Auto Track</summary>';$('#toiControls314').replaceWith(analysis31);analysis31.appendChild(shell314);
function fit31(fill){document.body.classList.toggle('film-fill31',fill);$('#fit31').setAttribute('aria-pressed',String(!fill));$('#fill31').setAttribute('aria-pressed',String(fill));}
$('#fit31').onclick=()=>fit31(false);$('#fill31').onclick=()=>fit31(true);
$('#theater31').onclick=()=>{$('#theater31').setAttribute('aria-pressed',String(document.body.classList.toggle('theater31')));};
$('#fullscreen31').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await wrap31.requestFullscreen();}catch(e){$('#filmStatus31').textContent='Fullscreen unavailable: '+e.message;}};
$('#play31').onclick=()=>{if(v314.paused)v314.play().catch(e=>$('#filmStatus31').textContent=e.message);else v314.pause();};
const seek31=delta=>{if(Number.isFinite(v314.duration))v314.currentTime=Math.max(0,Math.min(v314.duration,v314.currentTime+delta));};$('#back31').onclick=()=>seek31(-5);$('#forward31').onclick=()=>seek31(5);
tools31.querySelectorAll('[data-layer31]').forEach(e=>e.onchange=()=>{layers31[e.dataset.layer31]=e.checked;debug314=true;});
tools31.querySelector('details:last-of-type').addEventListener('toggle',()=>{$('#bookmarkPlayer31').innerHTML='<option value="">Team</option>'+state.players.map(p=>`<option value="${esc(p.id)}">#${esc(p.number)} ${esc(p.name)}</option>`).join('');});
$('#bookmark31').onclick=()=>{try{const m=media314();snapshot();state.command31=state.command31||{};state.command31.bookmarks=state.command31.bookmarks||[];const p=state.players.find(p=>p.id===$('#bookmarkPlayer31').value);state.command31.bookmarks.push({id:crypto.randomUUID(),gameId:state.currentGameId,clipId:m.clipId,time:m.videoTime,tag:$('#bookmarkTag31').value,playerId:p?.id||null,playerName:p?.name||null,team:'Arctic Foxes',createdAt:Date.now()});save();$('#filmStatus31').textContent='Bookmark saved';}catch(e){$('#filmStatus31').textContent=e.message;}};
document.addEventListener('keydown',e=>{if(activeWorkspace!=='film'||e.target.closest('input,textarea,select,[contenteditable="true"]')||e.ctrlKey||e.metaKey||e.altKey)return;const keys={' ':()=>$('#play31').click(),ArrowLeft:()=>seek31(-5),ArrowRight:()=>seek31(5),t:()=>$('#theater31').click(),f:()=>$('#fullscreen31').click(),b:()=>$('#bookmark31').click(),Escape:()=>{document.body.classList.remove('theater31');$('#theater31').setAttribute('aria-pressed','false');}};if(keys[e.key]){e.preventDefault();e.stopImmediatePropagation();keys[e.key]();}},true);
const oldOpen31=openWorkspace;openWorkspace=function(name){if(name!=='film')document.body.classList.remove('theater31');return oldOpen31(name);};
// Display transforms never enter detector sampling or saved normalized coordinates.
paint314=function(){
 const legacy=$('#tagOverlayCanvas');legacy.style.pointerEvents=zoneDrawing?'auto':'none';
 const w=v314.videoWidth||16,h=v314.videoHeight||9,bw=v314.clientWidth,bh=v314.clientHeight,fill=document.body.classList.contains('film-fill31'),scale=(fill?Math.max:Math.min)(bw/w,bh/h);
 const geometry={left:`${v314.offsetLeft+(bw-w*scale)/2}px`,top:`${v314.offsetTop+(bh-h*scale)/2}px`,width:`${w*scale}px`,height:`${h*scale}px`};Object.assign(legacy.style,geometry);
 Object.assign(debugCanvas314.style,geometry,{display:debug314||drawing314?'block':'none',pointerEvents:drawing314?'auto':'none'});
 debugCanvas314.width=320;debugCanvas314.height=Math.max(1,Math.round(320*h/w));const c=debugCanvas314.getContext('2d'),cw=debugCanvas314.width,ch=debugCanvas314.height,z=zone314();
 if(z&&(layers31.bench||drawing314)){c.strokeStyle='#ff6672';c.lineWidth=2;c.strokeRect(z.x*cw,z.y*ch,z.width*cw,z.height*ch);c.beginPath();if(z.axis==='x'){c.moveTo(z.boundary*cw,z.y*ch);c.lineTo(z.boundary*cw,(z.y+z.height)*ch);}else{c.moveTo(z.x*cw,z.boundary*ch);c.lineTo((z.x+z.width)*cw,z.boundary*ch);}c.stroke();}
 c.fillStyle='white';c.font='10px sans-serif';for(const b of detector314?.regions||[]){if(layers31.motion){c.strokeStyle='#94e4b9';c.strokeRect(b.left*cw,b.top*ch,b.width*cw,b.height*ch);}if(layers31.tracks)c.fillText(`Track ${b.id}`,b.left*cw,b.top*ch-3);}
 const recent=ensure314().candidates.at(-1);if(layers31.crossings&&recent)c.fillText(`Track ${recent.trackId} ${recent.direction} ${stamp314(recent.videoTime)} ${confidence314(recent.confidence)}`,5,ch-8);
};
const draw31=$('#drawZone314').onclick;$('#drawZone314').onclick=()=>{fit31(false);draw31();};
fit31(false);
debug314=true;
// Keep setup and detailed review available without crowding the coaching view.
analysis31.appendChild($('#precision312'));
const review31=document.createElement('details');review31.id='review31';review31.innerHTML='<summary>Tracking review · Bench zone · Finalize</summary>';panel314.replaceWith(review31);review31.appendChild(panel314);
const sync31=$('#syncPeriod')?.closest('#filmCard > div');if(sync31){const details=document.createElement('details');details.innerHTML='<summary>Game clock sync & legacy Tag Assist</summary>';sync31.replaceWith(details);details.appendChild(sync31);}
const syncJump31=$('#toiSyncJump314').onclick;$('#toiSyncJump314').onclick=()=>{if(sync31?.parentElement?.tagName==='DETAILS')sync31.parentElement.open=true;syncJump31();};
const setup31=$('#autoSetup314').onclick;$('#autoSetup314').onclick=()=>{review31.open=true;setup31();};
