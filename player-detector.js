/* Offline person detection; inference uses the desktop CPU runtime. */
const FoxesDetector=(()=>{
function iou(a,b){const inter=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));return inter/(a.width*a.height+b.width*b.height-inter)||0;}
function contained(a,b){const inter=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));return inter/Math.min(a.width*a.height,b.width*b.height)||0;}
function signature(frame,b){const hist=new Array(24).fill(0);let count=0;const w=frame.width,h=frame.height;
 for(let y=Math.floor((b.y+b.height*.15)*h);y<Math.min(h,(b.y+b.height*.75)*h);y+=2)for(let x=Math.floor((b.x+b.width*.15)*w);x<Math.min(w,(b.x+b.width*.85)*w);x+=2){if(x<0||y<0)continue;const i=(y*w+x)*4,r=frame.data[i],g=frame.data[i+1],blue=frame.data[i+2],max=Math.max(r,g,blue),min=Math.min(r,g,blue);if(max>190&&max-min<35)continue;hist[Math.min(7,r>>5)]++;hist[8+Math.min(7,g>>5)]++;hist[16+Math.min(7,blue>>5)]++;count+=3;}
 return hist.map(v=>count?v/count:0);
}
function kit(frame,b){
 const bins=Array(12).fill(0);let pixels=0;
 for(let y=Math.max(0,Math.floor((b.y+b.height*.15)*frame.height));y<Math.min(frame.height,(b.y+b.height*.72)*frame.height);y++)for(let x=Math.max(0,Math.floor((b.x+b.width*.1)*frame.width));x<Math.min(frame.width,(b.x+b.width*.9)*frame.width);x++){
  const i=(y*frame.width+x)*4,r=frame.data[i],g=frame.data[i+1],blue=frame.data[i+2],hi=Math.max(r,g,blue),lo=Math.min(r,g,blue),delta=hi-lo;pixels++;
  if(delta<40||hi<70||delta/hi<.3)continue;
  let hue=hi===r?(g-blue)/delta:hi===g?2+(blue-r)/delta:4+(r-g)/delta;hue=(hue+6)%6;
  bins[Math.round(hue*2)%12]++;
 }
 return {bins,pixels};
}
async function detect(frame,hints=[]){if(!globalThis.foxesPlayerVision)throw Error('Player detector requires the desktop app.');await globalThis.foxesPlayerVision.ready();let source=new OffscreenCanvas(frame.width,frame.height);source.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frame.data),frame.width,frame.height),0,0);if(frame.width>1280){const reduced=new OffscreenCanvas(1280,Math.round(1280*frame.height/frame.width));reduced.getContext('2d').drawImage(source,0,0,reduced.width,reduced.height);source=reduced;}const output=[],inputs=[],tiles=[];const canvas=new OffscreenCanvas(416,416),ctx=canvas.getContext('2d',{willReadFrequently:true});
 // Overlapping ice tiles retain distant skaters at a usable input size.
 const regions=[{x:0,y:.30,w:.5625,h:.70},{x:.4375,y:.30,w:.5625,h:.70}];
 for(const b of hints.filter(b=>b.height<.08).sort((a,b)=>a.height-b.height)){
  const w=.27,h=.38,cx=b.x+b.width/2,cy=b.y+b.height/2;
  if(regions.slice(2).some(r=>cx>r.x+.035&&cx<r.x+r.w-.035&&cy>r.y+.035&&cy<r.y+r.h-.035))continue;
  regions.push({x:Math.max(0,Math.min(1-w,cx-w/2)),y:Math.max(0,Math.min(1-h,cy-h/2)),w,h});if(regions.length===4)break;
 }
 for(const region of regions){const x=region.x*source.width,y=region.y*source.height,w=region.w*source.width,h=region.h*source.height,r=416/Math.max(w,h),rw=Math.floor(w*r),rh=Math.floor(h*r);
  ctx.fillStyle='rgb(114,114,114)';ctx.fillRect(0,0,416,416);ctx.drawImage(source,x,y,w,h,0,0,rw,rh);const pixels=ctx.getImageData(0,0,416,416).data,input=new Float32Array(3*416*416),n=416*416;for(let i=0;i<n;i++){input[i]=pixels[i*4+2];input[i+n]=pixels[i*4+1];input[i+2*n]=pixels[i*4];}
  inputs.push(input);tiles.push({x,y,r});
 }
 const predictions=await globalThis.foxesPlayerVision.infer(inputs);
 for(let tile=0;tile<tiles.length;tile++){
  const {x,y,r}=tiles[tile],data=predictions[tile];let row=0;
  for(const stride of [8,16,32])for(let gy=0;gy<416/stride;gy++)for(let gx=0;gx<416/stride;gx++,row++){const i=row*85,score=data[i+4]*data[i+5];if(score<.08)continue;const bw=Math.exp(data[i+2])*stride/r/source.width,bh=Math.exp(data[i+3])*stride/r/source.height,cx=((data[i]+gx)*stride/r+x)/source.width,cy=((data[i+1]+gy)*stride/r+y)/source.height;const left=Math.max(0,cx-bw/2),top=Math.max(0,cy-bh/2),box={x:left,y:top,width:Math.min(1,cx+bw/2)-left,height:Math.min(1,cy+bh/2)-top};if(box.width>0&&box.height>0)output.push({box,score});}
 }
 output.sort((a,b)=>b.score-a.score);const kept=[];for(const d of output)if(!kept.some(k=>iou(k.box,d.box)>.45||contained(k.box,d.box)>.7)){d.signature=signature(frame,d.box);d.kit=kit(frame,d.box);kept.push(d);}kept.scene=[];for(let gy=0;gy<8;gy++)for(let gx=0;gx<12;gx++){const i=(Math.min(frame.height-1,Math.floor((gy+.5)*frame.height/8))*frame.width+Math.min(frame.width-1,Math.floor((gx+.5)*frame.width/12)))*4;kept.scene.push((frame.data[i]+frame.data[i+1]+frame.data[i+2])/765);}return kept;
}
return {ready:()=>globalThis.foxesPlayerVision?.ready()??Promise.reject(Error('Player detector requires the desktop app.')),detect};
})();
