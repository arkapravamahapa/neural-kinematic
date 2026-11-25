import { useState } from 'react';
import {
  CLINICAL_THRESHOLD_CATALOG,
  getProtocolCatalogEntry,
} from '../utils/thresholdMonitor';

function RangeBarPreview({ min, max, targetMin, targetMax, boundsMin, boundsMax, unit }) {
  const span = Math.max(1, boundsMax - boundsMin);
  const minPct = Math.max(0, Math.min(100, ((min - boundsMin) / span) * 100));
  const maxPct = Math.max(0, Math.min(100, ((max - boundsMin) / span) * 100));
  const tMinPct = Math.max(
    minPct,
    Math.min(maxPct, (((targetMin ?? min) - boundsMin) / span) * 100)
  );
  const tMaxPct = Math.max(
    tMinPct,
    Math.min(maxPct, (((targetMax ?? max) - boundsMin) / span) * 100)
  );

  return (
    <div className="w-full">
      <div className="relative h-2.5 w-full rounded bg-green-100 border border-green-200 overflow-hidden">
        <div
          className="absolute inset-y-0 bg-emerald-200"
          style={{ left: `${minPct}%`, width: `${Math.max(2, maxPct - minPct)}%` }}
        />
        <div
          className="absolute inset-y-0 bg-emerald-500/80"
          style={{ left: `${tMinPct}%`, width: `${Math.max(2, tMaxPct - tMinPct)}%` }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-rose-500"
          style={{ left: `${minPct}%` }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-rose-500"
          style={{ left: `${maxPct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono tabular-nums text-slate-500 mt-0.5">
        <span>{boundsMin}{unit}</span>
        <span className="text-slate-700 font-medium">
          Safe {min}–{max}{unit}
        </span>
        <span>{boundsMax}{unit}</span>
      </div>
    </div>
  );
}

function ThresholdMonitor({
  exercise,
  safetyLimits,
  thresholdStatus,
  monitoringEnabled,
  breachStats,
  audioAlertEnabled,
  onToggleAudioAlert,
  onApplySafetyLimits,
  onSetMonitoringEnabled,
  onResetSafetyLimits,
  onTestAlertTone,
}) {
  const { min, max, boundsMin, boundsMax, unit } = safetyLimits;
  const [draftMin, setDraftMin] = useState(String(min));
  const [draftMax, setDraftMax] = useState(String(max));
  const [validationError, setValidationError] = useState('');
  const [showReferenceChart, setShowReferenceChart] = useState(true);
  const [referenceTab, setReferenceTab] = useState('current');

  const catalogEntry = getProtocolCatalogEntry(exercise?.key);
  const allProtocols = Object.values(CLINICAL_THRESHOLD_CATALOG);

  const parsedDraftMin = Number(draftMin);
  const parsedDraftMax = Number(draftMax);
  const previewMin = Number.isFinite(parsedDraftMin)
    ? Math.max(boundsMin, Math.min(boundsMax, parsedDraftMin))
    : min;
  const previewMax = Number.isFinite(parsedDraftMax)
    ? Math.max(boundsMin, Math.min(boundsMax, parsedDraftMax))
    : max;

  const displayMin = monitoringEnabled ? min : Math.min(previewMin, previewMax);
  const displayMax = monitoringEnabled ? max : Math.max(previewMin, previewMax);

  const span = Math.max(1, boundsMax - boundsMin);
  const minPct = Math.max(0, Math.min(100, ((displayMin - boundsMin) / span) * 100));
  const maxPct = Math.max(0, Math.min(100, ((displayMax - boundsMin) / span) * 100));

  const targetMin = exercise?.rom_target_min ?? displayMin;
  const targetMax = exercise?.rom_target_max ?? displayMax;
  const targetMinPct = Math.max(0, Math.min(100, ((targetMin - boundsMin) / span) * 100));
  const targetMaxPct = Math.max(0, Math.min(100, ((targetMax - boundsMin) / span) * 100));

  const liveVal = thresholdStatus?.value ?? 0;
  const livePct = Math.max(0, Math.min(100, ((liveVal - boundsMin) / span) * 100));

  const isCritical = monitoringEnabled && thresholdStatus?.severity === 'critical';
  const isWarning = monitoringEnabled && thresholdStatus?.severity === 'warning';
  const isNominal = monitoringEnabled && thresholdStatus?.severity === 'nominal';

  const hasUnsavedChanges =
    Number.isFinite(parsedDraftMin) &&
    Number.isFinite(parsedDraftMax) &&
    (parsedDraftMin !== min || parsedDraftMax !== max);

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
    : 'text-slate-600 font-medium';

  const needleColor = isCritical
    ? 'bg-rose-600'
    : isWarning
    ? 'bg-amber-500'
    : isNominal
    ? 'bg-emerald-600'
    : 'bg-emerald-700/70';

  const handleApplyAndArm = () => {
    const nextMin = Number(draftMin);
    const nextMax = Number(draftMax);
    if (!Number.isFinite(nextMin) || !Number.isFinite(nextMax)) {
      setValidationError('Enter valid numeric Min and Max limits.');
      return;
    }
    if (nextMin < boundsMin || nextMax > boundsMax) {
      setValidationError(`Limits must stay between ${boundsMin}${unit} and ${boundsMax}${unit}.`);
      return;
    }
    if (nextMax - nextMin < 5) {
      setValidationError(`Max ceiling must be at least 5${unit} above Min floor.`);
      return;
    }

    setValidationError('');
    setDraftMin(String(nextMin));
    setDraftMax(String(nextMax));
    onApplySafetyLimits({ ...safetyLimits, min: nextMin, max: nextMax }, true);
  };

  const handleApplyPreset = (preset) => {
    setValidationError('');
    setDraftMin(String(preset.min));
    setDraftMax(String(preset.max));
    onApplySafetyLimits({ ...safetyLimits, min: preset.min, max: preset.max }, true);
  };

  const handleLoadPresetToInputs = (preset) => {
    setValidationError('');
    setDraftMin(String(preset.min));
    setDraftMax(String(preset.max));
  };

  const handleCaptureLive = (which) => {
    const rounded = Math.round(liveVal);
    if (!Number.isFinite(rounded)) return;
    setValidationError('');
    if (which === 'min') {
      const clamped = Math.max(boundsMin, Math.min(boundsMax - 5, rounded));
      setDraftMin(String(clamped));
    } else {
      const clamped = Math.min(boundsMax, Math.max(boundsMin + 5, rounded));
      setDraftMax(String(clamped));
    }
  };

  const handleResetClick = () => {
    setValidationError('');
    const defaults = onResetSafetyLimits();
    if (defaults) {
      setDraftMin(String(defaults.min));
      setDraftMax(String(defaults.max));
    }
  };

  return (
    <div className={`mb-5 rounded-lg border p-4 transition-colors duration-150 ${containerStyle}`}>
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <p className="text-xs font-semibold text-slate-900">
            ROM Safety Threshold Monitor
          </p>
          <p className={`text-xs font-mono mt-0.5 ${statusTextColor}`}>
            {thresholdStatus?.label || '○ Manual Mode (Alerts Off)'}
            <span className="text-slate-400 mx-1.5" aria-hidden="true">·</span>
            <span className="text-slate-700 font-normal tabular-nums">
              Live {liveVal.toFixed(1)}{unit}
              {monitoringEnabled ? ` (Armed ${min}–${max}${unit})` : ` (Draft ${displayMin}–${displayMax}${unit})`}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs font-mono">
          <button
            type="button"
            onClick={() => setShowReferenceChart((v) => !v)}
            className={`px-2.5 py-1 rounded border transition-colors whitespace-nowrap shrink-0 ${
              showReferenceChart
                ? 'bg-green-200/80 border-emerald-400 text-emerald-950 font-medium'
                : 'bg-green-50 border-green-300 text-slate-800 hover:bg-green-100'
            }`}
          >
            {showReferenceChart ? 'Hide Reference Chart' : 'Reference Chart'}
          </button>
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
      <p
        className={`text-xs mb-3 leading-relaxed ${
          isCritical
            ? 'text-rose-800 font-medium'
            : isWarning
            ? 'text-amber-800'
            : 'text-slate-700'
        }`}
      >
        {thresholdStatus?.message}
      </p>

      {/* Precision Linear Range Gauge */}
      <div className="mb-4">
        <div className="relative h-3.5 w-full rounded bg-green-50 border border-green-300 overflow-hidden">
          {monitoringEnabled && (
            <div
              className="absolute inset-y-0 left-0 bg-rose-200/75"
              style={{ width: `${minPct}%` }}
            />
          )}
          <div
            className={`absolute inset-y-0 ${
              monitoringEnabled ? 'bg-emerald-100/90' : 'bg-green-200/55'
            }`}
            style={{ left: `${minPct}%`, width: `${Math.max(0, maxPct - minPct)}%` }}
          />
          <div
            className="absolute inset-y-0 bg-green-300/65"
            style={{
              left: `${Math.max(minPct, targetMinPct)}%`,
              width: `${Math.max(
                0,
                Math.min(maxPct, targetMaxPct) - Math.max(minPct, targetMinPct)
              )}%`,
            }}
          />
          {monitoringEnabled && (
            <div
              className="absolute inset-y-0 right-0 bg-rose-200/75"
              style={{ width: `${Math.max(0, 100 - maxPct)}%` }}
            />
          )}

          {/* Safety Boundary Markers */}
          <div
            className={`absolute inset-y-0 w-0.5 ${
              monitoringEnabled ? 'bg-rose-500' : 'bg-slate-500/70'
            }`}
            style={{ left: `${minPct}%` }}
          />
          <div
            className={`absolute inset-y-0 w-0.5 ${
              monitoringEnabled ? 'bg-rose-500' : 'bg-slate-500/70'
            }`}
            style={{ left: `${maxPct}%` }}
          />

          {/* Live Position Needle */}
          {liveVal > 0 && (
            <div
              className={`absolute top-0 bottom-0 w-1.5 -ml-[3px] rounded-sm transition-all duration-75 ${needleColor}`}
              style={{ left: `${livePct}%` }}
            />
          )}
        </div>
        <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-600 mt-1">
          <span>{boundsMin}{unit}</span>
          <span className={monitoringEnabled ? 'text-rose-700' : 'text-slate-700'}>
            Min {displayMin}{unit}
          </span>
          <span className="text-emerald-800">
            Target {targetMin}–{targetMax}{unit}
          </span>
          <span className={monitoringEnabled ? 'text-rose-700' : 'text-slate-700'}>
            Max {displayMax}{unit}
          </span>
          <span>{boundsMax}{unit}</span>
        </div>
      </div>

      {/* Manual Threshold Controls */}
      <div className="pt-3 border-t border-green-200">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="safety-min-input"
                className="text-[11px] font-medium text-slate-700"
              >
                Min Safety Floor ({unit})
              </label>
              <button
                type="button"
                onClick={() => handleCaptureLive('min')}
                className="text-[11px] font-mono text-emerald-800 hover:text-emerald-950 underline underline-offset-2"
              >
                Use Live ({Math.round(liveVal)}{unit})
              </button>
            </div>
            <input
              id="safety-min-input"
              type="number"
              min={boundsMin}
              max={boundsMax - 5}
              step={1}
              value={draftMin}
              onChange={(e) => {
                setValidationError('');
                setDraftMin(e.target.value);
              }}
              className="w-full bg-green-50 border border-green-300 text-slate-900 rounded px-2.5 py-1.5 text-xs font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="safety-max-input"
                className="text-[11px] font-medium text-slate-700"
              >
                Max Safety Ceiling ({unit})
              </label>
              <button
                type="button"
                onClick={() => handleCaptureLive('max')}
                className="text-[11px] font-mono text-emerald-800 hover:text-emerald-950 underline underline-offset-2"
              >
                Use Live ({Math.round(liveVal)}{unit})
              </button>
            </div>
            <input
              id="safety-max-input"
              type="number"
              min={boundsMin + 5}
              max={boundsMax}
              step={1}
              value={draftMax}
              onChange={(e) => {
                setValidationError('');
                setDraftMax(e.target.value);
              }}
              className="w-full bg-green-50 border border-green-300 text-slate-900 rounded px-2.5 py-1.5 text-xs font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>
        </div>

        {validationError && (
          <p className="mt-2 text-xs font-medium text-rose-700">{validationError}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleApplyAndArm}
            className="bg-green-300 hover:bg-green-200 text-slate-950 border border-green-400 px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
          >
            {!monitoringEnabled
              ? 'Apply & Arm Alerts'
              : hasUnsavedChanges
              ? 'Update Armed Limits'
              : 'Limits Armed'}
          </button>

          {monitoringEnabled && (
            <button
              type="button"
              onClick={() => onSetMonitoringEnabled(false)}
              className="bg-green-50 hover:bg-green-100 text-slate-800 border border-green-300 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0"
            >
              Turn Off Alerts
            </button>
          )}

          <button
            type="button"
            onClick={handleResetClick}
            className="bg-green-50 hover:bg-green-100 text-slate-700 border border-green-300 px-3 py-1.5 rounded-md text-xs font-mono transition-colors whitespace-nowrap shrink-0"
          >
            Reset Defaults
          </button>
        </div>
      </div>

      {/* Clinical Threshold Reference Chart & Learning List */}
      {showReferenceChart && (
        <div className="mt-4 pt-3.5 border-t border-green-200">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <div>
              <p className="text-xs font-semibold text-slate-900">
                Clinical Threshold Reference Chart
              </p>
              <p className="text-[11px] text-slate-600 mt-0.5">
                {catalogEntry.scaleNote}
              </p>
            </div>

            <div className="flex items-center gap-1 p-0.5 bg-green-100 border border-green-200 rounded-md text-[11px] font-medium">
              <button
                type="button"
                onClick={() => setReferenceTab('current')}
                className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
                  referenceTab === 'current'
                    ? 'bg-green-50 text-slate-950 border border-green-300 font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Current Protocol
              </button>
              <button
                type="button"
                onClick={() => setReferenceTab('all')}
                className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
                  referenceTab === 'all'
                    ? 'bg-green-50 text-slate-950 border border-green-300 font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Protocols
              </button>
            </div>
          </div>

          {referenceTab === 'current' ? (
            <div className="divide-y divide-green-200 border border-green-200 rounded-lg bg-green-50 overflow-hidden">
              {catalogEntry.presets.map((preset) => {
                const isActivePreset =
                  monitoringEnabled && min === preset.min && max === preset.max;
                return (
                  <div key={preset.id} className="p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-semibold text-slate-900">
                          {preset.stage}
                        </span>
                        <span className="mx-1.5 text-green-300" aria-hidden="true">·</span>
                        <span className="text-xs font-mono tabular-nums text-emerald-800 font-medium">
                          {preset.min}{catalogEntry.unit} – {preset.max}{catalogEntry.unit}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleLoadPresetToInputs(preset)}
                          className="px-2 py-1 rounded border border-green-300 bg-green-50 hover:bg-green-100 text-[11px] font-mono text-slate-700 transition-colors whitespace-nowrap"
                        >
                          Fill Inputs
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplyPreset(preset)}
                          className={`px-2.5 py-1 rounded border text-[11px] font-semibold transition-colors whitespace-nowrap ${
                            isActivePreset
                              ? 'bg-emerald-700 text-green-50 border-emerald-800'
                              : 'bg-green-200/80 hover:bg-green-300 text-slate-950 border-green-400'
                          }`}
                        >
                          {isActivePreset ? '● Armed' : 'Set & Arm'}
                        </button>
                      </div>
                    </div>

                    <RangeBarPreview
                      min={preset.min}
                      max={preset.max}
                      targetMin={preset.targetMin}
                      targetMax={preset.targetMax}
                      boundsMin={catalogEntry.boundsMin}
                      boundsMax={catalogEntry.boundsMax}
                      unit={catalogEntry.unit}
                    />

                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      {preset.rationale}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="border border-green-200 rounded-lg bg-green-50 overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-green-100/70 border-b border-green-200 text-[11px] font-semibold text-slate-700">
                    <th className="py-2 px-3">Protocol &amp; Joint Axis</th>
                    <th className="py-2 px-3">Stage</th>
                    <th className="py-2 px-3 font-mono">Safe Corridor</th>
                    <th className="py-2 px-3 min-w-[130px]">Visual Range</th>
                    <th className="py-2 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-green-200">
                  {allProtocols.flatMap((proto) =>
                    proto.presets.map((preset, idx) => {
                      const isCurrentProtocol = proto.protocolKey === exercise?.key;
                      const isActivePreset =
                        isCurrentProtocol &&
                        monitoringEnabled &&
                        min === preset.min &&
                        max === preset.max;
                      return (
                        <tr
                          key={preset.id}
                          className={
                            isCurrentProtocol ? 'bg-green-100/35' : 'hover:bg-green-100/30'
                          }
                        >
                          <td className="py-2 px-3 align-top">
                            {idx === 0 ? (
                              <div>
                                <p className="font-semibold text-slate-900">
                                  {proto.protocolName}
                                </p>
                                <p className="text-[11px] text-slate-600 font-mono">
                                  {proto.jointAxis}
                                </p>
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-500">
                                {proto.protocolName}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 align-top text-slate-800 font-medium">
                            {preset.stage}
                            <p className="text-[11px] text-slate-600 font-normal mt-0.5 max-w-[210px]">
                              {preset.rationale}
                            </p>
                          </td>
                          <td className="py-2 px-3 align-top font-mono tabular-nums text-emerald-800 whitespace-nowrap">
                            {preset.min}–{preset.max}{proto.unit}
                          </td>
                          <td className="py-2 px-3 align-top">
                            <RangeBarPreview
                              min={preset.min}
                              max={preset.max}
                              targetMin={preset.targetMin}
                              targetMax={preset.targetMax}
                              boundsMin={proto.boundsMin}
                              boundsMax={proto.boundsMax}
                              unit={proto.unit}
                            />
                          </td>
                          <td className="py-2 px-3 align-top text-right whitespace-nowrap">
                            {isCurrentProtocol ? (
                              <button
                                type="button"
                                onClick={() => handleApplyPreset(preset)}
                                className={`px-2 py-1 rounded border text-[11px] font-semibold transition-colors ${
                                  isActivePreset
                                    ? 'bg-emerald-700 text-green-50 border-emerald-800'
                                    : 'bg-green-200/80 hover:bg-green-300 text-slate-950 border-green-400'
                                }`}
                              >
                                {isActivePreset ? '● Armed' : 'Set & Arm'}
                              </button>
                            ) : (
                              <span className="text-[11px] font-mono text-slate-500">
                                Reference
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Breach Counters & Latest Incident */}
      <div className="mt-3 pt-2.5 border-t border-green-200 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-700">
        <span>
          Upper Breaches:{' '}
          <span
            className={
              breachStats.upperCount > 0 ? 'text-rose-700 font-semibold' : 'text-slate-900'
            }
          >
            {breachStats.upperCount}
          </span>
          <span className="mx-2 text-green-300" aria-hidden="true">·</span>
          Lower Breaches:{' '}
          <span
            className={
              breachStats.lowerCount > 0 ? 'text-rose-700 font-semibold' : 'text-slate-900'
            }
          >
            {breachStats.lowerCount}
          </span>
        </span>
        {breachStats.lastEvent ? (
          <span className="text-rose-700 font-medium truncate max-w-full">
            Last: {breachStats.lastEvent}
          </span>
        ) : (
          <span className="text-slate-600">
            {monitoringEnabled ? 'Zero safety violations' : 'Alerts paused (manual setup)'}
          </span>
        )}
      </div>
    </div>
  );
}

export default ThresholdMonitor;
