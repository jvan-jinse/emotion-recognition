const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const out=path.resolve(__dirname,'../test-results/v4');fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1060},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8769');await page.waitForFunction(()=>document.documentElement.dataset.appState==='ready');
 assert.equal(await page.locator('.sidebar nav button').count(),4);assert.equal(await page.locator('.sidebar nav [data-view=checkin]').count(),0);assert.equal(await page.locator('.sidebar nav [data-view=evidence]').count(),0);
 await page.screenshot({path:path.join(out,'monitoring-overview.png'),fullPage:true});
 await page.locator('.app-footer [data-view=checkin]').click();await page.locator('#assessment-next').click();assert.ok((await page.locator('#assessment-form-status').innerText()).includes('全部题目'));
 const phq=[2,2,1,1,1,1,1,0,1],gad=[2,2,2,1,1,1,1];
 for(let i=0;i<9;i++)await page.locator(`input[name=phq9-${i}][value="${phq[i]}"]`).check();assert.equal(await page.locator('#assessment-live-safety').isVisible(),true);
 await page.locator('#assessment-next').click();for(let i=0;i<7;i++)await page.locator(`input[name=gad7-${i}][value="${gad[i]}"]`).check();await page.locator('#assessment-next').click();
 await page.locator('#assessment-duration').selectOption({label:'两周或更久'});await page.locator('#assessment-impact').selectOption({label:'明显影响'});await page.locator('#assessment-safety').selectOption('safe');await page.locator('#assessment-irritability').selectOption({label:'经常'});await page.locator('#assessment-consent').check();await page.locator('#assessment-submit').click();
 await page.waitForFunction(()=>document.querySelector('#assessment-result').textContent.includes('PHQ-9 10/27'));assert.ok((await page.locator('#assessment-result').innerText()).includes('第 9 题'));assert.ok((await page.locator('#assessment-result').innerText()).includes('GAD-7 10/21'));
 const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('xinqing-companion-v1')));assert.equal(data.assessments.length,1);assert.equal(data.assessments[0].result.diagnosis,null);assert.equal(data.assessments[0].result.depression.score,10);
 const downloadP=page.waitForEvent('download');await page.locator('#export-assessment').click();const download=await downloadP;await download.saveAs(path.join(out,'assessment.txt'));assert.ok(fs.readFileSync(path.join(out,'assessment.txt'),'utf8').includes('不能单独确认疾病'));
 await page.screenshot({path:path.join(out,'assessment-result.png'),fullPage:true});
 await page.locator('#screen-space-tabs [data-profile=child]').click();assert.equal(await page.locator('#full-assessment').isVisible(),false);assert.equal(await page.locator('#adult-screen').isVisible(),false);
 await page.locator('#screen-space-tabs [data-profile=self]').click();await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.appState==='ready');assert.ok((await page.locator('#assessment-result').innerText()).includes('PHQ-9 10/27'));
 await page.locator('[data-view=insights]').first().click();assert.ok((await page.locator('#support-cards').innerText()).includes('第 9 题'));
 for(const width of [320,390,844,1440]){await page.setViewportSize({width,height:950});await page.locator('.app-footer [data-view=checkin]').click();for(const step of [0,1,2]){await page.evaluate(step=>{document.querySelectorAll('.assessment-step').forEach(s=>s.hidden=Number(s.dataset.step)!==step)},step);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`assessment width ${width}`)}}
 await page.setViewportSize({width:390,height:844});await page.locator('[data-view=overview]').first().click();await page.screenshot({path:path.join(out,'monitoring-mobile.png'),fullPage:true});
 // Benchmark the unchanged real model pipeline on a test image, not camera accuracy.
 const fixture=path.resolve(__dirname,'../../../emotion-camera-demo/tests/fixtures/bbt1.jpg');
 const encoded=fs.readFileSync(fixture).toString('base64');
 const timings=await page.evaluate(async encoded=>{
  await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri('./models'),faceapi.nets.faceLandmark68TinyNet.loadFromUri('./models'),faceapi.nets.faceExpressionNet.loadFromUri('./models')]);
  const img=new Image();img.src='data:image/jpeg;base64,'+encoded;await img.decode();
  const initial=await faceapi.detectAllFaces(img,new faceapi.TinyFaceDetectorOptions({inputSize:416,scoreThreshold:.25})).withFaceLandmarks(true).withFaceExpressions();
  if(!initial.length)throw new Error('Benchmark fixture did not produce a face; cannot benchmark expression pipeline');
  const b=initial[0].detection.box,size=Math.max(b.width,b.height)*1.6;
  const canvas=document.createElement('canvas');canvas.width=480;canvas.height=480;canvas.getContext('2d').drawImage(img,b.x+b.width/2-size/2,b.y+b.height/2-size/2,size,size,0,0,480,480);
  const times=[];let detected=0;for(let i=0;i<5;i++){const start=performance.now();const faces=await faceapi.detectAllFaces(canvas,new faceapi.TinyFaceDetectorOptions({inputSize:224,scoreThreshold:.45})).withFaceLandmarks(true).withFaceExpressions();detected=faces.length;if(i)times.push(Math.round(performance.now()-start))}return{timesMs:times,detected};
 },encoded);assert.ok(timings.detected>0,'all three real networks must run on a detectable face');
 assert.deepEqual(errors,[]);const checks=['four primary monitoring/report sections','three-step assessment cannot silently skip unanswered items','PHQ-9/GAD-7 full scoring and individual ninth-item follow-up','assessment persistence, export and report recommendations','child adult-assessment gate','responsive full assessment','real unchanged model pipeline still processes a test image'];
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({checks,timings,errors,limits:['still-image timings on current test machine are not camera accuracy or device-wide latency guarantees']},null,2));console.log(JSON.stringify({passed:checks.length,timings,errors}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
