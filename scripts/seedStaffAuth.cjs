// Seeds auth accounts for staff (Warden / Guard / Admin / Dean).
// Idempotent — skips users that already exist. Passwords = demo sheet values.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
);

const EMAIL_DOMAIN = '@campusdebug.os';

// Demo staff credentials live in .env (DEMO_PASSWORD_*), not in source.
const STAFF = [
    { roll: 'WDN-001', password: process.env.DEMO_PASSWORD_WARDEN || '' },
    { roll: 'GRD-001', password: process.env.DEMO_PASSWORD_GUARD || '' },
    { roll: 'ADM-001', password: process.env.DEMO_PASSWORD_ADMIN || '' },
    { roll: 'DEN-001', password: process.env.DEMO_PASSWORD_DEAN || '' }
];

(async () => {
    if (STAFF.some(s => !s.password)) {
        console.warn('⚠️ Some DEMO_PASSWORD_* values missing in .env — those staff accounts will be skipped.');
    }
    const { data: list } = await sb.auth.admin.listUsers();
    const existing = new Set((list?.users || []).map(u => String(u.email || '').toLowerCase()));

    for (const staff of STAFF) {
        const email = staff.roll.toLowerCase() + EMAIL_DOMAIN;
        if (existing.has(email)) {
            console.log(`exists, skipping: ${email}`);
            continue;
        }
        const { data, error } = await sb.auth.admin.createUser({
            email,
            password: staff.password,
            email_confirm: true,
            user_metadata: { roll_number: staff.roll }
        });
        console.log(error ? `FAILED ${email}: ${error.message}` : `created ${email}`);
    }
    console.log('done');
})();
