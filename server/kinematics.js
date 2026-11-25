function solveLinearSystem(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) {
        maxRow = row;
      }
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-12) continue;

    for (let j = col; j <= n; j++) {
      M[col][j] /= pivot;
    }

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col];
      for (let j = col; j <= n; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }

  return M.map((row) => row[n]);
}

function fitPolyAndEval(xs, ys, evalX, polyOrder) {
  const deg = Math.min(polyOrder, xs.length - 1);
  const m = deg + 1;
  const A = Array.from({ length: m }, () => Array(m).fill(0));
  const b = Array(m).fill(0);

  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    for (let r = 0; r < m; r++) {
      const xr = Math.pow(x, r);
      b[r] += xr * y;
      for (let c = 0; c < m; c++) {
        A[r][c] += Math.pow(x, r + c);
      }
    }
  }

  const coeffs = solveLinearSystem(A, b);
  let val = 0;
  for (let r = 0; r < m; r++) {
    val += coeffs[r] * Math.pow(evalX, r);
  }
  return val;
}

function savgolFilter(data, windowLength, polyOrder) {
  const n = data.length;
  if (n === 0) return [];
  let w = Math.min(windowLength, n);
  if (w % 2 === 0) w -= 1;
  if (w < 3) return [...data];

  const half = Math.floor(w / 2);
  const result = new Array(n);

  for (let i = 0; i < n; i++) {
    let start = i - half;
    let end = i + half;
    if (start < 0) {
      start = 0;
      end = w - 1;
    } else if (end >= n) {
      end = n - 1;
      start = n - w;
    }

    const xs = [];
    const ys = [];
    for (let j = start; j <= end; j++) {
      xs.push(j - start - half);
      ys.push(data[j]);
    }
    const evalX = i - start - half;
    result[i] = fitPolyAndEval(xs, ys, evalX, polyOrder);
  }

  return result;
}

function median3(a, b, c) {
  if ((a <= b && b <= c) || (c <= b && b <= a)) return b;
  if ((b <= a && a <= c) || (c <= a && a <= b)) return a;
  return c;
}

function computeDtwDistance(seqA, seqB) {
  const n = seqA.length;
  const m = seqB.length;
  if (n === 0 || m === 0) return 0;

  let prev = new Float64Array(m + 1).fill(Infinity);
  let curr = new Float64Array(m + 1).fill(Infinity);
  prev[0] = 0;

  for (let i = 1; i <= n; i++) {
    curr.fill(Infinity);
    for (let j = 1; j <= m; j++) {
      const cost = Math.abs(seqA[i - 1] - seqB[j - 1]);
      curr[j] = cost + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[m];
}

function gradient(arr, dt) {
  const n = arr.length;
  if (n < 2) return new Array(n).fill(0);
  const out = new Array(n);
  out[0] = (arr[1] - arr[0]) / dt;
  for (let i = 1; i < n - 1; i++) {
    out[i] = (arr[i + 1] - arr[i - 1]) / (2 * dt);
  }
  out[n - 1] = (arr[n - 1] - arr[n - 2]) / dt;
  return out;
}

function dist2D(a, b) {
  const dx = (a.x ?? 0) - (b.x ?? 0);
  const dy = (a.y ?? 0) - (b.y ?? 0);
  return Math.hypot(dx, dy);
}

const RIGHT_SIDE_JOINTS_MAP = {
  knee_flexion_001: [24, 26, 28],
  elbow_flexion_001: [12, 14, 16],
  shoulder_abduction_001: [11, 12, 14],
};

export class PatientSessionAnalyzer {
  constructor(exerciseConfig) {
    this.config = exerciseConfig;
    this.limbSide = 'Left';
    this.windowSize = exerciseConfig.tracker === 'hands' ? 11 : 15;
    this.polyOrder = 2;
    this.reset();
  }

  setConfig(exerciseConfig) {
    this.config = exerciseConfig;
    this.windowSize = exerciseConfig.tracker === 'hands' ? 11 : 15;
    this.reset();
  }

  setSide(side) {
    const valid = ['Left', 'Right', 'Bilateral'].includes(side) ? side : 'Left';
    if (this.limbSide !== valid) {
      this.limbSide = valid;
      this.reset();
    }
  }

  getActiveJoints() {
    if (
      this.config.tracker !== 'hands' &&
      this.limbSide === 'Right' &&
      RIGHT_SIDE_JOINTS_MAP[this.config.id]
    ) {
      return RIGHT_SIDE_JOINTS_MAP[this.config.id];
    }
    return this.config.primary_angle_joints || [];
  }

  reset() {
    this.rawAngleHistory = [];
    this.angleHistory = [];
    this.smoothedHistory = [];

    this.rawPinchHistory = [];
    this.pinchHistory = [];
    this.smoothedPinchHistory = [];

    this.timeHistory = [];
    this.repCount = 0;

    this.baselineRepSignature = [];
    this.currentRepBuffer = [];
    this.currentRepJerkMax = 0;
    this.currentRepCompensations = new Set();
    this.repHistory = [];

    this.compensationAlerts = [];
    this.activeCompensationSet = new Set();
    this.compensationEventsCount = 0;

    this.phase = 'baseline';
    this.baselineValue = null;
    this.extremumValue = null;
    this.repStartTime = null;
    this.lastRepCompletedTime = 0;
    this.lastDtwScore = 100.0;
    this.romMax = 0;
    this.romMin = 180;
    this.pinchMinMm = 90;
    this.pinchMaxMm = 0;
    this.lastStatus = null;
  }

  calculateAngle(a, b, c) {
    const radians =
      Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    const angle = Math.abs((radians * 180.0) / Math.PI);
    return angle > 180.0 ? 360.0 - angle : angle;
  }

  hasReliableLandmarks(landmarks) {
    const required = [...this.getActiveJoints()];
    if (this.config.tracker === 'hands') {
      required.push(...(this.config.pinch_landmarks || [4, 8]));
      required.push(...(this.config.palm_scale_landmarks || [0, 9]));
    }
    for (const idx of required) {
      const lm = landmarks[idx];
      if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) {
        return false;
      }
      if (this.config.tracker !== 'hands' && typeof lm.visibility === 'number' && lm.visibility < 0.5) {
        return false;
      }
    }
    return true;
  }

  checkCompensations(landmarks) {
    const alerts = new Set();
    const checks = this.config.compensation_checks || [];

    if (checks.includes('trunk_lean') && landmarks[11] && landmarks[12] && landmarks[23] && landmarks[24]) {
      const midShoulderX = (landmarks[11].x + landmarks[12].x) / 2;
      const midHipX = (landmarks[23].x + landmarks[24].x) / 2;
      if (Math.abs(midShoulderX - midHipX) > 0.08) {
        alerts.add('Trunk Lean Detected');
      }
    }

    if (checks.includes('hip_shift') && landmarks[23] && landmarks[24]) {
      if (Math.abs(landmarks[23].y - landmarks[24].y) > 0.06) {
        alerts.add('Lateral Pelvic Shift');
      }
    }

    if (checks.includes('shoulder_elevation') && landmarks[11] && landmarks[12]) {
      if (Math.abs(landmarks[11].y - landmarks[12].y) > 0.05) {
        alerts.add('Shoulder Elevation (Shrugging)');
      }
    }

    if (checks.includes('wrist_deviation') && landmarks[0] && landmarks[9]) {
      const palmLen = Math.max(0.05, dist2D(landmarks[0], landmarks[9]));
      const lateralOffset = Math.abs(landmarks[0].x - landmarks[9].x) / palmLen;
      if (lateralOffset > 0.55) {
        alerts.add('Excessive Wrist Deviation');
      }
    }

    return Array.from(alerts);
  }

  _computeFatigueAnalysis() {
    const total = this.repHistory.length;
    if (total < 4) {
      return {
        status: 'collecting',
        severity: 'neutral',
        label: '○ Collecting Baseline',
        summary: `Completed ${total}/4 reps required to compare baseline vs. late-set neuromuscular drift.`,
        baselineCount: Math.min(3, total),
        lateCount: 0,
        baselineRom: total > 0 ? Number((this.repHistory.reduce((a, r) => a + r.romExcursion, 0) / total).toFixed(1)) : 0,
        lateRom: 0,
        romDeltaPct: 0,
        baselineJerk: total > 0 ? Number((this.repHistory.reduce((a, r) => a + r.peakJerk, 0) / total).toFixed(1)) : 0,
        lateJerk: 0,
        jerkDeltaPct: 0,
        baselineDtw: total > 0 ? Number((this.repHistory.reduce((a, r) => a + r.dtw, 0) / total).toFixed(1)) : 100,
        lateDtw: 100,
        dtwDeltaPts: 0,
        findings: [],
      };
    }

    const windowCount = Math.min(3, Math.floor(total / 2));
    const baselineReps = this.repHistory.slice(0, windowCount);
    const lateReps = this.repHistory.slice(-windowCount);

    const avg = (arr, key) =>
      arr.reduce((acc, item) => acc + Number(item[key] || 0), 0) / Math.max(1, arr.length);

    const baselineRom = avg(baselineReps, 'romExcursion');
    const lateRom = avg(lateReps, 'romExcursion');
    const romDeltaPct =
      baselineRom > 1 ? ((lateRom - baselineRom) / baselineRom) * 100 : 0;

    const baselineJerk = avg(baselineReps, 'peakJerk');
    const lateJerk = avg(lateReps, 'peakJerk');
    const jerkDiff = lateJerk - baselineJerk;
    const jerkDeltaPct =
      baselineJerk >= 1 ? (jerkDiff / baselineJerk) * 100 : jerkDiff * 10;

    const baselineDtw = avg(baselineReps, 'dtw');
    const lateDtw = avg(lateReps, 'dtw');
    const dtwDeltaPts = lateDtw - baselineDtw;

    const findings = [];
    if (romDeltaPct <= -10) {
      findings.push(`Late-set ROM drop (${Math.round(romDeltaPct)}%)`);
    }
    if (jerkDeltaPct >= 25 || jerkDiff >= 8) {
      const displayRise = Math.max(Math.round(jerkDeltaPct), Math.round(jerkDiff));
      findings.push(`tremor rise (+${displayRise}%)`);
    }
    if (dtwDeltaPts <= -10) {
      findings.push(`form consistency drift (${Math.round(dtwDeltaPts)} pts)`);
    }

    let severity = 'nominal';
    let label = '● Stable Output';
    if (findings.length >= 2 || romDeltaPct <= -20 || dtwDeltaPts <= -20) {
      severity = 'critical';
      label = '✖ High Fatigue Drift';
    } else if (findings.length === 1) {
      severity = 'warning';
      label = '▲ Early Fatigue Drift';
    }

    const summary =
      findings.length > 0
        ? findings.join(' + ')
        : `Consistent output across reps 1–${windowCount} vs. reps ${total - windowCount + 1}–${total}.`;

    return {
      status: 'active',
      severity,
      label,
      summary,
      baselineCount: windowCount,
      lateCount: windowCount,
      baselineRom: Number(baselineRom.toFixed(1)),
      lateRom: Number(lateRom.toFixed(1)),
      romDeltaPct: Number(romDeltaPct.toFixed(1)),
      baselineJerk: Number(baselineJerk.toFixed(1)),
      lateJerk: Number(lateJerk.toFixed(1)),
      jerkDeltaPct: Number(jerkDeltaPct.toFixed(1)),
      baselineDtw: Number(baselineDtw.toFixed(1)),
      lateDtw: Number(lateDtw.toFixed(1)),
      dtwDeltaPts: Number(dtwDeltaPts.toFixed(1)),
      findings,
    };
  }

  processFrame(landmarks, timestamp) {
    const isHands = this.config.tracker === 'hands';

    if (!this.hasReliableLandmarks(landmarks)) {
      if (this.lastStatus) {
        return this.lastStatus;
      }
      return {
        status: 'buffering',
        tracker: this.config.tracker || 'pose',
        limb_side: this.limbSide,
        exercise_id: this.config.id,
        reps: Number(this.repCount),
        smoothed_angle: 0,
        pinch_distance_mm: 0,
        pinch_aperture: 0,
        jerk_score: 0,
        rom_max: 0,
        rom_min: 0,
        dtw_consistency: 100,
        alerts: [],
        compensation_events: 0,
        rep_history: [],
        fatigue: this._computeFatigueAnalysis(),
      };
    }

    const joints = this.getActiveJoints();
    const rawAngle = this.calculateAngle(
      landmarks[joints[0]],
      landmarks[joints[1]],
      landmarks[joints[2]]
    );

    this.rawAngleHistory.push(rawAngle);
    const rawLen = this.rawAngleHistory.length;
    const despikedAngle =
      rawLen >= 3
        ? median3(
            this.rawAngleHistory[rawLen - 3],
            this.rawAngleHistory[rawLen - 2],
            this.rawAngleHistory[rawLen - 1]
          )
        : rawAngle;

    this.angleHistory.push(despikedAngle);
    this.timeHistory.push(timestamp);

    let despikedPinchAperture = 0;
    if (isHands) {
      const [pA, pB] = this.config.pinch_landmarks || [4, 8];
      const [sA, sB] = this.config.palm_scale_landmarks || [0, 9];
      const palmScale = Math.max(0.05, dist2D(landmarks[sA], landmarks[sB]));
      const rawPinchRatio = dist2D(landmarks[pA], landmarks[pB]) / palmScale;
      const rawPinchAperture = Math.min(120, Math.max(0, rawPinchRatio * 100));

      this.rawPinchHistory.push(rawPinchAperture);
      const pLen = this.rawPinchHistory.length;
      despikedPinchAperture =
        pLen >= 3
          ? median3(
              this.rawPinchHistory[pLen - 3],
              this.rawPinchHistory[pLen - 2],
              this.rawPinchHistory[pLen - 1]
            )
          : rawPinchAperture;
      this.pinchHistory.push(despikedPinchAperture);
    }

    const currentCompensations = this.checkCompensations(landmarks);
    const currentSet = new Set(currentCompensations);
    for (const comp of currentSet) {
      if (!this.activeCompensationSet.has(comp)) {
        this.compensationEventsCount += 1;
      }
      if (this.phase === 'active') {
        this.currentRepCompensations.add(comp);
      }
    }
    this.activeCompensationSet = currentSet;

    if (currentCompensations.length > 0) {
      const merged = new Set([...this.compensationAlerts, ...currentCompensations]);
      this.compensationAlerts = Array.from(merged);
    }

    const repDirection = this.config.rep_direction || 'decrease';

    if (this.angleHistory.length < this.windowSize) {
      const warmupSignal = isHands ? despikedPinchAperture : despikedAngle;
      if (this.baselineValue === null) {
        this.baselineValue = warmupSignal;
      } else if (repDirection === 'decrease' && warmupSignal > this.baselineValue) {
        this.baselineValue = warmupSignal;
      } else if (repDirection === 'increase' && warmupSignal < this.baselineValue) {
        this.baselineValue = warmupSignal;
      }

      const bufferingPayload = {
        status: 'buffering',
        tracker: this.config.tracker || 'pose',
        limb_side: this.limbSide,
        exercise_id: this.config.id,
        reps: Number(this.repCount),
        smoothed_angle: Number(despikedAngle.toFixed(2)),
        pinch_distance_mm: isHands ? Number(((despikedPinchAperture / 100) * 90).toFixed(1)) : 0,
        pinch_aperture: isHands ? Number(despikedPinchAperture.toFixed(1)) : 0,
        jerk_score: 0,
        rom_max: 0,
        rom_min: 0,
        dtw_consistency: 100,
        alerts: currentCompensations,
        compensation_events: this.compensationEventsCount,
        rep_history: this.repHistory,
        fatigue: this._computeFatigueAnalysis(),
      };
      this.lastStatus = bufferingPayload;
      return bufferingPayload;
    }

    const recentAngles = this.angleHistory.slice(-this.windowSize);
    const smoothedAngles = savgolFilter(recentAngles, this.windowSize, this.polyOrder);
    const currentSmoothedAngle = Math.max(
      0,
      Math.min(180, smoothedAngles[smoothedAngles.length - 1])
    );
    this.smoothedHistory.push(currentSmoothedAngle);

    if (this.smoothedHistory.length === 1) {
      this.romMax = currentSmoothedAngle;
      this.romMin = currentSmoothedAngle;
    } else {
      if (currentSmoothedAngle > this.romMax) this.romMax = currentSmoothedAngle;
      if (currentSmoothedAngle < this.romMin) this.romMin = currentSmoothedAngle;
    }

    let currentSmoothedPinch = 0;
    let currentPinchMm = 0;
    if (isHands) {
      const recentPinch = this.pinchHistory.slice(-this.windowSize);
      const smoothedPinch = savgolFilter(recentPinch, this.windowSize, this.polyOrder);
      currentSmoothedPinch = Math.max(
        0,
        Math.min(120, smoothedPinch[smoothedPinch.length - 1])
      );
      this.smoothedPinchHistory.push(currentSmoothedPinch);
      currentPinchMm = (currentSmoothedPinch / 100) * 90;
      if (currentPinchMm < this.pinchMinMm) this.pinchMinMm = currentPinchMm;
      if (currentPinchMm > this.pinchMaxMm) this.pinchMaxMm = currentPinchMm;
    }

    const jerkMetric = this._calculateJerk(isHands ? this.smoothedPinchHistory : this.smoothedHistory);
    if (this.phase === 'active' && jerkMetric > this.currentRepJerkMax) {
      this.currentRepJerkMax = jerkMetric;
    }

    const activeSignal = isHands ? currentSmoothedPinch : currentSmoothedAngle;
    const minProminence = this.config.rep_trigger_prominence ?? 40;
    const minDurationSec = this.config.min_rep_duration_sec ?? 0.35;
    const minCooldownSec = isHands ? 0.2 : 0.35;
    const startDeltaThreshold = Math.min(isHands ? 12 : 20, minProminence * 0.45);
    const minFramesPerRep = isHands ? 5 : 8;

    if (this.baselineValue === null) {
      this.baselineValue = activeSignal;
    }

    if (this.phase === 'baseline') {
      if (repDirection === 'decrease') {
        if (activeSignal > this.baselineValue) {
          this.baselineValue = activeSignal;
        } else {
          this.baselineValue = this.baselineValue * 0.985 + activeSignal * 0.015;
        }

        if (
          this.baselineValue - activeSignal >= startDeltaThreshold &&
          timestamp - this.lastRepCompletedTime >= minCooldownSec
        ) {
          this.phase = 'active';
          this.extremumValue = activeSignal;
          this.repStartTime = timestamp;
          this.currentRepBuffer = [activeSignal];
          this.currentRepJerkMax = jerkMetric;
          this.currentRepCompensations = new Set(currentCompensations);
        }
      } else {
        if (activeSignal < this.baselineValue) {
          this.baselineValue = activeSignal;
        } else {
          this.baselineValue = this.baselineValue * 0.985 + activeSignal * 0.015;
        }

        if (
          activeSignal - this.baselineValue >= startDeltaThreshold &&
          timestamp - this.lastRepCompletedTime >= minCooldownSec
        ) {
          this.phase = 'active';
          this.extremumValue = activeSignal;
          this.repStartTime = timestamp;
          this.currentRepBuffer = [activeSignal];
          this.currentRepJerkMax = jerkMetric;
          this.currentRepCompensations = new Set(currentCompensations);
        }
      }
    } else if (this.phase === 'active') {
      this.currentRepBuffer.push(activeSignal);

      if (repDirection === 'decrease') {
        if (activeSignal < this.extremumValue) {
          this.extremumValue = activeSignal;
        }
        const excursion = this.baselineValue - this.extremumValue;
        const recovery = activeSignal - this.extremumValue;
        const requiredRecovery = Math.max(isHands ? 15 : 25, excursion * 0.65);
        const returnedNearBaseline = activeSignal >= this.baselineValue - (isHands ? 12 : 18);

        if ((recovery >= requiredRecovery || returnedNearBaseline) && excursion >= minProminence) {
          const repDuration = timestamp - (this.repStartTime ?? timestamp);
          if (repDuration >= minDurationSec && this.currentRepBuffer.length >= minFramesPerRep) {
            this._commitRep(excursion, repDuration);
            this.lastRepCompletedTime = timestamp;
          }
          this.phase = 'baseline';
          this.baselineValue = Math.max(this.baselineValue, activeSignal);
          this.extremumValue = null;
          this.repStartTime = null;
          this.currentRepBuffer = [];
          this.currentRepJerkMax = 0;
          this.currentRepCompensations = new Set();
        } else if (returnedNearBaseline && excursion < minProminence) {
          this.phase = 'baseline';
          this.baselineValue = Math.max(this.baselineValue, activeSignal);
          this.extremumValue = null;
          this.repStartTime = null;
          this.currentRepBuffer = [];
          this.currentRepJerkMax = 0;
          this.currentRepCompensations = new Set();
        }
      } else {
        if (activeSignal > this.extremumValue) {
          this.extremumValue = activeSignal;
        }
        const excursion = this.extremumValue - this.baselineValue;
        const recovery = this.extremumValue - activeSignal;
        const requiredRecovery = Math.max(20, excursion * 0.65);
        const returnedNearBaseline = activeSignal <= this.baselineValue + 18;

        if ((recovery >= requiredRecovery || returnedNearBaseline) && excursion >= minProminence) {
          const repDuration = timestamp - (this.repStartTime ?? timestamp);
          if (repDuration >= minDurationSec && this.currentRepBuffer.length >= minFramesPerRep) {
            this._commitRep(excursion, repDuration);
            this.lastRepCompletedTime = timestamp;
          }
          this.phase = 'baseline';
          this.baselineValue = Math.min(this.baselineValue, activeSignal);
          this.extremumValue = null;
          this.repStartTime = null;
          this.currentRepBuffer = [];
          this.currentRepJerkMax = 0;
          this.currentRepCompensations = new Set();
        } else if (returnedNearBaseline && excursion < minProminence) {
          this.phase = 'baseline';
          this.baselineValue = Math.min(this.baselineValue, activeSignal);
          this.extremumValue = null;
          this.repStartTime = null;
          this.currentRepBuffer = [];
          this.currentRepJerkMax = 0;
          this.currentRepCompensations = new Set();
        }
      }
    }

    const payload = {
      status: 'tracking',
      tracker: this.config.tracker || 'pose',
      limb_side: this.limbSide,
      exercise_id: this.config.id,
      smoothed_angle: Number(currentSmoothedAngle.toFixed(2)),
      pinch_distance_mm: isHands ? Number(currentPinchMm.toFixed(1)) : 0,
      pinch_aperture: isHands ? Number(currentSmoothedPinch.toFixed(1)) : 0,
      pinch_min_mm: isHands ? Number(this.pinchMinMm.toFixed(1)) : 0,
      pinch_max_mm: isHands ? Number(this.pinchMaxMm.toFixed(1)) : 0,
      reps: Number(this.repCount),
      jerk_score: Number(jerkMetric),
      rom_max: Number(this.romMax.toFixed(2)),
      rom_min: Number(this.romMin.toFixed(2)),
      dtw_consistency: Number(this.lastDtwScore.toFixed(1)),
      alerts: currentCompensations,
      session_alerts: this.compensationAlerts.slice(-3),
      compensation_events: this.compensationEventsCount,
      rep_history: this.repHistory.slice(-20),
      fatigue: this._computeFatigueAnalysis(),
    };
    this.lastStatus = payload;
    return payload;
  }

  _commitRep(excursion, repDurationSec) {
    this.repCount += 1;
    if (this.baselineRepSignature.length === 0) {
      this.baselineRepSignature = [...this.currentRepBuffer];
      this.lastDtwScore = 100.0;
    } else {
      const distance = computeDtwDistance(this.baselineRepSignature, this.currentRepBuffer);
      const normLen = Math.max(this.baselineRepSignature.length, this.currentRepBuffer.length);
      this.lastDtwScore = Math.max(0, 100 - (distance / normLen) * 1.5);
    }

    this.repHistory.push({
      rep: this.repCount,
      romExcursion: Number((excursion || 0).toFixed(1)),
      peakJerk: Number((this.currentRepJerkMax || 0).toFixed(1)),
      dtw: Number(this.lastDtwScore.toFixed(1)),
      durationSec: Number((repDurationSec || 0).toFixed(2)),
      hadCompensation: this.currentRepCompensations.size > 0,
    });
  }

  _calculateJerk(series) {
    if (series.length < 4) return 0.0;
    const recent = series.slice(-this.windowSize);
    const dt = 0.033;
    const velocity = gradient(recent, dt);
    const acceleration = gradient(velocity, dt);
    const jerk = gradient(acceleration, dt);
    const meanSq = jerk.reduce((acc, v) => acc + v * v, 0) / jerk.length;
    const jerkRms = Math.sqrt(meanSq);
    return Number(Math.min(jerkRms / 1000, 100).toFixed(2));
  }
}
