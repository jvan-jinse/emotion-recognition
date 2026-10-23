export const LABELS = [
  { key: 'neutral', name: '中性', color: '#748c9a' },
  { key: 'happy', name: '高兴', color: '#d2a449' },
  { key: 'sad', name: '悲伤', color: '#668bb9' },
  { key: 'angry', name: '愤怒', color: '#cb7668' },
  { key: 'fearful', name: '恐惧', color: '#a38bbf' },
  { key: 'disgusted', name: '厌恶', color: '#8b9c66' },
  { key: 'surprised', name: '惊讶', color: '#d39159' },
];

export function normalize(scores) {
  if (!scores || LABELS.some(({ key }) => !Number.isFinite(scores[key]) || scores[key] < 0 || scores[key] > 1)) return null;
  const sum = LABELS.reduce((total, { key }) => total + scores[key], 0);
  if (sum <= 0) return null;
  return Object.fromEntries(LABELS.map(({ key }) => [key, scores[key] / sum]));
}

export function smooth(previous, current, alpha = 0.35) {
  return Object.fromEntries(LABELS.map(({ key }) => [key, previous ? alpha * current[key] + (1 - alpha) * previous[key] : current[key]]));
}

export function classify(scores, threshold = 0.60, minMargin = 0.15) {
  if (!scores) return { accepted: false, key: null, score: 0, margin: 0 };
  const ranked = LABELS.map(({ key }) => ({ key, score: scores[key] })).sort((a, b) => b.score - a.score);
  const margin = ranked[0].score - ranked[1].score;
  return { ...ranked[0], margin, accepted: ranked[0].score >= threshold && margin >= minMargin };
}

export const PRIMARY_FACE_WEIGHTS = Object.freeze({ area: 0.40, center: 0.25, detection: 0.10, overlap: 0.25 });

export function inspectFace(face, width, height) {
  if (!face) return 'no_face';
  const { box, score } = face.detection;
  if (score < 0.65 || box.width / width < 0.12 || box.height / height < 0.16) return 'weak_detection';
  if (!normalize(face.expressions)) return 'invalid_scores';
  return 'valid';
}

export const PRIMARY_SWITCH_MARGIN = 0.10;

export function choosePrimaryFace(faces, width, height, previousBox, switchMargin = PRIMARY_SWITCH_MARGIN) {
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

export function topExpression(scores) {
  const normalized = normalize(scores);
  if (!normalized) return null;
  return LABELS.map(({ key }) => ({ key, score: normalized[key] })).sort((a, b) => b.score - a.score)[0];
}

export function timeAwareAlpha(dtSeconds, tauSeconds = 0.35) {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0 || !Number.isFinite(tauSeconds) || tauSeconds <= 0) return 0;
  return 1 - Math.exp(-Math.min(dtSeconds, 2) / tauSeconds);
}

export function appendVote(votes, time, scores, maxAgeMs = 1000) {
  const kept = (votes || []).filter(point => time - point.time <= maxAgeMs);
  if (!scores) return kept;
  const top = topExpression(scores);
  if (top) kept.push({ time, key: top.key, score: top.score, scores });
  return kept;
}

export function summarizeVotes(votes) {
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

export function estimateHeadPose(landmarks) {
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

export function validateHeadPose(pose) {
  if (!pose) return 'landmarks_missing';
  if (Math.abs(pose.roll) > 12) return 'pose_tilt';
  if (Math.abs(pose.yaw) > 0.32) return 'pose_yaw';
  if (pose.pitch < 0.32 || pose.pitch > 0.72) return 'pose_pitch';
  return 'valid';
}

export function chooseFaceByOverlap(faces, previousBox, minOverlap = 0.12) {
  if (!faces?.length || !previousBox) return null;
  let best = null;
  faces.forEach((face, index) => {
    const score = overlap(previousBox, face.detection.box);
    if (!best || score > best.score) best = { face, index, score, metrics: { overlap_score: score } };
  });
  return best && best.score >= minOverlap ? best : null;
}

export function findFaceAtPoint(faces, point) {
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

export function mapPointerToFrame(clientX, clientY, rect, frameWidth, frameHeight, mirrored = false) {
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
export function overlap(a, b) {
  if (!a || !b) return 0;
  const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return intersection / (a.width * a.height + b.width * b.height - intersection || 1);
}

export function toCSV(rows) {
  const fields = ['timestamp', 'elapsed_s', 'source', 'face_count', 'selection_mode', 'status', 'label', 'top_score', 'margin', 'threshold', 'inference_ms', 'detection_score', 'smoothing_alpha', 'vote_label', 'vote_ratio', 'vote_samples', ...LABELS.map(x => `raw_${x.key}`), ...LABELS.map(x => `smooth_${x.key}`)];
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return '\uFEFF' + [fields.join(','), ...rows.map(row => fields.map(field => quote(row[field])).join(','))].join('\r\n');
}
