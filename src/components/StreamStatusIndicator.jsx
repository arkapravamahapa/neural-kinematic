import { useEffect, useRef, useState } from 'react';

const TONE_CLASSES = {
  nominal: 'text-emerald-800',
  warning: 'text-amber-700',
  critical: 'text-rose-700',
  neutral: 'text-slate-600',
};

function resolveCameraSummary(cameraStream, isPaused) {
  if (cameraStream.status === 'denied') {
    return {
      glyph: '✖',
      shortLabel: 'Cam Denied',
      label: 'Camera Denied',
      detailLabel: 'Permission Denied',
      tone: 'critical',
    };
  }
  if (cameraStream.status === 'disconnected') {
    return {
      glyph: '✖',
      shortLabel: 'Cam Off',
      label: 'Camera Off',
      detailLabel: 'Disconnected',
      tone: 'critical',
    };
  }
  if (cameraStream.status === 'error') {
    return {
      glyph: '✖',
      shortLabel: 'Cam Error',
      label: 'Camera Error',
      detailLabel: 'Stream Error',
      tone: 'critical',
    };
  }
  if (cameraStream.status === 'live') {
    if (cameraStream.muted) {
      return {
        glyph: '▲',
        shortLabel: 'Cam Muted',
        label: 'Camera Muted',
        detailLabel: 'Track Muted',
        tone: 'warning',
      };
    }
    if (isPaused) {
      return {
        glyph: '▲',
        shortLabel: 'Cam Paused',
        label: 'Camera Paused',
        detailLabel: 'Paused',
        tone: 'warning',
      };
    }
    return {
      glyph: '●',
      shortLabel: 'Cam Live',
      label: 'Camera Live',
      detailLabel: 'Live',
      tone: 'nominal',
    };
  }
  return {
    glyph: '○',
    shortLabel: 'Cam Init',
    label: 'Camera Init',
    detailLabel: 'Initializing',
    tone: 'neutral',
  };
}

function resolveSensorSummary(sensorStream, isPaused) {
  if (sensorStream.modelStatus === 'error') {
    return {
      glyph: '✖',
      shortLabel: 'Sensor Err',
      label: 'Sensor Error',
      detailLabel: 'Vision Load Error',
      tone: 'critical',
    };
  }
  if (sensorStream.wsStatus === 'disconnected') {
    return {
      glyph: '✖',
      shortLabel: 'Sensor Off',
      label: 'Sensor Offline',
      detailLabel: 'Link Disconnected',
      tone: 'critical',
    };
  }
  if (sensorStream.wsStatus === 'reconnecting') {
    return {
      glyph: '▲',
      shortLabel: 'Reconnecting',
      label: 'Sensor Reconnecting',
      detailLabel: 'Reconnecting Link',
      tone: 'warning',
    };
  }
  if (sensorStream.wsStatus === 'connecting' || sensorStream.modelStatus === 'loading') {
    return {
      glyph: '○',
      shortLabel: 'Sensor Init',
      label: 'Sensor Loading',
      detailLabel:
        sensorStream.wsStatus === 'connecting' ? 'Connecting Link' : 'Loading Vision Model',
      tone: 'neutral',
    };
  }
  if (isPaused) {
    return {
      glyph: '▲',
      shortLabel: 'Sensor Hold',
      label: 'Sensor Paused',
      detailLabel: 'Capture Paused',
      tone: 'warning',
    };
  }
  if (sensorStream.packetRateHz > 0) {
    return {
      glyph: '●',
      shortLabel: 'Sensor Live',
      label: 'Sensor Live',
      detailLabel: 'Streaming',
      tone: 'nominal',
    };
  }
  return {
    glyph: '●',
    shortLabel: 'Sensor Ready',
    label: 'Sensor Ready',
    detailLabel: 'Linked · Standby',
    tone: 'nominal',
  };
}

function resolveVisionRow(sensorStream, isPaused) {
  if (sensorStream.modelStatus === 'error') {
    return { glyph: '✖', label: 'Model Error', tone: 'critical' };
  }
  if (sensorStream.modelStatus === 'loading') {
    return { glyph: '○', label: 'Loading', tone: 'neutral' };
  }
  if (isPaused) {
    return { glyph: '▲', label: 'Paused', tone: 'warning' };
  }
  if (sensorStream.subjectDetected) {
    return { glyph: '●', label: 'Subject Locked', tone: 'nominal' };
  }
  return { glyph: '●', label: 'Ready · No Subject', tone: 'nominal' };
}

function resolveSocketRow(sensorStream) {
  if (sensorStream.wsStatus === 'disconnected') {
    return { glyph: '✖', label: 'Disconnected', tone: 'critical' };
  }
  if (sensorStream.wsStatus === 'reconnecting') {
    return { glyph: '▲', label: 'Reconnecting', tone: 'warning' };
  }
  if (sensorStream.wsStatus === 'connecting') {
    return { glyph: '○', label: 'Connecting', tone: 'neutral' };
  }
  if (sensorStream.packetRateHz > 0) {
    return { glyph: '●', label: 'Streaming', tone: 'nominal' };
  }
  return { glyph: '●', label: 'Connected · Idle', tone: 'nominal' };
}

function formatPacketAge(ageSec) {
  if (ageSec === null || ageSec === undefined) return 'Awaiting frames';
  if (ageSec < 1) return '<1s ago';
  if (ageSec < 60) return `${Math.round(ageSec)}s ago`;
  return `${Math.floor(ageSec / 60)}m ago`;
}

export default function StreamStatusIndicator({
  cameraStream,
  sensorStream,
  trackerType,
  calibrationStatus,
  isPaused,
  onRetryCamera,
  onReconnectSensor,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const cameraSummary = resolveCameraSummary(cameraStream, isPaused);
  const sensorSummary = resolveSensorSummary(sensorStream, isPaused);
  const visionRow = resolveVisionRow(sensorStream, isPaused);
  const socketRow = resolveSocketRow(sensorStream);

  const hasCritical =
    cameraSummary.tone === 'critical' || sensorSummary.tone === 'critical';
  const hasWarning =
    cameraSummary.tone === 'warning' || sensorSummary.tone === 'warning';
  const overall = hasCritical
    ? { glyph: '✖', label: 'Stream Fault', tone: 'critical' }
    : hasWarning
    ? { glyph: '▲', label: 'Degraded', tone: 'warning' }
    : cameraSummary.tone === 'nominal' && sensorSummary.tone === 'nominal'
    ? { glyph: '●', label: 'All Streams Nominal', tone: 'nominal' }
    : { glyph: '○', label: 'Initializing Streams', tone: 'neutral' };

  const triggerBorder = hasCritical
    ? 'border-rose-300 bg-rose-50/90 hover:bg-rose-50'
    : hasWarning
    ? 'border-amber-300 bg-amber-50/90 hover:bg-amber-50'
    : 'border-green-300 bg-green-100/75 hover:bg-green-100';

  const canRetryCamera =
    cameraStream.status === 'denied' ||
    cameraStream.status === 'disconnected' ||
    cameraStream.status === 'error';

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`Input stream status: ${cameraSummary.label}, ${sensorSummary.label}. Open stream diagnostics.`}
        className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg border text-xs font-mono transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${triggerBorder}`}
      >
        <span className={`font-medium ${TONE_CLASSES[cameraSummary.tone]}`}>
          <span aria-hidden="true" className="mr-1">
            {cameraSummary.glyph}
          </span>
          <span className="hidden sm:inline">{cameraSummary.label}</span>
          <span className="sm:hidden">{cameraSummary.shortLabel}</span>
        </span>

        <span className="text-green-400" aria-hidden="true">
          ·
        </span>

        <span className={`font-medium ${TONE_CLASSES[sensorSummary.tone]}`}>
          <span aria-hidden="true" className="mr-1">
            {sensorSummary.glyph}
          </span>
          <span className="hidden sm:inline">{sensorSummary.label}</span>
          <span className="sm:hidden">{sensorSummary.shortLabel}</span>
        </span>

        <svg
          className={`w-3.5 h-3.5 text-slate-600 transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`}
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Camera and Sensor Input Stream Diagnostics"
          className="absolute right-0 mt-2 w-80 sm:w-96 z-50 bg-green-50 border border-green-300 rounded-xl shadow-lg p-4 text-left"
        >
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-green-200">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Input Stream Diagnostics
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Live optical camera and kinematic sensor channels
              </p>
            </div>
            <span
              className={`text-xs font-mono font-semibold whitespace-nowrap ${
                TONE_CLASSES[overall.tone]
              }`}
            >
              {overall.glyph} {overall.label}
            </span>
          </div>

          {/* 1. Optical Camera Input */}
          <div className="py-3 border-b border-green-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900">
                Optical Camera Feed
              </span>
              <span
                className={`text-xs font-mono font-medium ${
                  TONE_CLASSES[cameraSummary.tone]
                }`}
              >
                {cameraSummary.glyph} {cameraSummary.detailLabel}
              </span>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-mono text-slate-600 tabular-nums">
              <span className="truncate max-w-[200px]" title={cameraStream.deviceLabel || 'Default video input'}>
                {cameraStream.deviceLabel || 'Default camera input'}
              </span>
              <span>
                {cameraStream.resolution ? `${cameraStream.resolution} · ` : ''}
                {cameraStream.fps.toFixed(1)} fps
              </span>
            </div>

            {cameraStream.errorMessage && (
              <p className="mt-1.5 text-xs text-rose-700 leading-relaxed">
                {cameraStream.errorMessage}
              </p>
            )}

            {canRetryCamera && (
              <button
                type="button"
                onClick={onRetryCamera}
                className="mt-2 px-3 py-1.5 rounded-md bg-green-100 hover:bg-green-200 border border-green-300 text-xs font-medium text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              >
                Retry Camera
              </button>
            )}
          </div>

          {/* 2. Vision Landmark Sensor */}
          <div className="py-3 border-b border-green-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900">
                Optical Landmark Sensor
              </span>
              <span
                className={`text-xs font-mono font-medium ${
                  TONE_CLASSES[visionRow.tone]
                }`}
              >
                {visionRow.glyph} {visionRow.label}
              </span>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-mono text-slate-600">
              <span>
                {trackerType === 'hands'
                  ? 'MediaPipe Hands · 21 pts'
                  : 'MediaPipe Pose · 33 pts'}
              </span>
              <span>
                {calibrationStatus === 'calibrated' ? 'Normalized' : 'Calibrating'}
              </span>
            </div>

            {sensorStream.modelError && (
              <p className="mt-1.5 text-xs text-rose-700 leading-relaxed">
                {sensorStream.modelError}
              </p>
            )}
          </div>

          {/* 3. Kinematic Telemetry Sensor Stream */}
          <div className="pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900">
                Kinematic Sensor Stream
              </span>
              <span
                className={`text-xs font-mono font-medium ${
                  TONE_CLASSES[socketRow.tone]
                }`}
              >
                {socketRow.glyph} {socketRow.label}
              </span>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-mono text-slate-600 tabular-nums">
              <span>Rate {sensorStream.packetRateHz.toFixed(1)} Hz</span>
              <span>Last packet: {formatPacketAge(sensorStream.lastPacketAgeSec)}</span>
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2">
              <span className="text-xs font-mono text-slate-500">
                Channel /ws/movement
              </span>
              <button
                type="button"
                onClick={onReconnectSensor}
                className="px-3 py-1 rounded-md bg-green-100 hover:bg-green-200 border border-green-300 text-xs font-medium text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              >
                Reconnect Stream
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
