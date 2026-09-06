(function(root){
'use strict';
const A=typeof module==='object'?require('./analytics'):root.FoxesAnalytics;
const T=typeof module==='object'?require('./toi-engine'):root.FoxesTOI;
const valid=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const ratio=(n,d)=>valid(n)&&valid(d)&&Number(d)>0?Number(n)/Number(d):null;
function team(g){const t=g.officialStats?.team||{},score=k=>g.officialStats?.imported&&valid(t[k]?.total)&&(!g.officialStats.importFields31||g.officialStats.importFields31.includes(k))?Number(t[k].total):null;return {id:g.id,date:g.date,opponent:g.opponent,gf:score('goalsFor'),ga:score('goalsAgainst'),sf:score('shotsFor'),sa:score('shotsAgainst'),pp:ratio(t.ppSuccess,t.ppChances),pk:ratio(t.pkSuccess,t.pkChances),fo:ratio(t.fow,t.fo??(valid(t.fol)?Number(t.fow)+Number(t.fol):null)),raw:t};}
function overview(games,roster){
 const played=games.filter(g=>A.records(g).some(r=>r.played)||g.officialStats?.imported).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
 const trends=played.map(team).map(t=>({...t,diff:t.sf!=null&&t.sa!=null?t.sf-t.sa:null}));
 const scores=trends.filter(t=>t.gf!=null&&t.ga!=null),avg=k=>{const rows=trends.filter(t=>t[k]!=null);return rows.length?rows.reduce((n,t)=>n+t[k],0)/rows.length:null;};
 const weighted=(n,d)=>{const rows=trends.filter(t=>valid(t.raw[n])&&valid(t.raw[d]));return ratio(rows.reduce((s,t)=>s+Number(t.raw[n]),0),rows.reduce((s,t)=>s+Number(t.raw[d]),0));};
 return {trends,last5:trends.slice(-5),rows:A.season(played,roster),record:scores.length?[scores.filter(t=>t.gf>t.ga).length,scores.filter(t=>t.gf<t.ga).length,scores.filter(t=>t.gf===t.ga).length].join('–'):null,gf:avg('gf'),ga:avg('ga'),diff:avg('diff'),pp:weighted('ppSuccess','ppChances'),pk:weighted('pkSuccess','pkChances'),fo:weighted('fow','fo')};
}
const leaderKeys={points:'pts',goals:'g',assists:'a',rating:'value',toi:'toi',shots:'shots',faceoffs:'foPct',blocks:'blocks'};
function leaders(rows,key,limit=5){
 const field=leaderKeys[key]||key,faceoff=key==='faceoffs';
 return rows.filter(r=>r.type==='skater'&&r.games.length&&valid(r[field])&&(!faceoff||Number(r.fo)>=10)&&(!['toi'].includes(key)||Number(r.toi)>0))
  .sort((a,b)=>Number(b[field])-Number(a[field])||String(a.p.number).localeCompare(String(b.p.number))).slice(0,limit)
  .map((r,i)=>({rank:i+1,player:r.p,value:Number(r[field]),attempts:faceoff?Number(r.fo):null}));
}
function leaderSets(rows){return Object.fromEntries(Object.keys(leaderKeys).map(key=>[key,leaders(rows,key)]));}
function usage(rows,limit=8){
 return rows.filter(r=>r.type==='skater'&&r.games.length&&valid(r.toi)&&Number(r.toi)>0)
  .sort((a,b)=>Number(b.toi)-Number(a.toi)||String(a.p.number).localeCompare(String(b.p.number))).slice(0,limit)
  .map((r,i)=>({rank:i+1,player:r.p,toi:Number(r.toi),games:r.games.length,average:Number(r.toi)/r.games.length}));
}
function playerTrend(row,key='rating'){
 if(!row?.games?.length)return [];
 return row.games.map(g=>({id:g.id,date:g.date,opponent:g.opponent,rating:g.rating,toi:g.record?.toi,shots:g.record?.shots,pts:g.record?.pts,g:g.record?.g,a:g.record?.a,blocks:g.record?.blocks,foPct:ratio(g.record?.fow,g.record?.fo)}));
}
function intervals(g){return T.shifts(g).filter(s=>s.ended&&s.confirmed&&s.videoOnTime!=null&&s.videoOffTime!=null&&s.videoOffTime>=s.videoOnTime&&(!s.endClipId||s.endClipId===s.startClipId));}
function overlaps(g){
 const rows=intervals(g),out=new Map();
 for(const clip of new Set(rows.map(s=>s.startClipId))){const r=rows.filter(s=>s.startClipId===clip),cuts=[...new Set(r.flatMap(s=>[s.videoOnTime,s.videoOffTime,...(s.iceTimePauses||[]).flatMap(p=>[Math.max(s.videoOnTime,p.start),Math.min(s.videoOffTime,p.end??s.videoOffTime)])]))].sort((a,b)=>a-b);
  for(let i=1;i<cuts.length;i++)for(const [pos,size] of [['F',3],['D',2]]){const players=[...new Map(r.filter(s=>s.position===pos&&s.videoOnTime<=cuts[i-1]&&s.videoOffTime>=cuts[i]&&!(s.iceTimePauses||[]).some(p=>p.start<cuts[i]&&(p.end??Infinity)>cuts[i-1])).map(s=>[s.playerId,s])).values()].sort((a,b)=>String(a.playerId).localeCompare(String(b.playerId)));
   if(players.length!==size)continue;const key=JSON.stringify([pos,...players.map(p=>p.playerId)]),v=out.get(key)||{pos,players,seconds:0};v.seconds+=cuts[i]-cuts[i-1];out.set(key,v);
  }
 }return [...out.values()].sort((a,b)=>b.seconds-a.seconds);
}
function quality(g){const s=T.shifts(g),c=g.toi314?.candidates||[],off=g.officialStats||{},matched=(g.players||[]).filter(p=>off[p.pos==='G'?'goalies':'skaters']?.[p.number]),unknown=c.filter(c=>!c.assignedPlayerId&&c.status!=='rejected').length,questionable=c.filter(c=>c.status==='review').length,open=s.filter(s=>!s.ended||!s.confirmed).length,goalies=A.records(g).filter(r=>r.type==='goalie'&&r.played&&r.min>0&&r.sa>0),missingVideo=s.filter(s=>s.videoOnTime==null).length;
 return {matched:matched.length,roster:(g.players||[]).length,stats:!!off.imported,goalies:goalies.length,unknown,questionable,open,missingVideo,toi:!!g.toi314?.finalizedAt&&s.length>0&&!open&&!questionable,ready:!!off.imported&&matched.length===(g.players||[]).length&&goalies.length>0&&s.length>0&&!open&&!unknown&&!questionable&&!g.toi314?.seekReview&&!!g.toi314?.finalizedAt};
}
const api={valid,ratio,team,overview,leaders,leaderSets,usage,playerTrend,intervals,overlaps,quality};if(typeof module==='object')module.exports=api;else root.FoxesCommand=api;
})(globalThis);
