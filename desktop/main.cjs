const {app,BrowserWindow,Tray,Menu,nativeImage,protocol,ipcMain,powerMonitor,dialog,shell,session,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const testing=process.argv.includes('--test-mode');
const dataArg=process.argv.find(a=>a.startsWith('--test-user-data='));
if(testing&&dataArg)app.setPath('userData',path.resolve(dataArg.split('=')[1]));
app.setName('心晴伴');app.setAppUserModelId('org.xinqing.companion');
protocol.registerSchemesAsPrivileged([{scheme:'xinqing',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
let mainWindow,indicator,tray,quitting=false,intent=false,background=false,lastHeartbeat=0,pauseSerial=0;
let status={running:false,activeMs:0,validMs:0,profile:'self'};
const base=path.resolve(__dirname,'web');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const csp="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
function mainSender(event){return !!mainWindow&&!mainWindow.isDestroyed()&&event.sender===mainWindow.webContents}
function controlSender(event){return mainSender(event)||!!indicator&&!indicator.isDestroyed()&&event.sender===indicator.webContents}
function external(url){try{const u=new URL(url);if(u.protocol==='https:')shell.openExternal(u.href)}catch{}}
function showMain(){if(!mainWindow||mainWindow.isDestroyed())createWindow();mainWindow.show();mainWindow.focus();if(indicator&&!indicator.isDestroyed())indicator.hide()}
function updateTray(){
 if(!tray)return;
 tray.setImage(nativeImage.createFromPath(path.join(__dirname,status.running?'tray-recording.png':'tray-idle.png')));
 tray.setToolTip(status.running?'心晴伴：摄像头记录中，右键可暂停':'心晴伴：摄像头未开启');
 tray.setContextMenu(Menu.buildFromTemplate([{label:status.running?'摄像头记录中':'摄像头未开启',enabled:false},{label:'打开心晴伴',click:showMain},{label:'暂停摄像头',enabled:status.running,click:()=>requestPause('已从托盘暂停，摄像头已关闭。')},{type:'separator'},{label:'停止记录并退出',click:quitApp}]));
 if(indicator&&!indicator.isDestroyed())indicator.webContents.send('indicator-status',status);
 if(!status.running&&indicator&&!indicator.isDestroyed())indicator.hide();
}
function showIndicator(){
 if(!status.running||!background)return;
 if(!indicator||indicator.isDestroyed()){
  const bounds=screen.getPrimaryDisplay().workArea;
  indicator=new BrowserWindow({width:340,height:68,x:bounds.x+bounds.width-355,y:bounds.y+15,frame:false,resizable:false,alwaysOnTop:true,skipTaskbar:false,show:false,backgroundColor:'#f4f8f1',webPreferences:{preload:path.join(__dirname,'indicator-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  indicator.loadFile(path.join(__dirname,'indicator.html'));
  indicator.webContents.once('did-finish-load',()=>{if(status.running){indicator.webContents.send('indicator-status',status);if(!testing)indicator.showInactive()}});
  indicator.on('close',()=>{if(!quitting&&status.running)requestPause('采集状态窗口已关闭，摄像头已暂停。')});
 }else if(!testing){indicator.showInactive();indicator.webContents.send('indicator-status',status)}
}
function requestPause(reason){
 const serial=++pauseSerial;
 intent=false;
 if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('pause-capture',reason);
 // If a renderer is unresponsive it must not retain the camera silently.
 setTimeout(()=>{if(serial===pauseSerial&&status.running&&mainWindow&&!mainWindow.isDestroyed()){mainWindow.destroy();mainWindow=null;status.running=false;updateTray();if(!quitting&&!testing)showMain()}},1500).unref();
}
function quitApp(){if(quitting)return;quitting=true;intent=false;if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('pause-capture','桌面程序正在退出，摄像头已关闭。');setTimeout(()=>app.quit(),250)}
function createWindow(){
 mainWindow=new BrowserWindow({width:1380,height:930,minWidth:720,minHeight:600,show:false,title:'心晴伴',backgroundColor:'#f4f7f5',icon:path.join(__dirname,'tray-idle.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,backgroundThrottling:false}});
 mainWindow.removeMenu();
 mainWindow.webContents.setWindowOpenHandler(({url})=>{external(url);return{action:'deny'}});
 mainWindow.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith('xinqing://app/')){e.preventDefault();external(url)}});
 mainWindow.webContents.on('render-process-gone',()=>{status.running=false;intent=false;updateTray()});
 mainWindow.on('close',e=>{if(quitting)return;if(status.running&&background){e.preventDefault();mainWindow.hide();showIndicator()}else if(status.running){e.preventDefault();quitApp()}else{quitting=true;app.quit()}});
 mainWindow.on('hide',()=>{if(status.running&&background)showIndicator();else if(status.running)requestPause('窗口已收起。未开启后台记录，摄像头已暂停。')});
 mainWindow.once('ready-to-show',()=>{if(!testing)mainWindow.show()});
 mainWindow.loadURL('xinqing://app/index.html');
}
if(!app.requestSingleInstanceLock()){app.quit()}else{
 app.on('second-instance',showMain);
 app.whenReady().then(()=>{
  protocol.handle('xinqing',request=>{
   try{
    const url=new URL(request.url);if(url.hostname!=='app'||request.method!=='GET')return new Response('Forbidden',{status:403});
    const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname),target=path.resolve(base,'.'+relative);
    if(target!==base&&!target.startsWith(base+path.sep))return new Response('Forbidden',{status:403});
    if(!fs.existsSync(target)||!fs.statSync(target).isFile())return new Response('Not found',{status:404});
    return new Response(fs.readFileSync(target),{headers:{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
   }catch{return new Response('Invalid request',{status:400})}
  });
  session.defaultSession.setPermissionRequestHandler((wc,permission,callback,details)=>{
   const origin=details.requestingUrl||details.requestingOrigin||wc.getURL();
   callback(wc===mainWindow?.webContents&&permission==='media'&&intent&&origin.startsWith('xinqing://app')&&Array.isArray(details.mediaTypes)&&details.mediaTypes.includes('video')&&!details.mediaTypes.includes('audio'));
  });
  session.defaultSession.setPermissionCheckHandler((wc,permission,origin,details)=>wc===mainWindow?.webContents&&permission==='media'&&intent&&origin.startsWith('xinqing://app')&&details.mediaType!=='audio');
  ipcMain.handle('capture-intent',(event,value)=>{if(!mainSender(event))return false;intent=value===true;if(intent)pauseSerial++;return intent});
  ipcMain.handle('background-consent',(event,value)=>{if(!mainSender(event))return false;background=value===true;if(!background&&status.running&&!mainWindow.isVisible())requestPause('已关闭后台记录，摄像头已暂停。');return background});
  ipcMain.handle('hide-to-tray',event=>{if(!mainSender(event)||!status.running||!background)return false;mainWindow.hide();showIndicator();return true});
  ipcMain.on('capture-state',(event,value)=>{if(!mainSender(event))return;status={running:value?.running===true,activeMs:Math.max(0,Number(value?.activeMs)||0),validMs:Math.max(0,Number(value?.validMs)||0),profile:['self','elder','child'].includes(value?.profile)?value.profile:'self'};lastHeartbeat=Date.now();if(!status.running)intent=false;updateTray()});
  ipcMain.on('pause-from-indicator',event=>{if(controlSender(event))requestPause('已暂停后台记录，摄像头已关闭。')});
  ipcMain.on('show-main',event=>{if(controlSender(event))showMain()});
  tray=new Tray(nativeImage.createFromPath(path.join(__dirname,'tray-idle.png')));tray.on('click',showMain);updateTray();createWindow();
  powerMonitor.on('lock-screen',()=>requestPause('电脑已锁屏，摄像头停止。解锁后请手动继续。'));
  powerMonitor.on('suspend',()=>requestPause('电脑正在休眠，摄像头停止。唤醒后请手动继续。'));
  setInterval(()=>{if(status.running&&Date.now()-lastHeartbeat>8000)requestPause('记录程序响应超时，摄像头已暂停，请重新检查。')},2000).unref();
 });
 app.on('window-all-closed',()=>{if(quitting)app.quit()});
 app.on('before-quit',()=>{quitting=true;if(indicator&&!indicator.isDestroyed())indicator.destroy();if(tray)tray.destroy()});
}
