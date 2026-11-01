require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
    // pull all student rolls, find duplicates
    let rolls = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('profiles').select('roll_number,full_name,created_at').eq('role', 'STUDENT').order('roll_number').range(from, from + 999);
        if (error) { console.error('ERR', error.message); process.exit(1); }
        if (!data?.length) break;
        rolls = rolls.concat(data);
        if (data.length < 1000) break;
    }
    const seen = new Map();
    const dupes = [];
    for (const r of rolls) {
        if (seen.has(r.roll_number)) dupes.push(r.roll_number + ' (both: ' + seen.get(r.roll_number) + ' & ' + r.full_name + ')');
        seen.set(r.roll_number, r.full_name);
    }
    console.log('total students:', rolls.length);
    console.log('duplicates:', dupes.length === 0 ? 'none' : dupes.slice(0, 10));
    // name distribution — how many are "Student #i" placeholders vs real names
    const fake = rolls.filter(r => /^Student #\d+/.test(r.full_name || '')).length;
    console.log('placeholder-named ("Student #"):', fake);
    console.log('real names:', rolls.length - fake);
    // sample of each kind
    console.log('sample real:', JSON.stringify(rolls.find(r => !/^Student #/.test(r.full_name || ''))));
    console.log('sample fake:', JSON.stringify(rolls.find(r => /^Student #/.test(r.full_name || ''))));
})();
