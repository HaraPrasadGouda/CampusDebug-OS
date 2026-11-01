// One-off: assign a mentor (mentor_roll) to EVERY student who doesn't have one
// yet — hostellers included. Run: node scripts/assign_mentors.cjs
// Uses the service-role key so it bypasses RLS.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const sb = createClient(url, key);

(async () => {
    // 1. Faculty roster (all teachers)
    const teachers = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('profiles').select('roll_number').eq('role', 'TEACHER').range(from, from + 999);
        if (error) { console.error('teacher fetch:', error.message); process.exit(1); }
        if (!data || !data.length) break;
        teachers.push(...data.map(r => String(r.roll_number).trim().toUpperCase()));
        if (data.length < 1000) break;
    }
    console.log('teachers:', teachers.length);
    if (!teachers.length) { console.error('no teachers'); process.exit(1); }

    // 2. Students without a mentor
    const students = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('profiles')
            .select('id, roll_number, resident_type, mentor_roll')
            .eq('role', 'STUDENT')
            .range(from, from + 999);
        if (error) { console.error('student fetch:', error.message); process.exit(1); }
        if (!data || !data.length) break;
        students.push(...data);
        if (data.length < 1000) break;
    }
    const needy = students.filter(s => !String(s.mentor_roll || '').trim());
    console.log('total students:', students.length, '| without mentor:', needy.length);

    // 3. Round-robin assign
    let i = 0;
    let updated = 0, failed = 0;
    for (const s of needy) {
        const mentor = teachers[i % teachers.length];
        i++;
        const { error } = await sb.from('profiles').update({ mentor_roll: mentor }).eq('id', s.id);
        if (error) { failed++; console.warn('update failed', s.roll_number, error.message); }
        else updated++;
    }
    console.log(`done: ${updated} updated, ${failed} failed`);
    process.exit(0);
})();
