import React, { useEffect, useState } from 'react';
import { House, GraduationCap, BookOpenCheck, UserRound } from 'lucide-react';
import { useTeacherNav, TEACHER_TABS, goTeacherTab } from '../../utils/teacherNav';

// Phone-only bottom bar for the TEACHER role (hidden >= 1024px, where the sidebar's SECTIONS group
// does the same job). Four tabs, 56px targets, red count badges. It steps aside while a modal is
// open or the on-screen keyboard is up, so it never covers a Save button or a text box.
const ICONS = { today: House, students: GraduationCap, classes: BookOpenCheck, me: UserRound };
const OVERLAY = '.fixed.inset-0:not([aria-hidden="true"]), [role="dialog"], [aria-modal="true"]';

export function useBarHidden(appModalOpen) {
  const [overlay, setOverlay] = useState(false);
  const [kb, setKb] = useState(false);
  useEffect(() => {
    let raf = 0;
    const scan = () => { raf = 0; setOverlay(!!document.querySelector(OVERLAY)); };
    const queue = () => { if (!raf) raf = requestAnimationFrame(scan); };
    scan();
    const mo = new MutationObserver(queue);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    const vv = window.visualViewport;
    const onVv = () => { if (vv) setKb(window.innerHeight - vv.height > 140); };
    vv?.addEventListener('resize', onVv);
    const typing = (el) => !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !['checkbox', 'radio', 'button', 'submit', 'range'].includes(el.type);
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const onIn = (e) => { if (coarse && typing(e.target)) setKb(true); };
    const onOut = () => { setTimeout(() => { if (!typing(document.activeElement)) setKb(vv ? window.innerHeight - vv.height > 140 : false); }, 120); };
    document.addEventListener('focusin', onIn); document.addEventListener('focusout', onOut);
    return () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); vv?.removeEventListener('resize', onVv); document.removeEventListener('focusin', onIn); document.removeEventListener('focusout', onOut); };
  }, []);
  return overlay || kb || !!appModalOpen;
}

export default function TeacherBottomBar({ appModalOpen = false }) {
  const { tab, counts } = useTeacherNav();
  const hidden = useBarHidden(appModalOpen);
  if (hidden) return null;
  const badge = { today: counts.today, students: counts.students };
  return (
    <nav aria-label="Teacher sections" data-testid="teacher-bottom-bar"
      className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-stretch px-2 pt-1.5 pb-1.5">
        {TEACHER_TABS.map(t => {
          const Icon = ICONS[t.id]; const on = tab === t.id; const n = badge[t.id] || 0;
          return (
            <button key={t.id} type="button" data-tab={t.id} aria-current={on ? 'page' : undefined} onClick={() => goTeacherTab(t.id)}
              className={`relative flex-1 min-h-[56px] flex flex-col items-center justify-center gap-0.5 rounded-2xl cursor-pointer ${on ? 'text-indigo-700' : 'text-slate-500'}`}>
              <span className={`relative w-14 h-7 rounded-full flex items-center justify-center ${on ? 'bg-indigo-100' : ''}`}>
                <Icon className="w-5 h-5" aria-hidden="true" />
                {n > 0 && (
                  <b data-badge={t.id} aria-label={`${n} need you`} className="absolute -top-1 left-1/2 ml-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-extrabold flex items-center justify-center ring-2 ring-white">{n > 99 ? '99+' : n}</b>
                )}
              </span>
              <span className={`text-[11px] leading-none ${on ? 'font-extrabold' : 'font-semibold'}`}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
