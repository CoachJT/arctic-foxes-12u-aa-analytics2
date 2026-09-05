/* Shared elapsed playing time. Video timestamps remain unchanged. */
(function(root){
'use strict';
function seconds(s,now){
 if(s.toiSchema!==314)return Math.max(0,Number(s.durationSec??((s.endElapsed??s.startElapsed??0)-(s.startElapsed??0)))||0);
 const start=Number(s.videoOnTime),end=Number(s.ended?s.videoOffTime:(now??start));
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return 0;
 const spans=(s.iceTimePauses||[]).map(p=>[Math.max(start,p.start),Math.min(end,p.end??end)]).filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>a).sort((a,b)=>a[0]-b[0]);
 let excluded=0,last=start;
 for(const [a,b] of spans){excluded+=Math.max(0,b-Math.max(a,last));last=Math.max(last,b);}
 return Math.max(0,end-start-excluded);
}
const api={seconds};if(typeof module==='object'&&module.exports)module.exports=api;else root.FoxesIceTime=api;
})(globalThis);
