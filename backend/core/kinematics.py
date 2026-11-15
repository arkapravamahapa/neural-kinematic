# backend/core/kinematics.py
import numpy as np
from scipy.signal import savgol_filter, find_peaks
import math
from fastdtw import fastdtw
from scipy.spatial.distance import euclidean

class PatientSessionAnalyzer:
    def __init__(self, exercise_config: dict):
        self.config = exercise_config
        self.angle_history = []  
        self.time_history = []   
        self.rep_count = 0
        self.window_size = 15    
        self.poly_order = 3      
        
        self.baseline_rep_signature = []
        self.current_rep_buffer = []
        self.compensation_alerts = []
        self.is_in_rep = False
        
    def calculate_angle(self, a, b, c):
        radians = math.atan2(c['y'] - b['y'], c['x'] - b['x']) - math.atan2(a['y'] - b['y'], a['x'] - b['x'])
        angle = abs(radians * 180.0 / math.pi)
        return 360.0 - angle if angle > 180.0 else angle

    def check_compensations(self, landmarks):
        alerts = []
        checks = self.config.get("compensation_checks", [])
        
        if "trunk_lean" in checks:
            mid_shoulder_x = (landmarks[11]['x'] + landmarks[12]['x']) / 2
            mid_hip_x = (landmarks[23]['x'] + landmarks[24]['x']) / 2
            if abs(mid_shoulder_x - mid_hip_x) > 0.08:
                alerts.append("Trunk Lean Detected")
                
        if "shoulder_elevation" in checks:
            if abs(landmarks[11]['y'] - landmarks[12]['y']) > 0.05:
                alerts.append("Shoulder Elevation (Shrugging)")
                
        return list(set(alerts))

    def process_frame(self, landmarks, timestamp: float):
        joints = self.config["primary_angle_joints"]
        current_angle = self.calculate_angle(landmarks[joints[0]], landmarks[joints[1]], landmarks[joints[2]])
        
        self.angle_history.append(current_angle)
        self.time_history.append(timestamp)
        
        current_compensations = self.check_compensations(landmarks)
        if current_compensations:
            self.compensation_alerts.extend(current_compensations)
            self.compensation_alerts = list(set(self.compensation_alerts))
        
        if len(self.angle_history) < self.window_size:
            # FIX: Cast buffering outputs
            return {"status": "buffering", "reps": int(self.rep_count), "smoothed_angle": float(round(current_angle, 2)), "alerts": []}
            
        recent_angles = self.angle_history[-self.window_size:]
        smoothed_signal = savgol_filter(recent_angles, self.window_size, self.poly_order)
        current_smoothed = smoothed_signal[-1]
        
        data_len = len(self.angle_history)
        w_len = data_len if data_len % 2 != 0 else data_len - 1
        w_len = min(w_len, 31)
        w_len = max(w_len, 5) 
        
        all_smoothed = savgol_filter(self.angle_history, window_length=w_len, polyorder=3)
        inverted_signal = -np.array(all_smoothed)
        prominence = self.config.get("rep_trigger_prominence", 30)
        peaks, _ = find_peaks(inverted_signal, prominence=prominence)
        
        new_rep_count = len(peaks)
        
        dtw_score = 0.0
        if new_rep_count > self.rep_count:
            if self.rep_count == 0:
                self.baseline_rep_signature = self.current_rep_buffer.copy()
            else:
                distance, path = fastdtw(self.baseline_rep_signature, self.current_rep_buffer, dist=euclidean)
                dtw_score = max(0, 100 - (distance / len(self.current_rep_buffer)))
                
            self.current_rep_buffer = [] 
        else:
            self.current_rep_buffer.append(current_smoothed)
            
        self.rep_count = new_rep_count
        jerk_metric = self._calculate_jerk()

        # FIX: Cast all SciPy NumPy outputs to standard Python primitives for JSON serialization
        return {
            "status": "tracking",
            "smoothed_angle": float(round(current_smoothed, 2)),
            "reps": int(self.rep_count),
            "jerk_score": float(jerk_metric),
            "rom_max": float(round(max(all_smoothed), 2)),
            "rom_min": float(round(min(all_smoothed), 2)),
            "dtw_consistency": float(round(dtw_score, 1)) if dtw_score > 0 else 100.0,
            "alerts": self.compensation_alerts[-2:] 
        }

    def _calculate_jerk(self):
        if len(self.angle_history) < 4: return 0.0
        dt = 0.033 
        velocity = np.gradient(self.angle_history, dt)
        acceleration = np.gradient(velocity, dt)
        jerk = np.gradient(acceleration, dt)
        recent_jerk = jerk[-self.window_size:]
        jerk_rms = np.sqrt(np.mean(recent_jerk**2))
        return float(round(min(jerk_rms / 1000, 100), 2))