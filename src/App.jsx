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
import {
  evaluateTPose,
  evaluateHandCalibrationPose,
  computeNormalizationProfile,
  normalizeLandmarks,
} from './utils/calibration';
import {
  getDefaultSafetyLimits,
  evaluateRomThreshold,
  playThresholdAlertTone,
} from './utils/thresholdMonitor';

const CALIBRATION_DURATION_SEC = 3.0;

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
    rom_target_min: 70,
    rom_target_max: 170,
    safety_min: 55,
    safety_max: 176,
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
    rom_target_min: 35,
    rom_target_max: 165,
    safety_min: 25,
    safety_max: 175,
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
    rom_target_min: 95,
    rom_target_max: 175,
    safety_min: 80,
    safety_max: 178,
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
    rom_target_min: 10,
    rom_target_max: 90,
    safety_min: 5,
    safety_max: 105,
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

  const [wsConnected, setWsConnected] = useState(false);
  const [modelReady, setModelReady] = useState(false);

  const [clinicalMetrics, setClinicalMetrics] = useState(INITIAL_METRICS);
  const [telemetrySeries, setTelemetrySeries] = useState([]);
  const [telemetryCount, setTelemetryCount] = useState(0);
  const [sessionStartTime, setSessionStartTime] = useState(() => Date.now());
  const [calibrationState, setCalibrationState] = useState(() =>
    createInitialCalibrationState('pose')
  );
  const [customSafetyLimits, setCustomSafetyLimits] = useState(null);
  const [audioAlertEnabled, setAudioAlertEnabled] = useState(true);
  const [breachStats, setBreachStats] = useState({
    upperCount: 0,
    lowerCount: 0,
    lastEvent: '',
  });

  const calibrationRef = useRef({
    status: 'calibrating',
    step: 1,
    holdStartMs: null,
    samples: [],
    profile: null,
    lastUiSyncMs: 0,
    lastFeedback: '',
  });

  const activeExercise = exercises[selectedExerciseKey] || DEFAULT_EXERCISES.knee_flexion;
  const safetyLimits = customSafetyLimits || getDefaultSafetyLimits(activeExercise);
  const monitoredSignal =
    (clinicalMetrics.tracker || activeExercise.tracker) === 'hands'
      ? clinicalMetrics.pinch_aperture || 0
      : clinicalMetrics.smoothed_angle || 0;
  const thresholdStatus = evaluateRomThreshold(
    monitoredSignal,
    safetyLimits,
    clinicalMetrics.status
  );

  const activeExerciseRef = useRef(activeExercise);
  const selectedExerciseKeyRef = useRef(selectedExerciseKey);
  const isPausedRef = useRef(isPaused);
  const voiceEnabledRef = useRef(voiceEnabled);
  const targetRepsRef = useRef(targetReps);
  const targetGoalSpokenRef = useRef(false);
  const safetyLimitsRef = useRef(safetyLimits);
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
    safetyLimitsRef.current = safetyLimits;
  }, [safetyLimits]);

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

  const startCalibration = useCallback((trackerType) => {
    const initial = createInitialCalibrationState(trackerType);
    calibrationRef.current = {
      status: 'calibrating',
      step: 1,
      holdStartMs: null,
      samples: [],
      profile: null,
      lastUiSyncMs: 0,
      lastFeedback: initial.feedback,
    };
    setCalibrationState(initial);
  }, []);

  useEffect(() => {
    const fetchExercises = async () => {
      try {
        const res = await fetch('/api/exercises');
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

  const ensureTrackerLoaded = useCallback(async (trackerType) => {
    if (trackerType === 'pose' && poseLandmarkerRef.current) {
      setModelReady(true);
      return;
    }
    if (trackerType === 'hands' && handLandmarkerRef.current) {
      setModelReady(true);
      return;
    }
    if (loadingTrackerRef.current === trackerType) return;

    loadingTrackerRef.current = trackerType;
    setModelReady(false);

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
      setModelReady(true);
    } catch (err) {
      console.error(`Failed to initialize ${trackerType} landmarker:`, err);
    } finally {
      if (loadingTrackerRef.current === trackerType) {
        loadingTrackerRef.current = null;
      }
    }
  }, []);

  const handleExerciseChange = (nextKey) => {
    const nextConfig = exercises[nextKey] || DEFAULT_EXERCISES[nextKey];
    if (!nextConfig) return;

    setSelectedExerciseKey(nextKey);
    setClinicalMetrics({ ...INITIAL_METRICS, tracker: nextConfig.tracker });
    setTelemetrySeries([]);
    setTelemetryCount(0);
    setSessionStartTime(Date.now());
    setCustomSafetyLimits(null);
    setBreachStats({ upperCount: 0, lowerCount: 0, lastEvent: '' });
    lastBreachStateRef.current = 'standby';
    sessionLogRef.current = [];
    lastAlertSpoken.current = '';
    targetGoalSpokenRef.current = false;
    startCalibration(nextConfig.tracker);

    ensureTrackerLoaded(nextConfig.tracker);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'select_exercise',
          exercise_key: nextKey,
          exercise_id: nextConfig.id,
        })
      );
    }
  };

  const resetCurrentTelemetry = () => {
    setClinicalMetrics({ ...INITIAL_METRICS, tracker: activeExercise.tracker });
    setTelemetrySeries([]);
    setTelemetryCount(0);
    setSessionStartTime(Date.now());
    setBreachStats({ upperCount: 0, lowerCount: 0, lastEvent: '' });
    lastBreachStateRef.current = 'standby';
    sessionLogRef.current = [];
    lastAlertSpoken.current = '';
    targetGoalSpokenRef.current = false;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'reset_session' }));
    }
  };

  const handleRecalibrate = () => {
    resetCurrentTelemetry();
    startCalibration(activeExercise.tracker);
  };

  const handleSkipCalibration = () => {
    const skippedProfile = { skipped: true };
    calibrationRef.current = {
      status: 'calibrated',
      step: 3,
      holdStartMs: null,
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
    const csvHeader =
      'Timestamp_ISO,Elapsed_s,Patient_ID,Protocol_ID,Protocol_Name,Smoothed_Angle_deg,Pinch_Aperture_pct,Pinch_Distance_mm,Rep_Count,Jerk_RMS,DTW_Form_Match_pct,Threshold_State,Compensation_Alerts\n';

    const sourceRows =
      rows.length > 0
        ? rows
        : [
            {
              time: Date.now(),
              angle: clinicalMetrics.smoothed_angle || 0,
              pinchAperture: clinicalMetrics.pinch_aperture || 0,
              pinchMm: clinicalMetrics.pinch_distance_mm || 0,
              reps: clinicalMetrics.reps || 0,
              jerk: clinicalMetrics.jerk_score || 0,
              dtw: clinicalMetrics.dtw_consistency ?? 100,
              thresholdState: thresholdStatus.state,
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
          row.angle,
          row.pinchAperture ?? 0,
          row.pinchMm ?? 0,
          row.reps,
          row.jerk,
          row.dtw,
          row.thresholdState || 'nominal',
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
    link.setAttribute('download', `kinematic_${selectedExerciseKey}_${patientId}_${Date.now()}.csv`);
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

    try {
      await fetch('/api/save_session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          exercise_id: activeExercise.id,
          leftMaxROM: clinicalMetrics.rom_max,
          rightMaxROM: clinicalMetrics.rom_max,
          symmetryScore: clinicalMetrics.dtw_consistency,
          repCount: clinicalMetrics.reps,
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

  const detectMovement = useCallback(
    function detectMovement() {
      const video = webcamRef.current?.video;
      const canvas = canvasRef.current;

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
              const profile = computeNormalizationProfile(
                cal.samples,
                isHands ? 'hands' : 'pose'
              );
              cal.status = 'calibrated';
              cal.step = 3;
              cal.profile = profile;
              syncCalibrationUi(
                {
                  status: 'calibrated',
                  step: 3,
                  progressSec: CALIBRATION_DURATION_SEC,
                  feedback: 'Coordinates normalized. Tracking active.',
                  profile,
                },
                true
              );
              speakFeedback('Calibration complete. Begin exercise.');
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'reset_session' }));
              }
              return true;
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
              const landmarks = handResult.landmarks[0];
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
              if (calibrated && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                const prof = calibrationRef.current.profile;
                const outboundLandmarks =
                  prof && !prof.skipped ? normalizeLandmarks(landmarks, prof) : landmarks;
                wsRef.current.send(
                  JSON.stringify({
                    type: 'skeleton_telemetry',
                    tracker: 'hands',
                    exercise_key: exKey,
                    exercise_id: exercise.id,
                    landmarks: outboundLandmarks,
                  })
                );
              }
            } else if (calibrationRef.current.status !== 'calibrated') {
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
              const landmarks = poseResult.landmarks[0];
              const drawingUtils = new DrawingUtils(ctx);

              drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
                color: '#34D399',
                lineWidth: 2.5,
              });
              drawingUtils.drawLandmarks(landmarks, {
                color: '#86EFAC',
                radius: 3.5,
              });

              const joints = exercise.primary_angle_joints || [];
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
              if (calibrated && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                const prof = calibrationRef.current.profile;
                const outboundLandmarks =
                  prof && !prof.skipped ? normalizeLandmarks(landmarks, prof) : landmarks;
                wsRef.current.send(
                  JSON.stringify({
                    type: 'skeleton_telemetry',
                    tracker: 'pose',
                    exercise_key: exKey,
                    exercise_id: exercise.id,
                    landmarks: outboundLandmarks,
                  })
                );
              }
            } else if (calibrationRef.current.status !== 'calibrated') {
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
    [speakFeedback, syncCalibrationUi]
  );

  useEffect(() => {
    let isMounted = true;
    let reconnectTimer = null;

    const connectWebSocket = () => {
      if (!isMounted) return;
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/movement`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isMounted) {
          setWsConnected(true);
          ws.send(
            JSON.stringify({
              type: 'select_exercise',
              exercise_key: selectedExerciseKeyRef.current,
              exercise_id: activeExerciseRef.current.id,
            })
          );
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'clinical_telemetry' && data.metrics) {
            setClinicalMetrics(data.metrics);

            const activeLimits = safetyLimitsRef.current;
            const sigVal =
              (data.metrics.tracker || activeExerciseRef.current.tracker) === 'hands'
                ? data.metrics.pinch_aperture || 0
                : data.metrics.smoothed_angle || 0;
            const evalThreshold = evaluateRomThreshold(
              sigVal,
              activeLimits,
              data.metrics.status
            );

            if (data.metrics.status === 'tracking') {
              const nowMs = Date.now();
              const point = {
                time: nowMs,
                protocol: selectedExerciseKeyRef.current,
                angle: data.metrics.smoothed_angle,
                pinchAperture: data.metrics.pinch_aperture || 0,
                pinchMm: data.metrics.pinch_distance_mm || 0,
                reps: data.metrics.reps,
                jerk: data.metrics.jerk_score,
                dtw: data.metrics.dtw_consistency,
                thresholdState: evalThreshold.state,
                alerts: (data.metrics.alerts || []).join(' | '),
              };
              sessionLogRef.current.push(point);
              setTelemetryCount(sessionLogRef.current.length);
              setTelemetrySeries((prev) => {
                const next = [...prev, point];
                return next.length > 100 ? next.slice(-100) : next;
              });

              if (evalThreshold.severity === 'critical') {
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
              lastBreachStateRef.current = evalThreshold.state;
            }

            if (
              data.metrics.reps > 0 &&
              data.metrics.reps >= targetRepsRef.current &&
              !targetGoalSpokenRef.current
            ) {
              targetGoalSpokenRef.current = true;
              speakFeedback(`Target of ${targetRepsRef.current} repetitions reached.`);
            } else if (data.metrics.reps > 0 && data.metrics.reps % 5 === 0) {
              speakFeedback(`${data.metrics.reps} repetitions completed.`);
            }

            if (data.metrics.alerts && data.metrics.alerts.length > 0) {
              const currentAlert = data.metrics.alerts[0];
              if (currentAlert !== lastAlertSpoken.current) {
                speakFeedback(`Warning: ${currentAlert}`);
                lastAlertSpoken.current = currentAlert;
              }
            } else {
              lastAlertSpoken.current = '';
            }
          }
        } catch (e) {
          console.error(e);
        }
      };

      ws.onclose = () => {
        if (isMounted) {
          setWsConnected(false);
          reconnectTimer = setTimeout(connectWebSocket, 1500);
        }
      };
    };

    connectWebSocket();

    return () => {
      isMounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [speakFeedback]);

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
      <header className="bg-green-50/95 backdrop-blur-md border-b border-green-200 px-6 py-3.5 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8">
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
      <div className="bg-green-50/80 border-b border-green-200 px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
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
              onChange={(e) => setPatientId(e.target.value)}
              className="bg-green-50 border border-green-300 hover:border-emerald-600 text-slate-900 text-xs font-mono rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-600 transition-colors"
            >
              {PATIENT_PROFILES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>

            <div className="hidden xl:flex items-center gap-2 text-xs text-slate-600 font-mono ml-1">
              <span className="text-emerald-800 font-medium">
                {activeExercise.tracker === 'hands' ? 'MediaPipe Hands' : 'MediaPipe Pose'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{(activeExercise.joint_labels || []).join(' / ')}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono">
            <span className={wsConnected ? 'text-emerald-800 font-medium' : 'text-amber-700 font-medium'}>
              {wsConnected ? '● Linked' : '○ Connecting'}
            </span>
            <span className="text-green-300" aria-hidden="true">·</span>
            <span className={modelReady ? 'text-green-800 font-medium' : 'text-slate-600'}>
              {modelReady ? 'Vision Ready' : 'Loading...'}
            </span>

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

      <main className="p-6 flex-1 max-w-7xl mx-auto w-full">
        <div
          className={
            currentView === 'patient'
              ? 'grid grid-cols-1 lg:grid-cols-12 gap-6 items-start'
              : 'fixed -left-[9999px] opacity-0 pointer-events-none w-px h-px overflow-hidden'
          }
        >
          <div className="lg:col-span-6 flex flex-col gap-6">
            <div className="bg-green-50 p-5 rounded-xl border border-green-200 flex flex-col">
              <div className="flex justify-between items-center mb-4">
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
                onSkipCalibration={handleSkipCalibration}
                onRecalibrate={handleRecalibrate}
              />

              <div
                className={`relative bg-slate-900 aspect-video rounded-lg overflow-hidden flex items-center justify-center border transition-colors duration-150 ${
                  thresholdStatus.severity === 'critical'
                    ? 'border-rose-500 ring-2 ring-rose-500/50'
                    : thresholdStatus.severity === 'warning'
                    ? 'border-amber-500'
                    : 'border-green-300'
                }`}
              >
                <Webcam
                  ref={webcamRef}
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
                <div className="absolute bottom-3 left-3 z-20 bg-green-50/95 backdrop-blur-sm border border-green-300 px-3 py-1.5 rounded-md text-xs font-mono text-slate-900 pointer-events-none">
                  {calibrationState.status !== 'calibrated'
                    ? activeExercise.tracker === 'hands'
                      ? `Calibrating Open Palm · ${calibrationState.progressSec.toFixed(1)}s / ${calibrationState.durationSec.toFixed(1)}s`
                      : `Calibrating T-Pose · ${calibrationState.progressSec.toFixed(1)}s / ${calibrationState.durationSec.toFixed(1)}s`
                    : activeExercise.tracker === 'hands'
                    ? `Pinch ${(clinicalMetrics.pinch_distance_mm || 0).toFixed(1)} mm · MCP ${(clinicalMetrics.smoothed_angle || 0).toFixed(1)}°`
                    : `Angle ${(clinicalMetrics.smoothed_angle || 0).toFixed(1)}° · Reps ${clinicalMetrics.reps || 0}`}
                </div>
              </div>

              <p className="mt-3 text-xs text-slate-600 text-center">
                {calibrationState.status !== 'calibrated'
                  ? activeExercise.tracker === 'hands'
                    ? 'Hold your open palm steady for 3 seconds to normalize hand coordinates.'
                    : 'Hold a horizontal T-pose for 3 seconds to normalize body coordinates.'
                  : activeExercise.tracker === 'hands'
                  ? 'Hold your hand in clear view of the camera and perform controlled thumb-to-index pinch cycles.'
                  : 'Position your full body in frame with clear joint visibility for Savitzky-Golay kinematic tracking.'}
              </p>
            </div>

            <ProtocolGuide exercise={activeExercise} />
          </div>

          <div className="lg:col-span-6 flex flex-col gap-6">
            <ClinicalDashboard
              metrics={clinicalMetrics}
              exercise={activeExercise}
              patientId={patientId}
              telemetrySeries={telemetrySeries}
              telemetryCount={telemetryCount}
              sessionStartTime={sessionStartTime}
              targetReps={targetReps}
              onTargetRepsChange={setTargetReps}
              clinicalNotes={clinicalNotes}
              onClinicalNotesChange={setClinicalNotes}
              onExportCSV={exportSessionCSV}
              onReset={saveAndResetSession}
              safetyLimits={safetyLimits}
              thresholdStatus={thresholdStatus}
              breachStats={breachStats}
              audioAlertEnabled={audioAlertEnabled}
              onToggleAudioAlert={() => setAudioAlertEnabled((prev) => !prev)}
              onUpdateSafetyLimits={setCustomSafetyLimits}
              onResetSafetyLimits={() => setCustomSafetyLimits(null)}
              onTestAlertTone={() => playThresholdAlertTone('exceeded_max', audioCtxRef)}
            />
            <SessionHistory patientId={patientId} refreshTrigger={historyTrigger} />
          </div>
        </div>

        {currentView === 'doctor' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-8">
              <DoctorDashboard activeExercise={activeExercise} />
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