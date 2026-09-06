const {test}=require('node:test'),assert=require('node:assert/strict'),{DetectionTracker}=require('../player-follow-model');
const zone={axis:'x',boundary:.5,x:.45,y:0,width:.1,height:1,benchLow:true};
const sig=n=>Array.from({length:24},(_,i)=>i===n?1:0);
const d=(x,y=.3,n=0)=>({box:{x,y,width:.03,height:.08},signature:sig(n),score:.9});
function setup(){const tr=new DetectionTracker(zone),a=d(.3);tr.attach([a],{playerId:'a',box:a.box,onIce:false},0);return tr;}
test('detected movement retains manual identity and makes one continuous crossing',()=>{const tr=setup(),events=[];for(let i=1;i<=25;i++){const r=tr.frame([d(.3+i*.01)],i*.1);assert.deepEqual(r.lost,[]);events.push(...r.events);}assert.equal(events.length,1);assert.equal(events[0].playerId,'a');assert.equal(events[0].direction,'ON');});
test('brief missing detection recovers without inventing a crossing',()=>{const tr=setup();assert.deepEqual(tr.frame([],.1).recovering,['a']);const r=tr.frame([d(.31)],.2);assert.deepEqual(r.lost,[]);assert.equal(tr.tracks[0].status,'following');assert.deepEqual(r.events,[]);});
test('uncertain gap across bench boundary cannot record an automatic shift',()=>{const tr=new DetectionTracker(zone),a=d(.46);tr.attach([a],{playerId:'a',box:a.box,onIce:false},0);tr.frame([],.1);const r=tr.frame([d(.52)],.2);assert.deepEqual(r.events,[]);assert.deepEqual(r.lost,['a']);});
test('two labels competing for one player never swap identities',()=>{const tr=setup(),b=d(.36);tr.attach([b],{playerId:'b',box:b.box,onIce:false},0);const r=tr.frame([d(.33)],.1);assert.deepEqual(r.events,[]);assert.deepEqual(r.recovering.sort(),['a','b']);assert.deepEqual(tr.tracks.map(t=>t.playerId),['a','b']);});
test('wrong uniform and long disappearance require reconnection',()=>{const tr=setup();for(let i=1;i<=11;i++)tr.frame([d(.3,.3,3)],i*.1);assert.equal(tr.tracks[0].status,'lost');assert.equal(tr.tracks[0].playerId,'a');});
test('five separated skaters keep their own simultaneous events',()=>{const tr=new DetectionTracker(zone),rows=Array.from({length:5},(_,i)=>d(.3,.05+i*.18,i));rows.forEach((a,i)=>tr.attach(rows,{playerId:String(i),box:a.box,onIce:false},0));let events=[];for(let k=1;k<=25;k++){const r=tr.frame(rows.map(a=>({...a,box:{...a.box,x:.3+k*.01}})),k*.1);assert.deepEqual(r.lost,[]);events.push(...r.events);}assert.deepEqual(events.map(e=>e.playerId).sort(),['0','1','2','3','4']);});
test('clip seeks, conflicting selections and missing detections fail safely',()=>{const tr=setup();assert.throws(()=>tr.attach([],{playerId:'b',box:d(.3).box,onIce:true},0),/No clear/);assert.throws(()=>tr.attach([d(.3)],{playerId:'b',box:d(.3).box,onIce:true},0),/already/);assert.deepEqual(tr.frame([d(.3)],5).lost,['a']);});
test('native detector rejects oversized or malformed data before inference',async()=>{const backend=require('../player-detector-main').createBackend();await assert.rejects(backend.infer([new Uint8Array(1)]),/Invalid/);await assert.rejects(backend.infer([]),/Invalid/);});

 test('camera cuts require reconnection without recording shifts',()=>{const tr=new DetectionTracker(zone),rows=[d(.3)];rows.scene=Array(96).fill(.1);tr.attach(rows,{playerId:'a',box:rows[0].box,onIce:false},0);const next=[d(.31)];next.scene=Array(96).fill(.9);const r=tr.frame(next,.1);assert.deepEqual(r.events,[]);assert.deepEqual(r.lost,['a']);});

test('joint assignment uses the second player to disambiguate a close pair',()=>{
 const {associate}=require('../player-follow-model'),a=d(.2),b=d(.4);
 const p=associate([{t:{playerId:'a'},scores:[{index:0,d:a,cost:.10},{index:1,d:b,cost:.15}]},{t:{playerId:'b'},scores:[{index:1,d:b,cost:.05}]}]);
 assert.deepEqual(p.map(r=>r.best.index),[0,1]);assert.ok(p.every(r=>!r.reason));
});
test('equally plausible complete assignments remain uncertain',()=>{
 const {associate}=require('../player-follow-model'),a=d(.2),b=d(.4),scores=[{index:0,d:a,cost:.1},{index:1,d:b,cost:.1}];
 assert.ok(associate([{scores},{scores}]).every(r=>r.reason));
});
test('association is independent of detection ordering',()=>{
 const {associate}=require('../player-follow-model'),a=d(.2),b=d(.4);
 const rows=[{scores:[{index:4,d:b,cost:.2},{index:2,d:a,cost:.05}]},{scores:[{index:4,d:b,cost:.05}]}];
 assert.deepEqual(associate(rows).map(r=>r.best.d.box.x),[.2,.4]);
});


test('uniform evidence rejects a conflicting colour but tolerates missing evidence',()=>{
 const {kitConflict}=require('../player-follow-model');
 const kit=(bin,n,pixels=200)=>({bins:Array.from({length:12},(_,i)=>i===bin?n:0),pixels});
 assert.equal(kitConflict(kit(0,9),kit(8,34)),true);
 assert.equal(kitConflict(kit(0,9),kit(11,20)),false);
 assert.equal(kitConflict(kit(0,9),kit(0,0)),false);
 assert.equal(kitConflict(undefined,kit(8,34)),false);
});
test('recorded overlap keeps red-uniform label off the nearby blue opponent',()=>{
 const rows=require('./fixtures/anonymous-uniform-overlap.json'),tr=new DetectionTracker(zone);
 for(const [playerId,box] of [['a',{x:.774,y:.66,width:.047,height:.13}],['b',{x:.650,y:.383,width:.024,height:.055}],['c',{x:.927,y:.519,width:.017,height:.049}]])tr.attach(rows[0].detections,{playerId,box,onIce:true},rows[0].time);
 for(const row of rows){const result=tr.frame(row.detections,row.time);assert.deepEqual(result.events,[]);}
 const c=tr.tracks.find(t=>t.playerId==='c');assert.equal(c.status,'following');assert.ok(c.box.x>.9,'must not select blue opponent at x=.885');
});

test('weak detections cannot attach a player or create a crossing',()=>{
 const tr=setup();assert.throws(()=>tr.attach([{...d(.3),score:.1}],{playerId:'b',box:d(.3).box,onIce:false},0),/No clear/);
 const before=structuredClone(tr.tracks[0].box);
 const r=tr.frame([{...d(.31),score:.1}],.1);
 assert.deepEqual(r.events,[]);assert.equal(tr.tracks[0].status,'recovering');assert.deepEqual(tr.tracks[0].box,before);
 assert.equal(tr.tracks[0].lastSeen,0);assert.ok(tr.tracks[0].hintBox);
});
test('weak detections never extend the timeout or change appearance',()=>{
 const tr=setup(),anchor=structuredClone(tr.tracks[0].signature);
 for(let i=1;i<=11;i++){const r=tr.frame([{...d(.3),score:.1}],i*.1);assert.deepEqual(r.events,[]);}
 assert.equal(tr.tracks[0].status,'lost');assert.deepEqual(tr.tracks[0].signature,anchor);
});
test('clear recovery removes provisional positions',()=>{
 const tr=setup();tr.frame([{...d(.31),score:.1}],.1);tr.frame([d(.32)],.2);
 assert.equal(tr.tracks[0].status,'following');assert.equal(tr.tracks[0].hintBox,undefined);
});

test('recovery cannot assign a neutral referee to a player with a known jersey colour',()=>{
 const {kitSupportsRecovery}=require('../player-follow-model'),red={bins:[20,0,0,0,0,0,0,0,0,0,0,0],pixels:200},neutral={bins:Array(12).fill(0),pixels:200};
 assert.equal(kitSupportsRecovery(red,neutral),false);assert.equal(kitSupportsRecovery(red,red),true);
 const tr=new DetectionTracker(zone),first={...d(.3),kit:red};tr.attach([first],{playerId:'a',box:first.box,onIce:false},0);
 tr.frame([],.1);const result=tr.frame([{...d(.31),kit:neutral}],.2);
 assert.deepEqual(result.events,[]);assert.equal(tr.tracks[0].status,'recovering');assert.equal(tr.tracks[0].lastSeen,0);
});
