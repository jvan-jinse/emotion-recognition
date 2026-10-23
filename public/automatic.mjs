// Descriptive monitoring reports. No facial statistic is a clinical score.
const autoKeys = ['neutral','happy','sad','angry','fearful','disgusted','surprised'];
const autoNames = {neutral:'中性',happy:'高兴',sad:'悲伤',angry:'愤怒',fearful:'恐惧',disgusted:'厌恶',surprised:'惊讶'};
const emptyCategories = () => Object.fromEntries(autoKeys.map(k => [k,0]));
const finiteDuration = value => Number.isFinite(value) && value > 0 ? value : 0;
function autoDateKey(value) {const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function automaticReport(data, profile, days=7, now=Date.now()) {
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
export function automaticCSV(report) {
  const safe=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const rows=[['开始时间','场景','状态','本期已开启分钟','本期有效分钟',...autoKeys.map(k=>autoNames[k]+'分钟')]];
  for(const s of report.sessions)rows.push([new Date(s.startedAt).toISOString(),s.scene,s.status,(s.periodActiveMs/60000).toFixed(3),(s.periodValidMs/60000).toFixed(3),...autoKeys.map(k=>(s.periodCategories[k]/60000).toFixed(3))]);
  return '\uFEFF'+rows.map(row=>row.map(safe).join(',')).join('\r\n');
}
