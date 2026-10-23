const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const out=path.resolve(__dirname,'../test-results/v5');fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1536,height:1050},acceptDownloads:true}),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
  const response=await page.goto('http://127.0.0.1:8769');assert.equal(response.status(),200);await page.waitForFunction(()=>document.documentElement.dataset.appState==='ready');
  assert.deepEqual(await page.locator('.sidebar nav button').allTextContents(),['监测概览','实时监测','监测记录','分析报告']);
  assert.equal(await page.locator('#view-overview input').count(),0);assert.ok(!(await page.locator('#overview-metrics').innerText()).includes('自评'));assert.equal(await page.locator('#overview-chart rect').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.modelState),'idle');assert.equal(await page.evaluate(()=>localStorage.length),0);checks.push('empty automatic workspace needs no journal and does not start camera or load models');
  await page.screenshot({path:path.join(out,'desktop-empty.png'),fullPage:true});
  await page.locator('#demo-toggle').click();assert.equal(await page.locator('#demo-banner').isVisible(),true);assert.ok((await page.locator('#overview-metrics').innerText()).includes('140.0'));assert.ok(await page.locator('#overview-chart rect').count()>0);assert.equal(await page.locator('.minute-cell').count(),30);assert.equal(await page.locator('.minute-cell.missing').count(),5);assert.equal(await page.evaluate(()=>localStorage.length),0);
  await page.screenshot({path:path.join(out,'desktop-demo.png'),fullPage:true});checks.push('isolated simulated seven-day records generate duration chart and minute timeline');
  await page.locator('.sidebar [data-view=records]').click();assert.equal(await page.locator('.session-row').count(),7);
  const csvP=page.waitForEvent('download');await page.locator('#export-sessions').click();const csv=await csvP;await csv.saveAs(path.join(out,'sessions.csv'));const csvText=fs.readFileSync(path.join(out,'sessions.csv'),'utf8');assert.ok(csvText.includes('本期有效分钟'));assert.ok(!csvText.includes('备注'));
  await page.locator('.sidebar [data-view=insights]').click();assert.ok((await page.locator('#report-summary').innerText()).includes('140.0'));assert.equal(await page.locator('#view-insights input').count(),0);
  await page.locator('[data-days="14"]').click();assert.ok((await page.locator('#report-summary').innerText()).includes('近 14 天'));
  await page.locator('#export-report').click();const txtP=page.waitForEvent('download');await page.locator('#download-report').click();const txt=await txtP;await txt.saveAs(path.join(out,'report.txt'));const txtText=fs.readFileSync(path.join(out,'report.txt'),'utf8');assert.ok(txtText.includes('每日有效观察'));assert.ok(!txtText.includes('心情手记'));assert.ok(txtText.includes('不由表情比例诊断'));
  checks.push('session archive and exported CSV/text are generated entirely from monitoring records');
  await page.screenshot({path:path.join(out,'report-demo.png'),fullPage:true});
  for(const width of [320,390,760,844,1440]){
   await page.setViewportSize({width,height:950});
   for(const view of ['overview','companion','records','insights','checkin','evidence','journal']){
    await page.evaluate(view=>document.querySelector(`[data-view="${view}"]`).click(),view);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow ${view} width ${width}`);
   }
   if(width<=760)assert.equal(await page.locator('.sidebar>.settings-button').isVisible(),false);
  }checks.push('seven retained views fit 320/390/760/844/1440px and mobile navigation has exactly four sections');
  await page.setViewportSize({width:390,height:844});await page.locator('.sidebar [data-view=overview]').click();await page.screenshot({path:path.join(out,'mobile-demo.png'),fullPage:true});
  await page.locator('#demo-toggle').click();assert.equal(await page.locator('#overview-chart rect').count(),0);await page.screenshot({path:path.join(out,'mobile-empty.png'),fullPage:true});
  await page.evaluate(()=>{const t=Date.now()-120000;localStorage.setItem('xinqing-companion-v1',JSON.stringify({version:1,sessions:[{id:'old',profile:'self',scene:'work',startedAt:t,endedAt:t+60000,activeMs:60000,validMs:30000,categories:{happy:30000},bins:[],status:'finished'}],journals:[{profile:'self',date:new Date().toLocaleDateString('sv-SE'),mood:5,reporter:'本人',good:'<script>bad</script>',note:'历史记录'}],screenings:[],assessments:[],who5:[],actions:[]}));});
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.appState==='ready');assert.ok((await page.locator('#overview-metrics').innerText()).includes('0.5'));assert.ok((await page.locator('#overview-chart').innerText()).includes('缺少分钟定位'));assert.equal(await page.locator('#overview-chart rect').count(),0);assert.ok(!(await page.locator('#view-overview').innerText()).includes('<script>'));checks.push('legacy aggregates preserved without fabricated dates or manual text entering automatic reports');
  await page.locator('.sidebar [data-view=companion]').click();await page.locator('#start-session').click();assert.ok((await page.locator('#notice').innerText()).includes('同意'));assert.equal(await page.evaluate(()=>document.documentElement.dataset.modelState),'idle');
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError')}});await page.locator('#camera-consent').check();await page.locator('#start-session').click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('没有获得摄像头权限'),null,{timeout:45000});assert.equal(await page.locator('#pause-session').isEnabled(),false);assert.equal(await page.locator('#camera-placeholder').isVisible(),true);checks.push('explicit consent still required and denied hardware permission leaves recording stopped');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({checks,errors,limits:['no real camera or phone device used','simulated charts are labeled and never stored as user records']},null,2));console.log(JSON.stringify({passed:checks.length,checks,errors}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
