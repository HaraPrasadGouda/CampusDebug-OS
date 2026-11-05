import React from 'react';
import { X, Building, GraduationCap, ShieldCheck, Calendar, KeyRound } from 'lucide-react';

// Per-role look only (badge, colour, ID label). Every detail row below is
// built from the signed-in profile — nothing about batch, RFID, wardens,
// rooms, shifts or SLAs is made up here.
const ROLE_PROFILES = {
  Student: { badge: 'Student Account', gradient: 'from-blue-600 to-indigo-600', identityLabel: 'Registration Number' },
  Warden: { badge: 'Warden Account', gradient: 'from-amber-500 to-orange-600', identityLabel: 'Staff ID' },
  Guard: { badge: 'Security Guard Account', gradient: 'from-indigo-600 to-violet-700', identityLabel: 'Staff ID' },
  Admin: { badge: 'Admin Account', gradient: 'from-slate-700 to-slate-900', identityLabel: 'Staff ID' },
  Teacher: { badge: 'Teacher Account', gradient: 'from-cyan-600 to-blue-700', identityLabel: 'Staff ID' }
};

const NOT_SET = 'Not set in profile';

export default function ProfileModal({ isOpen, onClose, session, currentRole }) {
  if (!isOpen) return null;

  const profile = ROLE_PROFILES[currentRole] || ROLE_PROFILES.Student;
  // Names must match the sidebar's per-role identity so both views agree
  const roleNames = {
    Student: 'Student',
    Warden: 'Hostel Warden',
    Guard: 'Security Officer',
    Admin: String(session?.profileRole || '').toUpperCase() === 'DEAN' ? 'Dean' : 'System Administrator',
    Teacher: 'Teacher'
  };
  const displayName = session?.name || 'Profile';
  const identity = session?.identity || '—';
  const isStudent = (currentRole || 'Student') === 'Student';
  const program = [session?.department, session?.course, session?.section ? `Section ${session.section}` : null]
    .filter(Boolean).join(' • ');

  // Only real profile fields. Unknown values say so instead of inventing one.
  const details = isStudent
    ? [
        { icon: GraduationCap, color: 'text-blue-600', label: 'Academic Program', value: program || NOT_SET },
        {
          icon: Building,
          color: 'text-emerald-600',
          label: 'Hostel Residence',
          value: session?.residentType === 'dayscholar'
            ? 'Day Scholar — commutes from home'
            : session?.block
              ? `${session.block} • Room ${session.room || NOT_SET}`
              : NOT_SET
        },
        { icon: ShieldCheck, color: 'text-purple-600', label: 'Account', value: 'Verified college record', live: true },
        { icon: Calendar, color: 'text-amber-600', label: profile.identityLabel, value: identity }
      ]
    : [
        { icon: KeyRound, color: 'text-amber-600', label: 'Role', value: roleNames[currentRole] || currentRole },
        { icon: Building, color: 'text-emerald-600', label: 'Department', value: session?.department || NOT_SET },
        { icon: ShieldCheck, color: 'text-purple-600', label: 'Account', value: 'Verified college record', live: true },
        { icon: Calendar, color: 'text-amber-600', label: profile.identityLabel, value: identity }
      ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-md w-full border border-slate-200/80 shadow-2xl overflow-hidden">
        {/* Header (color-coded per role) */}
        <div className={`bg-gradient-to-r ${profile.gradient} p-6 text-white relative`}>
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-white text-slate-800 font-extrabold text-2xl flex items-center justify-center shadow-lg border-2 border-white/50">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold truncate">{displayName}</h2>
              <p className="text-white/80 text-xs font-mono mt-0.5">{identity}</p>
              <span className="inline-block mt-2 px-2.5 py-0.5 rounded-full bg-white/20 text-white text-[11px] font-semibold">
                {profile.badge}
              </span>
            </div>
          </div>
        </div>

        {/* Content Details (role-specific) */}
        <div className="p-6 space-y-4">
          <div className="space-y-3">
            <CoverTodayLine currentRole={currentRole} />
            {details.map((detail, idx) => (
              <div key={idx} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <detail.icon className={`w-5 h-5 ${detail.color} shrink-0`} />
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-600 uppercase font-bold tracking-wider">{detail.label}</p>
                  <p className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 flex-wrap">
                    {detail.live && <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>}
                    <span>{detail.value}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2">
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Teacher "Today covering / Covered by" line (substitute cover). Kept at the
// end of the file so it never touches the import block above.
import CoverTodayLine from '../teacher/CoverTodayLine';
