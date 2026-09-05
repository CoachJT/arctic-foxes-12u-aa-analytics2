const {test}=require('node:test');
const assert=require('node:assert/strict');
const U=require('../interface-model');
const A=require('../analytics');
const p={id:'p',number:'13',name:'Skater',pos:'F',shifts:[]};
const now=new Date(2026,8,5,12,0);
const game=(id,stats={gp:1,g:1,a:1,toiMin:12})=>({id,date:'2026-09-04',players:[p],officialStats:{imported:true,skaters:{13:stats},team:{goalsFor:{total:0},goalsAgainst:{total:0}}}});
test('unknown default zero scores never become fabricated ties',()=>{
 const g=game('a');const s=U.gameSummary(g,'2026-09-05');
 assert.equal(s.played,true);assert.equal(s.scored,false);assert.equal(s.result,null);
 g.status='final';assert.equal(U.gameSummary(g).result,'T');
 g.officialStats.team.goalsFor.total=3;assert.equal(U.gameSummary(g).result,'W');
});
test('dashboard reports score coverage and does not change saved data or engine results',()=>{
 const games=[game('a'),game('b')];games[0].officialStats.team.goalsFor.total=3;games[0].officialStats.team.goalsAgainst.total=2;
 games[0].filmClips=[{id:'clip',path:'keep.mp4',tags:[{custom:1}]}];games[0].settings={custom:'keep'};
 const before=JSON.stringify(games),engine=A.season(games,[p]);const d=U.dashboard(games,[p],[],undefined,now);
 assert.equal(d.played,2);assert.equal(d.scored,1);assert.equal(d.record,'1–0–0');assert.equal(d.gf,3);assert.equal(d.ga,2);
 assert.deepEqual(d.rows,engine);assert.equal(JSON.stringify(games),before);assert.equal(d.recent.find(s=>s.game.id==='a').film,1);
});
test('next game excludes past times, cancellations and played linked games',()=>{
 const schedule=[{id:'past',date:'2026-09-05',time:'11:59'},{id:'cancel',date:'2026-09-05',time:'12:30',status:'cancelled'},
 {id:'played',date:'2026-09-05',time:'13:00',linkedGameId:'a'},{id:'next',date:'2026-09-05',time:'14:00'},{id:'later',date:'2026-09-06'}];
 assert.equal(U.nextGame(schedule,[game('a')],now).id,'next');assert.equal(U.nextGame([],[],now),null);
 assert.equal(U.nextGame([],[{id:'future',date:'2026-09-06'}],now).linkedGameId,'future');
});
test('leaders require recorded activity and TOI efficiency excludes missing minutes',()=>{
 const empty=U.dashboard([],[p],[],undefined,now);assert.equal(empty.teamRating,null);assert.ok(Object.values(empty.leaders).every(v=>v===null));
 const d=U.dashboard([game('a',{gp:1,g:20}),game('b',{gp:1,g:1,toiMin:12})],[p],[],undefined,now);
 assert.equal(d.leaders.points.value,21);assert.equal(d.leaders.efficiency.value,3);assert.equal(d.leaders.goalie,null);
});
test('action bars are contextual and Undo requires a reversible action',()=>{
 assert.deepEqual(U.actionContext('home',true,true),{csv:false,undo:false});
 assert.deepEqual(U.actionContext('tracking',true,false),{csv:true,undo:false});
 assert.deepEqual(U.actionContext('film',true,true),{csv:true,undo:true});
 assert.deepEqual(U.actionContext('mygames',false,true),{csv:false,undo:false});
 assert.deepEqual(U.actionContext('updates',true,true),{csv:false,undo:false});
 assert.equal(U.trend(0),'stable');assert.equal(U.trend(1),'rising');assert.equal(U.trend(-1),'falling');
});
