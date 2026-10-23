import test from 'node:test';
import assert from 'node:assert/strict';
import { freshSession, creditSample, sessionStats, scoreScreen, scoreWho5, blankData, makeReport, supportMessages, dayKey, reportCSV, demoData } from '../public/wellbeing.mjs';
test('clinical screening depends only on the four self-reported answers', () => {
  assert.deepEqual(scoreScreen([1,2,0,0]),{ eligible:true,phq2:3,gad2:0,depressionFlag:true,anxietyFlag:false,anxietyLimited:false,windowDays:14 });
  assert.equal(scoreScreen([0,0,2,1]).anxietyFlag,true);
  assert.throws(() => scoreScreen([0,0,null,0]));assert.throws(() => scoreScreen([0,0,4,0]));
  assert.equal(scoreScreen([3,3,3,3],'child').eligible,false);
  assert.equal(scoreScreen([0,0,3,3],'older').anxietyFlag,false);
  assert.equal(scoreScreen([0,0,3,3],'older').anxietyLimited,true);
});
test('WHO-5 preserves official score mapping, strict cutoff and incomplete input rejection', () => {
  assert.equal(scoreWho5(12).score,48);assert.equal(scoreWho5(12).followUp,true);assert.equal(scoreWho5(13).followUp,false);
  assert.equal(scoreWho5(25).score,100);assert.throws(() => scoreWho5(26));assert.throws(() => scoreWho5(2.5));assert.equal(scoreWho5(10,'child').eligible,false);
});
test('time weighting excludes long gaps, uncertain samples and different profiles', () => {
  const s = freshSession('study',0);
  const at = (time,key='happy',profile='self') => ({ time,key,profile });
  creditSample(s,at(0),at(1000));assert.equal(s.validMs,1000);assert.equal(s.categories.happy,1000);
  creditSample(s,at(1000),at(11000));creditSample(s,at(11000),at(12000,null));creditSample(s,at(12000,null),at(13000));creditSample(s,at(13000),at(14000,'happy','child'));
  assert.equal(s.validMs,1000);assert.equal(s.samples,5);
});
test('minute bins split actual time across boundaries without inventing samples', () => {
  const s = freshSession('study',59000);creditSample(s,{time:59500,key:'sad',profile:'self'},{time:60500,key:'happy',profile:'self'});
  assert.equal(s.validMs,1000);assert.equal(s.categories.sad,1000);assert.equal(s.bins.length,2);assert.equal(s.bins[0].categories.sad,500);assert.equal(s.bins[1].categories.sad,500);
});
test('observer records are excluded from self-report averages and positive day counts', () => {
  const now = Date.now(),d = blankData();d.journals.push({profile:'self',date:dayKey(now),mood:1,reporter:'陪同者观察记录'});
  let r = makeReport(d,'self',7,now);assert.equal(r.avg,null);assert.equal(r.positive,0);assert.match(r.summary,/陪同者/);
  d.journals[0].reporter = '本人表达，陪同者代记';r = makeReport(d,'self',7,now);assert.equal(r.avg,1);
});
test('negative camera categories never generate a disease flag or support escalation', () => {
  const d = blankData(),s = freshSession('study');s.activeMs = s.validMs = 3600000;s.categories.sad = 3600000;d.sessions.push(s);
  const messages = supportMessages(d,'self');assert.equal(messages.length,1);assert.equal(messages[0].level,'gentle');
  const r = makeReport(d,'self');assert.equal(r.latest,undefined);assert.equal(r.avg,null);assert.equal(sessionStats([s]).challenging,1);
});
test('stale screening and other profile data cannot trigger current prompts', () => {
  const now = Date.now(),d = blankData();d.screenings.push({profile:'self',time:now-15*86400000,result:scoreScreen([3,3,3,3])},{profile:'elder',time:now,result:scoreScreen([3,3,3,3],'older')});
  assert.equal(supportMessages(d,'self',now)[0].level,'gentle');assert.equal(makeReport(d,'self',7,now).screenings.length,0);
});
test('CSV keeps text inert, demo records are separate and time weighted totals reconcile', () => {
  const d = demoData();d.journals[0].note = '=HYPERLINK("https://x")';const csv = reportCSV(d,'self');assert.ok(csv.includes("'=HYPERLINK"));assert.equal(blankData().journals.length,0);
  for (const s of d.sessions) assert.equal(Object.values(s.categories).reduce((a,b)=>a+b,0),s.validMs);
  assert.equal(makeReport(d,'child').journals.length,0);
});
