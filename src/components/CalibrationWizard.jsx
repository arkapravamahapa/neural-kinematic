function CalibrationWizard({
  tracker,
  calibrationState,
  onSkipCalibration,
  onRecalibrate,
}) {
  const { status, step, progressSec, durationSec, feedback, profile } = calibrationState;
  const isHands = tracker === 'hands';
  const pct = Math.min(100, Math.round((progressSec / Math.max(0.1, durationSec)) * 100));

  if (status === 'calibrated') {
    return (
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 bg-green-100/70 border border-green-200 rounded-lg px-3.5 py-2 text-xs font-mono">
        <div className="flex items-center gap-2 text-emerald-800">
          <span>● {profile?.skipped ? 'Direct Tracking (Uncalibrated)' : 'Coordinates Normalized'}</span>
          {!profile?.skipped && profile && (
            <span className="text-slate-600">
              · Scale {profile.scale.toFixed(2)} ({profile.sampleCount} samples)
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onRecalibrate}
          className="text-slate-800 hover:text-emerald-800 bg-green-50 border border-green-300 hover:border-emerald-500 px-2.5 py-1 rounded transition-colors"
        >
          Recalibrate
        </button>
      </div>
    );
  }

  const steps = [
    { id: 1, label: isHands ? '1. Frame Hand' : '1. Frame Body' },
    { id: 2, label: isHands ? '2. 3s Open-Palm Hold' : '2. 3s T-Pose Hold' },
    { id: 3, label: '3. Normalize & Start' },
  ];

  return (
    <div className="mb-3 bg-green-100/60 border border-green-300 rounded-lg p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <span className="text-xs font-semibold text-emerald-900">
          {isHands ? 'Hand Coordinate Calibration' : '3-Second T-Pose Calibration'}
        </span>
        <button
          type="button"
          onClick={onSkipCalibration}
          className="text-xs font-mono text-slate-700 hover:text-slate-950 underline underline-offset-2"
        >
          Skip Calibration
        </button>
      </div>

      {/* 3-Step Indicator */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {steps.map((s) => {
          const active = step === s.id;
          const done = step > s.id;
          return (
            <div
              key={s.id}
              className={`px-2.5 py-1.5 rounded border text-xs font-mono truncate ${
                active
                  ? 'bg-green-300/80 border-emerald-600 text-slate-950 font-semibold'
                  : done
                  ? 'bg-green-200 border-green-400 text-emerald-900'
                  : 'bg-green-50 border-green-200 text-slate-600'
              }`}
            >
              {s.label}
            </div>
          );
        })}
      </div>

      {/* Hold Progress Bar & Live Coaching Feedback */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className={step === 2 ? 'text-emerald-800 font-medium' : 'text-amber-800 font-medium'}>
            {feedback}
          </span>
          <span className="text-slate-800 tabular-nums shrink-0 ml-2">
            {progressSec.toFixed(1)}s / {durationSec.toFixed(1)}s
          </span>
        </div>
        <div className="w-full bg-green-50 border border-green-200 rounded-full h-2 overflow-hidden">
          <div
            className="bg-emerald-600 h-full rounded-full transition-all duration-75"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default CalibrationWizard;
