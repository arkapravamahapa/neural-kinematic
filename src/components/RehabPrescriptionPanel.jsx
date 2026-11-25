import { useState } from 'react';
import { formatPrescriptionSummary } from '../utils/clinicalAnalytics';

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

function RehabPrescriptionPanel({
  exercise,
  patientId,
  prescription,
  adherenceMetrics,
  completedSets,
  onSavePrescription,
  onSyncPrescriptionToThresholds,
  onCompleteSet,
  onResetSets,
}) {
  const isHands = exercise?.tracker === 'hands';
  const unit = isHands ? '%' : '°';
  const boundsMax = isHands ? 120 : 180;

  const [targetSets, setTargetSets] = useState(String(prescription.targetSets));
  const [targetReps, setTargetReps] = useState(String(prescription.targetReps));
  const [safeMin, setSafeMin] = useState(String(prescription.safeMin));
  const [safeMax, setSafeMax] = useState(String(prescription.safeMax));
  const [maxCompensations, setMaxCompensations] = useState(
    String(prescription.maxCompensations)
  );
  const [involvedSide, setInvolvedSide] = useState(prescription.involvedSide || 'Left');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSave = async () => {
    const setsNum = Math.max(1, Math.min(10, Math.round(Number(targetSets) || 3)));
    const repsNum = Math.max(1, Math.min(50, Math.round(Number(targetReps) || 10)));
    const minNum = Number(safeMin);
    const maxNum = Number(safeMax);
    const compNum = Math.max(0, Math.min(20, Math.round(Number(maxCompensations) || 0)));

    if (!Number.isFinite(minNum) || !Number.isFinite(maxNum) || maxNum - minNum < 5) {
      setErrorMessage(`Safe Max must be at least 5${unit} above Safe Min.`);
      return;
    }
    if (minNum < 0 || maxNum > boundsMax) {
      setErrorMessage(`Safe corridor must stay between 0${unit} and ${boundsMax}${unit}.`);
      return;
    }

    setErrorMessage('');
    const nextPrescription = {
      ...prescription,
      exercise_key: exercise?.key || 'knee_flexion',
      targetSets: setsNum,
      targetReps: repsNum,
      safeMin: minNum,
      safeMax: maxNum,
      maxCompensations: compNum,
      involvedSide,
      unit,
      boundsMin: 0,
      boundsMax,
    };

    setTargetSets(String(setsNum));
    setTargetReps(String(repsNum));
    setSafeMin(String(minNum));
    setSafeMax(String(maxNum));
    setMaxCompensations(String(compNum));

    await onSavePrescription?.(nextPrescription);
    setStatusMessage('Home prescription saved & applied to live adherence tracking.');
    setTimeout(() => setStatusMessage(''), 3500);
  };

  const handleSyncToThresholds = () => {
    const minNum = Number(safeMin);
    const maxNum = Number(safeMax);
    if (!Number.isFinite(minNum) || !Number.isFinite(maxNum) || maxNum - minNum < 5) {
      setErrorMessage(`Set a valid Safe Min/Max corridor before syncing.`);
      return;
    }
    setErrorMessage('');
    onSyncPrescriptionToThresholds?.(minNum, maxNum);
    setStatusMessage(`Threshold Monitor armed with ${minNum}–${maxNum}${unit}.`);
    setTimeout(() => setStatusMessage(''), 3500);
  };

  const summaryLine = formatPrescriptionSummary(prescription, unit);

  return (
    <div className="bg-green-50 p-5 rounded-xl border border-green-200">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-green-200">
        <div>
          <h3 className="text-base font-semibold text-slate-900 tracking-tight">
            Home Rehab Prescription &amp; Adherence Verification
          </h3>
          <p className="text-xs text-slate-600 font-mono mt-0.5">
            {patientId} · {summaryLine}
          </p>
        </div>
        <span
          className={`text-xs font-mono font-semibold whitespace-nowrap ${
            TONE_TEXT[adherenceMetrics.tone] || TONE_TEXT.neutral
          }`}
        >
          {adherenceMetrics.label}
        </span>
      </div>

      {/* Live Adherence & Safe-Zone Verification Scorecard */}
      <div
        className={`rounded-lg border p-3.5 mb-4 ${
          TONE_BOX[adherenceMetrics.tone] || TONE_BOX.neutral
        }`}
      >
        <div className="grid grid-cols-3 gap-3 mb-2.5">
          <div>
            <p className="text-[11px] font-medium text-slate-600">Protocol Adherence</p>
            <p
              className={`text-2xl font-bold font-mono tabular-nums leading-tight mt-0.5 ${
                TONE_TEXT[adherenceMetrics.tone] || TONE_TEXT.neutral
              }`}
            >
              {adherenceMetrics.adherenceScore}
              <span className="text-xs text-slate-600 ml-0.5">%</span>
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-600">Safe-Zone Frames</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 leading-tight mt-0.5">
              {adherenceMetrics.safeZonePct}
              <span className="text-xs text-slate-600 ml-0.5">%</span>
            </p>
            <p className="text-[10px] font-mono tabular-nums text-slate-600">
              {adherenceMetrics.safeZoneFrames}/{adherenceMetrics.totalFrames} clean
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-600">Compensations</p>
            <p
              className={`text-2xl font-bold font-mono tabular-nums leading-tight mt-0.5 ${
                adherenceMetrics.compensationExceeded ? 'text-rose-700' : 'text-slate-900'
              }`}
            >
              {adherenceMetrics.compensationCount}
              <span className="text-xs font-normal text-slate-600 ml-1">
                / {adherenceMetrics.maxCompensations} max
              </span>
            </p>
          </div>
        </div>

        <div className="w-full bg-green-50 border border-green-200 rounded-full h-2 overflow-hidden mb-2">
          <div
            className={`h-full rounded-full transition-all duration-150 ${
              adherenceMetrics.tone === 'critical'
                ? 'bg-rose-600'
                : adherenceMetrics.tone === 'warning'
                ? 'bg-amber-500'
                : 'bg-emerald-600'
            }`}
            style={{ width: `${Math.min(100, adherenceMetrics.adherenceScore)}%` }}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-700">
          <span>
            Sets Completed:{' '}
            <span className="font-semibold text-slate-900">
              {completedSets} / {prescription.targetSets}
            </span>
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onCompleteSet}
              className="px-2.5 py-1 rounded bg-green-200/80 hover:bg-green-300 border border-green-400 text-slate-950 font-semibold text-[11px] transition-colors"
            >
              Log Completed Set
            </button>
            {completedSets > 0 && (
              <button
                type="button"
                onClick={onResetSets}
                className="px-2 py-1 rounded bg-green-50 hover:bg-green-100 border border-green-300 text-slate-700 text-[11px] transition-colors"
              >
                Reset Sets
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Clinician Prescription Configuration Form */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-3">
        <div>
          <label htmlFor="rx-sets" className="block text-[11px] font-medium text-slate-700 mb-1">
            Target Sets
          </label>
          <input
            id="rx-sets"
            type="number"
            min={1}
            max={10}
            value={targetSets}
            onChange={(e) => setTargetSets(e.target.value)}
            className="w-full bg-green-100/40 border border-green-300 text-slate-900 rounded px-2.5 py-1.5 text-xs font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
        </div>

        <div>
          <label htmlFor="rx-reps" className="block text-[11px] font-medium text-slate-700 mb-1">
            Reps / Set
          </label>
          <input
            id="rx-reps"
            type="number"
            min={1}
            max={50}
            value={targetReps}
            onChange={(e) => setTargetReps(e.target.value)}
            className="w-full bg-green-100/40 border border-green-300 text-slate-900 rounded px-2.5 py-1.5 text-xs font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
        </div>

        <div>
          <label htmlFor="rx-comp" className="block text-[11px] font-medium text-slate-700 mb-1">
            Max Compensations
          </label>
          <input
            id="rx-comp"
            type="number"
            min={0}
            max={20}
            value={maxCompensations}
            onChange={(e) => setMaxCompensations(e.target.value)}
            className="w-full bg-green-100/40 border border-green-300 text-slate-900 rounded px-2.5 py-1.5 text-xs font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
        </div>

        <div>
          <label htmlFor="rx-min" className="block text-[11px] font-medium text-slate-700 mb-1">
            Safe Min ({unit})
          </label>
          <input
            id="rx-min"
            type="number"
            min={0}
            max={boundsMax - 5}
            value={safeMin}
            onChange={(e) => setSafeMin(e.target.value)}
            className="w-full bg-green-100/40 border border-green-300 text-slate-900 rounded px-2.5 py-1.5 text-xs font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
        </div>

        <div>
          <label htmlFor="rx-max" className="block text-[11px] font-medium text-slate-700 mb-1">
            Safe Max ({unit})
          </label>
          <input
            id="rx-max"
            type="number"
            min={5}
            max={boundsMax}
            value={safeMax}
            onChange={(e) => setSafeMax(e.target.value)}
            className="w-full bg-green-100/40 border border-green-300 text-slate-900 rounded px-2.5 py-1.5 text-xs font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
        </div>

        <div>
          <label htmlFor="rx-side" className="block text-[11px] font-medium text-slate-700 mb-1">
            Target Limb
          </label>
          <select
            id="rx-side"
            value={involvedSide}
            onChange={(e) => setInvolvedSide(e.target.value)}
            className="w-full bg-green-100/40 border border-green-300 text-slate-900 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-600"
          >
            <option value="Left">Left</option>
            <option value="Right">Right</option>
            <option value="Bilateral">Bilateral</option>
          </select>
        </div>
      </div>

      {errorMessage && (
        <p className="mb-2 text-xs font-medium text-rose-700">{errorMessage}</p>
      )}
      {statusMessage && (
        <p className="mb-2 text-xs font-mono text-emerald-800 bg-green-100/70 border border-green-200 rounded px-2.5 py-1.5">
          {statusMessage}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="bg-green-300 hover:bg-green-200 text-slate-950 border border-green-400 px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap"
        >
          Assign &amp; Save Prescription
        </button>
        <button
          type="button"
          onClick={handleSyncToThresholds}
          className="bg-green-100/75 hover:bg-green-200/75 text-emerald-950 border border-green-300 px-3 py-1.5 rounded-md text-xs font-mono transition-colors whitespace-nowrap"
        >
          Sync to Threshold Monitor
        </button>
      </div>
    </div>
  );
}

export default RehabPrescriptionPanel;
