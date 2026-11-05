import { useEffect, useState, useCallback } from 'react';
import { tfetch } from '../../utils/teacherApi';

// Cover-board banners for the admin Home: the same endpoints AdminCoverAlerts
// uses (list, "Mark class cancelled", "Undo"), polled every 30 s. No new API.
export default function useCoverBoard(onNotification) {
  const [banners, setBanners] = useState(null); // null = not loaded yet
  const [busy, setBusy] = useState(null);
  const load = useCallback(async () => {
    const r = await tfetch('/api/admin/cover-board');
    if (r.ok) setBanners(r.banners || []);
    else setBanners(prev => prev || []);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  const act = async (b, path) => {
    setBusy(b.id);
    const r = await tfetch(`/api/admin/cover-board/${encodeURIComponent(b.id)}/${path}`, 'POST', {});
    onNotification?.(r.message || r.error || 'Done', r.ok ? 'success' : 'error');
    await load();
    setBusy(null);
  };
  return {
    banners,
    busy,
    cancel: (b) => act(b, 'cancel'),
    undo: (b) => act(b, 'undo-cancel')
  };
}
