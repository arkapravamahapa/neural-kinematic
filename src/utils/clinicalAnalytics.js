const RIGHT_SIDE_JOINTS_MAP = {
  knee_flexion_001: [24, 26, 28],
  elbow_flexion_001: [12, 14, 16],
  shoulder_abduction_001: [11, 12, 14],
};

export function getSideJoints(exercise, limbSide) {
  if (
    exercise?.tracker !== 'hands' &&
    limbSide === 'Right' &&
    RIGHT_SIDE_JOINTS_MAP[exercise?.id]
  ) {
    return RIGHT_SIDE_JOINTS_MAP[exercise.id];
  }
  return exercise?.primary_angle_joints || [];
}

export function getDefaultPrescription(exercise) {
  const isHands = exercise?.tracker === 'hands';
  const unit = isHands ? '%' : '°';
  const safeMin = isHands
    ? 15
    : typeof exercise?.rom_target_min === 'number'
    ? exercise.rom_target_min
    : 70;
  const safeMax = isHands
    ? 85
    : typeof exercise?.rom_target_max === 'number'
    ? exercise.rom_target_max
    : 170;

  return {
    exercise_key: exercise?.key || 'knee_flexion',
    targetSets: 3,
    targetReps: 10,
    safeMin,
    safeMax,
    maxCompensations: 2,
    involvedSide: 'Left',
    unit,
    boundsMin: 0,
    boundsMax: isHands ? 120 : 180,
  };
}

export function formatPrescriptionSummary(prescription, unit = '°') {
  if (!prescription) return '';
  return `${prescription.targetSets}×${prescription.targetReps} reps · Safe ${prescription.safeMin}–${prescription.safeMax}${unit} · Max ${prescription.maxCompensations} comp`;
}

export function computeAdherenceMetrics({
  totalFrames,
  safeZoneFrames,
  compensationEvents,
  reps,
  prescription,
}) {
  const targetReps = Math.max(1, Number(prescription?.targetReps || 10));
  const maxComp = Math.max(0, Number(prescription?.maxCompensations ?? 2));
  const compCount = Math.max(0, Number(compensationEvents || 0));

  if (!totalFrames || totalFrames === 0) {
    return {
      status: 'standby',
      tone: 'neutral',
      label: '○ Awaiting Live Set',
      safeZonePct: 0,
      repCompletionPct: Math.min(100, Math.round(((reps || 0) / targetReps) * 100)),
      adherenceScore: 0,
      compensationCount: compCount,
      maxCompensations: maxComp,
      compensationExceeded: false,
      totalFrames: 0,
      safeZoneFrames: 0,
    };
  }

  const safeZonePct = Math.round((safeZoneFrames / Math.max(1, totalFrames)) * 100);
  const repCompletionPct = Math.min(100, Math.round(((reps || 0) / targetReps) * 100));
  const compensationExceeded = compCount > maxComp;
  const compScore = compensationExceeded
    ? Math.max(0, 100 - (compCount - maxComp) * 35)
    : 100;

  // Weighted Protocol Adherence Score: Safe-Zone Clean Frames (60%) + Rep Progress (25%) + Compensation Compliance (15%)
  const adherenceScore = Math.round(
    safeZonePct * 0.6 + repCompletionPct * 0.25 + compScore * 0.15
  );

  let tone = 'nominal';
  let label = '● Verified Compliant';
  if (compensationExceeded || adherenceScore < 60) {
    tone = 'critical';
    label = compensationExceeded ? '✖ Compensation Limit Exceeded' : '✖ Low Adherence';
  } else if (adherenceScore < 80 || compCount === maxComp) {
    tone = 'warning';
    label = '▲ Needs Form Coaching';
  }

  return {
    status: 'active',
    tone,
    label,
    safeZonePct,
    repCompletionPct,
    adherenceScore,
    compensationCount: compCount,
    maxCompensations: maxComp,
    compensationExceeded,
    totalFrames,
    safeZoneFrames,
  };
}

export function computeLimbAsymmetry(sessions, exerciseId, involvedSide = 'Left') {
  const validSessions = Array.isArray(sessions) ? sessions : [];
  const scoped = exerciseId
    ? validSessions.filter((s) => s.exercise_id === exerciseId)
    : validSessions;

  const leftSessions = scoped.filter((s) => (s.limb_side || 'Left') === 'Left');
  const rightSessions = scoped.filter((s) => s.limb_side === 'Right');
  const bilateralSessions = scoped.filter((s) => s.limb_side === 'Bilateral');

  const avgMetric = (arr, key) =>
    arr.length > 0
      ? Number(
          (
            arr.reduce((acc, s) => acc + Number(s[key] || 0), 0) / arr.length
          ).toFixed(1)
        )
      : null;

  const leftLatest = leftSessions[0] || null;
  const rightLatest = rightSessions[0] || null;

  const leftRom = leftLatest ? Number(leftLatest.left_max_rom || 0) : null;
  const rightRom = rightLatest ? Number(rightLatest.right_max_rom || rightLatest.left_max_rom || 0) : null;

  const leftConsistency = avgMetric(leftSessions, 'symmetry_score');
  const rightConsistency = avgMetric(rightSessions, 'symmetry_score');

  const healthySide = involvedSide === 'Right' ? 'Left' : 'Right';
  const involvedRom = involvedSide === 'Right' ? rightRom : leftRom;
  const healthyRom = healthySide === 'Right' ? rightRom : leftRom;

  const hasComparison =
    involvedRom !== null &&
    healthyRom !== null &&
    healthyRom > 0 &&
    involvedRom > 0;

  let lsiPct = null;
  let romDeficit = null;
  let trend = 'baseline';
  let trendLabel = 'Save Left & Right sessions to compute deficit delta';
  let tone = 'neutral';

  if (hasComparison) {
    lsiPct = Number(((involvedRom / healthyRom) * 100).toFixed(1));
    romDeficit = Number((involvedRom - healthyRom).toFixed(1));

    // Check earliest pair vs latest pair to see if the gap is closing
    const earliestLeft = leftSessions[leftSessions.length - 1];
    const earliestRight = rightSessions[rightSessions.length - 1];
    if (leftSessions.length > 1 || rightSessions.length > 1) {
      const earlyInvolved =
        involvedSide === 'Right'
          ? Number(earliestRight?.right_max_rom || earliestRight?.left_max_rom || 0)
          : Number(earliestLeft?.left_max_rom || 0);
      const earlyHealthy =
        healthySide === 'Right'
          ? Number(earliestRight?.right_max_rom || earliestRight?.left_max_rom || 0)
          : Number(earliestLeft?.left_max_rom || 0);
      if (earlyHealthy > 0) {
        const earlyGap = Math.abs(earlyInvolved - earlyHealthy);
        const currentGap = Math.abs(romDeficit);
        if (currentGap < earlyGap - 2) {
          trend = 'improving';
          trendLabel = `Closing gap (${earlyGap.toFixed(1)}° → ${currentGap.toFixed(1)}° deficit)`;
        } else if (currentGap > earlyGap + 2) {
          trend = 'widening';
          trendLabel = `Widening gap (${earlyGap.toFixed(1)}° → ${currentGap.toFixed(1)}° deficit)`;
        } else {
          trend = 'stable';
          trendLabel = `Steady side-to-side delta (${currentGap.toFixed(1)}°)`;
        }
      }
    } else {
      trendLabel = `${involvedSide} (Involved) vs ${healthySide} (Healthy Baseline)`;
    }

    if (lsiPct >= 90 && lsiPct <= 110) {
      tone = 'nominal';
    } else if (lsiPct >= 80 && lsiPct <= 120) {
      tone = 'warning';
    } else {
      tone = 'critical';
    }
  }

  return {
    hasComparison,
    involvedSide,
    healthySide,
    leftCount: leftSessions.length,
    rightCount: rightSessions.length,
    bilateralCount: bilateralSessions.length,
    leftRom,
    rightRom,
    leftConsistency,
    rightConsistency,
    involvedRom,
    healthyRom,
    lsiPct,
    romDeficit,
    trend,
    trendLabel,
    tone,
  };
}
