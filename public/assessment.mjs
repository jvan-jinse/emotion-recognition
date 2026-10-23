// PHQ/GAD self-report scoring. Facial-expression values are never inputs.
export const PHQ9_OPTIONS = ['完全不会', '几天', '一半以上的天数', '近乎每天'];
export const GAD7_OPTIONS = ['无', '7天以内', '一半以上日子', '几乎每天'];
export const PHQ9_ITEMS = [
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
export const GAD7_ITEMS = [
  '感觉紧张，焦虑或急切',
  '不能够停止或控制担忧',
  '对各种各样的事情担忧过多',
  '很难放松下来',
  '由于不安而无法静坐',
  '变得容易烦恼或急躁',
  '感到似乎将有可怕的事情发生而害怕',
];
export const ASSESSMENT_SOURCE = 'https://www.phqscreeners.com/images/sites/g/files/g10016261/f/201412/instructions.pdf';
export function severityBand(score, cutoffs) { return cutoffs.filter(c => score >= c).length; }
function validateAnswers(values, length) {
  if (!Array.isArray(values) || values.length !== length || values.some(v => !Number.isInteger(v) || v < 0 || v > 3)) throw new Error(`请完成全部 ${length} 题，未回答不能记为 0 分。`);
}
export function assessSymptoms(phq, gad, context = {}, age = 'adult') {
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
export function assessmentSummary(result) {
  if (!result?.eligible) return '暂不适用成人评估。';
  return `PHQ-9 ${result.depression.score}/27（${result.depression.label}）；GAD-7 ${result.anxiety.score}/21（${result.anxiety.label}）。这是过去两周的本人回答，不是疾病诊断。`;
}
