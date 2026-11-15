// src/App.jsx
import { useCallback, useEffect, useRef, useState } from 'react'
import Webcam from 'react-webcam'
import { PoseLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision'

import ClinicalDashboard from './components/ClinicalDashboard'
import SessionHistory from './components/SessionHistory'
import DoctorDashboard from './components/DoctorDashboard'
import AIChat from './components/AIChat'

function App() {
  const webcamRef = useRef(null)
  const canvasRef = useRef(null)
  const landmarkerRef = useRef(null)
  const requestRef = useRef(null)
  const wsRef = useRef(null) 
  
  // NEW: Silent background logger for research export
  const sessionLogRef = useRef([])

  const [currentView, setCurrentView] = useState('patient') 
  const [historyTrigger, setHistoryTrigger] = useState(0)
  
  const [clinicalMetrics, setClinicalMetrics] = useState({
    status: "initializing",
    smoothed_angle: 0,
    reps: 0,
    jerk_score: 0.0,
    rom_max: 0,
    rom_min: 0,
    dtw_consistency: 100,
    alerts: []
  })

  // Voice AI
  const lastSpeechTime = useRef(0)
  const lastAlertSpoken = useRef("")

  const speakFeedback = (text) => {
    const now = Date.now();
    if (now - lastSpeechTime.current < 3000) return; 
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.1; 
      window.speechSynthesis.speak(utterance);
      lastSpeechTime.current = now;
    }
  }

  const saveAndResetSession = async () => {
    // 1. Generate Research CSV
    if (sessionLogRef.current.length > 0) {
      const csvHeader = "Timestamp_ms,Smoothed_Angle,Rep_Count,Jerk_RMS,DTW_Consistency\n";
      const csvRows = sessionLogRef.current.map(row => 
        `${row.time},${row.angle},${row.reps},${row.jerk},${row.dtw}`
      ).join("\n");
      
      const blob = new Blob([csvHeader + csvRows], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `kinematic_session_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    // 2. Save Macro Data to Supabase
    try {
      await fetch("http://127.0.0.1:8000/api/save_session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: "11111111-1111-1111-1111-111111111111", 
          exercise_id: "knee_flexion_001",
          leftMaxROM: clinicalMetrics.rom_max,
          rightMaxROM: clinicalMetrics.rom_max, 
          symmetryScore: clinicalMetrics.dtw_consistency, 
          repCount: clinicalMetrics.reps
        }),
      });
      setHistoryTrigger(prev => prev + 1); 
      speakFeedback("Clinical session saved successfully. Research data exported.");
    } catch (error) {
      console.error("Error saving data:", error);
    }
    
    // 3. Reset Engine
    setClinicalMetrics({ status: "initializing", smoothed_angle: 0, reps: 0, jerk_score: 0.0, rom_max: 0, rom_min: 0, dtw_consistency: 100, alerts: [] })
    lastAlertSpoken.current = "";
    sessionLogRef.current = []; // Clear the logger
  };

  const detectMovement = useCallback(function detectMovement() {
    if (
      webcamRef.current && webcamRef.current.video.readyState === 4 &&
      landmarkerRef.current && canvasRef.current && currentView === 'patient'
    ) {
      const video = webcamRef.current.video;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const startTimeMs = performance.now();
      const poseResult = landmarkerRef.current.detectForVideo(video, startTimeMs);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (poseResult.landmarks && poseResult.landmarks.length > 0) {
        const landmarks = poseResult.landmarks[0];

        const drawingUtils = new DrawingUtils(ctx);
        drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, { color: "#10B981", lineWidth: 3 });
        drawingUtils.drawLandmarks(landmarks, { color: "#3B82F6", radius: 4 });

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'skeleton_telemetry',
            landmarks: landmarks
          }));
        }
      }
    }
    requestRef.current = requestAnimationFrame(detectMovement);
  }, [currentView]);

  useEffect(() => {
    wsRef.current = new WebSocket("ws://127.0.0.1:8000/ws/movement");
    
    wsRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'clinical_telemetry' && data.metrics) {
          setClinicalMetrics(data.metrics);
          
          // NEW: Log the data point for research export
          if (data.metrics.status === "tracking") {
            sessionLogRef.current.push({
              time: Date.now(),
              angle: data.metrics.smoothed_angle,
              reps: data.metrics.reps,
              jerk: data.metrics.jerk_score,
              dtw: data.metrics.dtw_consistency
            });
          }
          
          // Trigger voice feedback on rep changes
          if (data.metrics.reps > 0 && data.metrics.reps % 5 === 0) {
             speakFeedback(`${data.metrics.reps} repetitions completed.`);
          }

          // Trigger voice feedback on new compensation alerts
          if (data.metrics.alerts && data.metrics.alerts.length > 0) {
            const currentAlert = data.metrics.alerts[0];
            if (currentAlert !== lastAlertSpoken.current) {
              speakFeedback(`Warning: ${currentAlert}`);
              lastAlertSpoken.current = currentAlert;
            }
          } else {
            lastAlertSpoken.current = ""; // Reset when form is corrected
          }
        }
      } catch (e) {
        console.error(e);
      }
    };

    return () => { if (wsRef.current) wsRef.current.close(); };
  }, []);

  useEffect(() => {
    const initializeAI = async () => {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
      );
      landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        },
        runningMode: "VIDEO",
        numPoses: 1
      });
      detectMovement();
    };
    if (currentView === 'patient') initializeAI();
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [currentView, detectMovement]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      <header className="bg-white border-b border-slate-200 p-4 flex items-center justify-between z-10 relative shadow-sm">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Neural-Kinematic <span className="text-blue-600 font-medium">Research OS</span></h1>
        
        <div className="flex space-x-2">
          <button 
            onClick={() => setCurrentView('patient')}
            className={`px-4 py-2 rounded-md font-medium transition-colors text-sm ${currentView === 'patient' ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Patient Capture
          </button>
          <button 
            onClick={() => setCurrentView('doctor')}
            className={`px-4 py-2 rounded-md font-medium transition-colors text-sm ${currentView === 'doctor' ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Clinical Dashboard
          </button>
        </div>
      </header>

      <main className="p-6 flex-1 max-w-7xl mx-auto w-full">
        {currentView === 'patient' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-slate-800">Live Telemetry Capture</h2>
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                </span>
              </div>
              <div className="relative bg-slate-900 aspect-video rounded-lg overflow-hidden flex items-center justify-center border border-slate-300">
                <Webcam ref={webcamRef} className="absolute w-full h-full object-cover transform scale-x-[-1]" />
                <canvas ref={canvasRef} className="absolute w-full h-full object-cover z-10 transform scale-x-[-1]" />
              </div>
              <div className="mt-4 text-sm text-slate-500 text-center">
                Ensure full body visibility for accurate kinematic processing.
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <ClinicalDashboard metrics={clinicalMetrics} onReset={saveAndResetSession} />
              <SessionHistory refreshTrigger={historyTrigger} />
            </div>

          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 transition-opacity duration-300">
            <div className="lg:col-span-2">
              <DoctorDashboard />
            </div>
            <div className="lg:col-span-1">
              <AIChat />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App