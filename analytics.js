/* Shared, non-destructive game normalization and Foxes Player Rating calculations. */
(function (root) {
  'use strict';
  const number = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const clamp = v => Math.max(0, Math.min(100, v));
  const weights = { production:30, shots:15, efficiency:10, results:15, faceoffs:10, defense:15, discipline:5 };
  const copy = x => JSON.parse(JSON.stringify(x));
  function minutes(v) {
    if (typeof v === 'string' && v.includes(':')) {
      const [m,s] = v.split(':').map(number); return m+s/60;
    }
    return number(v);
  }
  function normalize(stats = {}, players = [], legacy = null) {
    const out = copy(stats || {});
    const quick = out.schema312 ? null : (out.quickEntry295 || legacy);
    for (const [group, qgroup] of [['skaters','players'],['goalies','goalies']]) {
      const map = {};
      Object.entries(out[group] || {}).forEach(([key,r]) => {
        const p = players.find(p => p.id === r.playerId || String(p.number) === String(r.number) || p.id === key);
        map[String(r.number ?? p?.number ?? key)] = {...r};
      });
      // Legacy quick entry is used only where an official field is missing.
      Object.entries(quick?.[qgroup] || {}).forEach(([id,r]) => {
        const p = players.find(p => p.id === id);
        if (p) map[String(p.number)] = {...r, ...map[String(p.number)]};
      });
      Object.values(map).forEach(r => {
        if (group === 'skaters') {
          r.g = number(r.g ?? r.goals); r.a = number(r.a ?? r.assists);
          r.shots = number(r.shots ?? r.s ?? r.sog); r.blocks = number(r.blocks ?? r.blk);
          r.plusMinus = number(r.plusMinus ?? r.pm); r.pim = number(r.pim);
          r.fow = number(r.fow ?? r.faceoffWins);
          r.fo = number(r.fo ?? (r.fow + number(r.fol ?? r.faceoffLosses)));
          r.fol = Math.max(0,r.fo-r.fow); r.pts = r.importedPoints ?? (r.g+r.a);
          r.shotPct = r.shots ? r.g/r.shots : 0; r.foPct = r.fo ? r.fow/r.fo : 0;
          if (r.toiMin != null || r.toi != null) r.toiMin = minutes(r.toiMin ?? r.toi);
        } else {
          r.ga = number(r.ga); r.min = minutes(r.min);
          // Preserve the existing pre-1.14 interpretation of SA as saves.
          r.saves = number(r.saves ?? r.s ?? r.sa); r.sa = r.saves+r.ga;
          r.svPct = r.sa ? r.saves/r.sa : 0; r.gaa = r.min ? r.ga*36/r.min : 0;
          for (const k of ['w','l','t']) r[k] = number(r[k] ?? (r.decision === k.toUpperCase()));
          r.so = number(r.so); r.g = number(r.g); r.a = number(r.a); r.pts = r.importedPoints ?? (r.g+r.a);
        }
        if (r.gp == null) r.gp = Object.entries(r).some(([k,v]) => !['number','playerId','name','gp'].includes(k) && typeof v === 'number' && v !== 0) ? 1 : 0;
      });
      out[group] = map;
    }
    out.team = {...(out.team || {})};
    const qt = quick?.team || {};
    for(const [key,alias] of [['ppChances','ppc'],['ppSuccess','ppg'],['pkChances','pkc'],['pkSuccess','pkk'],['fow','foW'],['fol','foL']])out.team[key]=number(!out.imported && qt[alias]!=null?qt[alias]:(out.team[key] ?? qt[alias]));
    out.team.fo=number(out.team.fo ?? (out.team.fow+out.team.fol));
    for (const [key,old,q] of [['goalsFor','gf','gf'],['goalsAgainst','ga','ga'],['shotsFor','sf','sf'],['shotsAgainst','sa','sa']]) {
      if (out.team[key] == null || (!out.imported && qt[q]!=null)) out.team[key] = {...out.team[key],total:number(out.team[old] ?? qt[q])};
      for(const period of ['p1','p2','p3'])if(qt[period+q]!=null && (!out.imported || out.team[key][period]==null))out.team[key][period]=number(qt[period+q]);
    }
    if (quick) out.imported = true;
    out.schema312 = true;
    return out;
  }
  function records(game) {
    const players = game.players || [], off = normalize(game.officialStats, players);
    return players.map(p => {
      const goalie = p.pos === 'G', s = off[goalie?'goalies':'skaters'][String(p.number)];
      const events = (game.events || []).filter(e => e.playerId === p.id);
      const ge = (game.goalieEvents || []).filter(e => e.goalieId === p.id);
      const shifts = (p.shifts || []).filter(s => s.ended || s.endElapsed != null);
      const toi = shifts.reduce((a,s) => a+Math.max(0,number(s.endElapsed)-number(s.startElapsed)),0);
      const count = t => events.filter(e => e.type === t && e.team !== 'them').length;
      let r;
      if (goalie) {
        const saves = ge.filter(e => e.type === 'save').length, ga = ge.filter(e => e.type === 'ga' || e.type === 'goal').length;
        r = {...p,p,type:'goalie',gp:ge.length?1:0,min:toi/60,saves,ga,w:0,l:0,t:0,so:0,...s};
        r.sa=r.saves+r.ga; r.svPct=r.sa?r.saves/r.sa:0; r.gaa=r.min?r.ga*36/r.min:0;
      } else {
        const pm=(game.events||[]).filter(e=>e.type==='goal' && (e.onIce||[]).includes(p.id)).reduce((a,e)=>a+(e.team==='us'?(e.strength==='PP'?0:1):(e.strength==='PK'?0:-1)),0);
        const fow=count('faceoff_win')+count('faceoffWin'),fol=count('faceoff_loss')+count('faceoffLoss');
        r={...p,p,type:'skater',gp:events.length||toi?1:0,g:count('goal'),a:0,shots:count('shot')+count('goal'),blocks:count('block'),plusMinus:pm,pim:0,fo:fow+fol,fow,...s};
        r.toi=s?.toiMin!=null?minutes(s.toiMin)*60:toi; r.pm=r.plusMinus; r.pts=r.importedPoints ?? (r.g+r.a);
        r.shifts=shifts.length; r.takeaways=number(s?.tk ?? count('takeaway')); r.giveaways=number(s?.gv ?? count('giveaway')); r.chances=number(s?.ch ?? count('chance')); r.entries=count('entry');
      }
      r.played = number(r.gp)>0 || (!s && (events.length>0 || toi>0 || ge.length>0));
      return r;
    });
  }
  function rate(r, custom = weights) {
    if (!r.played) return {value:50,scores:{}};
    let scores, w;
    const useTime=custom?.includeIceTime===true;
    if (r.type === 'goalie') {
      const rate36=useTime&&r.min>0?r.sa*36/r.min:null;
      scores={production:r.sa?clamp(50+(r.svPct-.85)*250):null,
        twoWay:useTime&&r.min>0?clamp(50+(3-r.gaa)*10):null,
        usage:rate36!=null&&r.sa?clamp(50+(rate36-20)*(r.svPct-.85)*8):null,
        special:r.w||r.l||r.t?clamp(50+20*r.w-20*r.l):null,
        shutout:(!useTime||r.min>0)?clamp(50+(r.so?25:0)):null};
      w={production:50,twoWay:25,usage:10,special:10,shutout:5};
      // Playing time and shot count determine confidence, never a minutes bonus.
    } else {
      const m=r.toi/60, per36=useTime&&m>0?36/Math.max(m,3):null;
      scores={production:clamp(50+r.g*12+r.a*8),shots:clamp(50+(r.shots-2)*8),
        efficiency:per36==null?null:clamp(50+((r.pts+r.shots*.15)*per36-2)*12),
        results:clamp(50+r.pm*10),faceoffs:r.fo>0?clamp(50+(r.fow/r.fo-.5)*100*(r.fo/(r.fo+10))):null,
        defense:clamp(50+r.blocks*10),discipline:clamp(50-r.pim*6)};
      w={...weights,...custom};
    }
    let sum=0,den=0;
    for(const k of Object.keys(w)) if(scores[k]!=null) {const n=Math.max(0,number(w[k]));sum+=scores[k]*n;den+=n;}
    let value=den?sum/den:50;
    if(r.type==='goalie') value=50+(value-50)*Math.min(1,Math.max(r.sa/15,useTime?r.min/36:0));
    return {value:clamp(value),scores};
  }
  function season(games, roster = [], custom = weights) {
    const map=new Map();
    const add=p=>{const key=String(p.number ?? p.id); if(!map.has(key))map.set(key,{p,type:p.pos==='G'?'goalie':'skater',gp:0,g:0,a:0,pts:0,shots:0,pim:0,pm:0,blocks:0,fo:0,fow:0,toi:0,shifts:0,min:0,saves:0,sa:0,ga:0,w:0,l:0,t:0,so:0,history:[50],games:[],value:50,scores:{}});return map.get(key);};
    roster.forEach(add);
    [...games].sort((a,b)=>(a.date||'').localeCompare(b.date||'') || number(a.createdAt)-number(b.createdAt)).forEach(game=>{
      records(game).forEach(r=>{
        const a=add(r.p); if(!r.played)return;
        for(const k of ['gp','g','a','pts','shots','pim','pm','blocks','fo','fow','fol','ppg','ppa','ppp','shg','sha','shp','gwg','gtg','toi','shifts','min','saves','sa','ga','w','l','t','so'])a[k]=number(a[k])+number(r[k]);
        const rating=rate(r,custom);a.games.push({id:game.id,date:game.date,opponent:game.opponent,rating:rating.value,record:r});
        // Two neutral prior games stabilize early results; always recompute from scratch.
        a.value=(100+a.games.reduce((s,g)=>s+g.rating,0))/(2+a.games.length);
        a.history.push(a.value);a.scores=rating.scores;
      });
    });
    return [...map.values()].map(r=>({...r,pts:r.pts,shotPct:r.shots?r.g/r.shots:0,foPct:r.fo?r.fow/r.fo:0,svPct:r.sa?r.saves/r.sa:0,gaa:r.min?r.ga*36/r.min:0,delta:r.history.length>1?r.value-r.history[r.history.length-2]:0}));
  }
  // Automatic game honors use the existing MVP impact weights, from that game only.
  function honors(games, roster=[], options={}) {
    const totals=new Map(roster.map(p=>[String(p.number),{p,mvp:0,first:0,second:0,third:0,so:0}])), byGame=[];
    const seen=new Set();
    for(const game of games){
      if(game.id&&seen.has(game.id))continue;if(game.id)seen.add(game.id);
      const ranked=records(game).filter(r=>r.played).map(r=>{
        const n=k=>number(r[k]);
        const score=r.type==='goalie'?n('saves')*.9+Math.max(0,n('svPct')-.85)*140+n('w')*10+n('so')*18+n('pts')*7+(options.includeIceTime===true?Math.min(n('min'),60)*.12:0)-n('ga')*4-n('l')*2:
          n('g')*12+n('a')*7+n('pts')*2+n('shots')*1.25+n('entries')+n('takeaways')*3+n('blocks')*2.5-n('giveaways')*3+n('pm')*3.5+n('ppg')*2+n('ppp')*1.5+n('shg')*4+n('shp')*2+n('gwg')*5+n('gtg')*4+Math.max(0,(r.fo?r.fow/r.fo:0)-.5)*20+Math.min(n('fo'),20)*.15+(options.includeIceTime===true?Math.min(n('toi')/60,22)*.25:0)+50*.18-Math.max(0,n('pim')-4)*.5;
        return {r,score};
      }).sort((a,b)=>b.score-a.score||String(a.r.p.number).localeCompare(String(b.r.p.number)));
      let place=0;
      ranked.forEach((entry,i)=>{if(i===0||Math.abs(entry.score-ranked[i-1].score)>1e-8)place=i+1;entry.place=place;const key=String(entry.r.p.number);if(!totals.has(key))totals.set(key,{p:entry.r.p,mvp:0,first:0,second:0,third:0,so:0});const t=totals.get(key);if(place<=3)t[['first','second','third'][place-1]]++;if(place===1)t.mvp++;if(entry.r.type==='goalie')t.so+=Math.max(0,number(entry.r.so));});
      byGame.push({id:game.id,stars:ranked.filter(e=>e.place<=3)});
    }
    return {totals:[...totals.values()],byGame};
  }
  const api={number,minutes,weights,normalize,records,rate,season,honors};
  if(typeof module==='object' && module.exports)module.exports=api; else root.FoxesAnalytics=api;
})(globalThis);
