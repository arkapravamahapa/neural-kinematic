// src/components/SessionHistory.jsx
import { useEffect, useState } from 'react'

function SessionHistory({ refreshTrigger }) {
  const [history, setHistory] = useState([])

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        // Fetching data specifically for our dummy patient
        const response = await fetch("http://127.0.0.1:8000/api/history/11111111-1111-1111-1111-111111111111")
        const data = await response.json()
        setHistory(data)
      } catch (error) {
        console.error("Error fetching history:", error)
      }
    }
    fetchHistory()
  }, [refreshTrigger])

  return (
    <div className="bg-white p-6 rounded-lg shadow-md max-w-4xl mx-auto mt-6">
      <h2 className="text-xl font-semibold mb-4 text-gray-800">Longitudinal Recovery Data (Cloud Sync)</h2>
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="min-w-full bg-white text-left text-sm">
          <thead className="bg-gray-100 text-gray-600">
            <tr>
              <th className="py-3 px-4 border-b font-semibold">Date & Time</th>
              <th className="py-3 px-4 border-b font-semibold">Total Reps</th>
              <th className="py-3 px-4 border-b font-semibold">Left Max ROM</th>
              <th className="py-3 px-4 border-b font-semibold">Right Max ROM</th>
              <th className="py-3 px-4 border-b font-semibold">Symmetry Score</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 ? (
              <tr>
                <td colSpan="5" className="py-6 text-center text-gray-500">No cloud sessions recorded yet.</td>
              </tr>
            ) : (
              history.map(session => {
                // Supabase timestamps look like "2026-11-15T12:00:00+00:00", so we format it
                const formattedDate = new Date(session.created_at).toLocaleString('en-US', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                });

                return (
                  <tr key={session.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 border-b text-gray-700">{formattedDate}</td>
                    <td className="py-3 px-4 border-b text-gray-700 font-semibold">{session.rep_count}</td>
                    <td className="py-3 px-4 border-b text-gray-700">{session.left_max_rom}°</td>
                    <td className="py-3 px-4 border-b text-gray-700">{session.right_max_rom}°</td>
                    <td className="py-3 px-4 border-b">
                      <span className={`font-bold px-2 py-1 rounded ${session.symmetry_score >= 80 ? 'bg-green-100 text-green-700' : session.symmetry_score >= 60 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                        {session.symmetry_score}%
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default SessionHistory