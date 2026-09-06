/* Review-only skips retain the original video clock and saved shift timestamps. */
(function(root){
'use strict';
function nextBreakEnd(spans,time,duration,blocked=false){
 if(blocked||!Number.isFinite(time)||!Number.isFinite(duration)||duration<=0)return null;
 const valid=(spans||[]).filter(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.start>=0&&s.end>s.start&&s.start<duration).map(s=>({start:s.start,end:Math.min(s.end,duration)})).sort((a,b)=>a.start-b.start);
 let end=null;for(const s of valid){if(end==null){if(time>=s.start&&time<s.end-.04)end=s.end;}else if(s.start<=end)end=Math.max(end,s.end);else break;}return end;
}
function reviewRange(trim,duration){if(!Number.isFinite(duration)||duration<=0)return null;const start=trim?.start??0,end=trim?.end??duration;return Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start&&end<=duration?{start,end}:{start:0,end:duration};}
const api={nextBreakEnd,reviewRange};if(typeof module==='object'&&module.exports){module.exports=api;return;}root.FoxesFilmBreaks=api;
const panel=document.createElement('section');panel.innerHTML='<h3>Whistles & breaks</h3><p>Tap Whistle when play stops, then Play resumes at the restart. Ice time excludes that break.</p><label><input type="checkbox" id="skipBreaks416"> Skip marked breaks during review</label><p id="breaksStatus416" role="status"></p>';
viewPanel416.appendChild(panel);
const trims=document.createElement('section');trims.innerHTML='<h3>Trim review</h3><p>Pause at the first useful moment or the end of play, then set the trim. The original video stays intact.</p><button id="trimStart416">Start here</button> <button id="trimEnd416">End here</button> <button id="trimReset416">Reset trim</button><p id="trimStatus416" role="status"></p>';viewPanel416.appendChild(trims);
const editPanel=document.createElement('section');editPanel.append(trims,panel);editPanel.hidden=true;side316.appendChild(editPanel);toolNodes416.push(editPanel);
const editButton=document.createElement('button');editButton.textContent='Trim & breaks';editButton.dataset.tool416='edit';quick416.insertBefore(editButton,quick416.querySelector('[data-tool416="more"]'));
const priorOpen=openTool416;openTool416=function(name){if(name!=='edit'){priorOpen(name);return;}priorOpen('more');for(const node of toolNodes416)node.hidden=node!==editPanel;selectedTool416='edit';document.getElementById('drawerTitle416').textContent='Trim & breaks';quick416.querySelectorAll('[data-tool416]').forEach(b=>b.setAttribute('aria-pressed',String(b===editButton)));};editButton.onclick=()=>openTool416(selectedTool416==='edit'?null:'edit');
const toggle=document.getElementById('skipBreaks416'),status=document.getElementById('breaksStatus416');toggle.checked=localStorage.getItem('foxes-skip-breaks')==='1';
toggle.onchange=()=>{localStorage.setItem('foxes-skip-breaks',toggle.checked?'1':'0');refresh();};
function spans(){return ensure314().whistles?.[currentClipId()]||[];}
function blocked(){return following416||analyzing314||!!ensure314().seekReview||T314.shifts(game314()).some(s=>!s.ended);}
const stamp=t=>`${Math.floor(t/60)}:${(t%60).toFixed(1).padStart(4,'0')}`;
function refresh(){const n=spans().filter(s=>Number.isFinite(s.end)&&s.end>s.start).length;status.textContent=toggle.checked&&blocked()?'Finish recording shifts and pause tracking before skipping breaks.':n?`${n} marked break${n===1?'':'s'} · ${toggle.checked?'Skipping during review':'Full video playback'}`:'No completed breaks marked yet.';const range=reviewRange(activeFilmClip()?.reviewTrim,v314.duration);document.getElementById('trimStatus416').textContent=range?`Review: ${stamp(range.start)}–${stamp(range.end)} · Original video times`:'Load a clip to set its trim.';}
function move(time,pause=false){
 // Review seeks must discard old visual labels; no saved statistics are edited.
 followEpoch416++;follow416=null;renderFollow416();if(pause)v314.pause();v314.currentTime=time;
}
function skip(){if(v314.paused||v314.seeking||blocked())return;const range=reviewRange(activeFilmClip()?.reviewTrim,v314.duration);if(!range)return;if(v314.currentTime<range.start){move(range.start);return;}if(v314.currentTime>=range.end){move(range.end,true);return;}if(!toggle.checked)return;const end=nextBreakEnd(spans(),v314.currentTime,range.end);if(end!=null){move(end,end>=range.end);status.textContent='Skipped break · original video time preserved.';}}
for(const [id,kind] of [['trimStart416','start'],['trimEnd416','end'],['trimReset416','reset']])document.getElementById(id).onclick=()=>{try{if(blocked())throw Error('Finish recording shifts and pause tracking before trimming.');const clip=activeFilmClip(),range=reviewRange(clip?.reviewTrim,v314.duration);if(!clip||!range)throw Error('Load a playable clip first.');if(kind==='reset')delete clip.reviewTrim;else{const next={...range,[kind]:v314.currentTime};if(next.start<0||next.end>v314.duration||next.end-next.start<.1)throw Error('The end must be after the start.');clip.reviewTrim=next;}save();refresh();}catch(e){document.getElementById('trimStatus416').textContent=e.message;}};
v314.addEventListener('timeupdate',skip);v314.addEventListener('play',()=>{refresh();if(blocked())return;const range=reviewRange(activeFilmClip()?.reviewTrim,v314.duration);if(range&&v314.currentTime>=range.end)move(range.start);else skip();});v314.addEventListener('loadedmetadata',refresh);
const previous=refreshWhistle416;refreshWhistle416=function(){previous();document.getElementById('whistle416').textContent=document.getElementById('whistle416').getAttribute('aria-pressed')==='true'?'Play resumes':'Whistle';refresh();};refreshWhistle416();
})(globalThis);
