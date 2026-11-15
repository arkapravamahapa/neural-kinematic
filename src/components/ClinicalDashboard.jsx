import { useEffect, useRef } from 'react';

function ClinicalDashboard({ metrics, exercise, telemetrySeries, onReset }) {
  const graphCanvasRef = useRef(null);

  const isHands = (metrics.tracker || exercise?.tracker) === 'hands';

  let smoothnessLabel = 'Calibrating';
  let smoothnessColor = 'text-slate-400';

  if (metrics.status === 'tracking') {
    if (metrics.jerk_score < 15) {
      smoothnessLabel = 'Highly Stable';
      smoothnessColor = 'text-emerald-400';
    } else if (metrics.jerk_score < 40) {
      smoothnessLabel = 'Moderate Tremor';
      smoothnessColor = 'text-amber-400';
    } else {
      smoothnessLabel = 'Unstable / Erratic';
      smoothnessColor = 'text-rose-400';
    }
  }

  const dtwScore = metrics.dtw_consistency ?? 100;
  const isInconsistent = dtwScore < 75;

  useEffect(() => {
    const canvas = graphCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 520;
    const height = canvas.clientHeight || 156;

    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Background grid
    ctx.fillStyle = '#070B14';
    ctx.fillRect(0, 0, width, height);

    const padLeft = 36;
    const padRight = 12;
    const padTop = 14;
    const padBottom = 18;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const maxY = isHands ? 110 : 180;
    const minY = 0;

    // Horizontal coordinate gridlines
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.9)';
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#64748B';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const ticks = isHands ? [0, 30, 60, 90] : [0, 45, 90, 135, 180];
    for (const val of ticks) {
      const y = padTop + plotH - ((val - minY) / (maxY - minY)) * plotH;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.fillText(isHands ? `${val}%` : `${val}°`, padLeft - 6, y);
    }

    // Target ROM band
    if (exercise) {
      const tMin = Math.max(minY, Math.min(maxY, exercise.rom_target_min ?? 20));
      const tMax = Math.max(minY, Math.min(maxY, exercise.rom_target_max ?? 160));
      const yTop = padTop + plotH - ((tMax - minY) / (maxY - minY)) * plotH;
      const yBot = padTop + plotH - ((tMin - minY) / (maxY - minY)) * plotH;

      ctx.fillStyle = 'rgba(16, 185, 129, 0.06)';
      ctx.fillRect(padLeft, yTop, plotW, Math.max(0, yBot - yTop));

      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
      ctx.beginPath();
      ctx.moveTo(padLeft, yTop);
      ctx.lineTo(width - padRight, yTop);
      ctx.moveTo(padLeft, yBot);
      ctx.lineTo(width - padRight, yBot);
      ctx.stroke();
      ctx.restore();
    }

    // Plot telemetry trace
    if (telemetrySeries && telemetrySeries.length > 1) {
      const maxPoints = 100;
      const pts = telemetrySeries.slice(-maxPoints);
      const stepX = plotW / (maxPoints - 1);
      const startX = padLeft + (maxPoints - pts.length) * stepX;

      const getVal = (p) => (isHands ? p.pinchAperture ?? 0 : p.angle ?? 0);

      // Area gradient
      const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
      grad.addColorStop(0, 'rgba(34, 211, 238, 0.25)');
      grad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

      ctx.beginPath();
      pts.forEach((pt, idx) => {
        const x = startX + idx * stepX;
        const v = Math.max(minY, Math.min(maxY, getVal(pt)));
        const y = padTop + plotH - ((v - minY) / (maxY - minY)) * plotH;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineTo(startX + (pts.length - 1) * stepX, padTop + plotH);
      ctx.lineTo(startX, padTop + plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Primary glowing waveform line
      ctx.save();
      ctx.strokeStyle = '#22D3EE';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(34, 211, 238, 0.6)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      pts.forEach((pt, idx) => {
        const x = startX + idx * stepX;
        const v = Math.max(minY, Math.min(maxY, getVal(pt)));
        const y = padTop + plotH - ((v - minY) / (maxY - minY)) * plotH;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.restore();

      // Secondary MCP angle trace in Hands mode
      if (isHands) {
        ctx.save();
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.75)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        pts.forEach((pt, idx) => {
          const x = startX + idx * stepX;
          const v = Math.max(0, Math.min(180, pt.angle ?? 0));
          const y = padTop + plotH - (v / 180) * plotH;
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.restore();
      }

      // Latest sample point marker
      const lastPt = pts[pts.length - 1];
      const lastX = startX + (pts.length - 1) * stepX;
      const lastVal = Math.max(minY, Math.min(maxY, getVal(lastPt)));
      const lastY = padTop + plotH - ((lastVal - minY) / (maxY - minY)) * plotH;
      ctx.fillStyle = '#10B981';
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#475569';
      ctx.textAlign = 'center';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillText('Awaiting live kinematic stream...', padLeft + plotW / 2, padTop + plotH / 2);
    }

    ctx.restore();
  }, [telemetrySeries, isHands, exercise]);

  const primaryPercent = isHands
    ? Math.min(100, metrics.pinch_aperture || 0)
    : Math.min(100, ((metrics.smoothed_angle || 0) / 180) * 100);

  return (
    <div className="bg-slate-900/80 backdrop-blur-md p-6 rounded-xl border border-slate-800">
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6 border-b border-slate-800 pb-4">
        <div>
          <h3 className="text-lg font-semibold text-slate-100 tracking-tight">
            Biomechanical Telemetry
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {exercise?.name || 'Knee Flexion (Squats)'}
            <span className="mx-1.5 text-slate-600" aria-hidden="true">·</span>
            <span className="font-mono text-cyan-400">
              {metrics.status === 'tracking' ? '● Active Signal' : '○ Buffering'}
            </span>
          </p>
        </div>
        <button
          onClick={onReset}
          className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          Save &amp; Export CSV
        </button>
      </div>

      {metrics.alerts && metrics.alerts.length > 0 && (
        <div className="mb-5 bg-amber-500/10 border border-amber-500/40 px-4 py-3 rounded-lg flex items-start gap-3">
          <svg className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="text-xs font-semibold text-amber-300">Posture Compensation Detected</p>
            <p className="text-xs text-amber-200/90 mt-1 font-mono">
              {metrics.alerts.join(' · ')}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-slate-950/70 p-4 rounded-lg border border-slate-800">
          <p className="text-xs font-medium text-slate-400 mb-1">Repetitions</p>
          <p className="text-3xl font-bold font-mono tabular-nums text-slate-50">
            {metrics.reps || 0}
          </p>
          <span className="text-xs text-cyan-400 font-mono mt-1 block">
            {isHands ? 'Pinch Cycles' : 'Verified Reps'}
          </span>
        </div>

        <div className="bg-slate-950/70 p-4 rounded-lg border border-slate-800">
          <p className="text-xs font-medium text-slate-400 mb-1">Jerk (RMS)</p>
          <p className="text-3xl font-bold font-mono tabular-nums text-slate-50">
            {(metrics.jerk_score || 0).toFixed(1)}
          </p>
          <span className={`text-xs font-medium mt-1 block ${smoothnessColor}`}>
            {smoothnessLabel}
          </span>
        </div>

        <div className={`p-4 rounded-lg border ${isInconsistent ? 'bg-rose-950/30 border-rose-500/40' : 'bg-slate-950/70 border-slate-800'}`}>
          <p className="text-xs font-medium text-slate-400 mb-1">DTW Form Match</p>
          <p className={`text-3xl font-bold font-mono tabular-nums ${isInconsistent ? 'text-rose-300' : 'text-slate-50'}`}>
            {dtwScore.toFixed(1)}<span className="text-sm text-slate-400 ml-0.5">%</span>
          </p>
          <span className={`text-xs font-medium mt-1 block ${isInconsistent ? 'text-rose-400' : 'text-emerald-400'}`}>
            {isInconsistent ? 'Form Degrading' : 'Consistent'}
          </span>
        </div>
      </div>

      {/* Real-time Savitzky-Golay Kinematic Oscilloscope */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="font-medium text-slate-300">
            {isHands ? 'Real-Time Pinch Aperture & MCP Waveform' : 'Real-Time Joint Angle Waveform'}
          </span>
          <span className="font-mono tabular-nums text-slate-400">
            {isHands ? (
              <>
                <span className="text-cyan-400">Pinch {(metrics.pinch_distance_mm || 0).toFixed(1)} mm</span>
                <span className="mx-1.5 text-slate-600">·</span>
                <span className="text-emerald-400">MCP {(metrics.smoothed_angle || 0).toFixed(1)}°</span>
              </>
            ) : (
              <span className="text-cyan-400">Savitzky-Golay {(metrics.smoothed_angle || 0).toFixed(1)}°</span>
            )}
          </span>
        </div>
        <div className="rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
          <canvas ref={graphCanvasRef} className="w-full h-36 block cursor-crosshair" />
        </div>
      </div>

      {/* Articulation Range Bar */}
      <div className="space-y-3">
        <div>
          <div className="flex justify-between text-xs mb-1.5">
            <span className="font-medium text-slate-300">
              {isHands ? 'Thumb–Index Pinch Aperture' : 'Smoothed Articulation Angle'}
            </span>
            <span className="font-mono tabular-nums font-semibold text-cyan-400">
              {isHands
                ? `${(metrics.pinch_aperture || 0).toFixed(1)}% (${(metrics.pinch_distance_mm || 0).toFixed(1)} mm)`
                : `${(metrics.smoothed_angle || 0).toFixed(1)}°`}
            </span>
          </div>
          <div className="w-full bg-slate-950 border border-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-emerald-400 to-cyan-400 h-full rounded-full transition-all duration-75"
              style={{ width: `${primaryPercent}%` }}
            />
          </div>
        </div>

        <div className="flex flex-wrap justify-between gap-2 text-xs pt-3 border-t border-slate-800 font-mono tabular-nums">
          {isHands ? (
            <>
              <span className="text-slate-400">
                Min Pinch Span: <span className="font-semibold text-emerald-400">{(metrics.pinch_min_mm || 0).toFixed(1)} mm</span>
              </span>
              <span className="text-slate-400">
                MCP ROM Range: <span className="font-semibold text-slate-200">{(metrics.rom_min || 0).toFixed(1)}° – {(metrics.rom_max || 0).toFixed(1)}°</span>
              </span>
            </>
          ) : (
            <>
              <span className="text-slate-400">
                Max Extension: <span className="font-semibold text-emerald-400">{(metrics.rom_max || 0).toFixed(1)}°</span>
              </span>
              <span className="text-slate-400">
                Max Flexion: <span className="font-semibold text-cyan-400">{(metrics.rom_min || 0).toFixed(1)}°</span>
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default ClinicalDashboard;