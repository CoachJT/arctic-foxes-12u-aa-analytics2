// Local-only illustrative UI review. Never connects to live services.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../web');
const roster = [[27,'Alex Morgan','F'],[7,'Jamie Reed','F'],[19,'Sam Taylor','F'],[34,'Casey Brooks','D'],[4,'Jordan Lee','D'],[30,'Riley Parker','G']].map(([n,name,position]) => ({id:'p'+n,source_player_id:'p'+n,jersey_number:String(n),name,position,player_type:position==='G'?'goalie':'skater',status:'active'}));
const games = [{id:'g1',source_game_id:'g1',date:'2026-09-12',opponent:'Riverview Rangers',period_length_min:15},{id:'g2',source_game_id:'g2',date:'2026-09-10',opponent:'North Hills',period_length_min:15},{id:'g3',source_game_id:'g3',date:'2099-09-19',opponent:'Valley Penguins',period_length_min:15}];
const data = {roster,games,schedule:games.map(g=>({...g,linked_game_source_id:g.id,home_away:'Home',location:'Community Ice Arena',time:'18:30',game_type:'League'})),teamStats:[{source_game_id:'g1',goals_for:4,goals_against:2,shots_for:28,shots_against:22,power_play_success:1,power_play_chances:3,faceoff_wins:18,faceoff_losses:14},{source_game_id:'g2',goals_for:2,goals_against:3,shots_for:21,shots_against:27}],playerStats:roster.map((p,i)=>({source_player_id:p.source_player_id,source_game_id:'g1',player_type:p.player_type,gp:1,goals:i===0?2:0,assists:i===1?2:0,shots:4,plus_minus:1,saves:20,goals_against:2})),seasonRecord:{games_played:2,wins:1,losses:1,ties:0,goals_for:6,goals_against:5}};
const stub = `window.supabase={createClient:()=>({auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session:null}})},rpc:async()=>({data:{},error:location.search.includes('fail=1')?{message:'Test connection unavailable'}:null}),from:()=>{throw new Error('Preview has no data connection')}})};`;
http.createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  let file=path.resolve(root, '.'+(u.pathname==='/'?'/index.html':u.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try {
    let text=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
    if(file.endsWith('index.html')) text=text.replace(/<script src="https:[^>]+><\/script>/g,'').replace('<script src="./permissions',`<script>${stub}</script><div style="background:#48222b;padding:6px 16px;color:#fff;font:12px sans-serif;text-align:center">LOCAL DESIGN REVIEW · Illustrative fixture data · No live connection</div><script src="./permissions`);
    if(file.endsWith('app.js')) {
      text=text.replace('await loadPhase1Data(authTeam.team_id);', 'await Promise.resolve();');
      text=text.replace('  appShell.hidden = false;\n  render();',`  phase1Data = ${JSON.stringify(data)}; authCapabilities = window.FoxesPermissions.ROLE_PERMISSIONS.owner; authTeam={team_id:'fixture',teams:{name:'Arctic Foxes 12U AA'}}; seasonContext.branding={display_name:'Arctic Foxes 12U AA'}; seasonContext.selectedSeasonId='fixture-season'; seasonContext.selectedSeason={name:'2026–27',season_key:'2026-27'};\n  appShell.hidden = false;\n  render();`);
    }
    res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-store','Content-Security-Policy':"connect-src 'none'; img-src 'self' data:;"});res.end(text);
  }catch{res.writeHead(404).end('Not found');}
}).listen(4178,'127.0.0.1',()=>console.log('Local fixture preview ready on 4178'));

