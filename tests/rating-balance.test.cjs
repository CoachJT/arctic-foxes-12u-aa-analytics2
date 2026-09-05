const {test}=require('node:test'),assert=require('node:assert/strict'),A=require('../analytics');
const base={played:true,type:'skater',g:0,a:0,pts:0,shots:2,pm:0,blocks:0,pim:0,fo:0,fow:0,toi:0};
test('faceoff confidence grows with attempts and keeps fifty percent neutral',()=>{
 const score=(fo,fow)=>A.rate({...base,fo,fow}).scores.faceoffs;
 assert.equal(score(0,0),null);assert.equal(score(10,5),50);
 assert.ok(score(1,1)>50&&score(1,1)<55);assert.ok(score(10,10)>score(1,1));
 assert.ok(score(1,0)<50&&score(1,0)>45);assert.ok(score(10,0)<score(1,0));
});
test('balanced categories sum to 100 and disabled efficiency redistributes without a penalty',()=>{
 assert.equal(Object.values(A.weights).reduce((n,w)=>n+w,0),100);
 const r={...base,g:1,pts:1,shots:4,blocks:2};const rating=A.rate(r);
 const available=Object.entries(A.weights).filter(([key])=>rating.scores[key]!=null);
 assert.equal(rating.rawValue,available.reduce((n,[k,w])=>n+w*rating.scores[k],0)/available.reduce((n,[,w])=>n+w,0));
 assert.equal(A.rate({...r,toi:600}).value,rating.value);
 assert.equal(A.rate({...base,blocks:2}).value>A.rate(base).value,true);
 assert.equal(A.rate({...base,pim:4}).value<A.rate(base).value,true);
});
test('custom category weights continue to be honored',()=>{
 const custom=Object.fromEntries(Object.keys(A.weights).map(k=>[k,k==='production'?100:0]));
 const r={...base,g:1,pts:1};assert.equal(A.rate(r,custom).rawValue,A.rate(r).scores.production);
});
