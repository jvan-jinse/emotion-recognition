const {_electron}=require('playwright'),path=require('node:path'),fs=require('node:fs');
(async()=>{
 const out=path.resolve(__dirname,'../test-results/desktop');fs.mkdirSync(out,{recursive:true});
 const app=await _electron.launch({executablePath:path.resolve(__dirname,'../../desktop-runtime/electron-win32-x64/electron.exe'),args:[path.resolve(__dirname,'../desktop'),'--test-mode','--test-user-data='+path.join(out,'profile'),'--headless'],timeout:45000});
 try{
  const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>document.documentElement.dataset.appState==='ready');
  console.log(JSON.stringify({url:page.url(),secure:await page.evaluate(()=>isSecureContext),native:await page.evaluate(()=>xinqingDesktop.isDesktop),backgroundControls:await page.locator('#desktop-controls').isVisible(),errors}));
  await page.screenshot({path:path.join(out,'desktop-ready.png')});
 }finally{await app.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
