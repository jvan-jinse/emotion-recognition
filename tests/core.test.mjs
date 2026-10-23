import test from 'node:test';
import assert from 'node:assert/strict';
import { LABELS, normalize, classify, inspectFace, choosePrimaryFace, smooth, overlap, toCSV } from '../public/core.mjs';

const scores = (a, b) => Object.fromEntries(LABELS.map((x, i) => [x.key, i === 0 ? a : i === 1 ? b : 0]));

test('invalid model scores cannot silently become a neutral prediction', () => {
  for (const x of [null, {}, scores(NaN, 1), scores(-.1, 1), scores(0, 0), scores(Infinity, 1)]) assert.equal(normalize(x), null);
  assert.equal(classify(null).accepted, false);
});

test('both confidence and class separation must pass', () => {
  assert.equal(classify(normalize(scores(.55, .45))).accepted, false);
  assert.equal(classify(normalize(scores(.60, .55)), .50).accepted, false);
  assert.equal(classify(normalize(scores(.8, .2))).accepted, true);
  assert.equal(classify(normalize(scores(.8, .2)), .85).accepted, false);
});

test('each face is checked and multiple faces have one primary', () => {
  const face = { detection: { box: { x: 100, y: 100, width: 200, height: 250 }, score: .95 }, expressions: scores(.8, .2) };
  assert.equal(inspectFace(null, 640, 480), 'no_face');
  assert.equal(choosePrimaryFace([face, face], 640, 480).index, 0);
  assert.equal(inspectFace(face, 640, 480), 'valid');
  assert.equal(inspectFace({ ...face, detection: { ...face.detection, score: .5 } }, 640, 480), 'weak_detection');
  assert.equal(inspectFace(face, 4000, 3000), 'weak_detection');
});

test('EMA preserves normalized scores and can reset after face discontinuity', () => {
  const a = normalize(scores(.8, .2)), b = normalize(scores(.2, .8));
  const smoothed = smooth(a, b);
  assert.ok(Math.abs(smoothed.neutral - .59) < 1e-12);
  assert.deepEqual(smooth(null, b), b);
  assert.equal(overlap({ x: 0, y: 0, width: 100, height: 100 }, { x: 200, y: 200, width: 100, height: 100 }), 0);
});

test('CSV preserves rejection status, threshold and raw/smoothed scores', () => {
  const csv = toCSV([{ timestamp: '2026-10-17T10:00:00Z', status: 'no_face', threshold: .6, label: '' }]);
  assert.ok(csv.startsWith('\uFEFFtimestamp'));
  assert.ok(csv.includes('raw_happy'));
  assert.ok(csv.includes('smooth_happy'));
  assert.ok(csv.includes('"no_face"'));
  assert.ok(!csv.includes('"neutral"'));
});
