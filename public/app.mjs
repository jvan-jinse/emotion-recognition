import { detectProvidedFrame, decideExpression, providedFrameSize } from './recognition-adapter.mjs';
import { personalComparison, sessionComparison, performanceSummary } from './observations.mjs';
import { automaticReport, automaticCSV } from './automatic.mjs';
import { LABELS, normalize, smooth, inspectFace, timeAwareAlpha, appendVote, summarizeVotes, estimateHeadPose, validateHeadPose, overlap, classify, choosePrimaryFace, chooseFaceByOverlap, mapPointerToFrame, findFaceAtPoint, topExpression } from './core.mjs';
import { DATA_KEY, PROFILES, SCENES, SCREEN_ITEMS, SCREEN_OPTIONS, EVIDENCE, CATEGORIES, dayKey, blankData, freshSession, creditSample, sessionStats, scoreScreen, scoreWho5, scoped, supportMessages, makeReport, reportCSV, demoData } from './wellbeing.mjs';
import { PHQ9_ITEMS, GAD7_ITEMS, PHQ9_OPTIONS, GAD7_OPTIONS, ASSESSMENT_SOURCE, assessSymptoms, assessmentSummary } from './assessment.mjs';

const runtime = { view: 'overview', scene: 'study', profile: 'self', days: 7, demo: false, demoStore: null, storageOK: true, session: null, running: false, starting: false, stream: null, generation: 0, modelPromise: null, modelsReady: false, pip: null, clockAt: null, previousSample: null, smoothed: null, votes: [], lastInfer: null, box: null, lastPersist: 0, lengthMs: 25 * 60000, breakLeft: 60, breakAt: null,assessmentMode:'full',assessmentStep:0,background:false,lastDesktopStatus:0 };
const desktop = window.xinqingDesktop?.isDesktop ? window.xinqingDesktop : null;
const $ = id => document.getElementById(id) || runtime.pip?.document.getElementById(id);
const all = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const moodWords = ['很不好', '不太好', '一般', '比较好', '很好'], moodSymbols = ['1', '2', '3', '4', '5'];
const names = Object.fromEntries(LABELS.map(x => [x.key, x.name]));
const titles = { overview: '监测概览', companion: '实时监测', records: '监测记录', journal: '历史附加记录', insights: '分析报告', checkin: '症状评估', evidence: '使用说明与依据' };
let data = blankData();
try {
  const saved = localStorage.getItem(DATA_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed.version !== 1 || ['sessions','journals','screenings','who5','actions'].some(k => !Array.isArray(parsed[k]))) throw new Error('Unsupported records');
    data = parsed;data.assessments ||= [];
    for (const s of data.sessions) if (s.status === 'active' || s.status === 'paused') { s.status = 'interrupted';s.endedAt = s.lastSavedAt || s.startedAt;s.pauses = (s.pauses || 0) + 1; }
  }
} catch { runtime.storageOK = false; }
function sourceData() { return runtime.demo ? runtime.demoStore : data; }
function persist() {
  // Do not silently discard older records on quota failures.
  try { localStorage.setItem(DATA_KEY, JSON.stringify(data));runtime.storageOK = true; }
  catch { runtime.storageOK = false; }
  $('storage-label').textContent = runtime.storageOK ? '仅存当前设备' : '当前仅在内存，请导出';
  return runtime.storageOK;
}
function toast(message) { $('toast').textContent = message;$('toast').hidden = false;clearTimeout(toast.timer);toast.timer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
function notice(message, error = false) { $('notice').textContent = message;$('notice').classList.toggle('error', error); }
function allowWrite() { if (runtime.demo) { toast('当前为模拟示例。请先退出示例，再记录自己的数据。');return false; }return true; }
function download(name, text, type = 'text/plain;charset=utf-8') { const url = URL.createObjectURL(new Blob([text], { type }));const a = document.createElement('a');a.href = url;a.download = name;document.body.append(a);a.click();a.remove();setTimeout(() => URL.revokeObjectURL(url), 1000); }
function minutes(ms) { return (ms / 60000).toFixed(1); }
function clock(ms) { const n = Math.max(0, Math.floor(ms / 1000));return `${String(Math.floor(n / 60)).padStart(2,'0')}:${String(n % 60).padStart(2,'0')}`; }
function mean(items, key) { const values = items.map(j => j[key]).filter(Number.isFinite);return values.length ? (values.reduce((s,v) => s + v, 0) / values.length).toFixed(1) : '—'; }
function selfJournals(items) { return items.filter(j => j.reporter !== '陪同者观察记录'); }
function metric(label, value, unit, image) { return `<div class="metric"><span class="metric-icon">${icon(image)}</span><div><strong>${esc(value)}<small>${esc(unit)}</small></strong><p>${esc(label)}</p></div></div>`; }
function renderMetrics(id, report) {
  $(id).innerHTML = metric('有效观察时长',minutes(report.stats.validMs),'分钟','camera') + metric('有效覆盖率',report.stats.coverage===null?'—':(report.stats.coverage*100).toFixed(1),' %','shield') + metric('监测会话',report.sessions.length,'次','book') + metric('有分钟记录的日期',report.observedDays,'天','chart');
}
function volumeChart(id,report) {
  const W=700,H=240,L=40,R=684,T=22,B=202,max=Math.max(5,...report.daily.map(d=>d.validMs/60000));
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每日有效观察分钟，缺失日期不补算">`;
  for(let i=0;i<4;i++){const y=B-i*(B-T)/3;svg+=`<line x1="${L}" x2="${R}" y1="${y}" y2="${y}" class="chart-grid"/><text x="28" y="${y+4}" text-anchor="end" class="chart-text">${(i*max/3).toFixed(max<10?1:0)}</text>`;}
  const step=(R-L)/report.days,bar=Math.min(38,step*.48);
  report.daily.forEach((d,i)=>{const x=L+step*(i+.5);let y=B;
    if(d.validMs){for(const label of LABELS){const height=d.categories[label.key]/60000/max*(B-T);y-=height;if(height)svg+=`<rect x="${x-bar/2}" y="${y}" width="${bar}" height="${height}" fill="${label.color}"><title>${d.date} ${label.name} ${minutes(d.categories[label.key])} 分钟</title></rect>`;}}
    else svg+=`<line x1="${x-4}" x2="${x+4}" y1="${B-2}" y2="${B-2}" stroke="#55606d" stroke-width="2"><title>${d.date} 无分钟记录</title></line>`;
    if(report.days===7||i%2===0||i===report.days-1)svg+=`<text x="${x}" y="227" text-anchor="middle" class="chart-text">${Number(d.date.slice(5,7))}/${Number(d.date.slice(8))}</text>`;
  });svg+='</svg>';
  $(id).innerHTML=svg+(!report.stats.validMs?'<div class="chart-empty">等待有效观察<span>开启监测后，图表会自动生成</span></div>':'')+(report.undatedMs?`<p class="fine">另有 ${minutes(report.undatedMs)} 分钟旧记录缺少分钟定位，仅纳入类别汇总，未分配到图中日期。</p>`:'');
}
function minuteTimeline(report) {
  const list=report.latestBins,target=$('overview-timeline');$('overview-timeline-date').textContent=report.latestDay||'尚无记录';
  $('overview-legend').innerHTML=LABELS.map(l=>`<span><i data-color="${l.key}"></i>${l.name}</span>`).join('')+'<span><i class="missing-swatch"></i>无数据</span>';
  $('overview-legend').querySelectorAll('[data-color]').forEach(el=>el.style.background=LABELS.find(l=>l.key===el.dataset.color).color);
  if(!list.length){target.innerHTML='<div class="timeline-empty"><span class="mono">NO OBSERVATION DATA</span><p>有效片段将按分钟排列，中断与未知结果留空。</p></div>';return;}
  const start=Math.floor(list[0].time/1800000)*1800000,end=Math.min(start+86400000,Math.ceil((list.at(-1).time+60000)/1800000)*1800000),map=new Map();
  for(const b of list){if(!map.has(b.time))map.set(b.time,Object.fromEntries(CATEGORIES.map(k=>[k,0])));for(const k of CATEGORIES)map.get(b.time)[k]+=b.categories[k]||0;}
  let html='<div class="timeline-grid">';
  for(let time=start;time<end;time+=60000){const c=map.get(time),total=c?Object.values(c).reduce((s,v)=>s+v,0):0,segments=c?LABELS.filter(l=>c[l.key]).map(l=>`<b data-key="${l.key}" data-share="${c[l.key]/60000}" title="${new Date(time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} ${l.name} ${(c[l.key]/1000).toFixed(1)} 秒"></b>`).join(''):'';html+=`<span class="minute-cell${total?'':' missing'}" title="${new Date(time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} · 有效 ${(total/1000).toFixed(1)} 秒">${segments}</span>`;}html+='</div><div class="timeline-axis"><span>'+new Date(start).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+'</span><span>每格 1 分钟</span><span>'+new Date(end).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+'</span></div>';
  target.innerHTML=html;target.querySelectorAll('b[data-share]').forEach(el=>{el.style.height=`${Math.min(1,Number(el.dataset.share))*100}%`;el.style.background=LABELS.find(l=>l.key===el.dataset.key).color;});
}
function renderEngine() {
  const state=runtime.starting?'准备中':runtime.running?'采集中':runtime.session?'已暂停':'待机';
  $('workspace-status').textContent=$('engine-state').textContent=state;$('workspace-dot').classList.toggle('on',runtime.running);
  $('engine-model').textContent=runtime.modelsReady?'已加载 · 3 个网络':runtime.modelPromise?'加载中':'按需加载';
  $('engine-platform').textContent=desktop?'Windows 桌面版':'浏览器';
  $('workspace-mode').textContent=runtime.demo?'模拟数据预览 · 不写入真实记录':desktop&&runtime.background?'桌面后台采集已允许':'本地计算 · 不保存原始视频';
}
function supportHTML(notes){return notes.map(m=>`<article class="support-item ${esc(m.level||'')}"><h3>${esc(m.title)}</h3><p>${esc(m.text)}</p><span class="basis">${esc(m.basis)}</span></article>`).join('');}
function moodChart(id, journals, days) {
  const items = selfJournals(journals), width = 600, height = 190, left = 26, right = 580, top = 18, bottom = 155, today = new Date();today.setHours(12,0,0,0);
  let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="最近${days}天的本人心情回顾，缺失日期不连线">`;
  for (let v = 1; v <= 5; v++) { const y = bottom - (v - 1) * (bottom - top) / 4;svg += `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="#edf1e9" stroke-dasharray="4 5"/><text x="4" y="${y+3}" class="chart-text">${v}</text>`; }
  let previous = null;
  for (let i = 0; i < days; i++) {
    const d = new Date(today);d.setDate(d.getDate() - days + 1 + i);const key = dayKey(d), j = items.find(x => x.date === key), x = left + i * (right - left) / (days - 1);
    if (i % (days > 7 ? 2 : 1) === 0 || i === days - 1) svg += `<text x="${x}" y="180" text-anchor="middle" class="chart-text">${d.getMonth()+1}/${d.getDate()}</text>`;
    if (j && Number.isFinite(j.mood)) {
      const y = bottom - (j.mood - 1) * (bottom - top) / 4;
      if (previous) svg += `<path d="M${previous.x},${previous.y} L${x},${y}" stroke="#729582" stroke-width="2.5" fill="none"/>`;
      svg += `<circle cx="${x}" cy="${y}" r="4" fill="#729582" stroke="#fff" stroke-width="2"><title>${key}：${j.mood}/5</title></circle>`;previous = { x, y };
    } else previous = null;
  }
  svg += '</svg>';
  $(id).innerHTML = svg + (!items.length ? '<div class="chart-empty">还没有本人心情记录<span>完成回顾后，这里会显示真实变化</span></div>' : '');
}
function expressionBars(id, stats) {
  $(id).innerHTML = LABELS.map(({key,name,color}) => `<div class="expression-row"><span>${name}</span><div class="expression-track"><div class="expression-fill" data-key="${key}"></div></div><strong>${stats.validMs ? Math.round((stats.categories[key] || 0) / stats.validMs * 100) + '%' : '—'}</strong></div>`).join('');
  $(id).querySelectorAll('.expression-fill').forEach(el => { const k = el.dataset.key;el.style.width = `${stats.validMs ? (stats.categories[k] || 0) / stats.validMs * 100 : 0}%`;el.style.background = LABELS.find(x => x.key === k).color; });
}
function renderOverview() {
  const report=automaticReport(sourceData(),runtime.profile,7);
  $('today-date').textContent=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})+' / '+PROFILES[runtime.profile].name;
  renderMetrics('overview-metrics',report);volumeChart('overview-chart',report);minuteTimeline(report);renderEngine();
  $('overview-suggestion').innerHTML=`<p class="auto-summary-text">${esc(report.summary)}</p><div class="brief-divider"></div><h3>${esc(report.notes[0].title)}</h3><p>${esc(report.notes[0].text)}</p><span class="basis">${esc(report.notes[0].basis)}</span>`;
}
function renderRecords(){
  const r=automaticReport(sourceData(),runtime.profile,14);renderMetrics('records-metrics',r);$('records-count').textContent=r.sessions.length+' 次';
  $('session-list').innerHTML=r.sessions.length?'<div class="session-table-head"><span>会话 / 场景</span><span>有效观察</span><span>已开启</span><span>覆盖率</span><span>状态</span></div>'+r.sessions.map(s=>`<article class="session-row"><div><strong>${new Date(s.startedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</strong><small>${esc(SCENES[s.scene]?.name||s.scene)}</small></div><span>${minutes(s.periodValidMs)}<small> 分钟</small></span><span>${minutes(s.periodActiveMs)}<small> 分钟</small></span><span>${s.periodActiveMs&&r.denominatorKnown?(Math.min(1,s.periodValidMs/s.periodActiveMs)*100).toFixed(1)+'%':'—'}</span><span class="session-badge">${({active:'采集中',paused:'暂停',finished:'已完成',interrupted:'已中断'})[s.status]||'未知'}</span></article>`).join(''):'<div class="archive-empty">'+icon('book')+'<h3>尚无监测会话</h3><p>每次开启、暂停和结束都会自动归档。</p><button class="button outline" data-view="companion">进入实时监测</button></div>';
}
function renderReport() {
  const report=automaticReport(sourceData(),runtime.profile,runtime.days);
  renderMetrics('insight-metrics',report);volumeChart('insight-chart',report);expressionBars('report-expression-bars',report.stats);
  $('report-summary').textContent=report.summary;
  $('report-limit').textContent=`统计空间为${PROFILES[runtime.profile].name}。已开启 ${minutes(report.stats.activeMs)} 分钟，未纳入有效观察的开启时长 ${report.stats.coverage===null?'无法完整计算':minutes(Math.max(0,report.stats.activeMs-report.stats.validMs))+' 分钟'}。缺失不当作中性或健康，不外推为全天状态。`+(report.undatedMs?`旧版记录有 ${minutes(report.undatedMs)} 分钟缺少时间定位，仅计入类别汇总。`:'')+(report.legacyExcluded?'部分跨期旧记录没有分钟明细，无法分配到本期，已排除。':'');
  $('self-summary').innerHTML=`<span>时间粒度<strong>1 分钟</strong></span><span>记录来源<strong>摄像头自动统计</strong></span>`;
  $('automatic-support').innerHTML=supportHTML(report.notes);
  const recent=scoped(sourceData(),runtime.profile,14),hasClinical=recent.assessments.length||recent.screenings.length||recent.who5.length;
  $('support-cards').innerHTML=hasClinical?supportHTML(supportMessages(sourceData(),runtime.profile)):'<p class="fine">当前没有近期量表结果。此项为可选工具，不影响自动监测和报告。</p>';
  renderComparisons(report);
}
function shareText(value){return value===null?'—':(value*100).toFixed(1)+'%';}
function renderComparisons(report){
  const c=personalComparison(report),scene=SCENES[c.scene]?.name||'当前场景';
  $('personal-comparison').innerHTML=`<div class="comparison-heading"><span>${esc(scene)} · 最近观察日 ${esc(c.latest?.date||'暂无')}</span><span>历史参考 ${c.baselineDays} 天</span></div>`+(c.available?`<div class="comparison-table"><div class="comparison-row comparison-head"><span>模型类别</span><span>最近观察日</span><span>个人参考均值</span><span>变化 / 百分点</span></div>${c.rows.map(r=>`<div class="comparison-row"><span>${esc(r.name)}</span><strong>${shareText(r.latestShare)}</strong><span>${shareText(r.referenceMean)}</span><span>${r.delta>0?'+':''}${(r.delta*100).toFixed(1)}</span></div>`).join('')}</div>`:'<div class="comparison-empty"><strong>观察数据尚不足以比较</strong><p>记录会自动累计，不需要手工建立基线。</p></div>')+`<p class="fine comparison-note">${esc(c.interpretation)}</p>`;
  const s=sessionComparison(report);
  $('session-comparison').innerHTML=s?`<div class="comparison-heading"><span>${esc(SCENES[s.scene]?.name)} · ${new Date(s.startedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</span><span>前段 ${minutes(s.halves[0].validMs)} / 后段 ${minutes(s.halves[1].validMs)} 分钟有效观察</span></div><div class="session-change-grid">${s.rows.map(r=>`<article><h3>${esc(r.name)}</h3><div class="change-pair"><span>前 ${shareText(r.before)}</span><strong>后 ${shareText(r.after)}</strong></div><div class="paired-tracks"><i data-before="${r.before}" data-key="${r.key}"></i><i data-after="${r.after}" data-key="${r.key}"></i></div></article>`).join('')}</div><p class="fine comparison-note">${esc(s.interpretation)}</p>`:'<div class="comparison-empty"><strong>等待完整的观察会话</strong><p>本期会话至少需十分钟有效数据，前后时段各有两分钟有效片段，才显示这项比较。这是数据可用性设置，不是医学标准。</p></div>';
  $('session-comparison').querySelectorAll('.paired-tracks i').forEach(el=>{const v=el.hasAttribute('data-before')?el.dataset.before:el.dataset.after;el.style.width=(Number(v)*100)+'%';el.style.background=LABELS.find(l=>l.key===el.dataset.key).color;});
  const p=performanceSummary(report.sessions);$('report-performance').textContent=p?`运行记录 · 推理中位数 ${Math.round(p.median)} ms，90%样本不超过 ${Math.round(p.p90)} ms。${p.scope}。`:'运行记录 · 开始采集后自动统计推理耗时。旧版记录没有该信息时不补造。';
}
function setProfile(profile) {
  if (!PROFILES[profile]) return;
  if (runtime.session || runtime.starting) { toast('请先结束当前陪伴，再切换空间。');return; }
  if (runtime.demo && profile !== 'self') { toast('示例仅展示我的空间；请先退出示例。');return; }
  runtime.profile = profile;runtime.scene = profile === 'self' ? 'study' : profile;
  $('profile-select').value = profile;document.body.classList.toggle('large-type',profile === 'elder');
  $('camera-consent').checked = false;$('child-assent').checked = false;$('screen-form').reset();$('who-form').reset();$('full-assessment-form').reset();setAssessmentStep(0);assessmentSafety();
  renderSpaces();renderScene();loadJournal();renderAll();
}
function renderSpaces() {
  const html = Object.entries(PROFILES).map(([key,p]) => `<button data-profile="${key}" class="${runtime.profile === key ? 'active' : ''}">${esc(p.name)}</button>`).join('');
  $('space-tabs').innerHTML = $('screen-space-tabs').innerHTML = html;
}
function renderScene() {
  const scene = SCENES[runtime.scene], child = runtime.profile === 'child';
  $('scene-tabs').innerHTML = Object.entries(SCENES).map(([key,s]) => `<button data-scene="${key}" class="${key === runtime.scene ? 'active' : ''}">${s.name}</button>`).join('');
  $('scene-heading').textContent = scene.name;$('journal-profile').textContent = PROFILES[runtime.profile].name;$('journal-prompt').textContent = scene.question;
  $('session-task').placeholder = scene.task;$('session-length').value = scene.minutes;
  $('consent-label').textContent = child ? '我是监护人，自愿陪同，并同意在此设备保存汇总记录。' : runtime.profile === 'elder' ? '使用者本人已知情同意，并能理解本工具用途；代操作不代替本人同意。' : '我已年满 18 岁，自愿使用，并同意在此设备保存汇总记录。';
  $('child-assent-wrap').hidden = !child;
  $('scene-caution').textContent = child ? '儿童可随时拒绝。只用于陪同回顾，不评价学习能力，不输出成人筛查结果；不进行隐蔽监控。' : runtime.profile === 'elder' ? '请考虑身体不适、视听和理解困难。陪同者观察不替代本人感受，不能用于判断认知症。' : '请只让使用者本人出镜。多人同框、低质量或无法确定的结果不计入统计。';
  $('journal-title').textContent = child ? '儿童生活记录' : runtime.profile === 'elder' ? '长者生活记录' : '今日生活记录';
  
}
function chooseScene(key) {
  if (!SCENES[key]) return;
  if (runtime.session || runtime.starting) { toast('请先结束当前陪伴，再切换场景。');return; }
  if (runtime.demo) { toast('请退出示例后选择真实使用场景。');return; }
  if (SCENES[key].profile !== runtime.profile) setProfile(SCENES[key].profile);
  runtime.scene = key;renderScene();loadJournal();showView('companion');
}
function showView(view) {
  if (!titles[view]) view = 'overview';
  if (view !== 'companion' && runtime.running && !runtime.pip && !(desktop && runtime.background)) pauseSession('已离开记录界面，摄像头暂停。可返回后继续；桌面版支持后台记录。');
  runtime.view = view;all('.view').forEach(el => el.hidden = el.id !== 'view-' + view);all('.nav-item[data-view]').forEach(el => { el.classList.toggle('active',el.dataset.view === view);el.setAttribute('aria-current',el.dataset.view === view ? 'page' : 'false'); });
  $('page-title').textContent = titles[view];history.replaceState(null,'','#' + view);renderAll();window.scrollTo(0,0);
}
function renderAll() { renderOverview();renderReport();renderRecords();renderScreen();renderSession();$('demo-banner').hidden = !runtime.demo;$('demo-toggle').textContent = runtime.demo ? '退出示例' : '查看示例'; }
function loadJournal() {
  $('journal-date').max = dayKey();if (!$('journal-date').value) $('journal-date').value = dayKey();
  const j = sourceData().journals.find(j => j.profile === runtime.profile && j.date === $('journal-date').value);
  all('input[name=mood]').forEach(el => el.checked = j ? Number(el.value) === j.mood : false);
  for (const [id,key,fallback] of [['stress','stress',5],['energy','energy',5],['sleep','sleep',''],['good-thing','good',''],['journal-note','note',''],['duration','duration','没有明显困扰'],['impact','impact','没有明显影响'],['reporter','reporter','本人']]) $(id).value = j?.[key] ?? fallback;
  $('stress-value').textContent = $('stress').value;$('energy-value').textContent = $('energy').value;$('journal-status').textContent = j ? '已载入这一天的记录，再保存会更新。' : '';
}
function saveJournal(event) {
  event.preventDefault();if (!allowWrite()) return;
  const mood = Number(document.querySelector('input[name=mood]:checked')?.value), date = $('journal-date').value;
  if (!Number.isInteger(mood) || mood < 1 || mood > 5) { $('journal-status').textContent = '请先选择一个心情。';return; }
  if (!date || date > dayKey() || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { $('journal-status').textContent = '请选择有效日期，不能记录未来。';return; }
  const sleep = $('sleep').value === '' ? null : Number($('sleep').value);
  if (sleep !== null && (!Number.isFinite(sleep) || sleep < 0 || sleep > 24)) return;
  const row = { profile:runtime.profile,date,mood,stress:Number($('stress').value),energy:Number($('energy').value),sleep,good:$('good-thing').value.trim().slice(0,160),note:$('journal-note').value.trim().slice(0,600),duration:$('duration').value,impact:$('impact').value,reporter:$('reporter').value };
  const index = data.journals.findIndex(j => j.profile === runtime.profile && j.date === date);
  if (index < 0) data.journals.push(row);else data.journals[index] = row;
  data.journals.sort((a,b) => a.date.localeCompare(b.date));const saved = persist();renderAll();
  $('journal-status').textContent = saved ? '已保存到当前设备。可以到趋势与回顾查看。' : '浏览器保存失败，当前仅在内存中。请立即导出记录。';toast(saved ? '已记下今天的感受' : '未写入设备，请导出备份');
}
function renderScreen() {
  const child = runtime.profile === 'child', older = runtime.profile === 'elder';$('adult-screen').hidden = child || runtime.assessmentMode !== 'quick';$('child-screen').hidden = !child;
  $('assessment-modes').hidden = child;$('full-assessment').hidden = child || runtime.assessmentMode !== 'full';
  all('[data-assessment-mode]').forEach(el => el.classList.toggle('active',el.dataset.assessmentMode === runtime.assessmentMode));
  $('screen-age-note').textContent = child ? '儿童使用适龄评估。本工具只保留心情和陪同记录，不输出成人量表分级。' : older ? '长者需本人理解并作答。本项目尚未验证长者自动焦虑分级，因此只记录原始分；有困扰时可直接找专业人员评估。' : '请按实际情况作答。结果描述近两周症状程度，不能单独确认是否患病。';
  renderFullAssessment();
  const screen = sourceData().screenings.filter(s => s.profile === runtime.profile).at(-1);
  if (!child && screen) {
    const r = screen.result, old = Date.now() - screen.time > 14 * 86400000;
    $('screen-result').innerHTML = `<p class="fine">最近一次 ${esc(new Date(screen.time).toLocaleDateString('zh-CN'))}${old ? ' · 记录已超过两周，不代表当前状态' : ''}</p><div class="screen-result-grid"><div class="screen-result-card ${r.depressionFlag ? 'follow' : ''}"><h3>PHQ-2 · 抑郁相关症状</h3><strong>${r.phq2}<small> / 6</small></strong><p>${r.depressionFlag ? '达到筛查提示值，建议进一步评估。' : '未达到常用提示值，仍不能排除问题。'}</p></div><div class="screen-result-card ${r.anxietyFlag ? 'follow' : ''}"><h3>GAD-2 · 焦虑相关症状</h3><strong>${r.gad2}<small> / 6</small></strong><p>${older ? '长者空间仅记录原始分，不自动判定焦虑风险。' : r.anxietyFlag ? '达到筛查提示值，建议进一步评估。' : '未达到常用提示值，仍不能排除问题。'}</p></div></div><p class="fine">结果只来自本人问卷，不含表情信息。不是疾病诊断。</p>`;
  } else $('screen-result').replaceChildren();
  const who = sourceData().who5.filter(s => s.profile === runtime.profile).at(-1);
  $('who-result').innerHTML = !child && who ? `<div class="inline-note">最近录入 ${esc(new Date(who.time).toLocaleDateString('zh-CN'))} · WHO-5 ${who.result.score}/100。${who.result.followUp ? '低于常用提示值，建议进一步评估。' : '本次未低于常用提示值，不等于排除疾病。'}<br>来源：本人完成官方问卷后手动录入。</div>` : '';
}
function saveScreen(event) {
  event.preventDefault();if (!allowWrite() || runtime.profile === 'child') return;
  if (!$('screen-consent').checked) return;
  const answers = SCREEN_ITEMS.map(item => { const chosen = document.querySelector(`input[name=screen-${item.key}]:checked`);return chosen ? Number(chosen.value) : null; });
  try { const result = scoreScreen(answers,PROFILES[runtime.profile].age);data.screenings.push({ profile:runtime.profile,time:Date.now(),answers,result,source:'self_report_phq2_gad2',wording:'phqscreeners_cn_first_two_items' });persist();renderAll();toast('已记录自查，提示不代表诊断'); }
  catch (error) { toast(error.message); }
}
function saveWho(event) {
  event.preventDefault();if (!allowWrite() || runtime.profile === 'child' || !$('who-consent').checked || $('who-raw').value === '') return;
  try { const result = scoreWho5(Number($('who-raw').value),PROFILES[runtime.profile].age);data.who5.push({ profile:runtime.profile,time:Date.now(),result,source:'self_entered_official_who5' });persist();renderAll();toast('已记录本人录入的幸福感分数'); }catch (error) { toast(error.message); }
}

function assessmentValues(prefix, count) {
  return Array.from({length:count},(_,i) => { const el = document.querySelector(`input[name=${prefix}-${i}]:checked`);return el ? Number(el.value) : null; });
}
function setAssessmentStep(step) {
  runtime.assessmentStep = Math.max(0,Math.min(2,step));
  all('.assessment-step').forEach(el => el.hidden = Number(el.dataset.step) !== runtime.assessmentStep);
  $('assessment-progress').textContent = `第 ${runtime.assessmentStep+1} / 3 步`;
  $('assessment-prev').disabled = runtime.assessmentStep === 0;$('assessment-next').hidden = runtime.assessmentStep === 2;$('assessment-submit').hidden = runtime.assessmentStep !== 2;
  $('assessment-form-status').textContent = '';
}
function assessmentSafety() {
  const ninth = document.querySelector('input[name=phq9-8]:checked');
  $('assessment-live-safety').hidden = !(ninth && Number(ninth.value)>0 || $('assessment-safety').value === 'unsafe');
}
function renderFullAssessment() {
  const saved = sourceData().assessments?.filter(a => a.profile === runtime.profile).at(-1), result = saved?.result;
  if (!result || runtime.profile === 'child') { $('assessment-result').replaceChildren();return; }
  const age = (Date.now()-saved.time)/86400000;
  $('assessment-result').innerHTML = `<section class="assessment-report"><div class="card-title"><h2>评估结果与建议</h2><span class="mini-label">${esc(new Date(saved.time).toLocaleDateString('zh-CN'))}${age>14 ? ' · 历史记录' : ''}</span></div><p class="assessment-conclusion">${esc(assessmentSummary(result))}</p><div class="screen-result-grid"><div class="screen-result-card ${result.depression.band>=2?'follow':''}"><h3>抑郁相关症状 · PHQ-9</h3><strong>${result.depression.score}<small> / 27</small></strong><p>${esc(result.depression.label)}</p></div><div class="screen-result-card ${result.anxiety.followUp?'follow':''}"><h3>焦虑相关症状 · GAD-7</h3><strong>${result.anxiety.score}<small> / 21</small></strong><p>${esc(result.anxiety.label)}</p></div></div><dl class="assessment-context"><div><dt>困扰持续时间</dt><dd>${esc(result.context.duration)}</dd></div><div><dt>生活影响</dt><dd>${esc(result.context.impact)}</dd></div><div><dt>易怒频率</dt><dd>${esc(result.irritability)}，${esc(result.context.control)}</dd></div></dl><p class="fine">是否患有抑郁症或焦虑障碍，还需专业人员结合面谈、身体状况和其他原因评估。易怒记录没有独立的疾病分数。${age>14?'这份记录已超过两周，不代表目前状态。':''}</p><div class="assessment-actions">${result.actions.map(a=>`<article class="assessment-action ${a.level}"><h3>${esc(a.title)}</h3><p>${esc(a.text)}</p></article>`).join('')}</div><p class="fine">计分与界值见<a href="${ASSESSMENT_SOURCE}" target="_blank" rel="noreferrer">原作者说明书</a>。PHQ-9 中文题目采用香港基层医疗署版本，GAD-7 采用国家卫健委文件中的中文版本。本项目尚未验证其网页实施效果。</p><button class="button outline" id="export-assessment">导出本次结果</button></section>`;
}
function saveFullAssessment(event) {
  event.preventDefault();if (!allowWrite() || runtime.profile === 'child') return;
  const phq=assessmentValues('phq9',9),gad=assessmentValues('gad7',7);
  const context={duration:$('assessment-duration').value,impact:$('assessment-impact').value,irritability:$('assessment-irritability').value,control:$('assessment-control').value,unusualEnergy:$('assessment-energy').value,safety:$('assessment-safety').value,physical:$('assessment-physical').checked};
  if (!context.duration || !context.impact || !context.safety || !$('assessment-consent').checked) { $('assessment-form-status').textContent='请填写持续时间、生活影响和当前安全情况，并确认本人同意。';return; }
  try {
    const result=assessSymptoms(phq,gad,context,PROFILES[runtime.profile].age);
    data.assessments.push({profile:runtime.profile,time:Date.now(),phq,gad,result,source:'self_report_full',phqVersion:'DHC_zh-Hans',gadVersion:'NHC_WST802_2022_B3'});
    const saved=persist();renderAll();$('assessment-form-status').textContent=saved?'结果已保存在当前设备。下方列出分数、建议及其依据。':'浏览器保存失败，请立即导出结果。';$('assessment-result').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(error) { $('assessment-form-status').textContent=error.message; }
}
function exportAssessment() {
  const saved=sourceData().assessments?.filter(a=>a.profile===runtime.profile).at(-1);if(!saved)return;
  const r=saved.result;download(`心晴伴_症状评估_${dayKey(saved.time)}.txt`,`心晴伴症状评估\n填写日期 ${new Date(saved.time).toLocaleString('zh-CN')}\n${assessmentSummary(r)}\n\n持续时间 ${r.context.duration}\n生活影响 ${r.context.impact}\n易怒 ${r.irritability}；${r.context.control}\n\n建议\n${r.actions.map(a=>a.title+'\n'+a.text).join('\n\n')}\n\n本结果不能单独确认疾病，未使用摄像头数据。计分依据 ${ASSESSMENT_SOURCE}`);
}

async function loadModels() {
  if (runtime.modelsReady) return;
  if (!runtime.modelPromise) {
    document.documentElement.dataset.modelState = 'loading';notice('正在加载三个本地模型，首次需要一点时间。');
    let timeout;
    runtime.modelPromise = Promise.race([
      Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri('./models'),faceapi.nets.faceLandmark68TinyNet.loadFromUri('./models'),faceapi.nets.faceExpressionNet.loadFromUri('./models')]),
      new Promise((_,reject) => { timeout = setTimeout(() => reject(new Error('模型加载超过 35 秒，请检查网络后重试')),35000); }),
    ]).then(() => { clearTimeout(timeout);runtime.modelsReady = true;document.documentElement.dataset.modelState = 'ready'; }).catch(error => { clearTimeout(timeout);runtime.modelPromise = null;document.documentElement.dataset.modelState = 'failed';throw error; });
  }
  return runtime.modelPromise;
}
function canCapture() { return !!(desktop && runtime.background) || (!document.hidden && runtime.view === 'companion') || !!(runtime.pip && !runtime.pip.closed && runtime.pip.document.visibilityState !== 'hidden'); }
function clearTemporal() { runtime.previousSample = null;runtime.smoothed = null;runtime.votes = [];runtime.lastInfer = null;runtime.box = null; }
function stopTracks() { for (const track of runtime.stream?.getTracks() || []) track.stop();runtime.stream = null;if(desktop)desktop.setCaptureIntent(false);const video = $('video');if (video) { video.pause();video.srcObject = null;video.hidden = true; }$('overlay').hidden = true;$('face-labels').replaceChildren();runtime.currentFrame=null;runtime.previewBox=null;runtime.manualBox=null;$('camera-placeholder').hidden = false; }
async function startSession() {
  if (!allowWrite() || runtime.running || runtime.starting) return;
  if (!$('camera-consent').checked || (runtime.profile === 'child' && !$('child-assent').checked)) { notice('请先确认本人同意；儿童还需监护人同意及孩子愿意参与。',true);return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) { notice('实时摄像头需要 HTTPS 或本机 localhost。请使用安全访问地址。',true);return; }
  runtime.starting = true;const generation = ++runtime.generation;renderSession();
  try {
    await loadModels();if (generation !== runtime.generation || !canCapture()) throw new Error('页面已离开，未开启摄像头。请返回陪伴界面重试。');
    if(desktop)await desktop.setCaptureIntent(true);
    const stream = await navigator.mediaDevices.getUserMedia({ audio:false,video:{ facingMode:'user',width:{ ideal:640 },height:{ ideal:480 },frameRate:{ ideal:10,max:15 } } });
    if (generation !== runtime.generation || !canCapture()) { stream.getTracks().forEach(t => t.stop());throw new Error('页面已离开，摄像头已停止。'); }
    runtime.stream = stream;const video = $('video');video.srcObject = stream;await video.play();
    if (generation !== runtime.generation || !canCapture()) { stopTracks();throw new Error('页面不可见，已暂停采集。'); }
    if (!runtime.session) { const s = freshSession(runtime.scene);s.task = SCENES[runtime.scene].name;data.sessions.push(s);runtime.session = s;runtime.lengthMs = Number(desktop ? $('desktop-length').value : $('session-length').value) * 60000; }
    runtime.session.status = 'active';runtime.running = true;runtime.clockAt = performance.now();runtime.wallAt=Date.now();clearTemporal();video.hidden = false;$('camera-placeholder').hidden = true;
    stream.getVideoTracks().forEach(track => { track.addEventListener('ended',() => { if (runtime.running) pauseSession('摄像头被系统或其他应用关闭，采集已暂停。'); });track.addEventListener('mute',() => { if (runtime.running) pauseSession('摄像头画面被系统暂停，请返回后手动继续。'); }); });
    persist();notice('只在单人且画面有效时记录表情片段。没有录像，也不判断疾病。');inferLoop(generation);
  } catch (error) {
    stopTracks();notice(error.name === 'NotAllowedError' ? '没有获得摄像头权限。请在浏览器设置中允许后重试。' : error.name === 'NotFoundError' ? '没有找到可用摄像头。请连接摄像头后重试。' : error.message || '摄像头启动失败，请重试。',true);
  } finally { runtime.starting = false;renderSession(); }
}
function updateActiveTime() {
  if (!runtime.running || runtime.clockAt === null || !runtime.session) return;
  const now = performance.now(), delta = now - runtime.clockAt,end=Date.now(),wallDelta=end-runtime.wallAt;runtime.clockAt = now;runtime.wallAt=end;
  // A suspended process must not appear to have collected through the gap.
  if (delta > 5000 || delta < 0) { pauseSession('检测到系统暂停或设备休眠。缺失时段没有补算，返回后请手动继续。',false);return; }
  if(Math.abs(wallDelta-delta)>250){pauseSession('检测到系统时间发生变化，已暂停采集。请检查时间后手动继续。',false);return;}
  runtime.session.activeMs += delta;
  const start=end-delta,intervals=runtime.session.activeIntervals;
  // Append only measured active ticks; never interpolate a pause or suspension.
  if(Array.isArray(intervals)){const previous=intervals.at(-1);if(previous && Math.abs(previous.end-start)<50)previous.end=end;else intervals.push({start,end});}
}
function pauseSession(reason = '已暂停，摄像头已关闭。返回后可手动继续。', update = true, countPause = true) {
  if (!runtime.running && !runtime.starting) return;
  if (update && runtime.running) updateActiveTime();
  runtime.running = false;runtime.starting = false;runtime.generation++;runtime.clockAt = null;clearTemporal();stopTracks();
  if (runtime.session) { runtime.session.status = 'paused';if (countPause) runtime.session.pauses++;runtime.session.lastSavedAt = Date.now();persist(); }
  $('live-expression').textContent = '—';$('face-status').textContent = '暂停期间不采集';notice(reason);renderAll();
}
function finishSession(reason = '') {
  const s = runtime.session;if (!s) return;
  if (runtime.running) pauseSession('已结束陪伴，摄像头已关闭。',true,false);
  s.status = 'finished';s.endedAt = Date.now();runtime.session = null;runtime.background=false;if(desktop){$('background-consent').checked=false;desktop.setBackground(false)}persist();
  if (runtime.pip) runtime.pip.close();
  const stats = sessionStats([s]);$('last-session-summary').hidden = false;
  $('last-session-summary').innerHTML = `<h2>${esc(SCENES[s.scene].name)}已结束</h2><p>${esc(s.task || SCENES[s.scene].task)} · 已开启 ${minutes(s.activeMs)} 分钟，有效观察 ${minutes(s.validMs)} 分钟，暂停 ${s.pauses} 次。</p><p class="fine">${esc(reason || '系统已保存有效观察时长、表情分布与分钟明细，可直接查看自动报告。')}</p><button class="button primary" data-view="insights">查看自动报告</button>`;
  notice('本次已结束并保存汇总。可以继续回顾，或另开一段陪伴。');renderAll();toast(reason || '陪伴已结束，摄像头已关闭');
}
function renderSession() {
  const s = runtime.session, running = runtime.running, busy = runtime.starting;
  $('start-session').disabled = running || busy || runtime.demo;$('start-session').innerHTML = icon('camera') + (busy ? '正在准备…' : s ? '继续监测' : '开启监测');
  $('pause-session').disabled = !running;$('end-session').disabled = !s;$('session-length').disabled = !!s || busy;$('session-task').disabled = !!s || busy;
  $('camera-state').textContent = busy ? '正在准备' : running ? '正在采集' : s ? '已暂停' : '尚未开始';$('session-state').textContent = running ? '本地采集中' : s ? '已暂停' : '未采集';
  $('recording-dot').classList.toggle('on',running);$('session-timer').textContent = clock(s?.activeMs || 0);$('valid-time').textContent = minutes(s?.validMs || 0);$('coverage').textContent = s?.activeMs ? Math.round(Math.min(1,s.validMs / s.activeMs)*100) + '%' : '—';
  const stats = sessionStats(s ? [s] : []);expressionBars('expression-bars',stats);$('active-banner').hidden = !s || runtime.view === 'companion';$('active-banner-text').textContent = `${SCENES[runtime.scene].name}${running ? '进行中' : '已暂停'} · ${clock(s?.activeMs || 0)}`;$('nav-live').hidden = !running;
  $('pip-button').disabled = !runtime.running && !runtime.pip;
  all('[data-scene],[data-profile]').forEach(el => el.disabled = !!s || busy);
  $('profile-select').disabled = !!s || busy;
  $('desktop-length').disabled=!!s||busy;$('background-hide').disabled=!running||!runtime.background;
  if(desktop && (performance.now()-runtime.lastDesktopStatus>400 || runtime.lastDesktopRunning!==running)) { desktop.setState({running,activeMs:s?.activeMs||0,validMs:s?.validMs||0,profile:runtime.profile});runtime.lastDesktopStatus=performance.now();runtime.lastDesktopRunning=running; }
}
function drawFaces(faces, width, height,primaryIndex=-1) {
  const canvas = $('overlay');canvas.width = width;canvas.height = height;canvas.hidden = false;const ctx = canvas.getContext('2d');ctx.clearRect(0,0,width,height);
  for (const [index,face] of faces.entries()) {
    const b = face.detection.box;ctx.lineWidth = Math.max(1.5,width/250);ctx.strokeStyle = index===primaryIndex ? '#80e2d3' : '#708a9e';ctx.strokeRect(b.x,b.y,b.width,b.height);
    if (index===primaryIndex && face.landmarks?.positions) { ctx.fillStyle = '#86dacf';for (const p of face.landmarks.positions) { ctx.beginPath();ctx.arc(p.x,p.y,1.3,0,7);ctx.fill(); } }
  }
  renderPreviewLabels(faces,width,height,primaryIndex);
}
function renderPreviewLabels(faces,width,height,primaryIndex){
 const host=$('face-labels'),rect=$('overlay').getBoundingClientRect(),scale=Math.min(rect.width/width,rect.height/height),ox=(rect.width-width*scale)/2,oy=(rect.height-height*scale)/2;
 host.replaceChildren();if(!scale)return;
 faces.forEach((face,index)=>{const b=face.detection.box,d=classify(normalize(face.expressions)),label=document.createElement('span');label.className='face-expression-label'+(index===primaryIndex?' primary':'');label.textContent=(index===primaryIndex?'主脸 · ':'')+(d.accepted?names[d.key]+' '+Math.round(d.score*100)+'%':'暂不判断');label.style.left=Math.max(55,Math.min(rect.width-55,ox+(width-b.x-b.width/2)*scale))+'px';label.style.top=Math.max(6,Math.min(rect.height-55,oy+(b.y+b.height)*scale+5))+'px';host.append(label);});
}
async function inferLoop(generation) {
  if (!runtime.running || generation !== runtime.generation) return;
  if (!canCapture()) { pauseSession('页面已不可见，采集暂停。返回后请手动继续。');return; }
  const start = performance.now();
  try {
    const video = $('video');if (!video.videoWidth || video.readyState < 2) throw new Error('摄像头尚未提供画面');
    // Snapshot the newest frame once. Detection, landmarks and expression must
    // refer to the same image rather than three points in a changing video.
    const frame=runtime.frameCanvas||(runtime.frameCanvas=document.createElement('canvas'));
    const dimensions=providedFrameSize(video.videoWidth,video.videoHeight);frame.width=dimensions.width;frame.height=dimensions.height;
    frame.getContext('2d').drawImage(video,0,0,frame.width,frame.height);
    const faces=await detectProvidedFrame(faceapi,frame,()=>runtime.running&&generation===runtime.generation);
    if (!runtime.running || generation !== runtime.generation) return;
    if (!canCapture()) { pauseSession('页面已不可见，采集暂停。');return; }
    runtime.lastInferenceMs=performance.now()-start;
    const width = frame.width,height = frame.height;
    let primary=runtime.manualBox?chooseFaceByOverlap(faces,runtime.manualBox):choosePrimaryFace(faces,width,height,runtime.previewBox);
    if(runtime.manualBox&&!primary&&faces.length){runtime.manualLostFrames=(runtime.manualLostFrames||0)+1;if(runtime.manualLostFrames>=2){runtime.manualBox=null;runtime.manualLostFrames=0;primary=choosePrimaryFace(faces,width,height,runtime.previewBox);}}else if(primary)runtime.manualLostFrames=0;
    if(primary){runtime.previewBox=primary.face.detection.box;if(runtime.manualBox)runtime.manualBox=runtime.previewBox;}else if(!faces.length)runtime.previewBox=null;
    runtime.currentFrame={faces,width,height,primaryIndex:primary?.index??-1};drawFaces(faces,width,height,primary?.index??-1);
    $('selection-state').textContent=faces.length>1?'多人预览 · 个人统计已暂停':runtime.manualBox?'主脸预览已锁定 · 单人时统计':'单人统计 · 自动预览主脸';
    const perf=runtime.session.performance||(runtime.session.performance={recentMs:[],frames:0});perf.recentMs.push(runtime.lastInferenceMs);if(perf.recentMs.length>240)perf.recentMs.shift();perf.frames++;
    let status = faces.length === 0 ? '未检测到人脸' : faces.length > 1 ? '多人入镜，暂停个人统计' : '', decision = null, liveDecision=null;
    if(faces.length===1&&runtime.manualBox&&!primary)status='锁定主脸未匹配，个人统计暂停；可点击人脸重新选择';
    if (faces.length === 1 && (!runtime.manualBox || primary)) {
      const face = faces[0], pose = estimateHeadPose(face.landmarks);let quality = inspectFace(face,width,height);
      if (quality === 'valid') quality = validateHeadPose(pose);
      if (quality === 'valid') {
        const mono = performance.now(), raw = normalize(face.expressions);
        liveDecision=classify(raw);
        if (runtime.box && overlap(runtime.box,face.detection.box) < .25) clearTemporal();
        runtime.smoothed = runtime.smoothed ? smooth(runtime.smoothed,raw,timeAwareAlpha((mono-runtime.lastInfer)/1000)) : raw;
        runtime.votes = appendVote(runtime.votes,mono,raw);decision = decideExpression(runtime.smoothed,summarizeVotes(runtime.votes));runtime.lastInfer = mono;runtime.box = face.detection.box;
        if (!decision.accepted) status = '类别不明确，这段不计入有效统计';
        else status = '单人画面有效';
      } else { const messages = { weak_detection:'人脸太小或不清晰',landmarks_missing:'关键点不可用',invalid_scores:'模型分数无效',pose_tilt:'头部偏斜较大',pose_yaw:'侧向偏移较大',pose_pitch:'俯仰比例不合适' };status = (messages[quality] || '画面不可用') + '，请自然正对镜头'; }
    }
    if(runtime.lastInferenceMs>1200){decision=null;liveDecision=null;status='处理耗时过长，当前帧不用于实时结果';}
    const accepted = faces.length === 1 && decision?.accepted;
    const sample = { time:Date.now(),profile:runtime.profile,key:accepted ? decision.key : null };
    creditSample(runtime.session,runtime.previousSample,sample);runtime.previousSample = sample;
    if (!accepted) { runtime.smoothed = null;runtime.votes = [];runtime.lastInfer = null;runtime.box = null;runtime.session.interruptions[faces.length > 1 ? 'multiple_people' : faces.length === 0 ? 'no_face' : 'quality_or_uncertain'] = (runtime.session.interruptions[faces.length > 1 ? 'multiple_people' : faces.length === 0 ? 'no_face' : 'quality_or_uncertain'] || 0) + 1; }
    $('face-status').textContent = status;$('live-expression').textContent = faces.length===1&&liveDecision?.accepted ? `${names[liveDecision.key]} ${Math.round(liveDecision.score*100)}%` : '暂不判断';
    const completed=performance.now();runtime.recentCompleted=(runtime.recentCompleted||[]).filter(t=>completed-t<4000);runtime.recentCompleted.push(completed);
    const recent=runtime.recentCompleted,rate=recent.length>1?(recent.length-1)*1000/(recent.at(-1)-recent[0]):0;
    $('inference-latency').textContent=`推理 ${Math.round(runtime.lastInferenceMs)} ms · ${rate?rate.toFixed(1):'—'} 次/秒`;
    renderSession();
  } catch (error) { if (generation === runtime.generation && runtime.running) { clearTemporal();notice('本次画面分析失败，采集已暂停。可以继续使用回顾。' + (error.message || ''),true);pauseSession('画面分析失败，摄像头已关闭。请重试，或使用心情手记。'); } }
  if (runtime.running && generation === runtime.generation) setTimeout(() => inferLoop(generation),Math.max(15,120 - (performance.now()-start)));
}
async function openPip() {
  if (runtime.pip) { runtime.pip.close();return; }
  if (!runtime.running) { notice('请先开启陪伴，再打开桌面小窗。');return; }
  if (!('documentPictureInPicture' in window)) { notice('当前浏览器不支持桌面陪伴小窗。请保持页面可见；手机不能保证后台采集。');return; }
  try {
    const pip = await documentPictureInPicture.requestWindow({ width:400,height:430 });runtime.pip = pip;
    pip.document.title = '心晴伴 · 采集中';pip.document.body.className = 'pip-body';
    for(const file of ['style.css','workspace.css']){const link = pip.document.createElement('link');link.rel = 'stylesheet';link.href = new URL('./'+file+'?v=20261023-v6',location.href).href;pip.document.head.append(link);}
    // Copy the local SVG definitions and move the existing media/controls.
    pip.document.body.append(document.querySelector('.svg-defs').cloneNode(true));pip.document.body.append($('live-monitor'));
    pip.addEventListener('pagehide',() => { const monitor = pip.document.getElementById('live-monitor');if (monitor) $('monitor-home').append(monitor);runtime.pip = null;if (document.hidden || runtime.view !== 'companion') pauseSession('陪伴小窗已关闭，摄像头已暂停。');renderSession(); },{ once:true });
    pip.document.addEventListener('visibilitychange',() => { if (pip.document.hidden && document.hidden) pauseSession('小窗与页面均不可见，采集已暂停。'); });
    notice('小窗已开启。请保持小窗可见；系统限速或休眠仍可能造成缺失。');
  } catch { notice('小窗未能开启。请保持当前页面可见，或换用支持此功能的桌面浏览器。'); }
}
function reportText(){
 const r=automaticReport(sourceData(),runtime.profile,runtime.days),c=personalComparison(r),s=sessionComparison(r);
 return `心晴伴自动观察报告\n${PROFILES[runtime.profile].name} · 近 ${runtime.days} 天\n生成 ${new Date().toLocaleString('zh-CN')}\n${runtime.demo?'模拟示例，不代表你的记录\n':''}\n${r.summary}\n\n表情类别的有效时长占比\n${r.ranked.map(x=>x.name+' '+(x.share===null?'无数据':(x.share*100).toFixed(1)+'%')+' / '+minutes(x.ms)+' 分钟').join('\n')}\n\n每日有效观察\n${r.daily.map(d=>d.date+' '+minutes(d.validMs)+' 分钟').join('\n')}\n缺少日内定位的旧记录 ${minutes(r.undatedMs)} 分钟；无法分配的跨期旧记录 ${r.legacyExcluded} 次。\n\n观察说明与建议\n${r.notes.map(n=>n.title+'\n'+n.text+'\n依据：'+n.basis).join('\n\n')}\n\n范围\n未采集时段不补算。当前仅描述摄像头采集片段，不判断真实内心感受，不由表情比例诊断抑郁、焦虑或其他疾病。可选症状评估独立导出。本报告无录像、照片或日记内容。\n\n个人参考比较\n${c.available?c.rows.map(x=>x.name+' 最近 '+shareText(x.latestShare)+' 参考 '+shareText(x.referenceMean)+' 变化 '+(x.delta*100).toFixed(1)+' 百分点').join('\n'):'数据尚不足以比较'}\n${c.interpretation}\n\n同次前后比较\n${s?s.rows.map(x=>x.name+' 前 '+shareText(x.before)+' 后 '+shareText(x.after)).join('\n'):'没有满足数据可用条件的会话'}\n不把前后变化解释为活动效果或疾病变化。`;
}
function toggleDemo() {
  if (runtime.session || runtime.starting) { toast('请先结束陪伴，再查看示例。');return; }
  runtime.demo = !runtime.demo;
  if (runtime.demo) { runtime.demoStore = demoData();runtime.profile = 'self';runtime.scene = 'study';$('profile-select').value = 'self';document.body.classList.remove('large-type'); }
  $('screen-form').reset();$('who-form').reset();$('full-assessment-form').reset();setAssessmentStep(0);assessmentSafety();renderSpaces();renderScene();loadJournal();renderAll();
}
function openBreak() {
  if (runtime.running) pauseSession('已开始休息，摄像头关闭。休息后可手动继续。');runtime.breakLeft = 60;runtime.breakAt = performance.now();$('break-count').textContent = '60';$('break-dialog').showModal();
}

// UI initialization. All user-authored text is escaped or assigned through textContent.
$('overview-scenes').innerHTML = Object.entries(SCENES).map(([key,s],i) => `<button class="scene-card" data-scene="${key}">${icon(['book','chart','shield','shield'][i])}<span>↗</span><strong>${s.name}</strong><p>${s.subtitle}</p></button>`).join('');
$('mood-options').innerHTML = moodWords.map((name,i) => `<span class="mood-option"><input type="radio" name="mood" id="mood-${i+1}" value="${i+1}"><label for="mood-${i+1}"><b>${moodSymbols[i]}</b>${name}</label></span>`).join('');
$('screen-items').innerHTML = SCREEN_ITEMS.map((item,i) => `<fieldset class="screen-item"><legend>${i+1}. ${esc(item.text)}</legend><div class="screen-options">${(item.options || ['根本没有','有几天','超过一半天数','几乎每天']).map((name,n) => `<label><input type="radio" name="screen-${item.key}" value="${n}" required>${esc(name)} <small>${n}</small></label>`).join('')}</div></fieldset>`).join('');
for(const [prefix,items,options] of [['phq9',PHQ9_ITEMS,PHQ9_OPTIONS],['gad7',GAD7_ITEMS,GAD7_OPTIONS]]) $(prefix+'-items').innerHTML=items.map((text,i)=>`<fieldset class="screen-item"><legend>${i+1}. ${esc(text)}</legend><div class="full-screen-options">${options.map((label,value)=>`<label><input type="radio" name="${prefix}-${i}" value="${value}"><span>${esc(label)}</span><small>${value}</small></label>`).join('')}</div></fieldset>`).join('');
$('evidence-list').innerHTML = EVIDENCE.map(e => `<article class="evidence-item"><div class="evidence-meta"><b>${esc(e.year)}</b><span>${esc(e.kind)}</span></div><h3>${esc(e.title)}</h3><p>${esc(e.detail)}</p><a href="${esc(e.url)}" target="_blank" rel="noreferrer">查看原始来源 ↗</a></article>`).join('') + `<article class="evidence-item"><div class="evidence-meta"><b>原版问卷</b><span>中文题目来源</span></div><h3>PHQ-9 与 GAD-7 中国简体中文版</h3><p>本应用摘录前两题，保留原版选项。原作者允许复制、展示与分发。摘录与网页实施方式仍需在目标人群验证。</p><a href="https://www.phqscreeners.com/images/sites/g/files/g10060481/f/201412/PHQ9_Simplified%20Chinese%20for%20Mainland%20China.pdf" target="_blank" rel="noreferrer">PHQ 中文原版 ↗</a> · <a href="https://www.phqscreeners.com/images/sites/g/files/g10060481/f/201412/GAD7_Chinese%20for%20China.pdf" target="_blank" rel="noreferrer">GAD 中文原版 ↗</a></article><article class="evidence-item"><div class="evidence-meta"><b>年龄边界</b><span>USPSTF</span></div><h3>长者焦虑普筛的证据不足</h3><p>中国老年标准包含由受训人员实施的 GAD-7。由于本项目尚未验证长者自动解释，长者空间只记录原始分；不能将此限制理解为老人无法评估焦虑。儿童不套用成人规则。</p><a href="https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/anxiety-adults-screening" target="_blank" rel="noreferrer">查看指南 ↗</a></article>`;
$('evidence-list').insertAdjacentHTML('afterbegin', `<article class="evidence-item"><div class="evidence-meta"><b>完整评估</b><span>题目与计分来源</span></div><h3>PHQ-9、GAD-7 的中文版本与解释</h3><p>PHQ-9 采用香港基层医疗署简体中文版；GAD-7 采用国家卫健委文件表 B.3。症状程度按原作者计分说明解释，生活影响与易怒记录单独呈现，不加进量表总分。</p><a href="https://www.dhc.gov.hk/sc/depression_questionnaire.html" target="_blank" rel="noreferrer">PHQ-9 官方中文</a> · <a href="https://www.nhc.gov.cn/cms-search/downFiles/49110d1bed934b6da0dbb3eb44f95395.pdf" target="_blank" rel="noreferrer">GAD-7 中文来源</a> · <a href="${ASSESSMENT_SOURCE}" target="_blank" rel="noreferrer">计分说明</a></article>`);
document.addEventListener('click',event => {
  const view = event.target.closest('[data-view]');if (view) showView(view.dataset.view);
  const scene = event.target.closest('[data-scene]');if (scene) chooseScene(scene.dataset.scene);
  const profile = event.target.closest('[data-profile]');if (profile) setProfile(profile.dataset.profile);
  const mode=event.target.closest('[data-assessment-mode]');if(mode){runtime.assessmentMode=mode.dataset.assessmentMode;renderScreen()}
  if(event.target.closest('#export-assessment'))exportAssessment();
  if (event.target.closest('[data-settings]')) { $('settings-status').textContent = ''; $('settings-dialog').showModal(); }
  const close = event.target.closest('[data-close]');if (close) $(close.dataset.close).close();
  const period = event.target.closest('[data-days]');if (period) { runtime.days = Number(period.dataset.days);all('[data-days]').forEach(b => b.classList.toggle('active',b === period));renderReport(); }
});
$('journal-form').addEventListener('submit',saveJournal);$('journal-date').addEventListener('change',loadJournal);
for (const key of ['stress','energy']) $(key).addEventListener('input',() => $(key+'-value').textContent = $(key).value);
$('screen-form').addEventListener('submit',saveScreen);$('who-form').addEventListener('submit',saveWho);
$('full-assessment-form').addEventListener('submit',saveFullAssessment);
$('assessment-prev').addEventListener('click',()=>setAssessmentStep(runtime.assessmentStep-1));
$('assessment-next').addEventListener('click',()=>{const values=assessmentValues(runtime.assessmentStep===0?'phq9':'gad7',runtime.assessmentStep===0?9:7);if(values.some(v=>v===null)){$('assessment-form-status').textContent='请回答本页全部题目，再继续。';return}setAssessmentStep(runtime.assessmentStep+1);$('full-assessment').scrollIntoView({behavior:'smooth',block:'start'})});
$('full-assessment-form').addEventListener('change',assessmentSafety);
$('start-session').addEventListener('click',startSession);$('pause-session').addEventListener('click',() => pauseSession());$('end-session').addEventListener('click',() => finishSession());$('pip-button').addEventListener('click',openPip);
$('automatic-face').addEventListener('click',()=>{runtime.manualBox=null;runtime.previewBox=null;$('selection-state').textContent='自动预览主脸 · 多人时不计入个人统计';});
$('preview').addEventListener('click',event=>{if(!runtime.running||!runtime.currentFrame)return;const f=runtime.currentFrame,point=mapPointerToFrame(event.clientX,event.clientY,$('overlay').getBoundingClientRect(),f.width,f.height,true),hit=point&&findFaceAtPoint(f.faces,point);if(hit){runtime.manualBox=hit.face.detection.box;runtime.previewBox=runtime.manualBox;$('selection-state').textContent='主脸预览已锁定 · 多人时不计入个人统计';notice('主脸选择仅控制预览。多人画面不计入个人报告，切换实际使用者应结束会话。');}});
for (const id of ['camera-consent','child-assent']) $(id).addEventListener('change',() => { if (!$(id).checked && (id !== 'child-assent' || runtime.profile === 'child')) pauseSession('参与同意已撤回，摄像头已关闭。'); });
$('profile-select').addEventListener('change',() => { setProfile($('profile-select').value);$('profile-select').value = runtime.profile; });
$('demo-toggle').addEventListener('click',toggleDemo);$('exit-demo').addEventListener('click',toggleDemo);
$('finish-break').addEventListener('click',() => { if (allowWrite()) { data.actions.push({ profile:runtime.profile,time:Date.now(),type:'self_reported_break',seconds:60-runtime.breakLeft });persist(); }$('break-dialog').close();toast('休息已结束，按自己的节奏继续'); });
$('export-report').addEventListener('click',() => $('report-dialog').showModal());$('download-report').addEventListener('click',() => { download(`${runtime.demo?'示例_':''}心晴伴_${PROFILES[runtime.profile].name}_${dayKey()}.txt`,reportText());$('report-dialog').close(); });
$('export-sessions').addEventListener('click',()=>download(`${runtime.demo?'示例_':''}心晴伴_监测统计_${dayKey()}.csv`,automaticCSV(automaticReport(sourceData(),runtime.profile,14)),'text/csv;charset=utf-8'));
$('export-csv').addEventListener('click',() => download(`${runtime.demo?'示例_':''}心晴伴_日记_${dayKey()}.csv`,reportCSV(sourceData(),runtime.profile),'text/csv;charset=utf-8'));
$('export-data').addEventListener('click',() => { const d = sourceData(), p = runtime.profile;download(`${runtime.demo?'示例_':''}心晴伴_${p}_${dayKey()}.json`,JSON.stringify({ version:1,exportedAt:new Date().toISOString(),simulated:runtime.demo,profile:p,...Object.fromEntries(['sessions','journals','screenings','assessments','who5','actions'].map(k => [k,(d[k]||[]).filter(x => x.profile === p)])) },null,2),'application/json');$('settings-status').textContent = '已导出当前空间，请妥善保管。'; });
$('delete-data').addEventListener('click',() => { if (!allowWrite()) return;if (runtime.session || runtime.starting) { toast('请先结束陪伴，再删除记录。');return; }$('delete-dialog').showModal(); });
$('confirm-delete').addEventListener('click',() => { if (!allowWrite() || runtime.session) return;for (const k of ['sessions','journals','screenings','assessments','who5','actions']) data[k] = data[k].filter(x => x.profile !== runtime.profile);persist();$('delete-dialog').close();$('settings-status').textContent = '当前空间的记录已删除。';loadJournal();renderAll(); });
document.addEventListener('visibilitychange',() => { runtime.breakAt = performance.now();if (document.hidden && !runtime.pip && !(desktop&&runtime.background)) pauseSession('页面已进入后台，摄像头停止。返回后请手动继续。'); });
document.addEventListener('freeze',() => pauseSession('浏览器暂停了页面，采集已停止。'));
window.addEventListener('pagehide',() => { if (runtime.session || runtime.starting) pauseSession('页面已离开，采集停止。');if (runtime.pip) runtime.pip.close(); });
setInterval(() => {
  if (runtime.running) { if (!canCapture()) pauseSession('采集窗口不可见，摄像头已暂停。');else { updateActiveTime();if (runtime.running && runtime.session.activeMs >= runtime.lengthMs) { finishSession('设定时长已到，摄像头已关闭。统计已保存，可直接查看报告。'); }else renderSession(); } }
  if (runtime.session && Date.now() - runtime.lastPersist > 5000) { runtime.session.lastSavedAt = Date.now();runtime.lastPersist = Date.now();persist(); }
  if(runtime.running && Date.now()-(runtime.lastDashboardRefresh||0)>5000){runtime.lastDashboardRefresh=Date.now();if(runtime.view==='overview')renderOverview();if(runtime.view==='insights')renderReport();if(runtime.view==='records')renderRecords();}
  if ($('break-dialog').open && !document.hidden) { const now = performance.now(),delta = runtime.breakAt === null ? 0 : Math.min(1500,now - runtime.breakAt);runtime.breakAt = now;runtime.breakLeft = Math.max(0,runtime.breakLeft - delta/1000);$('break-count').textContent = Math.ceil(runtime.breakLeft); }
},500);
$('journal-date').value = dayKey();renderSpaces();renderScene();loadJournal();showView(location.hash.slice(1));
document.documentElement.dataset.appState = 'ready';document.documentElement.dataset.modelState = 'idle';
if (!runtime.storageOK) toast('历史记录无法读取或存储不可用。当前内容仅在内存中，请导出备份。');
if (!('documentPictureInPicture' in window)) $('pip-button').hidden = true;
$('desktop-guide-button').addEventListener('click',()=>$('desktop-guide').showModal());
if(desktop){
  $('desktop-controls').hidden=false;$('desktop-web-note').hidden=true;$('pip-button').hidden=true;$('session-length').closest('label').hidden=true;
  $('platform-note').textContent='桌面版可在窗口收起后记录。需先开启摄像头并勾选本次后台记录。锁屏、休眠或完全退出时停止；不会开机自启。';
  desktop.onPause(reason=>pauseSession(reason));
  $('background-consent').addEventListener('change',async()=>{runtime.background=await desktop.setBackground($('background-consent').checked);if(!runtime.background&&runtime.running&&(document.hidden||runtime.view!=='companion'))pauseSession('已关闭后台记录，摄像头暂停。');renderSession()});
  $('background-hide').addEventListener('click',async()=>{if(await desktop.hideToTray())notice('桌面程序已收起。可用采集提示条或托盘菜单暂停和打开。')});
}
