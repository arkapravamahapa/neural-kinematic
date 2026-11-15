function ClinicalDashboard({ metrics, onReset }) {
  let smoothnessLabel = "Calculating...";
  let smoothnessColor = "text-slate-500";
  
  if (metrics.status === "tracking") {
    if (metrics.jerk_score < 15) {
      smoothnessLabel = "Highly Stable";
      smoothnessColor = "text-emerald-600";
    } else if (metrics.jerk_score < 40) {
      smoothnessLabel = "Moderate Tremor";
      smoothnessColor = "text-amber-500";
    } else {
      smoothnessLabel = "Unstable/Erratic";
      smoothnessColor = "text-red-500";
    }
  }

  // DTW Consistency formatting
  const dtwScore = metrics.dtw_consistency || 100;
  const isInconsistent = dtwScore < 75;

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
      <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
        <h3 className="text-lg font-semibold text-slate-800">Biomechanical Analysis</h3>
        <button 
          onClick={onReset}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
        >
          Save Clinical Session
        </button>
      </div>

      {/* Compensation Alerts Panel */}
      {metrics.alerts && metrics.alerts.length > 0 && (
        <div className="mb-6 bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-md">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-amber-800">Posture Compensation Detected</h3>
              <div className="mt-2 text-sm text-amber-700">
                <ul className="list-disc pl-5 space-y-1">
                  {metrics.alerts.map((alert, idx) => (
                    <li key={idx} className="font-bold">{alert}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">SciPy Reps</p>
          <p className="text-3xl font-bold text-slate-800">{metrics.reps || 0}</p>
        </div>
        
        <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Jerk (RMS)</p>
          <div className="flex flex-col">
            <p className="text-3xl font-bold text-slate-800">{(metrics.jerk_score || 0).toFixed(1)}</p>
            <span className={`text-xs font-semibold mt-1 ${smoothnessColor}`}>{smoothnessLabel}</span>
          </div>
        </div>

        <div className={`p-4 rounded-lg border ${isInconsistent ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-100'}`}>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">DTW Form Match</p>
          <div className="flex flex-col">
            <p className={`text-3xl font-bold ${isInconsistent ? 'text-red-700' : 'text-slate-800'}`}>
              {dtwScore.toFixed(1)}%
            </p>
            <span className={`text-xs font-semibold mt-1 ${isInconsistent ? 'text-red-600' : 'text-emerald-600'}`}>
              {isInconsistent ? 'Form Degrading' : 'Consistent Baseline'}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="font-medium text-slate-700">Smoothed Joint Angle</span>
            <span className="font-bold text-blue-600">{(metrics.smoothed_angle || 0).toFixed(1)}°</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2">
            <div 
              className="bg-blue-500 h-2 rounded-full transition-all duration-75" 
              style={{ width: `${Math.min(100, ((metrics.smoothed_angle || 0) / 180) * 100)}%` }}
            ></div>
          </div>
        </div>
        
        <div className="flex justify-between text-sm pt-2 border-t border-slate-100">
          <span className="text-slate-500">Session Max Extension: <span className="font-bold text-slate-800">{(metrics.rom_max || 0).toFixed(1)}°</span></span>
          <span className="text-slate-500">Session Max Flexion: <span className="font-bold text-slate-800">{(metrics.rom_min || 0).toFixed(1)}°</span></span>
        </div>
      </div>
    </div>
  );
}

export default ClinicalDashboard;