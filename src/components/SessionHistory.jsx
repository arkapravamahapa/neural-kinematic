import { useCallback, useEffect, useState } from 'react';

function SessionHistory({ patientId, refreshTrigger, onHistoryChanged, onSessionsLoaded }) {
  const [history, setHistory] = useState([]);
  const [deletingId, setDeletingId] = useState(null);

  const fetchHistory = useCallback(async () => {
    try {
      const id = encodeURIComponent(patientId || 'PT-1042');
      const response = await fetch(`/api/history/${id}`);
      const data = await response.json();
      if (Array.isArray(data)) {
        setHistory(data);
        onSessionsLoaded?.(data);
      }
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  }, [patientId, onSessionsLoaded]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchHistory();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchHistory, refreshTrigger]);

  const handleDeleteSession = async (sessionId) => {
    setDeletingId(sessionId);
    try {
      const res = await fetch(`/api/history/${sessionId}`, { method: 'DELETE' });
      if (res.ok) {
        setHistory((prev) => {
          const next = prev.filter((item) => item.id !== sessionId);
          onSessionsLoaded?.(next);
          return next;
        });
        onHistoryChanged?.();
      }
    } catch (err) {
      console.error('Error deleting session:', err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="bg-green-50 p-5 rounded-xl border border-green-200">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 tracking-tight">
            Longitudinal Recovery Log
          </h2>
          <p className="text-xs text-slate-600 font-mono mt-0.5">
            Patient {patientId || 'PT-1042'} · {history.length} saved · Side, Adherence &amp; Drift Verified
          </p>
        </div>
        <button
          type="button"
          onClick={fetchHistory}
          className="px-2.5 py-1 rounded border border-green-300 bg-green-100/70 hover:bg-green-200/70 text-xs font-mono text-slate-800 transition-colors"
        >
          Refresh
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-green-200 bg-green-50/70">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-green-100/70 text-slate-700 border-b border-green-200">
            <tr>
              <th className="py-2.5 px-3 font-medium">Timestamp</th>
              <th className="py-2.5 px-3 font-medium">Protocol &amp; Insights</th>
              <th className="py-2.5 px-3 font-medium">Side</th>
              <th className="py-2.5 px-3 font-medium">Reps / ROM</th>
              <th className="py-2.5 px-3 font-medium">Adherence</th>
              <th className="py-2.5 px-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-green-200/80 font-mono tabular-nums">
            {history.length === 0 ? (
              <tr>
                <td colSpan="6" className="py-6 text-center text-slate-600 font-sans">
                  No sessions saved yet for {patientId || 'PT-1042'}. Complete a set and click Save Session.
                </td>
              </tr>
            ) : (
              history.map((session) => {
                const formattedDate = new Date(session.created_at).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });

                const adherenceVal = Number(session.adherence_score ?? 0);
                const safeZoneVal = Number(session.safe_zone_pct ?? 0);
                const adherenceColor =
                  adherenceVal >= 80
                    ? 'text-emerald-700'
                    : adherenceVal >= 60
                    ? 'text-amber-700'
                    : adherenceVal > 0
                    ? 'text-rose-700'
                    : 'text-slate-600';

                const fatigueTone =
                  session.fatigue_severity === 'critical'
                    ? 'text-rose-700'
                    : session.fatigue_severity === 'warning'
                    ? 'text-amber-700'
                    : 'text-emerald-800';

                return (
                  <tr key={session.id} className="hover:bg-green-100/50 transition-colors">
                    <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap align-top">
                      {formattedDate}
                    </td>
                    <td className="py-2.5 px-3 text-slate-800 align-top">
                      <div className="font-semibold text-slate-900">{session.exercise_id}</div>
                      {session.fatigue_summary && (
                        <div className={`text-[11px] font-sans mt-0.5 ${fatigueTone}`}>
                          {session.fatigue_summary}
                        </div>
                      )}
                      {session.notes && (
                        <div
                          className="text-[11px] font-sans text-slate-600 mt-0.5 max-w-[220px] truncate"
                          title={session.notes}
                        >
                          Note: {session.notes}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-800 align-top whitespace-nowrap">
                      {session.limb_side || 'Left'}
                    </td>
                    <td className="py-2.5 px-3 align-top whitespace-nowrap">
                      <div className="text-slate-900 font-semibold">{session.rep_count} reps</div>
                      <div className="text-[11px] text-emerald-800">
                        {session.left_max_rom}° · DTW {session.symmetry_score}%
                      </div>
                    </td>
                    <td className="py-2.5 px-3 align-top whitespace-nowrap">
                      <div className={`font-semibold ${adherenceColor}`}>
                        {adherenceVal > 0 ? `${adherenceVal}%` : '—'}
                      </div>
                      <div className="text-[11px] text-slate-600">
                        Safe {safeZoneVal}% · {session.compensation_count ?? 0} comp
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right align-top">
                      <button
                        type="button"
                        disabled={deletingId === session.id}
                        onClick={() => handleDeleteSession(session.id)}
                        className="text-[11px] text-rose-700 hover:text-rose-900 underline underline-offset-2 disabled:opacity-40"
                      >
                        {deletingId === session.id ? 'Removing...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default SessionHistory;