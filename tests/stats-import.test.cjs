const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const I=require('../stats-import'),A=require('../analytics'),X=require('../vendor/xlsx.full.min');
const players=[{id:'p',number:'73',name:'Landon Kowalski',pos:'F',shifts:[]},{id:'q',number:'84',name:'Évan Rosswog',pos:'D',shifts:[]},{id:'g',number:'35',name:'Hudson Bouchard',pos:'G',shifts:[]}];
const plan=(s,stats={})=>I.preview(I.parse(s),players,stats,'one');
function imported(s,stats={}){return A.normalize(I.apply(plan(s,stats),stats,players,'one'),players);}
test('CSV quoting, BOM, tabs, CRLF, semicolon and malformed input',()=>{
 assert.deepEqual(I.parse('\uFEFFPlayer,G\r\n"Kowalski, Landon",2')[1],['Kowalski, Landon','2']);
 assert.equal(I.parse('Player\tG\nLandon\t1')[1][1],'1');assert.equal(I.parse('#;G\n73;2')[1][1],'2');assert.throws(()=>I.parse('"open'));
});
test('jersey wins, normalized name fallback, unknown and ambiguous players are visible',()=>{
 const p=plan('#,Player,G\n073,Wrong Name,1\n,ROSSWOG Évan,2\n18,Unknown,3\n,Évan Rosswog,4');
 assert.equal(p.rows[0].player.id,'p');assert.ok(p.rows[0].warnings.length);assert.equal(p.rows[2].ready,false);
 const q=plan('Player,G\n"Rosswog, Evan",2');assert.equal(q.rows[0].player.id,'q');
 assert.equal(I.preview(I.parse('Player,G\nLandon Kowalski,1'),[players[0],{...players[0],number:9}],{},'one').rows[0].ready,false);
});
test('partial imports preserve old values, explicit zero overwrites and preview is pure',()=>{
 const old={team:{custom:8},skaters:{73:{g:3,a:2,shots:8,custom:'keep'},84:{g:1}},custom:true};const before=JSON.stringify(old);
 const p=plan('#,G,A,SOG\n73,0,,4',old);assert.equal(JSON.stringify(old),before);
 const out=I.apply(p,old,players,'one');assert.equal(out.skaters[73].g,0);assert.equal(out.skaters[73].a,2);assert.equal(out.skaters[73].custom,'keep');assert.deepEqual(out.skaters[84],old.skaters[84]);assert.deepEqual(out.team,old.team);assert.equal(JSON.stringify(old),before);
});
test('all skater aliases, faceoff losses and special teams reach records and season totals',()=>{
 const off=imported('#,G,A,PTS,PIM,+/-,SOG,FO W,FO L,blocked shots,PPG,PPA,SHG,SHA\n73,1,2,3,4,-2,8,7,3,2,1,2,1,1');
 const g={id:'one',players,officialStats:off},r=A.records(g)[0],s=A.season([g],players)[0];
 assert.equal(r.pts,3);assert.equal(r.pm,-2);assert.equal(r.fo,10);assert.equal(r.blocks,2);assert.equal(s.ppp,3);assert.equal(s.shp,2);assert.equal(s.fol,3);assert.equal(s.gp,1);assert.equal(s.games.length,1);
});
test('goalie SA means shots against, legacy saves remain compatible and minutes parse',()=>{
 const off=imported('#,MIN,SA,GA,W,SO,G,A\n35,18:30,20,2,1,0,0,1');const r=off.goalies[35];
 assert.equal(r.saves,18);assert.equal(r.sa,20);assert.equal(r.min,18.5);assert.equal(r.svPct,.9);
 assert.equal(A.normalize({goalies:{35:{sa:18,ga:2}}},players).goalies[35].sa,20);
 assert.equal(imported('TYPE,#,Player,GP,MIN,S,GA\nGOALIE,35,Hudson Bouchard,1,36,18,2').goalies[35].saves,18);
});
test('invalid cells and duplicates are skipped, missing GP defaults only for used rows',()=>{
 const p=plan('#,G,A\n73,bad,2\n84,-1,\n18,1,');assert.equal(p.rows[0].values.g,undefined);assert.equal(p.rows[0].values.a,2);assert.equal(p.rows[1].ready,false);
 assert.ok(plan('#,G\n73,1\n73,2').rows.every(r=>!r.ready));assert.equal(plan('#,G\n73,').rows[0].ready,false);
 assert.throws(()=>plan('#,G,Goals\n73,1,2'),/Duplicate column/);
});
test('stale game, roster and stats are rejected and reimport is idempotent',()=>{
 const p=plan('#,G\n73,1');assert.throws(()=>I.apply(p,{},players,'two'));assert.throws(()=>I.apply(p,{changed:true},players,'one'));assert.throws(()=>I.apply(p,{},players.slice(1),'one'));
 const one=imported('#,G\n73,1'),two=imported('#,G\n73,1',one);assert.deepEqual(one.skaters,two.skaters);
});
test('points-only totals survive normalization, reload and season calculations',()=>{
 const off=imported('#,PTS\n73,3');assert.equal(off.skaters[73].pts,3);assert.equal(A.season([{id:'one',players,officialStats:JSON.parse(JSON.stringify(off))}],players)[0].pts,3);
 const revised=imported('#,G,A\n73,1,1',off);assert.equal(revised.skaters[73].pts,2);
});
test('CSV and real XLSX templates round trip skaters and goalies with blanks',()=>{
 const rows=I.template(players);rows[1][4]=1;rows[3][22]=18;rows[3][24]=2;
 const csv=plan(I.csv(rows));assert.equal(csv.rows[0].values.g,1);assert.equal(csv.rows[2].values.saves,18);
 const wb=X.utils.book_new();X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(rows),'Game');X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([['#','G'],[84,2]]),'Second');
 const loaded=X.read(X.write(wb,{type:'buffer',bookType:'xlsx'}));assert.equal(loaded.SheetNames.length,2);
 const p=I.preview(X.utils.sheet_to_json(loaded.Sheets.Game,{header:1,defval:''}),players,{},'one');assert.equal(p.rows[2].values.ga,2);assert.equal(p.rows[1].ready,false);
});
test('real UI requires confirmation, cancel is pure, confirm saves only selected game',()=>{
 const elements={};const $=s=>elements[s]??=( {value:'',hidden:true,dataset:{}} );const state={currentGameId:'one',players,officialStats:{},savedGames:[{id:'one'},{id:'two',officialStats:{untouched:true}}]};let saves=0;const alerts=[];
 const ctx=vm.createContext({state,$,FoxesStatsImport:I,XLSX:X,escapeHtml:String,snapshot(){},save(){saves++;state.officialStats=A.normalize(state.officialStats,players);state.savedGames[0].officialStats=structuredClone(state.officialStats);},render(){},alert:e=>alerts.push(e),setTimeout(){},Blob,URL});
 vm.runInContext(fs.readFileSync('stats-import-ui.js','utf8'),ctx);
 vm.runInContext("importOfficialStatsText('#,G\\n73,2')",ctx);assert.equal(saves,0);$('#cancelStatsImport').onclick();assert.equal(saves,0);
 vm.runInContext("importOfficialStatsText('#,G\\n73,2')",ctx);$('#confirmStatsImport').onclick();assert.equal(saves,1);assert.equal(state.savedGames[0].officialStats.skaters[73].g,2);assert.equal(state.savedGames[1].officialStats.untouched,true);assert.equal(alerts.length,0);
});
test('new scripts parse and offline workbook reader is packaged',()=>{
 for(const f of ['stats-import.js','stats-import-ui.js'])new vm.Script(fs.readFileSync(f,'utf8'));
 const h=fs.readFileSync('index.html','utf8');assert.match(h,/stats-import-ui.js/);assert.match(h,/vendor\/xlsx.full.min.js/);const files=require('../package.json').build.files;assert.ok(files.includes('stats-import-ui.js')&&files.includes('vendor/**'));
});
