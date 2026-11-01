// One-off migration for data/timetable.json — applies the new library policy
// to the ALREADY-PUBLISHED schedule so students see the fix immediately,
// without waiting for an admin re-generation:
//   · library / self-study  → at most 2 DAYS a week
//   ·                       → at most 2 PERIODS on each of those days
//   · every other idle slot → a plain "Free Period" (kind 'free')
// The solver itself (server.js solveSection) now produces this shape on every
// fresh generation; this script only reshapes stale JSON on disk.
// Run:  node scripts/applyLibraryCap.cjs
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'timetable.json');
if (!fs.existsSync(file)) {
    console.error('no data/timetable.json found — nothing to migrate');
    process.exit(1);
}

const backupFile = path.join(__dirname, '..', 'backups', 'timetable.pre-library-cap.json');
if (!fs.existsSync(backupFile)) {
    fs.copyFileSync(file, backupFile);
    console.log('backup written:', backupFile);
}

const db = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(db.slots)) {
    console.error('timetable.json has no slots array — aborting');
    process.exit(1);
}

// Collect every existing library slot, grouped per section.
const studyBySec = {};
for (const s of db.slots) {
    if (s.kind === 'study') (studyBySec[s.sectionKey] = studyBySec[s.sectionKey] || []).push(s);
}

const LIB_DAYS = 2;
const LIB_PERIODS = 2;
let converted = 0;   // study -> free
let kept = 0;        // study stays study

for (const [secKey, list] of Object.entries(studyBySec)) {
    const byDay = {};
    for (const s of list) (byDay[s.day] = byDay[s.day] || []).push(s);

    // The 2 days with the MOST library periods become the section's library
    // days (deterministic tie-break: earliest day wins).
    const libDays = Object.entries(byDay)
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .slice(0, LIB_DAYS)
        .map(([d]) => d);

    const keptOnDay = {};
    for (const s of list) {
        if (libDays.includes(s.day) && (keptOnDay[s.day] || 0) < LIB_PERIODS) {
            keptOnDay[s.day] = (keptOnDay[s.day] || 0) + 1;
            kept++;
            continue; // stays a library/self-study slot
        }
        s.kind = 'free';
        s.subjectCode = 'FREE';
        s.subject = 'Free Period';
        s.teacherId = null;
        s.teacherName = null;
        s.room = null;
        converted++;
    }
}

// Sections directory: session counts never included study slots, and 'free'
// isn't a session either — recompute anyway so nothing drifts.
for (const sec of (db.sections || [])) {
    const mine = db.slots.filter(x => x.sectionKey === sec.key);
    sec.sessions = mine.filter(x => x.kind !== 'study' && x.kind !== 'free').length;
}

// span-2 slots (2-hour PPT double block, labs) must print the FULL range —
// the tail period's end — not the start period's 1-hour range.
const ROW = [0, 1, 3, 5, 6, 7];                    // teaching rows in TT_GRID
const END_MIN = { 1: 615, 2: 675, 3: 750, 4: 870, 5: 930, 6: 990 };
const PERIOD_TIME = {
    1: '09:15 AM - 10:15 AM', 2: '10:15 AM - 11:15 AM', 3: '11:30 AM - 12:30 PM',
    4: '01:30 PM - 02:30 PM', 5: '02:30 PM - 03:30 PM', 6: '03:30 PM - 04:30 PM'
};
let timesFixed = 0;
for (const s of db.slots) {
    if (s.span !== 2) continue;
    if (PERIOD_TIME[s.period + 1] && END_MIN[s.period + 1] != null) {
        s.time = `${PERIOD_TIME[s.period].split(' - ')[0]} - ${PERIOD_TIME[s.period + 1].split(' - ')[1]}`;
        s.endMin = END_MIN[s.period + 1];
        timesFixed++;
    }
}

fs.writeFileSync(file, JSON.stringify(db, null, 2));
const secs = Object.keys(studyBySec).length;
console.log(`library cap applied to ${secs} section(s): ${kept} library slot(s) kept, ${converted} converted to Free Period`);
console.log(`${timesFixed} span-2 slot(s) (PPT double blocks / labs) now print the full 2-hour range`);
