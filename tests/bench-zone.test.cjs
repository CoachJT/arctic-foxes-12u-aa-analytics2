const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const T=require('../toi-engine'),{Detector}=require('../crossing-detector');
const zone={x:.1,y:.2,width:.4,height:.3,axis:'x',benchLow:false,boundary:.3};
const game=()=>({id:'game',filmClips:[{id:'a'},{id:'b'}],players:[],tagZone:{legacy:true}});
test('bench zones survive serialization independently per clip and preserve legacy data',()=>{
 const g=game();T.saveZone(g,'a',zone);T.saveZone(g,'b',{...zone,axis:'y',boundary:.35});
 const loaded=JSON.parse(JSON.stringify(g));assert.deepEqual(loaded.toi314.zones.a,zone);assert.equal(loaded.toi314.zones.b.axis,'y');assert.deepEqual(loaded.tagZone,{legacy:true});new Detector(loaded.toi314.zones.a);
 delete loaded.toi314.zones.a;assert.ok(loaded.toi314.zones.b);assert.ok(g.toi314.zones.a);assert.deepEqual(T.data(game()).zones,{});
});
test('invalid zones are rejected atomically, including non-finite and out-of-frame coordinates',()=>{
 const g=game();T.saveZone(g,'a',zone);const before=JSON.stringify(g);
 for(const patch of [{x:NaN},{y:-.1},{width:Infinity},{height:.01},{x:.9},{boundary:.9},{axis:'z'},{benchLow:'false'}]){
  assert.throws(()=>T.apply(g,h=>T.saveZone(h,'a',{...zone,...patch})),/valid bench/);assert.equal(JSON.stringify(g),before);
 }
 assert.throws(()=>T.saveZone(g,'missing',zone),/load/);assert.throws(()=>T.saveZone({...g,id:null},'a',zone),/saved game/);
});
const ui=fs.readFileSync('toi-ui.js','utf8');
function context(){
 const nodes={};const state={currentGameId:'one',clip:'a',toi314:{zones:{a:zone,b:{...zone,axis:'y',boundary:.35,benchLow:true}}}};
 const ctx=vm.createContext({state,$:id=>nodes[id]||(nodes[id]={}),currentClipId:()=>state.clip,ensure314:()=>state.toi314});
 vm.runInContext("let zoneDraft314=null,drawing314=false,drag314=null,corner314=null,analyzing314=false,detector314=null,lastSample314=-1;"+ui.slice(ui.indexOf("let zoneContext314="),ui.indexOf('function paint314()')),ctx);
 return {ctx,state,nodes};
}
test('real UI reloads orientation and clears draft, drag and analysis across clips and games',()=>{
 const {ctx,state,nodes}=context();vm.runInContext('syncZone314()',ctx);assert.equal(nodes['#zoneAxis314'].value,'x');assert.equal(nodes['#zoneSide314'].value,'high');
 vm.runInContext('zoneDraft314={x:.8};drawing314=true;drag314={};corner314={};analyzing314=true;detector314={};',ctx);
 state.clip='b';vm.runInContext('syncZone314()',ctx);assert.equal(nodes['#zoneAxis314'].value,'y');assert.equal(nodes['#zoneSide314'].value,'low');
 assert.equal(vm.runInContext('zoneDraft314===null && !drawing314 && !analyzing314 && detector314===null && drag314===null && corner314===null',ctx),true);
 state.currentGameId='two';state.toi314={zones:{}};assert.equal(vm.runInContext('zone314()',ctx),undefined);
});
test('real Save handler keeps a draft when commit fails and clears it only after success',()=>{
 const {ctx}=context();vm.runInContext('syncZone314();zoneDraft314={...zone314()};',ctx);
 Object.assign(ctx,{media314:()=>({clipId:'a'}),activeFilmClip:()=>({name:'film'}),v314:{videoWidth:1920,videoHeight:1080},msg314:()=>{},stop314:()=>{},T314:T,commit314:()=>false});
 vm.runInContext(ui.slice(ui.indexOf("$('#saveZone314').onclick="),ui.indexOf("$('#resetZone314').onclick=")),ctx);
 vm.runInContext("$('#saveZone314').onclick()",ctx);assert.equal(vm.runInContext('zoneDraft314!==null',ctx),true);
 ctx.commit314=fn=>{fn({...game(),filmClips:[{id:'a'}]});return true;};vm.runInContext("$('#saveZone314').onclick()",ctx);assert.equal(vm.runInContext('zoneDraft314',ctx),null);
});
