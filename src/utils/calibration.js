function dist2D(a, b) {
  return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
}

export function evaluateTPose(landmarks) {
  if (!landmarks || landmarks.length < 29) {
    return { valid: false, reason: 'Step into camera view so your full upper body and hips are visible.' };
  }

  const requiredIndices = [11, 12, 13, 14, 15, 16, 23, 24];
  for (const idx of requiredIndices) {
    const lm = landmarks[idx];
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) {
      return { valid: false, reason: 'Waiting for full torso and arm landmarks...' };
    }
    if (typeof lm.visibility === 'number' && lm.visibility < 0.45) {
      return { valid: false, reason: 'Step back slightly so both wrists, shoulders, and hips are clearly visible.' };
    }
  }

  const lShoulder = landmarks[11];
  const rShoulder = landmarks[12];
  const lWrist = landmarks[15];
  const rWrist = landmarks[16];
  const lHip = landmarks[23];
  const rHip = landmarks[24];

  const shoulderWidth = dist2D(lShoulder, rShoulder);
  if (shoulderWidth < 0.05) {
    return { valid: false, reason: 'Face the camera squarely and step closer if needed.' };
  }

  const armSpan = dist2D(lWrist, rWrist);
  if (armSpan < shoulderWidth * 1.9) {
    return { valid: false, reason: 'Extend both arms straight out horizontally to form a T-pose.' };
  }

  const levelTol = Math.max(0.11, shoulderWidth * 0.6);
  if (
    Math.abs(lWrist.y - lShoulder.y) > levelTol ||
    Math.abs(rWrist.y - rShoulder.y) > levelTol
  ) {
    return { valid: false, reason: 'Raise or lower arms so both wrists align horizontally with your shoulders.' };
  }

  const midShoulderX = (lShoulder.x + rShoulder.x) / 2;
  const midShoulderY = (lShoulder.y + rShoulder.y) / 2;
  const midHipX = (lHip.x + rHip.x) / 2;
  const midHipY = (lHip.y + rHip.y) / 2;

  if (Math.abs(midShoulderX - midHipX) > 0.1) {
    return { valid: false, reason: 'Stand upright with shoulders centered directly above hips.' };
  }

  const torsoHeight = Math.max(0.15, Math.abs(midHipY - midShoulderY));

  return {
    valid: true,
    reason: 'T-pose aligned. Hold steady...',
    sample: {
      originX: midHipX,
      originY: midHipY,
      originZ: ((lHip.z || 0) + (rHip.z || 0)) / 2,
      scale: torsoHeight,
      shoulderWidth,
    },
  };
}

export function evaluateHandCalibrationPose(landmarks) {
  if (!landmarks || landmarks.length < 21) {
    return { valid: false, reason: 'Hold one open hand inside the camera frame.' };
  }

  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];

  const palmScale = dist2D(wrist, middleMcp);
  if (palmScale < 0.06) {
    return { valid: false, reason: 'Bring your hand slightly closer to the camera.' };
  }

  const pinchDist = dist2D(thumbTip, indexTip);
  if (pinchDist / palmScale < 0.35) {
    return { valid: false, reason: 'Open your thumb and index finger comfortably for neutral baseline.' };
  }

  return {
    valid: true,
    reason: 'Open-palm baseline aligned. Hold steady...',
    sample: {
      originX: middleMcp.x,
      originY: middleMcp.y,
      originZ: middleMcp.z || 0,
      scale: palmScale,
      shoulderWidth: palmScale,
    },
  };
}

export function extractCalibrationSample(landmarks, tracker) {
  if (!landmarks || landmarks.length === 0) return null;

  if (tracker === 'hands') {
    if (landmarks.length < 21) return null;
    const wrist = landmarks[0];
    const middleMcp = landmarks[9];
    if (!wrist || !middleMcp) return null;
    const palmScale = Math.max(0.05, dist2D(wrist, middleMcp));
    return {
      originX: middleMcp.x,
      originY: middleMcp.y,
      originZ: middleMcp.z || 0,
      scale: palmScale,
      shoulderWidth: palmScale,
    };
  }

  if (landmarks.length < 25) return null;
  const lShoulder = landmarks[11];
  const rShoulder = landmarks[12];
  const lHip = landmarks[23];
  const rHip = landmarks[24];
  if (!lShoulder || !rShoulder || !lHip || !rHip) return null;

  const shoulderWidth = Math.max(0.05, dist2D(lShoulder, rShoulder));
  const midShoulderY = (lShoulder.y + rShoulder.y) / 2;
  const midHipX = (lHip.x + rHip.x) / 2;
  const midHipY = (lHip.y + rHip.y) / 2;
  const torsoHeight = Math.max(0.15, Math.abs(midHipY - midShoulderY));

  return {
    originX: midHipX,
    originY: midHipY,
    originZ: ((lHip.z || 0) + (rHip.z || 0)) / 2,
    scale: torsoHeight,
    shoulderWidth,
  };
}

export function computeNormalizationProfile(samples, tracker) {
  if (!samples || samples.length === 0) return null;
  const n = samples.length;
  const avg = samples.reduce(
    (acc, s) => ({
      originX: acc.originX + s.originX / n,
      originY: acc.originY + s.originY / n,
      originZ: acc.originZ + s.originZ / n,
      scale: acc.scale + s.scale / n,
      shoulderWidth: acc.shoulderWidth + s.shoulderWidth / n,
    }),
    { originX: 0, originY: 0, originZ: 0, scale: 0, shoulderWidth: 0 }
  );

  return {
    tracker,
    ...avg,
    targetScale: tracker === 'hands' ? 0.16 : 0.28,
    calibratedAt: new Date().toISOString(),
    sampleCount: n,
  };
}

export function normalizeLandmarks(landmarks, profile) {
  if (!profile || !landmarks || landmarks.length === 0) return landmarks;
  const factor = profile.targetScale / Math.max(0.05, profile.scale);
  const centerY = profile.tracker === 'hands' ? 0.5 : 0.58;

  return landmarks.map((lm) => ({
    x: 0.5 + (lm.x - profile.originX) * factor,
    y: centerY + (lm.y - profile.originY) * factor,
    z: ((lm.z || 0) - profile.originZ) * factor,
    visibility: lm.visibility,
  }));
}
