const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const workspace = require('../web/workspace.js');
const coachSource = fs.readFileSync('web/coach-qol.js', 'utf8');
function setup(rpc = async () => ({error:null})) {
  const context = {window:{PuckWorkspace:workspace}};
  vm.runInNewContext(coachSource, context);
  return context.window.FoxesCoachQol.createCoachQol({client:{rpc},getContext:()=>({teamId:'team',seasonId:'season',capabilities:['stats.edit']}),onChanged:async()=>{}});
}
test('roster is grouped by hockey position then numeric jersey without mutating source', () => {
  const roster = [{name:'Goalie',position:'G',jersey_number:'1'},{name:'Wing',position:'LW',jersey_number:'19'},{name:'Center',position:'C',jersey_number:'7'},{name:'Defense',position:'RD',jersey_number:'2'}];
  assert.deepEqual(workspace.sortRoster(roster).map(p=>p.name),['Center','Wing','Defense','Goalie']);
  assert.equal(roster[0].name,'Goalie');
});
test('undoing a first stat removes the new row rather than recording a phantom appearance', async () => {
  let payload;
  const coach = setup(async (_,args)=>{payload=args;return {error:null};});
  coach.openGame('game',[],[]);
  coach.setStat('skater','player','goals',1);
  coach.undoStat();
  assert.equal(coach.dirty,false);
  assert.equal(coach.canUndo,false);
  await coach.saveStats();
  assert.equal(payload.skater_stats.length,0);
  assert.equal(payload.target_source_game_id,'game');
  assert.equal(payload.team_stats,null);
});
test('interleaved player changes undo precisely and preserve fields outside quick entry', async () => {
  let payload;
  const coach = setup(async (_,args)=>{payload=args;return {error:null};});
  coach.openGame('game',[{source_player_id:'p',goals:2,power_play_goals:1,plus_minus:-2}],[]);
  coach.setStat('skater','p','goals',3);
  coach.setStat('goalie','g','saves',20);
  coach.undoStat();
  assert.equal(coach.dirty,true);
  await coach.saveStats();
  assert.equal(payload.skater_stats[0].goals,3);
  assert.equal(payload.skater_stats[0].power_play_goals,1);
  assert.equal(payload.skater_stats[0].plus_minus,-2);
  assert.equal(payload.goalie_stats.length,0);
});
test('negative plus/minus is valid; negative counts and fractional events are rejected', () => {
  const coach=setup();coach.openGame('game',[],[]);
  assert.equal(coach.setStat('skater','p','plus_minus',-3),-3);
  assert.throws(()=>coach.setStat('skater','p','goals',-1),/negative/);
  assert.throws(()=>coach.setStat('skater','p','goals',1.5),/whole number/);
});
test('save failure retains draft and undo history, retry sends the same scoped payload', async () => {
  const payloads=[];let failed=true;
  const coach=setup(async (_,args)=>{payloads.push(args);return {error:failed?{message:'Offline'}:null};});
  coach.openGame('game',[],[]);coach.setStat('goalie','g','saves',12);
  await assert.rejects(coach.saveStats(),/Offline/);
  assert.equal(coach.dirty,true);assert.equal(coach.canUndo,true);
  failed=false;await coach.saveStats();
  assert.deepEqual(payloads[0],payloads[1]);
  assert.equal(coach.dirty,false);assert.equal(coach.canUndo,false);
});
test('saving locks draft changes and opening another game resets undo history', async () => {
  let resolve;
  const coach=setup(()=>new Promise(r=>{resolve=r;}));
  coach.openGame('game',[],[]);coach.setStat('skater','p','shots',1);
  const save=coach.saveStats();
  assert.throws(()=>coach.setStat('skater','p','shots',2),/current save/);
  assert.equal(coach.undoStat(),null);
  resolve({error:null});await save;
  coach.openGame('other',[],[]);assert.equal(coach.canUndo,false);
});
test('player selector escapes imported names and ids', () => {
  const html=workspace.playerPicker([{name:'<img onerror=alert(1)>',source_player_id:'a"b',jersey_number:7,position:'F'}]);
  assert.doesNotMatch(html,/<img/);assert.match(html,/a&quot;b/);
});
function renderGame({future=false,readOnly=false,partial=false}={}) {
  const app=fs.readFileSync('web/app.js','utf8');
  const context={window:{PuckWorkspace:workspace,PuckGameVisibility:require('../web/game-visibility.js')},seasonContext:{branding:{}},phase1Data:{games:[{id:'row',source_game_id:'game',date:future?'2099-01-01':'2020-01-01',opponent:'Opponent'}],schedule:[{id:'schedule',linked_game_source_id:'game'}],teamStats:future?[]:[{source_game_id:'game',goals_for:0,goals_against:partial?null:0}],roster:[],playerStats:[]},PERMISSIONS:{STATS_EDIT:'edit',FILM_VIEW:'film',SCHEDULE_EDIT:'schedule',STATS_VIEW:'stats'},activeStaff:{},can:()=>!readOnly,phase1Date:x=>x,tenantName:()=> 'Team',tenantSeasonName:()=> 'Season',escapeHtml:x=>String(x??''),shell:(_t,_s,body)=>body,cardTitle:()=>'',coachQol:setup(),phase1Number:x=>Number(x||0)};
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf("let selectedGameId = ''"),app.indexOf('function bindCoachStatsControls()'))+';output=gameCenter();',context);
  return context.output;
}
test('future games never expose stat or score writes',()=>{const html=renderGame({future:true});assert.doesNotMatch(html,/data-enter-stats|data-score-form/);assert.match(html,/SCHEDULED/);});
test('read-only game viewers never receive editing controls',()=>{assert.doesNotMatch(renderGame({readOnly:true}),/data-enter-stats|data-score-form|data-open-film-room/);});
test('zero-zero is a scored tie and an incomplete score stays unavailable',()=>{assert.match(renderGame(),/TIE/);const html=renderGame({partial:true});assert.match(html,/Score unavailable/);assert.doesNotMatch(html,/>TIE</);});
