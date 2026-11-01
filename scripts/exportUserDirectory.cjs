// Generates CampusDebug_User_Directory.doc from the live Supabase profiles table.
// One-time export helper for the finale demo — does not modify any data.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
);

(async () => {
    // Fetch ALL profiles — Supabase caps single requests at 1000 rows and
    // text-ordered roll numbers put students ("2…") before staff ("A…","G…","W…"),
    // so staff used to get silently cut off. Paginate until exhausted.
    let rows = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb
            .from('profiles')
            .select('roll_number,full_name,role,phone_number,department,hostel_block,room_number')
            .order('roll_number')
            .range(from, from + PAGE - 1);
        if (error) { console.error('Supabase error:', error.message); process.exit(1); }
        if (!data || data.length === 0) break;
        rows = rows.concat(data);
        if (data.length < PAGE) break;
    }

    let html = `<html><head><meta charset="utf-8"><style>
        body{font-family:'Segoe UI',Arial}
        h1{color:#1e3a8a}
        table{border-collapse:collapse;width:100%;font-size:9pt}
        th{background:#1e3a8a;color:#fff;text-align:left;padding:6px;border:1px solid #999}
        td{padding:4px 6px;border:1px solid #bbb}
        tr:nth-child(even) td{background:#f2f6ff}
        .staff td{background:#fff7d6;font-weight:bold}
    </style></head><body>`;
    html += `<h1>CampusDebug OS &mdash; User Directory &amp; Login Credentials</h1>`;
    html += `<p>Generated: ${new Date().toLocaleString()} &bull; Staff: <b>${rows.filter(p => p.role !== 'STUDENT').length}</b> &bull; Students: <b>${rows.filter(p => p.role === 'STUDENT').length}</b> &bull; Total: <b>${rows.length}</b></p>`;

    // Staff demo passwords (seeded accounts — match scripts/seedStaffAuth.cjs).
    // Values come from .env (DEMO_PASSWORD_*), never hardcoded here.
    const STAFF_PASSWORDS = {
        'WDN-001': process.env.DEMO_PASSWORD_WARDEN || 'see .env DEMO_PASSWORD_WARDEN',
        'GRD-001': process.env.DEMO_PASSWORD_GUARD || 'see .env DEMO_PASSWORD_GUARD',
        'ADM-001': process.env.DEMO_PASSWORD_ADMIN || 'see .env DEMO_PASSWORD_ADMIN',
        'DEN-001': process.env.DEMO_PASSWORD_DEAN || 'see .env DEMO_PASSWORD_DEAN'
    };

    // Student first-time default = firstname@<last-4-digits-of-mobile>
    // (same pattern as server.js defaultPasswordFor). Students are FORCED to
    // replace it with a private password on their first sign-in.
    const studentDefaultPassword = (p) => {
        const firstName = String(p.full_name || 'student').trim().split(/\s+/)[0].replace(/[^a-zA-Z]/g, '').toLowerCase();
        const digits = String(p.phone_number || '').replace(/\D/g, '');
        const last4 = digits.slice(-4) || '0000';
        return `${firstName}@${last4}`;
    };

    const staffRows = rows.filter(p => p.role !== 'STUDENT');
    const studentRows = rows.filter(p => p.role === 'STUDENT');

    // ---------- SECTION 1: STAFF (separate, on top) ----------
    html += `<h2 style="color:#1e3a8a">1. Staff Accounts &mdash; Admin / Warden / Guard / Dean</h2>`;
    html += `<table><tr><th>Staff ID</th><th>Full Name</th><th>Role</th><th>Department</th><th>Phone</th><th>Login ID</th><th>Password</th></tr>`;
    staffRows.forEach((p, idx) => {
        html += `<tr class="staff"><td>${p.roll_number}</td><td>${p.full_name}</td><td>${p.role}</td><td>${p.department || ''}</td><td>${p.phone_number || ''}</td><td><span style="font-family:Consolas,monospace"><b>${p.roll_number}</b></span></td><td><span style="font-family:Consolas,monospace"><b>${STAFF_PASSWORDS[p.roll_number] || 'contact sysadmin'}</b></span></td></tr>`;
    });
    html += '</table>';

    // ---------- SECTION 2: STUDENT DIRECTORY ----------
    html += `<h2 style="color:#1e3a8a;margin-top:28px">2. Student Directory &amp; First-Time Login Credentials (${studentRows.length} students)</h2>`;
    html += `<table><tr><th>#</th><th>Reg No / ID</th><th>Full Name</th><th>Department</th><th>Hostel Block</th><th>Room</th><th>Phone</th><th>Login ID</th><th>Password</th></tr>`;
    studentRows.forEach((p, idx) => {
        html += `<tr><td>${idx + 1}</td><td>${p.roll_number}</td><td>${p.full_name}</td><td>${p.department || ''}</td><td>${p.hostel_block || ''}</td><td>${p.room_number || ''}</td><td>${p.phone_number || ''}</td><td>${p.roll_number}</td><td><span style="font-family:Consolas,monospace">${studentDefaultPassword(p)}</span> <span style="color:#777">(default &mdash; must change at first sign-in)</span></td></tr>`;
    });
    html += '</table>';
    html += `<h3>How login works</h3><ul>
        <li><b>Login ID</b> = Registration Number (students) or Staff ID (warden/guard/admin/dean).</li>
        <li><b>Staff:</b> pre-provisioned accounts; the passwords in Section 1 are final unless changed in Settings.</li>
        <li><b>Students:</b> first sign-in uses the default password above (<i>firstname@last-4-of-registered-mobile</i>). The portal then forces setting a private password &mdash; the default stops working immediately. If a student forgets their password, Admin can reset it in the Metrics tab (Authenticated role-gated API).</li>
        <li>Every account's password is stored by Supabase Auth as a per-user <b>salted hash</b> &mdash; never stored plainly anywhere.</li>
    </ul>`;
    html += '</body></html>';
    const out = process.env.DEST || 'CampusDebug_User_Directory.doc';
    fs.writeFileSync(out, html);
    console.log(`written ${out} rows=${rows.length}`);
})();
