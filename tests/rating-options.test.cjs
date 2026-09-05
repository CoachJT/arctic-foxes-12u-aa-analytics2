const {test}=require('node:test');
const assert=require('node:assert/strict');const A=require('../analytics');
const players=[{id:'a',number:1,pos:'F'},{id:'g',number:2,pos:'G'}];
const game={id:'one',players,officialStats:{skaters:{1:{gp:1,g:1,a:0,shots:2,toiMin:6}},goalies:{2:{gp:1,min:6,saves:5,ga:1}}}};
test('time is excluded by default and can be enabled for both player types',()=>{
 for(const r of A.records(game)){
  const changed={...r,toi:1200,min:30,gaa:1.2};
  assert.equal(A.rate(r).value,A.rate(changed).value);
  assert.notEqual(A.rate(r,{...A.weights,includeIceTime:true}).value,A.rate(changed,{...A.weights,includeIceTime:true}).value);
 }
});
test('season toggle recomputes ratings without changing stored time or source data',()=>{
 const before=JSON.stringify(game),off=A.season([game],players),on=A.season([game],players,{...A.weights,includeIceTime:true});
 assert.equal(off[0].toi,360);assert.equal(on[0].toi,360);assert.notEqual(off[0].value,on[0].value);assert.equal(JSON.stringify(game),before);
 assert.deepEqual(A.season([game],players),off);
});
test('chances never change ratings or honors; time only affects honors when enabled',()=>{
 const edit=structuredClone(game);edit.officialStats.skaters[1].ch=99;
 assert.deepEqual(A.season([game],players).map(r=>r.value),A.season([edit],players).map(r=>r.value));
 const scores=(g,on=false)=>A.honors([g],players,{includeIceTime:on}).byGame[0].stars.map(s=>[s.r.p.number,s.score]);
 assert.deepEqual(scores(game),scores(edit));assert.deepEqual(scores(game,true),scores(edit,true));
 edit.officialStats.skaters[1].toiMin=30;edit.officialStats.goalies[2].min=30;
 assert.deepEqual(scores(game),scores(edit));assert.notDeepEqual(scores(game,true),scores(edit,true));
});
