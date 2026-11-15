import { useEffect, useState, useRef } from 'react';
import * as THREE from 'three';

function DoctorDashboard() {
  const [populationData, setPopulationData] = useState([]);
  const mountRef = useRef(null);
  
  const jointsRef = useRef([]);
  const bonesRef = useRef([]);

  const POSE_CONNECTIONS = [
    [11, 13], [13, 15], [12, 14], [14, 16], 
    [11, 12], [23, 24], [11, 23], [12, 24], 
    [23, 25], [25, 27], [24, 26], [26, 28]  
  ];

  useEffect(() => {
    const fetchPopulation = async () => {
      try {
        const response = await fetch("http://127.0.0.1:8000/api/population");
        const data = await response.json();
        if (Array.isArray(data)) setPopulationData(data);
      } catch (error) {
        console.error("Error fetching population data:", error);
      }
    };
    fetchPopulation();
  }, []);

  useEffect(() => {
    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a); 

    const gridHelper = new THREE.GridHelper(4, 20, 0x334155, 0x1e293b);
    gridHelper.position.y = -1.5;
    scene.add(gridHelper);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    camera.position.set(0, 0, 3); 

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    mountRef.current.appendChild(renderer.domElement);

    const jointGeometry = new THREE.SphereGeometry(0.04, 16, 16);
    const jointMaterial = new THREE.MeshBasicMaterial({ color: 0x10b981 }); 
    
    for (let i = 0; i < 33; i++) {
      const sphere = new THREE.Mesh(jointGeometry, jointMaterial);
      scene.add(sphere);
      jointsRef.current.push(sphere);
    }

    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x3b82f6, linewidth: 2 });
    POSE_CONNECTIONS.forEach(() => {
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(lineGeometry, lineMaterial);
      scene.add(line);
      bonesRef.current.push(line);
    });

    const animate = () => {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      if (mountRef.current) mountRef.current.removeChild(renderer.domElement);
    };
  }, []);

  // MOVED: Function defined BEFORE it is used by the WebSocket
  const update3DSkeleton = (landmarks) => {
    if (!jointsRef.current.length) return;

    const scale = 2.5; 

    landmarks.forEach((lm, index) => {
      const joint = jointsRef.current[index];
      if (joint) {
        joint.position.set(
          (lm.x - 0.5) * scale,
          -(lm.y - 0.5) * scale,
          -(lm.z) * scale
        );
      }
    });

    POSE_CONNECTIONS.forEach(([startIdx, endIdx], i) => {
      const bone = bonesRef.current[i];
      const startLm = landmarks[startIdx];
      const endLm = landmarks[endIdx];

      if (bone && startLm && endLm) {
        const positions = bone.geometry.attributes.position.array;
        
        positions[0] = (startLm.x - 0.5) * scale;
        positions[1] = -(startLm.y - 0.5) * scale;
        positions[2] = -(startLm.z) * scale;
        
        positions[3] = (endLm.x - 0.5) * scale;
        positions[4] = -(endLm.y - 0.5) * scale;
        positions[5] = -(endLm.z) * scale;

        bone.geometry.attributes.position.needsUpdate = true;
      }
    });
  };

  useEffect(() => {
    const ws = new WebSocket("ws://127.0.0.1:8000/ws/movement");
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'clinical_telemetry' && data.raw_skeleton) {
          update3DSkeleton(data.raw_skeleton);
        }
      } catch (e) {
        console.error(e);
      }
    };
    
    return () => ws.close();
  }, []);

  const totalSessions = populationData.length;
  const avgSymmetry = totalSessions > 0 
    ? Math.round(populationData.reduce((acc, curr) => acc + curr.symmetry_score, 0) / totalSessions)
    : 0;

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mt-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Population Health Overview</h2>
        <span className="bg-emerald-50 text-emerald-700 text-xs font-bold px-3 py-1 rounded-full border border-emerald-200 shadow-sm animate-pulse">
          3D Telemetry Active
        </span>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-slate-50 p-6 rounded-lg border border-slate-100 flex flex-col justify-center">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Total Clinical Sessions</p>
          <p className="text-5xl font-bold text-slate-800">{totalSessions}</p>
        </div>
        <div className="bg-slate-50 p-6 rounded-lg border border-slate-100 flex flex-col justify-center">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Cohort Form Consistency</p>
          <p className="text-5xl font-bold text-slate-800">{avgSymmetry}%</p>
        </div>
        
        <div className="bg-slate-900 rounded-lg shadow-inner overflow-hidden relative h-48 border border-slate-800">
          <span className="absolute top-2 left-2 text-[10px] text-red-500 font-bold tracking-widest z-10">● LIVE 3D FEED</span>
          <div ref={mountRef} className="w-full h-full transform scale-x-[-1]" />
        </div>
      </div>

      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Recent Global Activity</h3>
      <div className="overflow-hidden bg-white rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="py-3 px-4 font-semibold">Patient ID</th>
              <th className="py-3 px-4 font-semibold">Date</th>
              <th className="py-3 px-4 font-semibold">Form Consistency</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {populationData.slice(0, 5).map(session => (
              <tr key={session.id} className="hover:bg-slate-50 transition-colors">
                <td className="py-3 px-4 text-xs font-mono text-slate-500">{session.patient_id.substring(0,8)}...</td>
                <td className="py-3 px-4 text-slate-700">{new Date(session.created_at).toLocaleDateString()}</td>
                <td className="py-3 px-4 font-bold text-blue-600">{session.symmetry_score}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DoctorDashboard;