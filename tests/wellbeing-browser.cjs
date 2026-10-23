const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'),path = require('node:path');
const output = path.resolve(__dirname,'../test-results/wellbeing');fs.mkdirSync(output,{recursive:true});
const origin = 'http://127.0.0.1:8769',key = 'xinqing-companion-v1';
(async()=>{
 const browser = await chromium.launch({channel:'msedge',headless:true});
 const checks=[],errors=[];
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1060},acceptDownloads:true});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const requests=[];page.on('request',r=>requests.push(r.url()));
  await page.goto(origin);await page.waitForFunction(()=>document.documentElement.dataset.appState==='ready');
  assert.equal(await page.locator('#overview-chart circle').count(),0);
  await page.screenshot({path:path.join(output,'desktop-overview-empty.png'),fullPage:true});
  await page.locator('#demo-toggle').click();assert.equal(await page.locator('#demo-banner').isVisible(),true);
  assert.equal(await page.locator('#overview-chart circle').count(),7);
  assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),null);
  await page.screenshot({path:path.join(output,'desktop-overview-demo.png'),fullPage:true});
  await page.locator('#exit-demo').click();checks.push('demo isolated from real storage, empty charts contain no invented observations');
  await page.locator('.nav-item[data-view=journal]').click();
  await page.locator('label[for=mood-4]').click();await page.locator('#good-thing').fill('完成一小节文献');await page.locator('#journal-note').fill('<img src=x onerror=alert(1)>');
  await page.locator('#journal-form button[type=submit]').click();
  let saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);assert.equal(saved.journals.length,1);assert.equal(saved.journals[0].mood,4);
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.appState==='ready');
  await page.locator('.nav-item[data-view=insights]').click();
  assert.ok((await page.locator('#report-summary').innerText()).includes('4.0/5'));
  assert.equal(await page.locator('#journal-list img').count(),0);assert.ok((await page.locator('#journal-list').innerText()).includes('<img'));
  const csvPromise=page.waitForEvent('download');await page.locator('#export-csv').click();const csv=await csvPromise;await csv.saveAs(path.join(output,'real-journal.csv'));
  assert.ok(fs.readFileSync(path.join(output,'real-journal.csv'),'utf8').includes('完成一小节文献'));
  checks.push('journal persist/reload, self report chart, inert user text, real CSV download');
  await page.locator('.app-footer [data-view=checkin]').click();await page.locator('[data-assessment-mode=quick]').click();
  for(const [name,value] of [['interest',1],['low',2],['nervous',2],['worry',1]])await page.locator(`input[name=screen-${name}][value="${value}"]`).check();
  await page.locator('#screen-consent').check();await page.locator('#screen-form button[type=submit]').click();
  assert.equal(await page.locator('.screen-result-card.follow').count(),2);
  saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);assert.equal(saved.screenings[0].result.phq2,3);assert.equal(saved.screenings[0].result.gad2,3);
  await page.locator('#who-raw').fill('12');await page.locator('#who-consent').check();await page.locator('#who-form button[type=submit]').click();assert.ok((await page.locator('#who-result').innerText()).includes('48/100'));
  await page.locator('#screen-space-tabs [data-profile=child]').click();assert.equal(await page.locator('#adult-screen').isVisible(),false);assert.equal(await page.locator('#child-screen').isVisible(),true);
  await page.locator('#screen-space-tabs [data-profile=elder]').click();assert.ok((await page.locator('#screen-age-note').innerText()).includes('尚未验证'));
  assert.equal(await page.locator('#screen-result .screen-result-card').count(),0);
  await page.locator('#screen-space-tabs [data-profile=self]').click();
  checks.push('PHQ/GAD thresholds derive from answers, WHO mapping, children gated and elder anxiety limited');
  for(const width of [320,390,760,844,1280]){
   await page.setViewportSize({width,height:950});
   for(const view of ['overview','companion','journal','insights','checkin','evidence']){
    await page.evaluate(v=>document.querySelector(`[data-view="${v}"]`).click(),view);
    const overflow=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
    assert.ok(overflow.scroll<=overflow.width+1,`${width}/${view} horizontal overflow ${JSON.stringify(overflow)}`);
   }
  }
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.querySelector('[data-view=overview]').click());await page.locator('#demo-toggle').click();
  await page.locator('#toast').evaluate(e=>e.hidden=true);await page.screenshot({path:path.join(output,'mobile-overview-demo.png'),fullPage:true});await page.locator('#exit-demo').click();checks.push('all six views at 320/390/760/844/1280 pixels without horizontal overflow');
  assert.ok(requests.filter(u=>u.startsWith('http')).every(u=>u.startsWith(origin)));assert.ok(!requests.some(u=>/\.mjs/.test(u)));checks.push('local asset requests only, classic bundled scripts');
  await context.close();

  const cameraContext=await browser.newContext({viewport:{width:1440,height:1100}});
  const cam=await cameraContext.newPage();cam.on('pageerror',e=>errors.push(e.message));
  await cam.addInitScript(()=>{
   navigator.mediaDevices.getUserMedia=async()=>{
    window.cameraCalls=(window.cameraCalls||0)+1;const c=document.createElement('canvas');c.width=640;c.height=480;const g=c.getContext('2d');g.fillStyle='#506c60';g.fillRect(0,0,640,480);
    const stream=c.captureStream(10);window.testStream=stream;return stream;
   };
  });
  await cam.goto(origin+'/#companion');await cam.waitForFunction(()=>document.documentElement.dataset.appState==='ready');
  await cam.evaluate(()=>{
   const keys=['neutral','happy','sad','angry','fearful','disgusted','surprised'];const x=180,y=90,w=240,h=300;
   const pts=Array.from({length:68},()=>({x:x+w*.5,y:y+h*.5}));
   for(let i=36;i<=41;i++)pts[i]={x:x+w*.3,y:y+h*.3};for(let i=42;i<=47;i++)pts[i]={x:x+w*.7,y:y+h*.3};for(let i=48;i<=59;i++)pts[i]={x:x+w*.5,y:y+h*.7};
   const f={detection:{box:{x,y,width:w,height:h},score:.98},landmarks:{positions:pts},expressions:Object.fromEntries(keys.map(k=>[k,k==='happy'?.9:1/60]))};window.testFaces=[f];
   faceapi.detectAllFaces=()=>({withFaceLandmarks:()=>({withFaceExpressions:async()=>window.testFaces})});
  });
  await cam.locator('#start-session').click();assert.equal(await cam.evaluate(()=>window.cameraCalls||0),0);
  await cam.locator('#camera-consent').check();await cam.locator('#session-task').fill('测试学习陪伴');await cam.locator('#start-session').click();
  await cam.waitForFunction(()=>document.documentElement.dataset.modelState==='ready',{timeout:45000});
  assert.equal(await cam.evaluate(()=>['tinyFaceDetector','faceLandmark68TinyNet','faceExpressionNet'].every(k=>faceapi.nets[k].isLoaded)),true);
  await cam.waitForFunction(()=>document.querySelector('#live-expression').textContent.includes('高兴'));
  await cam.waitForFunction(()=>Number(document.querySelector('#valid-time').textContent)>0);
  await cam.screenshot({path:path.join(output,'desktop-companion-synthetic-camera.png'),fullPage:true});
  await cam.evaluate(()=>{window.testFaces.push(window.testFaces[0])});
  await cam.waitForFunction(()=>document.querySelector('#face-status').textContent.includes('多人'));
  const before=await cam.locator('#valid-time').innerText();await cam.waitForTimeout(1600);assert.equal(await cam.locator('#valid-time').innerText(),before);
  await cam.evaluate(()=>window.testFaces=window.testFaces.slice(0,1));
  await cam.waitForFunction(()=>document.querySelector('#live-expression').textContent.includes('高兴'));
  await cam.locator('.nav-item[data-view=journal]').click();assert.equal(await cam.locator('#active-banner').isVisible(),true);
  assert.equal(await cam.evaluate(()=>window.testStream.getTracks().every(t=>t.readyState==='ended')),true);
  await cam.locator('#active-banner [data-view=companion]').click();assert.ok((await cam.locator('#camera-state').innerText()).includes('暂停'));
  await cam.locator('#start-session').click();await cam.waitForFunction(()=>document.querySelector('#session-state').textContent==='本地采集中');
  await cam.locator('#camera-consent').uncheck();assert.equal(await cam.evaluate(()=>window.testStream.getTracks().every(t=>t.readyState==='ended')),true);
  await cam.locator('#camera-consent').check();await cam.locator('#start-session').click();await cam.waitForFunction(()=>document.querySelector('#session-state').textContent==='本地采集中');
  await cam.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await cam.evaluate(()=>window.testStream.getTracks().every(t=>t.readyState==='ended')),true);
  assert.equal(await cam.locator('#camera-state').innerText(),'已暂停');
  await cam.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await cam.locator('#camera-state').innerText(),'已暂停');await cam.locator('#end-session').click();
  const cameraSaved=await cam.evaluate(k=>JSON.parse(localStorage.getItem(k)),key);assert.equal(cameraSaved.sessions.length,1);assert.equal(cameraSaved.sessions[0].status,'finished');assert.ok(cameraSaved.sessions[0].validMs>0);
  assert.ok(!JSON.stringify(cameraSaved).includes('landmarks'));assert.ok(!JSON.stringify(cameraSaved).includes('expressions'));
  checks.push('three real model weights loaded; synthetic video inference, consent and withdrawal, multi-person exclusion, view/background pause, no auto-resume, summary storage only');
  await cameraContext.close();
  const deniedContext=await browser.newContext({viewport:{width:390,height:844}}),denied=await deniedContext.newPage();
  await denied.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError')}});
  await denied.goto(origin+'/#companion');await denied.waitForFunction(()=>document.documentElement.dataset.appState==='ready');await denied.locator('#camera-consent').check();await denied.locator('#start-session').click();
  await denied.waitForFunction(()=>document.querySelector('#notice').textContent.includes('没有获得摄像头权限'),null,{timeout:45000});
  assert.equal(await denied.evaluate(k=>JSON.parse(localStorage.getItem(k)||'{"sessions":[]}').sessions.length,key),0);checks.push('camera permission denial does not create an observation');await deniedContext.close();
  const missingContext=await browser.newContext(),missing=await missingContext.newPage();
  await missing.route('**/models/face_landmark_68_tiny_model-weights_manifest.json',r=>r.fulfill({status:404,body:'missing'}));
  await missing.goto(origin+'/#companion');await missing.waitForFunction(()=>document.documentElement.dataset.appState==='ready');await missing.locator('#camera-consent').check();await missing.locator('#start-session').click();
  await missing.waitForFunction(()=>document.documentElement.dataset.modelState==='failed');assert.equal(await missing.locator('#start-session').isEnabled(),true);checks.push('missing model fails visibly with retry rather than loading forever');await missingContext.close();
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify({date:new Date().toISOString(),checks,errors,limits:['camera stream and face outputs simulated; actual device/WeChat, desktop PiP endurance, clinical validity not tested']},null,2));
  console.log(JSON.stringify({passed:checks.length,checks,errors},null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
