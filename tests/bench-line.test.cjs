const {test}=require('node:test'),assert=require('node:assert/strict'),T=require('../toi-engine'),{Detector}=require('../crossing-detector');
test('bench lines normalize direction, validate endpoints, and save per clip',()=>{
 const a=T.benchLine({x1:.2,y1:.3,x2:.8,y2:.7},false),b=T.benchLine({x1:.8,y1:.7,x2:.2,y2:.3},false);assert.deepEqual(a,b);
 const g={id:'g',filmClips:[{id:'a'},{id:'b'}],players:[],tagBenchZone:{type:'line',x1:0}};T.saveZone(g,'a',a);T.saveZone(g,'b',T.benchLine({x1:.4,y1:.1,x2:.4,y2:.9}));
 assert.deepEqual(JSON.parse(JSON.stringify(g)).toi314.zones.a,a);assert.notDeepEqual(g.toi314.zones.a,g.toi314.zones.b);assert.equal(g.tagBenchZone.x1,0);
 const before=JSON.stringify(g);assert.throws(()=>T.saveZone(g,'a',{...a,line:{...a.line,x1:NaN}}));assert.equal(JSON.stringify(g),before);
 assert.throws(()=>T.benchLine({x1:0,y1:0,x2:.01,y2:.01}));assert.throws(()=>T.benchLine({x1:-.1,y1:.2,x2:.5,y2:.4}));
});
function frame(x,y){const pixels=new Uint8ClampedArray(100*100*4);for(let row=y;row<y+6;row++)for(let col=x;col<x+6;col++){const i=(row*100+col)*4;pixels[i]=pixels[i+1]=pixels[i+2]=255;pixels[i+3]=255;}return pixels;}
test('diagonal line crossings follow the actual line and reverse with bench side',()=>{
 const line={x1:.2,y1:.3,x2:.8,y2:.7};
 const collect=side=>{const d=new Detector(T.benchLine(line,side));return Array.from({length:30},(_,n)=>d.frame(frame(20+n*2,47),100,100,n*.15)).flat();};
 const a=collect(false),b=collect(true);assert.ok(a.some(e=>e.direction==='ON'));assert.ok(b.some(e=>e.direction==='OFF'));assert.ok(a.every(e=>!e.playerId));
});
