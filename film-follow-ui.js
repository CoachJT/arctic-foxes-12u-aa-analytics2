'use strict';
// One compact transport and one tool at a time, including in fullscreen.
const followPanel416=document.createElement('section');followPanel416.id='followPanel416';
followPanel416.innerHTML='<h3>Follow players · Preview</h3><p>Attach a name to each visible player, then follow their bench crossings.</p><button id="attach416">Attach player</button><button id="startFollow416">Start following</button><button id="stopFollow416">Pause following</button><p id="followStatus416" role="status">Attach the players in a clear, paused frame.</p><div id="followList416"></div><details><summary>When a label is lost</summary><p>Playback pauses. Reconnect the player and confirm whether they are on the ice. Similar uniforms, overlap, and camera movement can interrupt tracking. Check recorded shifts before finalizing.</p></details>';
side316.prepend(followPanel416);
const quick416=document.createElement('div');quick416.className='film-quick416';quick416.innerHTML='<button id="sound416" aria-pressed="true">Sound on</button><input id="volume416" type="range" min="0" max="1" step=".05" value="1" aria-label="Video volume"><button id="whistle416" aria-pressed="false">Pause ice time</button><button data-tool416="follow">Follow players</button><button data-tool416="bench">Bench line</button><button data-tool416="review">Review</button><button data-tool416="more">More</button>';
tools31.appendChild(quick416);
const drawerHeader416=document.createElement('div');drawerHeader416.className='drawer-head416';drawerHeader416.innerHTML='<strong id="drawerTitle416">Follow players</strong><button id="closeTools416" aria-label="Close film tools">Close</button>';side316.prepend(drawerHeader416);
const viewPanel416=document.createElement('section');viewPanel416.innerHTML='<h3>View</h3>';for(const id of ['fit31','fill31','theater31'])viewPanel416.appendChild($('#'+id));viewPanel416.appendChild(quick416.querySelector('[data-tool416="bench"]'));side316.appendChild(viewPanel416);tools31.appendChild($('#fullscreen31'));tools31.appendChild($('#filmStatus31'));v314.controls=false;
const toolNodes416=[viewPanel416,followPanel416,bookmarkPanel316,overlayPanel316,autoBar31,analysis31,review31,learningPanel4];
let selectedTool416=null,follow416=null,following416=false,followContext416='',followTime416=-1;
function openTool416(name){selectedTool416=name;wrap31.classList.toggle('tools-open416',!!name);side316.classList.toggle('drawer-open416',!!name);for(const n of toolNodes416)n.hidden=true;
 const nodes={follow:[followPanel416],bench:[review31],review:[review31],more:[viewPanel416,bookmarkPanel316,overlayPanel316,autoBar31,analysis31,learningPanel4]};for(const n of nodes[name]||[])n.hidden=false;
 if(name==='bench'||name==='review'){review31.open=true;$('#zoneDetails314').open=name==='bench';panel314.classList.toggle('bench-only416',name==='bench');panel314.classList.toggle('review-only416',name==='review');}
 $('#drawerTitle416').textContent={follow:'Follow players',bench:'Bench line',review:'Review shifts',more:'More tools'}[name]||'Film tools';
 quick416.querySelectorAll('[data-tool416]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool416===name)));
}
quick416.querySelectorAll('[data-tool416]').forEach(b=>b.onclick=()=>openTool416(selectedTool416===b.dataset.tool416?null:b.dataset.tool416));$('#closeTools416').onclick=()=>openTool416(null);
v314.defaultMuted=false;v314.muted=false;v314.volume=1;v314.removeAttribute('muted');
function sound416(){const on=!v314.muted&&v314.volume>0;$('#sound416').textContent=on?'Sound on':'Sound off';$('#sound416').setAttribute('aria-pressed',String(on));$('#volume416').value=String(v314.volume);}
$('#sound416').onclick=()=>{v314.muted=!v314.muted;if(!v314.muted&&v314.volume===0)v314.volume=1;sound416();};$('#volume416').oninput=e=>{v314.volume=Number(e.target.value);v314.muted=v314.volume===0;sound416();};v314.addEventListener('volumechange',sound416);
function refreshWhistle416(){const paused=(ensure314().whistles?.[currentClipId()]||[]).some(p=>p.end==null);$('#whistle416').textContent=paused?'Resume ice time':'Pause ice time';$('#whistle416').setAttribute('aria-pressed',String(paused));$('#whistle416').classList.toggle('whistle-paused416',paused);}
$('#whistle416').onclick=()=>{try{const m=media314();const paused=!(ensure314().whistles?.[m.clipId]||[]).some(p=>p.end==null);if(commit314(g=>T314.whistle(g,{...m,paused}))){$('#filmStatus31').textContent=paused?'Ice time paused · video can keep playing':'Ice time running';refreshWhistle416();}}catch(e){$('#filmStatus31').textContent=e.message;}};
const renderWhistle416=renderTOI314;renderTOI314=function(){renderWhistle416();refreshWhistle416();};
const capture416=document.createElement('canvas'),captureContext416=capture416.getContext('2d',{willReadFrequently:true});
function frame416(){capture416.width=480;capture416.height=Math.round(480*v314.videoHeight/v314.videoWidth);captureContext416.drawImage(v314,0,0,capture416.width,capture416.height);return captureContext416.getImageData(0,0,capture416.width,capture416.height);}
function pauseFollow416(reason,invalidate=false){following416=false;v314.pause();if(invalidate)follow416?.invalidate(reason);$('#followStatus416').textContent=reason;renderFollow416();}
function renderFollow416(){const tracks=follow416?.tracks||[];$('#followList416').innerHTML=tracks.map(t=>{const p=state.players.find(p=>p.id===t.playerId);return `<div class="follow-player416"><span>#${esc(p?.number||'')} ${esc(p?.name||'')} · ${t.status==='lost'?'Reconnect':t.onIce?'On ice':'Bench'}</span><button data-reconnect416="${esc(t.playerId)}">Reconnect</button></div>`;}).join('');$('#followList416').querySelectorAll('[data-reconnect416]').forEach(b=>b.onclick=()=>openAttach416(b.dataset.reconnect416));$('#startFollow416').disabled=!tracks.length||tracks.some(t=>t.status==='lost')||following416;$('#stopFollow416').disabled=!following416;}
const attachDialog416=document.createElement('dialog');attachDialog416.id='attachDialog416';attachDialog416.innerHTML='<div class="drawer-head416"><h3>Attach a player</h3><button id="cancelAttach416">Close</button></div><p>Draw a tight box, choose their name, and confirm their current state.</p><canvas id="attachFrame416" aria-label="Drag a box around the player"></canvas><div class="row"><label>Player<select id="attachPlayer416"></select></label><label>Current state<select id="attachState416"><option value="">Choose state</option><option value="ice">On ice now</option><option value="bench">On the bench</option></select></label><button id="confirmAttach416">Attach label</button></div><p id="attachStatus416" role="status">An on-ice confirmation starts a shift at this frame if none is open.</p>';
wrap31.appendChild(attachDialog416);
const attachFrame416=$('#attachFrame416');let attachCapture416=null,attachBox416=null,attachPoint416=null;
function openAttach416(playerId=''){try{const m=media314(),z=ensure314().zones[m.clipId];if(!z||zoneDraft314||drawing314)throw Error('Save your bench line first.');if(v314.readyState<2)throw Error('Load a playable video.');pauseFollow416('Paused for player setup.');stop314();const context=JSON.stringify([state.currentGameId,m.clipId]);if(context!==followContext416){follow416=null;followContext416=context;}if(!follow416)follow416=new FoxesPlayerTracker.Tracker(structuredClone(z));
 attachCapture416={...m,gameId:state.currentGameId,frame:frame416()};attachBox416=null;attachPoint416=null;attachFrame416.width=capture416.width;attachFrame416.height=capture416.height;attachFrame416.getContext('2d').putImageData(attachCapture416.frame,0,0);$('#attachPlayer416').innerHTML='<option value="">Choose player</option>'+options314(playerId);$('#attachPlayer416').value=playerId;$('#attachState416').value='';$('#attachStatus416').textContent='Confirming On ice starts a shift here. Confirming Bench ends any open shift here.';attachDialog416.showModal();
 }catch(e){$('#followStatus416').textContent=e.message;openTool416('follow');}}
$('#attach416').onclick=()=>openAttach416();$('#cancelAttach416').onclick=()=>attachDialog416.close();attachDialog416.addEventListener('close',()=>{attachCapture416=null;attachBox416=null;attachPoint416=null;});
const point416=e=>{const r=attachFrame416.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
attachFrame416.onpointerdown=e=>{attachPoint416=point416(e);attachFrame416.setPointerCapture(e.pointerId);};attachFrame416.onpointermove=e=>{if(!attachPoint416||!attachCapture416)return;const p=point416(e);attachBox416={x:Math.min(p.x,attachPoint416.x),y:Math.min(p.y,attachPoint416.y),width:Math.abs(p.x-attachPoint416.x),height:Math.abs(p.y-attachPoint416.y)};const c=attachFrame416.getContext('2d');c.putImageData(attachCapture416.frame,0,0);c.strokeStyle='#71efc1';c.lineWidth=2;c.strokeRect(attachBox416.x*attachFrame416.width,attachBox416.y*attachFrame416.height,attachBox416.width*attachFrame416.width,attachBox416.height*attachFrame416.height);};attachFrame416.onpointerup=e=>{attachFrame416.onpointermove(e);attachPoint416=null;};attachFrame416.onpointercancel=()=>attachPoint416=null;
$('#confirmAttach416').onclick=()=>{try{const a=attachCapture416,m=media314();if(!a||a.gameId!==state.currentGameId||a.clipId!==m.clipId||Math.abs(a.videoTime-m.videoTime)>.05)throw Error('The video changed. Close and select the player again.');const playerId=$('#attachPlayer416').value,p=state.players.find(p=>p.id===playerId),choice=$('#attachState416').value;if(!p||!choice)throw Error('Choose a player and their current state.');const onIce=choice==='ice',trial=new FoxesPlayerTracker.Tracker(follow416.zone);trial.tracks=structuredClone(follow416.tracks);trial.attach(a.frame,{playerId,box:attachBox416,onIce},m.videoTime);
 const active=(p.shifts||[]).filter(s=>!s.ended);if(active.length>1)throw Error('Correct the multiple open shifts first.');if(active.length&&(active[0].toiSchema!==314||active[0].startClipId!==m.clipId))throw Error('Resolve the earlier open shift first.');
 if(!commit314(g=>{if(onIce!==!!active.length)T314.transition(g,{playerId,direction:onIce?'ON':'OFF',...m});T314.data(g).groundTruth.push({id:crypto.randomUUID(),kind:'label-attached',playerId,onIce,...m,confirmedAt:Date.now()});}))throw Error($('#toiMessage314').textContent);
 follow416=trial;followTime416=m.videoTime;attachDialog416.close();renderFollow416();$('#followStatus416').textContent='Label attached. Add another player or start following.';
 }catch(e){$('#attachStatus416').textContent=e.message;}};
$('#startFollow416').onclick=()=>{try{const m=media314();if(!follow416?.tracks.length||follow416.tracks.some(t=>t.status!=='following'))throw Error('Reconnect all labels first.');if(Math.abs(follow416.time-m.videoTime)>.15)throw Error('The frame changed. Reconnect labels before starting.');if(JSON.stringify(follow416.zone)!==JSON.stringify(ensure314().zones[m.clipId]))throw Error('The bench line changed. Reconnect the labels.');stop314();follow416.time=m.videoTime;following416=true;followTime416=m.videoTime;$('#followStatus416').textContent='Following · bench crossings record shifts';renderFollow416();openTool416(null);v314.play().catch(e=>pauseFollow416(e.message));}catch(e){$('#followStatus416').textContent=e.message;}};
$('#stopFollow416').onclick=()=>pauseFollow416('Following paused. Resume from this frame.');
const oldAuto416=$('#autoStart314').onclick;$('#autoStart314').onclick=()=>{if(follow416)pauseFollow416('Unlabeled review selected. Reconnect to follow again.',true);oldAuto416();};
const labelCanvas416=document.createElement('canvas');labelCanvas416.id='labelCanvas416';wrap31.appendChild(labelCanvas416);
function paintFollow416(){
 const w=v314.videoWidth,h=v314.videoHeight;if(!w||v314.readyState<2){labelCanvas416.style.display='none';return;}
 const scale=(document.body.classList.contains('film-fill31')?Math.max:Math.min)(v314.clientWidth/w,v314.clientHeight/h);
 Object.assign(labelCanvas416.style,{display:'block',left:`${v314.offsetLeft+(v314.clientWidth-w*scale)/2}px`,top:`${v314.offsetTop+(v314.clientHeight-h*scale)/2}px`,width:`${w*scale}px`,height:`${h*scale}px`});
 labelCanvas416.width=960;labelCanvas416.height=Math.round(960*h/w);
 const c=labelCanvas416.getContext('2d'),ch=labelCanvas416.height;
 for(const t of follow416?.tracks||[]){
  if(t.status!=='following')continue;
  const p=state.players.find(p=>p.id===t.playerId),b=t.box;
  // Anchor near the top center of the tracked player; tracking geometry stays private.
  const hx=(b.x+b.width/2)*960,hy=(b.y+b.height*.08)*ch;
  c.font='bold 13px sans-serif';
  let text=`#${p?.number||''} ${p?.name||''}`.trim();
  while(c.measureText(text).width>210&&text.length>4)text=text.slice(0,-2).trimEnd()+'…';
  const fw=c.measureText(text).width+22,fh=24,x=Math.max(3,Math.min(957-fw,hx-fw/2));
  const above=hy>=fh+20,y=above?hy-fh-16:Math.min(ch-fh-3,hy+16);
  c.lineWidth=2;c.strokeStyle='#77f3c7';c.lineCap='round';
  c.beginPath();c.moveTo(hx,hy);c.lineTo(Math.max(x+7,Math.min(x+fw-7,hx)),above?y+fh:y);c.stroke();
  c.beginPath();c.arc(hx,hy,3,0,Math.PI*2);c.fillStyle='#aaffdf';c.fill();
  // A small pennant replaces the full player rectangle.
  c.beginPath();c.moveTo(x+5,y);c.lineTo(x+fw,y);c.lineTo(x+fw-5,y+fh/2);c.lineTo(x+fw,y+fh);c.lineTo(x+5,y+fh);c.quadraticCurveTo(x,y+fh,x,y+fh-5);c.lineTo(x,y+5);c.quadraticCurveTo(x,y,x+5,y);c.closePath();
  c.fillStyle='rgba(7,25,18,.94)';c.fill();c.lineWidth=1;c.strokeStyle='#77f3c7';c.stroke();
  c.fillStyle='#effff9';c.textBaseline='middle';c.fillText(text,x+8,y+fh/2);
 }
}
function loopFollow416(){try{const context=JSON.stringify([state.currentGameId,currentClipId()]);if(context!==followContext416&&follow416){following416=false;follow416=null;followContext416=context;renderFollow416();}
 if(following416&&!v314.paused&&!v314.seeking&&v314.readyState>=2&&v314.currentTime-followTime416>=.1){if(follow416.tracks.some(t=>t.onIce!==!!state.players.find(p=>p.id===t.playerId)?.shifts?.some(s=>!s.ended)))throw Error('On-ice selections changed. Reconnect labels.');followTime416=v314.currentTime;const result=follow416.frame(frame416(),followTime416);if(result.lost.length){const reason=follow416.tracks.find(t=>t.status==='lost')?.reason||'Reconnect labels.';pauseFollow416(reason,true);openTool416('follow');}else if(result.events.length){const clipId=currentClipId();if(!commit314(g=>{for(const event of result.events){const id=crypto.randomUUID();T314.transition(g,{...event,clipId,source:'auto',detectionId:id});T314.data(g).groundTruth.push({...event,id,clipId,kind:'followed-crossing',confirmedAt:Date.now()});}})){pauseFollow416('Shift needs review. Reconnect after correcting it.',true);openTool416('review');}}}paintFollow416();}catch(e){pauseFollow416(e.message,true);}requestAnimationFrame(loopFollow416);}
v314.addEventListener('play',()=>{if(follow416&&!following416){follow416.invalidate('Video played without following. Reconnect labels.');renderFollow416();}});
for(const event of ['seeking','emptied','ended'])v314.addEventListener(event,()=>{if(follow416)pauseFollow416('Video position changed. Reconnect labels.',true);});
for(const id of ['drawZone314','resetZone314','saveZone314']){const prior=$('#'+id).onclick;$('#'+id).onclick=(...args)=>{if(follow416){pauseFollow416('Bench line changed. Reconnect labels.',true);follow416=null;}return prior(...args);};}
// Keep legacy shortcuts directed to the corresponding single drawer.
$('#filmAutoZone31').onclick=()=>openTool416('bench');$('#filmAutoReview31').onclick=()=>openTool416('review');
document.addEventListener('keydown',e=>{if(attachDialog416.open&&e.key!=='Escape')e.stopImmediatePropagation();},true);
openTool416(null);refreshWhistle416();renderFollow416();requestAnimationFrame(loopFollow416);

