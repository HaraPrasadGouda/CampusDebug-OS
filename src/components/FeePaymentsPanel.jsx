import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Receipt } from 'lucide-react';

// Read-only "Fee payments" list for Warden / Admin / Dean.
// Data: GET /api/fees/payments (staff only on the server too). Receipts come from the students' demo
// "Settle Dues" taps. Nothing here can change a payment.

const fmtMoney = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`;
const fmtWhen = (iso) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
};

// Pure view, also used by the screenshot harness.
export function FeePaymentsView({ data, error = null, loading = false, onRefresh = () => {} }) {
  const [q, setQ] = useState('');
  const all = data?.payments || [];
  const rows = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return all;
    return all.filter((p) => `${p.payer_name || ''} ${p.roll_number} ${p.receipt_id}`.toLowerCase().includes(k));
  }, [all, q]);

  return (
    <div data-testid="fee-payments" className="space-y-3 min-w-0">
      <div className="flex items-stretch gap-2 min-w-0">
        <div className="grid grid-cols-2 gap-2 flex-1 min-w-0">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 min-w-0">
            <p className="text-[18px] sm:text-[20px] font-extrabold font-mono leading-tight text-emerald-900 break-words">{data ? data.totalCount : '—'}</p>
            <p className="text-[11px] font-bold mt-1 text-emerald-800">Receipts</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 min-w-0">
            <p className="text-[18px] sm:text-[20px] font-extrabold font-mono leading-tight text-slate-900 break-words">{data ? fmtMoney(data.totalAmount) : '—'}</p>
            <p className="text-[11px] font-bold mt-1 text-slate-600">Collected (demo)</p>
          </div>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} aria-label="Refresh fee payments"
          className="w-11 min-h-[44px] shrink-0 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 flex items-center justify-center cursor-pointer disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <label className="flex items-center gap-2 min-h-[44px] px-3 rounded-xl border border-slate-200 bg-white focus-within:border-slate-400">
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, roll or receipt"
          className="flex-1 min-w-0 bg-transparent outline-none text-base sm:text-sm text-slate-800 placeholder:text-slate-400" />
      </label>

      {error ? (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">{error}</div>
      ) : !data ? (
        <div className="py-8 text-center text-slate-500 text-xs">Loading fee payments…</div>
      ) : all.length === 0 ? (
        <div className="py-8 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
          <Receipt className="w-5 h-5" />
          No payments yet. They appear here as students tap Settle Dues.
        </div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <ul className="max-h-[420px] overflow-y-auto overscroll-contain divide-y divide-slate-100">
            {rows.length === 0 && <li className="px-3.5 py-6 text-center text-xs text-slate-400">No payment matches that search.</li>}
            {rows.map((p) => (
              <li key={p.receipt_id} className="px-3.5 py-2.5 flex items-start justify-between gap-3 min-w-0">
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-slate-900 break-words">{p.payer_name || 'Student'} <span className="font-mono font-semibold text-slate-500 text-[11px]">· {p.roll_number}</span></div>
                  <div className="font-mono text-[11px] text-slate-500 break-all">{p.receipt_id}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono text-[13px] font-extrabold text-slate-900 whitespace-nowrap">{fmtMoney(p.amount)}</div>
                  <div className="text-[10.5px] text-slate-500 whitespace-nowrap">{fmtWhen(p.paid_at)}</div>
                </div>
              </li>
            ))}
          </ul>
          {data.totalCount > all.length && (
            <div className="px-3.5 py-2 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500">Showing the newest {all.length} of {data.totalCount}. Search filters what is shown.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FeePaymentsPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/fees/payments')
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (ok && j?.success) { setData(j); setError(null); }
        else setError(j?.error || 'Could not load fee payments.');
      })
      .catch(() => setError('Offline — could not load fee payments.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  return <FeePaymentsView data={data} error={error} loading={loading} onRefresh={load} />;
}
