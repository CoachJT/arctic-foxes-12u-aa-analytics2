
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
ipcMain.handle('foxes-opponent-photo', (_event, bytes) => require('./opponent-ocr').recognize(bytes));

// Stable application settings folder across every version.
app.setPath('userData', path.join(app.getPath('appData'), 'ArcticFoxesBY14HockeyAnalytics'));

const settingsFile = path.join(app.getPath('userData'), 'storage-settings.json');
const defaultDataDir = app.getPath('userData');
const defaultDataFileName = 'foxes-season-data.json';
const previousFileName = 'foxes-season-data.previous.json';
require('./scouting-main').install({app,BrowserWindow,ipcMain,powerMonitor:require('electron').powerMonitor,readSeasonData});

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readStorageSettings() {
  try {
    ensureDir(app.getPath('userData'));
    if (!fs.existsSync(settingsFile)) return {};
    const obj = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    return obj && typeof obj === 'object' ? obj : {};
  } catch (err) {
    console.error('Could not read storage settings:', err);
    return {};
  }
}

function writeStorageSettings(settings) {
  try {
    ensureDir(app.getPath('userData'));
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('Could not write storage settings:', err);
  }
}

function dataDir() {
  const s = readStorageSettings();
  const candidate = typeof s.autoSaveDir === 'string' && s.autoSaveDir.trim()
    ? s.autoSaveDir.trim()
    : defaultDataDir;
  try {
    ensureDir(candidate);
    return candidate;
  } catch (err) {
    console.error('Chosen save directory unavailable, using default:', err);
    ensureDir(defaultDataDir);
    return defaultDataDir;
  }
}

function dataFile() {
  return path.join(dataDir(), defaultDataFileName);
}

function backupFile() {
  return path.join(dataDir(), previousFileName);
}

function readSeasonData() {
  try {
    const file = dataFile();
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.error('Could not read Foxes season data:', err);
    return null;
  }
}

function writeSeasonData(jsonText) {
  try {
    JSON.parse(jsonText); // validate before replacing anything
    const dir = dataDir();
    ensureDir(dir);
    const file = dataFile();
    const prev = backupFile();

    if (fs.existsSync(file)) {
      fs.copyFileSync(file, prev);
    }

    const tempFile = file + '.tmp';
    fs.writeFileSync(tempFile, jsonText, 'utf8');
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.renameSync(tempFile, file);
    return true;
  } catch (err) {
    console.error('Could not save Foxes season data:', err);
    return false;
  }
}

ipcMain.on('foxes-data-load', (event) => {
  event.returnValue = readSeasonData();
});

ipcMain.on('foxes-data-save', (_event, jsonText) => {
  if (typeof jsonText === 'string') writeSeasonData(jsonText);
});

ipcMain.on('foxes-data-path', (event) => {
  event.returnValue = dataFile();
});

ipcMain.handle('foxes-choose-save-folder', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose Arctic Foxes Season Save Folder',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };

  const newDir = result.filePaths[0];
  try {
    ensureDir(newDir);

    // Preserve the current season data by copying it into the newly chosen folder.
    const currentRaw = readSeasonData();
    const settings = readStorageSettings();
    settings.autoSaveDir = newDir;
    writeStorageSettings(settings);

    if (currentRaw) {
      const target = path.join(newDir, defaultDataFileName);
      const prevTarget = path.join(newDir, previousFileName);
      if (fs.existsSync(target)) fs.copyFileSync(target, prevTarget);
      fs.writeFileSync(target, currentRaw, 'utf8');
    }

    return { canceled: false, path: dataFile() };
  } catch (err) {
    console.error('Could not change save folder:', err);
    return { canceled: false, error: String(err.message || err) };
  }
});

ipcMain.handle('foxes-save-copy-as', async (_event, jsonText) => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showSaveDialog(win, {
    title: 'Save Arctic Foxes Season Copy',
    defaultPath: path.join(app.getPath('documents'), 'Arctic-Foxes-BY14-Season-Backup.json'),
    filters: [{ name: 'JSON Season Backup', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  try {
    JSON.parse(jsonText);
    fs.writeFileSync(result.filePath, jsonText, 'utf8');
    return { canceled: false, path: result.filePath };
  } catch (err) {
    return { canceled: false, error: String(err.message || err) };
  }
});


ipcMain.handle('foxes-choose-video-files', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose LiveBarn Video Clip(s)',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video Files', extensions: ['mp4','mov','m4v','webm','avi','mkv'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true, files: [] };
  return {
    canceled: false,
    files: result.filePaths.map(p => ({
      name: path.basename(p),
      path: p,
      url: pathToFileURL(p).href
    }))
  };
});

ipcMain.handle('foxes-open-save-folder', async () => {
  try {
    const dir = dataDir();
    ensureDir(dir);
    const err = await shell.openPath(dir);
    return err ? { error: err } : { ok: true, path: dir };
  } catch (err) {
    return { error: String(err.message || err) };
  }
});


// -------------------- 3.0.8 AUTO UPDATE --------------------
const UPDATE_REPO = 'CoachJT/arctic-foxes-12u-aa-analytics2';
const updaterLogFile = path.join(app.getPath('userData'), 'foxes-updater.log');
let activeUpdateCheck = null;
let updateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  percent: 0,
  repository: UPDATE_REPO,
  message: 'Ready to check for updates.'
};

function updaterLog(message) {
  try {
    ensureDir(app.getPath('userData'));
    fs.appendFileSync(updaterLogFile, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch (e) { console.error('Updater log write failed:', e); }
}

function updaterConfigured() {
  try {
    if (!app.isPackaged) return false;
    const cfg = path.join(process.resourcesPath, 'app-update.yml');
    if (!fs.existsSync(cfg)) return false;
    const raw = fs.readFileSync(cfg, 'utf8');
    return raw.includes('CoachJT') && raw.includes('arctic-foxes-12u-aa-analytics2');
  } catch (err) {
    updaterLog(`Config check error: ${String(err?.message || err)}`);
    return false;
  }
}

function emitUpdateState(patch = {}) {
  updateState = { ...updateState, ...patch, currentVersion: app.getVersion(), repository: UPDATE_REPO };
  updaterLog(`${updateState.status}: ${updateState.message}`);
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send('foxes-update-state', updateState);
  });
}

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;

autoUpdater.on('checking-for-update', () => emitUpdateState({
  status:'checking', message:'Checking GitHub Releases for updates…', percent:0
}));
autoUpdater.on('update-available', info => emitUpdateState({
  status:'available',
  availableVersion: info?.version || null,
  message:`Version ${info?.version || ''} is available.`,
  percent:0
}));
autoUpdater.on('update-not-available', info => emitUpdateState({
  status:'current',
  availableVersion:null,
  message:`You’re up to date — version ${app.getVersion()}.`,
  percent:0
}));
autoUpdater.on('download-progress', p => emitUpdateState({
  status:'downloading',
  percent:Math.max(0, Math.min(100, Number(p?.percent || 0))),
  message:`Downloading update… ${Math.round(Number(p?.percent || 0))}%`
}));
autoUpdater.on('update-downloaded', info => emitUpdateState({
  status:'downloaded',
  availableVersion:info?.version || updateState.availableVersion,
  percent:100,
  message:'Update downloaded. Restart to install.'
}));
autoUpdater.on('error', err => emitUpdateState({
  status:'error',
  message:`Updater error: ${String(err?.message || err || 'Update check failed.')}`,
  percent:0
}));

ipcMain.handle('foxes-update-get-state', () => ({
  ...updateState,
  configured: updaterConfigured(),
  packaged: app.isPackaged,
  logPath: updaterLogFile
}));

ipcMain.handle('foxes-update-check', async () => {
  if (!app.isPackaged) {
    emitUpdateState({status:'dev',message:'Update checks run from the installed Windows app, not developer mode.'});
    return {...updateState, configured:false, packaged:false};
  }
  if (!updaterConfigured()) {
    emitUpdateState({status:'error',message:'Updater configuration file is missing or does not point to the Arctic Foxes GitHub repository.'});
    return {...updateState, configured:false, packaged:true};
  }
  if (activeUpdateCheck) return activeUpdateCheck;
  activeUpdateCheck = (async () => {
    try {
      emitUpdateState({status:'checking',message:`Checking ${UPDATE_REPO}…`,percent:0});
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Update check timed out after 25 seconds.')), 25000));
      const result = await Promise.race([autoUpdater.checkForUpdates(), timeout]);
      // electron-updater normally emits available/current. If it returns without one, force a useful state.
      if (updateState.status === 'checking') {
        const v = result?.updateInfo?.version;
        if (v && v !== app.getVersion()) emitUpdateState({status:'available',availableVersion:v,message:`Version ${v} is available.`});
        else emitUpdateState({status:'current',availableVersion:null,message:`You’re up to date — version ${app.getVersion()}.`});
      }
    } catch (err) {
      emitUpdateState({status:'error',message:`Update check failed: ${String(err?.message || err)}`,percent:0});
    } finally {
      activeUpdateCheck = null;
    }
    return {...updateState, configured:true, packaged:true};
  })();
  return activeUpdateCheck;
});

ipcMain.handle('foxes-update-download', async () => {
  if (!updaterConfigured()) return {ok:false,error:'Updater is not configured.'};
  try {
    await autoUpdater.downloadUpdate();
    return {ok:true};
  } catch (err) {
    const msg=String(err?.message || err);
    emitUpdateState({status:'error',message:`Download failed: ${msg}`});
    return {ok:false,error:msg};
  }
});

ipcMain.handle('foxes-update-install', () => {
  if (updateState.status !== 'downloaded') return {ok:false,error:'No downloaded update is ready.'};
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return {ok:true};
});

ipcMain.handle('foxes-update-open-releases', async () => {
  await shell.openExternal('https://github.com/CoachJT/arctic-foxes-12u-aa-analytics2/releases');
  return {ok:true};
});

ipcMain.handle('foxes-update-open-log', async () => {
  try {
    ensureDir(app.getPath('userData'));
    if (!fs.existsSync(updaterLogFile)) fs.writeFileSync(updaterLogFile, 'Arctic Foxes updater log\n', 'utf8');
    const err = await shell.openPath(updaterLogFile);
    return err ? {ok:false,error:err} : {ok:true,path:updaterLogFile};
  } catch (err) { return {ok:false,error:String(err?.message || err)}; }
});
// -----------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0b0f14',
    title: 'Arctic Foxes 12U AA Hockey Analytics 4.1',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  ensureDir(app.getPath('userData'));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
