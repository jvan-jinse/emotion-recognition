const {_electron}=require('playwright'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const out=path.resolve(__dirname,'../test-results/desktop');fs.mkdirSync(out,{recursive:true});
 const packaged=process.env.XINQING_PACKAGED_EXE;
 const app=await _electron.launch({executablePath:packaged||path.resolve(__dirname,'../../desktop-runtime/electron-win32-x64/electron.exe'),args:[...(packaged?[]:[path.resolve(__dirname,'../desktop')]),'--test-mode','--test-user-data='+path.join(out,'background-profile-'+Date.now()),'--headless'],timeout:45000});
 try{
  const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>document.documentElement.dataset.appState==='ready');
  await page.evaluate(()=>document.querySelector('[data-view=companion]').click());
  assert.equal(await page.locator('#desktop-controls').isVisible(),true);
  await page.evaluate(()=>{
   navigator.mediaDevices.getUserMedia=async()=>{const c=document.createElement('canvas');c.width=640;c.height=480;const g=c.getContext('2d');g.fillStyle='#657584';g.fillRect(0,0,640,480);window.nativeTestStream=c.captureStream(10);return window.nativeTestStream};
   const keys=['neutral','happy','sad','angry','fearful','disgusted','surprised'];
   const pts=Array.from({length:68},()=>({x:220,y:180}));for(let i=36;i<=41;i++)pts[i]={x:170,y:125};for(let i=42;i<=47;i++)pts[i]={x:270,y:125};for(let i=48;i<=59;i++)pts[i]={x:220,y:235};pts[30]={x:220,y:180};
   window.nativeKey='happy';faceapi.detectAllFaces=()=>({withFaceLandmarks:()=>({withFaceExpressions:async()=>[{detection:{box:{x:100,y:50,width:230,height:280},score:.99},landmarks:{positions:pts},expressions:Object.fromEntries(keys.map(k=>[k,k===window.nativeKey?.94:.01]))}]})});
  });
  await page.locator('#camera-consent').check();await page.locator('#background-consent').check();await page.locator('#start-session').click();
  await page.waitForFunction(()=>document.querySelector('#live-expression').textContent.includes('高兴'),null,{timeout:45000});
  await page.waitForFunction(()=>Number(document.querySelector('#valid-time').textContent)>0);
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('xinqing-companion-v1')).sessions[0].samples);
  await page.locator('#background-hide').click();
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('xinqing:')).isVisible()),false);
  await page.waitForTimeout(5500);
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('xinqing-companion-v1')).sessions[0].samples);
  assert.ok(after>before+10,`hidden renderer stopped sampling: ${before}/${after}`);
  assert.equal(await page.evaluate(()=>window.nativeTestStream.getVideoTracks()[0].readyState),'live');
  // Live display follows the next frame, without waiting for one-second votes.
  const switched=Date.now();await page.evaluate(()=>window.nativeKey='sad');
  await page.waitForFunction(()=>document.querySelector('#live-expression').textContent.includes('悲伤'),null,{timeout:2000});const switchMs=Date.now()-switched;assert.ok(switchMs<600,`live label waited too long ${switchMs}`);
  await app.evaluate(({powerMonitor})=>powerMonitor.emit('lock-screen'));
  await page.waitForFunction(()=>document.querySelector('#camera-state').textContent==='已暂停');
  assert.equal(await page.evaluate(()=>window.nativeTestStream.getVideoTracks()[0].readyState),'ended');
  await app.evaluate(({powerMonitor})=>powerMonitor.emit('unlock-screen'));await page.waitForTimeout(250);
  assert.equal(await page.locator('#camera-state').innerText(),'已暂停');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'background-checks.json'),JSON.stringify({date:new Date().toISOString(),checks:['independent secure app origin, no public website needed','explicit background consent','hidden main window continues inference and local summary writes','next-frame expression display independent of vote window','simulated system-lock event stops stream','unlock does not auto-start camera'],hiddenAdditionalSamples:after-before,syntheticExpressionSwitchMs:switchMs,limits:['synthetic video and synthetic face scores','actual hardware, sleep/lock hardware events and endurance not verified']},null,2));
  console.log(JSON.stringify({passed:6,hiddenAdditionalSamples:after-before,syntheticExpressionSwitchMs:switchMs,errors}));
 }finally{await app.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
