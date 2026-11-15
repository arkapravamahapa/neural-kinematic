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
  },
};

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
  const [wsConnected, setWsConnected] = useState(false);
  const [modelReady, setModelReady] = useState(false);

  const [clinicalMetrics, setClinicalMetrics] = useState(INITIAL_METRICS);
  const [telemetrySeries, setTelemetrySeries] = useState([]);

  const activeExercise = exercises[selectedExerciseKey] || DEFAULT_EXERCISES.knee_flexion;
  const activeExerciseRef = useRef(activeExercise);
  const selectedExerciseKeyRef = useRef(selectedExerciseKey);

  useEffect(() => {
    activeExerciseRef.current = activeExercise;
    selectedExerciseKeyRef.current = selectedExerciseKey;
  }, [activeExercise, selectedExerciseKey]);

  // Voice AI
  const lastSpeechTime = useRef(0);
  const lastAlertSpoken = useRef('');

  const speakFeedback = (text) => {
    const now = Date.now();
    if (now - lastSpeechTime.current < 3000) return;
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.1;
      window.speechSynthesis.speak(utterance);
      lastSpeechTime.current = now;
    }
  };

  // Load dynamic exercise library from backend
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
    sessionLogRef.current = [];
    lastAlertSpoken.current = '';

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
    sessionLogRef.current = [];
    lastAlertSpoken.current = '';
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'reset_session' }));
    }
  };

  const saveAndResetSession = async () => {
    if (sessionLogRef.current.length > 0) {
      const csvHeader = 'Timestamp_ms,Protocol,Smoothed_Angle,Pinch_Distance_mm,Rep_Count,Jerk_RMS,DTW_Consistency\n';
      const csvRows = sessionLogRef.current
        .map(
          (row) =>
            `${row.time},${row.protocol},${row.angle},${row.pinchMm},${row.reps},${row.jerk},${row.dtw}`
        )
        .join('\n');

      const blob = new Blob([csvHeader + csvRows], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `kinematic_${selectedExerciseKey}_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    try {
      await fetch('/api/save_session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: '11111111-1111-1111-1111-111111111111',
          exercise_id: activeExercise.id,
          leftMaxROM: clinicalMetrics.rom_max,
          rightMaxROM: clinicalMetrics.rom_max,
          symmetryScore: clinicalMetrics.dtw_consistency,
          repCount: clinicalMetrics.reps,
        }),
      });
      setHistoryTrigger((prev) => prev + 1);
      speakFeedback('Clinical session saved successfully. Research data exported.');
    } catch (error) {
      console.error('Error saving data:', error);
    }

    resetCurrentTelemetry();
  };

  const detectMovement = useCallback(function detectMovement() {
    const video = webcamRef.current?.video;
    const canvas = canvasRef.current;

    if (video && video.readyState === 4 && canvas) {
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

        if (exercise.tracker === 'hands' && handLandmarkerRef.current) {
          const handResult = handLandmarkerRef.current.detectForVideo(video, startTimeMs);
          if (handResult.landmarks && handResult.landmarks.length > 0) {
            const landmarks = handResult.landmarks[0];
            const drawingUtils = new DrawingUtils(ctx);

            drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
              color: '#22D3EE',
              lineWidth: 2.5,
            });
            drawingUtils.drawLandmarks(landmarks, {
              color: '#10B981',
              radius: 3.5,
            });

            // Highlight thumb-to-index pinch vector (#4 <-> #8)
            const thumbTip = landmarks[4];
            const indexTip = landmarks[8];
            if (thumbTip && indexTip) {
              ctx.save();
              ctx.strokeStyle = '#F59E0B';
              ctx.lineWidth = 2;
              ctx.setLineDash([5, 4]);
              ctx.beginPath();
              ctx.moveTo(thumbTip.x * canvas.width, thumbTip.y * canvas.height);
              ctx.lineTo(indexTip.x * canvas.width, indexTip.y * canvas.height);
              ctx.stroke();
              ctx.restore();
            }

            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  type: 'skeleton_telemetry',
                  tracker: 'hands',
                  exercise_key: exKey,
                  exercise_id: exercise.id,
                  landmarks,
                })
              );
            }
          }
        } else if (exercise.tracker !== 'hands' && poseLandmarkerRef.current) {
          const poseResult = poseLandmarkerRef.current.detectForVideo(video, startTimeMs);
          if (poseResult.landmarks && poseResult.landmarks.length > 0) {
            const landmarks = poseResult.landmarks[0];
            const drawingUtils = new DrawingUtils(ctx);

            drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
              color: '#10B981',
              lineWidth: 2.5,
            });
            drawingUtils.drawLandmarks(landmarks, {
              color: '#22D3EE',
              radius: 3.5,
            });

            // Highlight active exercise joint triplet
            const joints = exercise.primary_angle_joints || [];
            if (joints.length === 3 && landmarks[joints[0]] && landmarks[joints[1]] && landmarks[joints[2]]) {
              ctx.save();
              ctx.strokeStyle = '#22D3EE';
              ctx.lineWidth = 4;
              ctx.beginPath();
              ctx.moveTo(landmarks[joints[0]].x * canvas.width, landmarks[joints[0]].y * canvas.height);
              ctx.lineTo(landmarks[joints[1]].x * canvas.width, landmarks[joints[1]].y * canvas.height);
              ctx.lineTo(landmarks[joints[2]].x * canvas.width, landmarks[joints[2]].y * canvas.height);
              ctx.stroke();
              ctx.restore();
            }

            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  type: 'skeleton_telemetry',
                  tracker: 'pose',
                  exercise_key: exKey,
                  exercise_id: exercise.id,
                  landmarks,
                })
              );
            }
          }
        }
      }
    }

    requestRef.current = requestAnimationFrame(detectMovement);
  }, []);

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

            if (data.metrics.status === 'tracking') {
              const point = {
                time: Date.now(),
                protocol: selectedExerciseKeyRef.current,
                angle: data.metrics.smoothed_angle,
                pinchAperture: data.metrics.pinch_aperture || 0,
                pinchMm: data.metrics.pinch_distance_mm || 0,
                reps: data.metrics.reps,
                jerk: data.metrics.jerk_score,
                dtw: data.metrics.dtw_consistency,
              };
              sessionLogRef.current.push(point);
              setTelemetrySeries((prev) => {
                const next = [...prev, point];
                return next.length > 100 ? next.slice(-100) : next;
              });
            }

            if (data.metrics.reps > 0 && data.metrics.reps % 5 === 0) {
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
  }, []);

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
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      {/* 3-Zone Top Navigation Contract */}
      <header className="bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-6 py-3.5 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8">
          <span className="text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0">
            Neural-Kinematic
          </span>

          <nav className="flex items-center gap-6">
            <button
              onClick={() => setCurrentView('patient')}
              className={`py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                currentView === 'patient'
                  ? 'border-cyan-400 text-slate-50'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Patient Capture
            </button>
            <button
              onClick={() => setCurrentView('doctor')}
              className={`py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                currentView === 'doctor'
                  ? 'border-cyan-400 text-slate-50'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Clinical Dashboard
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={saveAndResetSession}
              className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              Save Session
            </button>
          </div>
        </div>
      </header>

      {/* Protocol Command Bar */}
      <div className="bg-slate-900/60 border-b border-slate-800/80 px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <label htmlFor="exercise-protocol" className="text-xs font-medium text-slate-400 whitespace-nowrap">
              Rehabilitation Protocol
            </label>
            <select
              id="exercise-protocol"
              value={selectedExerciseKey}
              onChange={(e) => handleExerciseChange(e.target.value)}
              className="bg-slate-950 border border-slate-700 hover:border-cyan-500/60 text-slate-100 text-sm font-medium rounded-lg px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-colors"
            >
              {Object.entries(exercises).map(([key, ex]) => (
                <option key={key} value={key}>
                  {ex.name}
                </option>
              ))}
            </select>

            <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 font-mono">
              <span className="text-cyan-400">
                {activeExercise.tracker === 'hands' ? 'MediaPipe Hands' : 'MediaPipe Pose'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{(activeExercise.joint_labels || []).join(' / ')}</span>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <span className={wsConnected ? 'text-emerald-400' : 'text-amber-400'}>
              {wsConnected ? '● Telemetry Linked' : '○ Connecting'}
            </span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span className={modelReady ? 'text-cyan-400' : 'text-slate-400'}>
              {modelReady ? 'Vision Ready' : 'Loading Model...'}
            </span>
            <button
              onClick={resetCurrentTelemetry}
              className="text-slate-400 hover:text-slate-100 border border-slate-800 hover:border-slate-700 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <main className="p-6 flex-1 max-w-7xl mx-auto w-full">
        {/* Keep capture mounted across view switches so DoctorDashboard receives live 3D telemetry */}
        <div
          className={
            currentView === 'patient'
              ? 'grid grid-cols-1 lg:grid-cols-12 gap-6 items-start'
              : 'fixed -left-[9999px] opacity-0 pointer-events-none w-px h-px overflow-hidden'
          }
        >
          <div className="lg:col-span-6 bg-slate-900/80 backdrop-blur-md p-5 rounded-xl border border-slate-800 flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-100 tracking-tight">
                  Optical Sensor Viewport
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {activeExercise.category || 'Biomechanical Tracking'}
                </p>
              </div>
              <span className="text-xs font-mono text-emerald-400">
                {activeExercise.tracker === 'hands' ? '21-pt Hand Mesh' : '33-pt Pose Mesh'}
              </span>
            </div>

            <div className="relative bg-slate-950 aspect-video rounded-lg overflow-hidden flex items-center justify-center border border-slate-800">
              <Webcam
                ref={webcamRef}
                className="absolute w-full h-full object-cover transform scale-x-[-1]"
              />
              <canvas
                ref={canvasRef}
                className="absolute w-full h-full object-cover z-10 transform scale-x-[-1]"
              />
              <div className="absolute bottom-3 left-3 z-20 bg-slate-950/75 backdrop-blur-sm border border-slate-800 px-3 py-1.5 rounded-md text-xs font-mono text-slate-200 pointer-events-none">
                {activeExercise.tracker === 'hands'
                  ? `Pinch ${(clinicalMetrics.pinch_distance_mm || 0).toFixed(1)} mm · MCP ${(clinicalMetrics.smoothed_angle || 0).toFixed(1)}°`
                  : `Angle ${(clinicalMetrics.smoothed_angle || 0).toFixed(1)}° · Reps ${clinicalMetrics.reps || 0}`}
              </div>
            </div>

            <p className="mt-3 text-xs text-slate-400 text-center">
              {activeExercise.tracker === 'hands'
                ? 'Hold your hand in clear view of the camera and perform controlled thumb-to-index pinch cycles.'
                : 'Position your full body in frame with clear joint visibility for Savitzky-Golay kinematic tracking.'}
            </p>
          </div>

          <div className="lg:col-span-6 flex flex-col gap-6">
            <ClinicalDashboard
              metrics={clinicalMetrics}
              exercise={activeExercise}
              telemetrySeries={telemetrySeries}
              onReset={saveAndResetSession}
            />
            <SessionHistory refreshTrigger={historyTrigger} />
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