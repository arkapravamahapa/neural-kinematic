import { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import KinematicStreamChart from './KinematicStreamChart';

function formatElapsed(sec) {
  const safe = Math.max(0, Math.floor(sec));
  const mins = String(Math.floor(safe / 60)).padStart(2, '0');
  const rem = String(safe % 60).padStart(2, '0');
  return `${mins}:${rem}`;
}

function ClinicalDashboard({
  metrics,
  exercise,
  patientId,
  limbSide = 'Left',
  telemetrySeries,
  telemetryCount,
  sessionStartTime,
  targetReps,
  onTargetRepsChange,
  clinicalNotes,
  onExportCSV,
  onReset,
  safetyLimits,
  thresholdMonitoringEnabled,
  breachStats,
  adherenceMetrics,
  prescription,
}) {
  const [exportStatus, setExportStatus] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    const updateElapsed = () => {
      if (!sessionStartTime) {
        setElapsedSec(0);
        return;
      }
      setElapsedSec(Math.max(0, Math.floor((Date.now() - sessionStartTime) / 1000)));
    };
    const timer = setInterval(updateElapsed, 1000);
    return () => clearInterval(timer);
  }, [sessionStartTime]);

  const isHands = (metrics.tracker || exercise?.tracker) === 'hands';

  let smoothnessLabel = 'Calibrating';
  let smoothnessColor = 'text-slate-500';

  if (metrics.status === 'tracking') {
    if (metrics.jerk_score < 15) {
      smoothnessLabel = 'Highly Stable';
      smoothnessColor = 'text-emerald-700';
    } else if (metrics.jerk_score < 40) {
      smoothnessLabel = 'Moderate Tremor';
      smoothnessColor = 'text-amber-700';
    } else {
      smoothnessLabel = 'Unstable / Erratic';
      smoothnessColor = 'text-rose-700';
    }
  }

  const dtwScore = metrics.dtw_consistency ?? 100;
  const isInconsistent = dtwScore < 75;

  const primaryPercent = isHands
    ? Math.min(100, metrics.pinch_aperture || 0)
    : Math.min(100, ((metrics.smoothed_angle || 0) / 180) * 100);

  const repGoalPercent = Math.min(
    100,
    Math.round(((metrics.reps || 0) / Math.max(1, targetReps || 10)) * 100)
  );

  const romExcursion = Math.max(0, (metrics.rom_max || 0) - (metrics.rom_min || 0));

  const handleExportCSVClick = () => {
    const exportedRows = onExportCSV?.();
    if (exportedRows > 0) {
      setExportStatus(`Exported ${exportedRows} telemetry frames to CSV`);
    } else {
      setExportStatus('Exported current clinical snapshot to CSV');
    }
    setTimeout(() => setExportStatus(''), 3500);
  };

  const handleExportPDFClick = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const nowMs = Date.now();
    const nowStr = new Date(nowMs).toLocaleString();
    const elapsedFormatted = formatElapsed(
      sessionStartTime ? Math.max(0, Math.floor((nowMs - sessionStartTime) / 1000)) : 0
    );

    doc.setFillColor(240, 253, 244);
    doc.rect(0, 0, 210, 32, 'F');
    doc.setTextColor(4, 120, 87);
    doc.setFontSize(16);
    doc.text('Neural-Kinematic Clinical Assessment', 14, 15);
    doc.setTextColor(71, 85, 105);
    doc.setFontSize(9);
    doc.text(`Generated: ${nowStr}   |   Patient ID: ${patientId || 'PT-1042'}`, 14, 23);

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(12);
    doc.text(`Protocol: ${exercise?.name || 'Knee Flexion (Squats)'}`, 14, 44);
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text(`Category: ${exercise?.category || 'Biomechanical Tracking'}`, 14, 51);
    doc.text(
      `Captured Samples: ${telemetryCount || telemetrySeries.length} frames   |   Session Elapsed: ${elapsedFormatted}`,
      14,
      57
    );

    doc.setDrawColor(203, 213, 225);
    doc.line(14, 63, 196, 63);
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(11);
    doc.text(`Completed Repetitions: ${metrics.reps || 0} / ${targetReps} target`, 14, 72);
    doc.text(`DTW Form Consistency: ${dtwScore.toFixed(1)}%`, 110, 72);
    doc.text(
      `Smoothness (Jerk RMS): ${(metrics.jerk_score || 0).toFixed(2)} (${smoothnessLabel})`,
      14,
      80
    );
    if (isHands) {
      doc.text(
        `Pinch Span Range: ${(metrics.pinch_min_mm || 0).toFixed(1)} - ${(metrics.pinch_max_mm || 0).toFixed(1)} mm`,
        110,
        80
      );
      doc.text(
        `MCP Joint ROM: ${(metrics.rom_min || 0).toFixed(1)} deg - ${(metrics.rom_max || 0).toFixed(1)} deg`,
        14,
        88
      );
    } else {
      doc.text(
        `Joint ROM: ${(metrics.rom_min || 0).toFixed(1)} deg (Flexion) - ${(metrics.rom_max || 0).toFixed(1)} deg (Extension) | Excursion: ${romExcursion.toFixed(1)} deg`,
        14,
        88
      );
    }

    const alertsText =
      metrics.alerts && metrics.alerts.length > 0
        ? metrics.alerts.join(', ')
        : 'None detected during session';
    doc.text(`Limb Side: ${limbSide}   |   Posture Compensations: ${alertsText}`, 14, 96);
    if (safetyLimits) {
      doc.text(
        `Safety Bounds (${safetyLimits.min}-${safetyLimits.max}${safetyLimits.unit} · ${thresholdMonitoringEnabled ? 'Armed' : 'Manual Off'}): Upper Breaches ${breachStats?.upperCount || 0} | Lower Breaches ${breachStats?.lowerCount || 0}`,
        14,
        103
      );
    }

    const fatigueSummary =
      metrics?.fatigue?.summary || 'Insufficient repetitions for fatigue drift comparison.';
    doc.text(`Fatigue & Neuromuscular Drift: ${fatigueSummary}`, 14, 110);

    if (adherenceMetrics) {
      const rxText = prescription
        ? `${prescription.targetSets}x${prescription.targetReps} reps, Safe ${prescription.safeMin}-${prescription.safeMax}${isHands ? '%' : ' deg'}, Max ${prescription.maxCompensations} comp`
        : 'Default';
      doc.text(
        `Adherence Score: ${adherenceMetrics.adherenceScore}% (Safe-Zone ${adherenceMetrics.safeZonePct}% · Comp ${adherenceMetrics.compensationCount}/${adherenceMetrics.maxCompensations}) | Rx: ${rxText}`,
        14,
        117
      );
    }

    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85);
    doc.text(
      isHands ? 'Live Pinch Aperture Trajectory (%)' : 'Live Joint Angle Trajectory (deg)',
      14,
      126
    );
    const boxX = 14;
    const boxY = 130;
    const boxW = 182;
    const boxH = 44;
    doc.setFillColor(248, 250, 252);
    doc.rect(boxX, boxY, boxW, boxH, 'FD');

    if (telemetrySeries && telemetrySeries.length > 1) {
      const pts = telemetrySeries.slice(-100);
      const maxVal = isHands ? 120 : 180;
      doc.setDrawColor(16, 185, 129);
      doc.setLineWidth(0.7);
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const v0 = Math.max(0, Math.min(maxVal, isHands ? p0.pinchAperture || 0 : p0.angle || 0));
        const v1 = Math.max(0, Math.min(maxVal, isHands ? p1.pinchAperture || 0 : p1.angle || 0));
        const x0 = boxX + ((i - 1) / (pts.length - 1)) * boxW;
        const x1 = boxX + (i / (pts.length - 1)) * boxW;
        const y0 = boxY + boxH - (v0 / maxVal) * boxH;
        const y1 = boxY + boxH - (v1 / maxVal) * boxH;
        doc.line(x0, y0, x1, y1);
      }
    } else {
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text('Insufficient live stream samples for trajectory plot.', 20, 142);
    }

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(11);
    doc.text('Clinician Notes:', 14, 181);
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    const wrappedNotes = doc.splitTextToSize(
      clinicalNotes?.trim() || 'No additional clinician observations recorded.',
      180
    );
    doc.text(wrappedNotes, 14, 188);

    doc.save(`clinical_report_${exercise?.key || 'session'}_${patientId || 'PT-1042'}_${Date.now()}.pdf`);
    setExportStatus('Clinical PDF report downloaded');
    setTimeout(() => setExportStatus(''), 3500);
  };

  return (
    <div className="bg-green-50 p-4 rounded-xl border border-green-200 flex flex-col justify-between h-full">
      <div>
        <div className="flex flex-wrap justify-between items-center gap-2.5 mb-3 border-b border-green-200 pb-2.5">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900 tracking-tight">
              Biomechanical Telemetry
            </h3>
            <p className="text-xs text-slate-600 mt-0.5 font-mono tabular-nums truncate">
              <span>{exercise?.name || 'Knee Flexion (Squats)'}</span>
              <span className="mx-1.5 text-green-300" aria-hidden="true">·</span>
              <span className="text-slate-800 font-medium">{limbSide}</span>
              <span className="mx-1.5 text-green-300" aria-hidden="true">·</span>
              <span className="text-emerald-800 font-medium">
                {metrics.status === 'tracking' ? '● Active' : '○ Buffering'}
              </span>
              <span className="mx-1.5 text-green-300" aria-hidden="true">·</span>
              <span>{formatElapsed(elapsedSec)}</span>
              <span className="mx-1.5 text-green-300" aria-hidden="true">·</span>
              <span>{telemetryCount || telemetrySeries.length} frames</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleExportCSVClick}
              className="bg-green-100/70 hover:bg-green-200/70 text-emerald-900 border border-green-300 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={handleExportPDFClick}
              className="bg-green-50 hover:bg-green-100 text-slate-800 border border-green-300 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
            >
              Export PDF
            </button>
            <button
              type="button"
              onClick={onReset}
              className="bg-green-300 hover:bg-green-200 text-slate-950 border border-green-400 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
            >
              Save &amp; Clear
            </button>
          </div>
        </div>

        {exportStatus && (
          <div className="mb-2.5 bg-green-200/60 border border-green-300 text-emerald-900 px-3 py-1.5 rounded-lg text-xs font-mono">
            {exportStatus}
          </div>
        )}

        {metrics.fatigue &&
          (metrics.fatigue.severity === 'critical' || metrics.fatigue.severity === 'warning') && (
            <div
              className={`mb-2.5 border px-3 py-1.5 rounded-lg flex items-center justify-between gap-2 text-xs ${
                metrics.fatigue.severity === 'critical'
                  ? 'bg-rose-50 border-rose-300 text-rose-900'
                  : 'bg-amber-50 border-amber-300 text-amber-900'
              }`}
            >
              <span className="font-semibold shrink-0">{metrics.fatigue.label}</span>
              <span className="font-mono truncate">{metrics.fatigue.summary}</span>
            </div>
          )}

        {metrics.alerts && metrics.alerts.length > 0 && (
          <div className="mb-2.5 bg-amber-50 border border-amber-300 px-3 py-2 rounded-lg flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-amber-900">▲ Posture Compensation</span>
            <span className="text-amber-800 font-mono truncate">
              {metrics.alerts.join(' · ')}
            </span>
          </div>
        )}

        {/* 3-Up KPI Strip */}
        <div className="grid grid-cols-3 gap-2.5 mb-3">
          <div className="bg-green-100/55 px-3 py-2.5 rounded-lg border border-green-200">
            <p className="text-[11px] font-medium text-slate-600">Repetitions</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 leading-tight mt-0.5">
              {metrics.reps || 0}
              <span className="text-xs font-normal text-slate-600 ml-1">/ {targetReps}</span>
            </p>
            <span className="text-[11px] text-emerald-800 font-mono block mt-0.5">
              {isHands ? 'Pinch Cycles' : 'Verified Reps'}
            </span>
          </div>

          <div className="bg-green-100/55 px-3 py-2.5 rounded-lg border border-green-200">
            <p className="text-[11px] font-medium text-slate-600">Jerk (RMS)</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 leading-tight mt-0.5">
              {(metrics.jerk_score || 0).toFixed(1)}
            </p>
            <span className={`text-[11px] font-medium block mt-0.5 ${smoothnessColor}`}>
              {smoothnessLabel}
            </span>
          </div>

          <div
            className={`px-3 py-2.5 rounded-lg border ${
              isInconsistent ? 'bg-rose-50 border-rose-300' : 'bg-green-100/55 border-green-200'
            }`}
          >
            <p className="text-[11px] font-medium text-slate-600">DTW Form Match</p>
            <p
              className={`text-2xl font-bold font-mono tabular-nums leading-tight mt-0.5 ${
                isInconsistent ? 'text-rose-700' : 'text-slate-900'
              }`}
            >
              {dtwScore.toFixed(1)}
              <span className="text-xs text-slate-600 ml-0.5">%</span>
            </p>
            <span
              className={`text-[11px] font-medium block mt-0.5 ${
                isInconsistent ? 'text-rose-700' : 'text-emerald-800'
              }`}
            >
              {isInconsistent ? 'Form Degrading' : 'Consistent'}
            </span>
          </div>
        </div>

        {/* Repetition Target Goal Bar */}
        <div className="mb-3 bg-green-100/55 border border-green-200 rounded-lg px-3 py-2">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-slate-800 font-medium">
              Set Target Goal ({repGoalPercent}% complete)
            </span>
            <div className="flex items-center gap-1 font-mono">
              {[5, 10, 15, 20].map((goal) => (
                <button
                  key={goal}
                  type="button"
                  onClick={() => onTargetRepsChange?.(goal)}
                  className={`px-2 py-0.5 rounded text-xs transition-colors ${
                    targetReps === goal
                      ? 'bg-green-300 text-slate-950 border border-green-400 font-semibold'
                      : 'bg-green-50 text-slate-700 hover:text-slate-950 border border-green-200'
                  }`}
                >
                  {goal}
                </button>
              ))}
            </div>
          </div>
          <div className="w-full bg-green-50 border border-green-200 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-emerald-600 h-full rounded-full transition-all duration-150"
              style={{ width: `${repGoalPercent}%` }}
            />
          </div>
        </div>

        {/* Real-time Recharts Live Joint Angle / Pinch Stream (Above the Fold) */}
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-semibold text-slate-800">
              {isHands ? 'Live Pinch Aperture & MCP Stream' : 'Live Joint Angle Stream'}
            </span>
            <span className="font-mono tabular-nums text-slate-600">
              {isHands ? (
                <>
                  <span className="text-emerald-800 font-medium">
                    Pinch {(metrics.pinch_distance_mm || 0).toFixed(1)} mm
                  </span>
                  <span className="mx-1.5 text-green-300">·</span>
                  <span className="text-amber-700 font-medium">
                    MCP {(metrics.smoothed_angle || 0).toFixed(1)}°
                  </span>
                </>
              ) : (
                <span className="text-emerald-800 font-medium">
                  Savitzky-Golay {(metrics.smoothed_angle || 0).toFixed(1)}°
                </span>
              )}
            </span>
          </div>
          <KinematicStreamChart
            telemetrySeries={telemetrySeries}
            exercise={exercise}
            isHands={isHands}
            safetyLimits={safetyLimits}
            monitoringEnabled={thresholdMonitoringEnabled}
            heightClass="h-40"
          />
        </div>
      </div>

      {/* Articulation Range Bar & Live ROM Summary */}
      <div className="space-y-2 pt-2 border-t border-green-200">
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="font-medium text-slate-800">
              {isHands ? 'Thumb–Index Pinch Aperture' : 'Smoothed Articulation Angle'}
            </span>
            <span className="font-mono tabular-nums font-semibold text-emerald-800">
              {isHands
                ? `${(metrics.pinch_aperture || 0).toFixed(1)}% (${(metrics.pinch_distance_mm || 0).toFixed(1)} mm)`
                : `${(metrics.smoothed_angle || 0).toFixed(1)}°`}
            </span>
          </div>
          <div className="w-full bg-green-100 border border-green-200 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-emerald-600 to-green-400 h-full rounded-full transition-all duration-75"
              style={{ width: `${primaryPercent}%` }}
            />
          </div>
        </div>

        <div className="flex flex-wrap justify-between gap-2 text-xs font-mono tabular-nums">
          {isHands ? (
            <>
              <span className="text-slate-700">
                Min Pinch Span:{' '}
                <span className="font-semibold text-emerald-800">
                  {(metrics.pinch_min_mm || 0).toFixed(1)} mm
                </span>
              </span>
              <span className="text-slate-700">
                MCP ROM:{' '}
                <span className="font-semibold text-slate-900">
                  {(metrics.rom_min || 0).toFixed(1)}° – {(metrics.rom_max || 0).toFixed(1)}°
                </span>
              </span>
            </>
          ) : (
            <>
              <span className="text-slate-700">
                Max Extension:{' '}
                <span className="font-semibold text-emerald-800">
                  {(metrics.rom_max || 0).toFixed(1)}°
                </span>
              </span>
              <span className="text-slate-700">
                Max Flexion:{' '}
                <span className="font-semibold text-green-800">
                  {(metrics.rom_min || 0).toFixed(1)}°
                </span>
              </span>
              <span className="text-slate-700">
                Excursion:{' '}
                <span className="font-semibold text-slate-900">
                  {romExcursion.toFixed(1)}°
                </span>
              </span>
            </>
          )}
          {adherenceMetrics && adherenceMetrics.status === 'active' && (
            <span className="text-slate-700">
              Safe-Zone:{' '}
              <span
                className={`font-semibold ${
                  adherenceMetrics.tone === 'critical'
                    ? 'text-rose-700'
                    : adherenceMetrics.tone === 'warning'
                    ? 'text-amber-700'
                    : 'text-emerald-800'
                }`}
              >
                {adherenceMetrics.safeZonePct}%
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default ClinicalDashboard;