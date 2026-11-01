import React, { useState } from 'react';
import { 
  Utensils, 
  X, 
  Star, 
  CheckCircle2, 
  MessageSquare, 
  Tag,
  ArrowRight,
  Sparkles
} from 'lucide-react';
import { saveLocal, queueOfflineAction } from '../../utils/db';
import { getStoredProfile } from '../../utils/authClient';

// API origin comes from the environment (Vite VITE_API_BASE). Empty means
// same-origin, the same pattern the rest of the app's API calls use.
const API_BASE = import.meta.env.VITE_API_BASE || '';

const MEALS = [
  { id: 'Breakfast', label: 'Breakfast (07:30 - 09:30 AM)' },
  { id: 'Lunch', label: 'Lunch (12:30 - 02:30 PM)' },
  { id: 'Snacks', label: 'Evening Snacks (05:00 - 06:30 PM)' },
  { id: 'Dinner', label: 'Dinner (08:00 - 10:00 PM)' }
];

const TAGS = [
  'Food Quality',
  'Hygiene & Utensils',
  'Portion Quantity',
  'Serving Temperature',
  'Taste & Spices',
  'Freshness'
];

export default function MessFeedbackModal({ isOpen, onClose, onFeedbackSubmitted }) {
  // Day scholars attend only the Lunch slot (same eligibility rule as the
  // Meal RSVP) — they commute home for the other meals, so rating those
  // menus would fabricate mess-utilisation data. Filter the options and
  // mirror the RSVP copy in the header.
  const isDayScholar = (() => {
    try {
      const p = getStoredProfile();
      return String(p?.resident_type || p?.residentType || '').trim().toLowerCase() === 'dayscholar';
    } catch { return false; }
  })();
  const mealOptions = isDayScholar ? MEALS.filter(m => m.id === 'Lunch') : MEALS;
  const [meal, setMeal] = useState('Lunch');
  const [rating, setRating] = useState(4);
  const [hoverRating, setHoverRating] = useState(0);
  const [selectedTags, setSelectedTags] = useState(['Food Quality', 'Taste & Spices']);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const toggleTag = (tag) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter(t => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const feedbackText = comment || `${meal} - Rating ${rating}/5 Stars (${selectedTags.join(', ')})`;
      let aiTelemetry = null;

      try {
        const res = await fetch(`${API_BASE}/api/analyze-feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedbackText })
        });
        if (res.ok) {
          const data = await res.json();
          aiTelemetry = data.analysis;
        }
      } catch (err) {
        console.warn('AI telemetry endpoint offline fallback');
      }

      const feedbackId = `FBK-${Math.floor(1000 + Math.random() * 9000)}`;
      const feedbackObj = {
        id: feedbackId,
        type: 'mess',
        title: `${meal} Feedback: ${rating} Stars (${selectedTags.join(', ')})`,
        category: 'Mess Hall B',
        location: 'Central Dining Complex',
        meal,
        rating,
        tags: selectedTags,
        comment: comment || 'Rated via 1-Tap Quick Action Feed',
        status: 'RESOLVED',
        statusLabel: aiTelemetry
          ? `AI Score: Hygiene ${aiTelemetry.hygieneScore}% • Quality ${aiTelemetry.foodQualityScore}% (${aiTelemetry.sentiment})`
          : 'Logged to Mess Warden & Caterer',
        aiTelemetry,
        sla: 'Instant Telemetry',
        createdAt: new Date().toISOString(),
        time: 'Just now'
      };

      feedbackObj.owner = (getStoredProfile() || {}).rollNumber || null;
      await saveLocal('tickets', feedbackObj);
      await queueOfflineAction('MESS_FEEDBACK', feedbackObj);

      if (onFeedbackSubmitted) {
        onFeedbackSubmitted(feedbackObj);
      }

      onClose();
      setComment('');
      setSelectedTags(['Food Quality', 'Taste & Spices']);
    } catch (err) {
      console.error('Failed to submit mess feedback:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-lg w-full border border-slate-200/80 shadow-2xl overflow-hidden my-auto">
        
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200/60 text-amber-600 flex items-center justify-center shadow-xs shrink-0">
              <Utensils className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {isDayScholar ? 'Mess & Dining Feedback (Day Scholar)' : 'Mess & Dining Feedback'}
              </h3>
              <p className="text-xs text-slate-500">
                Direct feedback routed to Mess Committee & Warden
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

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          
          {/* Meal Selection */}
          <div>
            <label className="block text-slate-700 font-semibold mb-1">Select Meal</label>
            <select
              value={meal}
              onChange={(e) => setMeal(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-emerald-500 cursor-pointer font-medium"
            >
              {mealOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* 1-5 Star Interactive Rating */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center">
            <label className="block text-slate-600 font-medium text-xs mb-2">
              Overall Quality Rating
            </label>
            <div className="flex items-center justify-center space-x-2">
              {[1, 2, 3, 4, 5].map((star) => {
                const filled = (hoverRating || rating) >= star;
                return (
                  <button
                    key={star}
                    type="button"
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    onClick={() => setRating(star)}
                    className="p-1.5 transition-transform hover:scale-125 cursor-pointer"
                  >
                    <Star 
                      className={`w-7 h-7 transition-colors ${
                        filled 
                          ? 'text-amber-500 fill-amber-400 drop-shadow-sm' 
                          : 'text-slate-300'
                      }`} 
                    />
                  </button>
                );
              })}
            </div>
            <div className="text-xs font-mono text-emerald-700 font-bold mt-2">
              {rating === 5 && 'Outstanding & Delicious 🌟'}
              {rating === 4 && 'Good & Satisfactory 👍'}
              {rating === 3 && 'Average / Acceptable 😐'}
              {rating === 2 && 'Below Standard ⚠️'}
              {rating === 1 && 'Unsatisfactory / Immediate Inspection Needed 🚨'}
            </div>
          </div>

          {/* Quick Tags Selection */}
          <div>
            <label className="block text-slate-700 font-semibold mb-1.5">Feedback Tags</label>
            <div className="flex flex-wrap gap-2">
              {TAGS.map((tag) => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`px-3 py-1.5 rounded-xl border text-xs transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-800 font-semibold shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Additional Comment */}
          <div>
            <label className="block text-slate-700 font-semibold mb-1">Specific Remarks / Menu Item (Optional)</label>
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="e.g. Dal tadka was fresh, chapati soft, rice warm..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-200">
            <button 
              type="button" 
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium"
            >
              Cancel
            </button>
            <button 
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm"
            >
              {isSubmitting ? (
                <span>Submitting...</span>
              ) : (
                <>
                  <span>Submit Feedback</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
