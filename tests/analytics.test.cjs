const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const A=require('../analytics');
const p={id:'p',number:'13',name:'Test Skater',pos:'F',shifts:[]};
const goalie={id:'g',number:'35',name:'Test Goalie',pos:'G',shifts:[]};
const game=(id,r)=>({id,date:`2026-09-0${id}`,players:[p,goalie],officialStats:{skaters:{13:r},goalies:{35:{gp:1,min:36,saves:18,ga:2,w:1}}}});
test('normalization preserves original data, unknown fields, aliases, and explicit zero',()=>{
 const source={custom:'keep',skaters:[{playerId:'p',s:4,blk:2,pm:-1,fow:3,fol:2,g:0,toi:'12:30',custom:9}],goalies:{35:{sa:18,ga:2,min:36}}};
 const before=JSON.stringify(source);const n=A.normalize(source,[p,goalie]);
 assert.equal(JSON.stringify(source),before);assert.equal(n.skaters[13].shots,4);assert.equal(n.skaters[13].g,0);assert.equal(n.skaters[13].fo,5);assert.equal(n.skaters[13].toiMin,12.5);assert.equal(n.skaters[13].custom,9);assert.equal(n.custom,'keep');
 assert.equal(n.goalies[35].saves,18);assert.equal(n.goalies[35].sa,20);assert.equal(n.goalies[35].svPct,.9);assert.equal(n.goalies[35].gaa,2);assert.deepEqual(A.normalize(n,[p,goalie]),n);
});
test('legacy quick entry migrates once and cannot overwrite later edits',()=>{
 const q={players:{p:{g:2,s:5,pm:1}},goalies:{g:{saves:19,ga:1,min:36,decision:'W'}}};
 const n=A.normalize({},[p,goalie],q);assert.equal(n.skaters[13].g,2);assert.equal(n.goalies[35].w,1);
 n.skaters[13].g=0;n.quickEntry295=q;assert.equal(A.normalize(n,[p,goalie]).skaters[13].g,0);
});
test('season aggregates, edits and deletion are recalculated without double counting',()=>{
 const a=game(1,{gp:1,g:1,a:1,shots:4,toiMin:12,plusMinus:2,fow:3,fo:5});
 const b=game(2,{gp:1,g:2,a:0,shots:6,toiMin:15});
 const total=A.season([a,b],[p,goalie]);assert.equal(total[0].gp,2);assert.equal(total[0].pts,4);assert.equal(total[0].toi,27*60);assert.equal(total[0].shotPct,.3);assert.equal(total[0].foPct,.6);
 assert.equal(total[1].sa,40);assert.equal(total[1].gaa,2);assert.equal(total[1].svPct,.9);
 a.officialStats.skaters[13].g=0;assert.equal(A.season([a,b],[p])[0].g,2);assert.equal(A.season([a],[p])[0].g,0);
 assert.deepEqual(A.season([a,b],[p]),A.season([b,a],[p]));
});
test('ratings start at 50, favor impact efficiency, and do not accumulate indefinitely',()=>{
 assert.equal(A.season([],[p])[0].value,50);
 const a=game(1,{gp:1,g:1,a:1,shots:4,toiMin:12,plusMinus:2});const b=game(2,{gp:1,g:0,a:0,shots:1,toiMin:18,plusMinus:-2});
 assert.ok(A.rate(A.records(a)[0]).value>A.rate(A.records(b)[0]).value);
 const many=Array.from({length:100},(_,i)=>({...a,id:String(i)}));const r=A.season(many,[p])[0];assert.ok(r.value<=100);assert.ok(r.value<A.rate(A.records(a)[0]).value);
 const noFo=A.records(a)[0];const neutral={...noFo,fo:10,fow:5};assert.ok(A.rate(noFo).value>=A.rate(neutral).value);
 assert.notEqual(A.rate(noFo).value,A.rate(noFo,{...A.weights,production:100,shots:0,efficiency:0,results:0,faceoffs:0,defense:0,discipline:0}).value);
});
test('goalie formula excludes skater offense and uses 36-minute GAA',()=>{
 const r=A.records(game(1,{}))[1];assert.equal(A.rate(r).value,A.rate({...r,g:20,a:20,shots:90}).value);
 const half=A.normalize({goalies:{35:{gp:1,min:18,saves:9,ga:1}}},[goalie]);assert.equal(half.goalies[35].gaa,2);
});
test('unplayed players and empty games do not move ratings',()=>{
 const r=A.season([{id:'empty',players:[p,goalie]}],[p,goalie]);assert.ok(r.every(x=>x.gp===0&&x.value===50&&x.history.length===1));
});
test('film-only faceoffs and goalie events use existing event property names',()=>{
 const g={players:[p,goalie],events:[{type:'faceoff_win',playerId:'p',team:'us'},{type:'faceoff_loss',playerId:'p',team:'us'}],goalieEvents:[{type:'save',goalieId:'g'},{type:'ga',goalieId:'g'}]};
 const rows=A.records(g);assert.equal(rows[0].fo,2);assert.equal(rows[0].fow,1);assert.equal(rows[1].ga,1);assert.equal(rows[1].sa,2);
});
test('all renderer scripts parse and release invariants hold',()=>{
 const html=fs.readFileSync('index.html','utf8');for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
 for(const path of ['analytics.js','release-ui.js','interface-model.js','interface.js','toi-engine.js','crossing-detector.js','toi-ui.js','main.js','preload.js'])new vm.Script(fs.readFileSync(path,'utf8'),{filename:path});
 const pkg=require('../package.json');assert.equal(pkg.version,'3.1.0');assert.equal(pkg.build.artifactName,'Arctic-Foxes-12U-AA-Hockey-Analytics-${version}.${ext}');assert.equal(pkg.build.publish[0].repo,'arctic-foxes-12u-aa-analytics2');assert.equal(pkg.build.publish[0].owner,'CoachJT');
 assert.match(fs.readFileSync('main.js','utf8'),/app.setPath\('userData', path.join\(app.getPath\('appData'\), 'ArcticFoxesBY14HockeyAnalytics'\)\)/);assert.ok(!html.includes('GitHub Auto-Publish Ready'));assert.ok(!html.includes('FOXES  /  2.0'));
});
