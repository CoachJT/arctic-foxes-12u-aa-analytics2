const {app,BrowserWindow,ipcMain,powerMonitor}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const out=path.join(__dirname,'../dist/scouting-check'),testDir=path.join(out,'session-'+Date.now());fs.mkdirSync(testDir,{recursive:true});app.setPath('userData',testDir);
const roster=[{id:'fox16',number:'16',name:'Ellis Tigano',pos:'F',shifts:[]},{id:'fox22',number:'22',name:'Bryson Smith',pos:'D',shifts:[]}];
const opponent='Gilmour Academy Game 1';
let fixture={players:roster,currentGameId:'demo',gameDate:'2026-08-29',opponent,savedGames:[{id:'demo',date:'2026-08-29',opponent,players:roster,officialStats:{imported:true,skaters:{16:{gp:1,g:1,a:0,shots:2,pim:0},22:{gp:1,g:0,a:0,shots:1,pim:0}},goalies:{},team:{}},command31:{opponentSheet:{opponent,sourceName:'Example scoresheet',players:[{number:'15',name:'Branson Winfield',g:1,a:null,pts:1,pim:null,penalties:null},{number:'38',name:'Adin Farrow',g:1,a:null,pts:1,pim:1.5,penalties:1}]}}}]};
const original=JSON.stringify(fixture);let seasonWrites=0;
ipcMain.on('foxes-data-load',e=>{e.returnValue=JSON.stringify(fixture);});ipcMain.on('foxes-data-save',()=>{seasonWrites++;});ipcMain.on('foxes-data-path',e=>{e.returnValue='Isolated test fixture';});
ipcMain.handle('foxes-update-get-state',()=>({status:'dev',currentVersion:'4.1.0'}));
require('../scouting-main').install({app,BrowserWindow,ipcMain,powerMonitor,readSeasonData:()=>JSON.stringify(fixture)});
async function wait(w,expression){const until=Date.now()+12000;while(Date.now()<until){if(await w.webContents.executeJavaScript(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expression);}
async function run(w,code){return w.webContents.executeJavaScript(code);}
async function screenshot(w,name){await run(w,"document.querySelector('.gate,.shell').insertAdjacentHTML('afterbegin','<p class=eyebrow>TEST PREVIEW · EXAMPLE DATA</p>');window.scrollTo(0,0)");await new Promise(r=>setTimeout(r,200));fs.writeFileSync(path.join(out,name),(await w.webContents.capturePage()).toPNG());}
app.whenReady().then(async()=>{
 const main=new BrowserWindow({show:false,width:1250,height:900,webPreferences:{preload:path.join(__dirname,'../preload.js'),contextIsolation:true}});
 await main.loadFile(path.join(__dirname,'../index.html'));
 await wait(main,"!!document.querySelector('#openPrivateScouting')");
 const before=await run(main,'JSON.stringify(state.officialStats)'),writesBefore=seasonWrites;
 await run(main,"document.querySelector('#openPrivateScouting').click()");
 await new Promise(r=>setTimeout(r,700));const w=BrowserWindow.getAllWindows().find(x=>x!==main);assert.ok(w);const errors=[];w.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
 await wait(w,"!!document.querySelector('#confirmPassword')");await screenshot(w,'password-setup.png');
 await run(w,"document.querySelector('#password').value='test-preview-password';document.querySelector('#confirmPassword').value='test-preview-password';document.querySelector('#unlockForm').requestSubmit()");
 await wait(w,"!!document.querySelector('#importRoster')");assert.match(await run(w,'document.body.innerText'),/Branson Winfield/);
 await run(w,"document.querySelector('#importRoster').click();document.querySelector('#rosterPaste').value='15,Branson Winfield,F,2014\\n38,Adin Farrow,F,2014\\n1,Lincoln Krill,,2014';document.querySelector('#previewRoster').click()");
 assert.equal(await run(w,"document.querySelectorAll('#rosterReview tbody tr').length"),3);
 await run(w,"document.querySelector('#confirmRoster').click()");await wait(w,"document.querySelectorAll('[data-player]').length===3");
 await run(w,"[...document.querySelectorAll('[data-player]')].find(b=>b.textContent.includes('Branson')).click();document.querySelector('#notes').value='Private test note: watch transition decisions';document.querySelector('#profileStatus').value='Watch again';document.querySelector('#profileForm').requestSubmit()");
 await wait(w,"document.querySelector('#status').textContent.includes('saved and encrypted')");
 await run(w,"document.querySelector('#foxPlayer').value='16';document.querySelector('#foxPlayer').dispatchEvent(new Event('change'));document.querySelector('[data-skill=Skating]').value='4';document.querySelector('#evaluationNotes').value='Example observation: quick recovery';document.querySelector('#evaluationForm').requestSubmit()");
 await wait(w,"document.querySelector('#status').textContent.includes('Dated observation')");assert.match(await run(w,"document.querySelector('#comparison').textContent"),/Ellis Tigano/);
 await screenshot(w,'scouting-dashboard.png');
 const blob=JSON.parse(fs.readFileSync(path.join(testDir,'foxes-private-scouting.enc.json'),'utf8'));assert.ok(blob.ciphertext);assert.equal(JSON.stringify(blob).includes('Private test note'),false);
 assert.equal(await run(main,'JSON.stringify(state.officialStats)'),before);assert.equal(JSON.stringify(fixture),original);assert.equal(seasonWrites,writesBefore);
 await run(w,"document.querySelector('#lock').click()");await wait(w,"!!document.querySelector('#password')");assert.doesNotMatch(await run(w,'document.body.innerText'),/Branson|Private test note/);
 await run(w,"document.querySelector('#password').value='wrong-password';document.querySelector('#unlockForm').requestSubmit()");await wait(w,"document.querySelector('#status').textContent.includes('Could not unlock')");
 await run(w,"document.querySelector('#password').value='test-preview-password';document.querySelector('#unlockForm').requestSubmit()");await wait(w,"!!document.querySelector('#notes')");
 await run(w,"[...document.querySelectorAll('[data-player]')].find(b=>b.textContent.includes('Branson')).click()");assert.match(await run(w,"document.querySelector('#notes').value"),/Private test note/);
 // New scoresheets appear automatically on focus, without changing the private notes.
 fixture.savedGames.push({...structuredClone(fixture.savedGames[0]),id:'demo2',date:'2026-09-01'});
 await run(w,"window.dispatchEvent(new Event('focus'))");await wait(w,"document.querySelector('#status').textContent.includes('updated from the saved season')");assert.match(await run(w,"document.querySelector('#notes').value"),/Private test note/);
 // The render clears decrypted information when the idle timeout expires.
 await run(w,"window.originalNow=Date.now;const later=Date.now()+360000;Date.now=()=>later;undefined");await wait(w,"!!document.querySelector('#password')");assert.doesNotMatch(await run(w,'document.body.innerText'),/Private test note/);await run(w,'Date.now=window.originalNow;undefined');
 await screenshot(w,'locked-workspace.png');assert.deepEqual(errors,[]);
 console.log('PASS: separate window, setup/unlock/wrong password, roster review, private notes, evaluations, comparison, encrypted persistence, automatic scoresheet refresh, idle locking, and no season writes.');
 app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
