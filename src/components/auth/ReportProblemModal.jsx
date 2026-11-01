import React, { useState, useRef, useEffect } from 'react';
import { X, UploadCloud, Loader, CheckCircle2, AlertCircle } from 'lucide-react';
import { queueOfflineAction, saveLocal } from '../../utils/db';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB, per mockup

const ISSUE_OPTIONS = [
  'Login / password issue',
  'Verify Record not working',
  'Wrong details in my record',
  'Account locked',
  'App not loading',
  'Other'
];

export default function ReportProblemModal({ open, onClose, initialRoll = '' }) {
  const [roll, setRoll] = useState(initialRoll);
  const [issue, setIssue] = useState(ISSUE_OPTIONS[0]);
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState(null); // { name, dataUrl } | null
  const [photoError, setPhotoError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // 'synced' | 'queued' | null
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) {
      setRoll(initialRoll);
      setIssue(ISSUE_OPTIONS[0]);
      setDescription('');
      setPhoto(null);
      setPhotoError('');
      setResult(null);
    }
  }, [open, initialRoll]);

  if (!open) return null;

  const handlePickPhoto = (e) => {
    const file = e.target.files && e.target.files[0];
    setPhotoError('');
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError(`Too large (${(file.size / 1024 / 1024).toFixed(1)} MB) — max 5 MB.`);
      return;
    }
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
      setPhotoError('Only PNG or JPG screenshots are supported.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhoto({ name: file.name, dataUrl: String(reader.result) });
    reader.onerror = () => setPhotoError('Could not read that file — try another screenshot.');
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!description.trim()) return;
    setBusy(true);
    const ts = new Date().toISOString();
    const ticketId = `TKT-${Math.floor(10000 + Math.random() * 90000)}`;

    const localTicket = {
      id: ticketId,
      type: 'ticket',
      title: `Portal Support: ${issue}${roll.trim() ? ` (${roll.trim()})` : ''}`,
      category: 'Portal Support',
      location: 'Login screen',
      urgency: 'NORMAL',
      description: description.trim(),
      reportedBy: roll.trim() || 'not signed in',
      screenshot: photo ? { name: photo.name, dataUrl: photo.dataUrl } : undefined,
      status: 'PENDING',
      statusLabel: 'Submitted from login screen',
      sla: 'SLA: 4h Standard',
      sla_hours: 4,
      createdAt: ts,
      time: 'Just now'
    };

    // Login-screen support report: unauthenticated endpoint (works signed-out);
    // if unreachable, queue so the sync engine replays it when back online.
    let synced = false;
    try {
      const res = await fetch('/api/support/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roll: roll.trim(),
          issue,
          description: description.trim()
        })
      });
      synced = res.ok;
    } catch {
      synced = false;
    }

    if (!synced) {
      try {
        await queueOfflineAction('SUPPORT_REPORT', {
          roll: roll.trim(),
          issue,
          description: description.trim()
        });
      } catch (qErr) {
        console.warn('Support report queue write failed:', qErr.message);
      }
    }

    try { await saveLocal('tickets', localTicket); } catch { /* non-fatal: local breadcrumb only */ }

    setResult(synced ? 'synced' : 'queued');
    setBusy(false);
  };

  return (
    <div
      className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/50 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {result ? (
          <div className="px-6 py-10 text-center">
            <span className="inline-flex w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 items-center justify-center mb-4">
              <CheckCircle2 className="w-7 h-7 text-emerald-600" />
            </span>
            <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">Problem reported</h3>
            <p className="mt-2 text-xs text-slate-500 leading-relaxed max-w-[34ch] mx-auto">
              {result === 'synced'
                ? 'Your report reached the team desk just now.'
                : "You're offline — your report is saved and will auto-sync the moment your connection returns."}
            </p>
            <button
              onClick={onClose}
              className="mt-6 w-full rounded-xl bg-emerald-600 py-3 text-xs font-extrabold text-white hover:bg-emerald-700 transition-colors cursor-pointer"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="sticky top-0 bg-white/95 backdrop-blur px-5 pt-5 pb-3 flex items-start justify-between border-b border-slate-100">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 tracking-tight">Report a problem</h3>
                <p className="text-[11px] text-slate-500">Your report becomes a real ticket our team works through.</p>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors cursor-pointer shrink-0"
                aria-label="Close report"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-[11px] font-extrabold text-slate-700 mb-1.5">Roll No / Staff ID (optional)</label>
                <input
                  value={roll}
                  onChange={(e) => setRoll(e.target.value)}
                  placeholder="e.g. 2201106001 or WDN-001"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-extrabold text-slate-700 mb-1.5">Issue</label>
                <select
                  value={issue}
                  onChange={(e) => setIssue(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-500"
                >
                  {ISSUE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>

              <div>
                <div className="flex items-baseline justify-between mb-1.5">
                  <label className="block text-[11px] font-extrabold text-slate-700">Description</label>
                  <span className={`text-[10px] font-mono font-bold ${description.length >= 450 ? 'text-amber-600' : 'text-slate-400'}`}>
                    {description.length}/500
                  </span>
                </div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, 500))}
                  rows={4}
                  placeholder="What happened? What did you expect instead?"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-extrabold text-slate-700 mb-1.5">Screenshot (optional)</label>
                {photo ? (
                  <div className="flex items-center gap-2.5 p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60">
                    <img src={photo.dataUrl} alt="attachment" className="w-9 h-9 rounded-lg object-cover border border-emerald-200" />
                    <span className="min-w-0 flex-1 text-xs font-bold text-slate-700 truncate">{photo.name}</span>
                    <button
                      type="button"
                      onClick={() => setPhoto(null)}
                      className="text-[10px] font-extrabold text-rose-600 hover:underline cursor-pointer shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current && fileRef.current.click()}
                    className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 py-3 text-[11px] font-bold text-slate-500 hover:border-emerald-400 hover:text-emerald-700 transition-colors cursor-pointer"
                  >
                    <UploadCloud className="w-4 h-4" />
                    Attach a PNG / JPG screenshot (max 5 MB)
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={handlePickPhoto}
                />
                {photoError && (
                  <p className="mt-1.5 text-[10px] text-rose-600 font-bold flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {photoError}
                  </p>
                )}
              </div>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-xl border border-slate-200 py-3 text-xs font-extrabold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || !description.trim()}
                  className="flex-1 rounded-xl bg-emerald-600 py-3 text-xs font-extrabold text-white hover:bg-emerald-700 transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {busy ? <Loader className="w-4 h-4 animate-spin" /> : null}
                  Submit
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
