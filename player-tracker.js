/* Conservative, local template following. Names are manually bound, never inferred. */
(function(root){
'use strict';
const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y))/Math.min(a.width*a.height,b.width*b.height);
function patch(frame,b){const out=[];for(let y=0;y<16;y++)for(let x=0;x<10;x++){const px=Math.min(frame.width-1,Math.max(0,Math.floor((b.x+(x+.5)/10*b.width)*frame.width))),py=Math.min(frame.height-1,Math.max(0,Math.floor((b.y+(y+.5)/16*b.height)*frame.height))),i=(py*frame.width+px)*4;out.push(frame.data[i]/255,frame.data[i+1]/255,frame.data[i+2]/255);}return out;}
const difference=(a,b)=>a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/a.length;
const detail=a=>{const mean=a.reduce((n,v)=>n+v,0)/a.length;return Math.sqrt(a.reduce((n,v)=>n+(v-mean)**2,0)/a.length);};
function boundary(zone,b){const l=zone.line||(zone.axis==='x'?{x1:zone.boundary,y1:zone.y,x2:zone.boundary,y2:zone.y+zone.height}:{x1:zone.x,y1:zone.boundary,x2:zone.x+zone.width,y2:zone.boundary});const dx=l.x2-l.x1,dy=l.y2-l.y1,len=Math.hypot(dx,dy),x=b.x+b.width/2-l.x1,y=b.y+b.height-l.y1;const distance=(dx*y-dy*x)/len*(zone.axis==='x'?-1:1)*(zone.benchLow?1:-1);return {side:Math.abs(distance)<.008?0:Math.sign(distance),projection:(x*dx+y*dy)/(len*len)};}
class Tracker{
 constructor(zone){this.zone=zone;this.tracks=[];this.time=null;this.scene=null;this.sequence=0;}
 attach(frame,{playerId,box,onIce},time){
  if(!playerId||typeof onIce!=='boolean'||!box||!['x','y','width','height'].every(k=>Number.isFinite(box[k]))||box.x<0||box.y<0||box.width*frame.width<7||box.height*frame.height<12||box.x+box.width>1||box.y+box.height>1)throw Error('Draw a clear, tight player box within the frame.');
  if(this.tracks.some(t=>t.playerId!==playerId&&t.status==='following'&&overlap(t.box,box)>.15))throw Error('These boxes overlap. Choose a clearer frame.');
  const template=patch(frame,box);if(detail(template)<.07)throw Error('Player detail is too faint. Use a clearer frame.');
  const t={playerId,box:{...box},template,anchor:template.slice(),status:'following',onIce,side:boundary(this.zone,box).side,pending:0,hits:0,reason:''};
  this.tracks=this.tracks.filter(t=>t.playerId!==playerId);this.tracks.push(t);this.time=time;this.scene=patch(frame,{x:0,y:0,width:1,height:1});return t;
 }
 invalidate(reason){for(const t of this.tracks){t.status='lost';t.reason=reason;}return {events:[],lost:this.tracks.map(t=>t.playerId)};}
 frame(frame,time){
  if(this.time==null){this.time=time;return {events:[],lost:[]};}if(time===this.time)return {events:[],lost:[]};
  if(time<this.time||time-this.time>.5)return this.invalidate('Video jumped. Reconnect labels.');
  const scene=patch(frame,{x:0,y:0,width:1,height:1});if(this.scene&&difference(scene,this.scene)>.12)return this.invalidate('Camera view changed. Check the bench line and reconnect.');
  this.time=time;this.scene=scene;
  const proposed=this.tracks.filter(t=>t.status==='following').map(t=>{
   const candidates=[],radius=12,step=2;
   for(const scale of [1,.9,1.1])for(let dy=-radius;dy<=radius;dy+=step)for(let dx=-radius;dx<=radius;dx+=step){const b={x:t.box.x+dx/frame.width+(1-scale)*t.box.width/2,y:t.box.y+dy/frame.height+(1-scale)*t.box.height/2,width:t.box.width*scale,height:t.box.height*scale};if(b.x<0||b.y<0||b.x+b.width>1||b.y+b.height>1)continue;const feature=patch(frame,b),cost=.7*difference(feature,t.template)+.3*difference(feature,t.anchor);candidates.push({box:b,feature,cost,dx,dy});}
   candidates.sort((a,b)=>a.cost-b.cost);const best=candidates[0],second=best&&candidates.find(c=>Math.hypot((c.box.x-best.box.x)/t.box.width,(c.box.y-best.box.y)/t.box.height)>.6);
   const reason=!best||best.cost>.14?'Player appearance lost':second&&second.cost-best.cost<.012?'Similar players nearby':Math.abs(best.dx)>=radius||Math.abs(best.dy)>=radius?'Player moved beyond the search area':'';
   return {t,best,reason};
  });
  // Resolve conflicts before any shift is emitted; never transfer an identity.
  for(let i=0;i<proposed.length;i++)for(let j=i+1;j<proposed.length;j++){const a=proposed[i],b=proposed[j];if(a.best&&b.best&&(overlap(a.best.box,b.best.box)>.15||overlap(a.best.box,b.t.box)>.35||overlap(b.best.box,a.t.box)>.35)){a.reason=b.reason='Players overlap. Reconnect in a clear frame.';}}
  const events=[],lost=[];
  for(const {t,best,reason} of proposed){if(reason){t.status='lost';t.reason=reason;lost.push(t.playerId);continue;}t.box=best.box;t.template=best.feature;t.hits++;const b=boundary(this.zone,t.box);if(!b.side)continue;if(!t.side){t.side=b.side;continue;}if(b.side===t.side){t.pending=0;continue;}t.pending++;if(t.pending<2)continue;
   const direction=b.side>0?'ON':'OFF';if(b.projection<0||b.projection>1||t.hits<3||t.onIce===(direction==='ON')){t.status='lost';t.reason='Crossing does not match the confirmed state. Review this player.';lost.push(t.playerId);continue;}
   t.side=b.side;t.pending=0;t.onIce=direction==='ON';events.push({playerId:t.playerId,direction,videoTime:time,confidence:Math.max(0,1-best.cost/.2),sequence:++this.sequence});
  }
  // Pause the entire session at the last reviewed frame if any identity is uncertain.
  if(lost.length)return {events:[],lost};return {events,lost};
 }
}
const api={Tracker,boundary,overlap};if(typeof module==='object'&&module.exports)module.exports=api;else root.FoxesPlayerTracker=api;
})(globalThis);
