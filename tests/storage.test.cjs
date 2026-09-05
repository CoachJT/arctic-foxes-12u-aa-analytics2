const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const A=require('../analytics');
const html=fs.readFileSync('index.html','utf8');
function source(name){const start=html.indexOf('function '+name+'(');assert.ok(start>=0);const next=html.indexOf('\nfunction ',start+1);return html.slice(start,next).trim();}
test('real snapshot/save preserves custom metadata, film, tags, roster, and separate games',()=>{
 const p={id:'p',number:'13',name:'Custom Name',pos:'F',shifts:[{startElapsed:0,endElapsed:30,ended:true}]};
 const first={id:'one',date:'2026-09-01',opponent:'One',customMetadata:{keep:true},players:[p],officialStats:{skaters:{13:{gp:1,g:1}}},filmClips:[{id:'clip',path:'C:/film.mp4'}],events:[{type:'shot',playerId:'p',clipId:'clip',videoTime:4}],playerTags:{p:'tag'},syncPoints:[{videoTime:4}],createdAt:1};
 const second={id:'two',players:[p],officialStats:{skaters:{13:{gp:1,g:3}}}};
 const state={...structuredClone(first),currentGameId:'one',gameDate:first.date,savedGames:structuredClone([first,second]),running:false,ratingWeights312:{...A.weights},settings:{keep:true}};
 const writes=[];const ctx=vm.createContext({state,FoxesAnalytics:A,deepClone:structuredClone,emptyOfficialStats:()=>({}),crypto:require('crypto').webcrypto,LSKEY:'test',localStorage:{setItem:(_k,v)=>writes.push(v)},window:{foxesStorage:{save:v=>writes.push(v)}}});
 vm.runInContext(source('currentGameSnapshot')+'\n'+source('syncCurrentGameSnapshot')+'\n'+source('save'),ctx);
 vm.runInContext('state.officialStats.skaters[13].g=2;save();',ctx);
 const saved=JSON.parse(writes.at(-1));assert.equal(saved.savedGames[0].officialStats.skaters[13].g,2);assert.equal(saved.savedGames[1].officialStats.skaters[13].g,3);assert.deepEqual(saved.savedGames[0].customMetadata,{keep:true});assert.deepEqual(saved.savedGames[0].filmClips,first.filmClips);assert.deepEqual(saved.savedGames[0].events,first.events);assert.deepEqual(saved.savedGames[0].playerTags,first.playerTags);assert.deepEqual(saved.savedGames[0].syncPoints,first.syncPoints);assert.equal(saved.players[0].name,'Custom Name');assert.deepEqual(saved.settings,{keep:true});assert.deepEqual(saved.ratingWeights312,A.weights);
});
test('existing precision seek clamps timestamps and pauses film',()=>{
 const video={duration:20,currentTime:4,paused:false,pause(){this.paused=true;}};
 const ctx=vm.createContext({video,$:()=>({textContent:''}),formatVideoTime:String,render:()=>{}});
 // seekVideo is followed by event bindings rather than another function.
 const seek=html.match(/function seekVideo\(delta\)\{[\s\S]*?\n\}/)[0];vm.runInContext(seek,ctx);
 vm.runInContext('seekVideo(.25)',ctx);assert.equal(video.currentTime,4.25);assert.ok(video.paused);
 vm.runInContext('seekVideo(-10)',ctx);assert.equal(video.currentTime,0);vm.runInContext('seekVideo(50)',ctx);assert.equal(video.currentTime,20);
});
