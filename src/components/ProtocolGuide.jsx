function ProtocolGuide({ exercise }) {
  const guidance = exercise?.guidance;
  const isHands = exercise?.tracker === 'hands';

  return (
    <div className="bg-green-50 p-5 rounded-xl border border-green-200">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-3 border-b border-green-200">
        <div>
          <h3 className="text-base font-semibold text-slate-900 tracking-tight">
            Protocol Guidance
          </h3>
          <p className="text-xs text-slate-600 mt-0.5">
            {exercise?.name}
            <span className="mx-1.5 text-green-300" aria-hidden="true">·</span>
            <span className="font-mono text-emerald-800 font-medium">
              Target {exercise?.rom_target_min ?? 0}–{exercise?.rom_target_max ?? 180}
              {isHands ? '% aperture' : '°'}
            </span>
          </p>
        </div>
        <span className="text-xs font-mono text-slate-600">
          {isHands ? '21-pt Hand Landmarker' : '33-pt Pose Landmarker'}
        </span>
      </div>

      {guidance ? (
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-green-100/55 border border-green-200 rounded-lg p-3">
              <p className="font-semibold text-emerald-900 mb-1">Camera Framing</p>
              <p className="text-slate-700 leading-relaxed">{guidance.framing}</p>
            </div>
            <div className="bg-green-100/55 border border-green-200 rounded-lg p-3">
              <p className="font-semibold text-emerald-900 mb-1">
                {isHands ? '3s Baseline Calibration' : '3s T-Pose Calibration'}
              </p>
              <p className="text-slate-700 leading-relaxed">{guidance.calibration_instruction}</p>
            </div>
          </div>

          <div>
            <p className="font-semibold text-slate-800 mb-2">Execution Steps</p>
            <ol className="space-y-1.5 text-slate-700">
              {(guidance.steps || []).map((stepText, idx) => (
                <li key={idx} className="flex items-start gap-2.5 leading-relaxed">
                  <span className="font-mono text-emerald-700 font-semibold shrink-0">0{idx + 1}.</span>
                  <span>{stepText}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5">
            <span className="font-semibold text-amber-800">Form &amp; Compensation Check: </span>
            <span className="text-slate-700">{guidance.form_cues}</span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          Select a rehabilitation protocol above to view camera setup, calibration posture, and repetition cues.
        </p>
      )}
    </div>
  );
}

export default ProtocolGuide;
