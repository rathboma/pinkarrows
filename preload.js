const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getFileContent: (filePath) => ipcRenderer.invoke('get-file-content', filePath)
});