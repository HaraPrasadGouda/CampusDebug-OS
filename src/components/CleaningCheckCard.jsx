import React, { useCallback, useEffect, useState } from 'react';
import { Sparkles, Check, Lock, X } from 'lucide-react';

// Student home card: "Aaj room saaf hua?" (cleaning day, 1 PM - 9 PM only).
// The server decides if the card shows at all; nothing is rendered otherwise.
// The first roommate to answer answers for the whole room; the others see who did.

const ANSWER_LABEL = { yes: 'Haan', no: 'Nahi' };

// Pure view (used by the dashboard and by the screenshot harness).
export function CleaningCheckView({ data, busy = false, error = '', onAnswer = () => {} }) {
  if (!data || !data.show) return null;
  const { state, answer, answeredByName, room, block, closesLabel } = data;
  const locked = state === 'locked_by_other';
  const mine = state === 'answered_by_me';
  const place = [block, room ? `Room ${room}` : ''].filter(Boolean).join(' · ');

  const bigBtn = (value) => {
    const isYes = value === 'yes';
    const chosen = mine && answer === value;
    const base = 'min-h-[52px] rounded-2xl text-[16px] font-extrabold flex items-center justify-center gap-2 transition active:scale-[0.98] disabled:cursor-not-allowed';
    const tone = locked
      ? 'bg-slate-100 text-slate-400 border border-slate-200'
      : chosen
        ? (isYes ? 'bg-emerald-600 text-white ring-4 ring-emerald-200' : 'bg-rose-600 text-white ring-4 ring-rose-200')
        : isYes
          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
          : 'bg-white hover:bg-rose-50 text-rose-700 border-2 border-rose-300';
    return (
      <button key={value} type="button" disabled={busy || locked || chosen} onClick={() => onAnswer(value)} className={`${base} ${tone}`}>
        {isYes ? <Check className="w-5 h-5" strokeWidth={3} /> : <X className="w-5 h-5" strokeWidth={3} />}
        {ANSWER_LABEL[value]}
      </button>
    );
  };

  return (
    <div className="relative overflow-hidden rounded-2xl p-4 sm:p-5 bg-gradient-to-br from-[#ecfeff] to-[#f0fdf4] border-2 border-[#a5f3fc] shadow-[0_6px_20px_rgba(8,145,178,0.10)]" data-testid="cleaning-card">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-cyan-100 text-cyan-800 flex items-center justify-center border border-cyan-200 shrink-0">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black tracking-wider uppercase text-cyan-700">Cleaning day{place ? ` · ${place}` : ''}</p>
          <h3 className="text-[19px] font-extrabold text-slate-900 leading-tight mt-0.5">Aaj room saaf hua?</h3>
          {state === 'open' && (
            <p className="text-[12px] text-slate-600 font-medium mt-1 leading-snug">Ek jawab poore room ka maana jayega. Jawab {closesLabel || '9 PM'} tak badal sakte ho.</p>
          )}
        </div>
      </div>

      {locked && (
        <div className="mt-3 rounded-xl bg-white/80 border border-slate-200 px-3 py-2.5 flex items-start gap-2 text-[13px] font-bold text-slate-800">
          <Lock className="w-4 h-4 mt-0.5 shrink-0 text-slate-500" />
          <span className="min-w-0 break-words">{answeredByName} ne jawab de diya: <span className={answer === 'yes' ? 'text-emerald-700' : 'text-rose-700'}>{ANSWER_LABEL[answer] || answer}</span></span>
        </div>
      )}
      {mine && (
        <p className="mt-3 text-[13px] font-bold text-slate-800">
          Tumne jawab diya: <span className={answer === 'yes' ? 'text-emerald-700' : 'text-rose-700'}>{ANSWER_LABEL[answer]}</span>
          <span className="block text-[11.5px] font-medium text-slate-500 mt-0.5">Galat tap hua? Dusra button dabao, {closesLabel || '9 PM'} tak badal sakte ho.</span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 mt-3.5">
        {bigBtn('yes')}
        {bigBtn('no')}
      </div>
      {error && <p className="mt-2 text-[12px] font-bold text-rose-700" role="alert">{error}</p>}
    </div>
  );
}

export default function CleaningCheckCard() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/cleaning/mine');
      const j = await r.json();
      setData(j && j.success ? j : null);
    } catch { /* offline: the card just doesn't show */ }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60000);
    return () => clearInterval(iv);
  }, [load]);

  const answer = async (value) => {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/cleaning/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setError(j.error || 'Jawab save nahi hua. Dobara try karo.');
    } catch { setError('Internet nahi hai. Dobara try karo.'); }
    await load();
    setBusy(false);
  };

  if (!data || !data.show) return null;
  return <CleaningCheckView data={data} busy={busy} error={error} onAnswer={answer} />;
}
