import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Search,
  User,
  MapPin,
  Clock,
  Calendar,
  Phone,
  Send,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { saveLocal, queueOfflineAction } from '../../utils/db';
import { getAccessToken } from '../../utils/authClient';

// Warden creates a gate pass ON BEHALF of a student whose phone is only a
// keypad handset (no app). The student search, categories and state machine
// mirror the student-side RequestGatePassModal exactly — the pass enters the
// same PENDING queue the warden already approves from.
export default function WardenCreatePassModal({ isOpen, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [searchError, setSearchError] = useState(null);

  const [formData, setFormData] = useState({
    destination: '',
    reason: '',
    passType: 'Day Pass',
    returnDate: new Date().toISOString().slice(0, 10),
    returnTime: '17:30'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [timeError, setTimeError] = useState(null);
  const [created, setCreated] = useState(null); // created pass object -> success view
  const debounceRef = useRef(null);

  const isHomeLeave = formData.passType === 'Home Leave';
  const isMedical = formData.passType === 'Medical Outing';

  // Live directory search (debounced, min 2 chars)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2 || selectedStudent) {
      setResults([]);
      setSearchError(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const tok = getAccessToken();
        const r = await fetch(`/api/students/search?q=${encodeURIComponent(query.trim())}`,
          tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
        const j = await r.json();
        if (r.ok && j?.success) {
          setResults(j.results || []);
          if ((j.results || []).length === 0) setSearchError('No student matched that name or roll number.');
        } else {
          setSearchError(j?.error || 'Search failed — check your connection.');
          setResults([]);
        }
      } catch (e) {
        setSearchError('Search needs connectivity to the campus server.');
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [query, selectedStudent]);

  if (!isOpen) return null;

  const handleSelectStudent = (student) => {
    setSelectedStudent({
      name: student.full_name,
      rollNo: student.roll_number,
      hostel: student.hostel_block,
      room: student.room_number,
      phone: student.phone_number
    });
    setResults([]);
    setQuery('');
    setCreated(null);
    setTimeError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedStudent) return;
    setIsSubmitting(true);
    setTimeError(null);

    try {
      const passId = `GP-${Math.floor(100000 + Math.random() * 900000)}`;

      // Same date math as the student modal: Day Pass / Medical Outing are
      // SAME-DAY (chosen time applied to today); Home Leave carries a real
      // return DATE — warden discretion governs the length.
      const [hours, minutes] = formData.returnTime.split(':');
      const validAsOf = isHomeLeave
        ? new Date(`${formData.returnDate}T${formData.returnTime}:00`)
        : new Date(new Date().setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0));
      const validUntil = validAsOf.toISOString();

      if (validAsOf.getTime() <= Date.now()) {
        setTimeError('Expected return must be later than the current time.');
        setIsSubmitting(false);
        return;
      }

      const passData = {
        id: passId,
        passId,
        studentId: selectedStudent.rollNo,
        name: selectedStudent.name,
        rollNo: selectedStudent.rollNo,
        hostelBlock: selectedStudent.hostel || null,
        room: selectedStudent.room || null,
        destination: formData.destination,
        reason: formData.reason,
        passType: formData.passType,
        priority: isMedical, // medical outings ride the priority lane
        validUntil,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        createdAtMs: Date.now(),
        createdBy: 'WARDEN_ON_BEHALF' // provenance tag: warden desk, not the app
      };

      await saveLocal('gate_passes', passData);
      try {
        await fetch('/api/create-pass', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passData })
        });
      } catch (netErr) {
        console.warn('Backend sync failed, stored locally:', netErr);
      }
      await queueOfflineAction('REQUEST_GATE_PASS', passData);
      window.dispatchEvent(new CustomEvent('campus_gate_pass_updated', {
        detail: { pass: passData }
      }));

      setCreated(passData);
    } catch (err) {
      setTimeError('Could not create the pass: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetModal = () => {
    setSelectedStudent(null);
    setCreated(null);
    setQuery('');
    setResults([]);
    setSearchError(null);
    setFormData({
      destination: '',
      reason: '',
      passType: 'Day Pass',
      returnDate: new Date().toISOString().slice(0, 10),
      returnTime: '17:30'
    });
    setTimeError(null);
  };

  const handleClose = () => {
    resetModal();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-md w-full border border-slate-200/80 shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-slate-900 flex items-center justify-center text-white shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Create Pass on Behalf</h3>
              <p className="text-xs text-slate-500">For keypad-phone students without the app</p>
            </div>
          </div>
          <button type="button" onClick={handleClose}
            className="w-[44px] h-[44px] rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {created ? (
            /* ---------- SUCCESS VIEW ---------- */
            <div className="border-2 border-emerald-200 bg-emerald-50/60 rounded-xl p-6 text-center space-y-3">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
              <div className="text-sm font-extrabold font-mono tracking-wide text-emerald-800">
                PASS CREATED IN QUEUE
              </div>
              <div className="text-xl font-extrabold font-mono text-slate-900">{created.id}</div>
              <p className="text-xs text-slate-600 font-medium leading-relaxed">
                A PENDING pass for <b>{created.name}</b> ({created.rollNo}) is now in the
                authorization queue below. Approve it in 1-tap — the pass number you
                announce to the student over a call or the counter is the GP code they
                will cite at the gate.
              </p>
              <button onClick={() => { resetModal(); }}
                className="w-full py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer">
                Create Another Pass
              </button>
              <button onClick={handleClose}
                className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer">
                Done — Back to Queue
              </button>
            </div>
          ) : !selectedStudent ? (
            /* ---------- STEP 1: STUDENT SEARCH ---------- */
            <div className="space-y-3">
              <label className="block text-[11px] text-slate-500 font-mono uppercase tracking-wider font-semibold">
                Find the student
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name or roll number (e.g. Diya / 2201107101)"
                  autoFocus
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 min-h-[44px] py-2.5 text-xs text-slate-800 focus:outline-none focus:border-emerald-600"
                />
              </div>
              {searching && <p className="text-[11px] text-slate-500 px-1">Searching the student directory…</p>}
              {searchError && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-medium flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {searchError}
                </p>
              )}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {results.map((s) => (
                  <button key={s.roll_number} onClick={() => handleSelectStudent(s)}
                    className="w-full text-left bg-slate-50 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 rounded-xl px-3.5 py-2.5 transition-colors cursor-pointer">
                    <div className="text-xs font-bold text-slate-900">{s.full_name}</div>
                    <div className="text-[11px] font-mono text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{s.roll_number}</span>
                      {s.hostel_block && <span>• {s.hostel_block} {s.room_number || ''}</span>}
                      {s.department && <span>• {s.department}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* ---------- STEP 2: PASS FORM ---------- */
            <div className="space-y-3.5">
              {/* Selected Student Card */}
              <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3.5 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">{selectedStudent.name}</div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>{selectedStudent.rollNo}</span>
                    {selectedStudent.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{selectedStudent.phone}</span>}
                  </div>
                </div>
                <button onClick={() => setSelectedStudent(null)}
                  className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 cursor-pointer shrink-0 whitespace-nowrap">
                  Change
                </button>
              </div>

              {/* Category cards — same trio as the student app */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Day Pass', hint: 'Same-day' },
                  { label: 'Medical Outing', hint: 'Priority' },
                  { label: 'Home Leave', hint: 'Return date' }
                ].map((cat) => {
                  const active = formData.passType === cat.label;
                  return (
                    <button key={cat.label} type="button"
                      onClick={() => setFormData(prev => ({ ...prev, passType: cat.label }))}
                      className={`p-2.5 rounded-xl border-2 text-center transition-all cursor-pointer ${
                        active
                          ? cat.label === 'Medical Outing'
                            ? 'border-rose-500 bg-rose-50'
                            : 'border-emerald-600 bg-emerald-50'
                          : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                      }`}>
                      <div className={`text-[11px] font-bold leading-tight ${active ? (cat.label === 'Medical Outing' ? 'text-rose-800' : 'text-emerald-800') : 'text-slate-700'}`}>
                        {cat.label}
                      </div>
                      <div className="text-[9px] text-slate-500 mt-0.5">{cat.hint}</div>
                    </button>
                  );
                })}
              </div>

              {/* Destination */}
              <div>
                <label className="block text-[11px] text-slate-500 font-mono mb-1.5">Destination</label>
                <input
                  type="text"
                  value={formData.destination}
                  onChange={(e) => setFormData(prev => ({ ...prev, destination: e.target.value }))}
                  placeholder="e.g. Market Complex, Home, Hospital"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 min-h-[44px] py-2.5 text-xs text-slate-800 focus:outline-none focus:border-emerald-600"
                />
              </div>

              {/* Time / Date pickers — same-day lock for Day/Medical */}
              <div className="grid grid-cols-2 gap-2.5">
                {isHomeLeave && (
                  <div>
                    <label className="block text-[11px] text-slate-500 font-mono mb-1.5 flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Return date
                    </label>
                    <input type="date"
                      min={new Date().toISOString().slice(0, 10)}
                      value={formData.returnDate}
                      onChange={(e) => setFormData(prev => ({ ...prev, returnDate: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 min-h-[44px] py-2.5 text-xs text-slate-800 focus:outline-none focus:border-emerald-600" />
                  </div>
                )}
                <div className={isHomeLeave ? '' : 'col-span-2'}>
                  <label className="block text-[11px] text-slate-500 font-mono mb-1.5 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {isHomeLeave ? 'Return time' : 'Expected return (today)'}
                  </label>
                  <input type="time"
                    value={formData.returnTime}
                    onChange={(e) => setFormData(prev => ({ ...prev, returnTime: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 min-h-[44px] py-2.5 text-xs text-slate-800 focus:outline-none focus:border-emerald-600" />
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="block text-[11px] text-slate-500 font-mono mb-1.5">Reason</label>
                <textarea
                  value={formData.reason}
                  onChange={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
                  rows={2}
                  placeholder="Recorded on the student's behalf at the warden desk…"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 min-h-[44px] py-2.5 text-xs text-slate-800 focus:outline-none focus:border-emerald-600 resize-none" />
              </div>

              {timeError && (
                <div className="text-[11px] bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 font-medium flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {timeError}
                </div>
              )}

              <button type="button" onClick={handleSubmit}
                disabled={isSubmitting || !formData.destination.trim() || !formData.reason.trim()}
                className={`w-full py-2.5 rounded-lg text-white text-xs font-bold shadow-sm cursor-pointer flex items-center justify-center gap-1.5 ${
                  isSubmitting || !formData.destination.trim() || !formData.reason.trim()
                    ? 'bg-slate-300 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}>
                {isSubmitting ? 'Creating…' : <><Send className="w-3.5 h-3.5" /><span>Create Pass (PENDING)</span></>}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
