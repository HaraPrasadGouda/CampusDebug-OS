// ----------------------------------------------------
// Weekly Mess Menu — single source of truth
// Keyed by weekday (lowercase). Used by StudentDashboard
// (Today's Mess Menu card) and MealRsvpModal (RSVP modal).
// ----------------------------------------------------
export const WEEKLY_MESS_MENU = {
  monday: {
    breakfast: 'Poha, Boiled Egg, Banana, Tea/Milk',
    lunch: 'Rice, Dal, Aloo Gobi, Salad, Papad',
    snacks: 'Tea + Biscuits',
    dinner: 'Roti, Jeera Rice, Dal Tadka, Chicken Curry / Paneer Curry, Salad'
  },
  tuesday: {
    breakfast: 'Aloo Paratha, Curd, Pickle, Tea/Milk',
    lunch: 'Rice, Dalma, Bhaja, Mixed Veg Curry, Salad',
    snacks: 'Samosa + Tea',
    dinner: 'Roti, Rice, Dal, Egg Curry / Paneer Masala, Cabbage Fry'
  },
  wednesday: {
    breakfast: 'Idli, Sambar, Coconut Chutney, Banana, Tea',
    lunch: 'Rice, Dal, Chicken Curry / Soyabean Curry, Aloo Fry, Salad',
    snacks: 'Bread Pakora + Tea',
    dinner: 'Roti, Veg Pulao, Dal Fry, Kadai Paneer, Raita'
  },
  thursday: {
    breakfast: 'Upma, Boiled Egg, Chutney, Tea/Milk',
    lunch: 'Rice, Dal, Fish Curry / Chana Masala, Potato Fry, Salad',
    snacks: 'Sprouts Chaat + Tea',
    dinner: 'Roti, Rice, Dal, Mixed Veg Curry, Egg Bhurji / Paneer Bhurji'
  },
  friday: {
    breakfast: 'Poori, Aloo Curry, Banana, Tea',
    lunch: 'Rice, Dal, Rajma, Cabbage & Peas Curry, Salad, Papad',
    snacks: 'Pakora + Tea',
    dinner: 'Roti, Rice, Dal Makhani, Chicken Curry / Paneer Butter Masala, Salad'
  },
  saturday: {
    breakfast: 'Masala Dosa, Sambar, Chutney, Tea/Milk',
    lunch: 'Rice, Dalma, Paneer Curry, Bhaja, Salad',
    snacks: 'Veg Sandwich + Tea',
    dinner: 'Veg/Chicken Biryani, Raita, Salad, Gulab Jamun'
  },
  sunday: {
    breakfast: 'Aloo/Puri Sabzi, Boiled Egg, Banana, Tea',
    lunch: 'Rice, Dal, Chicken/Fish Curry / Paneer Curry, Mixed Veg, Salad, Sweet',
    snacks: 'Chowmein / Veg Cutlet + Cold Drink',
    dinner: 'Roti, Rice, Dal, Aloo Dum, Egg Curry / Chole, Kheer'
  }
};

// Returns the lowercase weekday key mapped to today, e.g. 'monday'
export const getTodayMenuKey = () => {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[new Date().getDay()];
};

// Returns today's full menu object { breakfast, lunch, snacks, dinner }
export const getTodayMenu = () => WEEKLY_MESS_MENU[getTodayMenuKey()];

// Returns today's day label, e.g. 'Wednesday'
export const getTodayDayLabel = () =>
  getTodayMenuKey().charAt(0).toUpperCase() + getTodayMenuKey().slice(1);

// Marks special-feast days (biryani / kheer / sweets in the menu)
export const isFeastDay = (menu) =>
  /biryani|gulab jamun|kheer|sweet/i.test(menu.dinner + ' ' + menu.lunch);

// ----------------------------------------------------
// Live meal-slot engine — the dashboard shows only the meal
// being SERVED RIGHT NOW (plus a slim "next" strip), with
// the complete list tucked behind "View Full Menu".
// ----------------------------------------------------
export const MEAL_WINDOWS = {
  breakfast: { start: 7 * 60 + 30, end: 9 * 60 + 30 },   // 07:30 - 09:30
  lunch:     { start: 12 * 60 + 30, end: 14 * 60 + 30 }, // 12:30 - 14:30
  snacks:    { start: 17 * 60, end: 18 * 60 + 30 },      // 17:00 - 18:30
  dinner:    { start: 20 * 60, end: 22 * 60 }            // 20:00 - 22:00
};
export const MEAL_ORDER = ['breakfast', 'lunch', 'snacks', 'dinner'];

// RSVP locks 3 hours before a meal's cooking starts (matches the RSVP modal).
export const RSVP_CUTOFF_MINUTES = 180;

export const fmtTime12 = (mins24) => {
  let h = Math.floor(mins24 / 60) % 24;
  const mm = mins24 % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(mm).padStart(2, '0')} ${ap}`;
};

export const fmtDuration = (mins) => {
  if (mins == null || mins <= 0) return 'any moment';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
};

/**
 * Where are we in today's dining cycle?
 * `order` lets callers scope the cycle to a subset of meals (e.g. day
 * scholars get ['lunch'] — breakfast/snacks/dinner never happen for them).
 * Returns:
 *   current         — meal key being served right now (or null)
 *   next            — next upcoming meal key (or null)
 *   isTomorrow      — true when "next" is tomorrow's first meal (after dinner)
 *   minsToNext      — minutes until the next meal starts
 *   nextStartLabel  — 12h start time of the next meal, e.g. "08:00 PM"
 *   rsvpCutoffLabel — 12h time when RSVP locks for the next meal (3h before)
 */
export function getMealStatus(now = new Date(), order = MEAL_ORDER) {
  const t = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < order.length; i++) {
    const key = order[i];
    const w = MEAL_WINDOWS[key];
    if (t < w.start) {
      const cutoff = w.start - RSVP_CUTOFF_MINUTES;
      return {
        current: null,
        next: key,
        isTomorrow: false,
        minsToNext: w.start - t,
        nextStartLabel: fmtTime12(w.start),
        rsvpCutoffLabel: fmtTime12(cutoff),
        rsvpClosed: t >= cutoff
      };
    }
    if (t <= w.end) {
      const next = order[i + 1] || null;
      const nextStart = next ? MEAL_WINDOWS[next].start : null;
      return {
        current: key,
        next,
        isTomorrow: false,
        minsToNext: nextStart != null ? nextStart - t : null,
        nextStartLabel: next ? fmtTime12(nextStart) : null,
        rsvpCutoffLabel: next ? fmtTime12(nextStart - RSVP_CUTOFF_MINUTES) : null,
        rsvpClosed: nextStart != null ? t >= nextStart - RSVP_CUTOFF_MINUTES : false
      };
    }
  }
  // Kitchen closed for the day — next serving is tomorrow's first meal.
  const firstW = MEAL_WINDOWS[order[0]];
  return {
    current: null,
    next: order[0],
    isTomorrow: true,
    minsToNext: 1440 - t + firstW.start,
    nextStartLabel: fmtTime12(firstW.start),
    rsvpCutoffLabel: fmtTime12(firstW.start - RSVP_CUTOFF_MINUTES),
    rsvpClosed: false
  };
}
