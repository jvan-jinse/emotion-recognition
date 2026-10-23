const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const out = path.resolve(__dirname, '../test-results');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
    const page = await context.newPage();
    // Deterministic video stream: exercise real MediaStream/video processing
    // without a camera driver or access to a physical recording device.
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas');canvas.width = 640;canvas.height = 480;
        const ctx = canvas.getContext('2d');let tick = 0;
        const draw = () => { ctx.fillStyle = '#d0ddd0';ctx.fillRect(0, 0, 640, 480);ctx.fillStyle = '#778877';ctx.fillRect(tick++ % 600, 400, 20, 20); };
        draw();const stream = canvas.captureStream(10), interval = setInterval(draw, 100);
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);track.stop = () => { clearInterval(interval);stop(); };
        }
        return stream;
      };
    });
    const errors = [], external = [], securityErrors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') { securityErrors.push(msg.text());console.error('BROWSER ERROR:', msg.text()); } });
    page.on('request', req => { if (/^https?:/.test(req.url()) && !req.url().startsWith('http://localhost:8765')) external.push(req.url()); });
    await page.goto('http://localhost:8765');
    try {
      await page.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 45000 });
    } catch (error) {
      console.error({ errors, securityErrors, notice: await page.locator('#notice').innerText() });
      await page.screenshot({ path: path.join(out, 'load-failure.png'), fullPage: true });
      throw error;
    }
    assert.match(await page.locator('#notice').innerText(), /模型已就绪/);
    await page.screenshot({ path: path.join(out, 'desktop.png'), fullPage: true });
    console.log('PASS model load / desktop render');

    const fixture = path.resolve(__dirname, 'fixtures/bbt1.jpg');
    await page.locator('#file').setInputFiles(fixture);
    await page.waitForFunction(() => document.getElementById('record-count').textContent !== '0 条记录');
    console.log('Real multi-face model result:', await page.locator('#face-info').innerText());
    assert.match(await page.locator('#result-detail').innerText(), /多人入镜/);

    const crop = await page.evaluate(async () => {
      const source = document.getElementById('photo');
      const photo = new Image();photo.src = source.src;await photo.decode();
      const faces = await faceapi.detectAllFaces(photo, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: .35 }));
      const box = faces.sort((a, b) => b.score - a.score)[0].box;
      const canvas = document.createElement('canvas');canvas.width = 400;canvas.height = 440;
      const pad = .25, x = Math.max(0, box.x - box.width * pad), y = Math.max(0, box.y - box.height * pad);
      const w = Math.min(photo.naturalWidth - x, box.width * (1 + pad * 2)), h = Math.min(photo.naturalHeight - y, box.height * (1 + pad * 2));
      canvas.getContext('2d').drawImage(photo, x, y, w, h, 0, 0, 400, 440);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const single = path.join(out, 'single-face.png');fs.writeFileSync(single, Buffer.from(crop, 'base64'));
    await page.locator('#file').setInputFiles(single);
    await page.waitForFunction(() => document.getElementById('record-count').textContent === '2 条记录');
    assert.match(await page.locator('#face-info').innerText(), /1 张人脸/);
    assert.notEqual(await page.locator('#score-happy').innerText(), '—');
    await page.waitForTimeout(350); // Let the score-bar CSS transition finish for visual QA.
    await page.screenshot({ path: path.join(out, 'single-face-result.png'), fullPage: true });
    console.log('PASS real expression model on single face:', await page.locator('#result-label').innerText());

    const downloadPromise = page.waitForEvent('download');await page.locator('#export').click();
    const download = await downloadPromise;const csv = path.join(out, 'observation.csv');await download.saveAs(csv);
    const text = fs.readFileSync(csv, 'utf8');assert.ok(text.includes('multiple_faces'));assert.ok(text.includes('raw_happy'));assert.equal(text.split('\r\n').length, 3);
    console.log('PASS CSV export with raw scores / rejected states');

    await page.locator('#start').click();
    await page.waitForFunction(() => document.getElementById('input-status').textContent === '实时观察');
    await page.waitForFunction(() => document.getElementById('result-label').textContent === '未检测到人脸');
    assert.equal(await page.locator('#score-happy').innerText(), '—');
    const streamActive = await page.evaluate(() => document.getElementById('video').srcObject?.getTracks()[0].readyState);
    if (streamActive !== 'live') console.error('Camera diagnostics:', await page.locator('#notice').innerText(), await page.locator('#result-label').innerText());
    assert.equal(streamActive, 'live');
    await page.evaluate(() => { window.testTracks = document.getElementById('video').srcObject.getTracks(); });
    await page.locator('#stop').click();
    assert.equal(await page.evaluate(() => window.testTracks.every(t => t.readyState === 'ended')), true);
    assert.equal(await page.locator('#result-label').innerText(), '已停止');
    console.log('PASS fake camera / no stale predictions / track release');
    await page.locator('#start').click();
    await page.waitForFunction(() => document.getElementById('input-status').textContent === '实时观察');
    await page.evaluate(() => {
      const track = document.getElementById('video').srcObject.getVideoTracks()[0];
      track.stop();track.dispatchEvent(new Event('ended'));
    });
    await page.waitForFunction(() => document.getElementById('notice').textContent.includes('连接已中断'));
    assert.equal(await page.locator('#result-label').innerText(), '已停止');
    console.log('PASS ended-stream event clears predictions');
    await page.locator('#clear').click();assert.equal(await page.locator('#export').isDisabled(), true);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(external, []);assert.deepEqual(errors, []);assert.deepEqual(securityErrors, []);
    console.log('PASS mobile layout / no external requests / no browser errors');

    const denied = await context.newPage();
    await denied.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied by test', 'NotAllowedError'); }; });
    await denied.goto('http://localhost:8765');await denied.waitForFunction(() => !document.getElementById('start').disabled);
    await denied.locator('#start').click();await denied.waitForFunction(() => document.getElementById('notice').textContent.includes('访问未获允许'));
    assert.equal(await denied.locator('#upload').isDisabled(), false);
    console.log('PASS permission denied message / image fallback');
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ passed: true, browser: await browser.version(), errors, external, securityErrors, note: 'Camera tests inject canvas.captureStream at getUserMedia. Real camera hardware and native camera startup not certified. No accuracy evaluation.' }, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error);process.exitCode = 1; });
