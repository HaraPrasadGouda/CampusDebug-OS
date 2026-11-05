import React, { useState, useEffect } from 'react';
import { ChevronDown, Mail, Phone, Flag, X, LifeBuoy } from 'lucide-react';

// "Need help?" support modal on the login screen (per mockup): FAQ accordion
// + help-desk contact cards + hand-off to the Report-a-problem ticket modal.
// Contact info is DEMO PLACEHOLDER text approved by the team — no real
// numbers are claimed.

const FAQ_ITEMS = [
  {
    q: 'Forgot your Roll No?',
    a: 'Your roll number is printed on your college ID card and on your fee receipt look like 2201106001. Hostel staff use staff codes issued by the warden office (format STAFF-001, e.g. WDN-001 / GRD-001). If you cannot find yours, ask the hostel office or use "Report a problem" below and the team will look it up for you.'
  },
  {
    q: 'Verify Record not working?',
    a: 'The Verify Record chip talks to the live college directory, so it needs an internet connection. Turn your mobile data / Wi-Fi on and tap it again. It also works only for rolls that exist in the current semester roster and accounts that have been activated by the warden.'
  },
  {
    q: 'Account locked?',
    a: 'Too many wrong password attempts temporarily locks sign-in — waiting a few minutes is enough, no data is lost. If it stays locked or you need it unlocked immediately, contact the warden: wardens and the admin desk can reset any account.'
  },
  {
    q: 'Forgot your password?',
    a: 'Your default password is the college pattern: firstname@ followed by the last 4 digits of your registered mobile number (for example rajesh@0121 — first time here? enter exactly that). Sign in with it once and the portal will make you set a private password. If you changed your password and forgot it, ask the warden/admin desk to reset your account back to the default.'
  }
];

export default function NeedHelpModal({ open, onClose, onReportProblem, initialItem = null }) {
  const [openItem, setOpenItem] = useState(initialItem == null ? 0 : initialItem);

  useEffect(() => {
    if (open) setOpenItem(initialItem == null ? 0 : initialItem);
  }, [open, initialItem]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/50 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white/95 backdrop-blur px-5 pt-5 pb-3 flex items-start justify-between border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
              <LifeBuoy className="w-4.5 h-4.5 text-emerald-600" />
            </span>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 tracking-tight">Need help signing in?</h3>
              <p className="text-[11px] text-slate-500">Most issues are solved below — 30 seconds.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors cursor-pointer shrink-0"
            aria-label="Close help"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* FAQ accordion */}
        <div className="px-5 py-4 space-y-2">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setOpenItem(openItem === i ? -1 : i)}
                className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left bg-white hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <span className="text-xs font-extrabold text-slate-800">{item.q}</span>
                <ChevronDown
                  className={`w-4 h-4 shrink-0 text-slate-400 transition-transform duration-200 ${openItem === i ? 'rotate-180 text-emerald-600' : ''}`}
                />
              </button>
              {openItem === i && (
                <p className="px-4 pb-3.5 -mt-0.5 text-[11px] leading-relaxed text-slate-600">
                  {item.a}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Who to ask in person — real routes in the app, no placeholder
            email/phone (none of those was a real support channel). */}
        <div className="px-5 pb-2">
          <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500 font-bold mb-2">Still stuck? Ask in person</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/70">
              <Mail className="w-4 h-4 text-emerald-600 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Forgot password</p>
                <p className="text-xs font-bold text-slate-800">The college admin office can reset it to your default password</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/70">
              <Phone className="w-4 h-4 text-emerald-600 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Pass or leave help</p>
                <p className="text-xs font-bold text-slate-800">Hostellers: your hostel warden · Day scholars: your mentor</p>
              </div>
            </div>
          </div>
        </div>

        {/* Hand-off to the real ticket flow */}
        <div className="px-5 pb-5 pt-3">
          <button
            onClick={() => { onClose(); onReportProblem && onReportProblem(); }}
            className="w-full rounded-xl border-2 border-emerald-600 bg-emerald-50 py-3 text-xs font-extrabold text-emerald-800 hover:bg-emerald-100 transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <Flag className="w-4 h-4" />
            Report a problem
          </button>
          <p className="text-[10px] text-slate-400 text-center mt-2.5">
            Reports become real tickets our team works through — even when sent offline.
          </p>
        </div>
      </div>
    </div>
  );
}
