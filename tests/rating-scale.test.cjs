const {test}=require('node:test'),assert=require('node:assert/strict'),A=require('../analytics');
test('expanded scale preserves neutral, ordering and bounds',()=>{
 assert.equal(A.scaleRating(50),70);assert.ok(A.scaleRating(55)>83);assert.ok(A.scaleRating(45)<56);
 let previous=-1;for(let n=0;n<=100;n++){const v=A.scaleRating(n);assert.ok(v>previous&&v>=0&&v<=100);previous=v;}
});
test('season scales once after averaging raw scores and does not change source data',()=>{
 const p={id:'a',number:1,pos:'F'},games=[0,3].map((g,i)=>({id:String(i),date:'2026-09-0'+(i+1),players:[p],officialStats:{skaters:{1:{gp:1,g,shots:g+1}}}}));
 const before=JSON.stringify(games),r=A.season(games,[p])[0],raw=(100+r.games.reduce((n,g)=>n+g.rawRating,0))/4;
 assert.equal(r.rawValue,raw);assert.equal(r.value,A.scaleRating(raw));assert.equal(r.history.at(-1),r.value);
 assert.ok(r.games.every(g=>g.rating===A.scaleRating(g.rawRating)));assert.equal(JSON.stringify(games),before);
 assert.deepEqual(A.season(games,[p]),A.season([...games].reverse(),[p]));assert.equal(A.season([],[p])[0].value,70);
});
test('new roster members do not change another players score and goalie confidence remains applied',()=>{
 const p={id:'a',number:1,pos:'F'},g={id:'g',number:2,pos:'G'},game={id:'one',players:[p,g],officialStats:{skaters:{1:{gp:1,g:1,shots:3}},goalies:{2:{gp:1,saves:1,ga:0}}}};
 assert.equal(A.season([game],[p])[0].value,A.season([game],[p,{id:'new',number:9,pos:'D'}])[0].value);
 const r=A.records(game)[1],rating=A.rate(r);assert.equal(rating.value,A.scaleRating(rating.rawValue));assert.ok(rating.value<80);
});
