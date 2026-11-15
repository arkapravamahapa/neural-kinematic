import { useCallback, useEffect, useState, useRef } from 'react';
import * as THREE from 'three';

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

function DoctorDashboard({ activeExercise }) {
  const [populationData, setPopulationData] = useState([]);
  const [wsTracker, setWsTracker] = useState(null);
  const [liveMetrics, setLiveMetrics] = useState(null);
  const [webglError, setWebglError] = useState(false);

  const liveTracker = wsTracker || activeExercise?.tracker || 'pose';

  const mountRef = useRef(null);
  const jointsRef = useRef([]);
  const poseBonesRef = useRef([]);
  const handBonesRef = useRef([]);
  const pinchLineRef = useRef(null);

  useEffect(() => {
    const fetchPopulation = async () => {
      try {
        const response = await fetch('/api/population');
        const data = await response.json();
        if (Array.isArray(data)) setPopulationData(data);
      } catch (error) {
        console.error('Error fetching population data:', error);
      }
    };
    fetchPopulation();
  }, []);

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
    scene.background = new THREE.Color(0x020617);
    scene.fog = new THREE.FogExp2(0x020617, 0.08);

    const ambientLight = new THREE.AmbientLight(0x94a3b8, 1.2);
    scene.add(ambientLight);
    const keyLight = new THREE.DirectionalLight(0x22d3ee, 1.4);
    keyLight.position.set(2, 3, 4);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x10b981, 1.0);
    rimLight.position.set(-2, -1, -3);
    scene.add(rimLight);

    const gridHelper = new THREE.GridHelper(5, 24, 0x1e293b, 0x0f172a);
    gridHelper.position.y = -1.4;
    scene.add(gridHelper);

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 100);
    camera.position.set(0, 0, 2.8);

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
      color: 0x10b981,
      emissive: 0x065f46,
      roughness: 0.35,
      metalness: 0.2,
    });

    jointsRef.current = [];
    for (let i = 0; i < 33; i++) {
      const sphere = new THREE.Mesh(jointGeometry, jointMaterial);
      sphere.visible = false;
      scene.add(sphere);
      jointsRef.current.push(sphere);
    }

    poseBonesRef.current = [];
    const poseLineMat = new THREE.LineBasicMaterial({ color: 0x22d3ee });
    POSE_CONNECTIONS.forEach(() => {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geom, poseLineMat);
      line.visible = false;
      scene.add(line);
      poseBonesRef.current.push(line);
    });

    handBonesRef.current = [];
    const handLineMat = new THREE.LineBasicMaterial({ color: 0x22d3ee });
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
    const pinchMat = new THREE.LineBasicMaterial({ color: 0xf59e0b });
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
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
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
      // Center around middle MCP (9) and scale up for clear hand articulation
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

  const totalSessions = populationData.length;
  const avgSymmetry =
    totalSessions > 0
      ? Math.round(
          populationData.reduce((acc, curr) => acc + curr.symmetry_score, 0) /
            totalSessions
        )
      : 0;

  return (
    <div className="bg-slate-900/80 backdrop-blur-md p-6 rounded-xl border border-slate-800">
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-100 tracking-tight">
            Clinical Command Center
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Cohort Outcomes
            <span className="mx-1.5 text-slate-600" aria-hidden="true">·</span>
            <span className="font-mono text-emerald-400">
              {liveTracker === 'hands' ? '21-Joint Hand Reconstruction' : '33-Joint Full-Body Reconstruction'}
            </span>
          </p>
        </div>
        <span className="text-xs font-mono text-cyan-400">
          {liveMetrics ? `● Live (${liveMetrics.reps} reps)` : '○ Awaiting Stream'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-slate-950/70 p-5 rounded-lg border border-slate-800 flex flex-col justify-center">
          <p className="text-xs font-medium text-slate-400 mb-1.5">Total Clinical Sessions</p>
          <p className="text-4xl font-bold font-mono tabular-nums text-slate-50">{totalSessions}</p>
        </div>
        <div className="bg-slate-950/70 p-5 rounded-lg border border-slate-800 flex flex-col justify-center">
          <p className="text-xs font-medium text-slate-400 mb-1.5">Cohort Form Consistency</p>
          <p className="text-4xl font-bold font-mono tabular-nums text-emerald-400">
            {avgSymmetry}<span className="text-lg text-slate-400 ml-0.5">%</span>
          </p>
        </div>
        <div className="bg-slate-950/70 p-5 rounded-lg border border-slate-800 flex flex-col justify-center">
          <p className="text-xs font-medium text-slate-400 mb-1.5">Live Joint Angle</p>
          <p className="text-4xl font-bold font-mono tabular-nums text-cyan-400">
            {liveMetrics ? (liveMetrics.smoothed_angle || 0).toFixed(1) : '0.0'}
            <span className="text-lg text-slate-400 ml-0.5">°</span>
          </p>
        </div>
      </div>

      <div className="bg-slate-950 rounded-lg overflow-hidden relative h-72 border border-slate-800 mb-6">
        <div className="absolute top-3 left-3 z-10 bg-slate-950/80 backdrop-blur-sm border border-slate-800 px-3 py-1.5 rounded-md text-xs font-mono text-slate-200 pointer-events-none">
          3D Spatial Feed · {liveTracker === 'hands' ? 'Hand Kinematics' : 'Body Pose'}
        </div>
        {webglError ? (
          <div className="w-full h-full flex items-center justify-center text-xs font-mono text-slate-400">
            WebGL 3D context unavailable in this browser session.
          </div>
        ) : (
          <div ref={mountRef} className="w-full h-full transform scale-x-[-1]" />
        )}
      </div>

      <h3 className="text-xs font-semibold text-slate-400 mb-3">Recent Cohort Sessions</h3>
      <div className="overflow-x-auto bg-slate-950/60 rounded-lg border border-slate-800">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800">
            <tr>
              <th className="py-3 px-4 font-medium">Patient ID</th>
              <th className="py-3 px-4 font-medium">Protocol</th>
              <th className="py-3 px-4 font-medium">Date</th>
              <th className="py-3 px-4 font-medium">Reps</th>
              <th className="py-3 px-4 font-medium">Form Match</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 font-mono tabular-nums">
            {populationData.length === 0 ? (
              <tr>
                <td colSpan="5" className="py-6 text-center text-slate-500 font-sans">
                  No recorded cohort sessions yet. Save a session from Patient Capture.
                </td>
              </tr>
            ) : (
              populationData.slice(0, 6).map((session) => (
                <tr key={session.id} className="hover:bg-slate-900/50 transition-colors">
                  <td className="py-3 px-4 text-slate-400">{session.patient_id.substring(0, 8)}...</td>
                  <td className="py-3 px-4 text-slate-200">{session.exercise_id}</td>
                  <td className="py-3 px-4 text-slate-400">
                    {new Date(session.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-4 text-slate-100">{session.rep_count}</td>
                  <td className="py-3 px-4 font-semibold text-cyan-400">
                    {session.symmetry_score}%
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