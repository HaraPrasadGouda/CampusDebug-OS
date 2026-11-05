import React, { useEffect, useState } from 'react';
import { UserCheck } from 'lucide-react';
import { getAccessToken } from '../../utils/authClient';
import { profName } from '../../utils/teacherCover';

// Profile popup line for a teacher covering an absent colleague today:
// "Today covering: Dr. Priya Mishra". Renders nothing otherwise.
export default function CoverTodayLine({ currentRole }) {
  const [covering, setCovering] = useState([]);
  useEffect(() => {
    if (currentRole !== 'Teacher') return undefined;
    let alive = true;
    (async () => {
      try {
        const tok = getAccessToken();
        const r = await fetch('/api/leave-requests/teacher-absent', tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
        const j = await r.json();
        if (alive && j?.success) setCovering(Array.isArray(j.covering) ? j.covering : []);
      } catch { /* offline: no line */ }
    })();
    return () => { alive = false; };
  }, [currentRole]);
  if (currentRole !== 'Teacher' || covering.length === 0) return null;
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-indigo-50 border border-indigo-200">
      <UserCheck className="w-5 h-5 text-indigo-600 shrink-0" />
      <div className="min-w-0">
        <p className="text-[11px] text-indigo-700 uppercase font-bold tracking-wider">Today covering</p>
        <p className="text-sm font-semibold text-slate-800 break-words">{covering.map(c => profName(c.name)).join(', ')}</p>
      </div>
    </div>
  );
}
