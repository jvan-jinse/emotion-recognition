// Within-person descriptive comparisons. Availability settings are engineering
// choices, not clinical thresholds. No diagnosis, symptom score or risk is inferred.
const observedKeys=['neutral','happy','sad','angry','fearful','disgusted','surprised'];
const observedNames={neutral:'中性',happy:'高兴',sad:'悲伤',angry:'愤怒',fearful:'恐惧',disgusted:'厌恶',surprised:'惊讶'};
const observedDate=t=>{const d=new Date(t);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const observedSum=c=>observedKeys.reduce((n,k)=>n+Math.max(0,Number(c?.[k])||0),0);
export function personalComparison(report,{minDayMs=300000,minBaselineDays=3,maxBaselineDays=7}={}){
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
export function sessionComparison(report){
 const session=report.sessions.find(s=>s.periodValidMs>=600000&&report.bins.some(b=>b.sessionId===s.id));
 if(!session)return null;
 const bins=report.bins.filter(b=>b.sessionId===session.id).sort((a,b)=>a.time-b.time),mid=(bins[0].time+bins.at(-1).time+60000)/2;
 const halves=[{validMs:0,categories:Object.fromEntries(observedKeys.map(k=>[k,0]))},{validMs:0,categories:Object.fromEntries(observedKeys.map(k=>[k,0]))}];
 for(const b of bins){const half=halves[b.time<mid?0:1];for(const k of observedKeys)half.categories[k]+=Math.max(0,Number(b.categories?.[k])||0);half.validMs+=observedSum(b.categories);}
 if(halves.some(h=>h.validMs<120000))return null;
 return {sessionId:session.id,scene:session.scene,startedAt:session.startedAt,halves,rows:observedKeys.map(key=>({key,name:observedNames[key],before:halves[0].categories[key]/halves[0].validMs,after:halves[1].categories[key]/halves[1].validMs})),interpretation:'按分钟记录的时间顺序分前后半段，各用本段有效时长作分母。只描述类别占比变化，不认定情绪改善、恶化或活动效果。'};
}
export function performanceSummary(sessions){
 const values=sessions.flatMap(s=>s.performance?.recentMs||[]).filter(n=>Number.isFinite(n)&&n>=0).sort((a,b)=>a-b);
 if(!values.length)return null;
 return {sampleCount:values.length,median:values[Math.floor((values.length-1)*.5)],p90:values[Math.ceil((values.length-1)*.9)],scope:'每次会话最近至多240次推理耗时样本，不是识别准确率或摄像头总延迟'};
}
