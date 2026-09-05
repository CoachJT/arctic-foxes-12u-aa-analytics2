const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('foxesStorage',{readOpponentPhoto:bytes=>ipcRenderer.invoke('test-photo',bytes)});
