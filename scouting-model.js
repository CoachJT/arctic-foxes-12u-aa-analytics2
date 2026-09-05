(function(root){
'use strict';
const norm=v=>String(v??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const teamName=v=>String(v||'').trim().replace(/\s+game\s+\d+\s*$/i,'').trim();
const season=date=>{const m=/^(\d{4})-(\d{2})/.exec(date||'');if(!m)return 'Undated';const y=Number(m[1])-(Number(m[2])<7?1:0);return `${y}–${y+1}`;};
const key=(year,team,p)=>JSON.stringify([year,norm(teamName(team)),norm(p.name),String(Number(p.number))]);
const fields=['g','a','pts','pim','penalties'];
const skills=['Skating','Puck skills','Passing','Shooting','Defensive positioning','Decisions','Effort','Coachability'];
const known=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
function roster(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>100)throw Error('Enter between 1 and 100 roster rows.');
 const seen=new Set();return rows.map((p,i)=>{
  const number=String(p.number??'').trim().replace(/^#/,''),name=String(p.name??'').trim(),position=String(p.position??'').trim().toUpperCase(),birthYear=String(p.birthYear??'').trim();
  if(!/^\d{1,3}$/.test(number)||!name)throw Error(`Row ${i+1}: enter a jersey number and name.`);
  if(seen.has(Number(number)))throw Error(`Jersey #${Number(number)} appears twice. Review the roster.`);seen.add(Number(number));
  if(position&&!['F','D','G','C','LW','RW'].includes(position))throw Error(`Row ${i+1}: position must be F, D, G, C, LW or RW.`);
  if(birthYear&&!/^\d{4}$/.test(birthYear))throw Error(`Row ${i+1}: use a four-digit birth year or leave blank.`);
  return {number:String(Number(number)),name,position,birthYear};
 });
}
function parse(text){
 return String(text).split(/\r?\n/).filter(s=>s.trim()).map(line=>{
  const cols=line.includes('\t')?line.split('\t'):line.includes(',')?line.split(','):null;
  if(cols){const [number,name,position='',birthYear='']=cols.map(s=>s.trim().replace(/^"|"$/g,''));return {number,name,position,birthYear};}
  const m=/^\s*#?(\d{1,3})\s+(.+?)\s*$/.exec(line);if(!m)return {number:'',name:line};
  const goalie=/\s*\(G\)\s*$/i.test(m[2]);return {number:m[1],name:m[2].replace(/\s*\(G\)\s*$/i,''),position:goalie?'G':'',birthYear:''};
 }).filter(r=>!/^#?$|^(jersey|number|no\.?)/i.test(r.number)&&!(norm(r.number)==='number'));
}
function photo(words){
 const lines=[];
 for(const w of [...words].sort((a,b)=>a.y-b.y||a.x-b.x)){
  const cy=w.y+w.height/2;let row=lines.find(r=>Math.abs(r.y-cy)<Math.max(5,w.height*.55));
  if(!row){row={y:cy,words:[]};lines.push(row);}row.words.push(w);
 }
 return lines.sort((a,b)=>a.y-b.y).map(r=>r.words.sort((a,b)=>a.x-b.x).map(w=>w.text).join(' ')).filter(s=>/^#?\d{1,3}\s+[^\d]/.test(s)).flatMap(s=>parse(s));
}
function resolve(k,links={}){const seen=new Set();while(links[k]&&!seen.has(k)){seen.add(k);k=links[k];}return k;}
function collect(games,store={}){
 const profiles=new Map(),seenGames=new Set(),links=store.links||{};
 for(const g of games||[]){
  if(!g.id||seenGames.has(g.id))continue;seenGames.add(g.id);
  const rosterSheet=g.command31?.opponentRoster,stats=g.command31?.opponentSheet;
  const sources=[['roster',rosterSheet],['scoresheet',stats]].filter(([,s])=>s?.players?.length);
  for(const [type,sheet] of sources){
   // A roster's team label links this game's scoresheet without rewriting game names.
   if(type==='scoresheet'&&norm(sheet.opponent)!==norm(g.opponent))continue;
   const team=teamName(rosterSheet?.team||g.opponent),year=season(g.date);
   if(!team)continue;
   for(const row of sheet.players){
    if(!/^\d{1,3}$/.test(String(row.number)))continue;
    const sourceKey=key(year,team,row),id=resolve(sourceKey,links);
    if(!profiles.has(id))profiles.set(id,{id,season:year,team,name:row.name||'Name not provided',number:String(row.number),position:'',birthYear:'',numbers:[],sourceKeys:[],sources:[],games:[],warnings:[]});
    const p=profiles.get(id);
    if(sourceKey===id){p.name=row.name||'Name not provided';p.number=String(row.number);}
    if(!p.sourceKeys.includes(sourceKey))p.sourceKeys.push(sourceKey);
    if(!p.numbers.includes(String(row.number)))p.numbers.push(String(row.number));
    if(row.position)p.position=row.position;if(row.birthYear)p.birthYear=row.birthYear;
    p.sources.push({gameId:g.id,date:g.date,kind:type,label:sheet.sourceName||'Manual entry',number:String(row.number),name:row.name});
    if(type==='scoresheet'){
     const existing=p.games.find(x=>x.id===g.id);
     if(existing){p.warnings.push('Multiple linked stat rows in one game: review the scoresheet.');continue;}
     const counts=Object.fromEntries(fields.map(k=>[k,known(row[k])?Number(row[k]):null]));
     p.games.push({id:g.id,date:g.date,opponent:g.opponent,...counts});
    }
   }
  }
 }
 for(const [id,meta] of Object.entries(store.profiles||{})){
  if(profiles.has(id)||resolve(id,links)!==id||!meta.identity)continue;
  const p=meta.identity;profiles.set(id,{...p,id,sourceKeys:[id],sources:[],games:[],numbers:p.numbers||[p.number],warnings:['No current roster or scoresheet source. Saved private notes are retained for review.']});
 }
 const rows=[...profiles.values()];
 for(const p of rows){
  p.meta=store.profiles?.[p.id]||{};p.position=p.meta.position||p.position;p.birthYear=p.meta.birthYear||p.birthYear;
  p.games.sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  p.totals=Object.fromEntries(fields.map(k=>[k,p.games.some(g=>known(g[k]))?p.games.reduce((n,g)=>n+(g[k]??0),0):null]));
  p.coverage=Object.fromEntries(fields.map(k=>[k,p.games.filter(g=>known(g[k])).length]));
  p.pointsPerGame=p.coverage.pts?p.totals.pts/p.coverage.pts:null;
  p.conflicts=rows.filter(q=>q.id!==p.id&&q.season===p.season&&norm(q.team)===norm(p.team)&&(norm(q.name)===norm(p.name)||q.numbers.some(n=>p.numbers.includes(n)))).map(q=>q.id);
  if(p.conflicts.length)p.warnings.push('Possible name or jersey change. Keep separate until reviewed.');
  if(!norm(p.name)||/^(namenotprovided|unknown)/.test(norm(p.name)))p.warnings.push('Name needs confirmation.');
 }
 return rows.sort((a,b)=>a.team.localeCompare(b.team)||a.name.localeCompare(b.name));
}
function link(store,profiles,from,to){
 const a=profiles.find(p=>p.id===from),b=profiles.find(p=>p.id===to);
 if(!a||!b||a.id===b.id||a.season!==b.season||norm(a.team)!==norm(b.team))throw Error('Choose another player from this team and season.');
 if(a.games.some(g=>b.games.some(h=>g.id===h.id)))throw Error('Both players have stats in the same game. Correct that scoresheet before linking.');
 const out=JSON.parse(JSON.stringify(store||{}));out.links=out.links||{};out.profiles=out.profiles||{};
 for(const k of [...a.sourceKeys,a.id])out.links[k]=b.id;
 const old=out.profiles[a.id]||{},dest=out.profiles[b.id]||{};
 out.profiles[b.id]={...old,...dest,evaluations:[...(old.evaluations||[]),...(dest.evaluations||[])],notes:[old.notes,dest.notes].filter(Boolean).join('\n\n')};
 return out;
}
function evaluation(input){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date||''))throw Error('Choose an observation date.');
 if(!['Game observation','Tryout','Practice'].includes(input.type))throw Error('Choose an observation type.');
 const ratings={};for(const s of skills){const v=input.ratings?.[s];if(v===''||v==null)continue;if(!Number.isInteger(Number(v))||Number(v)<1||Number(v)>5)throw Error('Skill observations must be 1–5 or blank.');ratings[s]=Number(v);}
 const notes=String(input.notes||'').trim();if(!notes&&!Object.keys(ratings).length)throw Error('Add an observation or a skill assessment.');
 return {date:input.date,type:input.type,ratings,notes};
}
const api={norm,teamName,season,key,roster,parse,photo,collect,link,evaluation,skills,fields,known};
if(typeof module==='object'&&module.exports)module.exports=api;else root.FoxesScouting=api;
})(globalThis);
