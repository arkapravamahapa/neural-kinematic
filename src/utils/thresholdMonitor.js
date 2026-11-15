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

export function evaluateRomThreshold(value, limits, trackingStatus) {
  const safeLimits = limits || {
    min: 55,
    max: 176,
    boundsMin: 0,
    boundsMax: 180,
    unit: '°',
    metricName: 'Joint Angle',
    isHands: false,
  };

  if (trackingStatus !== 'tracking' || !Number.isFinite(value)) {
    return {
      state: 'standby',
      severity: 'neutral',
      label: '○ Standby',
      message: 'Awaiting calibrated live kinematic stream.',
      value: Number.isFinite(value) ? Number(value.toFixed(1)) : 0,
      delta: 0,
    };
  }

  const margin = safeLimits.isHands ? 6 : 5;
  const roundedVal = Number(value.toFixed(1));

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
    message: `Safely inside ${safeLimits.min}${safeLimits.unit}–${safeLimits.max}${safeLimits.unit} range corridor.`,
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
