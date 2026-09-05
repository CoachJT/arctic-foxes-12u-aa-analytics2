'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('scoutingBridge',{
 season:()=>ipcRenderer.invoke('scouting-season-read'),
 read:()=>ipcRenderer.invoke('scouting-vault-read'),
 write:(blob,revision)=>ipcRenderer.invoke('scouting-vault-write',blob,revision),
 photo:bytes=>ipcRenderer.invoke('scouting-roster-photo',bytes),
 onLock:callback=>ipcRenderer.on('scouting-lock',()=>callback())
});
