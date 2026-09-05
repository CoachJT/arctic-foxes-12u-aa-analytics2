(function(root){'use strict';
function describe(rgba,width,height){
 if(width<1||height<1||rgba.length!==width*height*4)throw Error('Invalid player image.');
 const bins=new Array(24).fill(0),gray=[];let sum=0;
 for(let i=0;i<rgba.length;i+=4){const r=rgba[i]/255,g=rgba[i+1]/255,b=rgba[i+2]/255;bins[Math.min(7,Math.floor(r*8))]++;bins[8+Math.min(7,Math.floor(g*8))]++;bins[16+Math.min(7,Math.floor(b*8))]++;const v=.299*r+.587*g+.114*b;gray.push(v);sum+=v;}
 const mean=sum/gray.length,sd=Math.sqrt(gray.reduce((n,v)=>n+(v-mean)**2,0)/gray.length);
 return {version:1,gray:gray.map(v=>(v-mean)/Math.max(.08,sd)),color:bins.map(v=>v/gray.length),detail:sd};
}
function distance(a,b){if(a.version!==b.version||a.gray.length!==b.gray.length)return Infinity;const shape=a.gray.reduce((n,v,i)=>n+Math.abs(v-b.gray[i]),0)/a.gray.length,color=a.color.reduce((n,v,i)=>n+Math.abs(v-b.color[i]),0)/a.color.length;return shape*.8+color*2;}
function suggest(feature,examples,clipId,players){
 const known=new Map();
 for(const e of examples){if(e.clipId!==clipId||!players.some(p=>p.id===e.playerId)||!e.feature)continue;const d=distance(feature,e.feature);if(!known.has(e.playerId)||d<known.get(e.playerId).distance)known.set(e.playerId,{playerId:e.playerId,distance:d});}
 const matches=[...known.values()].sort((a,b)=>a.distance-b.distance).slice(0,3);
 const distinct=known.size,clear=feature.detail>.04&&distinct>=2&&matches[0].distance<.6&&matches[1].distance-matches[0].distance>.12;
 return {matches,clear,reason:distinct<2?'Teach at least two players in this clip before comparing identities.':feature.detail<=.04?'This selection has too little visual detail.':clear?'Closest appearance match — confirm the player.':'Uncertain — similar uniforms or a different view. Choose the player yourself.'};
}
function add(examples,sample){
 if(!sample.playerId||!sample.clipId||!sample.feature||!sample.box||sample.box.width<=0||sample.box.height<=0)throw Error('Select a player and draw a box first.');
 const kept=examples.filter(e=>!(e.clipId===sample.clipId&&Math.abs(e.time-sample.time)<.25&&(e.playerId===sample.playerId||e.box&&['x','y','width','height'].every(k=>Math.abs(e.box[k]-sample.box[k])<.01))));
 const same=kept.filter(e=>e.playerId===sample.playerId&&e.clipId===sample.clipId);const drop=new Set(same.slice(0,Math.max(0,same.length-7)).map(e=>e.id));
 return [...kept.filter(e=>!drop.has(e.id)),sample].slice(-120);
}
const api={describe,distance,suggest,add};if(typeof module==='object'&&module.exports)module.exports=api;else root.FoxesPlayerLearning=api;
})(globalThis);
