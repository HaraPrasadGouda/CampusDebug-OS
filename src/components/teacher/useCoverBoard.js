import { useState, useEffect, useCallback } from 'react';
import { tfetch } from '../../utils/teacherApi';

// The teacher's cover board (cards they can take / that others took / that they took).
// Re-reads every 20 s and whenever the tab comes back, so a card taken by a
// colleague closes here without a manual refresh.
export default function useCoverBoard(enabled = true) {
  const [data, setData] = useState(null);
  const reload = useCallback(async () => {
    const r = await tfetch('/api/teacher/cover-board');
    if (r.ok) setData({ open: r.open || [], taken: r.taken || [], mine: r.mine || [], onLeave: !!r.onLeave });
    return r;
  }, []);
  useEffect(() => {
    if (!enabled) return undefined;
    reload();
    const t = setInterval(reload, 20000);
    const vis = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [enabled, reload]);
  return { board: data, reload };
}
