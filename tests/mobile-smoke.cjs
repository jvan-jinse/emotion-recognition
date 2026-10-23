const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
 const browser = await chromium.launch({ channel: 'msedge', headless: true });
 try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
   window.testStreams = [];window.testFacingRequests = [];
   navigator.mediaDevices.getUserMedia = async options => {
    const facingMode = options.video.facingMode.ideal;window.testFacingRequests.push(facingMode);
    const canvas = document.createElement('canvas');canvas.width = 640;canvas.height = 480;
    const ctx = canvas.getContext('2d');const draw = () => {ctx.fillStyle = '#d0ddd0';ctx.fillRect(0, 0, 640, 480);};draw();
    const stream = canvas.captureStream(10), interval = setInterval(draw, 100);
    const track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
    track.stop = () => { clearInterval(interval);stop(); };
    track.getSettings = () => ({ facingMode, width: 640, height: 480 });
    window.testStreams.push(stream);return stream;
   };
  });
  await page.goto('http://localhost:8765');await page.waitForFunction(() => !document.getElementById('start').disabled);
  for (const id of ['start','stop','upload','capture','switch']) {
   const box = await page.locator('#'+id).boundingBox();assert.ok(box.height >= 44, `${id} touch target`);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('#start').click();await page.waitForFunction(() => document.getElementById('input-status').textContent === '实时观察');
  await page.locator('#switch').click();await page.waitForFunction(() => document.getElementById('switch').textContent === '切换到前置');
  assert.deepEqual(await page.evaluate(() => window.testFacingRequests), ['user','environment']);
  assert.equal(await page.evaluate(() => window.testStreams[0].getTracks().every(t => t.readyState === 'ended')), true);
  assert.equal(await page.locator('#video').evaluate(el => el.classList.contains('mirrored')), false);
  await page.evaluate(() => {Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await page.evaluate(() => window.testStreams[1].getTracks().every(t => t.readyState === 'ended')), true);
  assert.match(await page.locator('#notice').innerText(), /进入后台/);
  await page.evaluate(() => {Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });});
  const chooser = page.waitForEvent('filechooser');await page.locator('#capture').click();
  await (await chooser).setFiles(path.resolve(__dirname, '../test-results/single-face.png'));
  await page.waitForFunction(() => document.getElementById('input-status').textContent === '图片测试' && document.getElementById('score-neutral').textContent !== '—');
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.resolve(__dirname, '../test-results/mobile-v2.png'), fullPage: true });
  await page.setViewportSize({ width: 844, height: 390 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.resolve(__dirname, '../test-results/mobile-summary.json'), JSON.stringify({ passed: true, engine: 'Edge Chromium, mobile emulation', checks: ['44px touch targets','camera facing request','old stream released','rear camera unmirrored','background closes camera','photo capture input inference','portrait and landscape fit'], physicalPhoneTested: false }, null, 2));
  console.log('PASS mobile controls, facing switch, background release, photo input, portrait/landscape layout');
 } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode = 1;});
