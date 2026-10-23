const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('xinqingDesktop',Object.freeze({
  isDesktop:true,
  setCaptureIntent:value=>ipcRenderer.invoke('capture-intent',value===true),
  setBackground:value=>ipcRenderer.invoke('background-consent',value===true),
  setState:value=>ipcRenderer.send('capture-state',{running:value.running===true,activeMs:Number(value.activeMs)||0,validMs:Number(value.validMs)||0,profile:String(value.profile||'self')}),
  hideToTray:()=>ipcRenderer.invoke('hide-to-tray'),
  show:()=>ipcRenderer.send('show-main'),
  onPause:callback=>{const listener=(_,reason)=>callback(String(reason));ipcRenderer.on('pause-capture',listener);return()=>ipcRenderer.removeListener('pause-capture',listener)},
}));
