/* Pure import planning. No game state is changed until the UI confirms a plan. */
(function(root){
'use strict';
const norm=v=>String(v??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const name=v=>String(v??'').split(',').reverse().map(norm).join('');
const jersey=v=>/^#?\s*\d+$/.test(String(v).trim())?String(Number(String(v).replace('#','').trim())):'';
const aliases={number:['player #','jersey #','#','number','jersey','jersey number','no'],name:['player','name','player name'],type:['type','position','pos'],ch:['ch','chances','scoring chances'],tk:['tk','takeaways'],gv:['gv','giveaways'],gp:['gp','games played'],g:['g','goals'],a:['a','assists'],pts:['pts','points'],shots:['s','sog','shots','shots on goal'],pim:['pim','penalty minutes'],plusMinus:['+/-','plus minus','pm'],blocks:['blocks','blk','blocked shots'],fo:['fo','faceoffs','faceoff attempts'],fow:['fow','fo w','faceoff wins'],fol:['fol','fo l','faceoff losses'],ppg:['ppg','pp goals'],ppa:['ppa','pp assists'],ppp:['ppp','pp points'],shg:['shg','sh goals'],sha:['sha','sh assists'],shp:['shp','sh points'],gwg:['gwg'],gtg:['gtg'],min:['min','minutes'],saves:['saves','sv'],sa:['sa','shots against'],ga:['ga','goals against'],w:['w','wins'],l:['l','losses'],t:['t','ties'],so:['so','shutouts'],svPct:['sv%','save percentage'],gaa:['gaa'],shotPct:['s%','shot percentage'],foPct:['fo%']};
const key=v=>!String(v??'').trim()?undefined:String(v).trim()==='+/-'?'plusMinus':Object.keys(aliases).find(k=>aliases[k].some(a=>norm(a)===norm(v)&&String(a).includes('%')===String(v).includes('%')&&String(a).includes('#')===String(v).includes('#')));
const clone=v=>JSON.parse(JSON.stringify(v));
function parse(text){
 text=String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
 const first=text.split('\n')[0],delim=first.includes('\t')?'\t':first.includes(';')&&!first.includes(',')?';':',';
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===delim||c==='\n')){row.push(field.trim());field='';if(c==='\n'){rows.push(row);row=[];}}else field+=c;}
 if(quoted)throw Error('Unclosed quote in spreadsheet data.');
 row.push(field.trim());rows.push(row);return rows;
}
function preview(rows,players,stats,gameId,sourceName='pasted data'){
 if(!gameId)throw Error('Create or open a saved game in My Games first.');
 if(rows.length>10000)throw Error('Use a sheet for one game (at most 10,000 rows).');
 const plan={gameId,sourceName,rows:[],warnings:[],base:JSON.stringify(stats),roster:JSON.stringify(players.map(p=>[p.id,p.number,p.name,p.pos]))};
 let headers=null;
 rows.forEach((row,index)=>{
  if(!row.some(v=>String(v??'').trim()))return;
  const h=row.map(key);
  if((h.includes('number')||h.includes('name'))&&h.some(k=>k&&!['number','name','type'].includes(k))){
   headers=h;const seen=new Set();h.forEach((k,i)=>{if(k&&seen.has(k))throw Error('Duplicate column: '+row[i]);if(k)seen.add(k);else if(row[i])plan.warnings.push('Ignored column: '+row[i]);});return;
  }
  const item={line:index+1,label:row.join(' | '),warnings:[],values:{},player:null};plan.rows.push(item);
  if(!headers){item.warnings.push('Skipped: no recognized header above this row.');return;}
  const cells={};headers.forEach((k,i)=>{if(k&&String(row[i]??'').trim()!=='')cells[k]=row[i];});
  const n=jersey(cells.number??''),nm=name(cells.name??'');
  let matches=n?players.filter(p=>jersey(p.number)===n):[];let method='jersey';
  if(!matches.length&&nm){matches=players.filter(p=>name(p.name)===nm);method='name';}
  if(matches.length!==1){item.warnings.push(matches.length?'Ambiguous player; row skipped.':'Unmatched player; row skipped.');return;}
  item.player=clone(matches[0]);item.method=method;
  if(method==='jersey'&&nm&&name(item.player.name)!==nm)item.warnings.push('Name differs; matched by jersey number.');
  if(method==='name'&&n)item.warnings.push('Jersey differs; matched by name.');
  const goalie=item.player.pos==='G';item.group=goalie?'goalies':'skaters';
  if(cells.type&&['goalie','g','skater'].includes(norm(cells.type))&&(['goalie','g'].includes(norm(cells.type))!==goalie)){item.warnings.push('Position conflicts with roster; row skipped.');item.player=null;return;}
  for(const [k,raw] of Object.entries(cells)){
   if(['number','name','type'].includes(k))continue;
   let field=goalie&&k==='shots'?'saves':k;
   if(!goalie&&['min','saves','sa','ga','w','l','t','so','svPct','gaa'].includes(field)){item.warnings.push('Ignored goalie field '+field);continue;}
   if(['svPct','gaa','shotPct','foPct'].includes(field)){item.warnings.push(field+' is calculated from counts.');continue;}
   const s=String(raw).trim();let v=Number(s.replace(/,/g,''));
   if(field==='min'&&/^\d+:\d{2}$/.test(s)&&Number(s.split(':')[1])<60)v=Number(s.split(':')[0])+Number(s.split(':')[1])/60;
   if(!Number.isFinite(v)||Math.abs(v)>100000||v<0&&field!=='plusMinus'||!['min','pim'].includes(field)&&!Number.isInteger(v)){item.warnings.push('Invalid '+field+': '+s+'; cell skipped.');continue;}
   item.values[field]=v;
  }
  if(!Object.keys(item.values).length){item.warnings.push('No usable stats; row skipped.');return;}
  const old=stats?.[item.group]?.[String(item.player.number)]||{};
  const v=item.values,merged={...old,...v};
  if(v.pts!=null){if(v.g==null&&v.a==null){v.importedPoints=v.pts;item.warnings.push('Points total supplied without G/A breakdown.');}else if(v.g==null&&v.pts>=v.a)v.g=v.pts-v.a;else if(v.a==null&&v.pts>=v.g)v.a=v.pts-v.g;else if(v.pts!==merged.g+merged.a)item.warnings.push('PTS differs from G + A; calculated points will be used.');delete v.pts;}
  if(v.g!=null||v.a!=null)v.importedPoints=null;
  if(v.fol!=null){v.fo=(v.fow??old.fow??0)+v.fol;}else if(v.fow!=null&&v.fo==null)v.fo=v.fow+(old.fol??Math.max(0,(old.fo||0)-(old.fow||0))); 
  if(v.fo!=null&&(v.fow??old.fow??0)>v.fo){item.warnings.push('Faceoff wins exceed attempts; faceoff cells skipped.');delete v.fo;delete v.fow;delete v.fol;}
  if(goalie&&v.sa!=null){const ga=v.ga??old.ga??0;if(v.sa<ga){item.warnings.push('Shots against below goals against; SA skipped.');delete v.sa;}else if(v.saves==null)v.saves=v.sa-ga;else if(v.sa!==v.saves+ga)item.warnings.push('SA differs from saves + GA; calculated SA will be used.');}
  for(const [g,a,p] of [['ppg','ppa','ppp'],['shg','sha','shp']])if(v[a]!=null)v[p]=(v[g]??old[g]??0)+v[a];
  if(Object.keys(v).length&&v.gp==null)v.gp=1;
 });
 const counts={};plan.rows.forEach(r=>{if(r.player&&Object.keys(r.values).length){const n=String(r.player.number);counts[n]=(counts[n]||0)+1;}});
 plan.rows.forEach(r=>{r.ready=!!r.player&&Object.keys(r.values).length>0;if(r.ready&&counts[String(r.player.number)]>1){r.ready=false;r.warnings.push('Duplicate player rows; resolve in the sheet before importing.');}});
 return plan;
}
function apply(plan,stats,players,gameId){
 if(!plan)throw Error('Preview a spreadsheet before confirming.');
 if(gameId!==plan.gameId||JSON.stringify(stats)!==plan.base||JSON.stringify(players.map(p=>[p.id,p.number,p.name,p.pos]))!==plan.roster)throw Error('Game, roster or stats changed. Preview the sheet again.');
 const rows=plan.rows.filter(r=>r.ready);if(!rows.length)throw Error('No matched rows with usable stats to import.');
 const out=clone(stats||{});out.skaters=out.skaters||{};out.goalies=out.goalies||{};
 rows.forEach(r=>{const n=String(r.player.number);out[r.group][n]={...out[r.group][n],...r.values,number:r.player.number,name:r.player.name,playerId:r.player.id};});
 out.imported=true;out.sourceName=plan.sourceName;out.importedAt=new Date().toISOString();return out;
}
const headers=['TYPE','#','Player','GP','G','A','PTS','SOG','PIM','+/-','Blocks','FO W','FO L','PPG','PPA','PPP','SHG','SHA','SHP','GWG','GTG','MIN','Saves','SA','GA','W','L','T','SO','CH','TK','GV'];
function template(players){return [headers,...players.map(p=>headers.map(h=>h==='TYPE'?(p.pos==='G'?'GOALIE':'SKATER'):h==='#'?String(p.number):h==='Player'?p.name:''))];}
function csv(rows){return '\uFEFF'+rows.map((r,i)=>r.map((v,j)=>{let s=String(v??'');if(i>0&&j===2&&/^[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');}
const api={parse,preview,apply,template,csv};if(typeof module==='object'&&module.exports)module.exports=api;else root.FoxesStatsImport=api;
})(globalThis);
