const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getFileContent: (filePath) => ipcRenderer.invoke('get-file-content', filePath),
  saveImage: (dataUrl, suggestedName) => ipcRenderer.invoke('save-image', dataUrl, suggestedName),
  window: (action) => ipcRenderer.send('window-control', action)
});
