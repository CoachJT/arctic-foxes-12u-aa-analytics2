/* Local frame differencing + connected components + nearest-centroid trajectories.
   Confidence is a heuristic evidence score, not a calibrated probability. */
(function(root){'use strict';
class Detector{
 constructor(zone){if(!zone||!['x','y'].includes(zone.axis)||!['x','y','width','height','boundary'].every(k=>Number.isFinite(zone[k]))||zone.x<0||zone.y<0||zone.width<=0||zone.height<=0||zone.x+zone.width>1.001||zone.y+zone.height>1.001||zone.boundary<0||zone.boundary>1)throw Error('Invalid bench zone. Draw and save it again.');this.zone=zone;this.reset();}
 reset(){this.previous=null;this.tracks=[];this.serial=0;this.lastTime=null;this.regions=[];this.events=[];}
 frame(rgba,w,h,t){
  if(this.lastTime!==null&&(t<=this.lastTime||t-this.lastTime>.8))this.reset();
  this.lastTime=t;const gray=new Uint8Array(w*h);for(let i=0;i<gray.length;i++)gray[i]=(rgba[i*4]+rgba[i*4+1]+rgba[i*4+2])/3;
  const old=this.previous;this.previous=gray;if(!old||old.length!==gray.length)return [];
  const z=this.zone,x0=Math.floor(z.x*w),x1=Math.ceil((z.x+z.width)*w),y0=Math.floor(z.y*h),y1=Math.ceil((z.y+z.height)*h);
  const mask=new Uint8Array(w*h);let moving=0;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=y*w+x;if(Math.abs(gray[i]-old[i])>28){mask[i]=1;moving++;}}
  // Camera movement / cuts invalidate trajectories, never create official shifts.
  if(moving/Math.max(1,(x1-x0)*(y1-y0))>.4){this.tracks=[];this.regions=[];return [];}
  const blobs=[];
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
   const start=y*w+x;if(!mask[start])continue;mask[start]=0;const q=[start];let n=0,sx=0,sy=0,minX=x,maxX=x,minY=y,maxY=y;
   for(let k=0;k<q.length;k++){const i=q[k],px=i%w,py=Math.floor(i/w);n++;sx+=px;sy+=py;minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=px+dx,ny=py+dy,ni=ny*w+nx;if(nx>=x0&&nx<x1&&ny>=y0&&ny<y1&&mask[ni]){mask[ni]=0;q.push(ni);}}
   }
   if(n>=8)blobs.push({x:sx/n/w,y:sy/n/h,width:(maxX-minX+1)/w,height:(maxY-minY+1)/h,left:minX/w,top:minY/h,pixels:n});
  }
  const used=new Set(),events=[];
  for(const b of blobs.slice(0,80)){
   let best=null,dist=.12;for(const tr of this.tracks){const d=Math.hypot(tr.x-b.x,tr.y-b.y);if(!used.has(tr.id)&&t-tr.time<.6&&d<dist){best=tr;dist=d;}}
   const tr=best||{id:++this.serial,hits:0,side:0,lastCross:-10};used.add(tr.id);
   const axis=z.axis==='x'?b.x:b.y,signed=(axis-z.boundary)*(z.benchLow?1:-1),side=Math.abs(signed)<.015?0:Math.sign(signed);
   if(side&&tr.side&&side!==tr.side&&tr.hits>=3&&t-tr.lastCross>1){
    const confidence=Math.min(.95,.4+Math.min(tr.hits,12)*.035+Math.min(b.pixels,100)/1000);
    events.push({videoTime:t,direction:side>0?'ON':'OFF',confidence,trackId:tr.id});tr.lastCross=t;
   }
   Object.assign(tr,b,{time:t,hits:tr.hits+1});if(side)tr.side=side;if(!best)this.tracks.push(tr);
  }
  this.tracks=this.tracks.filter(tr=>t-tr.time<.6);this.regions=this.tracks.filter(tr=>tr.time===t);this.events=events;return events;
 }
}
if(typeof module==='object'&&module.exports)module.exports={Detector};else root.FoxesCrossing={Detector};
})(globalThis);
