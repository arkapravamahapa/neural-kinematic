function ThresholdMonitor({
  exercise,
  safetyLimits,
  thresholdStatus,
  breachStats,
  audioAlertEnabled,
  onToggleAudioAlert,
  onUpdateSafetyLimits,
  onResetSafetyLimits,
  onTestAlertTone,
}) {
  const { min, max, boundsMin, boundsMax, unit } = safetyLimits;
  const span = Math.max(1, boundsMax - boundsMin);

  const minPct = Math.max(0, Math.min(100, ((min - boundsMin) / span) * 100));
  const maxPct = Math.max(0, Math.min(100, ((max - boundsMin) / span) * 100));

  const targetMin = exercise?.rom_target_min ?? min;
  const targetMax = exercise?.rom_target_max ?? max;
  const targetMinPct = Math.max(0, Math.min(100, ((targetMin - boundsMin) / span) * 100));
  const targetMaxPct = Math.max(0, Math.min(100, ((targetMax - boundsMin) / span) * 100));

  const liveVal = thresholdStatus?.value ?? 0;
  const livePct = Math.max(0, Math.min(100, ((liveVal - boundsMin) / span) * 100));

  const isCritical = thresholdStatus?.severity === 'critical';
  const isWarning = thresholdStatus?.severity === 'warning';
  const isNominal = thresholdStatus?.severity === 'nominal';

  const containerStyle = isCritical
    ? 'bg-rose-50 border-rose-300'
    : isWarning
    ? 'bg-amber-50 border-amber-300'
    : 'bg-green-100/55 border-green-200';

  const statusTextColor = isCritical
    ? 'text-rose-700 font-semibold'
    : isWarning
    ? 'text-amber-700 font-semibold'
    : isNominal
    ? 'text-emerald-800 font-semibold'
    : 'text-slate-600';

  const needleColor = isCritical
    ? 'bg-rose-600'
    : isWarning
    ? 'bg-amber-500'
    : isNominal
    ? 'bg-emerald-600'
    : 'bg-slate-400';

  const handleMinChange = (raw) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(boundsMin, Math.min(max - 5, parsed));
    onUpdateSafetyLimits({ ...safetyLimits, min: clamped });
  };

  const handleMaxChange = (raw) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(boundsMax, Math.max(min + 5, parsed));
    onUpdateSafetyLimits({ ...safetyLimits, max: clamped });
  };

  return (
    <div className={`mb-5 rounded-lg border p-4 transition-colors duration-150 ${containerStyle}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <p className="text-xs font-semibold text-slate-900">
            ROM Safety Threshold Monitor
          </p>
          <p className={`text-xs font-mono mt-0.5 ${statusTextColor}`}>
            {thresholdStatus?.label || '○ Standby'}
            <span className="text-slate-400 mx-1.5" aria-hidden="true">·</span>
            <span className="text-slate-700 font-normal tabular-nums">
              {liveVal.toFixed(1)}{unit} (Limit {min}–{max}{unit})
            </span>
          </p>
        </div>

        <div className="flex items-center gap-1.5 text-xs font-mono">
          <button
            type="button"
            onClick={onToggleAudioAlert}
            className={`px-2.5 py-1 rounded border transition-colors whitespace-nowrap shrink-0 ${
              audioAlertEnabled
                ? 'bg-green-200/70 border-emerald-400 text-emerald-900 hover:bg-green-200'
                : 'bg-green-50 border-green-300 text-slate-600 hover:text-slate-900'
            }`}
          >
            {audioAlertEnabled ? 'Chime On' : 'Chime Muted'}
          </button>
          <button
            type="button"
            onClick={onTestAlertTone}
            className="px-2.5 py-1 rounded border border-green-300 bg-green-50 text-slate-800 hover:bg-green-100 transition-colors whitespace-nowrap shrink-0"
          >
            Test Tone
          </button>
        </div>
      </div>

      {/* Live Status Message */}
      <p className={`text-xs mb-3 ${isCritical ? 'text-rose-800 font-medium' : isWarning ? 'text-amber-800' : 'text-slate-700'}`}>
        {thresholdStatus?.message}
      </p>

      {/* Precision Linear Range Gauge */}
      <div className="mb-4">
        <div className="relative h-3.5 w-full rounded bg-green-50 border border-green-300 overflow-hidden">
          {/* Lower Unsafe Zone */}
          <div
            className="absolute inset-y-0 left-0 bg-rose-200/75"
            style={{ width: `${minPct}%` }}
          />
          {/* Safe Corridor */}
          <div
            className="absolute inset-y-0 bg-emerald-100/90"
            style={{ left: `${minPct}%`, width: `${Math.max(0, maxPct - minPct)}%` }}
          />
          {/* Ideal Target Corridor */}
          <div
            className="absolute inset-y-0 bg-green-300/65"
            style={{
              left: `${Math.max(minPct, targetMinPct)}%`,
              width: `${Math.max(0, Math.min(maxPct, targetMaxPct) - Math.max(minPct, targetMinPct))}%`,
            }}
          />
          {/* Upper Unsafe Zone */}
          <div
            className="absolute inset-y-0 right-0 bg-rose-200/75"
            style={{ width: `${Math.max(0, 100 - maxPct)}%` }}
          />

          {/* Safety Boundary Markers */}
          <div
            className="absolute inset-y-0 w-0.5 bg-rose-500"
            style={{ left: `${minPct}%` }}
          />
          <div
            className="absolute inset-y-0 w-0.5 bg-rose-500"
            style={{ left: `${maxPct}%` }}
          />

          {/* Live Position Needle */}
          {thresholdStatus?.state !== 'standby' && (
            <div
              className={`absolute top-0 bottom-0 w-1.5 -ml-[3px] rounded-sm transition-all duration-75 ${needleColor}`}
              style={{ left: `${livePct}%` }}
            />
          )}
        </div>
        <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-600 mt-1">
          <span>{boundsMin}{unit}</span>
          <span className="text-rose-700">Min {min}{unit}</span>
          <span className="text-emerald-800">Target {targetMin}–{targetMax}{unit}</span>
          <span className="text-rose-700">Max {max}{unit}</span>
          <span>{boundsMax}{unit}</span>
        </div>
      </div>

      {/* Adjustable Threshold Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end pt-3 border-t border-green-200">
        <div>
          <label htmlFor="safety-min-input" className="block text-[11px] font-medium text-slate-700 mb-1">
            Min Safety Floor ({unit})
          </label>
          <input
            id="safety-min-input"
            type="number"
            min={boundsMin}
            max={max - 5}
            step={1}
            value={min}
            onChange={(e) => handleMinChange(e.target.value)}
            className="w-full bg-green-50 border border-green-300 text-slate-900 rounded px-2.5 py-1.5 text-xs font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
        </div>

        <div>
          <label htmlFor="safety-max-input" className="block text-[11px] font-medium text-slate-700 mb-1">
            Max Safety Ceiling ({unit})
          </label>
          <input
            id="safety-max-input"
            type="number"
            min={min + 5}
            max={boundsMax}
            step={1}
            value={max}
            onChange={(e) => handleMaxChange(e.target.value)}
            className="w-full bg-green-50 border border-green-300 text-slate-900 rounded px-2.5 py-1.5 text-xs font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
        </div>

        <button
          type="button"
          onClick={onResetSafetyLimits}
          className="bg-green-50 hover:bg-green-100 text-slate-800 border border-green-300 px-3 py-1.5 rounded text-xs font-mono transition-colors whitespace-nowrap shrink-0"
        >
          Reset Limits
        </button>
      </div>

      {/* Breach Counters & Latest Incident */}
      <div className="mt-3 pt-2.5 border-t border-green-200 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-700">
        <span>
          Upper Breaches:{' '}
          <span className={breachStats.upperCount > 0 ? 'text-rose-700 font-semibold' : 'text-slate-900'}>
            {breachStats.upperCount}
          </span>
          <span className="mx-2 text-green-300" aria-hidden="true">·</span>
          Lower Breaches:{' '}
          <span className={breachStats.lowerCount > 0 ? 'text-rose-700 font-semibold' : 'text-slate-900'}>
            {breachStats.lowerCount}
          </span>
        </span>
        {breachStats.lastEvent ? (
          <span className="text-rose-700 font-medium truncate max-w-full">
            Last: {breachStats.lastEvent}
          </span>
        ) : (
          <span className="text-slate-600">Zero safety violations</span>
        )}
      </div>
    </div>
  );
}

export default ThresholdMonitor;
