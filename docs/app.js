;(function(){
"use strict";
const LABELS = [
  { key: 'neutral', name: '中性', color: '#748c9a' },
  { key: 'happy', name: '高兴', color: '#d2a449' },
  { key: 'sad', name: '悲伤', color: '#668bb9' },
  { key: 'angry', name: '愤怒', color: '#cb7668' },
  { key: 'fearful', name: '恐惧', color: '#a38bbf' },
  { key: 'disgusted', name: '厌恶', color: '#8b9c66' },
  { key: 'surprised', name: '惊讶', color: '#d39159' },
];

function normalize(scores) {
  if (!scores || LABELS.some(({ key }) => !Number.isFinite(scores[key]) || scores[key] < 0 || scores[key] > 1)) return null;
  const sum = LABELS.reduce((total, { key }) => total + scores[key], 0);
  if (sum <= 0) return null;
  return Object.fromEntries(LABELS.map(({ key }) => [key, scores[key] / sum]));
}

function smooth(previous, current, alpha = 0.35) {
  return Object.fromEntries(LABELS.map(({ key }) => [key, previous ? alpha * current[key] + (1 - alpha) * previous[key] : current[key]]));
}

function classify(scores, threshold = 0.60, minMargin = 0.15) {
  if (!scores) return { accepted: false, key: null, score: 0, margin: 0 };
  const ranked = LABELS.map(({ key }) => ({ key, score: scores[key] })).sort((a, b) => b.score - a.score);
  const margin = ranked[0].score - ranked[1].score;
  return { ...ranked[0], margin, accepted: ranked[0].score >= threshold && margin >= minMargin };
}

const PRIMARY_FACE_WEIGHTS = Object.freeze({ area: 0.40, center: 0.25, detection: 0.10, overlap: 0.25 });

function inspectFace(face, width, height) {
  if (!face) return 'no_face';
  const { box, score } = face.detection;
  if (score < 0.65 || box.width / width < 0.12 || box.height / height < 0.16) return 'weak_detection';
  if (!normalize(face.expressions)) return 'invalid_scores';
  return 'valid';
}

const PRIMARY_SWITCH_MARGIN = 0.10;

function choosePrimaryFace(faces, width, height, previousBox, switchMargin = PRIMARY_SWITCH_MARGIN) {
  if (!faces?.length || !width || !height) return null;
  const maxArea = Math.max(...faces.map(({ detection: { box } }) => Math.max(0, box.width * box.height)));
  const frameCenterX = width / 2, frameCenterY = height / 2;
  const maxCenterDistance = Math.hypot(frameCenterX, frameCenterY) || 1;
  const candidates = faces.map((face, index) => {
    const { box, score } = face.detection;
    const area = Math.max(0, box.width * box.height);
    const areaScore = maxArea > 0 ? area / maxArea : 0;
    const centerDistance = Math.hypot(box.x + box.width / 2 - frameCenterX, box.y + box.height / 2 - frameCenterY);
    const centerScore = Math.max(0, 1 - centerDistance / maxCenterDistance);
    const detectionScore = Math.max(0, Math.min(1, score));
    const overlapScore = overlap(previousBox, box);
    const total = PRIMARY_FACE_WEIGHTS.area * areaScore
      + PRIMARY_FACE_WEIGHTS.center * centerScore
      + PRIMARY_FACE_WEIGHTS.detection * detectionScore
      + PRIMARY_FACE_WEIGHTS.overlap * overlapScore;
    return {
      face,
      index,
      score: total,
      metrics: {
        area_ratio: area / (width * height),
        area_score: areaScore,
        center_score: centerScore,
        detection_score: detectionScore,
        overlap_score: overlapScore,
      },
    };
  });
  const best = candidates.reduce((winner, candidate) => !winner
    || candidate.score > winner.score + 1e-9
    || (Math.abs(candidate.score - winner.score) <= 1e-9 && candidate.metrics.detection_score > winner.metrics.detection_score)
    ? candidate : winner, null);
  const current = previousBox ? candidates.reduce((winner, candidate) => candidate.metrics.overlap_score > (winner?.metrics.overlap_score ?? -1) ? candidate : winner, null) : null;
  if (current && current.metrics.overlap_score >= 0.10 && best && current.index !== best.index && best.score < current.score + switchMargin) return current;
  return best;
}

function topExpression(scores) {
  const normalized = normalize(scores);
  if (!normalized) return null;
  return LABELS.map(({ key }) => ({ key, score: normalized[key] })).sort((a, b) => b.score - a.score)[0];
}

function timeAwareAlpha(dtSeconds, tauSeconds = 0.35) {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0 || !Number.isFinite(tauSeconds) || tauSeconds <= 0) return 0;
  return 1 - Math.exp(-Math.min(dtSeconds, 2) / tauSeconds);
}

function appendVote(votes, time, scores, maxAgeMs = 1000) {
  const kept = (votes || []).filter(point => time - point.time <= maxAgeMs);
  if (!scores) return kept;
  const top = topExpression(scores);
  if (top) kept.push({ time, key: top.key, score: top.score, scores });
  return kept;
}

function summarizeVotes(votes) {
  if (!votes?.length) return null;
  const counts = {}, totals = {};
  for (const { key } of LABELS) { counts[key] = 0; totals[key] = 0; }
  for (const vote of votes) {
    counts[vote.key] = (counts[vote.key] || 0) + 1;
    for (const { key } of LABELS) totals[key] += vote.scores[key] || 0;
  }
  const ranked = LABELS.map(({ key }) => ({ key, count: counts[key] || 0, average: totals[key] / votes.length })).sort((a, b) => b.count - a.count || b.average - a.average);
  const winner = ranked[0], runnerUp = ranked[1];
  return {
    key: winner.key,
    count: winner.count,
    samples: votes.length,
    ratio: winner.count / votes.length,
    score: winner.average,
    margin: winner.average - (runnerUp?.average || 0),
    average: Object.fromEntries(LABELS.map(({ key }) => [key, totals[key] / votes.length])),
  };
}

function estimateHeadPose(landmarks) {
  const points = landmarks?.positions || landmarks;
  if (!Array.isArray(points) || points.length < 68) return null;
  const average = indices => {
    const values = indices.map(index => points[index]).filter(Boolean);
    if (!values.length) return null;
    return { x: values.reduce((sum, point) => sum + point.x, 0) / values.length, y: values.reduce((sum, point) => sum + point.y, 0) / values.length };
  };
  const leftEye = average([36, 37, 38, 39, 40, 41]);
  const rightEye = average([42, 43, 44, 45, 46, 47]);
  const nose = points[30];
  const mouth = average([48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
  if (!leftEye || !rightEye || !nose || !mouth) return null;
  const eyeDistance = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
  if (eyeDistance <= 0) return null;
  const eyeCenter = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
  const eyeToMouth = Math.max(1, mouth.y - eyeCenter.y);
  return {
    roll: Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * 180 / Math.PI,
    yaw: (nose.x - eyeCenter.x) / eyeDistance,
    pitch: (nose.y - eyeCenter.y) / eyeToMouth,
    eye_distance: eyeDistance,
  };
}

function validateHeadPose(pose) {
  if (!pose) return 'landmarks_missing';
  if (Math.abs(pose.roll) > 12) return 'pose_tilt';
  if (Math.abs(pose.yaw) > 0.32) return 'pose_yaw';
  if (pose.pitch < 0.32 || pose.pitch > 0.72) return 'pose_pitch';
  return 'valid';
}

function chooseFaceByOverlap(faces, previousBox, minOverlap = 0.12) {
  if (!faces?.length || !previousBox) return null;
  let best = null;
  faces.forEach((face, index) => {
    const score = overlap(previousBox, face.detection.box);
    if (!best || score > best.score) best = { face, index, score, metrics: { overlap_score: score } };
  });
  return best && best.score >= minOverlap ? best : null;
}

function findFaceAtPoint(faces, point) {
  if (!faces?.length || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  let best = null;
  faces.forEach((face, index) => {
    const { box, score } = face.detection;
    const padding = Math.max(6, Math.min(24, Math.min(box.width, box.height) * 0.08));
    if (point.x < box.x - padding || point.x > box.x + box.width + padding || point.y < box.y - padding || point.y > box.y + box.height + padding) return;
    const distance = Math.hypot(point.x - (box.x + box.width / 2), point.y - (box.y + box.height / 2));
    if (!best || distance < best.distance || (Math.abs(distance - best.distance) <= 1e-9 && score > best.score)) best = { face, index, distance, score };
  });
  return best ? { face: best.face, index: best.index } : null;
}

function mapPointerToFrame(clientX, clientY, rect, frameWidth, frameHeight, mirrored = false) {
  if (!rect || !frameWidth || !frameHeight) return null;
  const scale = Math.min(rect.width / frameWidth, rect.height / frameHeight);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const displayWidth = frameWidth * scale, displayHeight = frameHeight * scale;
  let x = clientX - rect.left - (rect.width - displayWidth) / 2;
  const y = clientY - rect.top - (rect.height - displayHeight) / 2;
  if (x < 0 || x > displayWidth || y < 0 || y > displayHeight) return null;
  if (mirrored) x = displayWidth - x;
  return { x: x / scale, y: y / scale };
}
function overlap(a, b) {
  if (!a || !b) return 0;
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return intersection / (a.width * a.height + b.width * b.height - intersection || 1);
}

function toCSV(rows) {
  const fields = ['timestamp', 'elapsed_s', 'source', 'face_count', 'selection_mode', 'status', 'label', 'top_score', 'margin', 'threshold', 'inference_ms', 'detection_score', 'smoothing_alpha', 'vote_label', 'vote_ratio', 'vote_samples', ...LABELS.map(x => `raw_${x.key}`), ...LABELS.map(x => `smooth_${x.key}`)];
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return '\uFEFF' + [fields.join(','), ...rows.map(row => fields.map(field => quote(row[field])).join(','))].join('\r\n');
}

// Product rules are kept separate from the facial-expression model.
// No camera statistic enters a clinical screening calculation.
const DATA_KEY = 'xinqing-companion-v1';
const PROFILES = {
  self: { name: '我的空间', age: 'adult' },
  elder: { name: '长者空间', age: 'older' },
  child: { name: '儿童空间', age: 'child' },
};
const SCENES = {
  study: { name: '学习记录', profile: 'self', minutes: 25, subtitle: '自动观察学习时段的表情变化，形成会话与阶段报告。', task: '完成一段学习', question: '这次学习遇到了什么问题？你的感受如何？' },
  work: { name: '工作记录', profile: 'self', minutes: 45, subtitle: '自愿开启工作时段监测，自动整理有效观察与分类分布。', task: '完成一项工作', question: '这次工作有哪些压力，休息后有什么变化？' },
  elder: { name: '长者记录', profile: 'elder', minutes: 10, subtitle: '本人知情同意后进行短时观察，不代替本人表达。', task: '记录日常情况', question: '今天的精神、睡眠和身体情况如何？' },
  child: { name: '儿童记录', profile: 'child', minutes: 10, subtitle: '监护人陪同且孩子愿意参与，不做能力评分或疾病判定。', task: '记录当天情况', question: '今天发生了什么？有没有希望家长帮助的事情？' },
};
const SCREEN_ITEMS = [
  { key: 'interest', group: 'phq2', text: '做任何事都觉得沉闷或者根本不想做任何事', options: ['从来没有', '有几天', '刚超过一半天数', '接近每天'] },
  { key: 'low', group: 'phq2', text: '情绪低落、抑郁或绝望', options: ['从来没有', '有几天', '刚超过一半天数', '接近每天'] },
  { key: 'nervous', group: 'gad2', text: '感觉紧张、焦虑或不安', options: ['根本没有', '有几天', '超过一半天数', '几乎每天'] },
  { key: 'worry', group: 'gad2', text: '无法停止或控制担忧' },
];
const SCREEN_OPTIONS = ['完全没有', '有几天', '一半以上的日子', '几乎每天'];
const EVIDENCE = [
  { year: '2026', kind: '前瞻性试点', title: '手机关键点追踪与抑郁治疗监测的可行性', detail: '6名难治性抑郁患者，20次治疗中的重复表情任务。部分名义关联未通过多重比较校正。不能转换为七类表情比例的疾病阈值，也不是本项目的临床验证。', url: 'https://doi.org/10.1016/j.pscychresns.2026.112284' },
  { year: '2026', kind: '系统综述', title: '传感器用于抑郁监测，仍需标准化临床验证', detail: 'Rahimi 等的综述纳入 41 项研究。传感器、样本与研究设计差异较大，结果不能直接移植到本应用。', url: 'https://doi.org/10.1002/hsr2.71743' },
  { year: '2024', kind: '原始研究 · MobileHCI', title: 'FacePsy：自然情境下的面部行为研究', detail: '25 名成人、4 周的研究。跨人检验 AUC 0.67；包含同人历史信息的混合检验 AUC 0.81。使用 AU、头姿等特征，不能移植为七类表情的通用患病阈值，也不是本项目的准确率。', url: 'https://arxiv.org/html/2406.17181v1' },
  { year: '2019', kind: '科学证据评述', title: '表情动作和内心情绪没有简单的一一对应', detail: 'Barrett 等指出面部动作受文化、个人和情境影响。一个皱眉可能是专注，也可能是不适。', url: 'https://doi.org/10.1177/1529100619832930' },
  { year: '2003', kind: 'PHQ-2 原始验证', title: '抑郁相关症状的两题筛查', detail: '过去两周两题各 0–3 分，合计至少 3 分提示需要进一步评估。筛查阳性不能确认抑郁症，低分也不能排除。', url: 'https://pubmed.ncbi.nlm.nih.gov/14583691/' },
  { year: '2007', kind: 'GAD-2 原始验证', title: '焦虑相关症状的两题筛查', detail: '过去两周两题各 0–3 分，合计至少 3 分可作为进一步评估的提示。不是广泛性焦虑障碍的诊断。', url: 'https://pubmed.ncbi.nlm.nih.gov/17339617/' },
  { year: '2026', kind: 'NIH 工具说明', title: 'PHQ-4 将 PHQ-2 与 GAD-2 合为四题', detail: '本应用分别呈现两个分量表，不计算疾病概率。中文表述尚未在本项目目标人群中验证。', url: 'https://www.nih.gov/node/21506' },
  { year: '2024', kind: 'WHO 工具', title: 'WHO-5：积极心理幸福感', detail: '五题回顾过去两周。原始总分 0–25，乘 4 得 0–100 分；低于 50 分提示进一步评估。本应用提供官方问卷及手动录入，不由摄像头生成此分数。', url: 'https://www.who.int/publications/m/item/WHO-UCN-MSD-MHE-2024.01' },
  { year: '2025', kind: 'NIMH 健康信息', title: '持续时间与生活影响需要一起了解', detail: '持续低落、兴趣下降和生活功能受影响值得寻求专业评估。睡眠、身体状况、用药与生活事件也可能影响表现。', url: 'https://www.nimh.nih.gov/health/publications/depression' },
  { year: '平台文档', kind: 'Chrome / Chromium', title: '网页后台运行存在系统限制', detail: '后台网页可能被冻结或丢弃。桌面支持时可使用可见小窗；手机锁屏、切换应用和关闭页面不承诺持续采集。', url: 'https://developer.chrome.com/docs/web-platform/page-lifecycle-api' },
];
const CATEGORIES = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised'];
function dayKey(value = new Date()) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function blankData() { return { version: 1, sessions: [], journals: [], screenings: [], assessments: [], who5: [], actions: [] }; }
function freshSession(scene, now = Date.now()) {
  if (!SCENES[scene]) throw new Error('Unknown scene');
  return { id: `s-${now}-${Math.random().toString(36).slice(2, 9)}`, profile: SCENES[scene].profile, scene, startedAt: now, endedAt: null, activeMs: 0, activeIntervals: [], validMs: 0, categories: Object.fromEntries(CATEGORIES.map(k => [k, 0])), bins: [], pauses: 0, samples: 0, interruptions: {}, task: '', status: 'active' };
}
// Only adjacent accepted samples <=2.5s apart contribute time. Long gaps,
// uncertain/multi-person frames and paused intervals are never interpolated.
function creditSample(session, previous, current) {
  session.samples++;
  if (!previous || !current || previous.profile !== current.profile) return;
  const dt = current.time - previous.time;
  if (!(dt > 0 && dt <= 2500) || !CATEGORIES.includes(previous.key) || !CATEGORIES.includes(current.key)) return;
  session.validMs += dt;
  session.categories[previous.key] += dt;
  let cursor = previous.time;
  while (cursor < current.time) {
    const minute = Math.floor(cursor / 60000) * 60000;
    const duration = Math.min(current.time, minute + 60000) - cursor;
    let bin = session.bins.find(b => b.time === minute);
    if (!bin) { bin = { time: minute, categories: Object.fromEntries(CATEGORIES.map(k => [k, 0])) }; session.bins.push(bin); }
    bin.categories[previous.key] += duration;
    cursor += duration;
  }
}
function sessionStats(sessions) {
  const categories = Object.fromEntries(CATEGORIES.map(k => [k, 0]));
  let activeMs = 0, validMs = 0;
  for (const s of sessions) { activeMs += s.activeMs || 0;validMs += s.validMs || 0;for (const k of CATEGORIES) categories[k] += s.categories?.[k] || 0; }
  return { activeMs, validMs, coverage: activeMs ? Math.min(1, validMs / activeMs) : null, categories, happy: validMs ? categories.happy / validMs : null, challenging: validMs ? (categories.sad + categories.angry + categories.fearful + categories.disgusted) / validMs : null };
}
function scoreScreen(answers, age = 'adult') {
  if (age === 'child') return { eligible: false, reason: '儿童空间不使用成人筛查阈值' };
  if (!Array.isArray(answers) || answers.length !== 4 || answers.some(v => !Number.isInteger(v) || v < 0 || v > 3)) throw new Error('请完成全部四题');
  const phq2 = answers[0] + answers[1], gad2 = answers[2] + answers[3];
  return { eligible: true, phq2, gad2, depressionFlag: phq2 >= 3, anxietyFlag: age !== 'older' && gad2 >= 3, anxietyLimited: age === 'older', windowDays: 14 };
}
function scoreWho5(raw, age = 'adult') {
  if (age === 'child') return { eligible: false };
  if (!Number.isInteger(raw) || raw < 0 || raw > 25) throw new Error('原始总分必须为 0–25 的整数');
  return { eligible: true, raw, score: raw * 4, followUp: raw * 4 < 50 };
}
function scoped(data, profile, days = 7, now = Date.now()) {
  const first = new Date(now);first.setHours(0, 0, 0, 0);first.setDate(first.getDate() - days + 1);
  return {
    sessions: data.sessions.filter(s => s.profile === profile && s.startedAt >= first.getTime() && s.startedAt <= now),
    journals: data.journals.filter(j => j.profile === profile && new Date(j.date + 'T00:00:00').getTime() >= first.getTime() && j.date <= dayKey(now)),
    screenings: data.screenings.filter(s => s.profile === profile && s.time >= first.getTime() && s.time <= now),
    assessments: (data.assessments || []).filter(s => s.profile === profile && s.time >= first.getTime() && s.time <= now),
    who5: data.who5.filter(s => s.profile === profile && s.time >= first.getTime() && s.time <= now),
  };
}
function supportMessages(data, profile, now = Date.now()) {
  const age = PROFILES[profile].age, recent = scoped(data, profile, 14, now);
  const screen = recent.screenings.at(-1), who = recent.who5.at(-1), diary = recent.journals.at(-1);
  const list = [];
  // A later four-item check must not erase a recent ninth-item safety response.
  const assessment = recent.assessments.at(-1), useFull = age !== 'child' && !!assessment;
  if (useFull) list.push(...assessment.result.actions.map(action => ({...action,basis:`最近完整评估 ${dayKey(assessment.time)} · 本人填写 PHQ-9/GAD-7 与生活记录`})));
  if (!useFull && age !== 'child' && screen?.result?.depressionFlag) list.push({ level: 'follow', title: '建议进一步了解抑郁相关症状', text: `最近一次 PHQ-2 为 ${screen.result.phq2}/6，达到常用筛查提示值。可以结合持续时间和生活影响，预约专业评估。这份问卷不能确认是否患有抑郁症。`, basis: '本人填写 · 过去两周 · PHQ-2' });
  if (!useFull && age !== 'child' && screen?.result?.anxietyFlag) list.push({ level: 'follow', title: '建议进一步了解焦虑相关症状', text: `最近一次 GAD-2 为 ${screen.result.gad2}/6，达到常用筛查提示值。可以预约专业评估，说明近两周的情况。`, basis: '本人填写 · 过去两周 · GAD-2' });
  if (age !== 'child' && who?.result?.followUp) list.push({ level: 'follow', title: '近期幸福感偏低，建议进一步评估', text: `手动录入的 WHO-5 为 ${who.result.score}/100，低于常用提示值 50。这不等于抑郁症，建议带上完整问卷与专业人员讨论。`, basis: '本人录入 · 官方问卷 · 过去两周' });
  if (diary?.impact === '明显影响' || diary?.duration === '两周或更久') list.push({ level: 'follow', title: age === 'child' ? '先听孩子表达，再寻求合适支持' : '生活受到影响时，不必等分数变高', text: age === 'child' ? '记录提到困扰持续或生活受影响。请由监护人与儿童青少年专业人员沟通，不能据此判断儿童患病。' : '你记录了持续困扰或明显生活影响。建议联系合适的专业人员；摄像头没有提供疾病判断。', basis: '生活影响与持续时间 · 本人或陪同记录' });
  if (!list.length) list.push({ level: 'gentle', title: diary ? '根据今天的记录安排休息' : '先完成一次心情记录', text: diary ? '如果觉得疲惫，可以减少一点当前任务，安排休息或和熟悉的人聊聊。如果困扰持续或影响生活，可以直接咨询专业人员。' : '记录一下心情、压力和最近的生活变化。日记和症状自查都不需要开启摄像头。', basis: '日常自我管理建议' });
  return list;
}
function makeReport(data, profile, days = 7, now = Date.now()) {
  const r = scoped(data, profile, days, now), stats = sessionStats(r.sessions);
  const selfReports = r.journals.filter(j => j.reporter !== '陪同者观察记录');
  const avg = selfReports.length ? selfReports.reduce((s, j) => s + j.mood, 0) / selfReports.length : null;
  const positive = selfReports.filter(j => j.mood >= 4).length;
  const latest = r.screenings.at(-1);
  return { ...r, stats, avg, positive, latest, days, messages: supportMessages(data, profile, now), summary: selfReports.length ? `这 ${days} 天有 ${selfReports.length} 天完成本人回顾，平均心情 ${avg.toFixed(1)}/5；其中 ${positive} 天自评为较好或很好。${stats.validMs ? `摄像头有效观察 ${(stats.validMs / 60000).toFixed(1)} 分钟，仅代表这些片段。` : '尚无有效摄像头片段，不影响日记使用。'}${r.journals.length > selfReports.length ? '另有陪同者观察记录，未计入本人均值。' : ''}` : `这 ${days} 天还没有本人心情回顾。${r.journals.length ? '陪同者观察未计入本人均值。' : ''}先记下一次真实感受，不从表情自动推断你一整天的心情。` };
}
function csvSafe(value) {
  let s = String(value ?? '');if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
function reportCSV(data, profile) {
  const fields = ['日期', '心情_1到5', '压力_0到10', '精力_0到10', '睡眠小时_自报', '持续时间', '生活影响', '记录者', '一件好事', '备注'];
  const rows = data.journals.filter(j => j.profile === profile).map(j => [j.date, j.mood, j.stress, j.energy, j.sleep, j.duration, j.impact, j.reporter, j.good, j.note]);
  return '\uFEFF' + [fields, ...rows].map(row => row.map(csvSafe).join(',')).join('\r\n');
}
function demoData(now = Date.now()) {
  const data = blankData();
  const moods = [3, 2, 3, 4, 3, 4, 4], stress = [5, 7, 6, 4, 5, 3, 3];
  for (let i = 0; i < 7; i++) {
    const t = new Date(now);t.setHours(10, 0, 0, 0);t.setDate(t.getDate() - 6 + i);const time = Math.min(t.getTime(), now - 26 * 60000);
    const s = freshSession('study', time);s.status = 'finished';s.endedAt = time + 25 * 60000;s.activeMs = 25 * 60000;s.validMs = 20 * 60000;
    s.activeIntervals=[{start:time,end:time+25*60000}];
    s.categories = { neutral: 600000, happy: 180000 + i * 15000, sad: 180000 - i * 15000, angry: 60000, fearful: 60000, disgusted: 60000, surprised: 60000 };
    for(let m=0;m<25;m++)s.bins.push({time:time+m*60000,categories:Object.fromEntries(CATEGORIES.map(k=>[k,s.categories[k]/25]))});
    data.sessions.push(s);
    data.journals.push({ profile: 'self', date: dayKey(time), mood: moods[i], stress: stress[i], energy: 5 + i % 3, sleep: 6.5 + i % 2, note: ['准备考试，任务有些多。', '遇到难题，和同学讨论后有了方向。', '分步骤完成了今天的计划。'][i % 3], good: ['和朋友吃饭', '完成一小节笔记', '下午出去走了走'][i % 3], duration: '不到两周', impact: '有一点影响', reporter: '本人' });
  }
  return data;
}

// PHQ/GAD self-report scoring. Facial-expression values are never inputs.
const PHQ9_OPTIONS = ['完全不会', '几天', '一半以上的天数', '近乎每天'];
const GAD7_OPTIONS = ['无', '7天以内', '一半以上日子', '几乎每天'];
const PHQ9_ITEMS = [
  '做任何事都觉得沉闷或者根本不想做任何事',
  '情绪低落、抑郁或绝望',
  '难于入睡；半夜会醒或相反地睡觉时间过多',
  '觉得疲倦或活力不足',
  '胃口极差或进食过量',
  '不喜欢自己 — 觉得自己做得不好、对自己失望或有负家人期望',
  '难于集中精神做事，例如看报纸或看电视',
  '其他人反映你行动或说话迟缓；或者相反地，你比平常活动更多 — 坐立不安、停不下来',
  '想到自己最好去死或者自残',
];
const GAD7_ITEMS = [
  '感觉紧张，焦虑或急切',
  '不能够停止或控制担忧',
  '对各种各样的事情担忧过多',
  '很难放松下来',
  '由于不安而无法静坐',
  '变得容易烦恼或急躁',
  '感到似乎将有可怕的事情发生而害怕',
];
const ASSESSMENT_SOURCE = 'https://www.phqscreeners.com/images/sites/g/files/g10016261/f/201412/instructions.pdf';
function severityBand(score, cutoffs) { return cutoffs.filter(c => score >= c).length; }
function validateAnswers(values, length) {
  if (!Array.isArray(values) || values.length !== length || values.some(v => !Number.isInteger(v) || v < 0 || v > 3)) throw new Error(`请完成全部 ${length} 题，未回答不能记为 0 分。`);
}
function assessSymptoms(phq, gad, context = {}, age = 'adult') {
  if (age === 'child') return { eligible:false,reason:'儿童请使用适龄评估，本工具不套用成人规则。' };
  validateAnswers(phq,9);validateAnswers(gad,7);
  const phq9 = phq.reduce((a,b) => a+b,0), gad7 = gad.reduce((a,b) => a+b,0);
  const phqBand = severityBand(phq9,[5,10,15,20]), gadBand = severityBand(gad7,[5,10,15]);
  const depression = { score:phq9,max:27,band:phqBand,label:['症状较少','轻度症状','中度症状','中重度症状','重度症状'][phqBand],followUp:phq9>=10 };
  const anxiety = { score:gad7,max:21,band:age==='older'?null:gadBand,label:age==='older'?'仅记录原始分':['症状较少','轻度症状','中度症状','重度症状'][gadBand],followUp:age!=='older'&&gad7>=10,limited:age==='older' };
  const safetyImmediate = context.safety === 'unsafe', selfHarmResponse = phq[8] > 0;
  const impaired = context.impact === '明显影响' || context.impact === '几乎无法完成', prolonged = context.duration === '两周或更久';
  const actions = [];
  if (safetyImmediate) actions.push({level:'urgent',title:'先处理当前安全',text:'如果现在可能伤害自己或他人，或无法保证安全，请立即联系身边可信任的人，寻求当地急诊或紧急援助，不要独自等待网页结果。这个程序不会实时通知任何人。'});
  if (selfHarmResponse) actions.push({level:'priority',title:'尽快和专业人员谈谈第 9 题',text:'你在过去两周报告过死亡或伤害自己的相关想法。请尽快联系专业人员做直接评估，也可以先告诉可信任的人。单凭这一题不能估计当前自伤风险；总分低也不能忽略这条回答。'});
  if (phq9 >= 15 || (!anxiety.limited && gad7 >= 15) || impaired) actions.push({level:'priority',title:'建议尽快预约专业评估',text:'症状分数较高，或日常生活已经明显受影响。可以联系精神心理科、心理治疗专业人员或基层医生，带上这份记录说明近两周的变化。不要自行开始、停用或调整药物。'});
  else if (depression.followUp || anxiety.followUp || prolonged) actions.push({level:'follow',title:'建议安排一次专业咨询或评估',text:'分数达到常用进一步评估的范围，或困扰已经持续两周。评估还需要了解身体状况、用药和生活事件，问卷不能单独确认是否患病。'});
  else if (phq9 >= 5 || (!anxiety.limited && gad7 >= 5)) actions.push({level:'gentle',title:'先做几件能坚持的小调整',text:'近两周有一些症状。可以规律安排睡眠和用餐，适量活动，缩小当前任务，找信任的人聊聊。如果继续加重、持续不缓解或影响生活，请预约评估，不必等下次自查。'});
  else if(anxiety.limited) actions.push({level:'gentle',title:'已记录本次回答',text:'长者的焦虑分数在本项目中不自动分级。请结合本人感受和日常变化决定是否咨询专业人员，有困扰时不必等待系统提示。'});
  else actions.push({level:'gentle',title:'本次报告的症状较少',text:'保留日常活动和休息习惯，继续记录实际感受。低分不能排除心理健康问题；如果你仍觉得不对劲，可以直接咨询专业人员。'});
  const irritability = context.irritability || '未填写';
  if (context.control === '担心失控') actions.push({level:'priority',title:'易怒已经让你担心失控',text:'先离开容易发生冲突的场面，暂停争论，找可以陪同的人，并尽快寻求专业评估。如果可能立即伤害自己或他人，按当前安全提示处理。这里不会把易怒判断为间歇性爆发障碍。'});
  else if (irritability === '经常' || irritability === '几乎每天') actions.push({level:'follow',title:'留意易怒发生时的具体情况',text:'记下是否伴随睡眠不足、疼痛、争执或工作负担。可以先暂停任务和冲突，安排短暂休息。持续出现、影响关系或担心控制不住时，请寻求专业帮助。此项为生活记录，没有疾病分数。'});
  if (context.unusualEnergy === '有') actions.push({level:'follow',title:'明显少睡却不困，且异常兴奋时需要单独评估',text:'如果这与平时明显不同，并伴随话多、活动增加或冲动，请尽快向专业人员说明。不能把它简单解释为好心情，也不能靠本问卷确认双相障碍。'});
  if (context.physical) actions.push({level:'context',title:'身体和用药变化也要一起说明',text:'你提到了身体不适、疾病或用药变化。这些情况可能影响睡眠、精力和情绪，建议和医生一起排查。不要只根据心理量表归因。'});
  if (anxiety.limited) actions.push({level:'context',title:'长者焦虑结果需要专业解释',text:'这里只记录 GAD-7 原始分，不套用普通成人的自动分级。若本人有困扰或生活变化，可直接咨询，不能因为没有自动提示就排除问题。'});
  return { eligible:true,instrument:'PHQ-9/GAD-7',windowDays:14,depression,anxiety,phq2:phq[0]+phq[1],gad2:gad[0]+gad[1],depressionFlag:depression.followUp,anxietyFlag:anxiety.followUp,selfHarmResponse,safetyImmediate,irritability,actions,context:{...context},diagnosis:null };
}
function assessmentSummary(result) {
  if (!result?.eligible) return '暂不适用成人评估。';
  return `PHQ-9 ${result.depression.score}/27（${result.depression.label}）；GAD-7 ${result.anxiety.score}/21（${result.anxiety.label}）。这是过去两周的本人回答，不是疾病诊断。`;
}

// Descriptive monitoring reports. No facial statistic is a clinical score.
const autoKeys = ['neutral','happy','sad','angry','fearful','disgusted','surprised'];
const autoNames = {neutral:'中性',happy:'高兴',sad:'悲伤',angry:'愤怒',fearful:'恐惧',disgusted:'厌恶',surprised:'惊讶'};
const emptyCategories = () => Object.fromEntries(autoKeys.map(k => [k,0]));
const finiteDuration = value => Number.isFinite(value) && value > 0 ? value : 0;
function autoDateKey(value) {const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function automaticReport(data, profile, days=7, now=Date.now()) {
  const first=new Date(now);first.setHours(0,0,0,0);first.setDate(first.getDate()-days+1);
  const start=first.getTime(), categories=emptyCategories(), daily=[];
  for(let i=0;i<days;i++){const d=new Date(first);d.setDate(d.getDate()+i);daily.push({date:autoDateKey(d),categories:emptyCategories(),validMs:0});}
  const dailyMap=new Map(daily.map(d=>[d.date,d]));
  let activeMs=0, denominatorKnown=true, legacyExcluded=0, undatedMs=0;
  const sessions=[], bins=[], interruptions={};
  for(const s of data.sessions || []) {
    if(s.profile!==profile || !Number.isFinite(s.startedAt) || s.startedAt>now)continue;
    const end=s.endedAt ?? (s.status==='active'?now:(s.lastSavedAt ?? s.startedAt));
    if(end<start)continue;
    let sessionValid=0, sessionActive=0;
    const sessionCategories=emptyCategories();
    if(s.bins?.length) {
      for(const b of s.bins) {
        if(!Number.isFinite(b.time) || b.time<start || b.time>now)continue;
        const values=emptyCategories();let total=0;
        for(const k of autoKeys){const v=finiteDuration(b.categories?.[k]);values[k]=v;categories[k]+=v;sessionCategories[k]+=v;total+=v;}
        if(total){bins.push({time:b.time,categories:values,sessionId:s.id});const day=dailyMap.get(autoDateKey(b.time));if(day){for(const k of autoKeys)day.categories[k]+=values[k];day.validMs+=total;}sessionValid+=total;}
      }
    } else if(s.startedAt>=start && end<=now) {
      // Legacy aggregates without time bins cannot support an intraday timeline.
      for(const k of autoKeys){const v=finiteDuration(s.categories?.[k]);categories[k]+=v;sessionCategories[k]+=v;sessionValid+=v;}
      undatedMs+=sessionValid;
    } else if(finiteDuration(s.validMs)) legacyExcluded++;
    if(Array.isArray(s.activeIntervals)) {
      for(const interval of s.activeIntervals) {
        if(!Number.isFinite(interval.start)||!Number.isFinite(interval.end))continue;
        sessionActive+=Math.max(0,Math.min(now,interval.end)-Math.max(start,interval.start));
      }
    } else if(s.startedAt>=start && end<=now)sessionActive=finiteDuration(s.activeMs);
    else denominatorKnown=false;
    if(sessionValid || sessionActive || s.startedAt>=start){sessions.push({...s,periodValidMs:sessionValid,periodActiveMs:sessionActive,periodCategories:sessionCategories});activeMs+=sessionActive;if(s.startedAt>=start&&end<=now)for(const [key,value] of Object.entries(s.interruptions||{}))interruptions[key]=(interruptions[key]||0)+finiteDuration(value);}
  }
  bins.sort((a,b)=>a.time-b.time);sessions.sort((a,b)=>b.startedAt-a.startedAt);
  const validMs=Object.values(categories).reduce((a,b)=>a+b,0);
  const coverage=denominatorKnown && activeMs>0 && validMs<=activeMs+5 ? Math.min(1,validMs/activeMs) : null;
  const ranked=autoKeys.map(key=>({key,name:autoNames[key],ms:categories[key],share:validMs?categories[key]/validMs:null})).sort((a,b)=>b.ms-a.ms);
  const observedDays=daily.filter(d=>d.validMs>0).length;
  const latestDay=bins.length?autoDateKey(bins.at(-1).time):null;
  const latestBins=bins.filter(b=>autoDateKey(b.time)===latestDay);
  const notes=[];
  if(!sessions.length)notes.push({title:'等待首个监测会话',text:'选择场景并开启摄像头后，系统会自动保存有效观察时长、表情分布和分钟记录，无需填写日记。',basis:'当前空间尚无监测会话'});
  else if(!validMs)notes.push({title:'尚未取得有效片段',text:'已有开启记录，但没有可纳入统计的连续有效采样。请检查人脸是否正对镜头、光线是否充足，以及画面中是否只有一人。',basis:'有效观察为 0 分钟'});
  else {
    notes.push({title:'已生成时段统计',text:`有效片段中，${ranked[0].name}类别占 ${(ranked[0].share*100).toFixed(1)}%。这是模型表情分类的时间占比，只描述已经观察到的片段。`,basis:`分母为 ${(validMs/60000).toFixed(1)} 分钟有效观察`});
    if(coverage!==null && coverage<.6)notes.push({title:'优先改善采集条件',text:'当前有效片段不足已开启时长的六成。可调整光线、摄像头角度和距离。中断与不确定结果已排除。六成是产品质量提示设置，不是医学界值。',basis:`有效覆盖率 ${(coverage*100).toFixed(1)}%`});
    else notes.push({title:'按相近条件比较记录',text:'比较不同日期时，尽量保持场景、镜头位置和时段接近。观察时长不同或大量缺测时，不宜直接把占比变化解释为状态改善或恶化。',basis:'场景与采集条件会影响表情分类'});
  }
  if(profile!=='self')notes.push({title:profile==='child'?'儿童记录需持续确认意愿':'长者记录需本人知情同意',text:profile==='child'?'仅用于自愿陪同观察，不评价学习能力，不套用成人疾病阈值。孩子不愿意时应停止。':'身体不适、用药和面部活动变化可能影响结果。记录不用于判断认知症或替代本人表达。',basis:'本项目尚无分年龄外部验证'});
  const summary=validMs?`近 ${days} 天共 ${sessions.length} 次监测，累计有效观察 ${(validMs/60000).toFixed(1)} 分钟。${observedDays?`有分钟记录的日期为 ${observedDays} 天。`:''}${coverage===null?'本期覆盖率无法可靠计算。':`有效覆盖率 ${(coverage*100).toFixed(1)}%。`}`:`近 ${days} 天${sessions.length?`有 ${sessions.length} 次开启记录，但尚无有效观察片段。`:'尚无监测记录。'}开启监测后会自动生成报告，无需手动填写。`;
  return {days,start,now,sessions,bins,latestBins,latestDay,daily,observedDays,ranked,notes,summary,interruptions,undatedMs,legacyExcluded,stats:{categories,activeMs,validMs,coverage},denominatorKnown};
}
function automaticCSV(report) {
  const safe=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const rows=[['开始时间','场景','状态','本期已开启分钟','本期有效分钟',...autoKeys.map(k=>autoNames[k]+'分钟')]];
  for(const s of report.sessions)rows.push([new Date(s.startedAt).toISOString(),s.scene,s.status,(s.periodActiveMs/60000).toFixed(3),(s.periodValidMs/60000).toFixed(3),...autoKeys.map(k=>(s.periodCategories[k]/60000).toFixed(3))]);
  return '\uFEFF'+rows.map(row=>row.map(safe).join(',')).join('\r\n');
}

// Within-person descriptive comparisons. Availability settings are engineering
// choices, not clinical thresholds. No diagnosis, symptom score or risk is inferred.
const observedKeys=['neutral','happy','sad','angry','fearful','disgusted','surprised'];
const observedNames={neutral:'中性',happy:'高兴',sad:'悲伤',angry:'愤怒',fearful:'恐惧',disgusted:'厌恶',surprised:'惊讶'};
const observedDate=t=>{const d=new Date(t);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const observedSum=c=>observedKeys.reduce((n,k)=>n+Math.max(0,Number(c?.[k])||0),0);
function personalComparison(report,{minDayMs=300000,minBaselineDays=3,maxBaselineDays=7}={}){
 const scene=report.sessions.find(s=>report.bins.some(b=>b.sessionId===s.id))?.scene||null;
 const ids=new Set(report.sessions.filter(s=>s.scene===scene).map(s=>s.id)),days=new Map();
 for(const b of report.bins){if(!ids.has(b.sessionId))continue;const date=observedDate(b.time);if(!days.has(date))days.set(date,{date,categories:Object.fromEntries(observedKeys.map(k=>[k,0])),validMs:0});const d=days.get(date);for(const k of observedKeys)d.categories[k]+=Math.max(0,Number(b.categories?.[k])||0);d.validMs+=observedSum(b.categories);}
 const list=[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)),latest=list.at(-1),baseline=list.slice(0,-1).filter(d=>d.validMs>=minDayMs).slice(-maxBaselineDays);
 const available=!!latest&&latest.validMs>=minDayMs&&baseline.length>=minBaselineDays;
 const rows=observedKeys.map(key=>{
  const values=baseline.map(d=>d.categories[key]/d.validMs),mean=values.length?values.reduce((a,b)=>a+b,0)/values.length:null,share=latest?.validMs?latest.categories[key]/latest.validMs:null;
  return {key,name:observedNames[key],latestShare:share,referenceMean:available?mean:null,delta:available?share-mean:null,referenceMin:available?Math.min(...values):null,referenceMax:available?Math.max(...values):null};
 });
 return {available,scene,latest:latest||null,baselineDays:baseline.length,minDayMs,minBaselineDays,rows,diagnosis:null,interpretation:available?'同一空间、同一场景的描述性比较。参考值为各日占比的等权均值，不是人群常模或医学正常范围。':'同一场景至少需要三个历史观察日和一个最近观察日，每日有效观察不少于五分钟。该设置仅用于保证基本可比性，不是医学界值。'};
}
function sessionComparison(report){
 const session=report.sessions.find(s=>s.periodValidMs>=600000&&report.bins.some(b=>b.sessionId===s.id));
 if(!session)return null;
 const bins=report.bins.filter(b=>b.sessionId===session.id).sort((a,b)=>a.time-b.time),mid=(bins[0].time+bins.at(-1).time+60000)/2;
 const halves=[{validMs:0,categories:Object.fromEntries(observedKeys.map(k=>[k,0]))},{validMs:0,categories:Object.fromEntries(observedKeys.map(k=>[k,0]))}];
 for(const b of bins){const half=halves[b.time<mid?0:1];for(const k of observedKeys)half.categories[k]+=Math.max(0,Number(b.categories?.[k])||0);half.validMs+=observedSum(b.categories);}
 if(halves.some(h=>h.validMs<120000))return null;
 return {sessionId:session.id,scene:session.scene,startedAt:session.startedAt,halves,rows:observedKeys.map(key=>({key,name:observedNames[key],before:halves[0].categories[key]/halves[0].validMs,after:halves[1].categories[key]/halves[1].validMs})),interpretation:'按分钟记录的时间顺序分前后半段，各用本段有效时长作分母。只描述类别占比变化，不认定情绪改善、恶化或活动效果。'};
}
function performanceSummary(sessions){
 const values=sessions.flatMap(s=>s.performance?.recentMs||[]).filter(n=>Number.isFinite(n)&&n>=0).sort((a,b)=>a-b);
 if(!values.length)return null;
 return {sampleCount:values.length,median:values[Math.floor((values.length-1)*.5)],p90:values[Math.ceil((values.length-1)*.9)],scope:'每次会话最近至多240次推理耗时样本，不是识别准确率或摄像头总延迟'};
}

// The supplied core.mjs is preserved byte for byte. These functions lift the
// supplied app's detector and voting decisions into the new application shell.
async function detectProvidedFrame(api,pixels,stillCurrent=()=>true){
  let faces=await api.detectAllFaces(pixels,new api.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:.35})).withFaceLandmarks(true).withFaceExpressions();
  const firstValidity=faces.length===1?inspectFace(faces[0],pixels.width,pixels.height):null;
  if(stillCurrent()&&(!faces.length||(faces.length===1&&firstValidity!=='valid'))){
    const alternate=await api.detectAllFaces(pixels,new api.TinyFaceDetectorOptions({inputSize:416,scoreThreshold:.35})).withFaceLandmarks(true).withFaceExpressions();
    if(!faces.length||alternate.length>faces.length||(alternate.length===1&&faces.length===1&&alternate[0].detection.score>faces[0].detection.score))faces=alternate;
  }
  return faces;
}
function decideExpression(scores,vote=null,threshold=.60){
  const current=classify(scores,threshold);let decision=current;
  if(vote&&vote.samples>=3&&vote.ratio>=.6){const voted=classify(vote.average,threshold);if(voted.accepted&&voted.key===vote.key)decision={...voted,vote};}
  return decision;
}
function providedFrameSize(width,height){const scale=Math.min(1,640/Math.max(width,height));return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};}

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

})();
