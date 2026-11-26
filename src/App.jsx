import { useCallback, useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import {
  PoseLandmarker,
  HandLandmarker,
  FilesetResolver,
  DrawingUtils,
} from '@mediapipe/tasks-vision';

import ClinicalDashboard from './components/ClinicalDashboard';
import SessionHistory from './components/SessionHistory';
import DoctorDashboard from './components/DoctorDashboard';
import AIChat from './components/AIChat';
import CalibrationWizard from './components/CalibrationWizard';
import ProtocolGuide from './components/ProtocolGuide';
import StreamStatusIndicator from './components/StreamStatusIndicator';
import ThresholdMonitor from './components/ThresholdMonitor';
import ClinicalInsightsPanel from './components/ClinicalInsightsPanel';
import RehabPrescriptionPanel from './components/RehabPrescriptionPanel';
import { PatientSessionAnalyzer } from '../server/kinematics.js';
import {
  evaluateTPose,
  evaluateHandCalibrationPose,
  extractCalibrationSample,
  computeNormalizationProfile,
  normalizeLandmarks,
} from './utils/calibration';
import {
  getDefaultSafetyLimits,
  evaluateRomThreshold,
  playThresholdAlertTone,
} from './utils/thresholdMonitor';
import {
  getSideJoints,
  getDefaultPrescription,
  formatPrescriptionSummary,
  computeAdherenceMetrics,
} from './utils/clinicalAnalytics';
import { getApiUrl, getWebSocketUrl } from './utils/backend';

const CALIBRATION_DURATION_SEC = 3.0;
const MAX_WEBSOCKET_BUFFER_BYTES = 256 * 1024;
const WEBSOCKET_STALE_AFTER_MS = 1500;

function createInitialCalibrationState(tracker) {
  const isHands = tracker === 'hands';
  return {
    status: 'calibrating',
    step: 1,
    progressSec: 0,
    durationSec: CALIBRATION_DURATION_SEC,
    feedback: isHands
      ? 'Place one open hand in front of the camera to begin calibration.'
      : 'Step into frame and extend both arms horizontally into a T-pose.',
    profile: null,
  };
}

const DEFAULT_EXERCISES = {
  knee_flexion: {
    id: 'knee_flexion_001',
    key: 'knee_flexion',
    name: 'Knee Flexion (Squats)',
    category: 'Lower Extremity Gross Motor',
    tracker: 'pose',
    primary_angle_joints: [23, 25, 27],
    joint_labels: ['Hip (23)', 'Knee (25)', 'Ankle (27)'],
    rep_direction: 'decrease',
    rom_target_min: 70,
    rom_target_max: 170,
    safety_min: 55,
    safety_max: 176,
    rep_trigger_prominence: 45,
    min_rep_duration_sec: 0.35,
    guidance: {
      framing:
        'Stand 2–2.5 m from the camera at a slight 30° angle so hip, knee, and ankle stay visible.',
      calibration_instruction:
        'Stand upright with feet shoulder-width apart and extend both arms horizontally at shoulder level (T-pose) for 3 seconds.',
      steps: [
        'Begin standing tall with knees near full extension (~165°–175°).',
        'Hinge at the hips and bend knees smoothly toward 70°–95° without letting knees collapse inward.',
        'Pause briefly at bottom flexion, then drive evenly through both heels back to standing.',
      ],
      form_cues:
        'Keep torso upright (avoids Trunk Lean alert) and hips level (avoids Lateral Pelvic Shift).',
    },
  },
  elbow_flexion: {
    id: 'elbow_flexion_001',
    key: 'elbow_flexion',
    name: 'Elbow Flexion (Bicep Curls)',
    category: 'Upper Extremity Gross Motor',
    tracker: 'pose',
    primary_angle_joints: [11, 13, 15],
    joint_labels: ['Shoulder (11)', 'Elbow (13)', 'Wrist (15)'],
    rep_direction: 'decrease',
    rom_target_min: 35,
    rom_target_max: 165,
    safety_min: 25,
    safety_max: 175,
    rep_trigger_prominence: 45,
    min_rep_duration_sec: 0.3,
    guidance: {
      framing:
        'Face the camera 1.5–2 m back with your upper torso, left shoulder, elbow, and wrist clearly framed.',
      calibration_instruction:
        'Stand tall and hold a horizontal T-pose for 3 seconds to normalize shoulder-to-hip proportions.',
      steps: [
        'Relax shoulders down and start with the elbow extended (~160°–170°) beside your torso.',
        'Flex the elbow smoothly, bringing the wrist upward toward the shoulder (~35°–50°).',
        'Lower the forearm under control back to full extension without swinging.',
      ],
      form_cues:
        'Keep your collarbone level and avoid hiking the shoulder upward during peak flexion.',
    },
  },
  shoulder_abduction: {
    id: 'shoulder_abduction_001',
    key: 'shoulder_abduction',
    name: 'Shoulder Abduction (Arm Raises)',
    category: 'Upper Extremity Gross Motor',
    tracker: 'pose',
    primary_angle_joints: [12, 11, 13],
    joint_labels: ['R.Shoulder (12)', 'L.Shoulder (11)', 'L.Elbow (13)'],
    rep_direction: 'increase',
    rom_target_min: 95,
    rom_target_max: 175,
    safety_min: 80,
    safety_max: 178,
    rep_trigger_prominence: 35,
    min_rep_duration_sec: 0.35,
    guidance: {
      framing:
        'Stand straight facing the camera 1.5–2 m away so both shoulders and extended arms fit inside the frame.',
      calibration_instruction:
        'Hold a steady horizontal T-pose for 3 seconds so shoulder baseline span and trunk midline are calibrated.',
      steps: [
        'Start with arms resting comfortably at your sides (~95° shoulder-to-elbow baseline).',
        'Raise your left arm laterally outward with a straight elbow up to shoulder height (~170°–175°).',
        'Hold 1 second at top abduction, then lower smoothly back to your side.',
      ],
      form_cues:
        'Avoid leaning your torso sideways or shrugging the shoulder toward your ear.',
    },
  },
  finger_pinch: {
    id: 'finger_pinch_001',
    key: 'finger_pinch',
    name: 'Fine-Motor Finger Flexion / Pinch Test',
    category: 'Hand & Carpal Tunnel Dexterity',
    tracker: 'hands',
    primary_angle_joints: [0, 5, 6],
    pinch_landmarks: [4, 8],
    joint_labels: ['Thumb Tip (4)', 'Index Tip (8)', 'Index MCP (5)'],
    rep_direction: 'decrease',
    rom_target_min: 10,
    rom_target_max: 90,
    safety_min: 5,
    safety_max: 105,
    rep_trigger_prominence: 25,
    min_rep_duration_sec: 0.2,
    guidance: {
      framing:
        'Position one hand 35–55 cm in front of the camera with good lighting and an uncluttered background.',
      calibration_instruction:
        'Hold your palm open and steady facing the camera for 3 seconds to normalize palm scale and finger aperture.',
      steps: [
        'Start with palm neutral and thumb & index finger comfortably open (~70–90% aperture).',
        'Flex the index MCP/PIP joints and touch thumb tip (#4) cleanly to index tip (#8).',
        'Open smoothly back to the starting neutral aperture to complete each pinch cycle.',
      ],
      form_cues:
        'Keep the wrist aligned vertically with the forearm to avoid Excessive Wrist Deviation alerts.',
    },
  },
};

const PATIENT_PROFILES = [
  { id: 'PT-1042', label: 'PT-1042 · Knee ACL Rehab' },
  { id: 'PT-2088', label: 'PT-2088 · Carpal Tunnel Dexterity' },
  { id: 'PT-3015', label: 'PT-3015 · Rotator Cuff Recovery' },
];

const INITIAL_METRICS = {
  status: 'initializing',
  tracker: 'pose',
  limb_side: 'Left',
  smoothed_angle: 0,
  pinch_distance_mm: 0,
  pinch_aperture: 0,
  pinch_min_mm: 0,
  pinch_max_mm: 0,
  reps: 0,
  jerk_score: 0.0,
  rom_max: 0,
  rom_min: 0,
  dtw_consistency: 100,
  compensation_events: 0,
  rep_history: [],
  fatigue: null,
  alerts: [],
};

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm';
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

function escapeCsvCell(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function App() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const visionRef = useRef(null);
  const poseLandmarkerRef = useRef(null);
  const handLandmarkerRef = useRef(null);
  const loadingTrackerRef = useRef(null);
  const requestRef = useRef(null);
  const wsRef = useRef(null);
  const fallbackAnalyzerRef = useRef(
    new PatientSessionAnalyzer(DEFAULT_EXERCISES.knee_flexion)
  );
  const wsTelemetryStatusRef = useRef(null);
  const lastWsTelemetryAtRef = useRef(0);
  const highestRepCountRef = useRef(0);
  const lastStreamPushAtRef = useRef(0);

  const sessionLogRef = useRef([]);

  const [currentView, setCurrentView] = useState('patient');
  const [historyTrigger, setHistoryTrigger] = useState(0);
  const [exercises, setExercises] = useState(DEFAULT_EXERCISES);
  const [selectedExerciseKey, setSelectedExerciseKey] = useState('knee_flexion');
  const [patientId, setPatientId] = useState('PT-1042');
  const [targetReps, setTargetReps] = useState(10);
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [isPaused, setIsPaused] = useState(false);

  const [webcamKey, setWebcamKey] = useState(0);
  const [wsReconnectNonce, setWsReconnectNonce] = useState(0);
  const [cameraStream, setCameraStream] = useState({
    status: 'initializing',
    deviceLabel: '',
    resolution: '',
    fps: 0,
    errorMessage: '',
    muted: false,
  });
  const [sensorStream, setSensorStream] = useState({
    wsStatus: 'connecting',
    modelStatus: 'loading',
    modelError: '',
    subjectDetected: false,
    packetRateHz: 0,
    lastPacketAgeSec: null,
  });

  const cameraTrackRef = useRef(null);
  const streamCountersRef = useRef({
    videoFrames: 0,
    lastVideoTime: -1,
    packets: 0,
    lastPacketMs: null,
    lastLandmarkMs: null,
    lastFlushMs: 0,
  });

  const [clinicalMetrics, setClinicalMetrics] = useState(INITIAL_METRICS);
  const [telemetrySeries, setTelemetrySeries] = useState([]);
  const [telemetryCount, setTelemetryCount] = useState(0);
  const [sessionStartTime, setSessionStartTime] = useState(() => Date.now());
  const [calibrationState, setCalibrationState] = useState(() =>
    createInitialCalibrationState('pose')
  );
  const [customSafetyLimits, setCustomSafetyLimits] = useState(null);
  const [thresholdMonitoringEnabled, setThresholdMonitoringEnabled] = useState(false);
  const [audioAlertEnabled, setAudioAlertEnabled] = useState(true);
  const [breachStats, setBreachStats] = useState({
    upperCount: 0,
    lowerCount: 0,
    lastEvent: '',
  });
  const [limbSide, setLimbSide] = useState('Left');
  const [involvedSide, setInvolvedSide] = useState('Left');
  const [prescriptionsByKey, setPrescriptionsByKey] = useState({});
  const [completedSets, setCompletedSets] = useState(0);
  const [patientSessions, setPatientSessions] = useState([]);
  const [adherenceCounters, setAdherenceCounters] = useState({
    totalFrames: 0,
    safeZoneFrames: 0,
  });

  const calibrationRef = useRef({
    status: 'calibrating',
    step: 1,
    holdStartMs: null,
    manualHoldActive: false,
    samples: [],
    profile: null,
    lastUiSyncMs: 0,
    lastFeedback: '',
  });
  const latestLandmarksRef = useRef({ tracker: null, landmarks: null });
  const manualHoldTimerRef = useRef(null);

  const activeExercise = exercises[selectedExerciseKey] || DEFAULT_EXERCISES.knee_flexion;
  const activePrescription =
    prescriptionsByKey[selectedExerciseKey] || getDefaultPrescription(activeExercise);
  const adherenceMetrics = computeAdherenceMetrics({
    totalFrames: adherenceCounters.totalFrames,
    safeZoneFrames: adherenceCounters.safeZoneFrames,
    compensationEvents: clinicalMetrics.compensation_events || 0,
    reps: clinicalMetrics.reps || 0,
    prescription: activePrescription,
  });
  const safetyLimits = customSafetyLimits || getDefaultSafetyLimits(activeExercise);
  const monitoredSignal =
    (clinicalMetrics.tracker || activeExercise.tracker) === 'hands'
      ? clinicalMetrics.pinch_aperture || 0
      : clinicalMetrics.smoothed_angle || 0;
  const thresholdStatus = evaluateRomThreshold(
    monitoredSignal,
    safetyLimits,
    clinicalMetrics.status,
    thresholdMonitoringEnabled
  );

  const activeExerciseRef = useRef(activeExercise);
  const selectedExerciseKeyRef = useRef(selectedExerciseKey);
  const limbSideRef = useRef(limbSide);
  const activePrescriptionRef = useRef(activePrescription);
  const isPausedRef = useRef(isPaused);
  const voiceEnabledRef = useRef(voiceEnabled);
  const targetRepsRef = useRef(targetReps);
  const targetGoalSpokenRef = useRef(false);
  const safetyLimitsRef = useRef(safetyLimits);
  const thresholdMonitoringEnabledRef = useRef(thresholdMonitoringEnabled);
  const audioAlertEnabledRef = useRef(audioAlertEnabled);
  const thresholdStatusRef = useRef(thresholdStatus);
  const audioCtxRef = useRef(null);
  const lastToneTimeRef = useRef(0);
  const lastBreachStateRef = useRef('standby');

  useEffect(() => {
    activeExerciseRef.current = activeExercise;
    selectedExerciseKeyRef.current = selectedExerciseKey;
  }, [activeExercise, selectedExerciseKey]);

  useEffect(() => {
    limbSideRef.current = limbSide;
  }, [limbSide]);

  useEffect(() => {
    activePrescriptionRef.current = activePrescription;
  }, [activePrescription]);

  useEffect(() => {
    safetyLimitsRef.current = safetyLimits;
  }, [safetyLimits]);

  useEffect(() => {
    thresholdMonitoringEnabledRef.current = thresholdMonitoringEnabled;
  }, [thresholdMonitoringEnabled]);

  useEffect(() => {
    audioAlertEnabledRef.current = audioAlertEnabled;
  }, [audioAlertEnabled]);

  useEffect(() => {
    thresholdStatusRef.current = thresholdStatus;
  }, [thresholdStatus]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
    if (!voiceEnabled && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, [voiceEnabled]);

  useEffect(() => {
    targetRepsRef.current = targetReps;
    targetGoalSpokenRef.current = false;
  }, [targetReps]);

  // Voice AI
  const lastSpeechTime = useRef(0);
  const lastAlertSpoken = useRef('');

  const speakFeedback = useCallback((text) => {
    if (!voiceEnabledRef.current) return;
    const now = Date.now();
    if (now - lastSpeechTime.current < 3000) return;
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.1;
      window.speechSynthesis.speak(utterance);
      lastSpeechTime.current = now;
    }
  }, []);

  // Unified telemetry ingestion so BOTH WebSocket frames AND local fallback frames feed the live kinematic stream chart
  const ingestTelemetryMetrics = useCallback(
    (rawMetrics, source = 'ws') => {
      if (!rawMetrics) return;

      const reps = Math.max(
        Number(rawMetrics.reps || 0),
        fallbackAnalyzerRef.current.repCount || 0,
        highestRepCountRef.current
      );
      highestRepCountRef.current = reps;
      const metrics = { ...rawMetrics, reps };
      setClinicalMetrics(metrics);

      const activeLimits = safetyLimitsRef.current;
      const isHands = (metrics.tracker || activeExerciseRef.current.tracker) === 'hands';
      const sigVal = isHands
        ? Number(metrics.pinch_aperture || 0)
        : Number(metrics.smoothed_angle || 0);
      const evalThreshold = evaluateRomThreshold(
        sigVal,
        activeLimits,
        metrics.status,
        thresholdMonitoringEnabledRef.current
      );

      // Push stream points whenever tracking OR buffering with valid signal so Live Kinematic Stream never stalls
      const hasLiveSignal =
        metrics.status === 'tracking' ||
        (metrics.status === 'buffering' &&
          (sigVal > 0 || Number(metrics.pinch_distance_mm || 0) > 0));

      const nowPerf = performance.now();
      if (hasLiveSignal && nowPerf - lastStreamPushAtRef.current >= 30) {
        lastStreamPushAtRef.current = nowPerf;
        const nowMs = Date.now();
        const rx = activePrescriptionRef.current;
        const safeZoneOk =
          sigVal >= rx.safeMin &&
          sigVal <= rx.safeMax &&
          (!metrics.alerts || metrics.alerts.length === 0);

        setAdherenceCounters((prev) => ({
          totalFrames: prev.totalFrames + 1,
          safeZoneFrames: prev.safeZoneFrames + (safeZoneOk ? 1 : 0),
        }));

        const point = {
          time: nowMs,
          source,
          protocol: selectedExerciseKeyRef.current,
          limbSide: limbSideRef.current,
          angle: Number(metrics.smoothed_angle || 0),
          smoothed_angle: Number(metrics.smoothed_angle || 0),
          pinchAperture: Number(metrics.pinch_aperture || 0),
          pinch_aperture: Number(metrics.pinch_aperture || 0),
          pinchMm: Number(metrics.pinch_distance_mm || 0),
          reps: metrics.reps,
          jerk: Number(metrics.jerk_score || 0),
          dtw: Number(metrics.dtw_consistency ?? 100),
          thresholdState: evalThreshold.state,
          safeZoneOk,
          fatigueSummary: metrics.fatigue?.summary || '',
          alerts: (metrics.alerts || []).join(' | '),
        };

        sessionLogRef.current.push(point);
        setTelemetryCount(sessionLogRef.current.length);
        setTelemetrySeries((prev) => {
          const next = [...prev, point];
          return next.length > 100 ? next.slice(-100) : next;
        });

        if (metrics.status === 'tracking' && evalThreshold.severity === 'critical') {
          if (lastBreachStateRef.current !== evalThreshold.state) {
            const timeLabel = new Date(nowMs).toLocaleTimeString([], {
              hour12: false,
            });
            setBreachStats((prev) => ({
              upperCount:
                prev.upperCount + (evalThreshold.state === 'exceeded_max' ? 1 : 0),
              lowerCount:
                prev.lowerCount + (evalThreshold.state === 'below_min' ? 1 : 0),
              lastEvent: `${evalThreshold.label} (${evalThreshold.value}${activeLimits.unit} @ ${timeLabel})`,
            }));
            speakFeedback(
              evalThreshold.state === 'exceeded_max'
                ? 'Caution. Range of motion exceeded maximum safety limit.'
                : 'Caution. Range of motion fell below minimum safety limit.'
            );
          }

          if (
            audioAlertEnabledRef.current &&
            nowMs - lastToneTimeRef.current >= 1200
          ) {
            playThresholdAlertTone(evalThreshold.state, audioCtxRef);
            lastToneTimeRef.current = nowMs;
          }
        }
        if (metrics.status === 'tracking') {
          lastBreachStateRef.current = evalThreshold.state;
        }
      }

      if (
        reps > 0 &&
        reps >= targetRepsRef.current &&
        !targetGoalSpokenRef.current
      ) {
        targetGoalSpokenRef.current = true;
        speakFeedback(`Target of ${targetRepsRef.current} repetitions reached.`);
      } else if (reps > 0 && reps % 5 === 0) {
        speakFeedback(`${reps} repetitions completed.`);
      }

      if (metrics.alerts && metrics.alerts.length > 0) {
        const currentAlert = metrics.alerts[0];
        if (currentAlert !== lastAlertSpoken.current) {
          speakFeedback(`Warning: ${currentAlert}`);
          lastAlertSpoken.current = currentAlert;
        }
      } else {
        lastAlertSpoken.current = '';
      }
    },
    [speakFeedback]
  );

  const syncCalibrationUi = useCallback((next, force = false) => {
    const now = performance.now();
    const ref = calibrationRef.current;
    if (
      !force &&
      now - ref.lastUiSyncMs < 100 &&
      next.status === ref.status &&
      next.step === ref.step &&
      next.feedback === ref.lastFeedback
    ) {
      return;
    }
    ref.lastUiSyncMs = now;
    ref.lastFeedback = next.feedback;
    setCalibrationState({
      status: next.status,
      step: next.step,
      progressSec: next.progressSec,
      durationSec: CALIBRATION_DURATION_SEC,
      feedback: next.feedback,
      profile: next.profile,
    });
  }, []);

  const clearManualHoldTimer = useCallback(() => {
    if (manualHoldTimerRef.current) {
      clearInterval(manualHoldTimerRef.current);
      manualHoldTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearManualHoldTimer();
    };
  }, [clearManualHoldTimer]);

  const startCalibration = useCallback(
    (trackerType, customFeedback) => {
      clearManualHoldTimer();
      const initial = createInitialCalibrationState(trackerType);
      const feedback = customFeedback || initial.feedback;
      calibrationRef.current = {
        status: 'calibrating',
        step: 1,
        holdStartMs: null,
        manualHoldActive: false,
        samples: [],
        profile: null,
        lastUiSyncMs: 0,
        lastFeedback: feedback,
      };
      setCalibrationState({ ...initial, feedback });
    },
    [clearManualHoldTimer]
  );

  const finalizeCalibration = useCallback(
    (trackerType, allowFallback = true) => {
      clearManualHoldTimer();
      const cal = calibrationRef.current;
      const samples = [...cal.samples];

      if (
        samples.length === 0 &&
        latestLandmarksRef.current.tracker === trackerType &&
        latestLandmarksRef.current.landmarks
      ) {
        const snap = extractCalibrationSample(
          latestLandmarksRef.current.landmarks,
          trackerType
        );
        if (snap) samples.push(snap);
      }

      let profile = computeNormalizationProfile(samples, trackerType);
      if (!profile && allowFallback) {
        profile = {
          skipped: true,
          manualFallback: true,
          tracker: trackerType,
          calibratedAt: new Date().toISOString(),
          sampleCount: 0,
          scale: trackerType === 'hands' ? 0.16 : 0.28,
        };
      }
      if (!profile) return false;

      cal.status = 'calibrated';
      cal.step = 3;
      cal.holdStartMs = null;
      cal.manualHoldActive = false;
      cal.profile = profile;

      const feedback = profile.manualFallback
        ? 'Baseline calibration active. Live tracking started.'
        : 'Coordinates normalized. Tracking active.';

      syncCalibrationUi(
        {
          status: 'calibrated',
          step: 3,
          progressSec: CALIBRATION_DURATION_SEC,
          feedback,
          profile,
        },
        true
      );
      speakFeedback('Calibration complete. Begin exercise.');
      fallbackAnalyzerRef.current.reset();
      highestRepCountRef.current = 0;
      lastStreamPushAtRef.current = 0;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'reset_session' }));
      }
      return true;
    },
    [clearManualHoldTimer, speakFeedback, syncCalibrationUi]
  );

  useEffect(() => {
    const fetchExercises = async () => {
      try {
        const res = await fetch(getApiUrl('/api/exercises'));
        if (res.ok) {
          const data = await res.json();
          if (data && Object.keys(data).length > 0) {
            setExercises(data);
          }
        }
      } catch (err) {
        console.error('Failed to load exercise library:', err);
      }
    };
    fetchExercises();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadPrescriptions = async () => {
      try {
        const res = await fetch(
          getApiUrl(`/api/prescriptions/${encodeURIComponent(patientId)}`)
        );
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data && typeof data === 'object') {
            setPrescriptionsByKey(data);
          }
        }
      } catch (err) {
        console.error('Failed to load patient prescriptions:', err);
      }
    };
    loadPrescriptions();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const detachCameraTrackListeners = useCallback(() => {
    const prev = cameraTrackRef.current;
    if (prev && prev.track) {
      prev.track.removeEventListener('ended', prev.onEnded);
      prev.track.removeEventListener('mute', prev.onMute);
      prev.track.removeEventListener('unmute', prev.onUnmute);
    }
    cameraTrackRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      detachCameraTrackListeners();
    };
  }, [detachCameraTrackListeners]);

  const handleUserMedia = useCallback(
    (stream) => {
      detachCameraTrackListeners();
      const videoTrack = stream?.getVideoTracks?.()[0];
      const settings = videoTrack?.getSettings ? videoTrack.getSettings() : {};
      const resolution =
        settings.width && settings.height ? `${settings.width}×${settings.height}` : '';

      setCameraStream((prev) => ({
        ...prev,
        status: videoTrack && videoTrack.readyState === 'ended' ? 'disconnected' : 'live',
        deviceLabel: videoTrack?.label || 'Camera Input',
        resolution: resolution || prev.resolution,
        errorMessage: '',
        muted: Boolean(videoTrack?.muted),
      }));

      if (videoTrack) {
        const onEnded = () => {
          setCameraStream((prev) => ({
            ...prev,
            status: 'disconnected',
            fps: 0,
            errorMessage: 'Camera feed disconnected.',
          }));
        };
        const onMute = () => {
          setCameraStream((prev) => ({ ...prev, muted: true }));
        };
        const onUnmute = () => {
          setCameraStream((prev) => ({ ...prev, muted: false, status: 'live', errorMessage: '' }));
        };
        videoTrack.addEventListener('ended', onEnded);
        videoTrack.addEventListener('mute', onMute);
        videoTrack.addEventListener('unmute', onUnmute);
        cameraTrackRef.current = { track: videoTrack, onEnded, onMute, onUnmute };
      }
    },
    [detachCameraTrackListeners]
  );

  const handleUserMediaError = useCallback(
    (err) => {
      detachCameraTrackListeners();
      const errName = typeof err === 'string' ? err : err?.name || '';
      const isDenied =
        errName === 'NotAllowedError' || errName === 'PermissionDeniedError';
      const isMissing =
        errName === 'NotFoundError' || errName === 'DevicesNotFoundError';

      setCameraStream((prev) => ({
        ...prev,
        status: isDenied ? 'denied' : isMissing ? 'disconnected' : 'error',
        fps: 0,
        muted: false,
        errorMessage: isDenied
          ? 'Camera permission blocked in browser settings.'
          : isMissing
          ? 'No camera device detected.'
          : err?.message || 'Unable to access camera stream.',
      }));
    },
    [detachCameraTrackListeners]
  );

  const handleRetryCamera = useCallback(() => {
    detachCameraTrackListeners();
    setCameraStream({
      status: 'initializing',
      deviceLabel: '',
      resolution: '',
      fps: 0,
      errorMessage: '',
      muted: false,
    });
    setWebcamKey((k) => k + 1);
  }, [detachCameraTrackListeners]);

  const handleReconnectSensor = useCallback(() => {
    setSensorStream((prev) => ({ ...prev, wsStatus: 'reconnecting' }));
    setWsReconnectNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    streamCountersRef.current.lastFlushMs = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      const counters = streamCountersRef.current;
      const elapsedSec = Math.max(0.25, (now - counters.lastFlushMs) / 1000);
      const fps = counters.videoFrames / elapsedSec;
      const packetRateHz = counters.packets / elapsedSec;
      const subjectDetected =
        counters.lastLandmarkMs !== null && now - counters.lastLandmarkMs < 1500;
      const lastPacketAgeSec =
        counters.lastPacketMs !== null ? (now - counters.lastPacketMs) / 1000 : null;

      counters.videoFrames = 0;
      counters.packets = 0;
      counters.lastFlushMs = now;

      const video = webcamRef.current?.video;
      const liveResolution =
        video && video.videoWidth && video.videoHeight
          ? `${video.videoWidth}×${video.videoHeight}`
          : '';

      setCameraStream((prev) => {
        const nextResolution = liveResolution || prev.resolution;
        const roundedFps = Number(fps.toFixed(1));
        if (prev.fps === roundedFps && prev.resolution === nextResolution) {
          return prev;
        }
        return {
          ...prev,
          fps: prev.status === 'live' ? roundedFps : 0,
          resolution: nextResolution,
        };
      });

      setSensorStream((prev) => {
        const roundedHz = Number(packetRateHz.toFixed(1));
        const roundedAge =
          lastPacketAgeSec !== null ? Number(lastPacketAgeSec.toFixed(1)) : null;
        if (
          prev.packetRateHz === roundedHz &&
          prev.subjectDetected === subjectDetected &&
          prev.lastPacketAgeSec === roundedAge
        ) {
          return prev;
        }
        return {
          ...prev,
          packetRateHz: roundedHz,
          subjectDetected,
          lastPacketAgeSec: roundedAge,
        };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const ensureTrackerLoaded = useCallback(async (trackerType) => {
    if (trackerType === 'pose' && poseLandmarkerRef.current) {
      setSensorStream((prev) => ({ ...prev, modelStatus: 'ready', modelError: '' }));
      return;
    }
    if (trackerType === 'hands' && handLandmarkerRef.current) {
      setSensorStream((prev) => ({ ...prev, modelStatus: 'ready', modelError: '' }));
      return;
    }
    if (loadingTrackerRef.current === trackerType) return;

    loadingTrackerRef.current = trackerType;
    setSensorStream((prev) => ({ ...prev, modelStatus: 'loading', modelError: '' }));

    try {
      if (!visionRef.current) {
        visionRef.current = await FilesetResolver.forVisionTasks(WASM_CDN);
      }
      if (trackerType === 'hands') {
        handLandmarkerRef.current = await HandLandmarker.createFromOptions(visionRef.current, {
          baseOptions: { modelAssetPath: HAND_MODEL_URL },
          runningMode: 'VIDEO',
          numHands: 1,
        });
      } else {
        poseLandmarkerRef.current = await PoseLandmarker.createFromOptions(visionRef.current, {
          baseOptions: { modelAssetPath: POSE_MODEL_URL },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      }
      setSensorStream((prev) => ({ ...prev, modelStatus: 'ready', modelError: '' }));
    } catch (err) {
      console.error(`Failed to initialize ${trackerType} landmarker:`, err);
      setSensorStream((prev) => ({
        ...prev,
        modelStatus: 'error',
        modelError: err?.message || `Failed to load ${trackerType} vision sensor.`,
      }));
    } finally {
      if (loadingTrackerRef.current === trackerType) {
        loadingTrackerRef.current = null;
      }
    }
  }, []);

  const handleExerciseChange = (nextKey) => {
    const nextConfig = exercises[nextKey] || DEFAULT_EXERCISES[nextKey];
    if (!nextConfig) return;

    const nextRx = prescriptionsByKey[nextKey] || getDefaultPrescription(nextConfig);
    setSelectedExerciseKey(nextKey);
    fallbackAnalyzerRef.current.setConfig(nextConfig);
    fallbackAnalyzerRef.current.setSide(limbSideRef.current);
    highestRepCountRef.current = 0;
    lastStreamPushAtRef.current = 0;
    setTargetReps(nextRx.targetReps || 10);
    setCompletedSets(0);
    setClinicalMetrics({
      ...INITIAL_METRICS,
      tracker: nextConfig.tracker,
      limb_side: limbSideRef.current,
    });
    setTelemetrySeries([]);
    setTelemetryCount(0);
    setSessionStartTime(Date.now());
    setCustomSafetyLimits(null);
    setThresholdMonitoringEnabled(false);
    setBreachStats({ upperCount: 0, lowerCount: 0, lastEvent: '' });
    setAdherenceCounters({ totalFrames: 0, safeZoneFrames: 0 });
    lastBreachStateRef.current = 'disabled';
    sessionLogRef.current = [];
    lastAlertSpoken.current = '';
    targetGoalSpokenRef.current = false;
    wsTelemetryStatusRef.current = null;
    lastWsTelemetryAtRef.current = 0;
    startCalibration(nextConfig.tracker);

    ensureTrackerLoaded(nextConfig.tracker);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'select_exercise',
          exercise_key: nextKey,
          exercise_id: nextConfig.id,
          limb_side: limbSideRef.current,
        })
      );
    }
  };

  const resetCurrentTelemetry = () => {
    fallbackAnalyzerRef.current.setConfig(activeExerciseRef.current);
    fallbackAnalyzerRef.current.setSide(limbSideRef.current);
    highestRepCountRef.current = 0;
    lastStreamPushAtRef.current = 0;
    setClinicalMetrics({
      ...INITIAL_METRICS,
      tracker: activeExercise.tracker,
      limb_side: limbSideRef.current,
    });
    setTelemetrySeries([]);
    setTelemetryCount(0);
    setSessionStartTime(Date.now());
    setBreachStats({ upperCount: 0, lowerCount: 0, lastEvent: '' });
    setAdherenceCounters({ totalFrames: 0, safeZoneFrames: 0 });
    lastBreachStateRef.current = 'standby';
    sessionLogRef.current = [];
    lastAlertSpoken.current = '';
    targetGoalSpokenRef.current = false;
    wsTelemetryStatusRef.current = null;
    lastWsTelemetryAtRef.current = 0;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'reset_session' }));
    }
  };

  const handleLimbSideChange = (nextSide) => {
    if (!['Left', 'Right', 'Bilateral'].includes(nextSide)) return;
    setLimbSide(nextSide);
    limbSideRef.current = nextSide;
    fallbackAnalyzerRef.current.setSide(nextSide);
    highestRepCountRef.current = 0;
    lastStreamPushAtRef.current = 0;
    setClinicalMetrics({
      ...INITIAL_METRICS,
      tracker: activeExercise.tracker,
      limb_side: nextSide,
    });
    setTelemetrySeries([]);
    setTelemetryCount(0);
    setSessionStartTime(Date.now());
    setBreachStats({ upperCount: 0, lowerCount: 0, lastEvent: '' });
    setAdherenceCounters({ totalFrames: 0, safeZoneFrames: 0 });
    lastBreachStateRef.current = 'standby';
    sessionLogRef.current = [];
    lastAlertSpoken.current = '';
    targetGoalSpokenRef.current = false;
    wsTelemetryStatusRef.current = null;
    lastWsTelemetryAtRef.current = 0;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'select_side',
          limb_side: nextSide,
        })
      );
    }
  };

  const handlePatientChange = (nextPatientId) => {
    setPatientId(nextPatientId);
    setCompletedSets(0);
    resetCurrentTelemetry();
  };

  const handleSavePrescription = async (nextRx) => {
    try {
      const res = await fetch(getApiUrl('/api/prescriptions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          exercise_key: selectedExerciseKey,
          targetSets: nextRx.targetSets,
          targetReps: nextRx.targetReps,
          safeMin: nextRx.safeMin,
          safeMax: nextRx.safeMax,
          maxCompensations: nextRx.maxCompensations,
          involvedSide: nextRx.involvedSide,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const saved = data.prescription || {
          ...nextRx,
          updatedAt: new Date().toISOString(),
        };
        setPrescriptionsByKey((prev) => ({
          ...prev,
          [selectedExerciseKey]: saved,
        }));
      } else {
        setPrescriptionsByKey((prev) => ({
          ...prev,
          [selectedExerciseKey]: {
            ...nextRx,
            updatedAt: new Date().toISOString(),
          },
        }));
      }
    } catch (err) {
      console.error('Error saving prescription:', err);
      setPrescriptionsByKey((prev) => ({
        ...prev,
        [selectedExerciseKey]: {
          ...nextRx,
          updatedAt: new Date().toISOString(),
        },
      }));
    }

    setTargetReps(nextRx.targetReps);
    if (nextRx.involvedSide === 'Left' || nextRx.involvedSide === 'Right') {
      setInvolvedSide(nextRx.involvedSide);
    }
    setAdherenceCounters({ totalFrames: 0, safeZoneFrames: 0 });
  };

  const handleSyncPrescriptionToThresholds = (minVal, maxVal) => {
    handleApplySafetyLimits(
      {
        ...safetyLimits,
        min: minVal,
        max: maxVal,
      },
      true
    );
  };

  const handleApplySafetyLimits = (nextLimits, armMonitoring = true) => {
    setCustomSafetyLimits(nextLimits);
    setThresholdMonitoringEnabled(armMonitoring);
    setBreachStats({ upperCount: 0, lowerCount: 0, lastEvent: '' });
    lastBreachStateRef.current = armMonitoring ? 'standby' : 'disabled';
  };

  const handleSetThresholdMonitoringEnabled = (enabled) => {
    setThresholdMonitoringEnabled(enabled);
    lastBreachStateRef.current = enabled ? 'standby' : 'disabled';
  };

  const handleResetSafetyLimits = () => {
    const defaults = getDefaultSafetyLimits(activeExercise);
    setCustomSafetyLimits(null);
    setThresholdMonitoringEnabled(false);
    setBreachStats({ upperCount: 0, lowerCount: 0, lastEvent: '' });
    lastBreachStateRef.current = 'disabled';
    return defaults;
  };

  const handleRecalibrate = () => {
    resetCurrentTelemetry();
    startCalibration(activeExercise.tracker);
  };

  const handleSelectCalibrationStep = (stepId) => {
    const trackerType = activeExercise.tracker || 'pose';
    const isHands = trackerType === 'hands';

    if (stepId === 1) {
      startCalibration(
        trackerType,
        isHands
          ? 'Step 1 active — frame your open hand clearly, then click Step 2.'
          : 'Step 1 active — center your body in frame, then click Step 2.'
      );
      return;
    }

    if (stepId === 2) {
      clearManualHoldTimer();
      const startMs = performance.now();
      const initialSamples = [];
      if (
        latestLandmarksRef.current.tracker === trackerType &&
        latestLandmarksRef.current.landmarks
      ) {
        const snap = extractCalibrationSample(
          latestLandmarksRef.current.landmarks,
          trackerType
        );
        if (snap) initialSamples.push(snap);
      }

      const holdPrompt = isHands
        ? 'Hold open palm steady for 3.0s...'
        : 'Hold T-pose steady for 3.0s...';

      calibrationRef.current = {
        status: 'calibrating',
        step: 2,
        holdStartMs: startMs,
        manualHoldActive: true,
        samples: initialSamples,
        profile: null,
        lastUiSyncMs: startMs,
        lastFeedback: holdPrompt,
      };
      setCalibrationState({
        status: 'calibrating',
        step: 2,
        progressSec: 0,
        durationSec: CALIBRATION_DURATION_SEC,
        feedback: holdPrompt,
        profile: null,
      });

      manualHoldTimerRef.current = setInterval(() => {
        const cal = calibrationRef.current;
        if (!cal.manualHoldActive || cal.status === 'calibrated') {
          clearManualHoldTimer();
          return;
        }
        const elapsedSec = (performance.now() - startMs) / 1000;
        if (elapsedSec >= CALIBRATION_DURATION_SEC) {
          finalizeCalibration(trackerType, true);
          return;
        }
        const remaining = Math.max(0.1, CALIBRATION_DURATION_SEC - elapsedSec).toFixed(1);
        setCalibrationState({
          status: 'calibrating',
          step: 2,
          progressSec: elapsedSec,
          durationSec: CALIBRATION_DURATION_SEC,
          feedback: isHands
            ? `Holding open palm... ${remaining}s remaining`
            : `Holding T-pose... ${remaining}s remaining`,
          profile: null,
        });
      }, 100);
      return;
    }

    if (stepId === 3) {
      finalizeCalibration(trackerType, true);
    }
  };

  const handleSkipCalibration = () => {
    clearManualHoldTimer();
    const skippedProfile = { skipped: true };
    calibrationRef.current = {
      status: 'calibrated',
      step: 3,
      holdStartMs: null,
      manualHoldActive: false,
      samples: [],
      profile: skippedProfile,
      lastUiSyncMs: performance.now(),
      lastFeedback: 'Direct tracking active.',
    };
    setCalibrationState({
      status: 'calibrated',
      step: 3,
      progressSec: CALIBRATION_DURATION_SEC,
      durationSec: CALIBRATION_DURATION_SEC,
      feedback: 'Direct tracking active.',
      profile: skippedProfile,
    });
    resetCurrentTelemetry();
  };

  const exportSessionCSV = () => {
    const rows = sessionLogRef.current;
    const t0 = rows.length > 0 ? rows[0].time : Date.now();
    const isHands = activeExercise.tracker === 'hands';
    const rxSummary = formatPrescriptionSummary(activePrescription, isHands ? '%' : '°');
    const fatigueSummary = clinicalMetrics.fatigue?.summary || 'Collecting baseline';

    const csvHeader =
      'Timestamp_ISO,Elapsed_s,Patient_ID,Protocol_ID,Protocol_Name,Limb_Side,Smoothed_Angle_deg,Pinch_Aperture_pct,Pinch_Distance_mm,Rep_Count,Jerk_RMS,DTW_Form_Match_pct,Threshold_State,Safe_Zone_Frame,Adherence_Score_pct,Safe_Zone_pct,Fatigue_Insight,Prescription_Target,Compensation_Alerts\n';

    const sourceRows =
      rows.length > 0
        ? rows
        : [
            {
              time: Date.now(),
              limbSide,
              angle: clinicalMetrics.smoothed_angle || 0,
              pinchAperture: clinicalMetrics.pinch_aperture || 0,
              pinchMm: clinicalMetrics.pinch_distance_mm || 0,
              reps: clinicalMetrics.reps || 0,
              jerk: clinicalMetrics.jerk_score || 0,
              dtw: clinicalMetrics.dtw_consistency ?? 100,
              thresholdState: thresholdStatus.state,
              safeZoneOk: true,
              fatigueSummary,
              alerts: (clinicalMetrics.alerts || []).join(' | '),
            },
          ];

    const csvBody = sourceRows
      .map((row) =>
        [
          new Date(row.time).toISOString(),
          ((row.time - t0) / 1000).toFixed(2),
          patientId,
          activeExercise.id,
          activeExercise.name,
          row.limbSide || limbSide,
          row.angle,
          row.pinchAperture ?? 0,
          row.pinchMm ?? 0,
          row.reps,
          row.jerk,
          row.dtw,
          row.thresholdState || 'nominal',
          row.safeZoneOk ? 'YES' : 'NO',
          adherenceMetrics.adherenceScore,
          adherenceMetrics.safeZonePct,
          row.fatigueSummary || fatigueSummary,
          rxSummary,
          row.alerts || '',
        ]
          .map(escapeCsvCell)
          .join(',')
      )
      .join('\n');

    const blob = new Blob([csvHeader + csvBody], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `kinematic_${selectedExerciseKey}_${limbSide.toLowerCase()}_${patientId}_${Date.now()}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return rows.length;
  };

  const saveAndResetSession = async () => {
    if (sessionLogRef.current.length > 0) {
      exportSessionCSV();
    }

    const isHands = activeExercise.tracker === 'hands';
    const romExcursion = Math.max(
      0,
      Number(((clinicalMetrics.rom_max || 0) - (clinicalMetrics.rom_min || 0)).toFixed(1))
    );
    const rxSummary = formatPrescriptionSummary(activePrescription, isHands ? '%' : '°');

    try {
      await fetch(getApiUrl('/api/save_session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          exercise_id: activeExercise.id,
          exercise_key: selectedExerciseKey,
          limbSide,
          leftMaxROM: clinicalMetrics.rom_max,
          rightMaxROM: clinicalMetrics.rom_max,
          romMin: clinicalMetrics.rom_min,
          romExcursion,
          symmetryScore: clinicalMetrics.dtw_consistency,
          repCount: clinicalMetrics.reps,
          adherenceScore: adherenceMetrics.adherenceScore,
          safeZonePct: adherenceMetrics.safeZonePct,
          compensationCount: clinicalMetrics.compensation_events || 0,
          fatigueSeverity: clinicalMetrics.fatigue?.severity || 'neutral',
          fatigueSummary: clinicalMetrics.fatigue?.summary || '',
          romDeltaPct: clinicalMetrics.fatigue?.romDeltaPct || 0,
          prescriptionSummary: rxSummary,
          notes: clinicalNotes,
        }),
      });
      setHistoryTrigger((prev) => prev + 1);
      speakFeedback('Clinical session saved successfully. Research data exported.');
    } catch (error) {
      console.error('Error saving data:', error);
    }

    setClinicalNotes('');
    resetCurrentTelemetry();
  };

  const processLocalFrame = useCallback(
    (landmarks, tracker, exercise, exerciseKey, timestampMs) => {
      const profile = calibrationRef.current.profile;
      const outboundLandmarks =
        profile && !profile.skipped ? normalizeLandmarks(landmarks, profile) : landmarks;
      const localMetrics = fallbackAnalyzerRef.current.processFrame(
        outboundLandmarks,
        timestampMs / 1000
      );
      const ws = wsRef.current;
      const canSend =
        ws &&
        ws.readyState === WebSocket.OPEN &&
        ws.bufferedAmount <= MAX_WEBSOCKET_BUFFER_BYTES;

      if (canSend) {
        ws.send(
          JSON.stringify({
            type: 'skeleton_telemetry',
            tracker,
            exercise_key: exerciseKey,
            exercise_id: exercise.id,
            limb_side: limbSideRef.current,
            landmarks: outboundLandmarks,
          })
        );
      }

      const useLocalMetrics =
        !canSend ||
        wsTelemetryStatusRef.current === 'buffering' ||
        performance.now() - lastWsTelemetryAtRef.current > WEBSOCKET_STALE_AFTER_MS;

      if (useLocalMetrics) {
        ingestTelemetryMetrics(localMetrics, 'local');
      }
    },
    [ingestTelemetryMetrics]
  );

  const detectMovement = useCallback(
    function detectMovement() {
      const video = webcamRef.current?.video;
      const canvas = canvasRef.current;

      if (video && video.readyState === 4) {
        if (video.currentTime !== streamCountersRef.current.lastVideoTime) {
          streamCountersRef.current.lastVideoTime = video.currentTime;
          streamCountersRef.current.videoFrames += 1;
        }
      }

      if (!isPausedRef.current && video && video.readyState === 4 && canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const exercise = activeExerciseRef.current;
          const exKey = selectedExerciseKeyRef.current;
          const startTimeMs = performance.now();
          const isHands = exercise.tracker === 'hands';

          const runCalibrationCheck = (landmarks) => {
            const cal = calibrationRef.current;
            if (cal.status === 'calibrated') return true;

            if (cal.manualHoldActive) {
              if (!isHands && landmarks?.[11] && landmarks?.[12]) {
                const shoulderY =
                  ((landmarks[11].y + landmarks[12].y) / 2) * canvas.height;
                ctx.save();
                ctx.strokeStyle = 'rgba(134, 239, 172, 0.7)';
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 6]);
                ctx.beginPath();
                ctx.moveTo(0, shoulderY);
                ctx.lineTo(canvas.width, shoulderY);
                ctx.stroke();
                ctx.restore();
              }
              const sample = extractCalibrationSample(landmarks, isHands ? 'hands' : 'pose');
              if (sample) cal.samples.push(sample);
              return false;
            }

            const evalResult = isHands
              ? evaluateHandCalibrationPose(landmarks)
              : evaluateTPose(landmarks);

            if (!evalResult.valid) {
              if (!isHands && landmarks?.[11] && landmarks?.[12]) {
                const shoulderY =
                  ((landmarks[11].y + landmarks[12].y) / 2) * canvas.height;
                ctx.save();
                ctx.strokeStyle = 'rgba(134, 239, 172, 0.5)';
                ctx.lineWidth = 2;
                ctx.setLineDash([8, 6]);
                ctx.beginPath();
                ctx.moveTo(0, shoulderY);
                ctx.lineTo(canvas.width, shoulderY);
                ctx.stroke();
                ctx.restore();
              }

              cal.holdStartMs = null;
              cal.samples = [];
              cal.step = 1;
              syncCalibrationUi({
                status: 'calibrating',
                step: 1,
                progressSec: 0,
                feedback: evalResult.reason,
                profile: null,
              });
              return false;
            }

            if (cal.holdStartMs === null) {
              cal.holdStartMs = startTimeMs;
            }
            cal.samples.push(evalResult.sample);
            cal.step = 2;

            const elapsedSec = (startTimeMs - cal.holdStartMs) / 1000;
            if (elapsedSec >= CALIBRATION_DURATION_SEC) {
              return finalizeCalibration(isHands ? 'hands' : 'pose', true);
            }

            syncCalibrationUi({
              status: 'calibrating',
              step: 2,
              progressSec: elapsedSec,
              feedback: evalResult.reason,
              profile: null,
            });
            return false;
          };

          if (isHands && handLandmarkerRef.current) {
            const handResult = handLandmarkerRef.current.detectForVideo(video, startTimeMs);
            if (handResult.landmarks && handResult.landmarks.length > 0) {
              streamCountersRef.current.lastLandmarkMs = startTimeMs;
              const landmarks = handResult.landmarks[0];
              latestLandmarksRef.current = { tracker: 'hands', landmarks };
              const drawingUtils = new DrawingUtils(ctx);

              drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
                color: '#86EFAC',
                lineWidth: 2.5,
              });
              drawingUtils.drawLandmarks(landmarks, {
                color: '#34D399',
                radius: 3.5,
              });

              const thumbTip = landmarks[4];
              const indexTip = landmarks[8];
              if (thumbTip && indexTip) {
                const pinchColor =
                  thresholdStatusRef.current.severity === 'critical' ? '#FB7185' : '#F59E0B';
                ctx.save();
                ctx.strokeStyle = pinchColor;
                ctx.lineWidth = 2.5;
                ctx.setLineDash([5, 4]);
                ctx.beginPath();
                ctx.moveTo(thumbTip.x * canvas.width, thumbTip.y * canvas.height);
                ctx.lineTo(indexTip.x * canvas.width, indexTip.y * canvas.height);
                ctx.stroke();
                ctx.restore();
              }

              const calibrated = runCalibrationCheck(landmarks);
              if (calibrated) {
                processLocalFrame(landmarks, 'hands', exercise, exKey, startTimeMs);
              }
            } else if (
              calibrationRef.current.status !== 'calibrated' &&
              !calibrationRef.current.manualHoldActive
            ) {
              calibrationRef.current.holdStartMs = null;
              calibrationRef.current.samples = [];
              calibrationRef.current.step = 1;
              syncCalibrationUi({
                status: 'calibrating',
                step: 1,
                progressSec: 0,
                feedback: 'No hand detected — place one open hand inside the camera view.',
                profile: null,
              });
            }
          } else if (!isHands && poseLandmarkerRef.current) {
            const poseResult = poseLandmarkerRef.current.detectForVideo(video, startTimeMs);
            if (poseResult.landmarks && poseResult.landmarks.length > 0) {
              streamCountersRef.current.lastLandmarkMs = startTimeMs;
              const landmarks = poseResult.landmarks[0];
              latestLandmarksRef.current = { tracker: 'pose', landmarks };
              const drawingUtils = new DrawingUtils(ctx);

              drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
                color: '#34D399',
                lineWidth: 2.5,
              });
              drawingUtils.drawLandmarks(landmarks, {
                color: '#86EFAC',
                radius: 3.5,
              });

              const joints = getSideJoints(exercise, limbSideRef.current);
              if (
                joints.length === 3 &&
                landmarks[joints[0]] &&
                landmarks[joints[1]] &&
                landmarks[joints[2]]
              ) {
                const activeJointColor =
                  thresholdStatusRef.current.severity === 'critical'
                    ? '#FB7185'
                    : thresholdStatusRef.current.severity === 'warning'
                    ? '#FBBF24'
                    : '#86EFAC';
                ctx.save();
                ctx.strokeStyle = activeJointColor;
                ctx.lineWidth = thresholdStatusRef.current.severity === 'critical' ? 5 : 4;
                ctx.beginPath();
                ctx.moveTo(
                  landmarks[joints[0]].x * canvas.width,
                  landmarks[joints[0]].y * canvas.height
                );
                ctx.lineTo(
                  landmarks[joints[1]].x * canvas.width,
                  landmarks[joints[1]].y * canvas.height
                );
                ctx.lineTo(
                  landmarks[joints[2]].x * canvas.width,
                  landmarks[joints[2]].y * canvas.height
                );
                ctx.stroke();
                ctx.restore();
              }

              const calibrated = runCalibrationCheck(landmarks);
              if (calibrated) {
                processLocalFrame(landmarks, 'pose', exercise, exKey, startTimeMs);
              }
            } else if (
              calibrationRef.current.status !== 'calibrated' &&
              !calibrationRef.current.manualHoldActive
            ) {
              calibrationRef.current.holdStartMs = null;
              calibrationRef.current.samples = [];
              calibrationRef.current.step = 1;
              syncCalibrationUi({
                status: 'calibrating',
                step: 1,
                progressSec: 0,
                feedback: 'No pose detected — step back so full upper body and hips are visible.',
                profile: null,
              });
            }
          }
        }
      }

      requestRef.current = requestAnimationFrame(detectMovement);
    },
    [finalizeCalibration, processLocalFrame, syncCalibrationUi]
  );

  useEffect(() => {
    let isMounted = true;
    let reconnectTimer = null;
    let connectDelayTimer = null;
    let retryDelayMs = 1500;

    const connectWebSocket = () => {
      if (!isMounted) return;
      let ws;
      try {
        ws = new WebSocket(getWebSocketUrl());
      } catch {
        setSensorStream((prev) => ({ ...prev, wsStatus: 'disconnected' }));
        reconnectTimer = setTimeout(connectWebSocket, retryDelayMs);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMounted) {
          ws.close();
          return;
        }
        retryDelayMs = 1500;
        wsTelemetryStatusRef.current = null;
        lastWsTelemetryAtRef.current = 0;
        setSensorStream((prev) => ({ ...prev, wsStatus: 'connected' }));
        ws.send(
          JSON.stringify({
            type: 'select_exercise',
            exercise_key: selectedExerciseKeyRef.current,
            exercise_id: activeExerciseRef.current.id,
            limb_side: limbSideRef.current,
          })
        );
      };

      ws.onerror = () => {
        if (isMounted) {
          setSensorStream((prev) => ({ ...prev, wsStatus: 'disconnected' }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'clinical_telemetry' && data.metrics) {
            streamCountersRef.current.packets += 1;
            streamCountersRef.current.lastPacketMs = performance.now();
            wsTelemetryStatusRef.current = data.metrics.status || null;
            lastWsTelemetryAtRef.current = performance.now();
            ingestTelemetryMetrics(data.metrics, 'ws');
          }
        } catch (e) {
          console.error(e);
        }
      };

      ws.onclose = () => {
        if (isMounted) {
          wsTelemetryStatusRef.current = null;
          lastWsTelemetryAtRef.current = 0;
          setSensorStream((prev) => ({ ...prev, wsStatus: 'reconnecting' }));
          reconnectTimer = setTimeout(connectWebSocket, retryDelayMs);
          retryDelayMs = Math.min(retryDelayMs * 1.5, 8000);
        }
      };
    };

    // Short defer avoids StrictMode double-mount premature close errors
    connectDelayTimer = setTimeout(connectWebSocket, 120);

    return () => {
      isMounted = false;
      if (connectDelayTimer) clearTimeout(connectDelayTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const activeWs = wsRef.current;
      wsRef.current = null;
      if (activeWs) {
        if (activeWs.readyState === WebSocket.OPEN) {
          activeWs.close();
        } else if (activeWs.readyState === WebSocket.CONNECTING) {
          activeWs.onopen = () => activeWs.close();
        }
      }
    };
  }, [ingestTelemetryMetrics, wsReconnectNonce]);

  useEffect(() => {
    let cancelled = false;

    const initializePipelines = async () => {
      await ensureTrackerLoaded(activeExerciseRef.current.tracker || 'pose');
      if (!cancelled) {
        detectMovement();
      }
    };

    initializePipelines();
    return () => {
      cancelled = true;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [detectMovement, ensureTrackerLoaded]);

  return (
    <div className="min-h-screen bg-green-100 text-slate-900 font-sans flex flex-col">
      {/* 3-Zone Top Navigation Contract */}
      <header className="bg-green-50/95 backdrop-blur-md border-b border-green-200 px-5 py-2.5 sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-6">
          <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            Neural-Kinematic
          </span>

          <nav className="flex items-center gap-6">
            <button
              onClick={() => setCurrentView('patient')}
              className={`py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                currentView === 'patient'
                  ? 'border-emerald-600 text-slate-950'
                  : 'border-transparent text-slate-600 hover:text-slate-950'
              }`}
            >
              Patient Capture
            </button>
            <button
              onClick={() => setCurrentView('doctor')}
              className={`py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                currentView === 'doctor'
                  ? 'border-emerald-600 text-slate-950'
                  : 'border-transparent text-slate-600 hover:text-slate-950'
              }`}
            >
              Clinical Dashboard
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <StreamStatusIndicator
              cameraStream={cameraStream}
              sensorStream={sensorStream}
              trackerType={activeExercise.tracker}
              calibrationStatus={calibrationState.status}
              isPaused={isPaused}
              onRetryCamera={handleRetryCamera}
              onReconnectSensor={handleReconnectSensor}
            />
            <button
              onClick={saveAndResetSession}
              className="bg-green-300 hover:bg-green-200 text-slate-950 border border-green-400 px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
            >
              Save Session
            </button>
          </div>
        </div>
      </header>

      {/* Protocol & Patient Command Bar */}
      <div className="bg-green-50/80 border-b border-green-200 px-5 py-2">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="exercise-protocol" className="text-xs font-medium text-slate-700 whitespace-nowrap">
              Protocol
            </label>
            <select
              id="exercise-protocol"
              value={selectedExerciseKey}
              onChange={(e) => handleExerciseChange(e.target.value)}
              className="bg-green-50 border border-green-300 hover:border-emerald-600 text-slate-900 text-sm font-medium rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-600 transition-colors"
            >
              {Object.entries(exercises).map(([key, ex]) => (
                <option key={key} value={key}>
                  {ex.name}
                </option>
              ))}
            </select>

            <label htmlFor="patient-select" className="text-xs font-medium text-slate-700 whitespace-nowrap ml-1">
              Patient
            </label>
            <select
              id="patient-select"
              value={patientId}
              onChange={(e) => handlePatientChange(e.target.value)}
              className="bg-green-50 border border-green-300 hover:border-emerald-600 text-slate-900 text-xs font-mono rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-600 transition-colors"
            >
              {PATIENT_PROFILES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5 ml-1">
              <span className="text-xs font-medium text-slate-700 whitespace-nowrap">Limb</span>
              <div className="inline-flex rounded-lg border border-green-300 bg-green-100/50 p-0.5 text-xs font-mono">
                {['Left', 'Right', 'Bilateral'].map((side) => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => handleLimbSideChange(side)}
                    className={`px-2 py-1 rounded-md transition-colors whitespace-nowrap ${
                      limbSide === side
                        ? 'bg-emerald-700 text-white font-semibold'
                        : 'text-slate-700 hover:text-slate-950'
                    }`}
                  >
                    {side}
                  </button>
                ))}
              </div>
            </div>

            <div className="hidden 2xl:flex items-center gap-2 text-xs text-slate-600 font-mono ml-1">
              <span className="text-emerald-800 font-medium">
                {activeExercise.tracker === 'hands' ? 'MediaPipe Hands' : 'MediaPipe Pose'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{(activeExercise.joint_labels || []).join(' / ')}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono">
            <button
              type="button"
              onClick={() => setIsPaused((p) => !p)}
              className={`px-3 py-1.5 rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                isPaused
                  ? 'bg-amber-50 border-amber-300 text-amber-800'
                  : 'bg-green-50 border-green-300 text-slate-800 hover:border-emerald-500'
              }`}
            >
              {isPaused ? 'Resume' : 'Pause'}
            </button>

            <button
              type="button"
              onClick={() => setVoiceEnabled((v) => !v)}
              className={`px-3 py-1.5 rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                voiceEnabled
                  ? 'bg-green-200/70 border-emerald-400 text-emerald-900 hover:bg-green-200'
                  : 'bg-green-50 border-green-300 text-slate-600 hover:text-slate-900'
              }`}
            >
              {voiceEnabled ? 'Voice On' : 'Voice Muted'}
            </button>

            <button
              type="button"
              onClick={resetCurrentTelemetry}
              className="bg-green-50 text-slate-700 hover:text-slate-950 border border-green-300 hover:border-emerald-500 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <main className="px-5 py-4 flex-1 max-w-[1440px] mx-auto w-full">
        <div
          className={
            currentView === 'patient'
              ? 'space-y-6'
              : 'fixed -left-[9999px] opacity-0 pointer-events-none w-px h-px overflow-hidden'
          }
        >
          {/* Above-the-Fold Single-Screen Workspace: Optical Sensor Viewport + Biomechanical Telemetry & Live Joint Angle Stream */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            <div className="lg:col-span-6">
              <div className="bg-green-50 p-4 rounded-xl border border-green-200 flex flex-col justify-between h-full">
                <div>
                  <div className="flex justify-between items-center mb-2.5">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900 tracking-tight">
                        Optical Sensor Viewport
                      </h2>
                      <p className="text-xs text-slate-600 mt-0.5">
                        {activeExercise.category || 'Biomechanical Tracking'}
                      </p>
                    </div>
                    <span className="text-xs font-mono text-emerald-800 font-medium">
                      {isPaused
                        ? 'Paused'
                        : calibrationState.status !== 'calibrated'
                        ? 'Calibration Mode'
                        : activeExercise.tracker === 'hands'
                        ? '21-pt Hand Mesh'
                        : '33-pt Pose Mesh'}
                    </span>
                  </div>

                  <CalibrationWizard
                    tracker={activeExercise.tracker}
                    calibrationState={calibrationState}
                    onSelectStep={handleSelectCalibrationStep}
                    onSkipCalibration={handleSkipCalibration}
                    onRecalibrate={handleRecalibrate}
                  />
                </div>

                <div
                  className={`relative bg-slate-900 aspect-video max-h-[370px] xl:max-h-[400px] w-full rounded-lg overflow-hidden flex items-center justify-center border transition-colors duration-150 ${
                    thresholdStatus.severity === 'critical'
                      ? 'border-rose-500 ring-2 ring-rose-500/50'
                      : thresholdStatus.severity === 'warning'
                      ? 'border-amber-500'
                      : 'border-green-300'
                  }`}
                >
                  <Webcam
                    key={webcamKey}
                    ref={webcamRef}
                    onUserMedia={handleUserMedia}
                    onUserMediaError={handleUserMediaError}
                    className="absolute w-full h-full object-cover transform scale-x-[-1]"
                  />
                  <canvas
                    ref={canvasRef}
                    className="absolute w-full h-full object-cover z-10 transform scale-x-[-1]"
                  />
                  {calibrationState.status === 'calibrated' &&
                    (thresholdStatus.severity === 'critical' ||
                      thresholdStatus.severity === 'warning') && (
                      <div
                        className={`absolute top-3 left-3 right-3 z-20 px-3 py-2 rounded-md border text-xs font-mono flex items-center justify-between gap-2 backdrop-blur-sm pointer-events-none ${
                          thresholdStatus.severity === 'critical'
                            ? 'bg-rose-50/95 border-rose-400 text-rose-900'
                            : 'bg-amber-50/95 border-amber-400 text-amber-900'
                        }`}
                      >
                        <span className="font-semibold">{thresholdStatus.label}</span>
                        <span className="tabular-nums">
                          {thresholdStatus.value.toFixed(1)}{safetyLimits.unit} (Limit {safetyLimits.min}–{safetyLimits.max}{safetyLimits.unit})
                        </span>
                      </div>
                    )}
                  <div className="absolute bottom-2.5 left-2.5 z-20 bg-green-50/95 backdrop-blur-sm border border-green-300 px-2.5 py-1 rounded-md text-xs font-mono text-slate-900 pointer-events-none">
                    {calibrationState.status !== 'calibrated'
                      ? activeExercise.tracker === 'hands'
                        ? `Calibrating Open Palm · ${calibrationState.progressSec.toFixed(1)}s / ${calibrationState.durationSec.toFixed(1)}s`
                        : `Calibrating T-Pose · ${calibrationState.progressSec.toFixed(1)}s / ${calibrationState.durationSec.toFixed(1)}s`
                      : activeExercise.tracker === 'hands'
                      ? `Pinch ${(clinicalMetrics.pinch_distance_mm || 0).toFixed(1)} mm · MCP ${(clinicalMetrics.smoothed_angle || 0).toFixed(1)}°`
                      : `Angle ${(clinicalMetrics.smoothed_angle || 0).toFixed(1)}° · Reps ${clinicalMetrics.reps || 0}`}
                  </div>
                </div>

                <p className="mt-2 text-xs text-slate-600 text-center">
                  {calibrationState.status !== 'calibrated'
                    ? activeExercise.tracker === 'hands'
                      ? 'Click steps 1–3 above or hold your open palm steady for 3 seconds to normalize hand coordinates.'
                      : 'Click steps 1–3 above or hold a horizontal T-pose for 3 seconds to normalize body coordinates.'
                    : activeExercise.tracker === 'hands'
                    ? 'Hold your hand in clear view of the camera and perform controlled thumb-to-index pinch cycles.'
                    : 'Position your full body in frame with clear joint visibility for Savitzky-Golay kinematic tracking.'}
                </p>
              </div>
            </div>

            <div className="lg:col-span-6">
              <ClinicalDashboard
                metrics={clinicalMetrics}
                exercise={activeExercise}
                patientId={patientId}
                limbSide={limbSide}
                telemetrySeries={telemetrySeries}
                telemetryCount={telemetryCount}
                sessionStartTime={sessionStartTime}
                targetReps={targetReps}
                onTargetRepsChange={setTargetReps}
                clinicalNotes={clinicalNotes}
                onExportCSV={exportSessionCSV}
                onReset={saveAndResetSession}
                safetyLimits={safetyLimits}
                thresholdMonitoringEnabled={thresholdMonitoringEnabled}
                breachStats={breachStats}
                adherenceMetrics={adherenceMetrics}
                prescription={activePrescription}
              />
            </div>
          </section>

          {/* Below-the-Fold Scroll Workspace: Protocol Guidance, Clinical Insights, Prescription Adherence, ROM Safety Monitor & Session Records */}
          <section className="pt-5 border-t border-green-200">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 tracking-tight">
                  Protocol Guidance, Fatigue &amp; Symmetry Analytics, Home Prescription &amp; Safety Thresholds
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Track neuromuscular fatigue drift, compare left vs. right limb recovery, assign home rehab prescriptions, and configure ROM safety corridors.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              <div className="lg:col-span-6 flex flex-col gap-5">
                <ProtocolGuide exercise={activeExercise} />
                <ClinicalInsightsPanel
                  metrics={clinicalMetrics}
                  exercise={activeExercise}
                  limbSide={limbSide}
                  involvedSide={involvedSide}
                  onInvolvedSideChange={setInvolvedSide}
                  onLimbSideChange={handleLimbSideChange}
                  patientSessions={patientSessions}
                />
                <SessionHistory
                  patientId={patientId}
                  refreshTrigger={historyTrigger}
                  onHistoryChanged={() => setHistoryTrigger((prev) => prev + 1)}
                  onSessionsLoaded={setPatientSessions}
                />
              </div>

              <div className="lg:col-span-6 flex flex-col gap-5">
                <ThresholdMonitor
                  key={activeExercise.key || 'knee_flexion'}
                  exercise={activeExercise}
                  safetyLimits={safetyLimits}
                  thresholdStatus={thresholdStatus}
                  monitoringEnabled={thresholdMonitoringEnabled}
                  breachStats={breachStats}
                  audioAlertEnabled={audioAlertEnabled}
                  onToggleAudioAlert={() => setAudioAlertEnabled((prev) => !prev)}
                  onApplySafetyLimits={handleApplySafetyLimits}
                  onSetMonitoringEnabled={handleSetThresholdMonitoringEnabled}
                  onResetSafetyLimits={handleResetSafetyLimits}
                  onTestAlertTone={() => playThresholdAlertTone('exceeded_max', audioCtxRef)}
                />

                <RehabPrescriptionPanel
                  key={`${patientId}_${selectedExerciseKey}_${activePrescription.updatedAt || 'default'}`}
                  exercise={activeExercise}
                  patientId={patientId}
                  prescription={activePrescription}
                  adherenceMetrics={adherenceMetrics}
                  completedSets={completedSets}
                  onSavePrescription={handleSavePrescription}
                  onSyncPrescriptionToThresholds={handleSyncPrescriptionToThresholds}
                  onCompleteSet={() => setCompletedSets((s) => s + 1)}
                  onResetSets={() => setCompletedSets(0)}
                />

                {/* Clinician Session Observations Card */}
                <div className="bg-green-50 p-5 rounded-xl border border-green-200">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900 tracking-tight">
                        Clinician Observations
                      </h3>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Included in exported PDF assessments and saved recovery logs
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={saveAndResetSession}
                      className="bg-green-300 hover:bg-green-200 text-slate-950 border border-green-400 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                    >
                      Save Session &amp; Notes
                    </button>
                  </div>
                  <label htmlFor="clinical-notes" className="sr-only">
                    Clinician Observations
                  </label>
                  <textarea
                    id="clinical-notes"
                    rows={3}
                    value={clinicalNotes}
                    onChange={(e) => setClinicalNotes(e.target.value)}
                    placeholder="e.g., Mild pain reported at 90 deg knee flexion; steady cadence; tolerated 10 repetitions without compensatory trunk lean..."
                    className="w-full bg-green-100/40 border border-green-300 text-slate-900 placeholder:text-slate-500 rounded-lg px-3 py-2 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>
            </div>
          </section>
        </div>

        {currentView === 'doctor' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <div className="lg:col-span-8">
              <DoctorDashboard
                activeExercise={activeExercise}
                refreshTrigger={historyTrigger}
                onCohortChanged={() => setHistoryTrigger((prev) => prev + 1)}
              />
            </div>
            <div className="lg:col-span-4">
              <AIChat />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;