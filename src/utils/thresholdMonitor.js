export const CLINICAL_THRESHOLD_CATALOG = {
  knee_flexion: {
    protocolKey: 'knee_flexion',
    protocolName: 'Knee Flexion (Squats)',
    jointAxis: 'Hip (23) – Knee (25) – Ankle (27)',
    unit: '°',
    boundsMin: 0,
    boundsMax: 180,
    scaleNote: '180° = standing straight · lower angles = deeper knee bend.',
    presets: [
      {
        id: 'knee_early',
        stage: 'Early Rehab (Protected)',
        min: 100,
        max: 175,
        targetMin: 110,
        targetMax: 170,
        rationale: 'Limits deep flexion beyond 100° to protect healing ACL, meniscus, or post-op tissues.',
      },
      {
        id: 'knee_standard',
        stage: 'Intermediate Functional',
        min: 75,
        max: 178,
        targetMin: 85,
        targetMax: 172,
        rationale: 'Standard half-to-parallel squat corridor for balanced quadriceps and glute loading.',
      },
      {
        id: 'knee_full',
        stage: 'Full Mobility / Athletic',
        min: 55,
        max: 180,
        targetMin: 70,
        targetMax: 175,
        rationale: 'Full active squat range while flagging extreme deep compression below 55°.',
      },
    ],
  },
  elbow_flexion: {
    protocolKey: 'elbow_flexion',
    protocolName: 'Elbow Flexion (Bicep Curls)',
    jointAxis: 'Shoulder (11) – Elbow (13) – Wrist (15)',
    unit: '°',
    boundsMin: 0,
    boundsMax: 180,
    scaleNote: '180° = arm fully straight · lower angles = tighter elbow curl.',
    presets: [
      {
        id: 'elbow_early',
        stage: 'Early Tendon Protection',
        min: 55,
        max: 165,
        targetMin: 60,
        targetMax: 160,
        rationale: 'Avoids terminal straight-arm lock-out and forceful end-range biceps flexion.',
      },
      {
        id: 'elbow_standard',
        stage: 'Standard Therapeutic ROM',
        min: 35,
        max: 175,
        targetMin: 40,
        targetMax: 168,
        rationale: 'Covers functional daily flexion and controlled extension without joint snap.',
      },
      {
        id: 'elbow_full',
        stage: 'Full Active Conditioning',
        min: 25,
        max: 180,
        targetMin: 35,
        targetMax: 175,
        rationale: 'Broad physiological elbow arc for late-stage upper-extremity strength.',
      },
    ],
  },
  shoulder_abduction: {
    protocolKey: 'shoulder_abduction',
    protocolName: 'Shoulder Abduction (Arm Raises)',
    jointAxis: 'R.Shoulder (12) – L.Shoulder (11) – L.Elbow (13)',
    unit: '°',
    boundsMin: 0,
    boundsMax: 180,
    scaleNote: '~90° = arm resting at side · 175° = arm raised horizontally outward.',
    presets: [
      {
        id: 'shoulder_early',
        stage: 'Subacromial Safe Zone',
        min: 90,
        max: 145,
        targetMin: 95,
        targetMax: 140,
        rationale: 'Caps lateral elevation below painful rotator-cuff impingement range.',
      },
      {
        id: 'shoulder_standard',
        stage: 'Standard Lateral Raise',
        min: 80,
        max: 175,
        targetMin: 95,
        targetMax: 170,
        rationale: 'Restores controlled lateral abduction from neutral side rest to shoulder height.',
      },
      {
        id: 'shoulder_full',
        stage: 'Full Overhead Mobility',
        min: 70,
        max: 180,
        targetMin: 90,
        targetMax: 176,
        rationale: 'Wide arc for unrestricted shoulder girdle mobility and late-stage recovery.',
      },
    ],
  },
  finger_pinch: {
    protocolKey: 'finger_pinch',
    protocolName: 'Fine-Motor Finger Pinch',
    jointAxis: 'Thumb Tip (4) – Index Tip (8) · MCP (5)',
    unit: '%',
    boundsMin: 0,
    boundsMax: 120,
    scaleNote: '0% = thumb & index touching · 90–100% = open neutral hand aperture.',
    presets: [
      {
        id: 'pinch_gentle',
        stage: 'Gentle Carpal Tunnel Rehab',
        min: 15,
        max: 85,
        targetMin: 20,
        targetMax: 80,
        rationale: 'Prevents high-pressure pinch compression and over-stretching sensitive flexor tendons.',
      },
      {
        id: 'pinch_standard',
        stage: 'Standard Dexterity Cycle',
        min: 5,
        max: 105,
        targetMin: 10,
        targetMax: 90,
        rationale: 'Full thumb-to-index contact and neutral palm opening for fine-motor precision.',
      },
      {
        id: 'pinch_wide',
        stage: 'Wide Aperture Conditioning',
        min: 2,
        max: 118,
        targetMin: 8,
        targetMax: 105,
        rationale: 'Allows maximal finger extension span while tracking clean tip-to-tip closure.',
      },
    ],
  },
};

export function getProtocolCatalogEntry(exerciseKey) {
  return (
    CLINICAL_THRESHOLD_CATALOG[exerciseKey] || CLINICAL_THRESHOLD_CATALOG.knee_flexion
  );
}

export function getDefaultSafetyLimits(exercise) {
  const isHands = exercise?.tracker === 'hands';
  const boundsMin = 0;
  const boundsMax = isHands ? 120 : 180;
  const min =
    typeof exercise?.safety_min === 'number'
      ? exercise.safety_min
      : isHands
      ? 5
      : Math.max(0, (exercise?.rom_target_min ?? 40) - 15);
  const max =
    typeof exercise?.safety_max === 'number'
      ? exercise.safety_max
      : isHands
      ? 105
      : Math.min(180, (exercise?.rom_target_max ?? 170) + 6);

  return {
    min,
    max,
    boundsMin,
    boundsMax,
    unit: isHands ? '%' : '°',
    metricName: isHands ? 'Pinch Aperture' : 'Joint Angle',
    isHands,
  };
}

export function evaluateRomThreshold(value, limits, trackingStatus, enabled = true) {
  const safeLimits = limits || {
    min: 55,
    max: 176,
    boundsMin: 0,
    boundsMax: 180,
    unit: '°',
    metricName: 'Joint Angle',
    isHands: false,
  };

  const roundedVal = Number.isFinite(value) ? Number(value.toFixed(1)) : 0;

  if (!enabled) {
    return {
      state: 'disabled',
      severity: 'neutral',
      label: '○ Manual Mode (Alerts Off)',
      message:
        'Safety alerts are off to avoid unwanted warnings. Enter custom Min/Max limits or choose a preset from the Reference Chart, then click Apply & Arm.',
      value: roundedVal,
      delta: 0,
    };
  }

  if (trackingStatus !== 'tracking' || !Number.isFinite(value)) {
    return {
      state: 'standby',
      severity: 'neutral',
      label: '○ Armed · Standby',
      message: `Monitoring armed (${safeLimits.min}${safeLimits.unit}–${safeLimits.max}${safeLimits.unit}). Awaiting live kinematic stream.`,
      value: roundedVal,
      delta: 0,
    };
  }

  const margin = safeLimits.isHands ? 4 : 3;

  if (value > safeLimits.max) {
    const delta = Number((value - safeLimits.max).toFixed(1));
    return {
      state: 'exceeded_max',
      severity: 'critical',
      label: '✖ Exceeded Max Limit',
      message: `${safeLimits.metricName} (${roundedVal}${safeLimits.unit}) exceeded ${safeLimits.max}${safeLimits.unit} safety ceiling (+${delta}${safeLimits.unit}).`,
      value: roundedVal,
      delta,
    };
  }

  if (value < safeLimits.min) {
    const delta = Number((safeLimits.min - value).toFixed(1));
    return {
      state: 'below_min',
      severity: 'critical',
      label: '✖ Below Min Limit',
      message: `${safeLimits.metricName} (${roundedVal}${safeLimits.unit}) fell below ${safeLimits.min}${safeLimits.unit} safety floor (-${delta}${safeLimits.unit}).`,
      value: roundedVal,
      delta,
    };
  }

  if (value >= safeLimits.max - margin) {
    const remaining = Number((safeLimits.max - value).toFixed(1));
    return {
      state: 'approaching_max',
      severity: 'warning',
      label: '▲ Near Upper Limit',
      message: `Approaching upper safety ceiling (${remaining}${safeLimits.unit} margin remaining).`,
      value: roundedVal,
      delta: remaining,
    };
  }

  if (value <= safeLimits.min + margin) {
    const remaining = Number((value - safeLimits.min).toFixed(1));
    return {
      state: 'approaching_min',
      severity: 'warning',
      label: '▲ Near Lower Limit',
      message: `Approaching lower safety floor (${remaining}${safeLimits.unit} margin remaining).`,
      value: roundedVal,
      delta: remaining,
    };
  }

  return {
    state: 'nominal',
    severity: 'nominal',
    label: '● Within Safe ROM',
    message: `Safely inside manual ${safeLimits.min}${safeLimits.unit}–${safeLimits.max}${safeLimits.unit} range corridor.`,
    value: roundedVal,
    delta: 0,
  };
}

export function playThresholdAlertTone(breachType, audioCtxRef) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;

    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioCtx();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const freqs = breachType === 'below_min' ? [440, 329.63] : [880, 1046.5];

    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + idx * 0.12;
      const end = start + 0.1;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.11, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, end);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.01);
    });

    return true;
  } catch {
    return false;
  }
}
