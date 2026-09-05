const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const start=html.indexOf('const FOXES_ROSTER_BY_NUMBER='),end=html.indexOf('\nfunction load()',start);
const ctx=vm.createContext({});vm.runInContext(html.slice(start,end),ctx);
test('Bryson #22 is defense in new and saved rosters without changing shift or player data',()=>{
 assert.equal(vm.runInContext('freshFoxesRoster().find(p=>p.number==="22").pos',ctx),'D');
 const shift={id:'shift',startElapsed:2,endElapsed:12,position:'F',ended:true};
 const bryson={id:'custom-id',number:'22',name:'Bryson Smith',pos:'F',active:false,shifts:[shift],custom:'keep'};
 const other={id:'other',number:'24',name:'Sebastian Simelis',pos:'F',shifts:[]};
 ctx.players=[bryson,other];vm.runInContext('repairRosterNames(players)',ctx);
 assert.equal(bryson.pos,'D');assert.equal(bryson.id,'custom-id');assert.equal(bryson.custom,'keep');assert.equal(bryson.shifts[0],shift);assert.equal(shift.position,'F');assert.equal(other.pos,'F');
 const saved=JSON.stringify(ctx.players);vm.runInContext('repairRosterNames(players)',ctx);assert.equal(JSON.stringify(ctx.players),saved);
 bryson.pos='F';vm.runInContext('repairConfirmedRosterPositions(players)',ctx);assert.equal(bryson.pos,'D');
});
