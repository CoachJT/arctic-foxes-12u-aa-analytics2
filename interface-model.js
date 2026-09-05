/* Read-only presentation helpers. The 3.0.12 analytics engine remains authoritative. */
(function(root){
  'use strict';
  const A=typeof module==='object'&&module.exports?require('./analytics'):root.FoxesAnalytics;
  const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const localDate=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  function gameSummary(game,today=localDate()){
    const records=A.records(game),off=game.officialStats||{},team=off.team||{};
    const gf=team.goalsFor?.total,ga=team.goalsAgainst?.total;
    const final=['final','complete','completed'].includes(String(game.status||'').toLowerCase());
    // Empty 3.0.12 records contain default 0–0 totals. They are not results.
    const scored=!!off.imported&&finite(gf)&&finite(ga)&&(Number(gf)+Number(ga)>0||final);
    const stats=records.some(r=>r.played)||(game.events||[]).length>0||(game.goalieEvents||[]).length>0||scored;
    const shifts=(game.players||[]).reduce((n,p)=>n+(p.shifts||[]).filter(s=>s.ended||s.endElapsed!=null).length,0);
    const film=(game.filmClips||[]).length;
    const played=stats&&(!game.date||game.date<=today);
    return {game,stats,played,shifts,film,scored,gf:scored?Number(gf):null,ga:scored?Number(ga):null,
      result:scored?(Number(gf)>Number(ga)?'W':Number(gf)<Number(ga)?'L':'T'):null,
      status:stats?(shifts?'Stats & shifts recorded':'Stats recorded'):(shifts?'Shifts recorded':film?'Film attached':'Not started')};
  }
  function nextGame(schedule,games,now=new Date()){
    const today=localDate(now),clock=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const source=[...schedule];
    games.forEach(g=>{if(!source.some(s=>s.linkedGameId===g.id||(s.date===g.date&&String(s.opponent).toLowerCase()===String(g.opponent).toLowerCase())))source.push({...g,linkedGameId:g.id});});
    return source.filter(g=>g.date&&(g.date>today||(g.date===today&&(!g.time||g.time>=clock)))&&!['cancelled','canceled','final','complete','completed'].includes(String(g.status||'').toLowerCase()))
      .filter(g=>{const saved=games.find(x=>x.id===(g.linkedGameId||g.id));return !saved||!gameSummary(saved,today).played;})
      .sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'23:59').localeCompare(b.time||'23:59'))[0]||null;
  }
  function leader(rows,value,eligible=()=>true){
    const candidates=rows.filter(eligible).map(r=>({row:r,value:value(r)})).filter(x=>finite(x.value));
    candidates.sort((a,b)=>b.value-a.value);
    if(!candidates.length)return null;
    return {...candidates[0],ties:candidates.filter(x=>Math.abs(x.value-candidates[0].value)<.000001).length};
  }
  function dashboard(games,roster,schedule,weights,now=new Date()){
    const summaries=games.map(g=>gameSummary(g,localDate(now))),played=summaries.filter(g=>g.played),scored=played.filter(g=>g.scored);
    const rows=A.season(games,roster,weights),rated=rows.filter(r=>r.games.length>0);
    const efficiency=r=>{const withTime=r.games.filter(g=>g.record.toi>0);return withTime.length?withTime.reduce((n,g)=>n+g.record.pts,0)*2160/withTime.reduce((n,g)=>n+g.record.toi,0):null;};
    return {next:nextGame(schedule,games,now),rows,played:played.length,scored:scored.length,
      record:scored.length?['W','L','T'].map(k=>scored.filter(g=>g.result===k).length).join('–'):null,
      gf:scored.length?scored.reduce((n,g)=>n+g.gf,0):null,ga:scored.length?scored.reduce((n,g)=>n+g.ga,0):null,
      teamRating:rated.length?rated.reduce((n,r)=>n+r.value,0)/rated.length:null,
      recent:[...summaries].sort((a,b)=>(b.game.date||'').localeCompare(a.game.date||'')||(b.game.updatedAt||0)-(a.game.updatedAt||0)).slice(0,5),
      leaders:{rating:leader(rated,r=>r.value),riser:leader(rated,r=>r.delta,r=>r.delta>0),
        points:leader(rated,r=>r.pts,r=>r.type==='skater'&&r.pts>0),
        efficiency:leader(rated,efficiency,r=>r.type==='skater'&&efficiency(r)>0),
        goalie:leader(rated,r=>r.svPct,r=>r.type==='goalie'&&r.sa>0)}};
  }
  function actionContext(page,hasGame,hasUndo){
    return {csv:hasGame&&['film','tracking','stats','quickstats','analytics','mygames'].includes(page),
      undo:hasGame&&hasUndo&&['film','tracking','stats','quickstats','mygames'].includes(page)};
  }
  function trend(delta){return delta>.05?'rising':delta<-.05?'falling':'stable';}
  const api={localDate,gameSummary,nextGame,dashboard,actionContext,trend};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.FoxesInterface=api;
})(globalThis);
