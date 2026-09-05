/* Video-time tracking; legacy shifts remain in the existing per-player arrays. */
(function(root){
'use strict';
const copy=x=>JSON.parse(JSON.stringify(x));
const valid=x=>x!==null&&x!==''&&Number.isFinite(Number(x));
const time=x=>{if(!valid(x)||Number(x)<0)throw Error('Enter a non-negative video timestamp.');return Number(x);};
const uid=()=>globalThis.crypto.randomUUID();
function data(g){const d=g.toi314||(g.toi314={});d.zones=d.zones||{};d.candidates=d.candidates||[];d.groundTruth=d.groundTruth||[];return d;}
function saveZone(g,clipId,z){
 if(!g.id||!clipId||!(g.filmClips||[]).some(c=>c.id===clipId))throw Error('Select a saved game and load its video clip first.');
 if(!z||!['x','y','width','height','boundary'].every(k=>Number.isFinite(z[k]))||!['x','y'].includes(z.axis)||typeof z.benchLow!=='boolean'||z.x<0||z.y<0||z.width<.05||z.height<.05||z.x+z.width>1.000001||z.y+z.height>1.000001||z.boundary<z[z.axis]||z.boundary>z[z.axis]+(z.axis==='x'?z.width:z.height))throw Error('Draw a valid bench region at least 5% of the video in each dimension, with its boundary inside the region.');
 data(g).zones[clipId]=copy(z);
}
function clock(g,clip,t){
 const pts=(g.syncPoints||[]).filter(p=>p.clipId===clip&&valid(p.videoTime)).sort((a,b)=>a.videoTime-b.videoTime);
 const a=pts.filter(p=>p.videoTime<=t).at(-1)||pts[0];if(!a)return null;
 // Anchor extrapolation is an estimate: stoppages require additional anchors.
 return {period:String(a.period),remainingSec:Math.max(0,Number(a.remainingSec)-(t-a.videoTime)),anchorVideoTime:a.videoTime};
}
function view(s,p,g){
 const native=s.toiSchema===314,on=native?s.videoOnTime:s.startVideoTime,off=native?s.videoOffTime:s.endVideoTime;
 const known=valid(on)&&!!s.startClipId;
 return {...s,shiftId:s.shiftId||s.id,gameId:g.id,playerId:p.id,playerName:p.name,jerseyNumber:p.number,position:p.pos,
  videoOnTime:known?Number(on):null,videoOffTime:s.ended&&known&&valid(off)?Number(off):null,
  duration:native?(s.ended?Math.max(0,Number(off)-Number(on)):0):Math.max(0,Number(s.endElapsed||0)-Number(s.startElapsed||0)),
  source:s.source||'manual',confirmed:s.confirmed!==false,legacy:!native};
}
function shifts(g){return(g.players||[]).flatMap(p=>(p.shifts||[]).map(s=>view(s,p,g)));}
function duration(s,t,clip){return s.ended?s.duration:(!s.legacy&&s.startClipId===clip&&valid(t)?Math.max(0,t-s.videoOnTime):0);}
function summary(g,t,clip,confirmedOnly=false){return(g.players||[]).map(p=>{
 const rows=shifts(g).filter(s=>s.playerId===p.id&&(!confirmedOnly||s.confirmed));
 const done=rows.filter(s=>s.ended),values=done.map(s=>s.duration),total=rows.reduce((n,s)=>n+duration(s,t,clip),0),byPeriod={};
 done.forEach(s=>{if(s.gameClockOn?.period){const k=s.gameClockOn.period;byPeriod[k]=(byPeriod[k]||0)+s.duration;}});
 return {player:p,total,count:done.length,average:values.length?values.reduce((a,b)=>a+b,0)/values.length:0,longest:Math.max(0,...values),shortest:values.length?Math.min(...values):0,byPeriod};
}).sort((a,b)=>b.total-a.total);}
function transition(g,{playerId,direction,videoTime,clipId,source='manual',confidence=null,detectionId=null}){
 const p=g.players.find(p=>p.id===playerId);if(!p)throw Error('Assign a roster player first.');
 const t=time(videoTime);if(!clipId)throw Error('Load a video clip first.');
 const clip=(g.filmClips||[]).find(c=>c.id===clipId);if(clip?.duration&&t>clip.duration)throw Error('Timestamp exceeds the clip duration.');
 const active=(p.shifts||[]).filter(s=>!s.ended);if(active.length>1)throw Error('Multiple open shifts need correction before tracking this player.');
 const now=Date.now();p.shifts=p.shifts||[];
 if(direction==='ON'){
  if(active.length)throw Error('Duplicate ON: this player already has an open shift.');
  if(p.shifts.some(s=>s.toiSchema===314&&s.startClipId===clipId&&s.ended&&t<s.videoOffTime))throw Error('ON precedes a recorded shift end. Correct the shift log first.');
  const id=uid(),c=clock(g,clipId,t);
  p.shifts.push({id,shiftId:id,toiSchema:314,gameId:g.id,playerId:p.id,playerName:p.name,jerseyNumber:p.number,position:p.pos,
   period:c?.period||null,strength:g.strength||'EV',videoOnTime:t,videoOffTime:null,gameClockOn:c,gameClockOff:null,
   startVideoTime:t,endVideoTime:null,startClipId:clipId,endClipId:null,startElapsed:t,endElapsed:null,
   startClock:c?.remainingSec??t,startClockType:c?'synced-game':'video',endClock:null,ended:false,duration:0,
   source,confidence,confirmed:true,detectionIds:detectionId?[detectionId]:[],createdAt:now,updatedAt:now});
 }else if(direction==='OFF'){
  const s=active[0];if(!s)throw Error('OFF without ON: inspect the video and record/correct the missing start first.');
  if(s.toiSchema!==314)throw Error('This legacy open shift needs explicit timestamp correction in the Shift Log.');
  if(s.startClipId!==clipId)throw Error('This shift starts in another clip. Finish it in that clip; do not join unknown video gaps.');
  if(t<s.videoOnTime)throw Error('OFF precedes ON. Correct the timestamp or seek back to the shift.');
  const c=clock(g,clipId,t);Object.assign(s,{videoOffTime:t,endVideoTime:t,endClipId:clipId,endElapsed:t,endClock:c?.remainingSec??t,
   gameClockOff:c,duration:t-s.videoOnTime,ended:true,updatedAt:now});if(detectionId)s.detectionIds.push(detectionId);
  if(source==='auto'){s.source='auto';s.confidence=Math.min(s.confidence??confidence,confidence);}
 }else throw Error('Choose ON or OFF.');
 p.active=p.shifts.some(s=>!s.ended);data(g).finalizedAt=null;
}
function edit(g,{shiftId,playerId,on,off,clipId}){
 const owner=g.players.find(p=>(p.shifts||[]).some(s=>(s.shiftId||s.id)===shiftId));if(!owner)throw Error('Shift not found.');
 const old=owner.shifts.find(s=>(s.shiftId||s.id)===shiftId),p=g.players.find(p=>p.id===playerId);if(!p)throw Error('Choose a roster player.');
 const start=time(on),end=time(off);if(end<start)throw Error('OFF must be at or after ON.');if(!clipId)throw Error('Choose the video clip for these timestamps.');
 if((p.shifts||[]).some(s=>s!==old&&s.toiSchema===314&&s.startClipId===clipId&&start<(s.ended?s.videoOffTime:Infinity)&&end>s.videoOnTime))throw Error('This correction overlaps another shift for this player.');
 const c=clock(g,clipId,start),d=clock(g,clipId,end),changed={...old,legacyOriginal:old.legacyOriginal||(old.toiSchema!==314?copy(old):undefined),
  toiSchema:314,shiftId,gameId:g.id,playerId:p.id,playerName:p.name,jerseyNumber:p.number,position:p.pos,
  videoOnTime:start,videoOffTime:end,startVideoTime:start,endVideoTime:end,startElapsed:start,endElapsed:end,
  startClipId:clipId,endClipId:clipId,startClock:c?.remainingSec??start,endClock:d?.remainingSec??end,startClockType:c?'synced-game':'video',
  gameClockOn:c,gameClockOff:d,period:c?.period||null,duration:end-start,ended:true,source:'corrected',confirmed:true,updatedAt:Date.now()};
 owner.shifts=owner.shifts.filter(s=>s!==old);p.shifts=p.shifts||[];p.shifts.push(changed);owner.active=owner.shifts.some(s=>!s.ended);p.active=p.shifts.some(s=>!s.ended);
 data(g).groundTruth.push({id:uid(),kind:'shift-correction',shiftId,playerId,clipId,on:start,off:end,confirmedAt:Date.now()});data(g).finalizedAt=null;
}
function remove(g,id){const removed=shifts(g).find(s=>s.shiftId===id);for(const p of g.players){p.shifts=(p.shifts||[]).filter(s=>(s.shiftId||s.id)!==id);p.active=p.shifts.some(s=>!s.ended);}if(removed)data(g).groundTruth.push({id:uid(),kind:'shift-deleted',shiftId:id,previous:removed,confirmedAt:Date.now()});data(g).finalizedAt=null;}
function candidate(g,c){
 const d=data(g);if(d.candidates.some(x=>x.clipId===c.clipId&&x.direction===c.direction&&Math.abs(x.videoTime-c.videoTime)<.6))return;
 d.candidates.push({...c,id:c.id||uid(),playerId:null,status:'review',identity:'UNKNOWN PLAYER',createdAt:Date.now()});d.finalizedAt=null;
}
function review(g,{id,action,playerId,videoTime,direction}){
 const c=data(g).candidates.find(x=>x.id===id);if(!c||c.status!=='review')throw Error('Detection is no longer awaiting review.');
 if(action==='reject'){c.status='rejected';c.reviewedAt=Date.now();return;}
 const t=time(videoTime);transition(g,{playerId,direction,videoTime:t,clipId:c.clipId,source:'auto',confidence:c.confidence,detectionId:c.id});
 Object.assign(c,{status:'confirmed',assignedPlayerId:playerId,correctedVideoTime:t,correctedDirection:direction,reviewedAt:Date.now()});
 data(g).groundTruth.push({id:uid(),detectionId:c.id,clipId:c.clipId,videoTime:t,direction,playerId,original:copy(c),confirmedAt:Date.now()});
}
function apply(g,fn){const out=copy(g);fn(out);return out;}
const api={saveZone,data,clock,view,shifts,duration,summary,transition,edit,remove,candidate,review,apply};
if(typeof module==='object'&&module.exports)module.exports=api;else root.FoxesTOI=api;
})(globalThis);
