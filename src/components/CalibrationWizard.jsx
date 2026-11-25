function CalibrationWizard({
  tracker,
  calibrationState,
  onSelectStep,
  onSkipCalibration,
  onRecalibrate,
}) {
  const { status, step, progressSec, durationSec, feedback, profile } = calibrationState;
  const isHands = tracker === 'hands';
  const pct = Math.min(100, Math.round((progressSec / Math.max(0.1, durationSec)) * 100));

  if (status === 'calibrated') {
    return (
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 bg-green-100/70 border border-green-200 rounded-lg px-3 py-1.5 text-xs font-mono">
        <div className="flex items-center gap-2 text-emerald-800 min-w-0">
          <span className="font-medium truncate">
            ●{' '}
            {profile?.skipped
              ? 'Direct Tracking (Uncalibrated)'
              : profile?.manualFallback
              ? 'Baseline Calibration Active'
              : 'Coordinates Normalized'}
          </span>
          {!profile?.skipped && !profile?.manualFallback && profile && (
            <span className="text-slate-600 hidden sm:inline shrink-0 tabular-nums">
              · Scale {profile.scale.toFixed(2)} ({profile.sampleCount} pts)
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onRecalibrate}
          className="text-slate-800 hover:text-emerald-900 bg-green-50 border border-green-300 hover:border-emerald-500 px-2.5 py-1 rounded transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        >
          Recalibrate
        </button>
      </div>
    );
  }

  const steps = [
    {
      id: 1,
      label: isHands ? '1. Frame Hand' : '1. Frame Body',
      hint: isHands ? 'Reset to open-hand framing check' : 'Reset to body framing check',
    },
    {
      id: 2,
      label: isHands ? '2. 3s Open-Palm Hold' : '2. 3s T-Pose Hold',
      hint: 'Start 3-second guided calibration countdown',
    },
    {
      id: 3,
      label: '3. Normalize & Start',
      hint: 'Finalize coordinate normalization and begin tracking',
    },
  ];

  return (
    <div className="mb-2.5 bg-green-100/60 border border-green-300 rounded-lg p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-emerald-900">
          {isHands ? 'Hand Coordinate Calibration' : '3-Second T-Pose Calibration'}
        </span>
        <button
          type="button"
          onClick={onSkipCalibration}
          className="text-xs font-mono text-slate-700 hover:text-slate-950 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 rounded"
        >
          Skip Calibration
        </button>
      </div>

      {/* Interactive 3-Step Controls */}
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        {steps.map((s) => {
          const active = step === s.id;
          const done = step > s.id;
          return (
            <button
              key={s.id}
              type="button"
              title={s.hint}
              onClick={() => onSelectStep?.(s.id)}
              className={`px-2 py-1.5 rounded border text-xs font-mono truncate text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                active
                  ? 'bg-green-300/85 border-emerald-600 text-slate-950 font-semibold'
                  : done
                  ? 'bg-green-200 hover:bg-green-300/70 border-green-400 text-emerald-950'
                  : 'bg-green-50 hover:bg-green-100 border-green-300 text-slate-700 hover:text-slate-950'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Hold Progress Bar & Live Coaching Feedback */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs font-mono gap-2">
          <span
            className={`truncate ${
              step === 2 ? 'text-emerald-800 font-medium' : 'text-amber-800 font-medium'
            }`}
            title={feedback}
          >
            {feedback}
          </span>
          <span className="text-slate-800 tabular-nums shrink-0">
            {progressSec.toFixed(1)}s / {durationSec.toFixed(1)}s
          </span>
        </div>
        <div className="w-full bg-green-50 border border-green-200 rounded-full h-1.5 overflow-hidden">
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
