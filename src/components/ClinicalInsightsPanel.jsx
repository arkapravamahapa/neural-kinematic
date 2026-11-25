import { computeLimbAsymmetry } from '../utils/clinicalAnalytics';

const TONE_TEXT = {
  nominal: 'text-emerald-800',
  warning: 'text-amber-700',
  critical: 'text-rose-700',
  neutral: 'text-slate-600',
};

const TONE_BOX = {
  nominal: 'bg-green-100/55 border-green-200',
  warning: 'bg-amber-50 border-amber-300',
  critical: 'bg-rose-50 border-rose-300',
  neutral: 'bg-green-100/45 border-green-200',
};

function ClinicalInsightsPanel({
  metrics,
  exercise,
  limbSide,
  involvedSide,
  onInvolvedSideChange,
  onLimbSideChange,
  patientSessions,
}) {
  const isHands = (metrics?.tracker || exercise?.tracker) === 'hands';
  const unit = isHands ? '%' : '°';
  const fatigue = metrics?.fatigue || {
    status: 'collecting',
    severity: 'neutral',
    label: '○ Collecting Baseline',
    summary: 'Complete at least 4 reps to compare baseline vs. late-set neuromuscular drift.',
    baselineCount: 0,
    lateCount: 0,
    baselineRom: 0,
    lateRom: 0,
    romDeltaPct: 0,
    baselineJerk: 0,
    lateJerk: 0,
    jerkDeltaPct: 0,
    baselineDtw: 100,
    lateDtw: 100,
    dtwDeltaPts: 0,
  };
  const repHistory = metrics?.rep_history || [];

  const asymmetry = computeLimbAsymmetry(
    patientSessions,
    exercise?.id,
    involvedSide
  );

  const maxExcursion = Math.max(
    1,
    ...repHistory.map((r) => Number(r.romExcursion || 0))
  );

  return (
    <div className="bg-green-50 p-5 rounded-xl border border-green-200 space-y-5">
      {/* 1. Fatigue & Neuromuscular Drift Detector */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-3 border-b border-green-200">
          <div>
            <h3 className="text-base font-semibold text-slate-900 tracking-tight">
              Fatigue &amp; Neuromuscular Drift Detector
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Compares baseline reps (1–3) against late-set reps for ROM shrinkage, tremor rise &amp; form drift
            </p>
          </div>
          <span
            className={`text-xs font-mono font-semibold whitespace-nowrap ${
              TONE_TEXT[fatigue.severity] || TONE_TEXT.neutral
            }`}
          >
            {fatigue.label}
          </span>
        </div>

        <div
          className={`rounded-lg border px-3.5 py-2.5 text-xs mb-3 ${
            TONE_BOX[fatigue.severity] || TONE_BOX.neutral
          }`}
        >
          <span className="font-semibold text-slate-900">Clinical Insight: </span>
          <span
            className={
              fatigue.severity === 'critical'
                ? 'text-rose-800 font-medium'
                : fatigue.severity === 'warning'
                ? 'text-amber-900 font-medium'
                : 'text-slate-700'
            }
          >
            {fatigue.summary}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2.5 mb-3">
          <div className="bg-green-100/55 border border-green-200 rounded-lg p-2.5">
            <p className="text-[11px] font-medium text-slate-600">ROM Excursion Δ</p>
            <p
              className={`text-lg font-bold font-mono tabular-nums mt-0.5 ${
                fatigue.romDeltaPct <= -10 ? 'text-rose-700' : 'text-slate-900'
              }`}
            >
              {fatigue.status === 'active'
                ? `${fatigue.romDeltaPct > 0 ? '+' : ''}${fatigue.romDeltaPct.toFixed(0)}%`
                : '—'}
            </p>
            <p className="text-[11px] font-mono tabular-nums text-slate-600">
              {fatigue.status === 'active'
                ? `${fatigue.baselineRom}${unit} → ${fatigue.lateRom}${unit}`
                : 'Baseline vs Late'}
            </p>
          </div>

          <div className="bg-green-100/55 border border-green-200 rounded-lg p-2.5">
            <p className="text-[11px] font-medium text-slate-600">Tremor / Jerk Δ</p>
            <p
              className={`text-lg font-bold font-mono tabular-nums mt-0.5 ${
                fatigue.jerkDeltaPct >= 25 ? 'text-amber-700' : 'text-slate-900'
              }`}
            >
              {fatigue.status === 'active'
                ? `${fatigue.jerkDeltaPct > 0 ? '+' : ''}${fatigue.jerkDeltaPct.toFixed(0)}%`
                : '—'}
            </p>
            <p className="text-[11px] font-mono tabular-nums text-slate-600">
              {fatigue.status === 'active'
                ? `${fatigue.baselineJerk} → ${fatigue.lateJerk}`
                : 'Jerk RMS Drift'}
            </p>
          </div>

          <div className="bg-green-100/55 border border-green-200 rounded-lg p-2.5">
            <p className="text-[11px] font-medium text-slate-600">Form Match Δ</p>
            <p
              className={`text-lg font-bold font-mono tabular-nums mt-0.5 ${
                fatigue.dtwDeltaPts <= -10 ? 'text-rose-700' : 'text-emerald-800'
              }`}
            >
              {fatigue.status === 'active'
                ? `${fatigue.dtwDeltaPts > 0 ? '+' : ''}${fatigue.dtwDeltaPts.toFixed(0)} pts`
                : '—'}
            </p>
            <p className="text-[11px] font-mono tabular-nums text-slate-600">
              {fatigue.status === 'active'
                ? `${fatigue.baselineDtw}% → ${fatigue.lateDtw}%`
                : 'DTW Stability'}
            </p>
          </div>
        </div>

        {/* Per-Rep Trajectory Mini Bars */}
        {repHistory.length > 0 && (
          <div>
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-600 mb-1">
              <span>Per-Rep ROM Excursion ({repHistory.length} reps logged)</span>
              <span>Amber/Rose = Comp or Low DTW</span>
            </div>
            <div className="flex items-end gap-1 h-12 bg-green-100/40 border border-green-200 rounded-md px-2 py-1.5">
              {repHistory.map((r) => {
                const heightPct = Math.max(
                  15,
                  Math.round((Number(r.romExcursion || 0) / maxExcursion) * 100)
                );
                const barTone = r.hadCompensation
                  ? 'bg-rose-500'
                  : r.dtw < 75
                  ? 'bg-amber-500'
                  : 'bg-emerald-600';
                return (
                  <div
                    key={r.rep}
                    title={`Rep ${r.rep}: Excursion ${r.romExcursion}${unit}, Jerk ${r.peakJerk}, DTW ${r.dtw}%`}
                    className="flex-1 flex flex-col items-center justify-end h-full min-w-[10px]"
                  >
                    <div
                      className={`w-full rounded-t-sm ${barTone}`}
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 2. Asymmetry & Affected-vs-Healthy Limb Comparison */}
      <div className="pt-4 border-t border-green-200">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 tracking-tight">
              Asymmetry &amp; Affected-vs-Healthy Limb Comparison
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Side-to-side Limb Symmetry Index (LSI) &amp; ROM deficit tracking across saved sessions
            </p>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-mono">
            <span className="text-slate-600">Involved:</span>
            {['Left', 'Right'].map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => onInvolvedSideChange?.(side)}
                className={`px-2 py-0.5 rounded border transition-colors ${
                  involvedSide === side
                    ? 'bg-green-300 text-slate-950 border-green-400 font-semibold'
                    : 'bg-green-50 text-slate-700 border-green-300 hover:bg-green-100'
                }`}
              >
                {side}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-3">
          <div className="bg-green-100/55 border border-green-200 rounded-lg p-3">
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
              <span>Left Limb {involvedSide === 'Left' ? '(Involved)' : '(Healthy)'}</span>
              <span className="font-mono">{asymmetry.leftCount} rec</span>
            </div>
            <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {asymmetry.leftRom !== null ? `${asymmetry.leftRom.toFixed(1)}°` : '—'}
            </p>
            <p className="text-[11px] font-mono text-slate-600 mt-0.5">
              DTW {asymmetry.leftConsistency !== null ? `${asymmetry.leftConsistency}%` : '—'}
            </p>
          </div>

          <div className="bg-green-100/55 border border-green-200 rounded-lg p-3">
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
              <span>Right Limb {involvedSide === 'Right' ? '(Involved)' : '(Healthy)'}</span>
              <span className="font-mono">{asymmetry.rightCount} rec</span>
            </div>
            <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {asymmetry.rightRom !== null ? `${asymmetry.rightRom.toFixed(1)}°` : '—'}
            </p>
            <p className="text-[11px] font-mono text-slate-600 mt-0.5">
              DTW {asymmetry.rightConsistency !== null ? `${asymmetry.rightConsistency}%` : '—'}
            </p>
          </div>

          <div
            className={`border rounded-lg p-3 ${
              TONE_BOX[asymmetry.tone] || TONE_BOX.neutral
            }`}
          >
            <p className="text-[11px] font-medium text-slate-600">Symmetry Index (LSI)</p>
            <p
              className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                TONE_TEXT[asymmetry.tone] || TONE_TEXT.neutral
              }`}
            >
              {asymmetry.hasComparison ? `${asymmetry.lsiPct}%` : 'Pending'}
            </p>
            <p className="text-[11px] font-mono tabular-nums text-slate-700 mt-0.5">
              {asymmetry.hasComparison
                ? `Delta ${asymmetry.romDeficit > 0 ? '+' : ''}${asymmetry.romDeficit}°`
                : 'Need Left & Right'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono bg-green-100/45 border border-green-200 rounded-lg px-3 py-2">
          <span className="text-slate-700">
            Active Capture Side:{' '}
            <span className="font-semibold text-emerald-900">{limbSide}</span>
            <span className="mx-1.5 text-green-300" aria-hidden="true">·</span>
            <span>{asymmetry.trendLabel}</span>
          </span>
          <div className="flex items-center gap-1">
            {['Left', 'Right', 'Bilateral'].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onLimbSideChange?.(s)}
                className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${
                  limbSide === s
                    ? 'bg-green-300 text-slate-950 border-green-400 font-semibold'
                    : 'bg-green-50 text-slate-700 border-green-300 hover:bg-green-100'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ClinicalInsightsPanel;
