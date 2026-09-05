(function(root){'use strict';
const norm=v=>String(v??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
function readPhoto(words=[]){
 const lines=[];
 [...words].sort((a,b)=>a.y-b.y||a.x-b.x).forEach(w=>{let line=lines.find(l=>Math.abs(l.y-(w.y+w.height/2))<Math.max(5,w.height*.6));if(!line){line={y:w.y+w.height/2,words:[]};lines.push(line);}line.words.push(w);});
 const players=[];let header=null;
 const aliases={'#':'number','no':'number','number':'number','player':'name','name':'name','g':'g','goals':'g','a':'a','assists':'a','pts':'pts','points':'pts','gp':'gp','pim':'pim','pen':'penalties','penalties':'penalties'};
 for(const line of lines.sort((a,b)=>a.y-b.y)){
  const ws=line.words.sort((a,b)=>a.x-b.x),merged=[];
  for(let i=0;i<ws.length;i++){const w=ws[i],next=ws[i+1],joined=next?(w.text+next.text).toLowerCase():'';if(next&&['pts','sog','pim','pen'].includes(joined)&&next.x-w.x-w.width<10){merged.push({...w,text:joined,width:next.x+next.width-w.x});i++;}else merged.push(w);}
  const columns=merged.map(w=>({...w,key:aliases[w.text.toLowerCase().replace(/\.$/,'')]}));
  if(columns.some(w=>w.key==='name')&&(columns.some(w=>w.key==='pts')||columns.some(w=>w.key==='g')&&columns.some(w=>w.key==='a'))){header=columns;continue;}
  if(!header)continue;
  const jersey=ws[0]?.text.replace(/^#/,'');if(!/^\d{1,3}$/.test(jersey||''))continue;
  const data={number:jersey,name:'',g:'',a:'',pts:''};
  const nameCol=header.find(w=>w.key==='name'),firstStat=header.find(w=>['gp','g','a','pts'].includes(w.key));
  data.name=ws.filter(w=>w!==ws[0]&&!/^\d+$/.test(w.text)&&w.x>=nameCol.x-15&&(!firstStat||w.x<firstStat.x-12)).map(w=>w.text).join(' ');
  for(const key of ['g','a','pts','pim','penalties']){const col=header.find(w=>w.key===key);if(!col)continue;const center=col.x+col.width/2,others=header.filter(w=>w!==col).map(w=>Math.abs(w.x+w.width/2-center)),limit=Math.min(25,...others.map(d=>d*.48));const found=ws.find(w=>/^\d+(\.\d+)?$/.test(w.text)&&Math.abs(w.x+w.width/2-center)<=limit);if(found)data[key]=found.text;}
  if(['g','a','pts'].some(k=>data[k]!==''))players.push(data);
 }
 return players;
}
function validate(rows){
 if(!Array.isArray(rows)||!rows.length)throw Error('Add at least one opponent player.');
 if(rows.length>100)throw Error('Use one opponent roster per game.');
 const seen=new Set();return rows.map((r,i)=>{
  const number=String(r.number??'').trim().replace(/^#/,''),name=String(r.name??'').trim();
  if(!/^\d{1,3}$/.test(number)||!name)throw Error(`Row ${i+1}: enter a jersey number and player name.`);
  const n=String(Number(number));if(seen.has(n))throw Error(`Jersey #${n} appears twice. Keep only the opponent's rows.`);seen.add(n);
  const out={number:n,name};for(const k of ['g','a','pts','pim','penalties']){const raw=String(r[k]??'').trim();if(!raw){out[k]=null;continue;}if(!(k==='pim'?/^\d+(\.\d+)?$/:/^\d+$/).test(raw)||Number(raw)>100)throw Error(`Row ${i+1}: ${k.toUpperCase()} must be ${k==='pim'?'a number':'a whole number'} from 0 to 100, or blank.`);out[k]=Number(raw);}
  if(out.g!=null&&out.a!=null){if(out.pts!=null&&out.pts!==out.g+out.a)throw Error(`Row ${i+1}: points must equal goals plus assists.`);out.pts=out.g+out.a;}
  if(['g','a','pts','pim','penalties'].every(k=>out[k]==null))throw Error(`Row ${i+1}: enter scoring or penalty stats.`);
  return out;
 });
}
function history(games,opponent,beforeDate='',excludeId=''){
 const target=norm(opponent),seen=new Set();const matches=games.filter(g=>{if(g.id&&seen.has(g.id))return false;if(g.id)seen.add(g.id);return target&&norm(g.opponent)===target&&g.id!==excludeId&&(!beforeDate||g.date&&g.date<beforeDate);}).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
 const sheets=matches.filter(g=>g.command31?.opponentSheet?.players?.length&&norm(g.command31.opponentSheet.opponent)===target);
 const latest=sheets[0],totals=new Map();
 for(const game of sheets)for(const p of game.command31.opponentSheet.players){const key=norm(p.name)+'|'+String(p.number);const row=totals.get(key)||{...p,g:0,a:0,pts:0,pim:0,penalties:0,games:0,known:{g:0,a:0,pts:0,pim:0,penalties:0}};row.games++;for(const k of ['g','a','pts','pim','penalties'])if(p[k]!=null&&Number.isFinite(Number(p[k]))){row[k]+=Number(p[k]);row.known[k]++;}totals.set(key,row);}
 return {latest,lastMeeting:matches[0],sheets,totals:[...totals.values()].sort((a,b)=>b.pts-a.pts),alerts:(latest?.command31.opponentSheet.players||[]).filter(p=>p.pts!=null&&p.pts>=3).sort((a,b)=>b.pts-a.pts)};
}
function rankings(games,metric='pts',team='',query=''){
 const teams=new Map();games.forEach(g=>{if(g.opponent?.trim())teams.set(norm(g.opponent),g.opponent);});
 const fields=['g','a','pts','pim','penalties'];if(!fields.includes(metric)&&metric!=='ppg')metric='pts';
 const rows=[];let sheets=0;
 for(const [key,opponent] of teams){const h=history(games,opponent);sheets+=h.sheets.length;
  if(team&&key!==norm(team))continue;
  h.totals.forEach(p=>{if(query&&!norm(`${p.number} ${p.name} ${opponent}`).includes(norm(query)))return;
   const ppg=p.known.pts?p.pts/p.known.pts:null,value=metric==='ppg'?ppg:p.known[metric]?p[metric]:null;
   rows.push({...p,opponent,ppg,sortValue:value,history:h.sheets.flatMap(g=>g.command31.opponentSheet.players.filter(r=>String(r.number)===String(p.number)&&norm(r.name)===norm(p.name)).map(r=>({...r,id:g.id,date:g.date})))});
  });
 }
 rows.sort((a,b)=>a.sortValue==null?(b.sortValue==null?a.name.localeCompare(b.name):1):b.sortValue==null?-1:b.sortValue-a.sortValue||a.name.localeCompare(b.name)||a.opponent.localeCompare(b.opponent));
 let rank=0;rows.forEach((r,i)=>{if(r.sortValue==null){r.rank=null;return;}if(!i||r.sortValue!==rows[i-1].sortValue)rank=i+1;r.rank=rank;});
 return {rows,sheets,teams:[...teams.values()].filter(t=>history(games,t).sheets.length).sort()};
}
const api={readPhoto,validate,history,rankings,norm};if(typeof module==='object'&&module.exports)module.exports=api;else root.FoxesOpponent=api;
})(globalThis);
