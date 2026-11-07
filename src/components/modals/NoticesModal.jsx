import React, { useState, useEffect } from 'react';
import { 
  Bell, 
  Search, 
  X, 
  CheckCircle2, 
  Tag, 
  Building2, 
  Calendar, 
  AlertCircle, 
  Check, 
  Filter,
  Megaphone,
  UserCheck,
  Sparkles
} from 'lucide-react';
import { saveLocal, getAllLocal, queueOfflineAction } from '../../utils/db';

// No hardcoded demo notices: the board renders only real, server-published
// circulars (data/notices.json — survives restarts). Empty board = honest
// "no notices published yet" state.

const CATEGORIES = ['All Notices', 'Academic', 'Hostel Ops', 'Examinations', 'Events'];

export default function NoticesModal({ isOpen, onClose, onReadReceiptChanged }) {
  const [notices, setNotices] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All Notices');
  const [readIds, setReadIds] = useState(new Set());

  // Pull live notices from the central server bus (push/SMS layer) and
  // merge them above the local history. Offline → server list is skipped
  // silently and the IndexedDB/local history still renders.
  useEffect(() => {
    const loadServerNotices = async () => {
      try {
        const res = await fetch('/api/notices', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const serverNotices = (Array.isArray(data?.notices) ? data.notices : []).map(n => {
          const d = new Date(n.createdAt);
          return {
            id: n.id,
            title: n.title,
            category: n.category || 'General',
            issuer: n.source || 'Admin Desk',
            target: n.target || 'All Students',
            priority: n.urgency || 'Normal',
            date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
            time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
            location: 'Campus-wide announcement',
            content: n.content,
            isRead: false
          };
        });
        if (serverNotices.length) {
          setNotices(prev => {
            const existing = new Set(prev.map(x => x.id));
            return [...serverNotices.filter(x => !existing.has(x.id)), ...prev];
          });
        }
      } catch (err) {
        console.warn('Central notices unavailable (offline mode):', err.message);
      }
    };
    if (isOpen) loadServerNotices();
  }, [isOpen]);

  // Load read statuses from IndexedDB on open
  useEffect(() => {
    const loadReadStatus = async () => {
      try {
        const savedNotices = await getAllLocal('notices');
        if (savedNotices && savedNotices.length > 0) {
          const reads = new Set();
          savedNotices.forEach(n => {
            if (n.isRead) reads.add(n.id);
          });
          setReadIds(reads);
        }
      } catch (err) {
        console.warn('Failed to load notice read statuses:', err);
      }
    };
    if (isOpen) {
      loadReadStatus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleReadStatus = async (noticeId) => {
    const nextReadState = !readIds.has(noticeId);
    const updatedReads = new Set(readIds);
    if (nextReadState) {
      updatedReads.add(noticeId);
    } else {
      updatedReads.delete(noticeId);
    }
    setReadIds(updatedReads);

    const targetNotice = notices.find(n => n.id === noticeId);
    if (targetNotice) {
      const noticeObj = {
        ...targetNotice,
        isRead: nextReadState,
        readAt: nextReadState ? new Date().toISOString() : null
      };

      try {
        await saveLocal('notices', noticeObj);
        await queueOfflineAction('ACKNOWLEDGE_NOTICE', { noticeId, isRead: nextReadState });
        if (onReadReceiptChanged) {
          onReadReceiptChanged();
        }
      } catch (err) {
        console.warn('Failed to save notice receipt:', err);
      }
    }
  };

  const filteredNotices = notices.filter(item => {
    const matchesCategory = selectedCategory === 'All Notices' || item.category === selectedCategory;
    const q = (searchQuery || '').toLowerCase();
    const matchesSearch = !q ||
      (item.title || '').toLowerCase().includes(q) ||
      (item.issuer || '').toLowerCase().includes(q) ||
      (item.target || '').toLowerCase().includes(q) ||
      (item.content || '').toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  const unreadCount = notices.filter(n => !readIds.has(n.id)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-2xl w-full border border-slate-200/80 shadow-2xl overflow-hidden my-auto">
        
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-200/60 text-blue-600 flex items-center justify-center shadow-xs shrink-0">
              <Megaphone className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">
                  Targeted Campus Noticeboard
                </h3>
                {unreadCount > 0 && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold border border-amber-200">
                    {unreadCount} Unread
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Official Circulars • Department Notices • Hostel Announcements
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Controls Bar: Search & Category Chips */}
        <div className="p-4 bg-white border-b border-slate-100 space-y-3">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by keyword, department, issuer, or target group..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-emerald-600 font-sans"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Category Filter Chips */}
          <div className="flex items-center space-x-1.5 overflow-x-auto pb-0.5 scrollbar-none text-xs">
            {CATEGORIES.map((cat) => {
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-xl border text-xs transition-all whitespace-nowrap cursor-pointer ${
                    isSelected 
                      ? 'bg-emerald-600 text-white border-emerald-600 font-semibold shadow-xs'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        {/* Notice List Container */}
        <div className="p-4 sm:p-5 space-y-3.5 max-h-[420px] overflow-y-auto bg-slate-50/50">
          {filteredNotices.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs space-y-2">
              <Megaphone className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="font-semibold text-slate-700">No notices match your filter or search.</p>
              <p className="text-[11px] text-slate-400">Try clearing the search query or selecting 'All Notices'.</p>
            </div>
          ) : (
            filteredNotices.map((notice) => {
              const isRead = readIds.has(notice.id);
              const isHighPriority = notice.priority === 'High';

              return (
                <div 
                  key={notice.id}
                  className={`bg-white border rounded-xl p-4 space-y-3 transition-all shadow-xs ${
                    isRead 
                      ? 'border-slate-200 opacity-90' 
                      : 'border-emerald-300 ring-1 ring-emerald-500/20 shadow-sm'
                  }`}
                >
                  {/* Top Metadata Row: ID, Badges, Priority */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                    <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold border border-slate-200">
                        {notice.category}
                      </span>
                      {isHighPriority && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-bold border border-rose-200 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-rose-600" />
                          High Priority
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      <span>{notice.date}</span>
                    </div>
                  </div>

                  {/* Notice Title & Target Audience Badge */}
                  <div>
                    <h4 className="text-sm sm:text-base font-bold text-slate-900 leading-snug">
                      {notice.title}
                    </h4>
                    
                    <div className="flex items-center space-x-2 mt-1.5 flex-wrap gap-y-1">
                      {!/^(all|campus|everyone)/i.test(String(notice.target || '')) && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-bold border border-emerald-200 flex items-center gap-1">
                        <UserCheck className="w-3 h-3 text-emerald-600" />
                        For: {notice.target}
                      </span>)}
                      <span className="text-[11px] text-slate-500 font-sans">
                        • Issued by: <strong className="text-slate-700">{notice.issuer}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Body Content */}
                  <p className="text-xs text-slate-600 leading-relaxed font-sans bg-slate-50 p-3 rounded-lg border border-slate-200/80">
                    {notice.content}
                  </p>

                  {/* Footer Bar: Location & Interactive Read Receipt Button */}
                  <div className="flex items-center justify-between pt-1 text-xs">
                    <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1 truncate max-w-[55%]">
                      <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{notice.location}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleReadStatus(notice.id)}
                      className={`px-3 py-1.5 rounded-lg font-semibold text-xs transition-all cursor-pointer flex items-center space-x-1.5 ${
                        isRead
                          ? 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                      }`}
                    >
                      {isRead ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>✓ Read</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Mark as Read / Acknowledge</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs">
          <span className="text-[11px] text-slate-500 font-mono">
            Showing {filteredNotices.length} official notice(s)
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold transition-colors cursor-pointer"
          >
            Close Noticeboard
          </button>
        </div>
      </div>
    </div>
  );
}
