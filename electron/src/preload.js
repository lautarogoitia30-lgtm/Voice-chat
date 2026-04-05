const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  
  // Platform info
  platform: process.platform,
  
  // App info
  getVersion: () => process.versions.electron,
  
  // Event listeners for window state changes
  onMaximizeChange: (callback) => {
    ipcRenderer.on('window-maximize-change', (event, isMaximized) => callback(isMaximized));
  }
});

console.log('Preload script loaded');
