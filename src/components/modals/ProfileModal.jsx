import React from 'react';
import { X, Building, GraduationCap, ShieldCheck, Calendar, MapPin, KeyRound, ClipboardList } from 'lucide-react';

// Per-role profile data — each dashboard shows its own account details
const ROLE_PROFILES = {
  Student: {
    badge: 'Student Account',
    gradient: 'from-blue-600 to-indigo-600',
    identityLabel: 'Registration Number',
    fallbackIdentity: '—',
    details: [
      {
        icon: GraduationCap,
        color: 'text-blue-600',
        label: 'Academic Program',
        value: 'Per the college directory record'
      },
      {
        icon: Building,
        color: 'text-emerald-600',
        label: 'Hostel Residence',
        value: 'Assigned by the hostel office'
      },
      {
        icon: ShieldCheck,
        color: 'text-purple-600',
        label: 'Biometric & RFID Status',
        value: 'Active & Synced to Main Gate',
        live: true
      },
      {
        icon: Calendar,
        color: 'text-amber-600',
        label: 'Academic Session',
        value: '2022 - 2026 Batch • Semester 5'
      }
    ]
  },
  Warden: {
    badge: 'Warden Account',
    gradient: 'from-amber-500 to-orange-600',
    identityLabel: 'Warden ID',
    fallbackIdentity: 'WDN-001',
    details: [
      {
        icon: KeyRound,
        color: 'text-amber-600',
        label: 'Staff Designation',
        value: 'Dr. S. K. Mohanty (Chief Warden) • Hostel Authority'
      },
      {
        icon: Building,
        color: 'text-emerald-600',
        label: 'Duty Jurisdiction',
        value: 'Boys Hostel Block B • 84 Students / 28 Rooms'
      },
      {
        icon: ClipboardList,
        color: 'text-blue-600',
        label: 'Approval Authority',
        value: 'Gate Pass Sign-off • SLA Escalation to Dean • Cluster Review'
      },
      {
        icon: Calendar,
        color: 'text-purple-600',
        label: 'On-Duty Schedule',
        value: '24x7 Rotation • Pass Approval SLA: 15 mins'
      }
    ]
  },
  Guard: {
    badge: 'Security Guard Account',
    gradient: 'from-indigo-600 to-violet-700',
    identityLabel: 'Staff ID',
    fallbackIdentity: 'GATE-01-MAIN',
    details: [
      {
        icon: KeyRound,
        color: 'text-indigo-600',
        label: 'Staff Designation',
        value: 'Security Personnel • Main Exit Gate Post'
      },
      {
        icon: MapPin,
        color: 'text-emerald-600',
        label: 'Assigned Checkpoint',
        value: 'Main Exit Gate (Gate 01) • Entry/Exit QR Scanner'
      },
      {
        icon: ShieldCheck,
        color: 'text-purple-600',
        label: 'Scanner Device Status',
        value: 'Paired • Offline Signed-QR Verification Enabled',
        live: true
      },
      {
        icon: Calendar,
        color: 'text-amber-600',
        label: 'Current Shift',
        value: 'Day Shift • 08:00 AM - 08:00 PM'
      }
    ]
  },
  Admin: {
    badge: 'Admin Account',
    gradient: 'from-slate-700 to-slate-900',
    identityLabel: 'Admin ID',
    fallbackIdentity: 'ADM-XYZ-01',
    details: [
      {
        icon: KeyRound,
        color: 'text-slate-700',
        label: 'Staff Designation',
        value: 'Dean of Student Affairs • Campus Operations Admin'
      },
      {
        icon: ClipboardList,
        color: 'text-blue-600',
        label: 'Console Access',
        value: 'Full Analytics • Complaint Clustering • Pass Audit Trail'
      },
      {
        icon: Building,
        color: 'text-emerald-600',
        label: 'Supervisory Scope',
        value: 'All Hostel Blocks • All SLA Benchmarks • Data Exports'
      },
      {
        icon: Calendar,
        color: 'text-amber-600',
        label: 'Academic Session',
        value: '2022 - 2026 Batch • Semester 5 Oversight'
      }
    ]
  }
};

export default function ProfileModal({ isOpen, onClose, session, currentRole }) {
  if (!isOpen) return null;

  const profile = ROLE_PROFILES[currentRole] || ROLE_PROFILES.Student;
  // Names must match the sidebar's per-role identity so both views agree
  const roleNames = {
    Student: 'Student',
    Warden: 'Hostel Warden',
    Guard: 'Security Officer',
    Admin: 'System Administrator'
  };
  const displayName = session?.name || 'Profile';
  const identity = session?.identity || profile.fallbackIdentity;

  // Details render REAL session values when available (same data the
  // sidebar/sub-line uses); the static skeleton is only a last-resort
  // fallback and never invents a specific student's records.
  const details = session || profile
    ? [
        {
          icon: GraduationCap,
          color: 'text-blue-600',
          label: 'Academic Program',
          value: session?.department
            ? `${session.department} Department • Logged-in Profile`
            : 'Per the college directory record'
        },
        {
          icon: Building,
          color: 'text-emerald-600',
          label: 'Hostel Residence',
          value: session?.residentType === 'dayscholar'
            ? 'Day Scholar — commutes from home, no hostel residence'
            : session?.block
              ? `${session.block}${session.room ? ` • Room ${session.room}` : ''}`
              : 'Assigned by the hostel office'
        },
        {
          icon: ShieldCheck,
          color: 'text-purple-600',
          label: 'Account & Gate Authority',
          value: 'Verified college record • HMAC-signed gate passes',
          live: true
        },
        {
          icon: Calendar,
          color: 'text-amber-600',
          label: 'Session Status',
          value: `Authenticated session • ${identity}`
        }
      ]
    : profile.details;

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
