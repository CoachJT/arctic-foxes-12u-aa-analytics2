/* Detection association with manually bound identities and uncertain-gap guards. */
(function(root){
'use strict';
const base=typeof module==='object'&&module.exports?require('./player-tracker'):root.FoxesPlayerTracker;
const copy=x=>structuredClone(x),center=b=>({x:b.x+b.width/2,y:b.y+b.height/2});
const appearance=(a,b)=>!a?.length||a.length!==b?.length?1:a.reduce((s,v,i)=>s+Math.abs(v-b[i]),0)/2;
function iou(a,b){const area=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));return area/(a.width*a.height+b.width*b.height-area)||0;}

// Compare complete, one-to-one assignments. A missing match is always permitted.
function associate(proposals){
 const solve=(excluded=null)=>{let best={cost:Infinity,rows:[]};
  function visit(i,cost,rows){if(cost>=best.cost)return;if(i===proposals.length){best={cost,rows:rows.slice()};return;}
   for(const candidate of [...proposals[i].scores.slice(0,4),null]){
    if(excluded&&excluded.i===i&&candidate?.index===excluded.index)continue;
    if(candidate&&rows.some(r=>r&&(r.index===candidate.index||iou(r.d.box,candidate.d.box)>.3)))continue;
    rows.push(candidate);visit(i+1,cost+(candidate?candidate.cost:.9),rows);rows.pop();
   }
  }visit(0,0,[]);return best;
 };
 // Bound work if a caller supplies more identities than an on-ice unit.
 if(proposals.length>6)return proposals.map(p=>({...p,reason:'Track up to six players at once'}));
 const best=solve();return proposals.map((p,i)=>{const match=best.rows[i];
  if(!match)return {...p,reason:'Player temporarily hidden'};
  const alternative=solve({i,index:match.index});
  return {...p,best:match,reason:alternative.cost-best.cost<.10?'Identity uncertain while players are close':''};
 });
}

function kitConflict(anchor,candidate){
 if(!anchor||!candidate)return false;
 const total=a=>a.bins.reduce((s,v)=>s+v,0),a=total(anchor),b=total(candidate);
 if(a<8||a/anchor.pixels<.025||b<4||b/candidate.pixels<.06)return false;
 const top=anchor.bins.indexOf(Math.max(...anchor.bins));
 const compatible=[(top+11)%12,top,(top+1)%12].reduce((sum,i)=>sum+candidate.bins[i],0)/b;
 const strength=[(top+11)%12,top,(top+1)%12].reduce((sum,i)=>sum+anchor.bins[i],0)/a;
 return strength>.65&&compatible<.15;
}
function kitSupportsRecovery(anchor,candidate){
 if(!anchor)return true;
 const total=anchor.bins.reduce((s,v)=>s+v,0),top=anchor.bins.indexOf(Math.max(...anchor.bins)),indices=[(top+11)%12,top,(top+1)%12];
 if(total<8||total/anchor.pixels<.025||indices.reduce((s,i)=>s+anchor.bins[i],0)/total<=.65)return true;
 if(!candidate)return false;
 const count=indices.reduce((s,i)=>s+candidate.bins[i],0),all=candidate.bins.reduce((s,v)=>s+v,0);
 return count>=3&&count/candidate.pixels>=.015&&count/Math.max(1,all)>=.35;
}
class DetectionTracker{
 constructor(zone){this.zone=copy(zone);this.tracks=[];this.time=null;this.sequence=0;this.scene=null;}
 attach(detections,{playerId,box,onIce},time){
  if(!playerId||typeof onIce!=='boolean'||!box||!['x','y','width','height'].every(k=>Number.isFinite(box[k]))||box.width<=0||box.height<=0)throw Error('Select a player and confirm their state.');
  const matches=detections.filter(d=>d.score==null||d.score>=.2).map(d=>({d,score:iou(d.box,box)})).filter(d=>d.score>.18).sort((a,b)=>b.score-a.score);
  if(!matches.length)throw Error('No clear player detected in this selection. Try a clearer frame.');
  if(matches[1]&&matches[0].score-matches[1].score<.15)throw Error('Two players share that selection. Choose a clearer frame.');
  const d=matches[0].d;if(this.tracks.some(t=>t.playerId!==playerId&&iou(t.box,d.box)>.4))throw Error('That skater already has a label.');
  const t={playerId,box:copy(d.box),signature:copy(d.signature),anchor:copy(d.signature),kit:copy(d.kit),onIce,status:'following',velocity:{x:0,y:0},lastSeen:time,lastBox:copy(d.box),side:base.boundary(this.zone,d.box).side,pending:0,hits:0,gap:false,reason:''};
  this.tracks=this.tracks.filter(t=>t.playerId!==playerId);this.tracks.push(t);this.time=time;this.scene=copy(detections.scene||null);return t;
 }
 invalidate(reason){for(const t of this.tracks){t.status='lost';t.reason=reason;}return {events:[],lost:this.tracks.map(t=>t.playerId),recovering:[]};}
 frame(detections,time){
  if(this.time==null){this.time=time;return {events:[],lost:[],recovering:[]};}
  const dt=time-this.time;if(dt===0)return {events:[],lost:[],recovering:[]};if(dt<0||dt>.8)return this.invalidate('Video skipped too far. Reconnect labels.');this.time=time;
  if(this.scene&&detections.scene&&this.scene.reduce((sum,v,i)=>sum+Math.abs(v-detections.scene[i]),0)/this.scene.length>.10)return this.invalidate('Camera view changed. Check the bench line and reconnect.');
  this.scene=copy(detections.scene||null);
  const proposals=associate(this.tracks.filter(t=>t.status!=='lost').map(t=>{
   const elapsed=time-(t.hintTime??t.lastSeen),c=center(t.hintBox??t.lastBox),predicted={x:c.x+t.velocity.x*elapsed,y:c.y+t.velocity.y*elapsed},gate=Math.max(.025,t.lastBox.height*.7)+Math.min(.06,elapsed*.035);
   const scores=detections.map((d,index)=>{const q=center(d.box),distance=Math.hypot(q.x-predicted.x,q.y-predicted.y),colour=.65*appearance(t.signature,d.signature)+.35*appearance(t.anchor,d.signature),scale=Math.abs(Math.log(d.box.height/t.lastBox.height));return {d,index,distance,colour,scale,cost:.55*distance/gate+.35*colour+.1*scale};}).filter(s=>!kitConflict(t.kit,s.d.kit)&&(!t.gap||kitSupportsRecovery(t.kit,s.d.kit))&&s.distance<gate&&s.colour<.65&&s.scale<.85).sort((a,b)=>a.cost-b.cost);
   const strong=scores.filter(s=>s.d.score==null||s.d.score>=.2);
   // Weak observations can guide a short recovery but never claim an identity.
   t.nextHint=null;if(!strong.length){const weak=scores.filter(s=>s.cost<.25&&s.colour<.3&&kitSupportsRecovery(t.kit,s.d.kit));if(weak.length===1||weak.length>1&&weak[1].cost-weak[0].cost>=.10)t.nextHint=weak[0]?.d.box;}
   return {t,scores:strong};
  }));
  const events=[],lost=[],recovering=[];
  for(const {t,best,reason} of proposals){
   if(reason){if(t.nextHint){t.hintBox=copy(t.nextHint);t.hintTime=time;}t.status=time-t.lastSeen>1?'lost':'recovering';t.reason=reason;t.gap=true;t.pending=0;(t.status==='lost'?lost:recovering).push(t.playerId);continue;}
   const b=best.d.box,side=base.boundary(this.zone,b),oldCenter=center(t.lastBox),newCenter=center(b),elapsed=time-t.lastSeen;
   if(t.gap&&side.side&&t.side&&side.side!==t.side){t.status='lost';t.reason='A bench crossing may have happened while hidden. Review this shift.';lost.push(t.playerId);continue;}
   t.velocity={x:.5*t.velocity.x+.5*(newCenter.x-oldCenter.x)/elapsed,y:.5*t.velocity.y+.5*(newCenter.y-oldCenter.y)/elapsed};
   delete t.hintBox;delete t.hintTime;delete t.nextHint;t.lastSeen=time;t.lastBox=copy(b);t.box=copy(b);t.status='following';t.reason='';t.hits++;t.gap=false;
   // Adapt slowly and only from a distinct match, preserving the original reference.
   if(best.cost<.3)t.signature=t.signature.map((v,i)=>.95*v+.05*best.d.signature[i]);
   if(!side.side)continue;if(!t.side){t.side=side.side;continue;}if(side.side===t.side){t.pending=0;continue;}t.pending++;if(t.pending<2)continue;
   const direction=side.side>0?'ON':'OFF';
   if(side.projection<0||side.projection>1||t.hits<3||t.onIce===(direction==='ON')){t.status='lost';t.reason='Crossing needs review before changing ice time.';lost.push(t.playerId);continue;}
   t.side=side.side;t.pending=0;t.onIce=direction==='ON';events.push({playerId:t.playerId,direction,videoTime:time,confidence:Math.max(0,1-best.cost),sequence:++this.sequence});
  }
  return {events:lost.length?[]:events,lost,recovering};
 }
}
const api={DetectionTracker,appearance,iou,associate,kitConflict,kitSupportsRecovery};if(typeof module==='object'&&module.exports)module.exports=api;else root.FoxesPlayerFollow=api;
})(globalThis);
