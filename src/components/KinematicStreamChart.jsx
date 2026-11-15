import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';

function CustomTooltip({ active, payload, isHands }) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  return (
    <div className="bg-slate-950/95 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono tabular-nums shadow-lg">
      <p className="text-slate-400 mb-1">{pt.timeLabel}</p>
      {isHands ? (
        <>
          <p className="text-green-300">
            Pinch Aperture: <span className="font-semibold">{(pt.pinchAperture ?? 0).toFixed(1)}%</span>
          </p>
          <p className="text-emerald-400">
            Pinch Span: <span className="font-semibold">{(pt.pinchMm ?? 0).toFixed(1)} mm</span>
          </p>
          <p className="text-amber-300">
            MCP Angle: <span className="font-semibold">{(pt.angle ?? 0).toFixed(1)}°</span>
          </p>
        </>
      ) : (
        <p className="text-green-300">
          Joint Angle: <span className="font-semibold">{(pt.angle ?? 0).toFixed(1)}°</span>
        </p>
      )}
      <p className="text-slate-400 mt-0.5">Reps: {pt.reps ?? 0}</p>
    </div>
  );
}

function KinematicStreamChart({ telemetrySeries, exercise, isHands }) {
  const startTs = telemetrySeries.length > 0 ? telemetrySeries[0].time : 0;

  const chartData = telemetrySeries.map((pt, idx) => {
    const elapsedSec = ((pt.time - startTs) / 1000).toFixed(1);
    return {
      ...pt,
      index: idx,
      timeLabel: `${elapsedSec}s`,
    };
  });

  if (chartData.length === 0) {
    return (
      <div className="w-full h-48 rounded-lg border border-slate-800 bg-slate-950 flex items-center justify-center">
        <span className="text-xs font-mono text-slate-500">
          Awaiting live kinematic stream...
        </span>
      </div>
    );
  }

  return (
    <div className="w-full h-48 min-w-0 rounded-lg border border-slate-800 bg-slate-950 pt-3 pr-2 pb-1 pl-0">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 6, right: 10, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="kinematicGreenFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#86EFAC" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#86EFAC" stopOpacity={0.0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" vertical={false} />

          <XAxis
            dataKey="timeLabel"
            tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
            axisLine={{ stroke: '#1E293B' }}
            tickLine={false}
            minTickGap={28}
          />

          <YAxis
            yAxisId="primary"
            domain={isHands ? [0, 120] : [0, 180]}
            ticks={isHands ? [0, 30, 60, 90, 120] : [0, 45, 90, 135, 180]}
            tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => (isHands ? `${v}%` : `${v}°`)}
          />

          {isHands && (
            <YAxis
              yAxisId="mcp"
              orientation="right"
              domain={[0, 180]}
              hide
            />
          )}

          <Tooltip content={<CustomTooltip isHands={isHands} />} />

          {!isHands && exercise?.rom_target_min != null && (
            <ReferenceLine
              yAxisId="primary"
              y={exercise.rom_target_min}
              stroke="#4ADE80"
              strokeOpacity={0.45}
              strokeDasharray="4 4"
            />
          )}
          {!isHands && exercise?.rom_target_max != null && (
            <ReferenceLine
              yAxisId="primary"
              y={exercise.rom_target_max}
              stroke="#4ADE80"
              strokeOpacity={0.45}
              strokeDasharray="4 4"
            />
          )}

          <Area
            yAxisId="primary"
            type="monotone"
            dataKey={isHands ? 'pinchAperture' : 'angle'}
            stroke="#86EFAC"
            strokeWidth={2}
            fill="url(#kinematicGreenFill)"
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 4, fill: '#86EFAC', stroke: '#020617', strokeWidth: 1.5 }}
          />

          {isHands && (
            <Line
              yAxisId="mcp"
              type="monotone"
              dataKey="angle"
              stroke="#FBBF24"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default KinematicStreamChart;
