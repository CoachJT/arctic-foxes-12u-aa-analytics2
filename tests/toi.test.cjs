const {test}=require('node:test'),assert=require('node:assert/strict');
const T=require('../toi-engine'),{Detector}=require('../crossing-detector');
const game=()=>({id:'g',players:[{id:'p',name:'Cain',number:'13',pos:'F',shifts:[]},{id:'d',name:'Rieger',number:'20',pos:'D',shifts:[]}],syncPoints:[{clipId:'c',videoTime:57.6,period:'1',remainingSec:900}],toi314:{zones:{},candidates:[],groundTruth:[]}});
const on=(g,t=60)=>T.transition(g,{playerId:'p',direction:'ON',clipId:'c',videoTime:t});
const off=(g,t=90)=>T.transition(g,{playerId:'p',direction:'OFF',clipId:'c',videoTime:t});
test('manual video ON/OFF, paused active duration, multiple shifts and reload',()=>{
 const g=game();on(g);assert.equal(T.summary(g,70,'c')[0].total,10);assert.equal(T.summary(g,70,'c')[0].total,10);
 off(g);on(g,100);off(g,120);const r=T.summary(JSON.parse(JSON.stringify(g)),500,'c')[0];assert.equal(r.total,50);assert.equal(r.count,2);assert.equal(r.average,25);assert.equal(r.shortest,20);assert.equal(r.longest,30);assert.equal(r.byPeriod['1'],50);
});
test('duplicate ON, missing ON, backward OFF and cross-clip OFF are rejected atomically',()=>{
 const g=game();assert.throws(()=>T.apply(g,h=>off(h)),/without ON/);on(g);const before=JSON.stringify(g);
 assert.throws(()=>T.apply(g,h=>on(h,70)),/Duplicate/);assert.throws(()=>T.apply(g,h=>off(h,50)),/precedes/);
 assert.throws(()=>T.apply(g,h=>T.transition(h,{playerId:'p',direction:'OFF',clipId:'other',videoTime:80})),/another clip/);assert.equal(JSON.stringify(g),before);
});
test('precision edit and reassignment recalculate immediately without erasing metadata',()=>{
 const g=game();on(g);off(g);g.players[0].shifts[0].custom='keep';const id=g.players[0].shifts[0].id;
 T.edit(g,{shiftId:id,playerId:'d',on:60.25,off:89.75,clipId:'c'});assert.equal(g.players[0].shifts.length,0);assert.equal(T.summary(g)[0].total,29.5);assert.equal(g.players[1].shifts[0].custom,'keep');assert.equal(g.players[1].shifts[0].source,'corrected');
 const before=JSON.stringify(g);assert.throws(()=>T.apply(g,h=>T.edit(h,{shiftId:id,playerId:'d',on:100,off:90,clipId:'c'})),/after ON/);assert.equal(JSON.stringify(g),before);
});
test('delete and Undo snapshots restore previous on-ice state',()=>{
 const g=game();on(g);const previous=structuredClone(g);off(g);T.remove(g,g.players[0].shifts[0].id);assert.equal(T.shifts(g).length,0);
 const restored=JSON.parse(JSON.stringify(previous));assert.equal(restored.players[0].active,true);assert.equal(T.summary(restored,80,'c')[0].total,20);
});
test('unknown candidates do not enter official TOI until assigned and confirmed',()=>{
 const g=game();T.candidate(g,{id:'on',clipId:'c',videoTime:60,direction:'ON',confidence:.8});assert.equal(T.summary(g)[0].total,0);assert.equal(g.toi314.candidates[0].identity,'UNKNOWN PLAYER');
 assert.throws(()=>T.apply(g,h=>T.review(h,{id:'on',action:'confirm',playerId:'',videoTime:60,direction:'ON'})),/Assign/);
 T.review(g,{id:'on',action:'confirm',playerId:'d',videoTime:60.25,direction:'ON'});T.candidate(g,{id:'off',clipId:'c',videoTime:90,direction:'OFF',confidence:.5});T.review(g,{id:'off',action:'confirm',playerId:'d',videoTime:90.5,direction:'OFF'});
 assert.equal(T.summary(g)[0].total,30.25);assert.equal(g.toi314.groundTruth.length,2);assert.equal(g.toi314.groundTruth[0].playerId,'d');assert.equal(g.players[1].shifts[0].confidence,.5);
});
test('rejected detection preserves all manual shifts; confirmed detection cannot apply twice',()=>{
 const g=game();on(g);off(g);const before=JSON.stringify(g.players);T.candidate(g,{id:'x',clipId:'c',videoTime:100,direction:'ON',confidence:.4});T.review(g,{id:'x',action:'reject'});assert.equal(JSON.stringify(g.players),before);assert.throws(()=>T.review(g,{id:'x',action:'confirm',playerId:'p',videoTime:100,direction:'ON'}),/no longer/);
});
test('game-clock anchor is derived independently of authoritative duration',()=>{
 const g=game();assert.ok(Math.abs(T.clock(g,'c',60).remainingSec-897.6)<.00001);assert.equal(T.clock(g,'missing',60),null);on(g,60);off(g,90);assert.equal(g.players[0].shifts[0].duration,30);assert.equal(g.players[0].shifts[0].gameClockOn.period,'1');
});
test('legacy 3.0.12 shifts and unknown metadata survive normalization and explicit editing',()=>{
 const g=game(),legacy={id:'old',startElapsed:12,endElapsed:45,ended:true,period:'2',custom:{keep:true}};g.players[0].shifts=[legacy];const before=JSON.stringify(g);assert.equal(T.summary(g)[0].total,33);assert.equal(T.shifts(g)[0].videoOnTime,null);assert.equal(JSON.stringify(g),before);
 T.edit(g,{shiftId:'old',playerId:'p',on:4,off:37,clipId:'c'});assert.deepEqual(g.players[0].shifts[0].legacyOriginal,legacy);assert.equal(T.summary(g)[0].total,33);
});
test('seek/reload never modifies saved timestamps or includes other-clip active duration',()=>{
 const g=game();on(g,60);const before=JSON.stringify(g);assert.equal(T.summary(g,10,'c')[0].total,0);assert.equal(T.summary(g,500,'other')[0].total,0);assert.equal(JSON.stringify(g),before);off(g,80);assert.equal(T.summary(g,1000,'c')[0].total,20);
});
const zone={x:0,y:0,width:1,height:1,axis:'x',boundary:.5,benchLow:true};
function frame(x){const a=new Uint8ClampedArray(100*60*4);for(let y=22;y<38;y++)for(let j=x;j<x+10;j++){const i=(y*100+j)*4;a[i]=a[i+1]=a[i+2]=255;a[i+3]=255;}return a;}
test('actual pixel analysis detects a synthetic crossing, but does not recognize players',()=>{
 const d=new Detector(zone);let events=[];for(let n=0;n<22;n++)events.push(...d.frame(frame(15+n*3),100,60,n*.15));
 assert.ok(events.some(e=>e.direction==='ON'));assert.ok(events.every(e=>e.playerId===undefined&&e.confidence>=0&&e.confidence<=1));
});
test('static frames, seek reset and camera cuts do not create crossings or change games',()=>{
 const d=new Detector(zone),g=game();on(g);const before=JSON.stringify(g);for(let n=0;n<10;n++)assert.equal(d.frame(frame(10),100,60,n*.15).length,0);d.reset();assert.equal(d.frame(frame(80),100,60,20).length,0);assert.equal(d.frame(new Uint8ClampedArray(100*60*4).fill(255),100,60,20.15).length,0);assert.equal(JSON.stringify(g),before);
});
test('reverse pixel crossing creates OFF and invalid zones fail safely',()=>{
 const d=new Detector(zone);let events=[];for(let n=0;n<22;n++)events.push(...d.frame(frame(78-n*3),100,60,n*.15));assert.ok(events.some(e=>e.direction==='OFF'));
 assert.throws(()=>new Detector({...zone,width:Infinity}),/Invalid bench zone/);
});
test('clip duration validation and deletion audit preserve confirmed ground truth',()=>{
 const g=game();g.filmClips=[{id:'c',duration:100}];assert.throws(()=>on(g,101),/exceeds/);on(g);off(g);const id=g.players[0].shifts[0].id;T.remove(g,id);assert.equal(g.toi314.groundTruth.at(-1).kind,'shift-deleted');
});
test('real existing Undo handler restores native video shifts and their active state',()=>{
 const fs=require('fs'),vm=require('vm'),html=fs.readFileSync('index.html','utf8'),g=game();on(g);const previous={...structuredClone(g),history:[],running:false};off(g);
 const button={},ctx=vm.createContext({state:{...g,history:[previous]},$:()=>button,tickHandle:null,clearInterval:()=>{},save:()=>{},render:()=>{},alert:()=>{}});
 const handler=html.match(/\$\("#undo"\)\.onclick=\(\)=>\{[\s\S]*?\n\};/)[0];vm.runInContext(handler,ctx);button.onclick();assert.equal(ctx.state.players[0].active,true);assert.equal(ctx.state.players[0].shifts[0].ended,false);assert.equal(ctx.state.players[0].shifts[0].videoOnTime,60);
});

test('repeated media seeks preserve the first active-shift return timestamp',()=>{
 const fs=require('fs'),vm=require('vm'),source=fs.readFileSync('toi-ui.js','utf8'),g=game();on(g);
 const metadata={},handlers={};let pauses=0;
 const ctx=vm.createContext({T314:T,game314:()=>g,ensure314:()=>metadata,currentClipId:()=> 'c',lastMedia314:75,skipSeek314:false,detector314:null,save:()=>{},renderLive314:()=>{},v314:{pause:()=>pauses++,addEventListener:(name,fn)=>handlers[name]=fn}});
 vm.runInContext(source.split('\n').find(line=>line.startsWith("v314.addEventListener('seeking'")),ctx);
 handlers.seeking();assert.equal(metadata.seekReview.from,75);
 ctx.lastMedia314=0;handlers.seeking();assert.equal(metadata.seekReview.from,75);assert.equal(pauses,2);
});
