import test from 'node:test';import assert from 'node:assert/strict';
import {assessSymptoms,severityBand,assessmentSummary} from '../public/assessment.mjs';
import {blankData,supportMessages,dayKey} from '../public/wellbeing.mjs';
const zero=()=>Array(9).fill(0),gzero=()=>Array(7).fill(0);
test('all published PHQ and GAD severity boundaries are exact',()=>{
 for(const [v,expected] of [[0,0],[4,0],[5,1],[9,1],[10,2],[14,2],[15,3],[19,3],[20,4],[27,4]])assert.equal(severityBand(v,[5,10,15,20]),expected);
 for(const [v,expected] of [[0,0],[4,0],[5,1],[9,1],[10,2],[14,2],[15,3],[21,3]])assert.equal(severityBand(v,[5,10,15]),expected);
});
test('missing and invalid answers never become zero, child assessment is blocked',()=>{
 assert.throws(()=>assessSymptoms([null,...Array(8).fill(0)],gzero()));assert.throws(()=>assessSymptoms(Array(9).fill(4),gzero()));assert.throws(()=>assessSymptoms(zero(),Array(6).fill(0)));
 assert.equal(assessSymptoms([],[],{},'child').eligible,false);
});
test('a positive ninth answer is visible even with a total of one, without a suicide-risk grade',()=>{
 const p=zero();p[8]=1;const r=assessSymptoms(p,gzero());assert.equal(r.depression.score,1);assert.equal(r.selfHarmResponse,true);assert.equal(r.diagnosis,null);assert.ok(r.actions.some(a=>a.title.includes('第 9 题')));assert.ok(!r.actions.some(a=>a.level==='urgent'));
});
test('current inability to stay safe has priority even if all scored symptoms are zero',()=>{
 const r=assessSymptoms(zero(),gzero(),{safety:'unsafe'});assert.equal(r.actions[0].level,'urgent');assert.equal(r.depression.score,0);assert.equal(r.safetyImmediate,true);
});
test('life impact, irritability and unusual energy do not add to questionnaire scores',()=>{
 const r=assessSymptoms(zero(),gzero(),{impact:'明显影响',irritability:'几乎每天',control:'担心失控',unusualEnergy:'有',physical:true});assert.equal(r.depression.score,0);assert.equal(r.anxiety.score,0);assert.ok(r.actions.length>=4);assert.equal(r.diagnosis,null);
});
test('elder anxiety interpretation remains limited for this unvalidated product',()=>{const r=assessSymptoms(zero(),Array(7).fill(3),{},'older');assert.equal(r.anxiety.score,21);assert.equal(r.anxiety.band,null);assert.equal(r.anxiety.followUp,false);assert.ok(!r.actions.some(a=>a.title==='本次报告的症状较少'))});
test('recent full assessment recommendations enter reports; stale or other-person results do not',()=>{
 const d=blankData(),now=Date.now(),result=assessSymptoms(Array(9).fill(2),Array(7).fill(2),{duration:'两周或更久',impact:'有一点影响'});
 d.assessments.push({profile:'self',time:now,result});assert.ok(supportMessages(d,'self',now).some(m=>m.level==='priority'));assert.equal(supportMessages(d,'child',now)[0].level,'gentle');
 d.screenings.push({profile:'self',time:now+1,result:{phq2:0,gad2:0,depressionFlag:false,anxietyFlag:false}});assert.ok(supportMessages(d,'self',now+1).some(m=>m.level==='priority'));
 d.assessments[0].time-=15*86400000;assert.equal(supportMessages(d,'self',now)[0].level,'gentle');assert.match(assessmentSummary(result),/PHQ-9 18/);
});
