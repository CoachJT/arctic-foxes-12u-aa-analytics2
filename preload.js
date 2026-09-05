
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('foxesStorage', {

  load: () => ipcRenderer.sendSync('foxes-data-load'),
  save: (jsonText) => ipcRenderer.send('foxes-data-save', jsonText),
  dataPath: () => ipcRenderer.sendSync('foxes-data-path'),
  chooseSaveFolder: () => ipcRenderer.invoke('foxes-choose-save-folder'),
  saveCopyAs: (jsonText) => ipcRenderer.invoke('foxes-save-copy-as', jsonText),
  openSaveFolder: () => ipcRenderer.invoke('foxes-open-save-folder'),
  chooseVideoFiles: () => ipcRenderer.invoke('foxes-choose-video-files'),
  updateGetState: () => ipcRenderer.invoke('foxes-update-get-state'),
  updateCheck: () => ipcRenderer.invoke('foxes-update-check'),
  updateDownload: () => ipcRenderer.invoke('foxes-update-download'),
  updateInstall: () => ipcRenderer.invoke('foxes-update-install'),
  updateOpenReleases: () => ipcRenderer.invoke('foxes-update-open-releases'),
  updateOpenLog: () => ipcRenderer.invoke('foxes-update-open-log'),
  onUpdateState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('foxes-update-state', handler);
    return () => ipcRenderer.removeListener('foxes-update-state', handler);
  }
});
