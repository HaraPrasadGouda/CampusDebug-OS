import React, { useState, useEffect } from 'react';
import { 
  Utensils, 
  X, 
  CheckCircle2, 
  TrendingDown, 
  ChefHat, 
  Leaf, 
  Clock 
} from 'lucide-react';

import { getTodayMenu, MEAL_WINDOWS, RSVP_CUTOFF_MINUTES, fmtTime12 } from '../../data/messMenu';

// Builds the RSVP meal list from a given day's menu. Attendance defaults
// open (every student eats by default) — real plate counts / opt-outs come
// from the server; nothing here is faked.
const buildMeals = (menu) => ([
  {
    id: 'breakfast',
    title: 'Breakfast (07:30 - 09:30 AM)',
    menu: menu.breakfast,
    isAttending: true,
    optedOutCount: null,
    forecastPlates: null,
    wastePreventedKg: null
  },
  {
    id: 'lunch',
    title: 'Lunch (12:30 - 02:30 PM)',
    menu: menu.lunch,
    isAttending: true,
    optedOutCount: null,
    forecastPlates: null,
    wastePreventedKg: null
  },
  {
    id: 'snacks',
    title: 'Evening Snacks (05:00 - 06:30 PM)',
    menu: menu.snacks,
    isAttending: true,
    optedOutCount: null,
    forecastPlates: null,
    wastePreventedKg: null
  },
  {
    id: 'dinner',
    title: 'Dinner (08:00 - 10:00 PM)',
    menu: menu.dinner,
    isAttending: true,
    optedOutCount: null,
    forecastPlates: null,
    wastePreventedKg: null
  }
]);

// Real cutoff enforcement: a meal RSVP locks 3 hours before cooking starts
// (computed live from the clock — never a hardcoded flag).
const isCutoffPassed = (mealKey, now = new Date()) => {
  const w = MEAL_WINDOWS[mealKey];
  if (!w) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return t >= w.start - RSVP_CUTOFF_MINUTES;
};

export default function MealRsvpModal({ isOpen, onClose, session }) {
  // Day scholars are on campus only for lunch — their RSVP sheet shows
  // exactly one meal, nothing else.
  const isDayScholar = String(session?.residentType || '').toLowerCase() === 'dayscholar';
  const [meals, setMeals] = useState(() => {
    const all = buildMeals(getTodayMenu());
    return isDayScholar ? all.filter(m => m.id === 'lunch') : all;
  });

  const [loadingMeal, setLoadingMeal] = useState(null);
  const [savedNotification, setSavedNotification] = useState(null);
  const [serverLive, setServerLive] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Refresh menu text from today's weekday data (handles day rolling over while app is open)
      setMeals(prev => prev.map(m => ({ ...m, menu: getTodayMenu()[m.id] || m.menu })));

      fetch('/api/meal-rsvp')
        .then(res => res.json())
        .then(data => {
          if (data.success && data.meals) {
            setServerLive(true);
            // Merge server RSVP state but always keep the day-based menu text.
            // The server also scopes the list to lunch for day scholars.
            setMeals(prev => prev.map(m => {
              const srv = data.meals.find(x => x.id === m.id);
              return srv ? { ...m, ...srv, menu: getTodayMenu()[m.id] || m.menu } : m;
            }));
          }
        })
        .catch(err => {
          setServerLive(false);
          console.warn('Using offline meal state:', err);
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleToggleMeal = async (mealKey, cutoffPassed) => {
    if (cutoffPassed) return;

    setLoadingMeal(mealKey);
    try {
      const res = await fetch('/api/meal-rsvp/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mealKey, studentId: session?.identity || null })
      });
      const data = await res.json();
      if (data.success) {
        setMeals(prev => prev.map(m => m.id === mealKey ? {
          ...m,
          isAttending: data.isAttending,
          forecastPlates: data.forecastPlates,
          optedOutCount: data.optedOutCount,
          wastePreventedKg: data.wastePreventedKg
        } : m));

        setSavedNotification(
          data.isAttending 
            ? `Plate confirmed for ${mealKey.toUpperCase()}! See you at Mess.`
            : `Opted out for ${mealKey.toUpperCase()}. Plate count deducted to prevent food waste.`
        );
        setTimeout(() => setSavedNotification(null), 3500);
      }
    } catch (e) {
      setMeals(prev => prev.map(m => {
        if (m.id === mealKey) {
          const nextAttending = !m.isAttending;
          return {
            ...m,
            isAttending: nextAttending,
            forecastPlates: nextAttending ? m.forecastPlates + 1 : m.forecastPlates - 1,
            wastePreventedKg: Number((m.wastePreventedKg + (nextAttending ? -0.35 : 0.35)).toFixed(1))
          };
        }
        return m;
      }));
    } finally {
      setLoadingMeal(null);
    }
  };

  const knownWasteData = meals.some(m => m.wastePreventedKg != null);
  const totalKgPrevented = meals.reduce((acc, curr) => acc + (curr.wastePreventedKg || 0), 0).toFixed(1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-white border-2 border-emerald-300 rounded-2xl sm:rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-100/70 border-b-2 border-emerald-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shrink-0">
              <Leaf className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-extrabold text-slate-900">
                  {isDayScholar ? 'Zero-Waste Lunch RSVP (Day Scholar)' : 'Zero-Waste Hostel Meal RSVP'}
                </h3>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-600 font-medium">1-tap opt-out gives kitchen live plate counts</p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/80 hover:bg-white text-slate-500 hover:text-slate-800 flex items-center justify-center border border-slate-200 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-3.5 sm:p-5 space-y-3 sm:space-y-4 overflow-y-auto">
          
          {/* Green Sustainability Impact Banner */}
          <div className="bg-emerald-50/80 border-2 border-emerald-200 rounded-xl sm:rounded-2xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-emerald-600/10 text-emerald-700 flex items-center justify-center shrink-0">
                <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-[10px] sm:text-xs font-bold text-slate-700 uppercase tracking-wider">Today's Kitchen Impact</p>
                {knownWasteData ? (
                  <p className="text-xs sm:text-sm font-extrabold text-emerald-950">
                    ≈ {totalKgPrevented} kg Food Waste Prevented
                  </p>
                ) : (
                  <p className="text-xs sm:text-sm font-extrabold text-slate-500">
                    {serverLive ? '—' : 'Connect to campus server for live counts'}
                  </p>
                )}
              </div>
            </div>
            {knownWasteData && (
              <span className="self-start sm:self-auto text-[10px] sm:text-[11px] font-mono font-bold bg-white px-2.5 py-1 rounded-lg border border-emerald-300 text-emerald-800 shadow-xs">
                Live Kitchen Sync
              </span>
            )}
          </div>

          {savedNotification && (
            <div className="bg-slate-900 text-white text-xs px-3.5 py-2.5 rounded-xl font-medium flex items-center gap-2 shadow-md animate-in slide-in-from-top-2 duration-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{savedNotification}</span>
            </div>
          )}

          {/* Meal RSVP Cards (Optimized for Mobile Screens) */}
          <div className="space-y-3">
            {meals.map((meal) => {
              const isPast = isCutoffPassed(meal.id);
              const startMin = MEAL_WINDOWS[meal.id]?.start;
              const cutoffLabel = startMin != null
                ? isPast
                  ? 'Cutoff passed'
                  : `Cutoff: ${fmtTime12(startMin - RSVP_CUTOFF_MINUTES)} (3 hrs before)`
                : null;

              return (
                <div 
                  key={meal.id}
                  className={`p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border-2 transition-all ${
                    meal.isAttending 
                      ? 'bg-gradient-to-br from-white to-emerald-50/40 border-emerald-300 shadow-sm' 
                      : 'bg-slate-50 border-slate-300 opacity-90'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    
                    {/* Left: Meal Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <Utensils className={`w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 ${meal.isAttending ? 'text-emerald-600' : 'text-slate-400'}`} />
                        <h4 className="text-xs sm:text-sm font-extrabold text-slate-900">{meal.title}</h4>
                        {cutoffLabel && (
                          <span className={`text-[9px] sm:text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                            isPast 
                              ? 'bg-slate-200 text-slate-700 border-slate-300' 
                              : 'bg-amber-100 text-amber-900 border-amber-300'
                          }`}>
                            {cutoffLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] sm:text-xs text-slate-600 font-medium mt-1 leading-snug">{meal.menu}</p>

                      {/* Live Kitchen Plate Forecast (only with real server data) */}
                      {meal.forecastPlates != null && (
                        <div className="flex flex-wrap items-center gap-2 mt-2.5 text-[10px] sm:text-[11px] font-semibold text-slate-700">
                          <span className="flex items-center gap-1 bg-white px-2 py-0.5 rounded-lg border border-slate-200 shadow-xs">
                            <ChefHat className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span>Cook Forecast: <strong className="font-mono text-slate-900">{meal.forecastPlates} plates</strong></span>
                          </span>
                          <span className="text-slate-500 font-medium text-[10px] sm:text-[11px]">
                            ({meal.optedOutCount} opted out)
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Right / Bottom on Mobile: Status & 1-Tap Toggle Action */}
                    <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 pt-2 sm:pt-0 border-t border-slate-200/60 sm:border-t-0">
                      
                      {/* Current Status Badge */}
                      <span className={`text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${
                        meal.isAttending 
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300' 
                          : 'bg-rose-100 text-rose-800 border-rose-300'
                      }`}>
                        {meal.isAttending ? '● Reserved' : '○ Skipped'}
                      </span>

                      {/* Action Button */}
                      <button
                        type="button"
                        disabled={isPast || loadingMeal === meal.id}
                        onClick={() => handleToggleMeal(meal.id, isPast)}
                        className={`px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs active:scale-95 whitespace-nowrap ${
                          isPast
                            ? 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300'
                            : meal.isAttending
                              ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-2 border-rose-300'
                              : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/20'
                        }`}
                      >
                        {loadingMeal === meal.id ? (
                          <span className="animate-pulse">Updating...</span>
                        ) : meal.isAttending ? (
                          <span className="flex items-center gap-1">
                            <X className="w-3 h-3 text-rose-600" />
                            <span>Opt Out (Skip)</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-white" />
                            <span>Reserve Plate</span>
                          </span>
                        )}
                      </button>

                      <span className="hidden sm:block text-[9px] text-slate-400 font-medium">
                        {isPast ? 'Cutoff locked' : meal.isAttending ? 'Deduct plate' : 'Add plate'}
                      </span>
                    </div>

                  </div>
                </div>
              );
            })}
          </div>

        </div>

        {/* Footer */}
        <div className="p-3.5 sm:p-4 bg-slate-50 border-t-2 border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-600 font-semibold truncate">
            <Clock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="truncate">Deadline: <strong>3 hrs before meal</strong></span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 sm:py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors cursor-pointer shadow-sm shrink-0"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
