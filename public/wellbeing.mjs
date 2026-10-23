// Product rules are kept separate from the facial-expression model.
// No camera statistic enters a clinical screening calculation.
export const DATA_KEY = 'xinqing-companion-v1';
export const PROFILES = {
  self: { name: '我的空间', age: 'adult' },
  elder: { name: '长者空间', age: 'older' },
  child: { name: '儿童空间', age: 'child' },
};
export const SCENES = {
  study: { name: '学习记录', profile: 'self', minutes: 25, subtitle: '自动观察学习时段的表情变化，形成会话与阶段报告。', task: '完成一段学习', question: '这次学习遇到了什么问题？你的感受如何？' },
  work: { name: '工作记录', profile: 'self', minutes: 45, subtitle: '自愿开启工作时段监测，自动整理有效观察与分类分布。', task: '完成一项工作', question: '这次工作有哪些压力，休息后有什么变化？' },
  elder: { name: '长者记录', profile: 'elder', minutes: 10, subtitle: '本人知情同意后进行短时观察，不代替本人表达。', task: '记录日常情况', question: '今天的精神、睡眠和身体情况如何？' },
  child: { name: '儿童记录', profile: 'child', minutes: 10, subtitle: '监护人陪同且孩子愿意参与，不做能力评分或疾病判定。', task: '记录当天情况', question: '今天发生了什么？有没有希望家长帮助的事情？' },
};
export const SCREEN_ITEMS = [
  { key: 'interest', group: 'phq2', text: '做任何事都觉得沉闷或者根本不想做任何事', options: ['从来没有', '有几天', '刚超过一半天数', '接近每天'] },
  { key: 'low', group: 'phq2', text: '情绪低落、抑郁或绝望', options: ['从来没有', '有几天', '刚超过一半天数', '接近每天'] },
  { key: 'nervous', group: 'gad2', text: '感觉紧张、焦虑或不安', options: ['根本没有', '有几天', '超过一半天数', '几乎每天'] },
  { key: 'worry', group: 'gad2', text: '无法停止或控制担忧' },
];
export const SCREEN_OPTIONS = ['完全没有', '有几天', '一半以上的日子', '几乎每天'];
export const EVIDENCE = [
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
export const CATEGORIES = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised'];
export function dayKey(value = new Date()) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function blankData() { return { version: 1, sessions: [], journals: [], screenings: [], assessments: [], who5: [], actions: [] }; }
export function freshSession(scene, now = Date.now()) {
  if (!SCENES[scene]) throw new Error('Unknown scene');
  return { id: `s-${now}-${Math.random().toString(36).slice(2, 9)}`, profile: SCENES[scene].profile, scene, startedAt: now, endedAt: null, activeMs: 0, activeIntervals: [], validMs: 0, categories: Object.fromEntries(CATEGORIES.map(k => [k, 0])), bins: [], pauses: 0, samples: 0, interruptions: {}, task: '', status: 'active' };
}
// Only adjacent accepted samples <=2.5s apart contribute time. Long gaps,
// uncertain/multi-person frames and paused intervals are never interpolated.
export function creditSample(session, previous, current) {
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
export function sessionStats(sessions) {
  const categories = Object.fromEntries(CATEGORIES.map(k => [k, 0]));
  let activeMs = 0, validMs = 0;
  for (const s of sessions) { activeMs += s.activeMs || 0;validMs += s.validMs || 0;for (const k of CATEGORIES) categories[k] += s.categories?.[k] || 0; }
  return { activeMs, validMs, coverage: activeMs ? Math.min(1, validMs / activeMs) : null, categories, happy: validMs ? categories.happy / validMs : null, challenging: validMs ? (categories.sad + categories.angry + categories.fearful + categories.disgusted) / validMs : null };
}
export function scoreScreen(answers, age = 'adult') {
  if (age === 'child') return { eligible: false, reason: '儿童空间不使用成人筛查阈值' };
  if (!Array.isArray(answers) || answers.length !== 4 || answers.some(v => !Number.isInteger(v) || v < 0 || v > 3)) throw new Error('请完成全部四题');
  const phq2 = answers[0] + answers[1], gad2 = answers[2] + answers[3];
  return { eligible: true, phq2, gad2, depressionFlag: phq2 >= 3, anxietyFlag: age !== 'older' && gad2 >= 3, anxietyLimited: age === 'older', windowDays: 14 };
}
export function scoreWho5(raw, age = 'adult') {
  if (age === 'child') return { eligible: false };
  if (!Number.isInteger(raw) || raw < 0 || raw > 25) throw new Error('原始总分必须为 0–25 的整数');
  return { eligible: true, raw, score: raw * 4, followUp: raw * 4 < 50 };
}
export function scoped(data, profile, days = 7, now = Date.now()) {
  const first = new Date(now);first.setHours(0, 0, 0, 0);first.setDate(first.getDate() - days + 1);
  return {
    sessions: data.sessions.filter(s => s.profile === profile && s.startedAt >= first.getTime() && s.startedAt <= now),
    journals: data.journals.filter(j => j.profile === profile && new Date(j.date + 'T00:00:00').getTime() >= first.getTime() && j.date <= dayKey(now)),
    screenings: data.screenings.filter(s => s.profile === profile && s.time >= first.getTime() && s.time <= now),
    assessments: (data.assessments || []).filter(s => s.profile === profile && s.time >= first.getTime() && s.time <= now),
    who5: data.who5.filter(s => s.profile === profile && s.time >= first.getTime() && s.time <= now),
  };
}
export function supportMessages(data, profile, now = Date.now()) {
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
export function makeReport(data, profile, days = 7, now = Date.now()) {
  const r = scoped(data, profile, days, now), stats = sessionStats(r.sessions);
  const selfReports = r.journals.filter(j => j.reporter !== '陪同者观察记录');
  const avg = selfReports.length ? selfReports.reduce((s, j) => s + j.mood, 0) / selfReports.length : null;
  const positive = selfReports.filter(j => j.mood >= 4).length;
  const latest = r.screenings.at(-1);
  return { ...r, stats, avg, positive, latest, days, messages: supportMessages(data, profile, now), summary: selfReports.length ? `这 ${days} 天有 ${selfReports.length} 天完成本人回顾，平均心情 ${avg.toFixed(1)}/5；其中 ${positive} 天自评为较好或很好。${stats.validMs ? `摄像头有效观察 ${(stats.validMs / 60000).toFixed(1)} 分钟，仅代表这些片段。` : '尚无有效摄像头片段，不影响日记使用。'}${r.journals.length > selfReports.length ? '另有陪同者观察记录，未计入本人均值。' : ''}` : `这 ${days} 天还没有本人心情回顾。${r.journals.length ? '陪同者观察未计入本人均值。' : ''}先记下一次真实感受，不从表情自动推断你一整天的心情。` };
}
export function csvSafe(value) {
  let s = String(value ?? '');if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function reportCSV(data, profile) {
  const fields = ['日期', '心情_1到5', '压力_0到10', '精力_0到10', '睡眠小时_自报', '持续时间', '生活影响', '记录者', '一件好事', '备注'];
  const rows = data.journals.filter(j => j.profile === profile).map(j => [j.date, j.mood, j.stress, j.energy, j.sleep, j.duration, j.impact, j.reporter, j.good, j.note]);
  return '\uFEFF' + [fields, ...rows].map(row => row.map(csvSafe).join(',')).join('\r\n');
}
export function demoData(now = Date.now()) {
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
