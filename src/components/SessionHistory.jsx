import { useEffect, useState } from 'react';

function SessionHistory({ patientId, refreshTrigger }) {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const id = encodeURIComponent(patientId || 'PT-1042');
        const response = await fetch(`/api/history/${id}`);
        const data = await response.json();
        if (Array.isArray(data)) setHistory(data);
      } catch (error) {
        console.error('Error fetching history:', error);
      }
    };
    fetchHistory();
  }, [patientId, refreshTrigger]);

  return (
    <div className="bg-slate-900/80 backdrop-blur-md p-6 rounded-xl border border-slate-800">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100 tracking-tight">
            Longitudinal Recovery Log
          </h2>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Patient {patientId || 'PT-1042'}
          </p>
        </div>
        <span className="text-xs font-mono text-slate-400 tabular-nums">
          {history.length} saved
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800">
            <tr>
              <th className="py-3 px-4 font-medium">Timestamp</th>
              <th className="py-3 px-4 font-medium">Protocol</th>
              <th className="py-3 px-4 font-medium">Reps</th>
              <th className="py-3 px-4 font-medium">Max ROM</th>
              <th className="py-3 px-4 font-medium">Consistency</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 font-mono tabular-nums">
            {history.length === 0 ? (
              <tr>
                <td colSpan="5" className="py-6 text-center text-slate-500 font-sans">
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

                const scoreColor =
                  session.symmetry_score >= 80
                    ? 'text-green-300'
                    : session.symmetry_score >= 60
                    ? 'text-amber-300'
                    : 'text-rose-400';

                return (
                  <tr key={session.id} className="hover:bg-slate-900/50 transition-colors">
                    <td className="py-3 px-4 text-slate-400">{formattedDate}</td>
                    <td className="py-3 px-4 text-slate-200">{session.exercise_id}</td>
                    <td className="py-3 px-4 text-slate-100 font-semibold">{session.rep_count}</td>
                    <td className="py-3 px-4 text-green-300">{session.left_max_rom}°</td>
                    <td className={`py-3 px-4 font-semibold ${scoreColor}`}>
                      {session.symmetry_score}%
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