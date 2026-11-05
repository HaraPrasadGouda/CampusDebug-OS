import { getAccessToken } from './authClient';

// Small fetch helper for the teacher screens: JSON in, JSON out, never throws.
export async function tfetch(path, method = 'GET', body) {
  try {
    const tok = getAccessToken();
    const r = await fetch(path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j?.success !== false, status: r.status, ...j };
  } catch {
    return { ok: false, status: 0, error: 'Offline — try again when you are connected.' };
  }
}

export const fmtMinLabel = (m) => {
  const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0');
  return `${h > 12 ? h - 12 : h || 12}:${mm} ${h >= 12 ? 'PM' : 'AM'}`;
};
export const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
