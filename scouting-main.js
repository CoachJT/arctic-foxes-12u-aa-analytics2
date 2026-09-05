'use strict';
const path=require('path');
function install({app,BrowserWindow,ipcMain,powerMonitor,readSeasonData}){
 let window=null;const vault=require('./scouting-storage').storage(app.getPath('userData'));
 const check=e=>{if(!window||e.sender!==window.webContents)throw Error('Private scouting window required.');};
 ipcMain.handle('foxes-open-private-scouting',()=>{
  if(window&&!window.isDestroyed()){window.show();window.focus();return;}
  window=new BrowserWindow({width:1250,height:920,minWidth:800,minHeight:640,title:'Private Scouting & Tryouts',autoHideMenuBar:true,backgroundColor:'#111a23',webPreferences:{preload:path.join(__dirname,'scouting-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
  window.on('minimize',()=>window?.webContents.send('scouting-lock'));
  window.on('closed',()=>{window=null;});window.loadFile(path.join(__dirname,'scouting.html'));
 });
 ipcMain.handle('scouting-season-read',e=>{check(e);return readSeasonData();});
 ipcMain.handle('scouting-vault-read',e=>{check(e);return vault.read();});
 ipcMain.handle('scouting-vault-write',(e,blob,revision)=>{check(e);return vault.write(blob,revision);});
 ipcMain.handle('scouting-roster-photo',(e,bytes)=>{check(e);if(!bytes||bytes.length>12*1024*1024)throw Error('Choose an image smaller than 12 MB.');return require('./opponent-ocr').recognize(bytes);});
 app.whenReady().then(()=>{for(const event of ['lock-screen','suspend'])powerMonitor.on(event,()=>window?.webContents.send('scouting-lock'));});
}
module.exports={install};
