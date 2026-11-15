function ProtocolGuide({ exercise }) {
  const guidance = exercise?.guidance;
  const isHands = exercise?.tracker === 'hands';

  return (
    <div className="bg-slate-900/80 backdrop-blur-md p-5 rounded-xl border border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-3 border-b border-slate-800">
        <div>
          <h3 className="text-base font-semibold text-slate-100 tracking-tight">
            Protocol Guidance
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {exercise?.name}
            <span className="mx-1.5 text-slate-600" aria-hidden="true">·</span>
            <span className="font-mono text-green-300">
              Target {exercise?.rom_target_min ?? 0}–{exercise?.rom_target_max ?? 180}
              {isHands ? '% aperture' : '°'}
            </span>
          </p>
        </div>
        <span className="text-xs font-mono text-slate-400">
          {isHands ? '21-pt Hand Landmarker' : '33-pt Pose Landmarker'}
        </span>
      </div>

      {guidance ? (
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
              <p className="font-semibold text-green-300 mb-1">Camera Framing</p>
              <p className="text-slate-300 leading-relaxed">{guidance.framing}</p>
            </div>
            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
              <p className="font-semibold text-green-300 mb-1">
                {isHands ? '3s Baseline Calibration' : '3s T-Pose Calibration'}
              </p>
              <p className="text-slate-300 leading-relaxed">{guidance.calibration_instruction}</p>
            </div>
          </div>

          <div>
            <p className="font-semibold text-slate-200 mb-2">Execution Steps</p>
            <ol className="space-y-1.5 text-slate-300">
              {(guidance.steps || []).map((stepText, idx) => (
                <li key={idx} className="flex items-start gap-2.5 leading-relaxed">
                  <span className="font-mono text-green-300 shrink-0">0{idx + 1}.</span>
                  <span>{stepText}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="bg-slate-950/60 border border-slate-800 rounded-lg px-3.5 py-2.5">
            <span className="font-semibold text-amber-300">Form &amp; Compensation Check: </span>
            <span className="text-slate-300">{guidance.form_cues}</span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-400">
          Select a rehabilitation protocol above to view camera setup, calibration posture, and repetition cues.
        </p>
      )}
    </div>
  );
}

export default ProtocolGuide;
