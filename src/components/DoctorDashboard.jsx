import { useCallback, useEffect, useState, useRef } from 'react';
import * as THREE from 'three';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { computeLimbAsymmetry } from '../utils/clinicalAnalytics';

const POSE_CONNECTIONS = [
  [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 12], [23, 24], [11, 23], [12, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const CAMERA_PRESETS = {
  front: { label: 'Front', pos: [0, 0, 2.8] },
  side: { label: 'Side', pos: [2.7, 0.15, 0.4] },
  iso: { label: 'Isometric', pos: [1.9, 1.1, 2.2] },
};

function escapeCsvCell(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadCohortCsv(csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `clinical_cohort_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function DoctorDashboard({ activeExercise, refreshTrigger, onCohortChanged }) {
  const [populationData, setPopulationData] = useState([]);
  const [wsTracker, setWsTracker] = useState(null);
  const [liveMetrics, setLiveMetrics] = useState(null);
  const [webglError, setWebglError] = useState(false);

  const [cameraView, setCameraView] = useState('front');
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [patientFilter, setPatientFilter] = useState('ALL');
  const [protocolFilter, setProtocolFilter] = useState('ALL');
  const [sideFilter, setSideFilter] = useState('ALL');
  const [involvedSide, setInvolvedSide] = useState('Left');
  const [exportNotice, setExportNotice] = useState('');

  const liveTracker = wsTracker || activeExercise?.tracker || 'pose';

  const mountRef = useRef(null);
  const cameraRef = useRef(null);
  const autoOrbitRef = useRef(false);
  const orbitAngleRef = useRef(0);
  const jointsRef = useRef([]);
  const poseBonesRef = useRef([]);
  const handBonesRef = useRef([]);
  const pinchLineRef = useRef(null);

  useEffect(() => {
    autoOrbitRef.current = autoOrbit;
  }, [autoOrbit]);

  const applyCameraPreset = useCallback((presetKey) => {
    setCameraView(presetKey);
    setAutoOrbit(false);
    const cam = cameraRef.current;
    const preset = CAMERA_PRESETS[presetKey];
    if (cam && preset) {
      cam.position.set(preset.pos[0], preset.pos[1], preset.pos[2]);
      cam.lookAt(0, 0, 0);
    }
  }, []);

  const fetchPopulation = useCallback(async () => {
    try {
      const response = await fetch('/api/population');
      const data = await response.json();
      if (Array.isArray(data)) setPopulationData(data);
    } catch (error) {
      console.error('Error fetching population data:', error);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPopulation();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchPopulation, refreshTrigger]);

  useEffect(() => {
    const mountNode = mountRef.current;
    if (!mountNode) return;

    const width = mountNode.clientWidth || 540;
    const height = mountNode.clientHeight || 280;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      queueMicrotask(() => setWebglError(true));
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0fdf4);
    scene.fog = new THREE.FogExp2(0xf0fdf4, 0.05);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.3);
    scene.add(ambientLight);
    const keyLight = new THREE.DirectionalLight(0x10b981, 1.1);
    keyLight.position.set(2, 3, 4);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x94a3b8, 0.9);
    rimLight.position.set(-2, -1, -3);
    scene.add(rimLight);

    const gridHelper = new THREE.GridHelper(5, 24, 0x86efac, 0xbbf7d0);
    gridHelper.position.y = -1.4;
    scene.add(gridHelper);

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 100);
    camera.position.set(0, 0, 2.8);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    mountNode.appendChild(renderer.domElement);

    const handleContextLost = (e) => {
      e.preventDefault();
      setWebglError(true);
    };
    const handleContextRestored = () => setWebglError(false);
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const jointGeometry = new THREE.SphereGeometry(0.036, 16, 16);
    const jointMaterial = new THREE.MeshStandardMaterial({
      color: 0x059669,
      emissive: 0x064e3b,
      roughness: 0.35,
      metalness: 0.15,
    });

    jointsRef.current = [];
    for (let i = 0; i < 33; i++) {
      const sphere = new THREE.Mesh(jointGeometry, jointMaterial);
      sphere.visible = false;
      scene.add(sphere);
      jointsRef.current.push(sphere);
    }

    poseBonesRef.current = [];
    const poseLineMat = new THREE.LineBasicMaterial({ color: 0x16a34a });
    POSE_CONNECTIONS.forEach(() => {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geom, poseLineMat);
      line.visible = false;
      scene.add(line);
      poseBonesRef.current.push(line);
    });

    handBonesRef.current = [];
    const handLineMat = new THREE.LineBasicMaterial({ color: 0x16a34a });
    HAND_CONNECTIONS.forEach(() => {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geom, handLineMat);
      line.visible = false;
      scene.add(line);
      handBonesRef.current.push(line);
    });

    const pinchGeom = new THREE.BufferGeometry();
    pinchGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const pinchMat = new THREE.LineBasicMaterial({ color: 0xd97706 });
    const pinchLine = new THREE.Line(pinchGeom, pinchMat);
    pinchLine.visible = false;
    scene.add(pinchLine);
    pinchLineRef.current = pinchLine;

    const handleResize = () => {
      if (!mountNode) return;
      const w = mountNode.clientWidth || 540;
      const h = mountNode.clientHeight || 280;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    let animFrameId;
    const animate = () => {
      animFrameId = requestAnimationFrame(animate);
      if (autoOrbitRef.current) {
        orbitAngleRef.current += 0.008;
        const radius = 2.85;
        camera.position.set(
          Math.sin(orbitAngleRef.current) * radius,
          0.45,
          Math.cos(orbitAngleRef.current) * radius
        );
        camera.lookAt(0, 0, 0);
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      cameraRef.current = null;
      jointsRef.current = [];
      poseBonesRef.current = [];
      handBonesRef.current = [];
      pinchLineRef.current = null;
      renderer.dispose();
      if (mountNode && renderer.domElement.parentNode === mountNode) {
        mountNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  const update3DSkeleton = useCallback((landmarks, trackerMode) => {
    if (!jointsRef.current.length || !landmarks?.length) return;

    const isHands = trackerMode === 'hands';

    if (isHands) {
      const anchor = landmarks[9] || landmarks[0];
      const scale = 3.8;

      jointsRef.current.forEach((joint, idx) => {
        if (idx < 21 && landmarks[idx]) {
          const lm = landmarks[idx];
          joint.visible = true;
          joint.position.set(
            (lm.x - anchor.x) * scale,
            -(lm.y - anchor.y) * scale,
            -(lm.z - anchor.z) * scale
          );
        } else {
          joint.visible = false;
        }
      });

      poseBonesRef.current.forEach((b) => {
        b.visible = false;
      });

      HAND_CONNECTIONS.forEach(([startIdx, endIdx], i) => {
        const bone = handBonesRef.current[i];
        const a = landmarks[startIdx];
        const b = landmarks[endIdx];
        if (bone && a && b) {
          bone.visible = true;
          const pos = bone.geometry.attributes.position.array;
          pos[0] = (a.x - anchor.x) * scale;
          pos[1] = -(a.y - anchor.y) * scale;
          pos[2] = -(a.z - anchor.z) * scale;
          pos[3] = (b.x - anchor.x) * scale;
          pos[4] = -(b.y - anchor.y) * scale;
          pos[5] = -(b.z - anchor.z) * scale;
          bone.geometry.attributes.position.needsUpdate = true;
        }
      });

      if (pinchLineRef.current && landmarks[4] && landmarks[8]) {
        const a = landmarks[4];
        const b = landmarks[8];
        pinchLineRef.current.visible = true;
        const pos = pinchLineRef.current.geometry.attributes.position.array;
        pos[0] = (a.x - anchor.x) * scale;
        pos[1] = -(a.y - anchor.y) * scale;
        pos[2] = -(a.z - anchor.z) * scale;
        pos[3] = (b.x - anchor.x) * scale;
        pos[4] = -(b.y - anchor.y) * scale;
        pos[5] = -(b.z - anchor.z) * scale;
        pinchLineRef.current.geometry.attributes.position.needsUpdate = true;
      }
    } else {
      const scale = 2.4;

      jointsRef.current.forEach((joint, idx) => {
        if (landmarks[idx]) {
          const lm = landmarks[idx];
          joint.visible = true;
          joint.position.set(
            (lm.x - 0.5) * scale,
            -(lm.y - 0.5) * scale,
            -(lm.z || 0) * scale
          );
        } else {
          joint.visible = false;
        }
      });

      handBonesRef.current.forEach((b) => {
        b.visible = false;
      });
      if (pinchLineRef.current) pinchLineRef.current.visible = false;

      POSE_CONNECTIONS.forEach(([startIdx, endIdx], i) => {
        const bone = poseBonesRef.current[i];
        const a = landmarks[startIdx];
        const b = landmarks[endIdx];
        if (bone && a && b) {
          bone.visible = true;
          const pos = bone.geometry.attributes.position.array;
          pos[0] = (a.x - 0.5) * scale;
          pos[1] = -(a.y - 0.5) * scale;
          pos[2] = -(a.z || 0) * scale;
          pos[3] = (b.x - 0.5) * scale;
          pos[4] = -(b.y - 0.5) * scale;
          pos[5] = -(b.z || 0) * scale;
          bone.geometry.attributes.position.needsUpdate = true;
        }
      });
    }
  }, []);

  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/movement`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'exercise_changed' && data.config?.tracker) {
          setWsTracker(data.config.tracker);
        } else if (data.type === 'clinical_telemetry' && data.raw_skeleton) {
          const trackerMode = data.tracker || data.metrics?.tracker || 'pose';
          setWsTracker(trackerMode);
          if (data.metrics) setLiveMetrics(data.metrics);
          update3DSkeleton(data.raw_skeleton, trackerMode);
        }
      } catch (e) {
        console.error(e);
      }
    };

    return () => ws.close();
  }, [update3DSkeleton]);

  const uniquePatients = Array.from(new Set(populationData.map((s) => s.patient_id)));
  const uniqueProtocols = Array.from(new Set(populationData.map((s) => s.exercise_id)));

  const filteredSessions = populationData.filter((s) => {
    if (patientFilter !== 'ALL' && s.patient_id !== patientFilter) return false;
    if (protocolFilter !== 'ALL' && s.exercise_id !== protocolFilter) return false;
    if (sideFilter !== 'ALL' && (s.limb_side || 'Left') !== sideFilter) return false;
    return true;
  });

  const cohortAsymmetry = computeLimbAsymmetry(
    filteredSessions,
    protocolFilter !== 'ALL' ? protocolFilter : null,
    involvedSide
  );

  const totalSessions = filteredSessions.length;
  const avgSymmetry =
    totalSessions > 0
      ? Math.round(
          filteredSessions.reduce((acc, curr) => acc + Number(curr.symmetry_score || 0), 0) /
            totalSessions
        )
      : 0;
  const avgAdherence =
    totalSessions > 0
      ? Math.round(
          filteredSessions.reduce((acc, curr) => acc + Number(curr.adherence_score || 0), 0) /
            totalSessions
        )
      : 0;
  const avgPeakRom =
    totalSessions > 0
      ? (
          filteredSessions.reduce((acc, curr) => acc + Number(curr.left_max_rom || 0), 0) /
          totalSessions
        ).toFixed(1)
      : '0.0';

  const trendChartData = filteredSessions
    .slice(0, 12)
    .reverse()
    .map((s, idx) => ({
      label: `#${idx + 1} ${s.patient_id}`,
      consistency: Number(s.symmetry_score || 0),
      maxRom: Number(s.left_max_rom || 0),
      reps: Number(s.rep_count || 0),
    }));

  const handleExportCohortCSV = () => {
    const header =
      'Session_ID,Timestamp_ISO,Patient_ID,Protocol_ID,Limb_Side,Reps,Max_ROM_deg,Form_Consistency_pct,Adherence_pct,Safe_Zone_pct,Compensations,Fatigue_Insight,Clinician_Notes\n';
    const body = filteredSessions
      .map((s) =>
        [
          s.id,
          s.created_at,
          s.patient_id,
          s.exercise_id,
          s.limb_side || 'Left',
          s.rep_count,
          s.left_max_rom,
          s.symmetry_score,
          s.adherence_score ?? 0,
          s.safe_zone_pct ?? 0,
          s.compensation_count ?? 0,
          s.fatigue_summary || '',
          s.notes || '',
        ]
          .map(escapeCsvCell)
          .join(',')
      )
      .join('\n');

    downloadCohortCsv(header + body);

    setExportNotice(`Exported ${filteredSessions.length} cohort record(s) to CSV`);
    setTimeout(() => setExportNotice(''), 3000);
  };

  const handleDeleteRecord = async (sessionId) => {
    try {
      const res = await fetch(`/api/history/${sessionId}`, { method: 'DELETE' });
      if (res.ok) {
        setPopulationData((prev) => prev.filter((item) => item.id !== sessionId));
        onCohortChanged?.();
      }
    } catch (err) {
      console.error('Error deleting cohort record:', err);
    }
  };

  return (
    <div className="bg-green-50 p-5 rounded-xl border border-green-200">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-5 border-b border-green-200 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 tracking-tight">
            Clinical Command Center
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Cohort Outcomes &amp; 3D Biomechanical Analytics
            <span className="mx-1.5 text-green-300" aria-hidden="true">·</span>
            <span className="font-mono text-emerald-800 font-medium">
              {liveTracker === 'hands' ? '21-Joint Hand Reconstruction' : '33-Joint Full-Body Reconstruction'}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <span className="text-emerald-800 font-medium">
            {liveMetrics ? `● Live (${liveMetrics.reps} reps)` : '○ Awaiting Stream'}
          </span>
          <button
            type="button"
            onClick={fetchPopulation}
            className="px-2.5 py-1.5 rounded-md bg-green-100/70 hover:bg-green-200/70 border border-green-300 text-slate-800 transition-colors"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={handleExportCohortCSV}
            disabled={filteredSessions.length === 0}
            className="px-3 py-1.5 rounded-md bg-green-300 hover:bg-green-200 disabled:opacity-50 border border-green-400 text-slate-950 font-semibold transition-colors"
          >
            Export Cohort CSV
          </button>
        </div>
      </div>

      {exportNotice && (
        <div className="mb-4 bg-green-200/60 border border-green-300 text-emerald-900 px-3.5 py-2 rounded-lg text-xs font-mono">
          {exportNotice}
        </div>
      )}

      {/* 4-Up Clinical KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div className="bg-green-100/55 p-4 rounded-lg border border-green-200">
          <p className="text-xs font-medium text-slate-600 mb-1">Clinical Sessions</p>
          <p className="text-3xl font-bold font-mono tabular-nums text-slate-900">{totalSessions}</p>
          <span className="text-[11px] font-mono text-slate-600 mt-0.5 block">
            {uniquePatients.length} patient(s)
          </span>
        </div>

        <div className="bg-green-100/55 p-4 rounded-lg border border-green-200">
          <p className="text-xs font-medium text-slate-600 mb-1">Cohort Form Match</p>
          <p className="text-3xl font-bold font-mono tabular-nums text-emerald-800">
            {avgSymmetry}
            <span className="text-base text-slate-600 ml-0.5">%</span>
          </p>
          <span className="text-[11px] font-mono text-emerald-800 mt-0.5 block">
            Mean DTW Score
          </span>
        </div>

        <div className="bg-green-100/55 p-4 rounded-lg border border-green-200">
          <p className="text-xs font-medium text-slate-600 mb-1">Avg Peak ROM / Adherence</p>
          <p className="text-3xl font-bold font-mono tabular-nums text-slate-900">
            {avgPeakRom}
            <span className="text-base text-slate-600 ml-0.5">°</span>
          </p>
          <span className="text-[11px] font-mono text-emerald-800 mt-0.5 block">
            Rx Adherence {avgAdherence}%
          </span>
        </div>

        <div className="bg-green-100/55 p-4 rounded-lg border border-green-200">
          <p className="text-xs font-medium text-slate-600 mb-1">
            {liveTracker === 'hands' ? 'Live Pinch Aperture' : 'Live Joint Angle'}
          </p>
          <p className="text-3xl font-bold font-mono tabular-nums text-green-800">
            {liveMetrics
              ? liveTracker === 'hands'
                ? (liveMetrics.pinch_aperture || 0).toFixed(1)
                : (liveMetrics.smoothed_angle || 0).toFixed(1)
              : '0.0'}
            <span className="text-base text-slate-600 ml-0.5">
              {liveTracker === 'hands' ? '%' : '°'}
            </span>
          </p>
          <span className="text-[11px] font-mono text-slate-600 mt-0.5 block">
            Jerk {(liveMetrics?.jerk_score || 0).toFixed(1)} · DTW {(liveMetrics?.dtw_consistency ?? 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* 3D Spatial Viewport + Interactive Camera Controls */}
      <div className="bg-green-50 rounded-lg overflow-hidden relative h-72 border border-green-200 mb-5">
        <div className="absolute top-3 left-3 z-10 bg-green-50/90 backdrop-blur-sm border border-green-200 px-3 py-1.5 rounded-md text-xs font-mono text-slate-800 pointer-events-none">
          3D Spatial Feed · {liveTracker === 'hands' ? 'Hand Kinematics' : 'Body Pose'}
        </div>

        <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-green-50/90 backdrop-blur-sm border border-green-200 p-1 rounded-md text-[11px] font-mono">
          {Object.entries(CAMERA_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              onClick={() => applyCameraPreset(key)}
              className={`px-2 py-0.5 rounded transition-colors ${
                !autoOrbit && cameraView === key
                  ? 'bg-green-300 text-slate-950 font-semibold'
                  : 'text-slate-700 hover:bg-green-100'
              }`}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAutoOrbit((prev) => !prev)}
            className={`px-2 py-0.5 rounded transition-colors ${
              autoOrbit
                ? 'bg-emerald-700 text-green-50 font-semibold'
                : 'text-slate-700 hover:bg-green-100'
            }`}
          >
            {autoOrbit ? 'Orbit On' : 'Orbit'}
          </button>
        </div>

        <div className="absolute bottom-3 left-3 z-10 bg-green-50/90 backdrop-blur-sm border border-green-200 px-3 py-1 rounded-md text-[11px] font-mono tabular-nums text-slate-800 pointer-events-none">
          {liveMetrics
            ? `Protocol ${activeExercise?.name || 'Active'} · Reps ${liveMetrics.reps} · DTW ${(liveMetrics.dtw_consistency ?? 100).toFixed(1)}%`
            : 'Keep Patient Capture active to stream live 3D joint coordinates'}
        </div>

        {webglError ? (
          <div className="w-full h-full flex items-center justify-center text-xs font-mono text-slate-600">
            WebGL 3D context unavailable in this browser session.
          </div>
        ) : (
          <div ref={mountRef} className="w-full h-full transform scale-x-[-1]" />
        )}
      </div>

      {/* Cohort Recovery Trend Chart */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-slate-800">
            Cohort Form Consistency &amp; Peak ROM Trend
          </h3>
          <span className="text-[11px] font-mono text-slate-600">
            Green Bar: Form Match (%) · Amber Line: Peak ROM (°)
          </span>
        </div>
        {trendChartData.length === 0 ? (
          <div className="h-40 rounded-lg border border-green-200 bg-green-100/45 flex items-center justify-center text-xs text-slate-600">
            Save one or more sessions from Patient Capture to visualize longitudinal cohort trends.
          </div>
        ) : (
          <div className="h-44 w-full rounded-lg border border-green-200 bg-green-100/40 pt-3 pr-2 pb-1">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trendChartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#BBF7D0" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#475569', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                  axisLine={{ stroke: '#BBF7D0' }}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="left"
                  domain={[0, 100]}
                  tick={{ fill: '#15803D', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[0, 180]}
                  tick={{ fill: '#B45309', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v}°`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#F0FDF4',
                    borderColor: '#BBF7D0',
                    borderRadius: '0.5rem',
                    fontSize: '12px',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                />
                <Bar yAxisId="left" dataKey="consistency" name="Form Match (%)" fill="#4ADE80" radius={[4, 4, 0, 0]} maxBarSize={32} />
                <Line yAxisId="right" type="monotone" dataKey="maxRom" name="Peak ROM (°)" stroke="#D97706" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Cohort Left-vs-Right Limb Symmetry Summary */}
      <div className="mb-5 bg-green-100/50 border border-green-200 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div>
          <span className="font-sans font-semibold text-slate-900">
            Side-to-Side Limb Symmetry (Involved: {involvedSide})
          </span>
          <p className="text-slate-700 mt-0.5 tabular-nums">
            Left: {cohortAsymmetry.leftRom !== null ? `${cohortAsymmetry.leftRom.toFixed(1)}°` : '—'}
            <span className="mx-1.5 text-green-300">·</span>
            Right: {cohortAsymmetry.rightRom !== null ? `${cohortAsymmetry.rightRom.toFixed(1)}°` : '—'}
            <span className="mx-1.5 text-green-300">·</span>
            <span className="font-semibold text-emerald-800">
              {cohortAsymmetry.hasComparison
                ? `LSI ${cohortAsymmetry.lsiPct}% (${cohortAsymmetry.romDeficit > 0 ? '+' : ''}${cohortAsymmetry.romDeficit}°)`
                : cohortAsymmetry.trendLabel}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-600 font-sans">Affected:</span>
          {['Left', 'Right'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setInvolvedSide(s)}
              className={`px-2 py-0.5 rounded border transition-colors ${
                involvedSide === s
                  ? 'bg-green-300 text-slate-950 border-green-400 font-semibold'
                  : 'bg-green-50 text-slate-700 border-green-300 hover:bg-green-100'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Filterable Cohort Sessions Table */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-xs font-semibold text-slate-800">Cohort Clinical Records</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <select
            aria-label="Filter by patient"
            value={patientFilter}
            onChange={(e) => setPatientFilter(e.target.value)}
            className="bg-green-50 border border-green-300 rounded px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
          >
            <option value="ALL">All Patients</option>
            {uniquePatients.map((pid) => (
              <option key={pid} value={pid}>
                {pid}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by protocol"
            value={protocolFilter}
            onChange={(e) => setProtocolFilter(e.target.value)}
            className="bg-green-50 border border-green-300 rounded px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
          >
            <option value="ALL">All Protocols</option>
            {uniqueProtocols.map((exId) => (
              <option key={exId} value={exId}>
                {exId}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by limb side"
            value={sideFilter}
            onChange={(e) => setSideFilter(e.target.value)}
            className="bg-green-50 border border-green-300 rounded px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-600"
          >
            <option value="ALL">All Sides</option>
            <option value="Left">Left</option>
            <option value="Right">Right</option>
            <option value="Bilateral">Bilateral</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto bg-green-50/70 rounded-lg border border-green-200">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-green-100/70 text-slate-700 border-b border-green-200">
            <tr>
              <th className="py-2.5 px-3 font-medium">Patient / Side</th>
              <th className="py-2.5 px-3 font-medium">Protocol, Drift &amp; Notes</th>
              <th className="py-2.5 px-3 font-medium">Date</th>
              <th className="py-2.5 px-3 font-medium">Reps / ROM</th>
              <th className="py-2.5 px-3 font-medium">Form / Adherence</th>
              <th className="py-2.5 px-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-green-200/80 font-mono tabular-nums">
            {filteredSessions.length === 0 ? (
              <tr>
                <td colSpan="6" className="py-6 text-center text-slate-600 font-sans">
                  No recorded cohort sessions match the selected filters. Save a session from Patient Capture.
                </td>
              </tr>
            ) : (
              filteredSessions.map((session) => (
                <tr key={session.id} className="hover:bg-green-100/50 transition-colors">
                  <td className="py-2.5 px-3 align-top whitespace-nowrap">
                    <div className="text-slate-800 font-semibold">{session.patient_id}</div>
                    <div className="text-[11px] text-emerald-800">
                      {session.limb_side || 'Left'}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-slate-800 align-top">
                    <div className="font-medium">{session.exercise_id}</div>
                    {session.fatigue_summary && (
                      <div
                        className={`text-[11px] font-sans mt-0.5 ${
                          session.fatigue_severity === 'critical'
                            ? 'text-rose-700'
                            : session.fatigue_severity === 'warning'
                            ? 'text-amber-700'
                            : 'text-emerald-800'
                        }`}
                      >
                        {session.fatigue_summary}
                      </div>
                    )}
                    {session.notes && (
                      <div
                        className="text-[11px] font-sans text-slate-600 mt-0.5 max-w-[220px] truncate"
                        title={session.notes}
                      >
                        Note: {session.notes}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap align-top">
                    {new Date(session.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2.5 px-3 align-top whitespace-nowrap">
                    <div className="text-slate-900 font-semibold">{session.rep_count} reps</div>
                    <div className="text-[11px] text-slate-700">{session.left_max_rom}° peak</div>
                  </td>
                  <td className="py-2.5 px-3 align-top whitespace-nowrap">
                    <div className="font-semibold text-emerald-800">
                      DTW {session.symmetry_score}%
                    </div>
                    <div className="text-[11px] text-slate-700">
                      Rx {session.adherence_score ?? 0}% (Safe {session.safe_zone_pct ?? 0}%)
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right align-top">
                    <button
                      type="button"
                      onClick={() => handleDeleteRecord(session.id)}
                      className="text-[11px] text-rose-700 hover:text-rose-900 underline underline-offset-2"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DoctorDashboard;