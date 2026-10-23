const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('captureIndicator',Object.freeze({
  pause:()=>ipcRenderer.send('pause-from-indicator'),show:()=>ipcRenderer.send('show-main'),
  onStatus:callback=>ipcRenderer.on('indicator-status',(_,status)=>callback({running:status.running===true,activeMs:Number(status.activeMs)||0})),
}));
