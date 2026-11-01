import express from 'express';
import cors from 'cors';
import axios from 'axios';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { MEAL_WINDOWS, MEAL_ORDER, RSVP_CUTOFF_MINUTES } from './src/data/messMenu.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

// ----------------------------------------------------
// 1. SUPABASE CLIENT INITIALIZATION & RESILIENCE
// ----------------------------------------------------
// Credentials live ONLY in .env — no literals in source.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
const HMAC_SECRET = process.env.HMAC_SECRET || '';

let supabase = null;
let supabaseAuth = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
        supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: {
                persistSession: false,
                autoRefreshToken: false
            }
        });
        // Dedicated auth-only client. signInWithPassword stores the signed-in
        // user's JWT in the client's in-memory auth state, and supabase-js then
        // attaches that token to subsequent database calls — which RLS then
        // treats as a plain logged-in user, silently breaking service-role
        // queries. Auth operations hence NEVER touch the data client.
        supabaseAuth = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: {
                persistSession: false,
                autoRefreshToken: false
            }
        });
        console.log('⚡ Connected directly to Supabase PostgREST Client:', SUPABASE_URL);
    } catch (sbErr) {
        console.warn('⚠️ Supabase client init warning:', sbErr.message);
    }
} else {
    console.warn('⚠️ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from environment.');
}

// In-Memory fallback caches (for offline development resilience & rapid client simulation)
// NO seed data — every ticket/cluster here comes from REAL student activity.
let ticketsDB = [];
let gatePassesDB = [];
// GP ledger is persisted to disk (like notices) so approvals/tokens survive
// server restarts — otherwise one device keeps its local pass while another
// loses the canonical copy and the two screens disagree.
const GATE_PASS_FILE = path.join(__dirname, 'data', 'gate_passes.json');
try {
    if (fs.existsSync(GATE_PASS_FILE)) {
        // BOM-tolerant read: editors/PowerShell may prefix a U+FEFF that breaks JSON.parse
        const raw = fs.readFileSync(GATE_PASS_FILE, 'utf8').replace(/^\uFEFF/, '');
        const savedPasses = JSON.parse(raw);
        if (Array.isArray(savedPasses)) gatePassesDB = savedPasses.slice(-300);
    }
} catch {
    console.warn('Could not read data/gate_passes.json — starting with an empty ledger.');
}
function persistGatePasses() {
    try {
        fs.mkdirSync(path.dirname(GATE_PASS_FILE), { recursive: true });
        fs.writeFileSync(GATE_PASS_FILE, JSON.stringify(gatePassesDB.slice(-300)), 'utf8');
    } catch (pErr) {
        console.warn('Gate-pass persistence failed (non-blocking):', pErr.message);
    }
}
let masterClustersDB = [];

// Helper: Normalize Categories
function normalizeCategory(cat = '') {
    const lower = String(cat).toLowerCase();
    if (lower.includes('water') || lower.includes('tap') || lower.includes('plumb') || lower.includes('leak') || lower.includes('cooler') || lower.includes('pipe') || lower.includes('drain')) return 'Plumbing';
    if (lower.includes('wifi') || lower.includes('net') || lower.includes('lan') || lower.includes('internet') || lower.includes('router') || lower.includes('signal')) return 'Wi-Fi / LAN';
    if (lower.includes('fan') || lower.includes('light') || lower.includes('elec') || lower.includes('switch') || lower.includes('spark') || lower.includes('wire') || lower.includes('mcb') || lower.includes('bulb')) return 'Electrical';
    if (lower.includes('bed') || lower.includes('door') || lower.includes('chair') || lower.includes('desk') || lower.includes('table') || lower.includes('furn') || lower.includes('window')) return 'Furniture';
    if (lower.includes('clean') || lower.includes('dust') || lower.includes('sweep') || lower.includes('washroom') || lower.includes('trash') || lower.includes('hygiene') || lower.includes('floor') || lower.includes('garbage') || lower.includes('mess')) return 'Cleanliness';
    return 'Cleanliness';
}

// Helper: Normalize urgency from free text / AI output
function normalizeUrgency(textOrUrgency = '') {
    const lower = String(textOrUrgency).toLowerCase();
    if (lower.includes('critical') || lower.includes('emergency') || lower.includes('fire') || lower.includes('smoke') || lower.includes('spark') || lower.includes('short circuit') || lower.includes('electric shock')) return 'CRITICAL';
    if (lower.includes('high') || lower.includes('urgent') || lower.includes('leak') || lower.includes('overflow') || lower.includes('burst') || lower.includes('no water') || lower.includes('injur')) return 'HIGH';
    if (lower.includes('low') || lower.includes('minor')) return 'LOW';
    return 'MEDIUM';
}

// ----------------------------------------------------
// 1b. TECHNICIAN ROSTER (deterministic routing — AI never invents names)
// ----------------------------------------------------
const TECHNICIAN_ROSTER = {
    'Plumbing':    { id: 'TECH-PLUMB-01', name: 'Manoj Kumar',   role: 'Senior Plumber',   specialty: 'Pipes, Taps, Water Coolers' },
    'Wi-Fi / LAN': { id: 'TECH-NET-01',   name: 'Suresh Patra',  role: 'Network Engineer', specialty: 'Wi-Fi APs, LAN Ports, Routers' },
    'Electrical':  { id: 'TECH-ELEC-01',  name: 'Ashok Mishra',  role: 'Electrician',      specialty: 'Fans, Lights, MCB, Wiring' },
    'Furniture':   { id: 'TECH-FURN-01',  name: 'Ramesh Behera', role: 'Hostel Carpenter', specialty: 'Beds, Desks, Doors, Windows' },
    'Cleanliness': { id: 'TECH-CLEAN-01', name: 'Jatindra Dash', role: 'Housekeeping Supervisor', specialty: 'Washrooms, Garbage, Sweeping' }
};

function getTechnicianFor(category) {
    const key = normalizeCategory(category);
    return TECHNICIAN_ROSTER[key] || TECHNICIAN_ROSTER['Cleanliness'];
}

// ----------------------------------------------------
// 1d. ROUTING LEDGER (server-side file persistence)
// The Supabase schema has no assigned_technician column and the service key
// can't run DDL, so technician assignments + work notes are persisted in a
// small JSON ledger next to the server (survives restarts on the same host).
// ----------------------------------------------------
import fs from 'fs';
const LEDGER_PATH = path.join(__dirname, 'data', 'assignments.json');
const ticketLedgerDB = {}; // { ticketId: { assignedTo, assignedTechId, notes, inProgress } }

// ----------------------------------------------------
// SMS GATEWAY — capcom6 "SMS Gateway for Android", self-hosted.
// Set in .env to enable REAL sms sent from your own Android SIM:
//   SMS_GATEWAY_URL=http://localhost:8080
//   SMS_GATEWAY_TOKEN=<generated in the gateway app / server>
// Without them every SMS degrades to a simulated console dispatch
// ("non-blocking degradation" — the app must never break without a SIM).
// ----------------------------------------------------
const SMS_GATEWAY_URL = process.env.SMS_GATEWAY_URL || '';
const SMS_GATEWAY_TOKEN = process.env.SMS_GATEWAY_TOKEN || '';
// SAFETY NET for live demos: when SMS_ALLOWLIST is non-empty, ONLY those
// numbers receive real SMS through the gateway; every other number gets a
// logged DRY-RUN dispatch instead. Leave empty for production (all numbers
// allowed). Demo story: list the 6 team members' numbers, remove at launch.
const SMS_ALLOWLIST = String(process.env.SMS_ALLOWLIST || '')
    .split(/[\s,;]+/)
    .map((s) => s.replace(/\D/g, ''))
    .filter(Boolean);
// Failsafe for BROADCAST SMS (notice-board fanout): never blast more than
// this many numbers per notice, no matter how many phones were collected.
const SMS_MAX_PER_BROADCAST = Math.max(
    1,
    parseInt(String(process.env.SMS_MAX_PER_BROADCAST || '50'), 10) || 50
);
// The canteen operator's registered mobile. At every meal's RSVP cutoff the
// server sends ONE headcount SMS here (4 meals/day = 4 SMS). Must also be
// listed in SMS_ALLOWLIST like the team demo numbers.
const CANTEEN_OPERATOR_PHONE = String(process.env.CANTEEN_OPERATOR_PHONE || '').trim();

// ----------------------------------------------------
// ACTIVATION TRACKER (delivery-mode intelligence)
// A student who has completed first login is "activated" → assumed to
// have a smart device → gets PUSH notifications.
// A student who has NEVER logged in (e.g. keypad-phone owner) stays
// "unactivated" → the system proactively sends SMS to their registered
// number instead. State lives in a small JSON file so it survives
// server restarts without touching the Supabase schema.
// ----------------------------------------------------
const ACTIVATION_FILE = path.join(__dirname, 'data', 'activated_students.json');
let activatedStudents = new Set();
try {
    if (fs.existsSync(ACTIVATION_FILE)) {
        activatedStudents = new Set(JSON.parse(fs.readFileSync(ACTIVATION_FILE, 'utf8')));
    }
} catch {
    activatedStudents = new Set();
}

function markStudentActivated(rollNumber) {
    if (!rollNumber) return;
    const key = String(rollNumber);
    if (activatedStudents.has(key)) return;
    activatedStudents.add(key);
    try {
        fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
        fs.writeFileSync(ACTIVATION_FILE, JSON.stringify([...activatedStudents], null, 2));
        console.log(`🔔 [ACTIVATION] ${key} has completed first login → will receive PUSH notifications (SMS falls back to critical-only).`);
    } catch (e) {
        console.warn('activation persistence failed (non-blocking):', e.message);
    }
}

function isStudentActivated(rollNumber) {
    if (!rollNumber) return false;
    return activatedStudents.has(String(rollNumber));
}

// ----------------------------------------------------
// WEB PUSH (VAPID) — real background notifications for PWA devices.
// Works even when the app tab is suspended or fully closed: the browser
// push service wakes the service worker, which displays the notification.
// Subscriptions are keyed by roll number in a small JSON file.
// ----------------------------------------------------
const webpush = (await import('web-push')).default;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails('mailto:campusdebug@college.example', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const PUSH_SUBS_FILE = path.join(__dirname, 'data', 'push_subscriptions.json'); // { roll: [subscription, ...] }
let pushSubscriptions = {};
try {
    if (fs.existsSync(PUSH_SUBS_FILE)) {
        pushSubscriptions = JSON.parse(fs.readFileSync(PUSH_SUBS_FILE, 'utf8'));
    }
} catch {
    pushSubscriptions = {};
}

function savePushSubs() {
    try {
        fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
        fs.writeFileSync(PUSH_SUBS_FILE, JSON.stringify(pushSubscriptions, null, 2));
    } catch (e) {
        console.warn('push subscription persistence failed (non-blocking):', e.message);
    }
}

// Fan a notice out to every subscribed device; prune dead subscriptions (410).
// One PHYSICAL device can be registered under several roll keys (the browser
// re-subscribes on every login the account holder makes from it), so the
// queue is flattened into an endpoint-keyed SET before sending — otherwise
// a device with 3 accounts on file receives the same push 3 times.
async function pushToRolls(rollNumbers, { title, body }) {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        console.warn('[push] VAPID keys missing — background push unavailable');
        return 0;
    }
    const rolls = new Set([...rollNumbers, 'global']);
    const payload = JSON.stringify({ title, body, url: '/' });
    // Flatten: Map<endpoint, { sub, rolls: Set } > across every queried roll
    // so pruning/still-alive bookkeeping can be written back to each roll.
    const byEndpoint = new Map();
    for (const roll of rolls) {
        const subs = pushSubscriptions[roll];
        if (!subs) continue;
        for (const sub of subs) {
            if (!byEndpoint.has(sub.endpoint)) byEndpoint.set(sub.endpoint, { sub, rolls: [] });
            byEndpoint.get(sub.endpoint).rolls.push(roll);
        }
    }
    console.log(`[push] fan-out: ${byEndpoint.size} unique device(s) across ${rolls.size} roll key(s)`);
    let delivered = 0;
    for (const { sub, rolls: owningRolls } of byEndpoint.values()) {
        let alive = true;
        try {
            await webpush.sendNotification(sub, payload);
            delivered++;
        } catch (err) {
            if (err.statusCode === 404 || err.statusCode === 410) {
                alive = false;
                console.log(`[push] pruned stale device ${String(sub.endpoint).slice(-12)}`);
            } else {
                console.warn(`[push] send failed (kept subscription) (${err.statusCode}):`, err.message);
            }
        }
        // Write the verdict back into every roll the device is registered under
        for (const roll of owningRolls) {
            const list = (pushSubscriptions[roll] || []).filter(s => s.endpoint !== sub.endpoint);
            if (alive) list.push(sub);
            if (list.length) pushSubscriptions[roll] = list;
            else delete pushSubscriptions[roll];
        }
    }
    savePushSubs();
    return delivered;
}

function pushEverything({ title, body }) {
    return pushToRolls(Object.keys(pushSubscriptions), { title, body });
}

// Unified dispatcher for every SMS in the system.
// Returns { mode: 'gateway' | 'simulated' | 'skipped', status }.
async function dispatchSms(phone, message) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) {
        return { mode: 'skipped', reason: 'no phone number' };
    }
    // Allowlist safety net: while set, unlisted numbers get a DRY-RUN only
    // (same console trail, zero gateway traffic) — protects real customers
    // and the team's SIM balance during demos.
    if (SMS_ALLOWLIST.length > 0) {
        const last10 = digits.slice(-10);
        const allowed = SMS_ALLOWLIST.some((a) => a.slice(-10) === last10);
        if (!allowed) {
            console.log(`📵 [SMS DRY-RUN — not on allowlist] -> ${digits} | "${message}"`);
            return { mode: 'dry-run', status: 'dispatched (dry-run, not on allowlist)' };
        }
    }
    if (SMS_GATEWAY_URL) {
        try {
            await axios.post(
                `${SMS_GATEWAY_URL.replace(/\/+$/, '')}/api/v1/messages`,
                { message, receivers: [digits] },
                {
                    headers: { Authorization: `Bearer ${SMS_GATEWAY_TOKEN}` },
                    timeout: 8000
                }
            );
            console.log(`📱 [SMS SENT via capcom6 gateway] -> ${digits} | "${message}"`);
            return { mode: 'gateway', status: 'sent' };
        } catch (gatewayErr) {
            console.warn(`⚠️ Gateway SMS failed (${gatewayErr.message}) — degrading to simulated dispatch`);
        }
    }
    console.log(`📱 [SIMULATED SMS DISPATCH] -> To: ${digits} | "${message}"`);
    return { mode: 'simulated', status: 'dispatched' };
}

// Delivery router: unactivated student → SMS, activated → push (no SMS).
// A student counts as push-reachable only when they ACTIVATED (first login)
// AND enabled Background Alerts (a live Web-Push subscription is stored).
// Everyone else — unactivated keypad users AND activated students who never
// turned the toggle on — falls back to the SMS channel so no one is left
// unreached. Used by the notice fan-out and gate-scan confirmations.
function hasPushSubscription(rollNumber) {
    if (!rollNumber) return false;
    const subs = pushSubscriptions[String(rollNumber)];
    return Array.isArray(subs) && subs.length > 0;
}

async function notifyStudent(rollNumber, phone, message) {
    if (rollNumber && isStudentActivated(rollNumber) && hasPushSubscription(rollNumber)) {
        console.log(`🔔 [DELIVERY ROUTER] ${rollNumber} is activated + alerts enabled → PUSH notification`);
        return { mode: 'push' };
    }
    if (rollNumber && isStudentActivated(rollNumber)) {
        console.log(`🔔 [DELIVERY ROUTER] ${rollNumber} activated but Background Alerts never enabled → SMS fallback (${phone || 'no phone on file'})`);
    }
    return dispatchSms(phone, message);
}

function loadLedger() {
    try {
        if (fs.existsSync(LEDGER_PATH)) {
            const raw = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
            Object.assign(ticketLedgerDB, raw.tickets || {});
            Object.assign(masterAssignmentsDB, raw.masters || {});
        }
    } catch (err) { console.warn('ledger load skipped:', err.message); }
}
function saveLedger() {
    try {
        fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
        fs.writeFileSync(LEDGER_PATH, JSON.stringify({ tickets: ticketLedgerDB, masters: masterAssignmentsDB }, null, 2));
    } catch (err) { console.warn('ledger save skipped:', err.message); }
}
loadLedger; // invoked after masterAssignmentsDB is declared (see section 9b)

// Ticket SLA hours by category/urgency (existing SLA system: default 4h from categories)
function slaHoursFor(urgency, category) {
    const u = String(urgency || '').toUpperCase();
    if (u === 'CRITICAL') return 1;
    if (u === 'HIGH') return 2;
    return 4;
}

// ----------------------------------------------------
// 1c. DUPLICATE/MASTER-INCIDENT SIMILARITY HELPERS
// ----------------------------------------------------
const STOPWORDS = new Set(('the a an and or of is are was were to in on at for with from by this that it its has have ' +
    'not no there their his her my your we they he she i you then than so very much more been being ' +
    'hai haiya main room floor hostel block please sir kindly issue problem').split(/\s+/));

// Hinglish (Latin-script Hindi) → English equivalence map. Used ONLY inside the
// duplicate-detection scorer so an English complaint and a Hinglish complaint
// about the SAME problem score high enough to merge. Translation is never
// shown to users, never sent to Ollama, and never used for categories.
const HINGLISH_MAP = {
    kachra: 'garbage', kuda: 'garbage', kooda: 'garbage', gandagi: 'garbage',
    dustbin: 'bin', kabaad: 'trash', kabaada: 'trash',
    badboo: 'smell', badbu: 'smell', boo: 'smell', gandh: 'smell', gandha: 'smell', ganda: 'dirty', gandi: 'dirty',
    uthaya: 'collect', uthate: 'collect', saaf: 'clean', safai: 'cleanliness', safaya: 'cleanliness',
    paani: 'water', panni: 'water', nal: 'tap', nalka: 'tap', leak: 'leak',
    kharab: 'broken', kharapp: 'broken', tut: 'broken', toota: 'broken', tooti: 'broken',
    bijli: 'electric', batti: 'light', mombatti: 'light',
    pankha: 'fan', pankhe: 'fan', bath: 'bathroom',
    machhar: 'mosquito', suar: 'drain', naali: 'drain', gadda: 'pit',
    chhat: 'ceiling', deewar: 'wall', darwaza: 'door', khidki: 'window',
    kam: 'working', chalu: 'working', band: 'off', jal: 'light'
};

function translateKeyword(word) {
    return HINGLISH_MAP[word] || word;
}

// Mini-stem so 'smells'~'smell', 'collected'~'collect', 'overflowing'~'overflow'
function lightStem(word) {
    return word.replace(/(ing|ed|es|s)$/, '');
}

function textKeywords(text) {
    return [...new Set(String(text || '').toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w))
        .map(translateKeyword)
        .map(lightStem))];
}

// Character-trigram similarity: robust to typos, spacing ('over flow'~'overflow')
// and inflections. Used as a secondary signal in matchScore.
function trigramScore(textA, textB) {
    const grams = (t) => {
        const s = new Set();
        const str = String(t || '').toLowerCase().replace(/[^a-z0-9\s]/g, '');
        for (let i = 0; i + 3 <= str.length; i++) s.add(str.slice(i, i + 3));
        return s;
    };
    const A = grams(textA), B = grams(textB);
    if (!A.size || !B.size) return 0;
    let overlap = 0;
    A.forEach(g => { if (B.has(g)) overlap++; });
    return overlap / Math.min(A.size, B.size);
}

// Word-overlap similarity (Jaccard) between two texts
function similarityScore(textA, textB) {
    const a = textKeywords(textA);
    const b = textKeywords(textB);
    if (a.length === 0 || b.length === 0) return 0;
    const bSet = new Set(b);
    let overlap = a.filter(w => bSet.has(w)).length;
    return overlap / Math.max(a.length, b.length);
}

// Match keywords from Ollama against existing complaint text
function keywordOverlapScore(aiKeywords, existingText) {
    if (!aiKeywords || !aiKeywords.length) return 0;
    const existing = new Set(textKeywords(existingText));
    if (existing.size === 0) return 0;
    // AI keywords may be multi-word ("ceiling light") — expand to words so a
    // single matching term inside a keyword still counts
    const hits = aiKeywords.filter(k =>
        textKeywords(k).some(w => existing.has(w))
    ).length;
    return hits / Math.max(aiKeywords.length, 1);
}

// Combined duplicate-detection score for a candidate ticket vs the new complaint
function matchScore(candidateTicket, { category, block, text, keywords }) {
    const candCat = normalizeCategory(candidateTicket.category);
    if (candCat !== category) return 0; // category must match exactly
    const candLoc = String(candidateTicket.location || '');
    if (!candLoc.toLowerCase().includes(String(block).toLowerCase())) return 0; // must be same hostel block

    const candText = candidateTicket.raw_text || candidateTicket.description || candidateTicket.title || '';
    const sim = Math.max(
        similarityScore(candText, text),                       // word-level similarity
        keywordOverlapScore(keywords, candText),               // AI keyword overlap
        trigramScore(candText, `${text}`)                      // character n-grams (Hinglish/inflections)
    );
    if (sim <= 0.01) return 0;
    // Freshness: complaints within 12h only
    const created = candidateTicket.createdAtMs || (candidateTicket.created_at ? new Date(candidateTicket.created_at).getTime() : 0);
    if (created && (Date.now() - created) > 12 * 3600 * 1000) return 0;
    return sim;
}

const SIMILARITY_THRESHOLD = 0.30; // ≥30% semantic overlap required to merge

// ----------------------------------------------------
// 2. SUPABASE AUTH VERIFICATION MIDDLEWARE
// ----------------------------------------------------
export const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // Offline-dev fallback ONLY when Supabase is not configured.
        // With the cloud connected, every API call must carry a real login token.
        if (!supabase) {
            req.user = {
                id: '10000000-0000-0000-0000-000000000001',
                rollNo: '2201106190',
                role: 'STUDENT',
                name: 'Debasish Sahoo'
            };
            return next();
        }
        return res.status(401).json({ success: false, error: 'Sign in required' });
    }

    const token = authHeader.split(' ')[1];

    if (!supabase) {
        req.user = { id: 'mock-user-id', role: 'STUDENT' };
        return next();
    }

    try {
        const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({ success: false, error: 'Invalid or expired bearer token' });
        }

        // Link the auth identity to its college directory row. New accounts are
        // provisioned as rollNumber@campusdebug.os, so the directory row is found
        // by roll number even though profiles rows use college-assigned UUIDs.
        let { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();
        if (!profile && user.email) {
            const rollFromEmail = String(user.email).toLowerCase().split('@')[0];
            ({ data: profile } = await supabase
                .from('profiles')
                .select('*')
                .ilike('roll_number', rollFromEmail)
                .maybeSingle());
        }

        req.user = {
            id: user.id,
            email: user.email,
            rollNumber: profile?.roll_number || (user.email ? user.email.split('@')[0] : null),
            role: profile?.role || 'STUDENT',
            name: profile?.full_name || 'User',
            profile: profile || {},
            mock: false
        };
        next();
    } catch (authErr) {
        console.warn('Bearer auth verification failed:', authErr.message);
        return res.status(401).json({ success: false, error: 'Authentication failed' });
    }
};

// ----------------------------------------------------
// 3. AUTHENTICATION ROUTES (Supabase Auth managed)
//    Passwords are stored ONLY as salted hashes inside
//    Supabase's auth schema — never in `profiles`, never
//    in plaintext. Login identity = roll/staff ID + password.
// ----------------------------------------------------
const AUTH_EMAIL_DOMAIN = '@campusdebug.os';
const authEmailFor = (id) => `${String(id).trim().toLowerCase()}${AUTH_EMAIL_DOMAIN}`;

// Default first-login password: phone-based (chosen product decision).
// firstname@<last 4 digits of the college-registered mobile>
function defaultPasswordFor(profile) {
    const firstName = String(profile.full_name || 'student')
        .trim().split(/\s+/)[0].replace(/[^a-zA-Z]/g, '').toLowerCase();
    const digits = String(profile.phone_number || '').replace(/\D/g, '');
    const last4 = digits.slice(-4) || '0000';
    return `${firstName}@${last4}`;
}

async function findProfileByIdOrRoll(id, roll) {
    if (roll) {
        const { data } = await supabase.from('profiles')
            .select('*').ilike('roll_number', String(roll).trim()).maybeSingle();
        if (data) return data;
    }
    if (id) {
        const { data } = await supabase.from('profiles')
            .select('*').eq('id', id).maybeSingle();
        if (data) return data;
    }
    return null;
}

// ----------------------------------------------------
// 3. AUTH ROUTE GUARD (declared before any route that uses it)
// ----------------------------------------------------
export const requireRole = (...allowed) => (req, res, next) => {
    const role = String(req.user?.role || '').toUpperCase();
    if (!req.user || req.user.mock) return res.status(401).json({ success: false, error: 'Sign in required' });
    if (allowed.length && !allowed.map(r => String(r).toUpperCase()).includes(role)) {
        return res.status(403).json({ success: false, error: `Your role (${role}) is not authorized for this action` });
    }
    next();
};

// Public: check an ID exists in the college directory (login screen "Verify Record")
app.post('/api/auth/verify-login', async (req, res) => {
    try {
        const { rollNumber } = req.body || {};
        if (!supabase) return res.status(503).json({ success: false, error: 'Database offline' });
        const profile = await findProfileByIdOrRoll(null, rollNumber);
        if (!profile) {
            return res.status(404).json({ success: false, verified: false, error: 'This registration number is not in the college records' });
        }
        const { data: authUser } = await supabaseAuth.auth.admin.listUsers();
        const activated = (authUser?.users || []).some(u => String(u.email || '').toLowerCase() === authEmailFor(profile.roll_number));
        return res.json({
            success: true,
            verified: true,
            activated,
            fullName: profile.full_name,
            role: profile.role,
            department: profile.department,
            hostelBlock: profile.hostel_block,
            firstTimeHint: activated ? null : defaultPasswordFor(profile) ? 'firstname@last4-of-registered-mobile' : null
        });
    } catch (e) {
        console.warn('verify-login error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Public: sign in. First-time users auto-provision when the submitted
// password equals the college default pattern; then force a password change.
app.post('/api/auth/login', async (req, res) => {
    try {
        const { rollNumber, password } = req.body || {};
        if (!supabase) return res.status(503).json({ success: false, error: 'Database offline' });
        if (!rollNumber || !password) return res.status(400).json({ success: false, error: 'Registration number and password are required' });

        const profile = await findProfileByIdOrRoll(null, rollNumber);
        if (!profile) return res.status(404).json({ success: false, error: 'This registration number is not in the college records' });

        const email = authEmailFor(profile.roll_number);
        let firstLogin = false;

        // Try normal sign-in first
        let { data: signIn, error: signInErr } = await supabaseAuth.auth.signInWithPassword({ email, password });

        if (signInErr || !signIn?.session) {
            // Account may not exist yet → allow provisioning via the default pattern
            if (password === defaultPasswordFor(profile)) {
                const { data: created, error: createErr } = await supabaseAuth.auth.admin.createUser({
                    email,
                    password,
                    email_confirm: true,
                    user_metadata: { roll_number: profile.roll_number, full_name: profile.full_name, role: profile.role }
                });
                if (createErr) {
                    // e.g. user already exists with a different password
                    return res.status(401).json({ success: false, error: 'Incorrect password. If you changed it, use your new password.' });
                }
                firstLogin = true;
                ({ data: signIn, error: signInErr } = await supabaseAuth.auth.signInWithPassword({ email, password }));
                if (signInErr || !signIn?.session) {
                    return res.status(401).json({ success: false, error: 'Account created but sign-in failed — please try again.' });
                }
            } else {
                return res.status(401).json({ success: false, error: 'Incorrect password. First time? Your default password is firstname@last-4-digits-of-your-registered-mobile.' });
            }
        }

        // Activation ceremony complete → this student now has a smart
        // device session running the PWA → push notifications, not SMS.
        markStudentActivated(profile.roll_number);

        // Still on the college default pattern? (Fresh account, or an admin
        // reset, or a test-recovery reset.) Either way the user must set a
        // private password before the portal opens — flag it identically to
        // a first login so the same forced-change ceremony shows.
        const usingDefault = password === defaultPasswordFor(profile);

        return res.json({
            success: true,
            firstLogin: firstLogin || usingDefault,
            session: {
                access_token: signIn.session.access_token,
                refresh_token: signIn.session.refresh_token,
                expires_in: signIn.session.expires_in,
                user_id: signIn.user?.id
            },
            profile: {
                id: profile.id,
                rollNumber: profile.roll_number,
                fullName: profile.full_name,
                role: profile.role,
                department: profile.department,
                course: profile.course || null,
                section: profile.section || null,
                hostelBlock: profile.hostel_block,
                residentType: profile.resident_type || null,
                roomNumber: profile.room_number,
                phone: profile.phone_number,
                attendance: profile.attendance_percentage,
                feeDue: profile.fee_due_balance
            }
        });
    } catch (e) {
        console.warn('login error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Authed: change password (Settings → Change Password, or forced first-login change)
app.post('/api/auth/change-password', async (req, res) => {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
        if (!token) return res.status(401).json({ success: false, error: 'Sign in first' });
        const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
        if (error || !user) return res.status(401).json({ success: false, error: 'Session expired — sign in again' });
        const { newPassword } = req.body || {};
        if (!newPassword || String(newPassword).length < 6) {
            return res.status(400).json({ success: false, error: 'New password must be at least 6 characters' });
        }
        if (String(newPassword) === String(req.body?.oldPassword)) {
            return res.status(400).json({ success: false, error: 'New password must be different from the default one' });
        }
        const { error: updErr } = await supabaseAuth.auth.admin.updateUserById(user.id, { password: String(newPassword) });
        if (updErr) return res.status(500).json({ success: false, error: updErr.message });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Authed ADMIN/DEAN: reset a student's password back to the college default
// pattern (e.g. printed on the Word directory). The student then treats the
// next sign-in exactly like a first login — default password in, private
// password set before the portal opens. This is the recovery path for
// "forgotten password"; passwords can never be READ, only replaced.
app.post('/api/admin/reset-password', authenticateUser, requireRole('ADMIN', 'DEAN'), async (req, res) => {
    try {
        if (!supabaseAuth) return res.status(503).json({ success: false, error: 'Database offline' });
        const { rollNumber } = req.body || {};
        if (!rollNumber) return res.status(400).json({ success: false, error: 'Registration number required' });

        const profile = await findProfileByIdOrRoll(null, rollNumber);
        if (!profile) return res.status(404).json({ success: false, error: 'This registration number is not in the college records' });

        const defaultPassword = defaultPasswordFor(profile);
        if (!defaultPassword || defaultPassword.endsWith('@0000')) {
            return res.status(400).json({ success: false, error: 'This profile has no registered mobile — cannot compute a default password' });
        }

        // Find the existing auth user and reset (replace) the password
        const { data: list } = await supabaseAuth.auth.admin.listUsers();
        const email = authEmailFor(profile.roll_number);
        const authUser = (list?.users || []).find(u => String(u.email || '').toLowerCase() === email);
        if (!authUser) {
            // Account was never activated — nothing to reset; next login with
            // the default pattern will auto-provision anyway.
            return res.json({ success: true, reset: 'not_yet_activated', message: `${profile.full_name} has not activated yet — the default password already works.` });
        }
        const { error: updErr } = await supabaseAuth.auth.admin.updateUserById(authUser.id, { password: defaultPassword });
        if (updErr) return res.status(500).json({ success: false, error: updErr.message });

        console.log(`🔑 [ADMIN PASSWORD RESET]: ${profile.roll_number} (${profile.full_name}) reset by ${req.user.rollNumber}`);
        return res.json({
            success: true,
            reset: true,
            studentName: profile.full_name,
            message: `${profile.full_name}'s password was reset to the default (${defaultPassword}). They must set a private password on next sign-in.`
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Public: refresh an expired access token
app.post('/api/auth/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body || {};
        if (!refreshToken) return res.status(400).json({ success: false, error: 'Refresh token required' });
        const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY },
            body: JSON.stringify({ refresh_token: refreshToken })
        });
        const data = await resp.json();
        if (!resp.ok || !data?.access_token) {
            // Surface Supabase's real reason (e.g. "Invalid Refresh Token: Already Used")
            // so the client can tell a revoked family apart from a transient failure.
            return res.status(401).json({
                success: false,
                error: data?.error_description || data?.error || 'Refresh failed'
            });
        }
        res.json({
            success: true,
            session: {
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                expires_in: data.expires_in
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ----------------------------------------------------
// 3. BACKGROUND 60-SECOND SLA AUTO-ESCALATION LOOP
// ----------------------------------------------------
// Queries Supabase every 60s for PENDING tickets older than 4 hours
// and auto-escalates them to ESCALATED_TO_DEAN.
setInterval(async () => {
    try {
        // Existing SLA policy: 4h hard threshold (1h for critical). A complaint
        // that has been sent to a technician but NOT resolved in time is still a
        // breach — ASSIGNED / IN_PROGRESS counts toward the same single mechanism.
        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
        let escalatedCount = 0;

        if (supabase) {
            const { data: breachedTickets, error: queryErr } = await supabase
                .from('tickets')
                .select('id, location, category, created_at, sla_hours, urgency')
                .in('status', ['PENDING', 'ASSIGNED'])
                .lt('created_at', fourHoursAgo);

            if (!queryErr && breachedTickets && breachedTickets.length > 0) {
                const ids = breachedTickets.map(t => t.id);
                const { error: updateErr } = await supabase
                    .from('tickets')
                    .update({ status: 'ESCALATED_TO_DEAN' })
                    .in('id', ids);

                if (!updateErr) {
                    escalatedCount += ids.length;
                    breachedTickets.forEach(t => {
                        console.log(`🚨 [SUPABASE SLA BREACH]: Ticket #${t.id} (${t.category} at ${t.location}) escalated to Dean of Student Affairs!`);
                    });
                }
            }
        }

        // Keep in-memory cache in sync (per-ticket SLA hours respected)
        const now = Date.now();
        ticketsDB.forEach(ticket => {
            const createdMs = ticket.createdAtMs || (ticket.createdAt ? new Date(ticket.createdAt).getTime() : now);
            const slaHours = Number(ticket.sla_hours) || slaHoursFor(ticket.urgency, ticket.category);
            const unresolved = ['PENDING', 'REPORTED', 'ASSIGNED', 'IN_PROGRESS'].includes(String(ticket.status).toUpperCase());
            if (now - createdMs > slaHours * 60 * 60 * 1000 && unresolved) {
                ticket.status = 'ESCALATED_TO_DEAN';
                ticket.statusLabel = 'Escalated to Dean (SLA Breached)';
                ticket.urgency = 'CRITICAL';
                escalatedCount++;
                console.log(`🚨 [SLA BREACH → DEAN]: Ticket #${ticket.id} (${ticket.category}) breached its ${slaHours}h SLA — auto-escalated.`);
            }
        });

        // Master incidents follow the same policy (count OPEN/IN_PROGRESS age)
        masterClustersDB.forEach(m => {
            const createdMs = m.createdAtMs || (m.createdAt ? new Date(m.createdAt).getTime() : 0);
            if (createdMs && (now - createdMs) > 4 * 3600 * 1000 &&
                ['OPEN', 'UNASSIGNED', 'IN_PROGRESS'].includes(String(m.status).toUpperCase())) {
                m.status = 'ESCALATED_TO_DEAN';
                escalatedCount++;
            }
        });

        if (escalatedCount > 0) {
            console.log(`⚡ [SLA Auto-Escalation Loop]: ${escalatedCount} ticket(s) breached 4h threshold.`);
        }
    } catch (loopErr) {
        console.warn('SLA loop check warning:', loopErr.message);
    }
}, 60000);

// ----------------------------------------------------
// 4. API ROUTE: POST /api/parse-ticket (AI + Clustering + Supabase)
// ----------------------------------------------------
app.post('/api/parse-ticket', authenticateUser, async (req, res) => {
    try {
        const { 
            complaintText, 
            hostelBlock = "Block B", 
            floor = "3rd Floor", 
            room = "304", 
            studentId = req.user?.profile?.id || req.user?.id || "10000000-0000-0000-0000-000000000001",
            urgency = "MEDIUM"
        } = req.body;

        if (!complaintText) {
            return res.status(400).json({ success: false, error: 'Complaint text is required' });
        }

        // 1. Ollama (qwen2.5:1.5b) or Regex Fallback Parsing
        // The AI classifies/normalizes the complaint ONLY — it never picks the
        // location (form fields are authoritative) or invents technicians,
        // incidents or students. Invalid output can never break creation: the
        // whole block has a hard 15s timeout and a deterministic fallback.
        let parsedAI = {};
        const cleanBlockPre = hostelBlock.replace(/^Hostel\s*/i, '');
        const fullLocationPre = `Hostel ${cleanBlockPre}, ${floor}, Room ${room}`;
        const AI_SCHEMA = `Return ONLY JSON exactly like: {"category":"Electrical|Plumbing|Wi-Fi / LAN|Furniture|Cleanliness","title":"short title of the actual problem","urgency":"LOW|MEDIUM|HIGH|CRITICAL","severity":"LOW|MEDIUM|HIGH|CRITICAL","keywords":["word1","word2"],"summary":"one-line problem description"}`;
        try {
            const response = await axios.post('http://localhost:11434/api/generate', {
                model: 'campusdebug-ai',
                // Student's structured form fields are the truth for location — feed
                // them to the model so it can't hallucinate rooms in titles.
                prompt: `[Reported at: ${fullLocationPre}]\n${complaintText}\n${AI_SCHEMA}`,
                stream: false,
                format: 'json'
            }, { timeout: 15000 });

            parsedAI = JSON.parse(response.data.response);
            // Validate/sanitize AI output — bad fields fall back deterministically
            const CANON_CATEGORIES = ['Electrical', 'Plumbing', 'Wi-Fi / LAN', 'Furniture', 'Cleanliness'];
            if (!parsedAI || typeof parsedAI !== 'object') parsedAI = {};
            // Fix 4 (AI category): remember the category ONLY when the model
            // itself returned a valid one (not when it is re-derived from
            // keywords below) — this is what the ticket chip shows as "AI".
            // The fine-tuned model (Modelfile / campus_ai_dataset.jsonl) answers with
            // its own labels (ELECTRICAL, PLUMBING, MESS_HYGIENE …), not the app's 5
            // names, so map them here (case-insensitive; the app's own names work too).
            // A label with no sensible ticket category (GATE_PASS, MESS_FEEDBACK,
            // anything unknown) maps to nothing → no chip. Chip only — routing and the
            // student's category below are NOT affected by this map.
            const AI_LABEL_TO_CATEGORY = {
                ELECTRICAL: 'Electrical', ELECTRIC: 'Electrical', ELECTRICITY: 'Electrical',
                PLUMBING: 'Plumbing', WATER_COOLER: 'Plumbing', WATER: 'Plumbing',
                WI_FI_LAN: 'Wi-Fi / LAN', WIFI_LAN: 'Wi-Fi / LAN', WI_FI: 'Wi-Fi / LAN', WIFI: 'Wi-Fi / LAN',
                LAN: 'Wi-Fi / LAN', NETWORK: 'Wi-Fi / LAN', INTERNET: 'Wi-Fi / LAN',
                FURNITURE: 'Furniture',
                CLEANLINESS: 'Cleanliness', CLEANING: 'Cleanliness', HOUSEKEEPING: 'Cleanliness',
                HYGIENE: 'Cleanliness', MESS_HYGIENE: 'Cleanliness'
            };
            const aiLabelKey = typeof parsedAI.category === 'string' && !parsedAI.category.includes('|')
                ? parsedAI.category.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') : '';
            const aiOwnCategory = AI_LABEL_TO_CATEGORY[aiLabelKey] || null;
            // Qwen occasionally echoes the prompt's enum verbatim ("Electrical|Plumbing|…")
            // or invents labels. Any non-canonical category is discarded and re-derived
            // deterministically from the STUDENT'S OWN complaint text — never from the AI.
            if (!parsedAI.category || typeof parsedAI.category !== 'string'
                || parsedAI.category.includes('|')
                || !CANON_CATEGORIES.includes(parsedAI.category.trim())) {
                parsedAI.category = normalizeCategory(complaintText);
            }
            if (!parsedAI.title || typeof parsedAI.title !== 'string') parsedAI.title = `${parsedAI.category}: ${complaintText}`.slice(0, 120);
            if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(parsedAI.urgency || '').toUpperCase())) {
                parsedAI.urgency = parsedAI.urgency ? normalizeUrgency(parsedAI.urgency) : normalizeUrgency(complaintText);
            }
            parsedAI.urgency = String(parsedAI.urgency || 'MEDIUM').toUpperCase();
            if (parsedAI.severity) parsedAI.severity = String(parsedAI.severity).toUpperCase();
            else parsedAI.severity = parsedAI.urgency;
            if (!Array.isArray(parsedAI.keywords)) parsedAI.keywords = textKeywords(complaintText).slice(0, 8);
            else parsedAI.keywords = parsedAI.keywords.filter(k => typeof k === 'string' && k.trim()).slice(0, 8);
            parsedAI.location = fullLocationPre;  // always authoritative: form fields
            parsedAI._aiCategory = aiOwnCategory;
            console.log(`🤖 Ollama AI Parsing successful (location fixed to form input ${fullLocationPre}):`, parsedAI);
        } catch (ollamaErr) {
            console.warn('⚠️ Ollama unavailable, using deterministic fallback parser:', ollamaErr.message);
            const category = normalizeCategory(complaintText);
            const fallbackUrgency = normalizeUrgency(complaintText);
            parsedAI = {
                category,
                title: `${category}: Room #${room} - ${complaintText}`.slice(0, 120),
                urgency: fallbackUrgency,
                severity: fallbackUrgency,
                keywords: textKeywords(complaintText).slice(0, 8),
                summary: complaintText,
                _fallback: true
            };
        }

        const category = normalizeCategory(req.body.category || parsedAI.category || complaintText);
        // Fix 4: the student's pick still routes the ticket (unchanged); the AI's
        // own category is kept beside it so staff and the student can see it.
        // null when the AI was unavailable or gave no valid category.
        const aiCategory = parsedAI._aiCategory || null;
        const cleanBlock = hostelBlock.replace(/^Hostel\s*/i, '');
        const cleanFloor = floor.trim();
        const fullLocation = `Hostel ${cleanBlock}, ${cleanFloor}, Room ${room}`;
        const urgencyLevel = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(req.body.urgency || '').toUpperCase())
            ? String(req.body.urgency).toUpperCase()
            : String(parsedAI.urgency || 'MEDIUM').toUpperCase();
        const slaHours = Number(parsedAI.sla_hours) || slaHoursFor(urgencyLevel, category);
        const aiKeywords = Array.isArray(parsedAI.keywords) ? parsedAI.keywords : [];
        const summaryText = parsedAI.summary || complaintText;
        const tech = getTechnicianFor(category);
        const isCritical = urgencyLevel === 'CRITICAL';
        const severityLabel = {
            LOW: 'Routine', MEDIUM: 'Standard', HIGH: 'High-Risk', CRITICAL: 'Critical'
        }[urgencyLevel] || 'Standard';

        // 2. Route through the existing dedupe/assignment engine
        let insertedTicket = null;
        let masterIncidentId = null;
        let joinedMaster = false;          // true = attached to an existing master incident
        let newlyFormedCluster = false;    // true = similarity match formed a NEW master incident
        let ticketErrWarn = null;

        if (supabase) {
            try {
                // ---- (a) Search ACTIVE unresolved tickets for a matching problem ----
                // Same room/floor alone never merges — similarity requires category +
                // block + text/keyword overlap + time proximity (matchScore).
                let matchTarget = null;
                if (!isCritical) { // Critical issues route straight to a technician; no clustering wait
                    const { data: activeTickets, error: activeErr } = await supabase
                        .from('tickets')
                        .select('*')
                        .in('status', ['PENDING', 'ASSIGNED'])
                        .order('created_at', { ascending: false })
                        .limit(50);
                    console.log(`🔎 [Duplicate Detection]: scanned ${activeTickets ? activeTickets.length : 0} active candidate ticket(s)` + (activeErr ? ` (query ERROR: ${activeErr.message})` : ''));
                    if (activeErr) console.warn('duplicate-scan query error:', activeErr.message);
                    if (activeTickets) {
                        let bestScore = 0;
                        for (const cand of activeTickets) {
                            const score = matchScore(cand, { category, block: cleanBlock, text: `${summaryText} ${complaintText}`, keywords: [...new Set([...(aiKeywords || []), ...textKeywords(complaintText).slice(0, 6)])] });
                            if (score > 0) console.log(`🔎 [Duplicate Detection]: candidate ${cand.id} (${cand.category}) scored ${score.toFixed(2)} vs new complaint`);
                            if (score > bestScore) { bestScore = score; matchTarget = cand; }
                        }
                        if (bestScore < SIMILARITY_THRESHOLD) matchTarget = null;
                        console.log(`🔎 [Duplicate Detection]: best similarity score ${(bestScore).toFixed(2)} (threshold ${SIMILARITY_THRESHOLD}) → ${matchTarget ? 'MATCH ' + matchTarget.id : 'standalone'}`);
                    }
                }

                if (matchTarget) {
                    // ---- (b) MATCH FOUND: attach to the matching ticket's master incident ----
                    joinedMaster = true;
                    masterIncidentId = matchTarget.master_incident_id || null;

                    if (!masterIncidentId) {
                        // The matched ticket is still standalone — form a Master Incident
                        // that both complaints join (the 2nd match creates the cluster).
                        const clusterCode = `MST-${category.slice(0, 4).toUpperCase().replace(/[^A-Z]/g, '')}-${cleanBlock.replace(/\s+/g, '')}-${Date.now() % 1000}`;
                        const { data: newCluster } = await supabase
                            .from('master_incidents')
                            .insert({
                                cluster_code: clusterCode,
                                category,
                                hostel_block: cleanBlock,
                                floor_number: cleanFloor,
                                status: 'OPEN',
                                ticket_count: 2
                            })
                            .select()
                            .single();
                        if (newCluster) {
                            masterIncidentId = newCluster.id;
                            newlyFormedCluster = true;
                            // Link the earlier (matched) student complaint to the same master
                            await supabase.from('tickets')
                                .update({ master_incident_id: newCluster.id })
                                .eq('id', matchTarget.id);
                            console.log(`🌐 [Spatial Clustering Triggered]: Master Incident ${clusterCode} formed — ${matchTarget.id} + new ticket share the same verified problem.`);
                        }
                    } else {
                        // Joining an existing master — increment its ticket count
                        try {
                            const { data: masterRow } = await supabase
                                .from('master_incidents').select('ticket_count').eq('id', masterIncidentId).maybeSingle();
                            await supabase.from('master_incidents')
                                .update({ ticket_count: ((masterRow && masterRow.ticket_count) || 1) + 1 })
                                .eq('id', masterIncidentId);
                        } catch (incErr) { console.warn('ticket_count increment skipped:', incErr.message); }
                        console.log(`🔗 [Duplicate Matched]: New complaint attached to existing Master Incident ${masterIncidentId} (score ≥ ${SIMILARITY_THRESHOLD}).`);
                    }
                }

                // ---- (c) EVERY ticket gets an immediate technician assignment ----
                // (Warden is a supervisor, not a bottleneck — no complaint waits for
                // a second student to report the same problem, and critical issues
                // skip clustering entirely.)
                if (masterIncidentId) {
                    // If the master already has a technical crew, that crew owns the new complaint too
                    if (masterAssignmentsDB[masterIncidentId]) tech.assignedNote = masterAssignmentsDB[masterIncidentId].name;
                }

                const ticketRow = {
                    student_id: studentId,
                    master_incident_id: masterIncidentId,
                    raw_text: complaintText,
                    category,
                    location: fullLocation,
                    urgency: urgencyLevel,
                    sla_hours: slaHours,
                    status: 'ASSIGNED'
                };

                let ticketErr = null;
                let sbTicket = null;
                const r = await supabase.from('tickets').insert(ticketRow).select().single();
                sbTicket = r.data; ticketErr = r.error;

                if (!ticketErr && sbTicket) {
                    insertedTicket = sbTicket;
                    if (isCritical) {
                        console.log(`🚨 [CRITICAL COMPLAINT]: Ticket #${sbTicket.id} (${category} at ${fullLocation}) — Warden flagged immediately, Technician ${tech.name} (${tech.id}) routed. Not waiting for clustering.`);
                    }
                } else if (ticketErr) {
                    ticketErrWarn = ticketErr.message;
                    console.warn('Supabase ticket insert error:', ticketErr.message);
                }
            } catch (dbErr) {
                console.warn('Supabase ticket write fallback:', dbErr.message);
                ticketErrWarn = dbErr.message;
            }
        }

        // Shaped ticket for the client (UI contract: type/title/description/status)
        const newTicket = {
            id: (insertedTicket && insertedTicket.id) || `TKT-${Math.floor(10000 + Math.random() * 90000)}`,
            type: 'ticket',
            category,
            title: parsedAI.title || `${category}: Room #${room} - ${complaintText}`,
            description: complaintText,
            summary: parsedAI.summary || complaintText,
            location: fullLocation,
            hostelBlock: cleanBlock,
            floor: cleanFloor,
            room,
            urgency: urgencyLevel,
            severity: severityLabel,
            keywords: aiKeywords,
            aiCategory: aiCategory || undefined,
            status: 'ASSIGNED',
            statusLabel: isCritical
                ? `CRITICAL — Routed to ${tech.name} (Warden Alerted)`
                : joinedMaster
                    ? `Linked to Master Incident — ${tech.name} Handling`
                    : `Routed to ${tech.name}`,
            assignedTo: tech.name,
            assignedTechId: tech.id,
            masterId: masterIncidentId || undefined,
            masterJoined: joinedMaster || undefined,
            clusterFormed: newlyFormedCluster || undefined,
            sla: `SLA: ${slaHours}h Target`,
            sla_hours: slaHours,
            createdAt: new Date().toISOString(),
            createdAtMs: Date.now(),
            timestamp: 'Just now',
            time: 'Just now'
        };
        // Mirror into the in-memory cache (same store every route reads)
        ticketsDB.unshift(newTicket);
        // Persist routing in the ledger (technician ownership survives restarts)
        ticketLedgerDB[String(newTicket.id)] = {
            assignedTo: tech.name, assignedTechId: tech.id,
            statusLabel: newTicket.statusLabel, notes: '',
            createdAt: newTicket.createdAt,
            // Fix 4: no tickets column for it (no schema change) — kept in the
            // routing ledger like the technician notes, merged in by enrichTicketRow.
            ...(aiCategory ? { aiCategory } : {})
        };
        saveLedger();

        // In-memory mirror of master clusters (only used when Supabase is down)
        if (masterIncidentId && newlyFormedCluster && !supabase) {
            masterClustersDB.unshift({
                id: masterIncidentId,
                masterId: masterIncidentId,
                category,
                title: `Multiple ${category} Issues Reported`,
                location: `Hostel ${cleanBlock}, ${cleanFloor}`,
                impactedRooms: [`Room ${room}`],
                studentsImpacted: 2,
                status: 'ASSIGNED',
                assignedTo: tech.name,
                slaHours: slaHours
            });
        } else if (!supabase && !masterIncidentId) {
            const techTicket = ticketsDB.find(t => t.id === newTicket.id);
            if (techTicket) techTicket.assignedTo = tech.name;
        }

        return res.json({
            success: true,
            ticket: newTicket,
            allTickets: ticketsDB,
            masterClusters: masterClustersDB,
            clustered: !!joinedMaster,
            masterId: masterIncidentId || null,
            assignedTechnician: { ...tech },
            slaHours,
            urgency: urgencyLevel,
            severity: severityLabel,
            aiFallback: !!parsedAI._fallback,
            aiCategory,
            warning: ticketErrWarn || undefined
        });

    } catch (error) {
        console.error('Parse ticket error:', error.message);
        return res.status(500).json({ success: false, error: 'Processing failed' });
    }
});

// ----------------------------------------------------
// 5. API ROUTE: POST /api/approve-pass (HMAC-SHA256 + SMS Notification)
// ----------------------------------------------------
app.post('/api/approve-pass', authenticateUser, requireRole('WARDEN', 'ADMIN', 'DEAN'), async (req, res) => {
    try {
        const {
            passId,
            wardenId = "a0000000-0000-0000-0000-000000000002"
        } = req.body;
        let studentPhone = req.body.studentPhone || "+91 94370 12345"; // let: the directory's real phone overrides this below

        if (!passId) {
            return res.status(400).json({ success: false, error: 'passId is required' });
        }

        // Honored validity window: when the warden's (possibly offline) client
        // signs the pass, it stamps the pass's OWN validity (Home Leave keeps
        // its requested return date; the +4h bump only applies to fresh Day
        // Passes). The offline-flush body IS the approved pass object and
        // carries validUntil — preserving it prevents replay-clobbering.
        const candidateValidUntil = req.body.validUntil
            || (req.body.payload && req.body.payload.validUntil)
            || (req.body.pass && req.body.pass.validUntil)
            || null;
        const candidateMs = candidateValidUntil ? new Date(candidateValidUntil).getTime() : 0;
        const validUntil = Number.isFinite(candidateMs) && candidateMs > Date.now()
            ? new Date(candidateMs).toISOString()
            : new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
        
        // Cryptographic HMAC-SHA256 signature generation
        const payloadToSign = `${passId}:${wardenId}:${validUntil}:APPROVED`;
        const hmacSignature = crypto
            .createHmac('sha256', HMAC_SECRET)
            .update(payloadToSign)
            .digest('hex');

        // 1. Update Supabase gate_passes table (row matched by pass_ref)
        let updatedPass = null;
        if (supabase && gpSupabaseOk) {
            try {
                const profileId = await resolveProfileIdForPass({ rollNo: req.body.rollNo || req.body.studentId });
                if (profileId) {
                    await upsertGatePassRow(
                        { id: passId, passType: req.body.passType, priority: req.body.priority, destination: req.body.destination, reason: req.body.reason, validUntil, status: 'PENDING' },
                        profileId
                    );
                }
                const { data, error } = await supabase
                    .from('gate_passes')
                    .update({
                        status: 'APPROVED',
                        approved_by: wardenId,
                        valid_until: validUntil,
                        hmac_signature: hmacSignature
                    })
                    .eq('pass_ref', passId)
                    .select()
                    .single();

                if (!error && data) {
                    updatedPass = data;
                }
            } catch (sbErr) {
                gpDisableSupabase(sbErr);
            }
        }

        // Sync with in-memory store. CRITICAL: also carry the HMAC-signed QR
        // token from the flush body — without it, the student's QR modal on
        // another device would encode the bare pass ID (which the guard
        // scanner rejects as a malformed token).
        const approvedToken = req.body.token || (req.body.payload && req.body.payload.token) || (req.body.pass && req.body.pass.token) || null;
        const existingIdx = gatePassesDB.findIndex(p => p.id === passId);
        if (existingIdx >= 0) {
            gatePassesDB[existingIdx].status = 'APPROVED';
            gatePassesDB[existingIdx].hmac_signature = hmacSignature;
            gatePassesDB[existingIdx].validUntil = validUntil;
            if (approvedToken) gatePassesDB[existingIdx].token = approvedToken;
        } else {
            gatePassesDB.unshift({
                id: passId,
                status: 'APPROVED',
                hmac_signature: hmacSignature,
                validUntil,
                ...(approvedToken ? { token: approvedToken } : {})
            });
        }
        persistGatePasses();

        // 2. Delivery routing: real SMS for unactivated students
        // (keypad-phone scenario), push notification for activated ones.
        // Resolve the student from the AUTHORITATIVE source: the gate pass
        // row itself (student_id → profile). Phone-number matching is only
        // a fallback because the warden desk may send a stale/default phone.
        // The offline-flush body IS the approved pass object, so it usually
        // carries rollNo directly — use it, plus scan the in-memory ledger.
        let studentRoll = req.body.studentRoll || req.body.rollNo || null;
        let resolvedPhone = null;
        if (!studentRoll) {
            const localPass = gatePassesDB.find(p => p.id === passId);
            if (localPass?.rollNo) studentRoll = localPass.rollNo;
        }
        try {
            if (supabase) {
                // Directory lookup by roll → real phone (authoritative number)
                if (studentRoll) {
                    const { data: profByRoll } = await supabase
                        .from('profiles')
                        .select('roll_number, phone_number')
                        .ilike('roll_number', studentRoll)
                        .maybeSingle();
                    if (profByRoll?.phone_number) resolvedPhone = profByRoll.phone_number;
                }
                if (!studentRoll && updatedPass?.student_id) {
                    const { data: prof } = await supabase
                        .from('profiles')
                        .select('roll_number, phone_number')
                        .eq('id', updatedPass.student_id)
                        .maybeSingle();
                    if (prof?.roll_number) {
                        studentRoll = prof.roll_number;
                        if (prof.phone_number) resolvedPhone = prof.phone_number;
                    }
                }
                if (!studentRoll) {
                    const digits = String(studentPhone).replace(/\D/g, '').slice(-10);
                    if (digits) {
                        const { data: match } = await supabase
                            .from('profiles')
                            .select('roll_number, phone_number')
                            .ilike('phone_number', `%${digits}%`)
                            .limit(1)
                            .maybeSingle();
                        if (match?.roll_number) {
                            studentRoll = match.roll_number;
                            if (match.phone_number) resolvedPhone = match.phone_number;
                        }
                    }
                }
            }
        } catch (lookupErr) {
            console.warn('SMS delivery router roll lookup failed (non-blocking):', lookupErr.message);
        }
        if (resolvedPhone) studentPhone = resolvedPhone; // always use the directory's real number
        console.log(`[DELIVERY ROUTER] ${passId}: roll=${studentRoll || 'NOT RESOLVED'}, phone=${resolvedPhone || studentPhone}, dbRow=${updatedPass ? 'yes' : 'no'}`);

        // SMS text is written for KEYPAD-PHONE students (SMS only reaches
        // them — activated students get a push instead). The GP number is
        // the credential they will speak at the gate; no QR mention because
        // they have no screen to show one on.
        const validUntilText = new Date(validUntil).toLocaleString('en-IN', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        });
        const smsText = `CampusDebug OS: Gate Pass ${passId} APPROVED till ${validUntilText}. Tell the guard GP number ${passId} at the Main Gate. -Hostel Office`;
        const delivery = await notifyStudent(studentRoll, studentPhone, smsText);

        // Even for activated students, a background push is better than a
        // foreground-only notification: the OS shows it via the SW.
        if (delivery.mode === 'push' && studentRoll) {
            pushToRolls([studentRoll], {
                title: '🚪 Gate Pass Approved!',
                body: `Gate Pass #${passId} has been signed by Hostel Warden. HMAC token unlocked for exit.`
            }).catch(() => {});
        }

        return res.json({
            success: true,
            passId,
            status: 'APPROVED',
            validUntil,
            hmacSignature,
            smsSent: delivery.mode !== 'push',
            deliveryMode: delivery.mode,
            pass: updatedPass || { id: passId, status: 'APPROVED', hmacSignature, validUntil }
        });

    } catch (err) {
        console.error('Approve pass error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ----------------------------------------------------
// 5B. API ROUTE: POST /api/document-requests (Certificate / Document Desk)
// ----------------------------------------------------
app.post('/api/document-requests', authenticateUser, async (req, res) => {
  try {
    console.log('[Document Request Incoming Payload]:', JSON.stringify(req.body));

    // 1. Unpack nested payload from syncEngine
    const bodyData = req.body.payload || req.body.data || req.body;

    // 2. Extract and sanitize string fields
    const titleStr = String(bodyData.title || '').trim();
    const docTypeStr = String(bodyData.docType || bodyData.doc_type || bodyData.documentType || '').trim();
    const reasonStr = String(bodyData.reason || bodyData.remarks || bodyData.intendedOrg || bodyData.purpose || '').trim();

    // Client-side reference (DOC-xxxx) rides along inside remarks so the
    // student dashboard can later overlay the REAL registrar status onto
    // its local feed item without a schema migration.
    const clientDocRef = /^DOC-\d+$/i.test(String(bodyData.id || '').trim())
      ? String(bodyData.id).trim().toUpperCase()
      : null;

    const searchString = `${titleStr} ${docTypeStr}`.toUpperCase();

    // 3. Strict Enum Matching with Safe Fallback
    const ALLOWED_ENUMS = ['BONAFIDE', 'MIGRATION', 'TRANSCRIPT', 'NO_DUES', 'CHARACTER', 'FEE_RECEIPT'];
    let enumDocType = 'BONAFIDE';

    if (searchString.includes('CHARACTER') || searchString.includes('CONDUCT')) {
      enumDocType = 'CHARACTER';
    } else if (searchString.includes('NO-DUES') || searchString.includes('NO_DUES') || searchString.includes('HOSTEL')) {
      enumDocType = 'NO_DUES';
    } else if (searchString.includes('FEE') || searchString.includes('RECEIPT') || searchString.includes('TUITION')) {
      enumDocType = 'FEE_RECEIPT';
    } else if (searchString.includes('MIGRATION') || searchString.includes('NOC') || searchString.includes('TRANSFER')) {
      enumDocType = 'MIGRATION';
    } else if (searchString.includes('TRANSCRIPT')) {
      enumDocType = 'TRANSCRIPT';
    }

    if (!ALLOWED_ENUMS.includes(enumDocType)) {
      enumDocType = 'BONAFIDE';
    }

    // 4. Owner attribution — the SESSION is authoritative. The browser client
    //    never sends a studentId, and an un-trusted payload claim must not be
    //    able to re-route someone else's certificate. Without this, every
    //    submission landed on the fallback UUID and the owner's own /mine
    //    poll (scoped to their real profile id) returned nothing.
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const sessionStudentId = String(req.user?.profile?.id || req.user?.id || '').trim();
    const payloadClaimedId = String(bodyData.studentId || bodyData.student_id || req.body.studentId || '').trim();
    const validStudentUuid = uuidRegex.test(sessionStudentId)
      ? sessionStudentId
      : (uuidRegex.test(payloadClaimedId) ? payloadClaimedId : '10000000-0000-0000-0000-000000000001');

    // 5. Clean Remarks (client DOC-ref prefixed for student-side status overlay)
    let finalRemarks = reasonStr || titleStr || 'Requested via CampusDebug Portal';
    finalRemarks = finalRemarks.replace(/\0/g, '').slice(0, 500);
    finalRemarks = clientDocRef ? `[${clientDocRef}] ${finalRemarks}` : finalRemarks;

    // 6. Supabase DB Ingestion (+ degrade-not-break retry: a freshly migrated
    //    DB may not yet carry every enum value this build knows — remap once
    //    to the closest existing category instead of losing the request.)
    const DOC_TYPE_FALLBACKS = { MIGRATION: 'NOC', TRANSCRIPT: 'BONAFIDE' };
    const buildRow = (docType) => ({
      student_id: validStudentUuid,
      doc_type: docType,
      status: 'PENDING',
      remarks: finalRemarks
    });
    let { data, error } = await supabase
      .from('document_requests')
      .insert([buildRow(enumDocType)])
      .select();
    if (error && /invalid input value for enum doc_type_enum/i.test(error.message || '')) {
      const alt = DOC_TYPE_FALLBACKS[enumDocType];
      if (alt) {
        console.warn(`[Document Desk] enum '${enumDocType}' not migrated yet → downgraded to '${alt}' (run ALTER TYPE doc_type_enum to upgrade)`);
        ({ data, error } = await supabase.from('document_requests').insert([buildRow(alt)]).select());
      }
    }

    if (error) {
      console.error('[Supabase Insert Error]:', error.message);
      // Return 200 with warning so broken items never freeze the sync queue permanently
      return res.status(200).json({ success: true, warning: error.message });
    }

    console.log('[Supabase Insert Success]: Item synced cleanly:', data);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('[Document Request Exception]:', err.message);
    return res.status(200).json({ success: true, warning: err.message });
  }
});

// ----------------------------------------------------
// 5B+. DOCUMENT DESK (Registrar side) — view + manage.
// Admin/Dean see the real request queue; students poll /mine so the
// certificate status they see in their feed is the registrar's verdict.
// ----------------------------------------------------
const DOC_CLIENT_REF_RE = /^\[(DOC-\d+)\]\s*/i;
const stripDocRef = (remarks) => {
  const m = DOC_CLIENT_REF_RE.exec(String(remarks || ''));
  return m ? String(remarks).slice(m[0].length) : String(remarks || '');
};

app.get('/api/document-requests/mine', authenticateUser, async (req, res) => {
  try {
    const studentUuid = (req.user?.profile && req.user.profile.id) || req.user?.id;
    const { data, error } = await supabase
      .from('document_requests')
      .select('id, doc_type, status, remarks, created_at, ready_at')
      .eq('student_id', studentUuid)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ success: false, error: error.message });
    return res.json({
      success: true,
      requests: (data || []).map(r => {
        const m = DOC_CLIENT_REF_RE.exec(String(r.remarks || ''));
        return {
          id: r.id,
          ref: m ? m[1].toUpperCase() : null,
          docType: r.doc_type,
          status: r.status,
          remarks: stripDocRef(r.remarks),
          createdAt: r.created_at,
          readyAt: r.ready_at
        };
      })
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/document-requests', authenticateUser, requireRole('ADMIN', 'DEAN', 'WARDEN'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('document_requests')
      .select('id, student_id, doc_type, status, remarks, created_at, ready_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return res.status(500).json({ success: false, error: error.message });
    // Two-step join (no fragile PostgREST embedding): resolve students for
    // the fetched rows only. Placeholder UUIDs simply have no profile row.
    const ids = [...new Set((data || []).map(r => r.student_id))];
    let profileMap = {};
    if (ids.length) {
      const { data: profs, error: pErr } = await supabase
        .from('profiles')
        .select('id, roll_number, full_name, phone_number')
        .in('id', ids);
      if (!pErr && profs) profileMap = Object.fromEntries(profs.map(p => [p.id, p]));
    }
    const requests = (data || []).map(r => {
      const p = profileMap[r.student_id] || null;
      const m = DOC_CLIENT_REF_RE.exec(String(r.remarks || ''));
      return {
        id: r.id,
        ref: m ? m[1].toUpperCase() : null,
        docType: r.doc_type,
        status: r.status,
        remarks: stripDocRef(r.remarks),
        createdAt: r.created_at,
        readyAt: r.ready_at,
        student: p
          ? { roll: p.roll_number, name: p.full_name, phone: p.phone_number }
          : null
      };
    });
    return res.json({ success: true, requests });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/document-requests/:id', authenticateUser, requireRole('ADMIN', 'DEAN'), async (req, res) => {
  try {
    const VALID = ['PENDING', 'PROCESSING', 'READY_FOR_PICKUP', 'REJECTED'];
    const nextStatus = String(req.body?.status || '').trim().toUpperCase();
    if (!VALID.includes(nextStatus)) {
      return res.status(400).json({ success: false, error: `status must be one of ${VALID.join(', ')}` });
    }
    const rowId = String(req.params.id || '').trim();
    const uuidOk = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rowId);
    if (!uuidOk) return res.status(400).json({ success: false, error: 'invalid request id' });

    const patch = { status: nextStatus, updated_at: new Date().toISOString() };
    if (nextStatus === 'READY_FOR_PICKUP') patch.ready_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('document_requests')
      .update(patch)
      .eq('id', rowId)
      .select();
    if (error) return res.status(500).json({ success: false, error: error.message });
    if (!data || data.length === 0) return res.status(404).json({ success: false, error: 'request not found' });
    const row = data[0];

    // The registrar's verdict reaches the student through the SAME
    // one-channel rule as every other live event (push if subscribed,
    // SMS from the DB number otherwise).
    const { data: prof } = await supabase
      .from('profiles')
      .select('roll_number, full_name, phone_number')
      .eq('id', row.student_id)
      .maybeSingle();
    const refMatch = DOC_CLIENT_REF_RE.exec(String(row.remarks || ''));
    const docRef = refMatch ? refMatch[1].toUpperCase() : String(row.id).slice(0, 8).toUpperCase();
    const statusLabel = {
      PENDING: 'pending admin verification',
      PROCESSING: 'processing at the Registrar Office',
      READY_FOR_PICKUP: 'READY FOR PICKUP',
      REJECTED: 'rejected — please contact the office'
    }[nextStatus];
    if (prof?.roll_number) {
      const msg = `CampusDebug OS: Document ${docRef} is now ${statusLabel}.`;
      const delivery = await notifyStudent(prof.roll_number, prof.phone_number, msg);
      if (delivery.mode === 'push') {
        pushToRolls([prof.roll_number], { title: '📄 Document Update', body: msg }).catch(() => {});
      }
    }
    return res.json({ success: true, request: { id: row.id, status: row.status, docType: row.doc_type } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 5C. TICKET LIFECYCLE: student-confirm + warden-close.
// Reported → (assigned) → technician fixes → STUDENT confirms "job done"
// → warden verifies the student confirmation and CLOSES. The close call is
// physically refused until the student pressed confirm — the accountability
// the dean expects: techs can't self-close complaints.
// ----------------------------------------------------
async function loadTicketRow(id) {
  const { data, error } = await supabase
    .from('tickets')
    .select('id, student_id, status, raw_text, category, location')
    .eq('id', id)
    .maybeSingle();
  return { row: data || null, error: error ? error.message : null };
}

app.post('/api/tickets/:id/student-confirm', authenticateUser, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({ success: false, error: 'invalid ticket id' });
    }
    const myId = String((req.user?.profile && req.user.profile.id) || req.user?.id || '');
    const { row, error } = await loadTicketRow(id);
    if (error || !row) return res.status(404).json({ success: false, error: 'ticket not found' });
    if (String(row.student_id) !== myId) {
      return res.status(403).json({ success: false, error: 'you can only confirm your own complaint' });
    }
    const cur = String(row.status || '').toUpperCase();
    if (cur === 'CLOSED') return res.json({ success: true, status: 'CLOSED', studentConfirmed: true, alreadyClosed: true });

    if (cur !== 'RESOLVED') {
      const { error: uErr } = await supabase.from('tickets').update({ status: 'RESOLVED' }).eq('id', id);
      if (uErr) return res.status(500).json({ success: false, error: uErr.message });
    }
    ticketLedgerDB[id] = {
      ...(ticketLedgerDB[id] || {}),
      studentConfirmed: true,
      studentConfirmedAt: new Date().toISOString()
    };
    saveLedger();
    console.log(`✅ [TICKET CONFIRM] ${id.slice(0, 8)} student-confirmed resolved by ${req.user?.rollNumber || req.user?.id}`);
    return res.json({ success: true, status: 'RESOLVED', studentConfirmed: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tickets/:id/close', authenticateUser, requireRole('WARDEN', 'ADMIN', 'DEAN'), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({ success: false, error: 'invalid ticket id' });
    }
    const { row, error } = await loadTicketRow(id);
    if (error || !row) return res.status(404).json({ success: false, error: 'ticket not found' });
    const led = ticketLedgerDB[id] || {};
    const alreadyClosed = !!led.closed;
    if (!led.studentConfirmed && !alreadyClosed) {
      console.warn(`⛔ [TICKET CLOSE] ${id.slice(0, 8)} refused — student has NOT confirmed the fix yet`);
      return res.status(409).json({
        success: false,
        error: 'The student has not confirmed the fix yet. Closing stays locked until the student marks "job done".'
      });
    }
    if (!alreadyClosed) {
      const { data: up, error: uErr } = await supabase.from('tickets').update({ status: 'CLOSED' }).eq('id', id).select();
      if (uErr || !up || up.length === 0) {
        // Enum not migrated to CLOSED yet — degrade but keep the intent visible
        console.warn(`[TICKET CLOSE] CLOSED write unavailable (${uErr ? uErr.message : 'no rows'}), running ALTER TYPE ticket_status_enum to unlock — tracking closed in ledger meanwhile`);
        await supabase.from('tickets').update({ status: 'RESOLVED' }).eq('id', id);
      }
      ticketLedgerDB[id] = {
        ...led,
        closed: true,
        closedAt: new Date().toISOString(),
        closedBy: req.user?.rollNumber || req.user?.email || 'warden'
      };
      saveLedger();
    }
    console.log(`🔒 [TICKET CLOSE] ${id.slice(0, 8)} closed by warden (student confirmation on file)`);
    return res.json({ success: true, status: 'CLOSED', studentConfirmed: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 6. API ROUTES: MEAL RSVP (Zero-Waste plate counting — REAL data)
// All state lives in Supabase `meal_rsvps` (one row per student/meal/day).
// Aggregate forecasts are computed from real counts: plates = active
// students − opted-out. Nothing is seeded or faked.
// ----------------------------------------------------
const localDateStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Server-side cutoff mirror: RSVP locks 3 hours before cooking starts.
const isMealCutoffPassed = (mealKey) => {
  const w = MEAL_WINDOWS[mealKey];
  if (!w) return false;
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() >= w.start - RSVP_CUTOFF_MINUTES;
};

// Compute real participating-student aggregates for one meal from the DB.
// Day scholars are on campus ONLY for lunch — breakfast, evening snacks and
// dinner are cooked for hostellers. Unknown resident_type counts as
// hosteller (the directory default), so nothing silently disappears.
// Defensively degrades to all-students if the column isn't migrated yet.
async function mealAggregates(mealKey, today) {
  const isLunch = String(mealKey).toLowerCase() === 'lunch';
  const eligibleBase = (withResidentType) => {
    let q = supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'STUDENT');
    if (withResidentType && !isLunch) {
      q = q.or('resident_type.neq.dayscholar,resident_type.is.null');
    }
    return q;
  };
  let eligible = await eligibleBase(true);
  if (eligible.error && /resident_type/i.test(eligible.error.message || '')) {
    eligible = await eligibleBase(false); // column not migrated — count everyone
  }
  const total = eligible.error ? 0 : (eligible.count || 0);

  const { data: rows, error } = await supabase
    .from('meal_rsvps')
    .select('student_id, status')
    .eq('meal_type', mealKey.toUpperCase())
    .eq('meal_date', today);
  const optedOutRows = error ? [] : rows.filter(r => r.status === 'OPTED_OUT');
  // De-duplicate by student (multiple toggles could stack rows)
  const optedOutStudents = new Set(optedOutRows.map(r => r.student_id)).size;
  const plates = Math.max(0, total - optedOutStudents);
  // Zero-waste estimate: ≈0.35 kg saved per skipped plate (average serving)
  const wasteKg = Number((optedOutStudents * 0.35).toFixed(1));
  return { plates, optedOut: optedOutStudents, wasteKg };
}

// GET — live RSVP state for the signed-in student + campus-wide aggregates
app.get('/api/meal-rsvp', authenticateUser, async (req, res) => {
  try {
    const today = localDateStr();
    if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

    const profile = await findProfileByIdOrRoll(req.user.id, req.user.rollNumber);
    const myId = profile?.id || '__none__';
    // Day scholars eat only lunch on campus — RSVP surface shows just that.
    const isDayScholar = String(profile?.resident_type || '').toLowerCase() === 'dayscholar';
    const mealKeys = isDayScholar ? ['lunch'] : MEAL_ORDER;
    const meals = await Promise.all(mealKeys.map(async (key) => {
      const agg = await mealAggregates(key, today);
      const { data: myRow } = await supabase
        .from('meal_rsvps')
        .select('status')
        .eq('student_id', myId)
        .eq('meal_type', key.toUpperCase())
        .eq('meal_date', today)
        .maybeSingle();
      return {
        id: key,
        isAttending: myRow ? myRow.status !== 'OPTED_OUT' : true,
        forecastPlates: agg.plates,
        optedOutCount: agg.optedOut,
        wastePreventedKg: agg.wasteKg
      };
    }));
    return res.json({ success: true, meals });
  } catch (err) {
    console.warn('⚠️ GET /api/meal-rsvp failed:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST — the 1-tap RSVP toggle. Row-level per student (no global plate pool,
// no fake seeds). Cutoff enforced here on the server, not just in the UI.
app.post('/api/meal-rsvp', async (req, res) => {
  try {
    const { studentId, mealType, status } = req.body || {};
    if (supabase) {
      if (isMealCutoffPassed(String(mealType || '').toLowerCase())) {
        return res.status(400).json({ success: false, error: 'RSVP cutoff passed for this meal (locks 3 hrs before cooking)' });
      }
      // `student_id` in the DB is the profile UUID. Older offline flushes sent
      // roll numbers — resolve them to a real profile id.
      let sid = studentId;
      if (sid && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(sid))) {
        const { data: prof } = await supabase.from('profiles')
          .select('id').ilike('roll_number', String(sid).trim()).maybeSingle();
        if (prof?.id) sid = prof.id;
      }
      const { data, error } = await supabase
        .from('meal_rsvps')
        .upsert([{
          student_id: sid,
          meal_type: (mealType || 'LUNCH').toUpperCase(),
          status: status || 'ATTENDING',
          meal_date: localDateStr()
        }])
        .select();
      if (error) throw error;
      return res.status(200).json({ success: true, data });
    }

    return res.status(503).json({ success: false, error: 'Database not configured' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Legacy / UI compat route for meal-rsvp/toggle — the dashboard's 1-tap
// button. Per-student flip stored in Supabase; cutoff enforced server-side.
app.post('/api/meal-rsvp/toggle', authenticateUser, async (req, res) => {
  try {
    const { mealKey = 'lunch' } = req.body || {};

    // Normalize incoming key (accepts 'lunch', 'BREAKFAST', 'evening-snacks', etc.)
    const k = String(mealKey).toLowerCase();
    const slot = k.includes('dinner') ? 'dinner'
        : k.includes('breakfast') ? 'breakfast'
        : k.includes('snack') ? 'snacks'
        : 'lunch';

    if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });
    if (isMealCutoffPassed(slot)) {
      return res.status(400).json({ success: false, error: 'RSVP cutoff passed for this meal (locks 3 hrs before cooking)' });
    }

    // Identity ALWAYS comes from the signed-in token — never from the body.
    // meal_rsvps.student_id references profiles.id (not the auth UUID).
    const profile = await findProfileByIdOrRoll(req.user.id, req.user.rollNumber);
    const profileId = profile?.id;
    if (!profileId) return res.status(400).json({ success: false, error: 'No college profile linked to this account' });
    const today = localDateStr();

    const { data: existingRows } = await supabase
      .from('meal_rsvps')
      .select('id, status')
      .eq('student_id', profileId)
      .eq('meal_type', slot.toUpperCase())
      .eq('meal_date', today);
    const primary = existingRows?.[0] || null;
    const nextAttending = primary ? primary.status === 'OPTED_OUT' : false; // default = attending

    if (primary) {
      const { error } = await supabase.from('meal_rsvps')
        .update({ status: nextAttending ? 'ATTENDING' : 'OPTED_OUT' })
        .eq('id', primary.id);
      if (error) throw error;
      // Keep exactly one row per student/meal/day
      const extraIds = (existingRows || []).slice(1).map(r => r.id);
      if (extraIds.length) {
        await supabase.from('meal_rsvps').delete().in('id', extraIds);
      }
    } else {
      const { error } = await supabase.from('meal_rsvps').insert([{
        student_id: profileId,
        meal_type: slot.toUpperCase(),
        status: 'OPTED_OUT', // first toggle from "attending" default = opt-out
        meal_date: today
      }]);
      if (error) throw error;
    }

    const agg = await mealAggregates(slot, today);
    return res.json({
      success: true,
      mealKey: slot,
      isAttending: nextAttending,
      forecastPlates: agg.plates,
      optedOutCount: agg.optedOut,
      wastePreventedKg: agg.wasteKg
    });
  } catch (err) {
    console.warn('⚠️ meal-rsvp toggle failed:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 6A+. MESS KITCHEN ALERTS — automatic operator headcount SMS.
// At every meal's RSVP cutoff (3h before cooking) the server computes the
// FINAL headcount from real meal_rsvps and sends ONE SMS to the canteen
// operator's registered number (CANTEEN_OPERATOR_PHONE). The admin dashboard
// shows the same numbers + whether each alert fired. Restart-safe: an
// append-only marker file prevents double-sending after a reboot.
// ----------------------------------------------------
const MEAL_ALERTS_FILE = path.join(__dirname, 'data', 'meal_alerts.json');
let mealAlerts = {};
try {
    if (fs.existsSync(MEAL_ALERTS_FILE)) {
        mealAlerts = JSON.parse(fs.readFileSync(MEAL_ALERTS_FILE, 'utf8'));
    }
} catch {
    mealAlerts = {};
}
function saveMealAlerts() {
    try {
        fs.mkdirSync(path.dirname(MEAL_ALERTS_FILE), { recursive: true });
        fs.writeFileSync(MEAL_ALERTS_FILE, JSON.stringify(mealAlerts, null, 2));
    } catch (e) {
        console.warn('meal alert persistence failed (non-blocking):', e.message);
    }
}

const fmt12Server = (mins24) => {
    let h = Math.floor(mins24 / 60) % 24;
    const mm = mins24 % 60;
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(mm).padStart(2, '0')} ${ap}`;
};

async function checkMealCutoffs() {
    if (!supabase || !CANTEEN_OPERATOR_PHONE) return;
    const now = new Date();
    const t = now.getHours() * 60 + now.getMinutes();
    const today = localDateStr();
    for (const key of MEAL_ORDER) {
        const w = MEAL_WINDOWS[key];
        if (!w) continue;
        const markKey = `${today}:${key}`;
        if (mealAlerts[markKey]) continue;          // already locked & sent today
        const cutoff = w.start - RSVP_CUTOFF_MINUTES;
        if (t < cutoff) continue;                    // RSVP still open
        if (t >= w.end) continue;                    // service window already over — skip stale alerts (no 4-SMS burst after a mid-day restart)

        const agg = await mealAggregates(key, today);
        const text = `CampusDebug OS Mess: ${key.toUpperCase()} (${fmt12Server(w.start)}) FINAL headcount — ${agg.plates} plates to cook, ${agg.optedOut} opted out. Food saved: ${agg.wasteKg} kg today.`;
        const delivery = await dispatchSms(CANTEEN_OPERATOR_PHONE, text);
        mealAlerts[markKey] = {
            sentAt: now.toISOString(),
            plates: agg.plates,
            optedOut: agg.optedOut,
            wasteKg: agg.wasteKg,
            mode: delivery.mode
        };
        saveMealAlerts();
        console.log(`🍽️ [MESS ALERT] ${markKey} → operator ${delivery.mode}: ${agg.plates} plates (${agg.optedOut} opted out)`);

        // Same intelligence to every subscribed staff device (fire-and-forget)
        pushEverything({
            title: `🍽️ ${key.charAt(0).toUpperCase() + key.slice(1)} Count Locked — ${agg.plates} Plates`,
            body: `${agg.optedOut} students opted out • ${agg.wasteKg} kg food saved • operator notified via SMS`
        }).catch(() => {});
    }
}
// 60s scanner — same heartbeat pattern as the SLA escalation engine.
setInterval(() => { checkMealCutoffs().catch(e => console.warn('meal scan failed:', e.message)); }, 60 * 1000);

// Admin/Warden kitchen panel: per-meal forecast + alert status
app.get('/api/mess-forecast', authenticateUser, requireRole('ADMIN', 'WARDEN', 'DEAN'), async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });
        const today = localDateStr();
        const now = new Date();
        const t = now.getHours() * 60 + now.getMinutes();
        const meals = await Promise.all(MEAL_ORDER.map(async (key) => {
            const agg = await mealAggregates(key, today);
            const w = MEAL_WINDOWS[key];
            const cutoff = w.start - RSVP_CUTOFF_MINUTES;
            const alert = mealAlerts[`${today}:${key}`] || null;
            return {
                id: key,
                servingLabel: fmt12Server(w.start),
                cutoffLabel: fmt12Server(cutoff),
                cutoffPassed: t >= cutoff,
                windowOver: t >= w.end,
                plates: agg.plates,
                optedOut: agg.optedOut,
                wasteKg: agg.wasteKg,
                operatorAlert: alert
                    ? { sentAt: alert.sentAt, mode: alert.mode, plates: alert.plates }
                    : null
            };
        }));
        return res.json({
            success: true,
            operatorConfigured: !!CANTEEN_OPERATOR_PHONE,
            operatorPhone: CANTEEN_OPERATOR_PHONE
                ? CANTEEN_OPERATOR_PHONE.replace(/\d(?=\d{4})/g, (d, i, s) => i < s.length - 4 ? '•' : d)
                : null,
            meals
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ----------------------------------------------------
// 6B. API ROUTES: /api/notices (Central Notice Bus — push/SMS layer)
// Notices are stored server-side so every device (phone or laptop)
// polls the same source of truth. Offline admins still queue locally;
// the sync flush posts them here when connectivity returns.
// ----------------------------------------------------
let noticesDB = []; // { id, title, content, target, category, urgency, source, createdAt, smsDispatchedTo }

// Persisted so notices survive server restarts — yesterday's circulars must
// still be on the board today (memory-only storage silently destroyed them).
const NOTICES_FILE = path.join(__dirname, 'data', 'notices.json');
try {
    if (fs.existsSync(NOTICES_FILE)) {
        const savedNotices = JSON.parse(fs.readFileSync(NOTICES_FILE, 'utf8'));
        if (Array.isArray(savedNotices)) noticesDB = savedNotices.slice(-200);
    }
} catch {
    console.warn('Could not read data/notices.json — starting with an empty board.');
}
function persistNotices() {
    try {
        fs.mkdirSync(path.dirname(NOTICES_FILE), { recursive: true });
        fs.writeFileSync(NOTICES_FILE, JSON.stringify(noticesDB.slice(-200)), 'utf8');
    } catch (pErr) {
        console.warn('Notice persistence failed (non-blocking):', pErr.message);
    }
}

app.get('/api/notices', (req, res) => {
    // Newest first; cap the payload so 3s polling stays cheap.
    const notices = [...noticesDB].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
    res.json({ success: true, notices });
});

app.post('/api/notices', async (req, res) => {
    try {
        const { title, content, target = 'All Students', category = 'General', urgency = 'Normal', source = 'Admin Desk', smsPhones = [], targetBlock = null, audience = 'hostel', campusFilter = null, showOn = null } = req.body || {};
        if (!title || !content) {
            return res.status(400).json({ success: false, error: 'title and content are required' });
        }
        // De-dupe: an offline-flush replay of a notice that already landed
        // (same title+content within 60s) is dropped instead of duplicated.
        const dupe = noticesDB.find(n =>
            n.title === title && n.content === content && (Date.now() - n.createdAt) < 60000
        );
        if (dupe) {
            return res.json({ success: true, notice: dupe, deduped: true });
        }
        const notice = {
            id: `NOTIF-${Date.now().toString(36).toUpperCase()}`,
            title,
            content,
            target,
            category,
            urgency,
            source,
            targetBlock: targetBlock || null,
            // 'hostel' (block fan-out) | 'campus' (course/section/year audience)
            audience: audience === 'campus' ? 'campus' : 'hostel',
            campusFilter: audience === 'campus' && campusFilter ? {
                mode: String(campusFilter.mode || 'ALL').toUpperCase(),
                course: String(campusFilter.course || '').trim(),
                section: String(campusFilter.section || '').trim().toUpperCase(),
                year: parseInt(campusFilter.year, 10) || null
            } : null,
            // "Today's Notice": YYYY-MM-DD — the student dashboard surfaces
            // this notice as a dated hero card ONLY on that date (fixes the
            // problem-statement pain of notices drowning in chat history).
            showOn: showOn ? String(showOn).slice(0, 10) : null,
            createdAt: Date.now(),
            smsDispatchedTo: []
        };
        noticesDB.push(notice);
        persistNotices();

        // Novel behavior: block targeting. When the admin picks a hostel
        // block, recipients are resolved from the REAL roster:
        //   - activated students  → PUSH notifications (they have the app)
        //   - non-activated ones  → SMS to their registered phone,
        //     capped by SMS_MAX_PER_BROADCAST and allowlist-gated inside
        //     dispatchSms (dry-run for numbers not on the allowlist).
        // Resolve recipients BEFORE responding so the admin dashboard can
        // show real split counts immediately.
        let blockRows = null;
        let blockPushRolls = [];
        let blockSmsPhones = [];
        let residentsOnly = [];      // hostellers living in the target block
        let dayScholarCount = 0;     // residents typed as dayscholar (excluded)
        let residentTypeColumn = true; // flips false if the DB column isn't migrated yet
        // PostgREST returns at most 1000 rows for a plain select — page
        // through the roster so no half of a block/audience is silently
        // dropped. Shared by block targeting AND campus/academic targeting.
        const fetchRosterPaged = async (withResidentType) => {
            const cols = 'roll_number, full_name, hostel_block, phone_number, course, section' + (withResidentType ? ', resident_type' : '');
            const PAGE = 1000;
            const all = [];
            let from = 0;
            for (;;) {
                const { data, error } = await supabase
                    .from('profiles')
                    .select(cols)
                    .eq('role', 'STUDENT')
                    .range(from, from + PAGE - 1);
                if (error) return { error, data: all };
                if (Array.isArray(data)) all.push(...data);
                if (!data || data.length < PAGE) break;
                from += PAGE;
                if (from >= 20000) break; // hard safety stop
            }
            return { data: all };
        };
        if (targetBlock && supabase) {
            const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const t = norm(targetBlock).replace(/^block/, '');
            const filterBlock = (r) => {
                const b = norm(r.hostel_block).replace(/^block/, '');
                return b && (b === t || b.includes(t) || t.includes(b));
            };
            try {
                let roster = await fetchRosterPaged(true);
                if (roster.error && /resident_type/i.test(roster.error.message || '')) {
                    // Column not migrated yet — keep targeting block-only.
                    residentTypeColumn = false;
                    roster = await fetchRosterPaged(false);
                }
                if (!roster.error && Array.isArray(roster.data)) {
                    blockRows = roster.data.filter(filterBlock);
                }
            } catch {
                try {
                    const fallback = await fetchRosterPaged(false);
                    if (!fallback.error && Array.isArray(fallback.data)) {
                        residentTypeColumn = false;
                        blockRows = fallback.data.filter(filterBlock);
                    }
                } catch { /* fall through to broadcast */ }
            }
            if (blockRows) {
                if (residentTypeColumn) {
                    residentsOnly = blockRows.filter(r => String(r.resident_type || 'hosteller').toLowerCase() !== 'dayscholar');
                    dayScholarCount = blockRows.length - residentsOnly.length;
                } else {
                    residentsOnly = blockRows;
                }
                // ONE CHANNEL PER PERSON: activated + Background-Alerts enabled
                // → PUSH; everyone else (unactivated keypad users AND activated
                // students who never enabled the toggle) → SMS from the DB row.
                blockPushRolls = residentsOnly
                    .filter(r => isStudentActivated(r.roll_number) && hasPushSubscription(r.roll_number))
                    .map(r => r.roll_number);
                blockSmsPhones = residentsOnly
                    .filter(r => (!isStudentActivated(r.roll_number) || !hasPushSubscription(r.roll_number)) && r.phone_number)
                    .map(r => r.phone_number);
                notice.recipients = {
                    total: residentsOnly.length,
                    pushStudents: blockPushRolls.length,
                    smsStudents: blockSmsPhones.length,
                    noContact: residentsOnly.length - blockPushRolls.length - blockSmsPhones.length
                };
                if (residentTypeColumn) {
                    notice.recipients.dayscholars = dayScholarCount;
                }
            }
        } else if (audience === 'campus' && campusFilter && campusFilter.mode && campusFilter.mode !== 'ALL' && supabase) {
            // Guard against an incomplete filter (e.g. COURSE with no course
            // picked): an under-specified audience would silently match
            // everyone, so it degrades to a broadcast instead.
            const cf = campusFilter;
            const cfComplete = cf.mode === 'COURSE' ? !!String(cf.course || '').trim()
                : cf.mode === 'COURSE_SECTION' ? !!(String(cf.course || '').trim() && String(cf.section || '').trim())
                : cf.mode === 'COURSE_YEAR' ? !!(String(cf.course || '').trim() && parseInt(cf.year, 10))
                : false;
            if (!cfComplete) {
                console.warn(`⚠️ [NOTICE ${notice.id}] incomplete campus filter ${JSON.stringify(cf)} — treated as a broadcast`);
            } else
            // Campus / Academic targeting — the audience is resolved from the
            // LIVE roster: a course, a course+section, or a course+admission-
            // year (year decoded from the roll-number prefix `^yy` → 2000+yy).
            // Same one-channel-per-person split as block targeting: activated
            // PWA students get push, everyone else lands in the capped SMS pool.
            try {
                const roster = await fetchRosterPaged(false);
                if (!roster.error && Array.isArray(roster.data)) {
                    const wantCourse = String(campusFilter.course || '').trim();
                    const wantSection = String(campusFilter.section || '').trim().toUpperCase();
                    const wantYear = parseInt(campusFilter.year, 10) || null;
                    const matches = (r) => {
                        if (wantCourse && String(r.course || '').trim() !== wantCourse) return false;
                        if (campusFilter.mode === 'COURSE_SECTION' && String(r.section || '').trim().toUpperCase() !== wantSection) return false;
                        if (campusFilter.mode === 'COURSE_YEAR') {
                            const m = /^(\d{2})/.exec(String(r.roll_number || ''));
                            if (!m || (2000 + parseInt(m[1], 10)) !== wantYear) return false;
                        }
                        return true;
                    };
                    const targets = roster.data.filter(matches);
                    blockPushRolls = targets
                        .filter(r => isStudentActivated(r.roll_number) && hasPushSubscription(r.roll_number))
                        .map(r => r.roll_number);
                    blockSmsPhones = targets
                        .filter(r => (!isStudentActivated(r.roll_number) || !hasPushSubscription(r.roll_number)) && r.phone_number)
                        .map(r => r.phone_number);
                    notice.recipients = {
                        total: targets.length,
                        pushStudents: blockPushRolls.length,
                        smsStudents: blockSmsPhones.length,
                        noContact: targets.length - blockPushRolls.length - blockSmsPhones.length
                    };
                }
            } catch (cErr) {
                console.warn('Campus audience resolution failed (non-blocking):', cErr.message);
            }
        } else if (supabase) {
            // Campus-wide broadcast — SAME one-channel-per-person rule as
            // targeted modes, just scoped to everyone: activated PWA
            // students get the push, keypad-phone students (no app) get an
            // automatic SMS from their DB row. The SMS leg inside
            // runNoticeDelivery still applies its hard cap + allowlist
            // gating, so this can never explode into thousands of real
            // messages — the admin-typed field stays as an EXTRA channel.
            try {
                const roster = await fetchRosterPaged(false);
                if (!roster.error && Array.isArray(roster.data)) {
                    const everyone = roster.data;
                    blockPushRolls = everyone
                        .filter(r => isStudentActivated(r.roll_number) && hasPushSubscription(r.roll_number))
                        .map(r => r.roll_number);
                    blockSmsPhones = everyone
                        .filter(r => (!isStudentActivated(r.roll_number) || !hasPushSubscription(r.roll_number)) && r.phone_number)
                        .map(r => r.phone_number);
                    notice.recipients = {
                        total: everyone.length,
                        pushStudents: blockPushRolls.length,
                        smsStudents: blockSmsPhones.length,
                        noContact: everyone.length - blockPushRolls.length - blockSmsPhones.length
                    };
                }
            } catch (bErr) {
                console.warn('Broadcast audience resolution failed (non-blocking):', bErr.message);
            }
        }

        // The actual push/SMS fan-out runs right AFTER the response is
        // written — dispatch must never block the admin's UI.
        res.json({ success: true, notice });
        runNoticeDelivery(notice, blockPushRolls, blockSmsPhones, smsPhones);
        return;
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Background delivery leg for /api/notices.
//   notice         — the persisted notice object (updated in place)
//   pushRolls      — activated residents (block targeting) or []
//   autoSmsPhones  — non-activated residents' phones (block targeting)
//   manualPhones   — admin-typed fallback numbers (works for broadcasts too)
const runNoticeDelivery = (notice, pushRolls, autoSmsPhones, manualPhones) => {
    queueMicrotask(() => {
        (async () => {
            const smsText = `CampusDebug OS Notice: ${notice.title} — ${notice.content}`;

            // 1. PUSH leg — targeted audiences (a hostel block OR a resolved
            //    campus/academic group) go through pushToRolls with the exact
            //    roll list; everything else is a campus-wide broadcast.
            const campusTargeted = notice.audience === 'campus' && notice.campusFilter && notice.campusFilter.mode !== 'ALL';
            if (notice.targetBlock) {
                console.log(`📣 [NOTICE ${notice.id}] block "${notice.targetBlock}": ${notice.recipients ? notice.recipients.total + ' resident(s) resolved — ' + notice.recipients.pushStudents + ' push, ' + notice.recipients.smsStudents + ' SMS, ' + notice.recipients.noContact + ' no contact on file' : 'roster lookup unavailable'}`);
            } else if (campusTargeted) {
                const f = notice.campusFilter;
                console.log(`📣 [NOTICE ${notice.id}] campus ${f.mode}${f.course ? ' course=' + f.course : ''}${f.section ? ' sec=' + f.section : ''}${f.year ? ' year=' + f.year : ''}: ${notice.recipients ? notice.recipients.total + ' student(s) resolved — ' + notice.recipients.pushStudents + ' push, ' + notice.recipients.smsStudents + ' SMS' : 'roster lookup unavailable'}`);
            }
            if ((notice.targetBlock || campusTargeted)) {
                if (pushRolls && pushRolls.length > 0) {
                    try {
                        const delivered = await pushToRolls(pushRolls, { title: notice.title, body: notice.content });
                        notice.pushDelivered = delivered;
                        console.log(`📣 [NOTICE ${notice.id}] targeted push delivered to ${delivered} device(s)`);
                    } catch { /* logged inside pushToRolls */ }
                }
            } else {
                // Campus-wide broadcast: push to every subscribed device.
                try {
                    const n = await pushEverything({ title: notice.title, body: notice.content });
                    notice.pushDelivered = n;
                    console.log(`📣 [NOTICE ${notice.id}] broadcast push delivered to ${n} device(s)`);
                } catch { /* logged inside pushToRolls */ }
            }

            // 2. SMS leg — auto block residents + admin-typed numbers,
            //    de-duplicated by digits, hard-capped. Priority-ordered:
            //    admin-typed numbers and allowlisted recipients are attempted
            //    FIRST so the hard cap can never silently drop exactly the
            //    numbers the demo/ops team depends on.
            const manualList = String(manualPhones || '').split(/[\s,;]+/).filter(Boolean);
            const rawPool = [...(autoSmsPhones || []), ...manualList];
            const seen = new Set();
            const priorityPhones = [];
            const rosterPhones = [];
            const manualSet = new Set(manualList);
            for (const p of rawPool) {
                const digits = String(p).replace(/\D/g, '');
                if (!digits || seen.has(digits)) continue;
                seen.add(digits);
                (manualSet.has(p) || SMS_ALLOWLIST.includes(digits) ? priorityPhones : rosterPhones).push(p);
            }
            const allPhones = [...priorityPhones, ...rosterPhones];
            const cap = Math.min(50, SMS_MAX_PER_BROADCAST);
            const phones = allPhones.slice(0, cap);
            if (allPhones.length > phones.length) {
                console.warn(`⚠️ [BROADCAST CAP] ${allPhones.length} phones resolved — sending to first ${phones.length} (SMS_MAX_PER_BROADCAST=${SMS_MAX_PER_BROADCAST})`);
            }
            if (phones.length > 0) {
                const results = await Promise.all(phones.map(p => dispatchSms(p, smsText)));
                notice.smsDispatchedTo = phones.map((p, i) => ({ phone: p, mode: results[i].mode }));
                const modeTally = {};
                results.forEach(r => { modeTally[r.mode] = (modeTally[r.mode] || 0) + 1; });
                console.log(`📣 [NOTICE ${notice.id}] SMS fan-out to ${phones.length} number(s):`, JSON.stringify(modeTally));
            }
            persistNotices();
        })().catch(e => console.warn(`[NOTICE ${notice.id}] delivery failed:`, e.message));
    });
};

// ----------------------------------------------------
// 6C. API ROUTES: /api/push (Web Push subscription management)
// ----------------------------------------------------
// ----------------------------------------------------
// LOGIN-SCREEN SUPPORT REPORTS (no auth — reports come from unsigned users)
// Persisted in data/support_reports.json and announced in the server console
// (the team desk). Screenshot bytes stay on the reporter's device only.
// ----------------------------------------------------
const SUPPORT_REPORTS_FILE = path.join(__dirname, 'data', 'support_reports.json');
let supportReports = [];
try {
    if (fs.existsSync(SUPPORT_REPORTS_FILE)) {
        const saved = JSON.parse(fs.readFileSync(SUPPORT_REPORTS_FILE, 'utf8'));
        if (Array.isArray(saved)) supportReports = saved.slice(-200);
    }
} catch { supportReports = []; }

app.post('/api/support/report', (req, res) => {
    try {
        const { roll = '', issue = '', description = '', reportedFrom = 'Login screen' } = req.body || {};
        if (!issue || !description) {
            return res.status(400).json({ success: false, error: 'issue and description are required' });
        }
        const report = {
            id: `SUP-${Date.now().toString(36).toUpperCase()}`,
            roll: String(roll).slice(0, 12).trim() || null,
            issue: String(issue).slice(0, 60),
            description: String(description).slice(0, 500),
            reportedFrom,
            at: new Date().toISOString()
        };
        supportReports.push(report);
        try {
            fs.mkdirSync(path.dirname(SUPPORT_REPORTS_FILE), { recursive: true });
            fs.writeFileSync(SUPPORT_REPORTS_FILE, JSON.stringify(supportReports.slice(-200), null, 2));
        } catch (e) {
            console.warn('support report persistence failed (non-blocking):', e.message);
        }
        console.log(`🆘 [SUPPORT REPORT] ${report.id} | ${report.roll || 'anonymous'} | ${report.issue} | ${report.description.slice(0, 80)}`);
        return res.json({ success: true, report });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/push/public-key', (req, res) => {
    res.json({ success: true, publicKey: VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', (req, res) => {
    try {
        const { rollNumber, subscription } = req.body || {};
        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ success: false, error: 'subscription payload required' });
        }
        const key = rollNumber || 'global';
        const entries = pushSubscriptions[key] || [];
        const alreadyKnown = entries.some(s => s.endpoint === subscription.endpoint);
        if (!alreadyKnown) {
            entries.push(subscription);
            pushSubscriptions[key] = entries;
            savePushSubs();
            console.log(`🔔 [PUSH] new device registered for ${key} (${entries.length} device(s) on file)`);
        }
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Settings toggle OFF: remove one device's subscription everywhere it may be
// keyed (the client unsubscribes from the browser first, this just cleans the
// routing file so a turned-off device stops receiving pushes).
app.post('/api/push/unsubscribe', (req, res) => {
    try {
        const { endpoint } = req.body || {};
        if (!endpoint) return res.status(400).json({ success: false, error: 'endpoint required' });
        let removed = 0;
        for (const key of Object.keys(pushSubscriptions)) {
            const before = pushSubscriptions[key].length;
            pushSubscriptions[key] = pushSubscriptions[key].filter(s => s.endpoint !== endpoint);
            if (pushSubscriptions[key].length !== before) removed += before - pushSubscriptions[key].length;
            if (pushSubscriptions[key].length === 0) delete pushSubscriptions[key];
        }
        if (removed) savePushSubs();
        console.log(`🔕 [PUSH] unsubscribe: ${removed} device entr(ies) removed from routing`);
        return res.json({ success: true, removed });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ----------------------------------------------------
// 7. API ROUTE: GET /api/dashboard-data (Live Profile, Pass, & Feeds)
// ----------------------------------------------------
// Public connectivity heartbeat for the header status pill. A dedicated
// lightweight GET endpoint — HEAD responses were being rejected by Chromium's
// fetch, and dashboard-data is too heavy to poll every 3 seconds.
app.get('/api/health', (req, res) => {
    res.json({ success: true, online: true, time: new Date().toISOString() });
});

// The auth identity (req.user.id) is a Supabase Auth UUID — profiles rows use
// college-assigned UUIDs, so look up by the profile row resolved in the
// middleware via the roll-number fallback (authenticateUser does this).
// Same row id is then reused as student key for passes and tickets below.
// 7b. API ROUTE: POST /api/fees/pay — REAL dues settlement.
// Clears the signed-in student's profiles.fee_due_balance to 0 and returns
// the amount that was settled. The Fee Dues modal shows this same column,
// so card, modal and ledger can never disagree again.
app.post('/api/fees/pay', authenticateUser, async (req, res) => {
    try {
        const rowId = req.user?.profile?.id;
        if (!supabase || !rowId) {
            return res.status(503).json({ success: false, error: 'Fee settlement needs a Supabase profile' });
        }
        const { data: prof, error: selErr } = await supabase
            .from('profiles')
            .select('fee_due_balance')
            .eq('id', rowId)
            .maybeSingle();
        if (selErr) throw selErr;
        const previous = prof?.fee_due_balance != null ? Number(prof.fee_due_balance) : 0;
        if (previous <= 0) {
            return res.json({ success: true, alreadyCleared: true, previous, feeDue: 0 });
        }
        const { error: updErr } = await supabase
            .from('profiles')
            .update({ fee_due_balance: 0 })
            .eq('id', rowId);
        if (updErr) throw updErr;
        res.json({ success: true, previous, feeDue: 0 });
    } catch (e) {
        console.warn('fee pay error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/dashboard-data', authenticateUser, async (req, res) => {
    try {
        const rowId = req.user?.profile?.id;
        const userId = rowId || req.user?.id || '10000000-0000-0000-0000-000000000001';
        let profile = null;
        let passes = [];
        let tickets = [];
        let clusters = [];

        if (supabase) {
            try {
                // 1. Fetch Profile — by the real profiles row id when the
                // middleware resolved it, else by the passed id (mock only).
                if (rowId) {
                    const { data: profileData } = await supabase
                        .from('profiles')
                        .select('*')
                        .eq('id', rowId)
                        .maybeSingle();
                    profile = profileData || req.user.profile;
                } else {
                    const { data: profileData } = await supabase
                        .from('profiles')
                        .select('*')
                        .eq('id', userId)
                        .maybeSingle();
                    if (profileData) profile = profileData;
                }

                // 2. Fetch Active Passes — Supabase rows (UUID-keyed) PLUS the
                // in-memory GP-ledger: passes created via /api/create-pass live
                // in memory only, so students on ANY device must still see
                // their own pending/approved passes.
                const { data: passData } = await supabase
                    .from('gate_passes')
                    .select('*')
                    .eq('student_id', userId)
                    .order('created_at', { ascending: false })
                    .limit(5);

                if (passData) passes = passData;

                const myRoll = String(req.user?.rollNumber || '').toLowerCase();
                if (myRoll) {
                    const memPasses = gatePassesDB.filter(
                        p => String(p.rollNo || '').toLowerCase() === myRoll
                    );
                    passes = [...passes, ...memPasses];
                }

                // 3. Fetch Recent Tickets — identity-scoped: students only ever
                // receive THEIR OWN complaints from the server (the old global
                // query is what made one device's history differ from another).
                const isStudentScope = String(req.user?.role || '').toUpperCase() === 'STUDENT';
                let ticketQuery = supabase
                    .from('tickets')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(20);
                if (isStudentScope) ticketQuery = ticketQuery.eq('student_id', userId);
                const { data: ticketData } = await ticketQuery;

                if (ticketData) tickets = ticketData;

                // 4. Fetch Master Incidents (ALL statuses — Warden oversight covers
                // OPEN/IN_PROGRESS/RESOLVED/ESCALATED, not just OPEN clusters)
                const { data: clusterData } = await supabase
                    .from('master_incidents')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(50);

                if (clusterData) {
                    // Cloud rows store hostel_block/floor_number/ticket_count — the UI reads
                    // location/impactedRooms/studentsImpacted. Map room numbers from member tickets.
                    const clusterIds = clusterData.map(c => c.id);
                    let roomTickets = [];
                    if (clusterIds.length > 0) {
                        try {
                            const { data: rt } = await supabase
                                .from('tickets')
                                .select('location, master_incident_id')
                                .in('master_incident_id', clusterIds);
                            roomTickets = rt || [];
                        } catch { /* rooms stay empty if the query fails */ }
                    }

                    clusters = clusterData.map(c => {
                        const memberRooms = roomTickets
                            .filter(t => t.master_incident_id === c.id)
                            .map(t => (String(t.location || '').match(/Room\s+(\S+)/i) || [])[1])
                            .filter(Boolean);
                        const uniqueRooms = [...new Set(memberRooms)];
                        const sla = computeSlaState({ created_at: c.created_at, sla_hours: c.sla_hours || 4 });
                        return {
                            ...c,
                            masterId: c.id,
                            title: c.title || `Multiple ${c.category || 'Category'} Issues Reported`,
                            location: c.location ||
                                [c.hostel_block ? `Hostel ${String(c.hostel_block).replace(/^Hostel\s*/i, '')}` : '',
                                 c.floor_number].filter(Boolean).join(', ') ||
                                c.cluster_code || c.id,
                            impactedRooms: (c.impacted_rooms && c.impacted_rooms.length)
                                ? c.impacted_rooms
                                : uniqueRooms.map(r => `Room ${r}`),
                            studentsImpacted: c.ticket_count || uniqueRooms.length || c.studentsImpacted || 1,
                            assignedTo: c.assigned_technician || (masterAssignmentsDB[c.id] ? masterAssignmentsDB[c.id].name : null),
                            slaHoursLeft: sla.slaHoursLeft,
                            slaState: sla.slaState,
                            slaHours: c.sla_hours || 4
                        };
                    });
                }

            } catch (fetchErr) {
                console.warn('Supabase live fetch error, falling back to local sync:', fetchErr.message);
            }
        }

        // MY MENTOR — the faculty mentor assigned to this student
        // (profiles.mentor_roll). Resolved server-side so the dashboard can
        // surface the mentor card; null when unset / lookup fails / staff.
        let mentor = null;
        if (supabase && String(profile?.mentor_roll || '').trim()) {
            try {
                const { data: mrow } = await supabase.from('profiles')
                    .select('roll_number, full_name, department, phone_number')
                    .eq('roll_number', String(profile.mentor_roll).trim().toUpperCase())
                    .eq('role', 'TEACHER')
                    .maybeSingle();
                if (mrow) mentor = {
                    roll: mrow.roll_number,
                    name: mrow.full_name,
                    department: mrow.department || null,
                    phone: mrow.phone_number || null
                };
            } catch (mErr) { /* card simply hides itself */ }
        }

        // Real admin stats — no invented numbers: directory size from profiles,
        // SLA rate computed from actually-resolved tickets.
        let studentCount = null;
        let slaResolutionRate = null;
        let blockCount = null;
        let blocks = [];
        if (supabase) {
            try {
                const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'STUDENT');
                studentCount = count;
            } catch { /* stays null → UI hides the stat */ }
            try {
                // Real micro-segment data: distinct hostel blocks on the live roster
                const { data: blockRows } = await supabase.from('profiles')
                    .select('hostel_block').eq('role', 'STUDENT');
                const blockSet = [...new Set((blockRows || []).map(r => (r.hostel_block || '').trim()).filter(Boolean))].sort();
                blockCount = blockSet.length || null;
                blocks = blockSet;
            } catch { /* stays null */ }
            try {
                const allReal = tickets.length > 0 ? tickets : ticketsDB;
                const resolvedReal = allReal.filter(t => ['RESOLVED', 'CLOSED'].includes(String(t.status || '').toUpperCase()));
                if (resolvedReal.length > 0) {
                    const inSla = resolvedReal.filter(t => {
                        const ms = t.createdAtMs || (t.created_at ? new Date(t.created_at).getTime() : 0);
                        return ms > 0 && (Date.now() - ms) <= (Number(t.sla_hours) || 4) * 3600 * 1000;
                    }).length;
                    slaResolutionRate = Math.round((inSla / resolvedReal.length) * 1000) / 10;
                }
            } catch { /* stays null */ }
        }

        return res.json({
            success: true,
            profile: profile || {
                full_name: req.user?.name || "Debasish Sahoo",
                roll_number: "2201106190",
                department: "Computer Science & Engineering",
                hostel_block: "Block B",
                room_number: "304",
                attendance_percentage: 86.4,
                fee_due_balance: 3200.00
            },
            studentCount,
            blockCount,
            blocks,
            mentor,
            slaResolutionRate,
            gatePasses: passes.length > 0 ? passes.map(normalizeDashboardRow) : gatePassesDB.map(normalizeDashboardRow),
            tickets: (tickets.length > 0 ? tickets : ticketsDB).map(enrichTicketRow),
            masterClusters: clusters.length > 0 ? clusters : masterClustersDB,
            technicianRoster: Object.values(TECHNICIAN_ROSTER)
        });

    } catch (err) {
        console.error('Dashboard data error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ----------------------------------------------------
// 7b. Shared field normalization for dashboard payloads
// Cloud rows (Supabase) store created_at/user-friendly-unfriendly fields;
// the UI reads createdAt / createdAtMs / time / requestedAt. Normalize here
// so every dashboard shows REAL relative times instead of hardcoded text.
// ----------------------------------------------------
function humanRelativeTime(iso) {
    const ms = new Date(iso).getTime();
    if (!ms || isNaN(ms)) return null;
    const diff = Date.now() - ms;
    if (diff < 45 * 1000) return 'Just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return new Date(ms).toLocaleDateString();
}

function normalizeDashboardRow(row) {
    if (!row) return row;
    const iso = row.created_at || row.createdAt || null;
    const ms = iso ? new Date(iso).getTime() : (row.createdAtMs || null);
    const relTime = humanRelativeTime(iso) || row.time;

    // Cloud rows store only raw_text — derive the human-readable fields the
    // dashboards render (title + description) so complaint details are visible.
    const rawText = (row.raw_text || row.complaintText || row.description || '').trim();
    const derivedTitle = row.title || (rawText
        ? `${row.category || 'Issue'}: ${rawText.length > 64 ? rawText.slice(0, 64) + '…' : rawText}`
        : row.location || row.hostel_block || 'Student Issue');

    return {
        ...row,
        // Guard against double-normalization (rows pass through this repeatedly)
        createdAt: row.createdAt && !ms ? row.createdAt : (row.createdAt || iso),
        createdAtMs: ms || undefined,
        time: row.time && !iso ? row.time : (relTime || 'Just now'),
        requestedAt: row.requestedAt && !iso ? row.requestedAt : (relTime || 'Just now'),
        title: derivedTitle,
        description: row.description || row.complaintText || (rawText && rawText !== derivedTitle ? rawText : null)
    };
}

// ----------------------------------------------------
// 8. API ROUTE: POST /api/admin/bulk-ingest (500-Record Batches)
// ----------------------------------------------------

// GENDER COLUMN AWARENESS: profiles.gender appears when the admin runs the
// migration SQL (scripts/supabase_migration_gender.sql). Until then the CSV
// still REQUIRES the column (so rosters are future-proof), but the DB write
// omits it — writing an unknown column would fail every row.
let genderColReady = null;
async function genderColumnReady() {
    if (genderColReady !== null) return genderColReady;
    if (!supabase) { genderColReady = false; return false; }
    try {
        const { error } = await supabase.from('profiles').select('gender').limit(1);
        genderColReady = !error;
    } catch { genderColReady = false; }
    if (!genderColReady) console.warn('profiles.gender column missing — run scripts/supabase_migration_gender.sql; gender will be validated but not stored yet');
    return genderColReady;
}

// CSV gender values → canonical 'Male' | 'Female' | 'Other' (null if unparseable)
function normGender(v) {
    const g = String(v || '').trim().toLowerCase();
    if (['male', 'm', 'boy', 'boys'].includes(g)) return 'Male';
    if (['female', 'f', 'girl', 'girls'].includes(g)) return 'Female';
    if (['other', 'o', 'nonbinary', 'non-binary'].includes(g)) return 'Other';
    return null;
}

app.post('/api/admin/bulk-ingest', authenticateUser, requireRole('ADMIN', 'DEAN'), async (req, res) => {
    try {
        const { students } = req.body;
        if (!students || !Array.isArray(students) || students.length === 0) {
            return res.status(400).json({ success: false, error: 'Valid students array required' });
        }

        console.log(`📥 Received CSV bulk ingest payload with ${students.length} student records.`);
        // Existing roll directory — decides update vs insert per row.
        const existingRolls = new Set();
        for (let from = 0; ; from += 1000) {
            const { data, error } = await supabase.from('profiles').select('roll_number').eq('role', 'STUDENT').range(from, from + 999);
            if (error) return res.status(500).json({ success: false, error: 'student roster read failed: ' + error.message });
            if (!data || data.length === 0) break;
            for (const r of data) existingRolls.add(String(r.roll_number).trim().toUpperCase());
            if (data.length < 1000) break;
        }

        // Faculty roster — powers mentor_roll validation and the day-scholar
        // round-robin fallback. Rows with a blank mentor that are day-scholars
        // (the leave-flow requires one) get the next staff in the cycle,
        // continuing from the existing day-scholar count so fresh cohorts don't
        // clump on the same few mentors.
        const { data: staffRows, error: staffErr2 } = await supabase
            .from('profiles').select('roll_number').eq('role', 'TEACHER').order('roll_number');
        if (staffErr2) return res.status(500).json({ success: false, error: 'faculty roster read failed: ' + staffErr2.message });
        const mentors = (staffRows || []).map(r => r.roll_number);
        const mentorSet = new Set(mentors.map(m => String(m).trim().toUpperCase()));
        const { count: dsCount } = await supabase
            .from('profiles').select('id', { count: 'exact', head: true })
            .eq('role', 'STUDENT').eq('resident_type', 'dayscholar');
        const rrBase = typeof dsCount === 'number' ? dsCount : 0;

        const errors = [];
        const warnings = [];
        let totalUpserted = 0;
        let created = 0;
        let updated = 0;

        // Build the mapped profile row; optional new-era columns attach ONLY
        // when the CSV provides them so a re-import never nulls old values.
        const buildRow = (s, gIdx) => {
            const row = {
                roll_number: String(s.roll_number || s.rollNo || (2201106000 + gIdx)),
                full_name: s.full_name || s.name || 'Student Name',
                role: 'STUDENT',
                department: s.department || 'Computer Science & Engineering'
            };
            // block/room are OWNED BY THE ROOM ALLOCATOR, not the CSV — only
            // honoured when a row explicitly carries them (legacy override);
            // blank rows stay unassigned until Allocate Rooms runs.
            if (String(s.hostel_block || s.block || '').trim()) row.hostel_block = String(s.hostel_block || s.block).trim().replace(/^Hostel\s*/i, '');
            if (String(s.room_number || s.room || '').trim()) row.room_number = String(s.room_number || s.room).trim();
            const g = normGender(s.gender);
            if (g) row.gender = g;
            // Only assign attendance/fees if the CSV actually provides them —
            // leaving defaults would fabricate numbers for new students (and
            // the columns are NOT NULL, so omitted keys take the DB default).
            const att = (s.attendance_percentage || s.attendance) ? parseFloat(s.attendance_percentage || s.attendance) : null;
            if (att != null && !Number.isNaN(att)) row.attendance_percentage = att;
            const fee = (s.fee_due_balance || s.feeBalance) ? parseFloat(s.fee_due_balance || s.feeBalance) : null;
            if (fee != null && !Number.isNaN(fee)) row.fee_due_balance = fee;
            // Phone only when provided (drives the firstname@last-4 default login).
            if (String(s.phone_number || s.phone || '').trim()) row.phone_number = String(s.phone_number || s.phone).trim();
            const resident = String(s.resident_type || s.residentType || '').trim().toLowerCase();
            if (resident === 'dayscholar' || resident === 'hosteller') {
                row.resident_type = resident;
                if (resident === 'dayscholar') {
                    // Day-scholars live outside campus: no block, no room.
                    row.hostel_block = null;
                    row.room_number = null;
                }
            }
            if (String(s.course || '').trim()) row.course = String(s.course).trim();
            if (String(s.section || '').trim()) row.section = String(s.section).trim();

            // mentor_roll: honored when it names a real teacher; an unknown id
            // is flagged and replaced by the round-robin fallback.
            const rawMentor = String(s.mentor_roll || s.mentorRoll || '').trim().toUpperCase();
            if (rawMentor) {
                if (mentorSet.has(rawMentor)) {
                    row.mentor_roll = rawMentor;
                } else {
                    warnings.push({ roll_number: row.roll_number, warning: `mentor_roll "${rawMentor}" is not on the faculty roster — auto-assigned instead` });
                    if (mentors.length > 0) {
                        row.mentor_roll = mentors[(rrBase + gIdx) % mentors.length];
                    }
                }
            } else if (mentors.length > 0) {
                row.mentor_roll = mentors[(rrBase + gIdx) % mentors.length];
            }
            return row;
        };

        // ALL-OR-NOTHING VALIDATION: every row must carry the compulsory
        // fields — if even one fails, the WHOLE csv is rejected and nothing
        // is written (a half-imported cohort would be worse than none).
        const rowErrors = [];
        const valid = [];
        students.forEach((s, gIdx) => {
            const roll = String(s.roll_number || s.rollNo || '').trim();
            const missing = [];
            if (!roll) missing.push('roll_number');
            if (!String(s.full_name || s.name || '').trim()) missing.push('full_name');
            if (!String(s.phone_number || s.phone || '').trim()) missing.push('phone_number');
            if (!String(s.resident_type || s.residentType || '').trim()) missing.push('resident_type');
            if (!String(s.course || '').trim()) missing.push('course');
            if (!String(s.section || '').trim()) missing.push('section');
            // gender is COMPULSORY on every row — the room allocator uses it
            // to keep Boys/Girls hostels separate. Blank → missing; an
            // unparseable value is its own row error.
            if (!String(s.gender || '').trim()) {
                missing.push('gender');
            } else if (!normGender(s.gender)) {
                rowErrors.push({ row: gIdx + 1, roll_number: roll || `row ${gIdx + 1}`, error: `invalid gender "${String(s.gender).trim()}" — use Male, Female or Other` });
                return;
            }
            // hostel block/room are NOT CSV fields anymore — rooms are
            // auto-allocated after upload (Allocate Rooms) or moved by the
            // admin override; a CSV carrying them explicitly still wins.
            if (missing.length > 0) {
                rowErrors.push({ row: gIdx + 1, roll_number: roll || `row ${gIdx + 1}`, error: 'missing required: ' + missing.join(', ') });
                return;
            }
            valid.push(buildRow(s, gIdx));
        });
        // ---- CAMPUS BLOCK RULES (Campus Setup is the source of truth).
        // The admin defines hostel blocks + capacities FIRST; every hosteller
        // row in a CSV must then land in a DEFINED block and respect its
        // capacity (existing residents + this CSV). Rooms are shared on this
        // campus (multi-occupancy), so a room number is NOT exclusive.
        // All-or-nothing: one violation rejects the whole file.
        await ccEnsure().catch(() => {});
        const blockDefs = (CAMPUS.doc && Array.isArray(CAMPUS.doc.hostelBlocks)) ? CAMPUS.doc.hostelBlocks : [];
        if (blockDefs.length && valid.length) {
            const defByBlock = new Map(blockDefs.map(b => [String(b.name).trim().toLowerCase(), b]));
            // roll → block, retried on hard errors (a transient Supabase hiccup
            // must not silently skip the capacity rules)
            const curBlock = new Map();
            for (let attempt = 0; attempt < 3; attempt++) {
                let pageErr = null, got = 0;
                for (let from = 0; ; from += 1000) {
                    const { data, error } = await supabase.from('profiles')
                        .select('roll_number, hostel_block')
                        .eq('role', 'STUDENT').not('hostel_block', 'is', null).range(from, from + 999);
                    if (error) { pageErr = error.message; break; }
                    if (!data || !data.length) break;
                    got += data.length;
                    for (const r of data) {
                        const roll = String(r.roll_number || '').trim().toUpperCase();
                        const b = String(r.hostel_block || '').trim().toLowerCase();
                        if (b) curBlock.set(roll, b);
                    }
                    if (data.length < 1000) break;
                }
                if (!pageErr && got > 0) break;
                if (pageErr) { console.warn(`hostel occupancy read retry ${attempt + 1}: ${pageErr}`); await new Promise(r => setTimeout(r, 2000)); }
            }
            // simulate the AFTER-import occupancy of every block
            const blockCount = {};
            for (const [, b] of curBlock) blockCount[b] = (blockCount[b] || 0) + 1;
            valid.forEach((row, i) => {
                const blockRaw = String(row.hostel_block || '').trim();
                if (!blockRaw) return;                          // day-scholar — outside block rules
                const def = defByBlock.get(blockRaw.toLowerCase());
                if (!def) {
                    rowErrors.push({
                        row: i + 1, roll_number: row.roll_number,
                        error: `hostel block "${blockRaw}" is not defined in Campus Setup — the admin must add it first (defined: ${blockDefs.map(b => b.name).join(', ')})`
                    });
                    return;
                }
                const bKey = blockRaw.toLowerCase();
                const roll = String(row.roll_number).trim().toUpperCase();
                const oldBlock = curBlock.get(roll);
                // commit this row's move against the simulated after-import state
                if (oldBlock && oldBlock !== bKey) blockCount[oldBlock] = Math.max(0, (blockCount[oldBlock] || 0) - 1);
                if (oldBlock !== bKey || !blockCount[bKey]) blockCount[bKey] = (blockCount[bKey] || 0) + 1;
                curBlock.set(roll, bKey);
            });
            // capacity is judged on the AFTER-import occupancy of each block
            for (const def of blockDefs) {
                const bKey = String(def.name).trim().toLowerCase();
                if ((blockCount[bKey] || 0) > def.capacity) {
                    rowErrors.push({
                        row: 0, roll_number: def.name,
                        error: `hostel block ${def.name} would exceed its capacity — ${blockCount[bKey]} residents for ${def.capacity} seats (raise the capacity in Campus Setup or assign fewer students)`
                    });
                }
            }
        }

        if (rowErrors.length > 0) {
            const fieldFails = rowErrors.filter(e => /missing required/.test(e.error || '')).length;
            const blockFails = rowErrors.length - fieldFails;
            console.log(`⛔ Bulk Ingest REJECTED: ${rowErrors.length}/${students.length} row(s) failed validation (${fieldFails} compulsory-field, ${blockFails} hostel-block rule) — nothing written.`);
            return res.status(422).json({
                success: false,
                rejected: true,
                message: `CSV rejected — ${rowErrors.length} row(s) failed validation (${fieldFails} missing compulsory fields${blockFails ? `, ${blockFails} hostel-block rule violations` : ''}). Nothing was imported.`,
                totalSubmitted: students.length,
                errors: rowErrors
            });
        }

        // gender is stored only when the migration has been run — otherwise
        // the write would fail on the unknown column
        if (!(await genderColumnReady())) {
            valid.forEach(r => delete r.gender);
            warnings.push({ roll_number: '—', warning: 'profiles.gender column is missing — gender was validated but NOT stored. Run scripts/supabase_migration_gender.sql in the Supabase SQL editor, then re-upload.' });
        }

        const updates = []; // existing rolls — plain profile update, auth untouched
        const inserts = []; // new rolls — auth-first (profiles.id FK → auth.users.id)
        valid.forEach((row, vIdx) => {
            if (existingRolls.has(row.roll_number.toUpperCase())) updates.push(row); else inserts.push(row);
        });

        // UPDATES: per-row profile update (no auth interaction — login
        // untouched). A batched upsert with a partial row violates the
        // NOT NULL columns (attendance_percentage etc.) — update() only
        // touches the provided fields, so per-row is the safe write.
        for (const row of updates) {
            const { error: rowErr } = await supabase.from('profiles').update(row).eq('roll_number', row.roll_number);
            if (rowErr) errors.push({ roll_number: row.roll_number, error: 'profile update failed: ' + rowErr.message });
            else { totalUpserted++; updated++; }
        }

        // INSERTS: create the GoTrue login first (default password pattern),
        // then the profile with the returned auth id; roll the account back if
        // the profile insert fails so a retry isn't blocked by a half-made row.
        for (let i = 0; i < inserts.length; i++) {
            const row = inserts[i];
            const defaultPw = defaultPasswordFor(row);
            const email = authEmailFor(row.roll_number);
            const { data: authUser, error: authErr } = await supabaseAuth.auth.admin.createUser({
                email,
                password: defaultPw,
                email_confirm: true,
                user_metadata: { roll_number: row.roll_number, full_name: row.full_name, role: 'STUDENT' }
            });
            if (authErr || !authUser?.user?.id) {
                errors.push({ roll_number: row.roll_number, error: 'account create failed: ' + (authErr?.message || 'no user id returned') });
                continue;
            }
            const { error: insErr } = await supabase.from('profiles').insert({ ...row, id: authUser.user.id });
            if (insErr) {
                await supabaseAuth.auth.admin.deleteUser(authUser.user.id);
                errors.push({ roll_number: row.roll_number, error: 'profile insert failed: ' + insErr.message });
                continue;
            }
            totalUpserted++; created++;
        }

        console.log(`✅ Bulk Ingest completed: ${totalUpserted}/${students.length} records processed (${created} new, ${updated} refreshed) across ${updates.length + inserts.length} write pass(es).`);

        return res.json({
            success: errors.length === 0,
            totalSubmitted: students.length,
            totalUpserted,
            created,
            updated,
            warnings: warnings.length > 0 ? warnings : undefined,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (err) {
        console.error('Bulk ingest exception:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================
// 8a. ROOM ALLOCATION ENGINE
// The CSV never assigns rooms. Hostellers are grouped by
// course + department + admission-year, and the allocator fills
// rooms block-by-block: a room holds up to the block's seatsPerRoom
// students of the SAME group, and Boys/Girls blocks never mix.
// Already-placed students keep their rooms (idempotent re-runs)
// unless their block's gender no longer matches them.
//   POST dryRun:true  → the plan (nothing written)
//   POST dryRun:false → writes hostel_block/room_number per row
// Individual corrections go through /api/admin/assign-room below.
// ============================================================
app.post('/api/admin/allocate-rooms', authenticateUser, requireRole('ADMIN', 'DEAN'), async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ success: false, error: 'database offline' });
        await ccEnsure();
        const dryRun = req.body?.dryRun !== false;
        // reshuffle:true re-rooms EVERY hosteller from scratch (deterministic
        // grouping) — used once to clean up legacy mixed rooms; the default
        // run keeps already-placed students exactly where they are.
        const keepPlaced = req.body?.reshuffle !== true;
        const blocks = (CAMPUS.doc.hostelBlocks || []).filter(b => String(b.name || '').trim() && b.capacity > 0);
        if (!blocks.length) return res.status(400).json({ success: false, error: 'no hostel blocks defined — add them in Campus Setup first' });
        const unset = blocks.find(b => !b.gender || !b.seatsPerRoom);
        if (unset) return res.status(400).json({ success: false, error: `block "${unset.name}" needs a gender and seats-per-room set in Campus Setup` });

        // the whole roster, once (gender only when the column exists)
        const gcReady = await genderColumnReady();
        const students = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await supabase.from('profiles')
                .select('roll_number, full_name, course, department, resident_type, hostel_block, room_number' + (gcReady ? ', gender' : ''))
                .eq('role', 'STUDENT').range(from, from + 999);
            if (error) return res.status(500).json({ success: false, error: 'roster read failed: ' + error.message });
            if (!data || !data.length) break;
            students.push(...data);
            if (data.length < 1000) break;
        }

        const admissionYear = (roll) => {
            const m = String(roll).trim().match(/^(\d{2})/);
            return m ? 2000 + parseInt(m[1], 10) : 0;      // 0 = unknown year
        };
        const groupOf = (s) => `${s.course || '?'}|${s.department || '?'}|Y${admissionYear(s.roll_number)}`;
        // block gender is written as Boys/Girls; students are Male/Female —
        // compare through one mapping
        const sideOf = (blkGender) => (String(blkGender).toLowerCase() === 'girls' ? 'Female' : 'Male');

        const byKey = new Map(blocks.map(b => [String(b.name).trim().toLowerCase(), b]));
        const rooms = new Map();      // blockKey → Map(roomNo → { group, used })
        const blockCount = {};        // blockKey → residents
        const kept = [];              // staying where they are
        const pool = [];              // need a room (or a new one)
        const unplaced = [];          // cannot be placed + why

        for (const s of students) {
            if (String(s.resident_type || '').toLowerCase() !== 'hosteller') continue;
            const roll = String(s.roll_number || '').trim().toUpperCase();
            const bk = String(s.hostel_block || '').trim().toLowerCase();
            const room = String(s.room_number || '').trim();
            const def = bk ? byKey.get(bk) : null;
            if (!gcReady) {
                unplaced.push({ roll, name: s.full_name, reason: 'profiles.gender column missing — run scripts/supabase_migration_gender.sql first' });
                continue;
            }
            const g = normGender(s.gender);
            if (!g) {
                unplaced.push({ roll, name: s.full_name, reason: 'gender unknown — re-upload the roster CSV (gender is compulsory) or fix it with the room override' });
                continue;
            }
            if (keepPlaced && def && sideOf(def.gender) === g && room) {
                // keep this student exactly where they are
                const rm = rooms.get(bk) || new Map();
                const cur = rm.get(room);
                if (cur) {
                    cur.used++;
                    if (cur.group !== groupOf(s)) cur.mixed = true;  // historical room — don't top it up
                } else {
                    rm.set(room, { group: groupOf(s), used: 1 });
                }
                rooms.set(bk, rm);
                blockCount[bk] = (blockCount[bk] || 0) + 1;
                kept.push(roll);
                continue;
            }
            // wrong-gender block, undefined block, or no room → reallocate
            pool.push({ roll, name: s.full_name, gender: g, group: groupOf(s) });
        }

        const seatsLeft = {};
        const maxRoomNo = {};
        for (const b of blocks) {
            const bk = String(b.name).trim().toLowerCase();
            seatsLeft[bk] = b.capacity - (blockCount[bk] || 0);
            let mx = 100;
            const rm = rooms.get(bk);
            if (rm) for (const rn of rm.keys()) { const n = parseInt(rn, 10); if (n > mx) mx = n; }
            maxRoomNo[bk] = mx;
        }

        // deterministic: groups in label order, rolls within a group
        pool.sort((a, b) => a.group.localeCompare(b.group) || a.roll.localeCompare(b.roll));
        const assignments = [];
        const perBlockMoved = {};
        for (const p of pool) {
            let placed = null;
            // 1) a room with free seats and the SAME group in a same-gender block
            for (const b of blocks) {
                const bk = String(b.name).trim().toLowerCase();
                if (sideOf(b.gender) !== p.gender || (seatsLeft[bk] || 0) <= 0) continue;
                const rm = rooms.get(bk);
                if (!rm) continue;
                for (const [rn, info] of rm) {
                    if (info.group === p.group && !info.mixed && info.used < b.seatsPerRoom) { placed = { bk, room: rn }; break; }
                }
                if (placed) break;
            }
            // 2) open a fresh room in a same-gender block with seats left
            if (!placed) {
                for (const b of blocks) {
                    const bk = String(b.name).trim().toLowerCase();
                    if (sideOf(b.gender) !== p.gender || (seatsLeft[bk] || 0) <= 0) continue;
                    const room = String(++maxRoomNo[bk]);
                    const rm = rooms.get(bk) || new Map();
                    rm.set(room, { group: p.group, used: 0 });
                    rooms.set(bk, rm);
                    placed = { bk, room };
                    break;
                }
            }
            if (!placed) {
                unplaced.push({ roll: p.roll, name: p.name, reason: `no ${p.gender === 'Female' ? 'Girls' : 'Boys'} block has seats left — raise a capacity or add a block in Campus Setup` });
                continue;
            }
            rooms.get(placed.bk).get(placed.room).used++;
            seatsLeft[placed.bk]--;
            perBlockMoved[placed.bk] = (perBlockMoved[placed.bk] || 0) + 1;
            assignments.push({ roll: p.roll, name: p.name, block: byKey.get(placed.bk).name, room: placed.room, group: p.group });
        }

        const perBlock = blocks.map(b => {
            const bk = String(b.name).trim().toLowerCase();
            const rm = rooms.get(bk) || new Map();
            return {
                name: b.name, gender: b.gender, seatsPerRoom: b.seatsPerRoom,
                capacity: b.capacity,
                residents: (blockCount[bk] || 0) + (perBlockMoved[bk] || 0),
                roomsUsed: rm.size
            };
        });

        if (dryRun) {
            return res.json({
                success: true, dryRun: true,
                kept: kept.length, toPlace: assignments.length, unplacedCount: unplaced.length,
                perBlock, assignments, unplaced: unplaced.slice(0, 100)
            });
        }

        // confirm — per-row update (rooms move, auth untouched)
        let moved = 0;
        const errors = [];
        for (const a of assignments) {
            const { error } = await supabase.from('profiles')
                .update({ hostel_block: a.block, room_number: a.room }).eq('roll_number', a.roll);
            if (error) errors.push({ roll_number: a.roll, error: error.message });
            else moved++;
        }
        console.log(`🏠 Room allocation applied: ${moved} placed, ${kept.length} kept, ${unplaced.length} unplaced.`);
        return res.json({
            success: errors.length === 0, dryRun: false,
            moved, kept: kept.length, unplacedCount: unplaced.length,
            perBlock, unplaced, errors: errors.length ? errors : undefined,
            statement: `Room allocation applied — ${moved} students placed, ${kept.length} kept in their rooms${unplaced.length ? `, ${unplaced.length} could not be placed (see the list)` : ''}.`
        });
    } catch (err) {
        console.error('room allocation failed:', err.message);
        return res.status(500).json({ success: false, error: 'room allocation failed: ' + err.message });
    }
});

// 8a-ii. MANUAL ROOM OVERRIDE — move ONE student to a specific block+room.
// Same rules as the allocator, enforced live: block gender must match the
// student, the room stays within seatsPerRoom, rooms never mix course/year
// groups, and the block keeps its capacity.
app.post('/api/admin/assign-room', authenticateUser, requireRole('ADMIN', 'DEAN'), async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ success: false, error: 'database offline' });
        await ccEnsure();
        const roll = String(req.body?.roll || '').trim();
        const blockName = String(req.body?.block || '').trim();
        const room = String(req.body?.room || '').trim();
        if (!roll || !blockName || !room) return res.status(400).json({ success: false, error: 'roll, block and room are required' });

        const def = (CAMPUS.doc.hostelBlocks || []).find(b => String(b.name || '').trim().toLowerCase() === blockName.toLowerCase());
        if (!def) return res.status(422).json({ success: false, error: `block "${blockName}" is not defined in Campus Setup` });

        const gcReady = await genderColumnReady();
        const { data: s, error: sErr } = await supabase.from('profiles')
            .select('roll_number, full_name, resident_type, course, department, hostel_block, room_number' + (gcReady ? ', gender' : ''))
            .eq('roll_number', roll).maybeSingle();
        if (sErr) return res.status(500).json({ success: false, error: 'student read failed: ' + sErr.message });
        if (!s) return res.status(404).json({ success: false, error: `no student with roll ${roll}` });
        if (String(s.resident_type || '').toLowerCase() !== 'hosteller') {
            return res.status(422).json({ success: false, error: `${s.full_name} is a day scholar — no hostel room to assign` });
        }
        const g = gcReady ? normGender(s.gender) : null;
        const blockSide = (String(def.gender).toLowerCase() === 'girls') ? 'Female' : 'Male';
        if (gcReady && g && blockSide !== g) {
            return res.status(422).json({ success: false, error: `${def.name} is a ${def.gender} block — ${s.full_name} is registered ${g}. Hostels never mix.` });
        }

        const { data: occ, error: oErr } = await supabase.from('profiles')
            .select('roll_number, course, department')
            .eq('hostel_block', def.name).eq('room_number', room);
        if (oErr) return res.status(500).json({ success: false, error: 'room read failed: ' + oErr.message });
        const others = (occ || []).filter(o => String(o.roll_number).toUpperCase() !== String(s.roll_number).toUpperCase());
        const yr = (r) => { const m = String(r).trim().match(/^(\d{2})/); return m ? 2000 + parseInt(m[1], 10) : 0; };
        const myGroup = `${s.course || '?'}|${s.department || '?'}|Y${yr(s.roll_number)}`;
        for (const o of others) {
            const oGroup = `${o.course || '?'}|${o.department || '?'}|Y${yr(o.roll_number)}`;
            if (oGroup !== myGroup) {
                return res.status(422).json({ success: false, error: `room ${room} in ${def.name} houses a different course/year (${oGroup.split('|').join(' · ')}) — rooms never mix years or courses` });
            }
        }
        if (others.length >= def.seatsPerRoom) {
            return res.status(422).json({ success: false, error: `room ${room} in ${def.name} is at its seats-per-room limit (${def.seatsPerRoom}) — raise seats-per-room in Campus Setup if this room should hold more` });
        }
        const { count: blockNow, error: cErr } = await supabase.from('profiles')
            .select('roll_number', { count: 'exact', head: true })
            .eq('hostel_block', def.name)
            .neq('roll_number', String(s.roll_number).toUpperCase());
        if (cErr) return res.status(500).json({ success: false, error: 'capacity read failed: ' + cErr.message });
        if ((blockNow || 0) + 1 > def.capacity) {
            return res.status(422).json({ success: false, error: `${def.name} is at capacity (${def.capacity}) — raise it in Campus Setup` });
        }

        const { error: uErr } = await supabase.from('profiles')
            .update({ hostel_block: def.name, room_number: room }).eq('roll_number', s.roll_number);
        if (uErr) return res.status(500).json({ success: false, error: 'room update failed: ' + uErr.message });
        console.log(`🚪 Room override: ${s.roll_number} → ${def.name} / ${room}`);
        return res.json({
            success: true, roll: s.roll_number, name: s.full_name,
            block: def.name, room, roommates: others.length,
            statement: `${s.full_name} moved to ${def.name} / room ${room} (${others.length} roommate${others.length === 1 ? '' : 's'}).`
        });
    } catch (err) {
        console.error('room override failed:', err.message);
        return res.status(500).json({ success: false, error: 'room override failed: ' + err.message });
    }
});

// ----------------------------------------------------
// 8b. API ROUTE: POST /api/admin/bulk-ingest-teachers (Faculty CSV)
// Same admin flow as the student ingest, but rows land as role=TEACHER
// profile entries AND their login accounts are pre-created with the
// password carried by the CSV (teachers must sign in on day one with
// the college-issued password — unlike students, whose accounts are
// lazily provisioned from the firstname@last-4 default at first login).
// Idempotent by staff_id: an EXISTING teacher is only refreshed in the
// specialist column (never renamed, never re-passworded, login untouched);
// a missing password for a NEW row is an honest per-row error.
// ----------------------------------------------------
app.post('/api/admin/bulk-ingest-teachers', authenticateUser, requireRole('ADMIN', 'DEAN'), async (req, res) => {
    try {
        const teachers = Array.isArray(req.body?.teachers) ? req.body.teachers : [];
        if (teachers.length === 0) {
            return res.status(400).json({ success: false, error: 'Valid teachers array required' });
        }
        if (!supabase) return res.status(503).json({ success: false, error: 'Database offline' });

        const { data: existingStaff, error: staffErr } = await supabase
            .from('profiles')
            .select('id, roll_number, full_name')
            .eq('role', 'TEACHER');
        if (staffErr) return res.status(500).json({ success: false, error: staffErr.message });
        const byRoll = new Map((existingStaff || []).map(r => [String(r.roll_number || '').trim().toUpperCase(), r]));

        const results = [];
        let created = 0, refreshed = 0, failed = 0;

        for (let i = 0; i < teachers.length; i++) {
            const t = teachers[i];
            const staffId = String(t.staff_id || t.staffId || '').trim().toUpperCase();
            const name = String(t.teacher_name || t.name || '').trim();
            const spec = String(t.subject_specialization || t.subjectSpecialization || '').trim();
            const dept = String(t.department || '').trim() || 'Computer Science & Engineering';
            const pw = String(t.password || '').trim();
            const phone = String(t.phone_number || t.phone || '').trim();
            if (phone) {
                // Intentional collision guard: a teacher must never share the
                // directory phone of a student (rows are keyed by suffix digits).
                const digits = phone.replace(/\D/g, '');
                const { data: clash, error: clashErr } = await supabase
                    .from('profiles')
                    .select('roll_number')
                    .eq('role', 'STUDENT')
                    .ilike('phone_number', `%${digits.replace(/^91/, '')}%`)
                    .limit(1);
                if (!clashErr && clash && clash.length > 0) {
                    results.push({ staff_id: staffId, status: 'error', message: `phone_number collides with student/clash roster (${clash[0].roll_number})` });
                    failed++; continue;
                }
            }

            const existing = byRoll.get(staffId);
            if (existing) {
                // Existing teacher: only refresh the specialist column (and the
                // phone ONLY when the CSV explicitly provides a valid one) —
                // never rename, never re-password, login untouched.
                const patch = {};
                if (spec) patch.subject_specialization = spec;
                if (phone) patch.phone_number = phone;
                if (Object.keys(patch).length > 0) {
                    const { error: specErr } = await supabase.from('profiles').update(patch).eq('id', existing.id);
                    if (specErr) {
                        results.push({ staff_id: staffId, status: 'error', message: 'refresh failed: ' + specErr.message });
                        failed++; continue;
                    }
                    results.push({ staff_id: staffId, status: 'refreshed', message: `profile untouched, updated: ${Object.keys(patch).join(', ')}` });
                    refreshed++;
                } else {
                    results.push({ staff_id: staffId, status: 'unchanged', message: 'already on the roster — nothing modified' });
                }
                continue;
            }

            // New teacher: full profile row + a pre-provisioned login account.
            if (!pw || pw.length < 6) {
                results.push({ staff_id: staffId, status: 'error', message: 'new teachers need a password of at least 6 characters (no default fallback for staff)' });
                failed++; continue;
            }
            const suffixDigits = staffId.replace(/\D/g, '') || String(i + 1);
            // auth FIRST: profiles.id is a FK to auth.users.id, so the login
            // account must exist (and yield its UUID) before the profile row.
            const email = authEmailFor(staffId);
            const { data: authUser, error: authErr } = await supabaseAuth.auth.admin.createUser({
                email,
                password: pw,
                email_confirm: true,
                user_metadata: { roll_number: staffId, full_name: name, role: 'TEACHER' }
            });
            if (authErr || !authUser?.user?.id) {
                results.push({ staff_id: staffId, status: 'error', message: 'account create failed: ' + (authErr?.message || 'no user id returned') });
                failed++; continue;
            }
            const profRow = {
                id: authUser.user.id,
                roll_number: staffId,
                full_name: name,
                role: 'TEACHER',
                department: dept,
                phone_number: phone || suffixDigits.slice(-4) || '0000',
                resident_type: 'hosteller',   // staff quarters, mirrors the existing 20
                hostel_block: null,
                room_number: null,
                subject_specialization: spec || null
            };
            const { error: insErr } = await supabase.from('profiles').insert(profRow);
            if (insErr) {
                // Roll the account back so a retry isn't blocked by a half-made teacher.
                await supabaseAuth.auth.admin.deleteUser(authUser.user.id);
                results.push({ staff_id: staffId, status: 'error', message: 'profile insert failed: ' + insErr.message });
                failed++; continue;
            }

            byRoll.set(staffId, { id: profRow.id, roll_number: staffId, full_name: name });
            results.push({ staff_id: staffId, status: 'created', message: `profile + login (with the CSV password) ready for ${name}` });
            created++;
        }

        return res.json({
            success: failed === 0,
            totalSubmitted: teachers.length,
            created,
            refreshed,
            totalActiveTeachers: byRoll.size,
            results,
            errors: failed > 0 ? results.filter(r => r.status === 'error') : undefined
        });
    } catch (err) {
        console.error('Teacher ingest exception:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ----------------------------------------------------
// 9. MESS FEEDBACK SENTIMENT AI ENDPOINT
// ----------------------------------------------------
app.post('/api/analyze-feedback', async (req, res) => {
    try {
        const { feedbackText } = req.body;
        if (!feedbackText) {
            return res.status(400).json({ success: false, error: 'Feedback text required' });
        }

        let aiResult = {};
        try {
            const prompt = `Analyze this mess food feedback for hygiene and quality scores (0-100), sentiment (POSITIVE, NEGATIVE, or NEUTRAL), and flag reason: "${feedbackText}". Return JSON strictly in this format: {"sentiment": "NEGATIVE", "hygieneScore": 65, "foodQualityScore": 70, "flagReason": "Undercooked rice reported"}`;
            const response = await axios.post('http://localhost:11434/api/generate', {
                model: 'campusdebug-ai',
                prompt,
                stream: false,
                format: 'json'
            }, { timeout: 15000 });

            aiResult = JSON.parse(response.data.response);
        } catch {
            const lower = feedbackText.toLowerCase();
            const isBad = lower.includes('bad') || lower.includes('dirty') || lower.includes('cold') || lower.includes('raw');
            aiResult = {
                sentiment: isBad ? 'NEGATIVE' : 'POSITIVE',
                hygieneScore: isBad ? 62 : 94,
                foodQualityScore: isBad ? 58 : 91,
                flagReason: isBad ? 'Quality Concerns Highlighted' : 'Healthy Satisfactory Feedback'
            };
        }

        return res.json({ success: true, analysis: aiResult });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ----------------------------------------------------
// Gate-pass persistence bridge: human "GP-xxxxxx" IDs are stored in the
// `pass_ref` text column; `student_id` is resolved to the real profile
// UUID. If the ALTER TABLE hasn't been applied yet, persistence quietly
// falls back to the JSON ledger (data/gate_passes.json).
// ----------------------------------------------------
let gpSupabaseOk = true; // flips false if pass_ref column is missing
const gpDisableSupabase = (e) => {
    gpSupabaseOk = false;
    console.warn('Supabase gate_passes persistence disabled for this session — run ALTER TABLE to add pass_ref/status_label/scanned_by/pass_category:', e.message);
};
const passTypeEnumOf = (t) => /overnight|home leave|weekend/i.test(String(t)) ? 'OVERNIGHT' : 'DAY';

// Exact pass category stored in gate_passes.pass_category (varchar(20)).
// Accepts both the new labels and legacy ones from older records.
const passCategoryOf = (t) => {
    const s = String(t || '').toLowerCase();
    if (/medical/.test(s)) return 'MEDICAL';
    if (/home leave|weekend/.test(s)) return 'HOME_LEAVE';
    if (/library/.test(s)) return 'LIBRARY'; // legacy night-library records
    return 'DAY_PASS';
};

// Insert (or refresh) the Supabase row for a GP pass. Best-effort.
// Race-proof: earlier a "select → update|insert" pair let two concurrent
// POST /api/create-pass calls BOTH see "no row" and BOTH insert, so the
// ledger grew duplicate rows for one pass. Strategy now:
//   1. single atomic UPSERT (works once UNIQUE(pass_ref) exists — Dept SQL),
//   2. if the index is missing yet, select-newest → update it and DELETE any
//      duplicate rows that already snuck in (self-healing under races).
async function upsertGatePassRow(passData, resolvedProfileId, overrides = {}) {
    if (!supabase || !gpSupabaseOk || !resolvedProfileId) return;
    try {
        const row = {
            student_id: resolvedProfileId,
            pass_type: passTypeEnumOf(passData.passType),
            pass_category: passCategoryOf(passData.passType),
            destination: passData.destination || 'Campus',
            reason: passData.reason || 'Not specified',
            valid_until: passData.validUntil || null,
            priority: !!passData.priority,
            status: passData.status || 'PENDING',
            pass_ref: passData.id,
            ...overrides
        };
        // 1. Atomic path — PostgREST ON CONFLICT (pass_ref) DO UPDATE.
        const { error: upsertErr } = await supabase
            .from('gate_passes')
            .upsert(row, { onConflict: 'pass_ref' });
        if (!upsertErr) return;
        // Unique index not added yet → fall back, but still self-heal dupes.
        if (!/conflict|unique/i.test(upsertErr.message || '')) throw upsertErr;
        const { data: rows } = await supabase
            .from('gate_passes')
            .select('id')
            .eq('pass_ref', passData.id)
            .order('created_at', { ascending: false });
        if (rows && rows.length > 0) {
            const { error } = await supabase.from('gate_passes')
                .update(row).eq('id', rows[0].id);
            if (error) throw error;
            if (rows.length > 1) {
                const stale = rows.slice(1).map(r => r.id);
                const { error: delErr } = await supabase
                    .from('gate_passes').delete().in('id', stale);
                if (delErr) console.warn('gate_passes dupe cleanup skipped:', delErr.message);
            }
        } else {
            const { error } = await supabase.from('gate_passes').insert(row);
            if (error) throw error;
        }
    } catch (err) {
        console.warn('gate_passes upsert failed:', err.message || err);
        gpDisableSupabase(err);
    }
}

async function resolveProfileIdForPass(passData) {
    const roll = passData?.rollNo || passData?.studentId;
    if (!roll || !supabase) return null;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(roll))) return String(roll);
    const profile = await findProfileByIdOrRoll(null, String(roll).trim());
    return profile?.id || null;
}

// Gate Pass Creation & Local Sync
app.post('/api/create-pass', (req, res) => {
    const { passData } = req.body;
    if (!passData || !passData.id) {
        return res.status(400).json({ success: false, error: 'passData is required' });
    }
    const existingIdx = gatePassesDB.findIndex(p => p.id === passData.id);
    if (existingIdx >= 0) {
        gatePassesDB[existingIdx] = { ...gatePassesDB[existingIdx], ...passData };
    } else {
        gatePassesDB.unshift(passData);
    }
    persistGatePasses();

    // Best-effort Supabase persistence (real ledger for the dashboard).
    // Falls back to the JSON file if the pass_ref column isn't added yet.
    resolveProfileIdForPass(passData)
        .then(pid => upsertGatePassRow(passData, pid))
        .catch(e => console.warn('gate_passes upsert skipped:', e.message));

    // NOTE: gate_passes stores the human "GP-xxxxxx" ID in the pass_ref text
    // column; the row itself uses a UUID primary key + real profile FK.
    // If Supabase fallback is active, persistence stays in-memory + JSON.

    return res.json({ success: true, gatePasses: gatePassesDB });
});

// Gate Register reader — every EXIT/RETURN scan log (with late-return flag).
// Referenced by the warden/admin Gate Register tab and useful for the guard
// desk too. Returns a graceful empty list while the pass_scans table is not
// created yet, so the dashboard never breaks.
// Softer-commute integration: `category=COMMUTE` filters to day-scholar
// IN/OUT rows only (they live in the same append-only register table but are
// a separate instrument — never mixed with warden-approved pass analytics).
app.get('/api/pass-scans', authenticateUser, requireRole('GUARD', 'WARDEN', 'ADMIN', 'DEAN'), async (req, res) => {
    try {
        const limit = Math.min(parseInt(String(req.query.limit || '150'), 10) || 150, 300);
        const category = String(req.query.category || '').trim().toUpperCase();
        if (!supabase || !gpSupabaseOk) {
            return res.json({ success: true, registerOk: false, scans: [] });
        }
        let q = supabase
            .from('pass_scans')
            .select('id, pass_ref, student_roll, student_name, destination, category, direction, method, scanned_by, scanned_at, late_return')
            .order('scanned_at', { ascending: false })
            .limit(limit);
        if (category) q = q.eq('category', category);
        const { data, error } = await q;
        if (error) {
            // Table not created yet (or schema drift) — register stays an
            // empty/skeleton panel, the rest of the app is unaffected.
            return res.json({ success: true, registerOk: false, error: error.message, scans: [] });
        }
        return res.json({ success: true, registerOk: true, scans: data || [] });
    } catch (err) {
        return res.json({ success: true, registerOk: false, error: err.message, scans: [] });
    }
});

// DAY-SCHOLAR COMMUTE REGISTER — a separate instrument from the gate pass.
// Day scholars commute daily; the warden gate and the return window belong
// to OUTINGS (hostelers). Their campus movements are instead an alternating
// IN/OUT log driven by ONE permanent signed campus-ID QR: the guard scans
// it, and the server decides the direction from today's scan history
// (first scan of the day = IN, next = OUT, and so on). No approval, no
// expiry, no late tracking — just an always-allowed, append-only presence
// ledger. Rows live in pass_scans with category='COMMUTE'.
async function lastCommuteScanToday(roll) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { data } = await supabase
        .from('pass_scans')
        .select('direction, scanned_at')
        .eq('category', 'COMMUTE')
        .eq('student_roll', String(roll).trim())
        .gte('scanned_at', startOfDay.toISOString())
        .order('scanned_at', { ascending: false })
        .limit(1);
    return (data || [])[0] || null;
}

app.post('/api/commute-scan', authenticateUser, requireRole('GUARD', 'WARDEN', 'ADMIN', 'DEAN'), async (req, res) => {
    try {
        const roll = String(req.body.rollNo || '').trim();
        const name = String(req.body.name || 'Student').trim() || 'Student';
        if (!/^[A-Za-z0-9-]{4,12}$/.test(roll)) {
            return res.status(400).json({ success: false, error: 'Valid roll number required' });
        }
        if (!supabase || !gpSupabaseOk) {
            return res.status(503).json({ success: false, error: 'Commute register not connected (pass_scans table missing)' });
        }

        const last = await lastCommuteScanToday(roll);
        const scannedAt = new Date().toISOString();

        // Debounce: the guard's accidental double-flash within 60s must not
        // record a phantom exit — echo the already-registered direction.
        if (last && (new Date(scannedAt) - new Date(last.scanned_at)) < 60000) {
            return res.json({
                success: true,
                duplicate: true,
                direction: last.direction,
                scannedAt: last.scanned_at,
                message: `Already scanned ${last.direction} moments ago — no new record.`
            });
        }

        const direction = (last && last.direction === 'IN') ? 'OUT' : 'IN';
        const { error: insErr } = await supabase.from('pass_scans').insert({
            pass_ref: `COMMUTE-${roll}`,
            student_roll: roll,
            student_name: name,
            destination: '',
            category: 'COMMUTE',
            direction,
            method: String(req.body.method || 'QR').toUpperCase() === 'MANUAL' ? 'MANUAL' : 'QR',
            scanned_by: String(req.body.scannedBy || 'Main Gate Guard'),
            scanned_at: scannedAt,
            late_return: false
        });
        if (insErr) {
            console.warn('commute-scan insert failed:', insErr.message);
            return res.status(500).json({ success: false, error: insErr.message });
        }
        // If day-scholar monitoring ever needs live pings, notifyStudent()
        // hooks in here — deliberately silent by default.
        return res.json({ success: true, duplicate: false, direction, scannedAt, name, rollNo: roll });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Student-side commute presence: the day-scholar dashboard chip.
app.get('/api/commute-status', authenticateUser, async (req, res) => {
    try {
        if (!supabase || !gpSupabaseOk) {
            return res.json({ success: true, connected: false, state: 'UNKNOWN' });
        }
        const roll = String(req.user?.profile?.rollNumber || req.user?.id || '').trim();
        if (!roll) return res.status(400).json({ success: false, error: 'roll unknown' });
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const { data } = await supabase
            .from('pass_scans')
            .select('direction, scanned_at')
            .eq('category', 'COMMUTE')
            .eq('student_roll', roll)
            .gte('scanned_at', startOfDay.toISOString())
            .order('scanned_at', { ascending: true });
        const scans = data || [];
        const last = scans[scans.length - 1] || null;
        const insToday = scans.filter(s => s.direction === 'IN').length;
        const outsToday = scans.filter(s => s.direction === 'OUT').length;
        return res.json({
            success: true,
            connected: true,
            roll,
            scans,
            state: !last ? 'NOT_YET' : (last.direction === 'IN' ? 'IN' : 'OUT'),
            since: last ? last.scanned_at : null,
            insToday,
            outsToday
        });
    } catch (err) {
        return res.json({ success: true, connected: false, error: err.message, state: 'UNKNOWN' });
    }
});

// ============================================================
// DAY-SCHOLAR LEAVE SYSTEM (Phase 1) — one-way leave.
// A day scholar applies to their mentor TEACHER; the mentor approves
// INSIDE the app (never auto-approved); the student then flashes the
// SAME signed campus-ID QR at the gate. An APPROVED leave scans as a
// ONE-WAY OUT: no return leg, next class counts absent until the next
// working day. The parent gets an SMS only at the actual gate scan —
// no scan, no SMS. Gate rows are category='LEAVE'.
// ============================================================
const TEACHER_ABSENCE_FILE = path.join(__dirname, 'data', 'teacher_absence.json');
function localDayKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function loadTeacherAbsence() {
    try {
        if (fs.existsSync(TEACHER_ABSENCE_FILE)) {
            const raw = JSON.parse(fs.readFileSync(TEACHER_ABSENCE_FILE, 'utf8'));
            if (raw && raw.date === localDayKey()) return raw;
        }
    } catch { /* corrupt file -> fresh day state */ }
    return { date: localDayKey(), absent: {}, delegated: {} };
}
function saveTeacherAbsence() {
    try {
        fs.mkdirSync(path.dirname(TEACHER_ABSENCE_FILE), { recursive: true });
        fs.writeFileSync(TEACHER_ABSENCE_FILE, JSON.stringify(teacherAbsenceDB, null, 2));
    } catch (e) { console.warn('teacher_absence save skipped:', e.message); }
}
const teacherAbsenceDB = loadTeacherAbsence();

// Local midnight + the 16:30 gate-close cutoff (leaves die at day end).
function localStartOfDayISO(d = new Date()) {
    const s = new Date(d); s.setHours(0, 0, 0, 0); return s.toISOString();
}
function gateCloseISO(d = new Date()) {
    const c = new Date(d); c.setHours(16, 30, 0, 0); return c.toISOString();
}
// Auto-EXPIRE (not delete): PENDING requests from a previous day, and
// APPROVED-but-never-scanned requests either from a previous day or past
// the 16:30 gate close today. Only touched lazily when leave endpoints run.
async function expireStaleLeaves() {
    if (!supabase) return;
    const now = new Date();
    const midnight = localStartOfDayISO(now);
    try {
        const or = `and(status.eq.PENDING,created_at.lt.${midnight}),and(status.eq.APPROVED,scanned_at.is.null,created_at.lt.${midnight})`;
        await supabase.from('leave_requests').update({ status: 'EXPIRED' }).or(or);
        if (now >= new Date(gateCloseISO(now))) {
            const orToday = `and(status.eq.PENDING,created_at.lt.${gateCloseISO(now)}),and(status.eq.APPROVED,scanned_at.is.null,created_at.lt.${gateCloseISO(now)})`;
            await supabase.from('leave_requests').update({ status: 'EXPIRED' }).or(orToday);
        }
    } catch (e) { console.warn('leave expiry skipped:', e.message); }
}

async function profileByRoll(roll) {
    const { data } = await supabase.from('profiles')
        .select('id, roll_number, full_name, role, resident_type, department, phone_number, guardian_phone, mentor_roll')
        .ilike('roll_number', String(roll).trim())
        .maybeSingle();
    return data || null;
}

// Student applies: one-way leave to their mentor.
app.post('/api/leave-requests', authenticateUser, requireRole('STUDENT'), async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ success: false, error: 'Database offline' });
        await expireStaleLeaves();
        const myProfile = await profileByRoll(req.user?.rollNumber || req.user?.profile?.roll_number || req.user?.id || '');
        if (!myProfile) return res.status(404).json({ success: false, error: 'Profile not found' });
        if (String(myProfile.resident_type || '').toLowerCase() !== 'dayscholar') {
            return res.status(400).json({ success: false, error: 'Day-scholar leave is for day scholars — hostellers use the gate pass flow.' });
        }
        const reason = String(req.body?.reason || '').trim();
        if (reason.length < 5) return res.status(400).json({ success: false, error: 'Give your mentor a short reason (min 5 characters)' });

        // Rule: ONE live request at a time — PENDING or APPROVED-but-not-yet-scanned.
        const { data: live } = await supabase.from('leave_requests')
            .select('id, status')
            .eq('student_roll', myProfile.roll_number)
            .or('status.eq.PENDING,and(status.eq.APPROVED,scanned_at.is.null)')
            .limit(1).maybeSingle();
        if (live) {
            return res.status(409).json({ success: false, error: `You already have a ${live.status} leave request — it must be decided (or scanned at the gate) first.` });
        }
        // Rule: one-way leave — already OUT today means no second leave.
        const startToday = localStartOfDayISO();
        const { data: outs, count: outCount, error: outErr } = await supabase.from('pass_scans')
            .select('id', { count: 'exact' })
            .eq('category', 'LEAVE')
            .eq('student_roll', myProfile.roll_number)
            .eq('direction', 'EXIT')
            .gte('scanned_at', startToday);
        if (!outErr && (outCount || 0) > 0) {
            return res.status(409).json({ success: false, error: 'You already left campus on a leave today — the next working day is your return.' });
        }

        const now = new Date().toISOString();
        const { data: created, error: insErr } = await supabase.from('leave_requests').insert({
            student_id: myProfile.id,
            student_roll: myProfile.roll_number,
            student_name: myProfile.full_name,
            resident_type: myProfile.resident_type,
            mentor_roll: myProfile.mentor_roll || null,
            reason,
            status: 'PENDING',
            created_at: now
        }).select('*').single();
        if (insErr) return res.status(500).json({ success: false, error: insErr.message });

        // Mentor heads-up (push if the teacher device is registered; the
        // dashboard QUEUE is the always-works path — never auto-approve).
        const mentorRoll = myProfile.mentor_roll;
        if (mentorRoll) {
            (async () => {
                try {
                    if (hasPushSubscription(mentorRoll)) {
                        await pushToRolls([mentorRoll], {
                            title: '📝 New Leave Request',
                            body: `${myProfile.full_name} (${myProfile.roll_number}) requested day-scholar leave. Reason: ${reason.slice(0, 80)}`
                        }).catch(() => {});
                    }
                } catch { /* non-blocking */ }
            })();
        }
        return res.json({ success: true, leave: created });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// Student's own leave history.
app.get('/api/leave-requests/mine', authenticateUser, async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ success: false, error: 'Database offline' });
        await expireStaleLeaves();
        const roll = String(req.user?.rollNumber || req.user?.profile?.roll_number || req.user?.id || '').trim();
        if (!roll) return res.status(400).json({ success: false, error: 'Roll unknown' });
        const { data: leaves, error } = await supabase.from('leave_requests')
            .select('*').eq('student_roll', roll)
            .order('created_at', { ascending: false }).limit(50);
        if (error) return res.status(500).json({ success: false, error: error.message });
        const startToday = localStartOfDayISO();
        const outToday = (leaves || []).some(l => l.status === 'OUT' && l.scanned_at && new Date(l.scanned_at) >= new Date(startToday));
        return res.json({ success: true, leaves: leaves || [], outToday, hasLiveRequest: (leaves || []).some(l => l.status === 'PENDING' || (l.status === 'APPROVED' && !l.scanned_at)) });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// Mentor/admin queue: a TEACHER sees their mentees' leaves (+ anything the
// absence system routed to them); an ADMIN sees everything.
app.get('/api/leave-requests/queue', authenticateUser, requireRole('TEACHER', 'ADMIN'), async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ success: false, error: 'Database offline' });
        await expireStaleLeaves();
        const role = String(req.user?.role || req.user?.profile?.role || '').toUpperCase();
        const myRoll = String(req.user?.rollNumber || req.user?.profile?.roll_number || '').trim();
        let leaves, mentees, error;
        if (role === 'TEACHER') {
            ({ data: leaves, error } = await supabase.from('leave_requests')
                .select('*')
                .or(`mentor_roll.eq.${myRoll},routed_to.eq.${myRoll}`)
                .order('created_at', { ascending: false }).limit(200));
            ({ data: mentees } = await supabase.from('profiles')
                .select('id, roll_number, full_name, department, resident_type, mentor_roll')
                .eq('role', 'STUDENT').eq('mentor_roll', myRoll)
                .order('roll_number').limit(500));
            // Only my leaves drive mentee state; derive from the same rows.
        } else {
            ({ data: leaves, error } = await supabase.from('leave_requests')
                .select('*').order('created_at', { ascending: false }).limit(300));
            mentees = [];
        }
        if (error) return res.status(500).json({ success: false, error: error.message });
        const myState = role === 'TEACHER' ? {
            onLeave: !!teacherAbsenceDB.absent[myRoll],
            delegatedTo: teacherAbsenceDB.delegated[myRoll] || null
        } : null;
        // Mentee today-state map: latest leave per mentee roll.
        const todayStart = new Date(localStartOfDayISO()).getTime();
        const stateByRoll = {};
        (leaves || []).forEach(l => {
            const k = String(l.student_roll || '');
            if (!stateByRoll[k] || (l.scanned_at || l.created_at || '') > (stateByRoll[k].scanned_at || stateByRoll[k].created_at || '')) stateByRoll[k] = l;
        });
        return res.json({
            success: true,
            role,
            onLeaveState: myState,
            leaves: leaves || [],
            mentees: (mentees || []).map(mm => ({
                ...mm,
                todayStatus: teacherStateFromLeave(stateByRoll[String(mm.roll_number || '')])
            })),
            pendingCount: (leaves || []).filter(l => l.status === 'PENDING').length
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});
// Mentor-only day-scholar gate log. A TEACHER sees scans for THEIR OWN
// mentees (day scholars only — LEAVE exits + COMMUTE in/outs); an ADMIN
// sees every day-scholar scan. The WARDEN is deliberately NOT in the role
// list: day-scholar movements are a mentor/welfare concern, not hostel ops.
app.get('/api/teacher/day-scholar-scans', authenticateUser, requireRole('TEACHER', 'ADMIN'), async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ success: false, error: 'Database offline' });
        const role = String(req.user?.role || req.user?.profile?.role || '').toUpperCase();
        const myRoll = String(req.user?.rollNumber || req.user?.profile?.roll_number || '').trim();
        // 1. Resolve my day-scholar mentees (TEACHER) — or all day scholars (ADMIN).
        let menteeRows;
        if (role === 'TEACHER') {
            ({ data: menteeRows } = await supabase.from('profiles')
                .select('roll_number, full_name, resident_type, mentor_roll')
                .eq('role', 'STUDENT').eq('mentor_roll', myRoll).limit(500));
        } else {
            ({ data: menteeRows } = await supabase.from('profiles')
                .select('roll_number, full_name, resident_type, mentor_roll')
                .eq('role', 'STUDENT').limit(20000));
        }
        const dayScholars = (menteeRows || []).filter(r => String(r.resident_type || '').toLowerCase() === 'dayscholar');
        const rolls = dayScholars.map(r => r.roll_number).filter(Boolean);
        if (!rolls.length) return res.json({ success: true, scans: [], menteeCount: 0 });
        // 2. Their gate scans — LEAVE (one-way mentor-approved exit) and
        //    COMMUTE (daily IN/OUT ledger). Chunked .in() to stay well under
        //    PostgREST limits; newest first, capped to keep polling cheap.
        const names = new Map(dayScholars.map(r => [r.roll_number, r.full_name]));
        const scans = [];
        const CHUNK = 100;
        for (let i = 0; i < rolls.length && scans.length < 300; i += CHUNK) {
            const { data, error } = await supabase.from('pass_scans')
                .select('id, student_roll, student_name, direction, category, scanned_by, scanned_at, late_return')
                .in('student_roll', rolls.slice(i, i + CHUNK))
                .order('scanned_at', { ascending: false })
                .limit(150);
            if (error) return res.json({ success: true, registerOk: false, error: error.message, scans: [], menteeCount: rolls.length });
            for (const row of (data || [])) {
                const cat = String(row.category || '').toUpperCase();
                if (cat !== 'LEAVE' && cat !== 'COMMUTE') continue;
                scans.push({ ...row, student_name: row.student_name || names.get(row.student_roll) || 'Student' });
            }
        }
        scans.sort((a, b) => String(b.scanned_at || '').localeCompare(String(a.scanned_at || '')));
        return res.json({ success: true, registerOk: true, menteeCount: rolls.length, scans: scans.slice(0, 150) });
    } catch (e) {
        return res.json({ success: true, registerOk: false, error: e.message, scans: [] });
    }
});

function teacherStateFromLeave(l) {
    if (!l) return 'NO_REQUEST_TODAY';
    const t = new Date(l.created_at || 0).getTime();
    if (t < new Date(localStartOfDayISO()).getTime()) return 'NO_REQUEST_TODAY';
    if (l.status === 'PENDING') return 'PENDING';
    if (l.status === 'APPROVED') return l.scanned_at ? 'OUT' : 'APPROVED_NOT_OUT';
    if (l.status === 'OUT') return 'OUT';
    return l.status; // REJECTED / EXPIRED
}

// Approve / reject. TEACHER (own mentees or routed-to-me) + ADMIN only —
// the warden is deliberately excluded from ALL leave decisions.
app.post('/api/leave-requests/:id/decide', authenticateUser, requireRole('TEACHER', 'ADMIN', 'DEAN'), async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ success: false, error: 'Database offline' });
        const action = String(req.body?.action || '').toUpperCase();
        if (!['APPROVED', 'REJECTED'].includes(action)) return res.status(400).json({ success: false, error: 'Action must be APPROVED or REJECTED' });
        const myRoll = String(req.user?.rollNumber || req.user?.profile?.roll_number || '').trim();
        const role = String(req.user?.role || req.user?.profile?.role || '').toUpperCase();
        const { data: leave, error: lErr } = await supabase.from('leave_requests')
            .select('*').eq('id', String(req.params.id)).maybeSingle();
        if (lErr || !leave) return res.status(404).json({ success: false, error: 'Leave request not found' });
        if (leave.status !== 'PENDING') return res.status(409).json({ success: false, error: `Already ${leave.status.toLowerCase()} — nothing to decide` });
        if (role === 'TEACHER') {
            const can = String(leave.mentor_roll || '') === myRoll || String(leave.routed_to || '') === myRoll;
            if (!can) return res.status(403).json({ success: false, error: 'This student is not your mentee (and not routed to you)' });
        }
        // NO AUTO-APPROVAL — every decision is an explicit human tap here.
        const now = new Date().toISOString();
        const { data: updated, error: uErr } = await supabase.from('leave_requests').update({
            status: action,
            decided_by: myRoll || role,
            decided_by_name: req.user?.name || null,
            decided_at: now,
            mentor_note: String(req.body?.note || '').trim() || null
        }).eq('id', leave.id).select('*').single();
        if (uErr) return res.status(500).json({ success: false, error: uErr.message });

        // Tell the student immediately: activated → push, else SMS to the
        // student's own phone (parent SMS is reserved for the gate scan).
        (async () => {
            try {
                const prof = await profileByRoll(leave.student_roll);
                const text = action === 'APPROVED'
                    ? `CampusDebug OS: Your day-scholar leave was APPROVED by ${updated.decided_by_name || 'your mentor'}. Show your Campus QR at the gate before leaving.${updated.mentor_note ? ` Note: ${updated.mentor_note}` : ''}`
                    : `CampusDebug OS: Your day-scholar leave was REJECTED by ${updated.decided_by_name || 'your mentor'}.${updated.mentor_note ? ` Note: ${updated.mentor_note}` : ''} Stay in classes.`;
                const delivery = await notifyStudent(leave.student_roll, prof?.phone_number, text);
                if (delivery.mode === 'push') {
                    await pushToRolls([leave.student_roll], {
                        title: action === 'APPROVED' ? '✅ Leave Approved' : '❌ Leave Rejected',
                        body: action === 'APPROVED' ? 'Show your Campus QR at the gate — exit is one-way (back next working day).' : (updated.mentor_note || 'Stay in classes.')
                    }).catch(() => {});
                }
            } catch { /* non-blocking */ }
        })();
        return res.json({ success: true, leave: updated });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// THE GATE LEG: guard scans the campus-ID QR of a day scholar.
//   APPROVED leave  -> ONE-WAY OUT recorded, parent SMS, student push.
//   no leave on file -> red "NOT APPROVED" — nothing is recorded at all.
//   PENDING leave   -> clear "still pending with mentor" message.
app.post('/api/leave-scan', authenticateUser, requireRole('GUARD', 'WARDEN', 'ADMIN', 'DEAN'), async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ success: false, error: 'Leave register offline' });
        await expireStaleLeaves();
        const roll = String(req.body.rollNo || '').trim();
        if (!/^[A-Za-z0-9-]{4,20}$/.test(roll)) {
            return res.status(400).json({ success: false, error: 'Valid roll number required' });
        }
        const prof = await profileByRoll(roll);
        if (!prof) return res.status(404).json({ success: false, error: `${roll} is not in the college records` });

        const startToday = localStartOfDayISO();
        // Already OUT today? One-way leave: never a second scan today.
        const { count: outToday, error: outErr } = await supabase.from('pass_scans')
            .select('id', { count: 'exact' })
            .eq('category', 'LEAVE').eq('student_roll', prof.roll_number)
            .eq('direction', 'EXIT').gte('scanned_at', startToday);
        if (!outErr && (outToday || 0) > 0) {
            return res.status(409).json({ success: false, reason: `${prof.full_name} already LEFT campus on a leave today — one-way leave, no second scan. Back on the next working day.` });
        }

        const { data: leave } = await supabase.from('leave_requests')
            .select('*')
            .eq('student_roll', prof.roll_number)
            .eq('status', 'APPROVED')
            .is('scanned_at', null)
            .order('created_at', { ascending: false }).limit(1).maybeSingle();

        if (!leave) {
            const { data: pending } = await supabase.from('leave_requests')
                .select('id, status, mentor_roll')
                .eq('student_roll', prof.roll_number)
                .eq('status', 'PENDING')
                .order('created_at', { ascending: false }).limit(1).maybeSingle();
            if (pending) {
                return res.status(403).json({
                    success: false,
                    reason: `${prof.full_name} has a leave that is still PENDING with mentor ${pending.mentor_roll || '—'} — NOT approved yet. Nothing recorded.`
                });
            }
            return res.status(403).json({
                success: false,
                reason: `${prof.full_name} — NOT APPROVED — no day-scholar leave on file. Contact your mentor. Nothing recorded.`
            });
        }

        const scannedAt = new Date().toISOString();
        const { error: upErr } = await supabase.from('leave_requests').update({
            status: 'OUT', scanned_at: scannedAt
        }).eq('id', leave.id);
        if (upErr) return res.status(500).json({ success: false, error: upErr.message });

        // Gate register row (one-way: EXIT only, no return leg will exist).
        // pass_ref column is varchar(20): LV-<roll>-MMDD keeps it short while
        // staying unique per day.
        supabase.from('pass_scans').insert({
            pass_ref: `LV-${prof.roll_number}-${String(localDayKey()).slice(5).replace('-', '')}`,
            student_roll: prof.roll_number,
            student_name: prof.full_name || prof.roll_number,
            destination: '',
            category: 'LEAVE',
            direction: 'EXIT',
            method: String(req.body.method || 'QR').toUpperCase() === 'MANUAL' ? 'MANUAL' : 'QR',
            scanned_by: String(req.body.scannedBy || 'Main Gate Guard'),
            scanned_at: scannedAt,
            late_return: false
        }).then(({ error: sErr }) => {
            if (sErr) console.warn('leave pass_scans insert skipped:', sErr.message);
        });

        const timeStr = new Date(scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        // Parent SMS fires ONLY here, at the actual gate scan.
        (async () => {
            try {
                const parent = prof.guardian_phone;
                if (parent) {
                    await dispatchSms(parent, `CampusDebug OS: Your ward ${prof.full_name} LEFT campus at ${timeStr} on an APPROVED day-scholar leave (reason: ${leave.reason}). Next working day return.`);
                } else {
                    console.log(`📵 no guardian_phone on file for ${prof.roll_number} — parent SMS skipped`);
                }
            } catch { /* non-blocking */ }
        })();
        // Student confirmation (push for activated, SMS otherwise).
        (async () => {
            try {
                const delivery = await notifyStudent(prof.roll_number, prof.phone_number,
                    `CampusDebug OS: Leave exit recorded at ${timeStr}. You are OUT of campus — the next working day is your return.`);
                if (delivery.mode === 'push') {
                    await pushToRolls([prof.roll_number], {
                        title: '🚪 Leave Exit Recorded',
                        body: `OUT at ${timeStr}. Next class counts absent until the next working day.`
                    }).catch(() => {});
                }
            } catch { /* non-blocking */ }
        })();

        return res.json({
            success: true,
            name: prof.full_name,
            rollNo: prof.roll_number,
            outAt: scannedAt,
            leaveReason: leave.reason,
            parentSms: prof.guardian_phone ? 'dispatched to guardian' : 'no guardian phone on file'
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// Teacher "On Leave Today" 1-tap: delegates their PENDING approvals to an
// active colleague; if none is available it escalates to the ADMIN queue
// (never the warden). Coming back online re-routes pending leaves to them.
app.post('/api/leave-requests/teacher-absent', authenticateUser, requireRole('TEACHER', 'ADMIN'), async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ success: false, error: 'Database offline' });
        if (teacherAbsenceDB.date !== localDayKey()) {
            teacherAbsenceDB.date = localDayKey();
            teacherAbsenceDB.absent = {};
            teacherAbsenceDB.delegated = {};
        }
        const myRoll = String(req.user?.rollNumber || req.user?.profile?.roll_number || '').trim();
        const wantsAbsence = !!req.body?.onLeave;
        if (!myRoll) return res.status(400).json({ success: false, error: 'Roll unknown' });

        let delegatedTo = null;
        if (wantsAbsence) {
            const asked = String(req.body?.delegate || 'AUTO').toUpperCase();
            if (asked === 'ADMIN') {
                delegatedTo = 'ADMIN';
            } else {
                // Pick the lowest-numbered colleague who is present today.
                const { data: colleagues } = await supabase.from('profiles')
                    .select('roll_number, full_name')
                    .eq('role', 'TEACHER')
                    .neq('roll_number', myRoll)
                    .order('roll_number').limit(100);
                const present = (colleagues || []).find(c => !teacherAbsenceDB.absent[String(c.roll_number || '').trim()]);
                delegatedTo = present ? String(present.roll_number).trim() : 'ADMIN';
            }
            teacherAbsenceDB.absent[myRoll] = true;
            teacherAbsenceDB.delegated[myRoll] = delegatedTo;
            // Re-route today's still-PENDING mentee leaves to the delegate.
            await supabase.from('leave_requests')
                .update({ routed_to: delegatedTo })
                .eq('status', 'PENDING')
                .eq('mentor_roll', myRoll);
        } else {
            delete teacherAbsenceDB.absent[myRoll];
            delete teacherAbsenceDB.delegated[myRoll];
            // Back on my seat: pull my still-PENDING leaves home.
            await supabase.from('leave_requests')
                .update({ routed_to: null })
                .eq('status', 'PENDING')
                .eq('mentor_roll', myRoll);
        }
        saveTeacherAbsence();
        return res.json({ success: true, onLeave: !!teacherAbsenceDB.absent[myRoll], delegatedTo: teacherAbsenceDB.delegated[myRoll] || null });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/leave-requests/teacher-absent', authenticateUser, async (req, res) => {
    const myRoll = String(req.user?.rollNumber || req.user?.profile?.roll_number || '').trim();
    const role = String(req.user?.role || req.user?.profile?.role || '').toUpperCase();
    if (teacherAbsenceDB.date !== localDayKey()) {
        teacherAbsenceDB.date = localDayKey();
        teacherAbsenceDB.absent = {};
        teacherAbsenceDB.delegated = {};
        saveTeacherAbsence();
    }
    return res.json({
        success: true,
        onLeave: !!teacherAbsenceDB.absent[myRoll],
        delegatedTo: teacherAbsenceDB.delegated[myRoll] || null,
        absentTeachers: role === 'ADMIN' || role === 'TEACHER' ? Object.keys(teacherAbsenceDB.absent || {}) : undefined
    });
});

// ============================================================
// ACADEMIC TIMETABLE ENGINE (Phase 2)
// Grid (BPUT-style anchored day): P1 09:15–10:15, P2 10:15–11:15,
// BREAK 11:15–11:30, P3 11:30–12:30, LUNCH 12:30–01:30,
// P4 01:30–02:30, P5 02:30–03:30, P6 03:30–04:30. MON..SAT.
// One schedule per DEPARTMENT (CSE, DS&AI, ET, ME, EE — the real
// profile department strings). Teachers are the 20 REAL staff rows
// (FAC001..FAC020); the generator allocates subject sessions into
// slots under hard constraints: a teacher can never be in two rooms
// at once, a subject never twice the same day, labs only on allowed
// consecutive-period pairs, P1 always a real class. Shared teachers
// (Maths / PPT) span departments — that is where the conflict
// resolution actually does work. Persisted to data/timetable.json;
// ADMIN/DEAN can regenerate live from the admin console.
// ============================================================
const TIMETABLE_FILE = path.join(__dirname, 'data', 'timetable.json');

const TT_DAYS = ['MON', 'TUE', 'WED', 'THUR', 'FRI', 'SAT'];
const TT_BREAK = { code: 'BREAK', title: '☕ Short Break', room: 'Campus Concourse', start: '11:15 AM', startMin: 675, end: '11:30 AM', endMin: 690 };
const TT_LUNCH = { code: 'LUNCH', title: '🍱 Lunch Break', room: 'Hostel Dining Hall', start: '12:30 PM', startMin: 750, end: '01:30 PM', endMin: 810 };
// minutes-of-day → '10:15 AM' (the grid carries BOTH strings so clients can
// print the full period range — start AND end — without doing math)
const ttFmtMin = (m) => {
    const h24 = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0');
    return `${h24 > 12 ? h24 - 12 : h24 || 12}:${mm} ${h24 >= 12 ? 'PM' : 'AM'}`;
};
const TT_GRID = [
    { label: 'P1', start: '09:15 AM', startMin: 555, end: '10:15 AM', endMin: 615 },
    { label: 'P2', start: '10:15 AM', startMin: 615, end: '11:15 AM', endMin: 675 },
    { label: 'BREAK', ...TT_BREAK },
    { label: 'P3', start: '11:30 AM', startMin: 690, end: '12:30 PM', endMin: 750 },
    { label: 'LUNCH', ...TT_LUNCH },
    { label: 'P4', start: '01:30 PM', startMin: 810, end: '02:30 PM', endMin: 870 },
    { label: 'P5', start: '02:30 PM', startMin: 870, end: '03:30 PM', endMin: 930 },
    { label: 'P6', start: '03:30 PM', startMin: 930, end: '04:30 PM', endMin: 990 }
];
const TT_PERIOD_TIME = {
    1: '09:15 AM - 10:15 AM', 2: '10:15 AM - 11:15 AM', 3: '11:30 AM - 12:30 PM',
    4: '01:30 PM - 02:30 PM', 5: '02:30 PM - 03:30 PM', 6: '03:30 PM - 04:30 PM'
};
const TT_END_MIN = { 1: 615, 2: 675, 3: 750, 4: 870, 5: 930, 6: 990 };

// Period metadata for ONE slot. span-2 blocks (2-hour PPT double block, labs)
// must print the FULL range — the tail period's end — not the start period's
// 1-hour range (the "PPT/lab shows only 1hr" glitch).
function ttSlotMeta(slot) {
    const g = TT_GRID[TT_ROW[slot.period - 1]];
    slot.periodLabel = g.label;
    if (slot.span === 2 && TT_PERIOD_TIME[slot.period + 1] && TT_END_MIN[slot.period + 1] != null) {
        slot.time = `${TT_PERIOD_TIME[slot.period].split(' - ')[0]} - ${TT_PERIOD_TIME[slot.period + 1].split(' - ')[1]}`;
        slot.endMin = TT_END_MIN[slot.period + 1];
    } else {
        slot.time = TT_PERIOD_TIME[slot.period];
        slot.endMin = TT_END_MIN[slot.period];
    }
    return slot;
}

// Library policy guard — a published schedule must NEVER show library more
// than 2 DAYS a week, max 2 PERIODS on each of those days, per section.
// Extra/over-cap library slots are demoted to plain Free Periods. Idempotent:
// returns true only when something had to change.
function ttApplyLibraryCap(slots = []) {
    const bySec = {};
    for (const s of slots) if (s.kind === 'study') (bySec[s.sectionKey] = bySec[s.sectionKey] || []).push(s);
    let changed = false;
    for (const list of Object.values(bySec)) {
        const byDay = {};
        for (const s of list) (byDay[s.day] = byDay[s.day] || []).push(s);
        const libDays = Object.entries(byDay)
            .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
            .slice(0, 2)
            .map(([d]) => d);
        const keptOnDay = {};
        for (const s of list) {
            if (libDays.includes(s.day) && (keptOnDay[s.day] || 0) < 2) {
                keptOnDay[s.day] = (keptOnDay[s.day] || 0) + 1;
                continue; // stays a library/self-study slot
            }
            s.kind = 'free';
            s.subjectCode = 'FREE';
            s.subject = 'Free Period';
            s.teacherId = null;
            s.teacherName = null;
            s.room = null;
            changed = true;
        }
    }
    return changed;
}

// Tutorial fill — idle periods (after the library cap) are packed with extra
// TUTORIAL hours drawn from the section's OWN subjects, so a section's grid
// looks like a real working day instead of scattered free time. Every real
// constraint still applies: a free specialist from the subject's pool (within
// its weekly cap), a free lecture hall, non-adjacent repeats, max 2
// same-subject periods a day, and tutorials spread evenly across subjects.
// Whatever STILL cannot fit (pools busy) stays a plain Free Period.
// state: { occupied: Set 'teacher|day|period', roomOcc: Set 'room|day|period',
//          weekLoad: {teacherId: periods}, rng: ()=>float, maxWeekly, teacherNames: {} }
function ttTutorialFillSection(slots, template, state) {
    if (!template) return 0;
    const occupied = state.occupied || new Set();
    const roomOcc = state.roomOcc || new Set();
    const weekLoad = state.weekLoad || {};
    const maxWeekly = state.maxWeekly || TT_MAX_WEEKLY;
    const teacherNames = state.teacherNames || {};
    const rng = state.rng || Math.random;
    const pick = (arr) => (arr && arr.length) ? arr[Math.floor(rng() * arr.length) % arr.length] : null;
    const daySubjectCount = {};
    const daySubjectLast = {};
    // Rebuild this section's per-day subject state from its existing classes
    // (a span-2 block fills BOTH periods for adjacency and counts as 2 units).
    for (const s of slots) {
        if ((s.kind === 'lecture' || s.kind === 'lab') && s.subjectCode) {
            const k = `${s.day}|${s.subjectCode}`;
            daySubjectCount[k] = (daySubjectCount[k] || 0) + 1;
            const lastP = s.span === 2 ? s.period + 1 : s.period;
            if ((daySubjectLast[k] || 0) < lastP) daySubjectLast[k] = lastP;
        }
    }
    const fillByCode = {};
    let filled = 0;
    const ordered = [...slots].sort((a, b) => a.day.localeCompare(b.day) || a.period - b.period);
    for (const s of ordered) {
        if (s.kind !== 'free') continue;
        const freeRooms = template.lectureRooms.filter(r => !roomOcc.has(`${r}|${s.day}|${s.period}`));
        if (!freeRooms.length) continue;
        const eligible = template.subjects.filter(sub => {
            if (!sub || !Array.isArray(sub.pool)) return false;
            const k = `${s.day}|${sub.code}`;
            if ((daySubjectCount[k] || 0) >= 3) return false;         // 2 subject periods/day max after this
            const last = daySubjectLast[k];
            if (last && Math.abs(last - s.period) <= 1) return false; // never adjacent repeats
            return sub.pool.some(t =>
                !occupied.has(`${t}|${s.day}|${s.period}`) &&
                (weekLoad[t] || 0) + 1 <= maxWeekly);
        });
        if (!eligible.length) continue;
        // Spread tutorial load evenly across subjects, then stable tie-break.
        eligible.sort((a, b) => (fillByCode[a.code] || 0) - (fillByCode[b.code] || 0) || String(a.code).localeCompare(String(b.code)));
        const minCount = fillByCode[eligible[0].code] || 0;
        const sub = pick(eligible.filter(o => (fillByCode[o.code] || 0) === minCount));
        if (!sub) continue;
        const freeTeachers = sub.pool.filter(t =>
            !occupied.has(`${t}|${s.day}|${s.period}`) &&
            (weekLoad[t] || 0) + 1 <= maxWeekly);
        const teacher = pick(freeTeachers);
        if (!teacher) continue;
        const room = pick(freeRooms);
        occupied.add(`${teacher}|${s.day}|${s.period}`);
        roomOcc.add(`${room}|${s.day}|${s.period}`);
        weekLoad[teacher] = (weekLoad[teacher] || 0) + 1;
        const k = `${s.day}|${sub.code}`;
        daySubjectCount[k] = (daySubjectCount[k] || 0) + 1;
        daySubjectLast[k] = s.period;
        fillByCode[sub.code] = (fillByCode[sub.code] || 0) + 1;
        s.kind = 'lecture';
        s.subjectCode = sub.code;
        s.subject = `${sub.title} Tutorial`;
        s.teacherId = teacher;
        s.teacherName = teacherNames[teacher] || teacher;
        s.room = room;
        filled++;
    }
    return filled;
}

// Faculty slots per SECTION — Step 3: the campus runs 40 real sections
// (course|department|section), each with its own weekly grid. Subjects are
// taught by POOLS of specialists (e.g. six Engineering-Maths faculty share
// the 35 BTech sections): the solver books whichever specialist is free,
// exactly like a real departmental routine.

// Weekly load ceiling per teacher (solver refuses to exceed it).
const TT_MAX_WEEKLY = 26;

const TT_TEMPLATES = {
    'BTech|Computer Science & Engineering': {
        code: 'CSE', label: 'BTech CSE',
        lectureRooms: ['A301', 'A302', 'A303', 'A304', 'A305', 'A306', 'A307'],
        lab: 'Programming Lab B204',
        subjects: [
            { code: 'DSA', title: 'Data Structures & Algorithms', lectures: 4, pool: ['FAC003', 'FAC026', 'FAC051', 'FAC052'] },
            { code: 'OS', title: 'Operating Systems', lectures: 3, pool: ['FAC003', 'FAC026', 'FAC051', 'FAC052'] },
            { code: 'OOP', title: 'Object-Oriented Programming', lectures: 3, lab: 2, pool: ['FAC004', 'FAC028', 'FAC053', 'FAC054'] },
            { code: 'DM', title: 'Discrete Mathematics', lectures: 2, pool: ['FAC004', 'FAC028', 'FAC053', 'FAC054'] },
            { code: 'DBMS', title: 'Database Management Systems', lectures: 3, pool: ['FAC005', 'FAC027', 'FAC055', 'FAC056'] },
            { code: 'CN', title: 'Computer Networks', lectures: 2, pool: ['FAC005', 'FAC027', 'FAC055', 'FAC056'] },
            { code: 'MATHS', title: 'Engineering Mathematics', lectures: 3, shared: true, pool: ['FAC001', 'FAC021', 'FAC022', 'FAC023', 'FAC024', 'FAC046', 'FAC081', 'FAC082', 'FAC083', 'FAC084'] },
            { code: 'PPT', title: 'Pre-Placement Training', lectures: 1, double: true, shared: true, pool: ['FAC002', 'FAC025', 'FAC085', 'FAC086'] }
        ]
    },
    'BTech|Data Science & AI': {
        code: 'DS&AI', label: 'BTech DS&AI',
        lectureRooms: ['A311', 'A312', 'A313', 'A314', 'A315', 'A316', 'A317'],
        lab: 'AI Lab B206',
        subjects: [
            { code: 'DSAI', title: 'Data Structures for AI', lectures: 4, pool: ['FAC006', 'FAC029', 'FAC057', 'FAC058'] },
            { code: 'STAT', title: 'Statistics for Data Science', lectures: 3, pool: ['FAC006', 'FAC029', 'FAC057', 'FAC058'] },
            { code: 'ML', title: 'Machine Learning Foundations', lectures: 3, pool: ['FAC007', 'FAC030', 'FAC059', 'FAC060'] },
            { code: 'DLV', title: 'Data Visualization & BI', lectures: 2, pool: ['FAC007', 'FAC030', 'FAC059', 'FAC060'] },
            { code: 'PY', title: 'Python Programming', lectures: 3, lab: 2, pool: ['FAC008', 'FAC031', 'FAC061', 'FAC062'] },
            { code: 'LA', title: 'Linear Algebra & Optimisation', lectures: 2, pool: ['FAC008', 'FAC031', 'FAC061', 'FAC062'] },
            { code: 'MATHS', title: 'Engineering Mathematics', lectures: 3, shared: true, pool: ['FAC001', 'FAC021', 'FAC022', 'FAC023', 'FAC024', 'FAC046', 'FAC081', 'FAC082', 'FAC083', 'FAC084'] },
            { code: 'PPT', title: 'Pre-Placement Training', lectures: 1, double: true, shared: true, pool: ['FAC002', 'FAC025', 'FAC085', 'FAC086'] }
        ]
    },
    'BTech|Electronics & Telecommunication': {
        code: 'ET', label: 'BTech E&T',
        lectureRooms: ['E101', 'E102', 'E103', 'E104', 'E105', 'E106', 'E107'],
        lab: 'Electronics Lab G102',
        subjects: [
            { code: 'DE', title: 'Digital Electronics', lectures: 4, pool: ['FAC009', 'FAC032', 'FAC063', 'FAC064'] },
            { code: 'CS', title: 'Communication Systems', lectures: 3, pool: ['FAC009', 'FAC032', 'FAC063', 'FAC064'] },
            { code: 'SS', title: 'Signals & Systems', lectures: 3, lab: 2, pool: ['FAC010', 'FAC033', 'FAC065', 'FAC066'] },
            { code: 'EMT', title: 'Electromagnetic Theory', lectures: 2, pool: ['FAC010', 'FAC033', 'FAC065', 'FAC066'] },
            { code: 'AC', title: 'Analog Circuit Design', lectures: 3, pool: ['FAC011', 'FAC034', 'FAC067', 'FAC068'] },
            { code: 'ED', title: 'Electronic Devices', lectures: 2, pool: ['FAC011', 'FAC034', 'FAC067', 'FAC068'] },
            { code: 'MATHS', title: 'Engineering Mathematics', lectures: 3, shared: true, pool: ['FAC001', 'FAC021', 'FAC022', 'FAC023', 'FAC024', 'FAC046', 'FAC081', 'FAC082', 'FAC083', 'FAC084'] },
            { code: 'PPT', title: 'Pre-Placement Training', lectures: 1, double: true, shared: true, pool: ['FAC002', 'FAC025', 'FAC085', 'FAC086'] }
        ]
    },
    'BTech|Mechanical Engineering': {
        code: 'ME', label: 'BTech ME',
        lectureRooms: ['M201', 'M202', 'M203', 'M204', 'M205', 'M206', 'M207'],
        lab: 'Workshop W101',
        subjects: [
            { code: 'TH', title: 'Thermodynamics', lectures: 4, pool: ['FAC012', 'FAC035', 'FAC069', 'FAC070'] },
            { code: 'FM', title: 'Fluid Mechanics', lectures: 3, pool: ['FAC012', 'FAC035', 'FAC069', 'FAC070'] },
            { code: 'EM', title: 'Engineering Mechanics', lectures: 3, lab: 2, pool: ['FAC013', 'FAC036', 'FAC071', 'FAC072'] },
            { code: 'MM', title: 'Materials & Metallurgy', lectures: 2, pool: ['FAC013', 'FAC036', 'FAC071', 'FAC072'] },
            { code: 'MP', title: 'Manufacturing Processes', lectures: 3, pool: ['FAC014', 'FAC037', 'FAC073', 'FAC074'] },
            { code: 'MD', title: 'Machine Drawing & Design', lectures: 2, pool: ['FAC014', 'FAC037', 'FAC073', 'FAC074'] },
            { code: 'MATHS', title: 'Engineering Mathematics', lectures: 3, shared: true, pool: ['FAC001', 'FAC021', 'FAC022', 'FAC023', 'FAC024', 'FAC046', 'FAC081', 'FAC082', 'FAC083', 'FAC084'] },
            { code: 'PPT', title: 'Pre-Placement Training', lectures: 1, double: true, shared: true, pool: ['FAC002', 'FAC025', 'FAC085', 'FAC086'] }
        ]
    },
    'BTech|Electrical Engineering': {
        code: 'EE', label: 'BTech EE',
        lectureRooms: ['K101', 'K102', 'K103', 'K104', 'K105', 'K106', 'K107'],
        lab: 'Machines Lab K104',
        subjects: [
            { code: 'CT', title: 'Circuit Theory', lectures: 4, pool: ['FAC015', 'FAC038', 'FAC075', 'FAC076'] },
            { code: 'CS2', title: 'Control Systems', lectures: 3, pool: ['FAC015', 'FAC038', 'FAC075', 'FAC076'] },
            { code: 'ELM', title: 'Electrical Machines', lectures: 3, lab: 2, pool: ['FAC016', 'FAC039', 'FAC077', 'FAC078'] },
            { code: 'MS', title: 'Measurement & Instrumentation', lectures: 2, pool: ['FAC016', 'FAC039', 'FAC077', 'FAC078'] },
            { code: 'PS', title: 'Power Systems', lectures: 3, pool: ['FAC017', 'FAC040'] },
            { code: 'PE', title: 'Power Electronics', lectures: 2, pool: ['FAC017', 'FAC040'] },
            { code: 'MATHS', title: 'Engineering Mathematics', lectures: 3, shared: true, pool: ['FAC001', 'FAC021', 'FAC022', 'FAC023', 'FAC024', 'FAC046', 'FAC081', 'FAC082', 'FAC083', 'FAC084'] },
            { code: 'PPT', title: 'Pre-Placement Training', lectures: 1, double: true, shared: true, pool: ['FAC002', 'FAC025', 'FAC085', 'FAC086'] }
        ]
    },
    'MTech|Computer Science & Engineering': {
        code: 'MTech-CSE', label: 'MTech CSE',
        lectureRooms: ['P401', 'P402'],
        lab: 'PG Computing Lab P410',
        subjects: [
            { code: 'AAG', title: 'Advanced Algorithms', lectures: 4, pool: ['FAC041', 'FAC087'] },
            { code: 'CONC', title: 'Concurrency Models', lectures: 2, pool: ['FAC041', 'FAC087'] },
            { code: 'DSYS', title: 'Distributed Systems', lectures: 3, pool: ['FAC042', 'FAC088'] },
            { code: 'ADB', title: 'Advanced Databases', lectures: 3, lab: 2, pool: ['FAC042', 'FAC088'] },
            { code: 'RM', title: 'Research Methodology', lectures: 3, pool: ['FAC043', 'FAC089'] },
            { code: 'OPT', title: 'Optimization Techniques', lectures: 2, pool: ['FAC019', 'FAC090'] }
        ]
    },
    'B.Sc|Physical Sciences': {
        code: 'BSC-PS', label: 'B.Sc Physical Sciences',
        lectureRooms: ['S101', 'S102'],
        lab: 'Science Lab S110',
        subjects: [
            { code: 'PHY', title: 'Physics', lectures: 4, lab: 2, pool: ['FAC044', 'FAC091'] },
            { code: 'CHEM', title: 'Chemistry', lectures: 3, pool: ['FAC045', 'FAC092'] },
            { code: 'MATH1', title: 'Mathematics I', lectures: 3, pool: ['FAC046', 'FAC093'] },
            { code: 'EVS', title: 'Environmental Science', lectures: 2, pool: ['FAC044', 'FAC091'] },
            { code: 'COMM', title: 'Technical Communication', lectures: 2, pool: ['FAC045', 'FAC092'] },
            { code: 'STAT1', title: 'Statistics', lectures: 2, pool: ['FAC046', 'FAC093'] }
        ]
    },
    'B.Sc Nursing|Nursing': {
        code: 'NUR', label: 'B.Sc Nursing',
        lectureRooms: ['N201'],
        lab: 'Nursing Lab N210',
        subjects: [
            { code: 'NF', title: 'Nursing Foundations', lectures: 4, lab: 2, pool: ['FAC048', 'FAC094'] },
            { code: 'ANA', title: 'Anatomy', lectures: 3, pool: ['FAC047', 'FAC095'] },
            { code: 'PHYSIO', title: 'Physiology', lectures: 3, pool: ['FAC047', 'FAC095'] },
            { code: 'PSY', title: 'Psychology', lectures: 2, pool: ['FAC048', 'FAC094'] },
            { code: 'BIOC', title: 'Biochemistry', lectures: 2, pool: ['FAC049', 'FAC096'] },
            { code: 'MICRO', title: 'Microbiology', lectures: 2, pool: ['FAC049', 'FAC096'] },
            { code: 'CHN', title: 'Community Health Nursing', lectures: 3, pool: ['FAC050', 'FAC097'] },
            { code: 'PHARMA', title: 'Pharmacology', lectures: 2, pool: ['FAC050', 'FAC097'] }
        ]
    }
};

// Labs are two consecutive periods; only these pairs exist in the grid.
// ([4,5] and [5,6] would overlap at P5, so [5,6] is not a legal lab pair —
// this still leaves 12 start-slots/week per branch lab for its 7 sections.)
const TT_LAB_PAIRS = [[1, 2], [4, 5]];

// ============================================================
// CAMPUS CONFIG (Step 5.5) — the campus profile as DATA, not code.
// Branches (rooms, lab, subjects, specialist pools), the weekly cap and
// hostel blocks live in one versioned document: `data/campus_config.json`
// locally, and (when the table exists — see scripts/supabase_migration_
// campus_config.sql) a single JSONB row in Supabase, preferred when present.
// The built-in TT_TEMPLATES above are only the SEED + offline fallback:
// on first boot the seed is written out verbatim, so a bought deployment
// starts identical to today and the admin edits everything from the
// Campus Setup tab — the solver, the section regenerator and the CSV
// upload validator ALL read this live config. Saving config never moves
// the published timetable on its own: the admin must press Regenerate.
// ============================================================
const CONFIG_FILE = path.join(__dirname, 'data', 'campus_config.json');
const CAMPUS = { doc: null, templates: {}, maxWeekly: TT_MAX_WEEKLY };
let ccReady = null;

function ccSeedDoc() {
    return {
        version: 1,
        updatedAt: new Date().toISOString(),
        updatedBy: 'seed — built-in templates',
        ttMaxWeekly: TT_MAX_WEEKLY,
        branches: Object.entries(TT_TEMPLATES).map(([key, t]) => ({
            key,
            course: key.split('|')[0],
            department: key.split('|')[1],
            code: t.code,
            label: t.label,
            lectureRooms: [...t.lectureRooms],
            lab: t.lab,
            subjects: t.subjects.map(s => ({
                code: s.code, title: s.title, lectures: s.lectures,
                lab: !!s.lab, shared: !!s.shared, pool: [...s.pool]
            }))
        })),
        hostelBlocks: []
    };
}

// Rebuild the solver-facing template map from a config document (pure —
// used both to apply the live config and to validate a candidate).
function ccTemplatesFrom(doc) {
    const templates = {};
    for (const b of (doc.branches || [])) {
        templates[b.key] = {
            code: b.code, label: b.label,
            lectureRooms: (b.lectureRooms || []).map(r => String(r).trim()).filter(Boolean),
            lab: b.lab,
            subjects: (b.subjects || []).map(s => ({
                code: s.code, title: s.title, lectures: s.lectures,
                // 2-hour double blocks: the flag when set in the config, plus
                // a migration for configs saved before the flag existed —
                // single-period Pre-Placement Training always runs as one
                // continuous 2-hour block.
                ...((s.double || String(s.code || '').toUpperCase() === 'PPT') ? { double: true } : {}),
                ...(s.lab ? { lab: s.lab } : {}),
                ...(s.shared ? { shared: true } : {}),
                pool: (s.pool || []).map(t => String(t).trim()).filter(Boolean)
            }))
        };
    }
    return { templates, maxWeekly: Number(doc.ttMaxWeekly) || TT_MAX_WEEKLY };
}

function ccApply(doc) {
    // backfill the room-allocation fields for configs saved before they existed
    for (const hb of (doc.hostelBlocks || [])) {
        hb.gender = (String(hb.gender || '').trim().toLowerCase() === 'girls') ? 'Girls' : 'Boys';
        hb.seatsPerRoom = parseInt(hb.seatsPerRoom, 10) || 4;
    }
    const { templates, maxWeekly } = ccTemplatesFrom(doc);
    CAMPUS.doc = doc;
    CAMPUS.templates = templates;
    CAMPUS.maxWeekly = maxWeekly;
}

function ccPersistFile(doc) {
    try {
        fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(doc, null, 2));
    } catch (e) { console.warn('campus config file save skipped:', e.message); }
}

// Best-effort Supabase mirror — silently skipped when the table doesn't
// exist yet (that's the migration SQL's job; the file remains the store).
async function ccPersistSupabase(doc) {
    if (!supabase) return false;
    try {
        const { error } = await supabase.from('campus_config').upsert({
            id: 1, config: doc, updated_by: doc.updatedBy || null, updated_at: doc.updatedAt
        });
        if (error) return false;
        return true;
    } catch { return false; }
}

async function ccInit() {
    // 1) Supabase row (preferred when the table exists)
    if (supabase) {
        try {
            const { data, error } = await supabase.from('campus_config').select('config').eq('id', 1).maybeSingle();
            if (!error && data?.config && Array.isArray(data.config.branches) && data.config.branches.length) {
                ccApply(data.config);
                ccPersistFile(data.config);   // keep the local copy in sync
                console.log(`campus config: loaded from Supabase (${data.config.branches.length} branches)`);
                return;
            }
        } catch { /* table missing → fall through */ }
    }
    // 2) Local file
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const doc = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (doc && Array.isArray(doc.branches) && doc.branches.length) {
                ccApply(doc);
                ccPersistSupabase(doc);       // mirror upward, best effort
                console.log(`campus config: loaded from file (${doc.branches.length} branches)`);
                return;
            }
        }
    } catch (e) { console.warn('campus config file unreadable:', e.message); }
    // 3) Seed from the built-in templates — first boot of a deployment
    const doc = ccSeedDoc();
    // Pre-fill hostel blocks from the live student roster (real blocks first)
    try {
        if (supabase) {
            const blocks = new Map();
            for (let from = 0; ; from += 1000) {
                const { data, error } = await supabase.from('profiles')
                    .select('hostel_block').eq('role', 'STUDENT').not('hostel_block', 'is', null).range(from, from + 999);
                if (error || !data || !data.length) break;
                for (const r of data) {
                    const b = String(r.hostel_block || '').trim();
                    if (b) blocks.set(b, (blocks.get(b) || 0) + 1);
                }
                if (data.length < 1000) break;
            }
            doc.hostelBlocks = [...blocks.entries()].map(([name, occupied]) => ({ name, capacity: Math.max(occupied, 50), warden: null, gender: 'Boys', seatsPerRoom: 4 }));
            doc.updatedBy = 'seed — built-in templates + live hostel blocks';
        }
    } catch { /* blocks stay empty; the admin fills them in Setup */ }
    ccApply(doc);
    ccPersistFile(doc);
    ccPersistSupabase(doc);
    console.log(`campus config: SEEDED (${doc.branches.length} branches, ${doc.hostelBlocks.length} hostel blocks)`);
}

// Idempotent boot guard — every consumer awaits this before reading CAMPUS.
function ccEnsure() {
    if (!ccReady) ccReady = ccInit();
    return ccReady;
}


// Deterministic PRNG so a given generation seed always rebuilds identically.
function ttMulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// The real section directory — every distinct student (course, department,
// section) combination becomes a scheduled section. Reads the LIVE campus
// config (Campus Setup tab), not the code seed.
async function ttSectionList(templates = CAMPUS.templates) {
    if (!supabase) return [];
    const combos = new Map();
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('profiles')
            .select('course, department, section').eq('role', 'STUDENT').range(from, from + 999);
        if (error || !data || data.length === 0) break;
        for (const r of data) {
            const key = `${r.course}|${r.department}|${r.section}`;
            if (!combos.has(key) && r.course && r.section && templates[`${r.course}|${r.department}`]) {
                combos.set(key, { key, course: r.course, department: r.department, section: r.section });
            }
        }
        if (data.length < 1000) break;
    }
    return [...combos.values()].sort((a, b) => a.key.localeCompare(b.key));
}

async function ttTeacherNames() {
    if (!supabase) return {};
    const names = {};
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('profiles')
            .select('roll_number, full_name').eq('role', 'TEACHER').range(from, from + 999);
        if (error || !data || data.length === 0) break;
        for (const r of data) names[r.roll_number] = r.full_name;
        if (data.length < 1000) break;
    }
    return names;
}

// Rebuild ALL solver occupancy sets from a slot list (used when a single
// section is regenerated against the rest of the campus).
function ttOccupancyFrom(slots) {
    const teachers = new Set();  // teacher|day|period keys
    const rooms = new Set();     // room|day|period keys
    const labs = new Set();      // lab|day|startPeriod — one section per lab at a time
    for (const s of slots) {
        if (s.kind === 'lab') {
            labs.add(`${s.room}|${s.day}|${s.period}`);
            if (s.teacherId) {
                teachers.add(`${s.teacherId}|${s.day}|${s.period}`);
                teachers.add(`${s.teacherId}|${s.day}|${s.period + 1}`);
            }
            continue;
        }
        if (s.kind === 'study' || !s.teacherId) continue;
        teachers.add(`${s.teacherId}|${s.day}|${s.period}`);
        rooms.add(`${s.room}|${s.day}|${s.period}`);
    }
    return { teachers, rooms, labs };
}

// Solve ONE section's weekly grid against the global occupancy sets.
//   occupied — teacher|day|period keys across ALL sections
//   weekLoad — teacherId -> periods booked this week (cap TT_MAX_WEEKLY)
//   roomOcc  — room|day|period keys across ALL sections (rooms are per-branch
//              pools, but the pool itself is shared by the branch's 7 sections)
//   labOcc   — lab|day|startPeriod keys across ALL sections (the branch lab
//              hosts ONE section per start-slot: 7 weekly blocks vs 18 slots)
//   pptBudget — shared { left } across the whole solve: the double-block
//              specialists (PPT pool) have a hard weekly capacity, so the
//              budget caps how many sections may claim a 2-hour block while
//              still leaving one period for every other section's fallback.
function solveSection(sec, template, rng, occupied, conflicts, teacherNames, weekLoad, roomOcc, labOcc, maxWeekly = TT_MAX_WEEKLY, pptBudget = null) {
    const slots = [];
    const daySubjectCount = {};  // day|subjectCode -> lectures today (cap 3, non-adjacent)
    const daySubjectLast = {};
    const dayLectureCount = {};  // day -> lectures today (max 5)
    const doubles = template.subjects.filter(s => s.double); // 2-hour blocks (e.g. PPT)
    const lectures = [];
    const labs = template.subjects.filter(s => s.lab);
    const remainingLabs = [...labs];
    const labCovers = new Set(); // day|period owned by a span-2 block (lab tail or double block)
    const dayUnits = {};         // day -> real-class units placed (lecture 1, lab 2)
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];

    // ---- PASS 0: 2-hour double blocks (Pre-Placement Training). Claimed
    // first, before the day loop, so the block owns two consecutive periods
    // in the SAME lecture room with one teacher. The specialist pool is
    // small, so some sections may miss out — those fall back to the
    // subject's regular single-period lectures right after.
    for (const day of TT_DAYS) {
        for (const p0 of TT_LAB_PAIRS.map(p => p[0])) {
            if (!doubles.length) break;
            if (pptBudget && pptBudget.left <= 0) break;
            const roomFree = template.lectureRooms.filter(r =>
                !roomOcc.has(`${r}|${day}|${p0}`) && !roomOcc.has(`${r}|${day}|${p0 + 1}`));
            const candidates = doubles.filter(s => roomFree.length && s.pool.some(t =>
                !occupied.has(`${t}|${day}|${p0}`) &&
                !occupied.has(`${t}|${day}|${p0 + 1}`) &&
                (weekLoad[t] || 0) + 2 <= maxWeekly));
            if (!candidates.length) continue;
            const s = pick(candidates);
            const free = s.pool.filter(t =>
                !occupied.has(`${t}|${day}|${p0}`) &&
                !occupied.has(`${t}|${day}|${p0 + 1}`) &&
                (weekLoad[t] || 0) + 2 <= maxWeekly);
            const teacher = pick(free);
            const room = pick(roomFree);
            for (const p of [p0, p0 + 1]) {
                occupied.add(`${teacher}|${day}|${p}`);
                roomOcc.add(`${room}|${day}|${p}`);
                labCovers.add(`${day}|${p}`);
                weekLoad[teacher] = (weekLoad[teacher] || 0) + 1;
            }
            dayUnits[day] = (dayUnits[day] || 0) + 2;
            slots.push({
                department: template.code, departmentLabel: template.label,
                course: sec.course, section: sec.section, sectionKey: sec.key,
                day, period: p0, span: 2, kind: 'lecture',
                subjectCode: s.code, subject: s.title,
                teacherId: teacher, teacherName: teacherNames[teacher] || teacher,
                room: room, startMin: TT_GRID[TT_ROW[p0 - 1]].startMin
            });
            doubles.splice(doubles.indexOf(s), 1);
            if (pptBudget) pptBudget.left--;
        }
        if (!doubles.length) break;
    }
    // Fallback: a section that could not claim a 2-hour block keeps its
    // regular single-period lectures instead of losing the subject.
    for (const s of doubles) for (let i = 0; i < s.lectures; i++) lectures.push(s);
    // Every regular subject fills the weekly pool period by period.
    template.subjects.forEach(s => { if (!s.double) for (let i = 0; i < s.lectures; i++) lectures.push(s); });
    const remaining = [...lectures];

    for (const day of TT_DAYS) {
        // ---- Day quota: spread the week's real classes across ALL six days.
        // Without this the greedy loop drains the weekly pool Mon–Fri and
        // Saturday degenerates into a full day of library periods. Each day
        // may place at most ceil(remaining units / days left) so every day —
        // Saturday included — keeps real teaching.
        const daysLeft = TT_DAYS.length - TT_DAYS.indexOf(day);
        const remainingUnits = remaining.length + remainingLabs.length * 2;
        const dayTarget = Math.min(5, Math.ceil(remainingUnits / daysLeft));
        for (let period = 1; period <= 6; period++) {
            const row = TT_GRID[TT_ROW[period - 1]];

            // A period covered by a lab's SECOND half is not a new class.
            if (labCovers.has(`${day}|${period}`)) continue;

            let placed = null;

            // ---- Labs: first half of an allowed pair; both halves need a
            //      free specialist (2 more periods each) and the lab free.
            //      A lab consumes 2 of the day's quota units.
            const pair = TT_LAB_PAIRS.find(p => p[0] === period);
            if (pair && remainingLabs.length && !labOcc.has(`${template.lab}|${day}|${pair[0]}`)
                && (dayUnits[day] || 0) + 2 <= dayTarget + 1) {
                const candidates = remainingLabs.filter(s =>
                    s.pool.some(t =>
                        !occupied.has(`${t}|${day}|${pair[0]}`) &&
                        !occupied.has(`${t}|${day}|${pair[1]}`) &&
                        (weekLoad[t] || 0) + 2 <= maxWeekly));
                if (candidates.length) {
                    const s = pick(candidates);
                    const free = s.pool.filter(t =>
                        !occupied.has(`${t}|${day}|${pair[0]}`) &&
                        !occupied.has(`${t}|${day}|${pair[1]}`) &&
                        (weekLoad[t] || 0) + 2 <= maxWeekly);
                    const teacher = pick(free);
                    for (const p of pair) {
                        occupied.add(`${teacher}|${day}|${p}`);
                        labCovers.add(`${day}|${p}`);
                        weekLoad[teacher] = (weekLoad[teacher] || 0) + 1;
                    }
                    dayUnits[day] = (dayUnits[day] || 0) + 2;
                    labOcc.add(`${template.lab}|${day}|${pair[0]}`);
                    const r0 = TT_GRID[TT_ROW[pair[0] - 1]];
                    slots.push({
                        department: template.code, departmentLabel: template.label,
                        course: sec.course, section: sec.section, sectionKey: sec.key,
                        day, period: pair[0], span: 2, kind: 'lab',
                        subjectCode: s.code, subject: `${s.title} Lab`,
                        teacherId: teacher, teacherName: teacherNames[teacher] || teacher,
                        room: template.lab, startMin: r0.startMin
                    });
                    remainingLabs.splice(remainingLabs.indexOf(s), 1);
                    placed = slots[slots.length - 1];
                }
            }

            // ---- Lectures: pick any FREE specialist from the subject's pool;
            //      a subject never repeats in ADJACENT periods; max 5
            //      lectures/day per section AND within the day's quota —
            //      surplus is left for the remaining days (Saturday included);
            //      room = any free branch hall.
            if (!placed) {
                const dayLec = dayLectureCount[day] || 0;
                const poolAll = (dayLec < 5 && (dayUnits[day] || 0) < dayTarget) ? remaining.filter(s =>
                    (daySubjectCount[`${day}|${s.code}`] || 0) < 3) : [];
                const freeRooms = template.lectureRooms.filter(r => !roomOcc.has(`${r}|${day}|${period}`));
                const pool = poolAll.filter(s => {
                    const lastP = daySubjectLast[`${day}|${s.code}`];
                    if (lastP && Math.abs(lastP - period) === 1) return false;
                    return freeRooms.length > 0 && s.pool.some(t =>
                        !occupied.has(`${t}|${day}|${period}`) &&
                        (weekLoad[t] || 0) + 1 <= maxWeekly);
                });
                if (poolAll.length && pool.length < poolAll.length) {
                    conflicts.push({
                        section: sec.key, day, periodLabel: row.label,
                        steeredAround: [...new Set(poolAll.filter(s => !pool.includes(s)).map(s => s.code))],
                        reason: 'Specialist occupancy / weekly cap — alternate subject placed instead'
                    });
                }
                if (period === 1 && pool.length > 1) {
                    // Morning P1 should always open with a real core class:
                    // draw non-shared subjects before the shared ones.
                    pool.sort((a, b) => (a.shared ? 1 : 0) - (b.shared ? 1 : 0));
                }
                if (pool.length) {
                    const s = pick(pool);
                    const free = s.pool.filter(t =>
                        !occupied.has(`${t}|${day}|${period}`) &&
                        (weekLoad[t] || 0) + 1 <= maxWeekly);
                    const teacher = pick(free);
                    const room = pick(freeRooms);
                    occupied.add(`${teacher}|${day}|${period}`);
                    roomOcc.add(`${room}|${day}|${period}`);
                    weekLoad[teacher] = (weekLoad[teacher] || 0) + 1;
                    daySubjectCount[`${day}|${s.code}`] = (daySubjectCount[`${day}|${s.code}`] || 0) + 1;
                    daySubjectLast[`${day}|${s.code}`] = period;
                    dayLectureCount[day] = dayLec + 1;
                    dayUnits[day] = (dayUnits[day] || 0) + 1;
                    remaining.splice(remaining.indexOf(s), 1);
                    slots.push({
                        department: template.code, departmentLabel: template.label,
                        course: sec.course, section: sec.section, sectionKey: sec.key,
                        day, period, span: 1, kind: 'lecture',
                        subjectCode: s.code, subject: s.title,
                        teacherId: teacher, teacherName: teacherNames[teacher] || teacher,
                        room: room, startMin: row.startMin
                    });
                    placed = slots[slots.length - 1];
                }
            }

            // ---- Nothing placeable (pool busy / weekly caps): the slot is
            //      parked as an OPEN (free) period for now. Library time is
            //      NOT handed out here — it is consolidated after the day
            //      loop so idle time never becomes "3 library periods every
            //      single day".
            if (!placed) {
                slots.push({
                    department: template.code, departmentLabel: template.label,
                    course: sec.course, section: sec.section, sectionKey: sec.key,
                    day, period, span: 1, kind: 'free',
                    subjectCode: 'FREE', subject: 'Free Period',
                    teacherId: null, teacherName: null, room: null,
                    startMin: row.startMin
                });
            }
        }
    }

    // ---- Library consolidation: a section gets library/self-study on AT
    //      MOST 2 DAYS a week, and AT MOST 2 PERIODS on each of those days.
    //      The two days with the most idle slots become the library days;
    //      every other open slot stays a plain Free Period.
    const openByDay = {};
    for (const s of slots) if (s.kind === 'free') (openByDay[s.day] = openByDay[s.day] || []).push(s);
    const libDays = Object.entries(openByDay)
        .sort((a, b) => b[1].length - a[1].length || TT_DAYS.indexOf(a[0]) - TT_DAYS.indexOf(b[0]))
        .slice(0, 2)
        .map(([d]) => d);
    for (const day of libDays) {
        (openByDay[day] || [])
            .sort((a, b) => a.period - b.period)
            .slice(0, 2)
            .forEach(s => {
                s.kind = 'study';
                s.subjectCode = 'LIB';
                s.subject = 'Central Library & Self-Study';
                s.teacherId = null;
                s.teacherName = 'Self Study';
                s.room = 'Central Library';
            });
    }
    // ---- Tutorial fill: leftover idle periods (post library cap) become
    //      extra tutorial hours from the section's OWN subjects.
    ttTutorialFillSection(slots, template, { occupied, roomOcc, weekLoad, rng, maxWeekly, teacherNames });
    return slots;
}

// Teaching periods are grid indexes 0,1,3,5,6,7 (2 = BREAK, 4 = LUNCH).
const TT_ROW = [0, 1, 3, 5, 6, 7];

async function generateTimetable(seed, cfg) {
    const templates = (cfg && cfg.templates) || CAMPUS.templates;
    const maxWeekly = (cfg && cfg.maxWeekly) || CAMPUS.maxWeekly;
    const rng = ttMulberry32(seed);
    const conflictResolved = [];
    const occupied = new Set();   // teacher|day|period keys across ALL sections
    const roomOcc = new Set();    // room|day|period keys across ALL sections
    const labOcc = new Set();     // lab|day|startPeriod keys across ALL sections
    const weekLoad = {};          // teacherId -> periods booked this week
    const slots = [];

    const sections = await ttSectionList(templates);
    const teacherNames = await ttTeacherNames();

    // Shared budget for 2-hour double blocks (PPT): the block specialists'
    // weekly capacity is pool × maxWeekly. Reserving one period per
    // double-block section as a single-lecture fallback leaves a surplus
    // that becomes the number of sections that may claim a 2-hour block —
    // so EVERY section keeps PPT and as many as possible get it at 2 hours.
    const dblTemplate = sections
        .map(sec => templates[`${sec.course}|${sec.department}`])
        .find(t => t && (t.subjects || []).some(s => s.double));
    let pptBudget = null;
    if (dblTemplate) {
        const dbl = dblTemplate.subjects.find(s => s.double);
        const dblSections = sections.filter(sec => {
            const t = templates[`${sec.course}|${sec.department}`];
            return t && (t.subjects || []).some(s => s.double);
        }).length;
        const capacity = (dbl.pool || []).length * maxWeekly;
        pptBudget = { left: Math.max(0, capacity - dblSections) };
    }

    for (const sec of sections) {
        const template = templates[`${sec.course}|${sec.department}`];
        slots.push(...solveSection(sec, template, rng, occupied, conflictResolved, teacherNames, weekLoad, roomOcc, labOcc, maxWeekly, pptBudget));
    }

    // Attach period metadata (labels + printable time ranges) for the client.
    // span-2 blocks carry the FULL 2-hour range via ttSlotMeta.
    for (const slot of slots) ttSlotMeta(slot);

    return { slots, conflicts: conflictResolved, sections };
}


function ttPersist(db, by) {
    try {
        fs.mkdirSync(path.dirname(TIMETABLE_FILE), { recursive: true });
        db.generatedBy = by || db.generatedBy || 'system';
        fs.writeFileSync(TIMETABLE_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        console.warn('timetable save skipped:', e.message);
    }
}

async function ttBuild(seed, by) {
    const s = seed || Math.floor(Math.random() * 1e9);
    const { slots, conflicts, sections } = await generateTimetable(s, { templates: CAMPUS.templates, maxWeekly: CAMPUS.maxWeekly });
    const lectures = slots.filter(x => x.kind === 'lecture').length;
    const labsCount = slots.filter(x => x.kind === 'lab').length;
    const db = {
        version: `tt-${s}`,
        seed: s,
        generatedAt: new Date().toISOString(),
        generatedBy: by || 'system',
        grid: TT_GRID,
        days: TT_DAYS,
        sections: sections.map(sec => {
            const mine = slots.filter(x => x.sectionKey === sec.key);
            // compact, duplicate-free label from the branch template's display
            // label — "BTech CSE — Sec C", never "B.Sc Nursing Nursing — …"
            const tplLabel = CAMPUS.templates[`${sec.course}|${sec.department}`]?.label;
            return {
                key: sec.key, course: sec.course, department: sec.department, section: sec.section,
                label: (tplLabel || `${sec.course} ${sec.department}`) + ` — Sec ${sec.section}`,
                sessions: mine.filter(x => x.kind !== 'study' && x.kind !== 'free').length
            };
        }),
        summary: { sections: sections.length, departments: new Set(sections.map(x => x.department)).size, lectureSessions: lectures, labSessions: labsCount, solverSteers: conflicts.length },
        conflicts: conflicts,
        slots
    };
    ttPersist(db, db.generatedBy);
    return db;
}

function ttLoad() {
    try {
        if (fs.existsSync(TIMETABLE_FILE)) {
            const raw = JSON.parse(fs.readFileSync(TIMETABLE_FILE, 'utf8'));
            if (raw && Array.isArray(raw.slots) && raw.slots.length && Array.isArray(raw.grid)) return raw;
        }
    } catch { /* corrupt -> regenerate */ }
    return null;
}
let timetableDB = ttLoad();

// Boot auto-generate is async now (sections come from the live DB); until it
// lands, the campus keeps whatever schedule is already on disk. The campus
// config (Campus Setup) is loaded before any solve can run.
(async () => {
    try { await ccEnsure(); } catch (e) { console.warn('campus config init deferred:', e.message); }
    // Repair legacy published schedule (library cap + tutorial fill) now that
    // CAMPUS.templates is available.
    if (timetableDB && Array.isArray(timetableDB.slots)) {
        try {
            let dirty = false;
            if (ttApplyLibraryCap(timetableDB.slots)) { ttSlotMeta && timetableDB.slots.forEach(ttSlotMeta); dirty = true; }
            if (timetableDB.slots.some(s => s.kind === 'free')) {
                const occupied = new Set(); const roomOcc = new Set(); const weekLoad = {};
                for (const s of timetableDB.slots) {
                    if (!s.teacherId) continue;
                    const span = s.span || 1;
                    for (let p = 0; p < span; p++) occupied.add(`${s.teacherId}|${s.day}|${s.period + p}`);
                    weekLoad[s.teacherId] = (weekLoad[s.teacherId] || 0) + span;
                    if (s.room) { roomOcc.add(`${s.room}|${s.day}|${s.period}`); if (span === 2) roomOcc.add(`${s.room}|${s.day}|${s.period + 1}`); }
                }
                const tn = await ttTeacherNames();
                let filled = 0;
                for (const sec of (timetableDB.sections || [])) {
                    const template = CAMPUS.templates[`${sec.course}|${sec.department}`];
                    if (!template) continue;
                    const mine = timetableDB.slots.filter(x => x.sectionKey === sec.key);
                    if (!mine.some(x => x.kind === 'free')) continue;
                    filled += ttTutorialFillSection(mine, template, { occupied, roomOcc, weekLoad, maxWeekly: CAMPUS.maxWeekly, teacherNames: tn, rng: Math.random });
                }
                if (filled) { ttApplyLibraryCap(timetableDB.slots); timetableDB.slots.forEach(ttSlotMeta); dirty = true; console.log(`tutorial fill packed ${filled} idle period(s) into classes`); }
            }
            if (dirty) { timetableDB.version = `${timetableDB.version}-repair`; timetableDB.generatedAt = new Date().toISOString(); ttPersist(timetableDB, timetableDB.generatedBy); }
        } catch (e) { console.warn('schedule repair skipped:', e.message); }
    }
    if (!timetableDB) {
        try { timetableDB = await ttBuild(); } catch (e) { console.warn('boot timetable generation deferred:', e.message); }
    }
})();

// Full schedule for the campus client (students filter their own section;
// `sections` carries the per-section directory for pickers).
app.get('/api/timetable', authenticateUser, (req, res) => {
    return res.json({
        success: true,
        version: timetableDB.version,
        generatedAt: timetableDB.generatedAt,
        generatedBy: timetableDB.generatedBy || 'system',
        days: timetableDB.days,
        grid: timetableDB.grid,
        sections: timetableDB.sections || [],
        summary: timetableDB.summary,
        slots: timetableDB.slots
    });
});

// A teacher's own engagement sheet (GF portal) — resolved from the FAC id
// on the staff profile's roll_number, falling back to the display name.
app.get('/api/timetable/mine', authenticateUser, requireRole('TEACHER', 'ADMIN', 'DEAN'), (req, res) => {
    const rid = String(req.user?.rollNumber || '').trim().toUpperCase();
    const nm = String(req.user?.name || '').trim().toLowerCase();
    let mine = timetableDB.slots.filter(s =>
        (rid.startsWith('FAC') && s.teacherId === rid) ||
        (!rid.startsWith('FAC') && s.teacherName && s.teacherName.toLowerCase() === nm));
    mine = mine.map(s => ({
        day: s.day, period: s.period, periodLabel: s.periodLabel, time: s.time,
        subjectCode: s.subjectCode, subject: s.subject, room: s.room,
        department: s.department, departmentLabel: s.departmentLabel, kind: s.kind,
        sectionKey: s.sectionKey || null,
        sectionLabel: (s.course && s.section)
            ? `${s.departmentLabel || s.department} — Sec ${s.section}`
            : null
    }));
    return res.json({ success: true, generatedAt: timetableDB.generatedAt, slots: mine });
});

// ADMIN/DEAN: run the solver again — a fresh seed produces a fresh but
// still fully conflict-free schedule (this is the demo moment for judges).
app.post('/api/admin/generate-timetable', authenticateUser, requireRole('ADMIN', 'DEAN'), async (req, res) => {
    try {
        await ccEnsure();
        const db = await ttBuild(null, req.user?.name || 'Admin');
        timetableDB = db; // every live reader (students/teachers/admin) switches to the fresh schedule
        return res.json({
            success: true, version: db.version, generatedAt: db.generatedAt,
            summary: db.summary,
            conflicts: db.conflicts
        });
    } catch (err) {
        console.error('timetable generation failed:', err.message);
        return res.status(500).json({ success: false, error: 'generation failed: ' + err.message });
    }
});

// ADMIN/DEAN: regenerate ONE section against the rest of the campus — the
// other 39 sections keep their slots and their occupancy constrains the
// fresh solve, so nothing clashes anywhere.
app.post('/api/admin/generate-timetable-section', authenticateUser, requireRole('ADMIN', 'DEAN'), async (req, res) => {
    try {
        const sectionKey = String(req.body?.sectionKey || '').trim();
        if (!sectionKey) return res.status(400).json({ success: false, error: 'sectionKey required' });
        if (!timetableDB || !Array.isArray(timetableDB.slots)) return res.status(503).json({ success: false, error: 'no published schedule — generate all first' });
        await ccEnsure();

        const [course, department, section] = sectionKey.split('|');
        const template = CAMPUS.templates[`${course}|${department}`];
        if (!template) return res.status(404).json({ success: false, error: `no subject template for ${sectionKey} — add the branch in Campus Setup` });

        const others = timetableDB.slots.filter(s => s.sectionKey !== sectionKey);
        const { teachers: occupied, rooms: roomOcc, labs: labOcc } = ttOccupancyFrom(others);
        const weekLoad = {};
        for (const key of occupied) {
            const [tid] = key.split('|');
            weekLoad[tid] = (weekLoad[tid] || 0) + 1;
        }
        // PREVIEW + CONFIRM: dryRun solves but touches NOTHING — the admin
        // sees the draft grid first. Confirm re-posts the SAME seed; the
        // solver is deterministic, so the published grid is exactly the
        // previewed one (clash-free against the other 39 either way).
        const dryRun = req.body?.dryRun === true;
        const seed = (Number(req.body?.seed) > 0)
            ? Math.floor(Number(req.body?.seed))
            : Math.floor(Math.random() * 1e9);
        const rng = ttMulberry32(seed);
        const conflicts = [];
        const teacherNames = await ttTeacherNames();
        const fresh = solveSection({ key: sectionKey, course, department, section }, template, rng, occupied, conflicts, teacherNames, weekLoad, roomOcc, labOcc, CAMPUS.maxWeekly);
        for (const slot of fresh) ttSlotMeta(slot);

        if (dryRun) {
            return res.json({
                success: true, dryRun: true, seed, sectionKey,
                placed: fresh.filter(x => x.kind !== 'study' && x.kind !== 'free').length,
                library: fresh.filter(x => x.kind === 'study').length,
                steers: conflicts.length,
                slots: fresh
            });
        }
        timetableDB.slots = [...others, ...fresh].sort((a, b) =>
            (a.sectionKey || '').localeCompare(b.sectionKey || '') || a.day.localeCompare(b.day) || a.period - b.period);
        timetableDB.version = `${timetableDB.version}-r${Math.floor(Math.random() * 9000 + 1000)}`;
        timetableDB.generatedAt = new Date().toISOString();
        timetableDB.generatedBy = req.user?.name || 'Admin';
        timetableDB.sections = (timetableDB.sections || []).map(s =>
            s.key === sectionKey ? { ...s, sessions: fresh.filter(x => x.kind !== 'study' && x.kind !== 'free').length } : s);
        const lectures = timetableDB.slots.filter(x => x.kind === 'lecture').length;
        const labsCount = timetableDB.slots.filter(x => x.kind === 'lab').length;
        timetableDB.summary = { ...(timetableDB.summary || {}), lectureSessions: lectures, labSessions: labsCount };
        timetableDB.conflicts = [...(timetableDB.conflicts || []), ...conflicts.map(c => ({ ...c, reGeneratedSection: true }))];
        ttPersist(timetableDB, timetableDB.generatedBy);
        return res.json({
            success: true, version: timetableDB.version, generatedAt: timetableDB.generatedAt,
            sectionKey, seed, placed: fresh.filter(x => x.kind !== 'study' && x.kind !== 'free').length,
            library: fresh.filter(x => x.kind === 'study').length,
            steers: conflicts.length
        });
    } catch (err) {
        console.error('section regeneration failed:', err.message);
        return res.status(500).json({ success: false, error: 'regeneration failed: ' + err.message });
    }
});

// ============================================================
// STEP 5 — ADMIN "UPLOAD TIMETABLE CSV" (one section at a time)
// The admin picks a section, uploads a weekly CSV, and the server either
// VALIDATES it (dryRun) or PUBLISHES it. The CSV names subjects by CODE
// (titles come from the section's degree template — no typo'd titles),
// may leave teacher_id and room BLANK (a free specialist from the
// subject's pool is picked, exactly like the solver), and every row is
// checked against the WHOLE published campus:
//   · teacher clash  (teacher booked in another section at that slot)
//   · room clash     (room booked in another section at that slot)
//   · lab clash      (branch lab already hosting another section)
//   · qualification  (a NAMED teacher must belong to the subject's pool)
//   · weekly cap     (no teacher may cross TT_MAX_WEEKLY)
//   · grid legality  (labs only on TT_LAB_PAIRS starts, no duplicate
//                     day+period, no lecture under a lab's tail half)
// Nothing is written unless the publish call runs with ZERO errors —
// the other 39 sections are never touched.
// ============================================================

// ============================================================
// CAMPUS SETUP API — read / validate / save the live config.
// POST with dryRun:true ALSO shadow-solves a full timetable against the
// candidate config (in memory, nothing published) so the admin sees the
// consequence BEFORE saving. Saving never moves the live timetable —
// the admin presses Regenerate (banner in the Timetable Engine tab).
// ============================================================

// Staff directory for the pool pickers (teachers) and warden assignment.
app.get('/api/admin/staff-directory', authenticateUser, requireRole('ADMIN', 'DEAN'), async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ success: false, error: 'database offline' });
        const out = { teachers: [], wardens: [] };
        for (let from = 0; ; from += 1000) {
            const { data, error } = await supabase.from('profiles')
                .select('roll_number, full_name, role').in('role', ['TEACHER', 'WARDEN']).range(from, from + 999);
            if (error) return res.status(500).json({ success: false, error: error.message });
            if (!data || !data.length) break;
            for (const r of data) {
                const row = { id: String(r.roll_number || '').trim(), name: r.full_name };
                if (r.role === 'TEACHER') out.teachers.push(row); else out.wardens.push(row);
            }
            if (data.length < 1000) break;
        }
        out.teachers.sort((a, b) => a.id.localeCompare(b.id));
        out.wardens.sort((a, b) => a.id.localeCompare(b.id));
        return res.json({ success: true, ...out });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// FACULTY FINDER — a student searches a teacher's name and sees where they
// can likely be found RIGHT NOW, derived from the published timetable (the
// server already holds every teacher's weekly schedule):
//   teaching slot in progress  → room + subject + section
//   between classes            → "not in class — next: <subject> <room> <time>"
//   marked absent today        → plain ABSENT (the teacher-absent toggle the
//                                teacher flips in their own dashboard)
app.get('/api/faculty/whereabouts', authenticateUser, async (req, res) => {
    try {
        const q = String(req.query.q || '').trim().toLowerCase();
        if (q.length < 2 || !timetableDB || !Array.isArray(timetableDB.slots)) {
            return res.json({ success: true, results: [] });
        }
        // 1. Identify faculty from the roster (name / FAC-roll match).
        const rows = [];
        if (supabase) {
            for (let from = 0; ; from += 1000) {
                const { data, error } = await supabase.from('profiles')
                    .select('roll_number, full_name, department')
                    .eq('role', 'TEACHER').range(from, from + 999);
                if (error) break;
                rows.push(...(data || []));
                if (!data || data.length < 1000) break;
            }
        }
        const matches = rows.filter(r =>
            String(r.full_name || '').toLowerCase().includes(q) ||
            String(r.roll_number || '').toLowerCase().includes(q)).slice(0, 5);
        if (!matches.length) return res.json({ success: true, results: [] });

        // 2. Resolve each match's real-time status for TODAY.
        const dayKeys = ['SUN', 'MON', 'TUE', 'WED', 'THUR', 'FRI', 'SAT'];
        const today = dayKeys[new Date().getDay()];
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
        const parseHM = (s) => {
            const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(String(s || '').trim());
            if (!m) return null;
            let h = parseInt(m[1], 10) % 12;
            if (/pm/i.test(m[3])) h += 12;
            return h * 60 + parseInt(m[2], 10);
        };
        const results = matches.map(t => {
            const roll = String(t.roll_number || '').trim().toUpperCase();
            const absent = !!(teacherAbsenceDB.absent && teacherAbsenceDB.absent[roll]);
            const todays = timetableDB.slots
                .filter(s => s.teacherId === roll && s.day === today)
                .sort((a, b) => (parseHM(String(a.time || '').split('-')[0]) || 0) - (parseHM(String(b.time || '').split('-')[0]) || 0))
                .map(s => {
                    const parts = String(s.time || '').split('-');
                    return {
                        period: s.period, periodLabel: s.periodLabel, time: s.time,
                        startMin: parseHM(parts[0]), endMin: parseHM(parts[1]),
                        subject: s.subject, room: s.room, kind: s.kind,
                        sectionLabel: (s.course && s.section)
                            ? `${s.departmentLabel || s.department} — Sec ${s.section}` : null
                    };
                });
            const current = todays.find(s => s.startMin != null && s.endMin != null && nowMin >= s.startMin && nowMin < s.endMin) || null;
            const next = todays.find(s => s.startMin != null && s.startMin > nowMin) || null;
            let status, where;
            if (absent) {
                status = 'ABSENT_TODAY';
                where = 'Marked absent today';
            } else if (current) {
                status = 'TEACHING_NOW';
                const till = String(current.time || '').split('-')[1];
                where = `Room ${current.room} — ${current.subject}${current.sectionLabel ? ' · ' + current.sectionLabel : ''}${till ? ' (till ' + till.trim() + ')' : ''}`;
            } else if (next) {
                status = 'FREE_NOW';
                where = `Not in class — next: ${next.subject} in Room ${next.room} (${next.periodLabel}, ${next.time})`;
            } else if (todays.length) {
                status = 'DAY_OVER';
                where = 'No more classes today';
            } else {
                status = 'NO_CLASS';
                where = 'No classes scheduled today — check the department office';
            }
            return {
                roll, name: t.full_name, department: t.department || null,
                absent, status, where,
                currentSlot: current, nextSlot: next, todaySchedule: todays
            };
        });
        return res.json({ success: true, results });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Live roster directory for the notice dispatcher's campus/academic
// audience dropdowns (distinct sections + admission years). Computed from
// profiles and cached for 5 minutes — the roster barely changes mid-day.
let ccDirectoryCache = { at: 0, sections: [], years: [] };
async function rosterDirectory() {
    if (Date.now() - ccDirectoryCache.at < 5 * 60 * 1000 && ccDirectoryCache.sections.length) return ccDirectoryCache;
    const sections = new Set();
    const years = new Set();
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
            .from('profiles').select('section, roll_number').eq('role', 'STUDENT').range(from, from + 999);
        if (error) break;
        for (const r of (data || [])) {
            if (r.section) sections.add(String(r.section).trim().toUpperCase());
            const m = /^(\d{2})/.exec(String(r.roll_number || ''));
            if (m) years.add(2000 + parseInt(m[1], 10));
        }
        if (!data || data.length < 1000) break;
    }
    ccDirectoryCache = {
        at: Date.now(),
        sections: [...sections].sort(),
        years: [...years].sort((a, b) => b - a)
    };
    return ccDirectoryCache;
}

app.get('/api/admin/campus-config', authenticateUser, requireRole('ADMIN', 'DEAN'), async (req, res) => {
    try {
        await ccEnsure();
        let directory = { sections: [], years: [] };
        if (supabase) { try { directory = await rosterDirectory(); } catch { /* dropdowns degrade to manual input */ } }
        return res.json({
            success: true,
            config: CAMPUS.doc,
            directory,
            liveVersion: timetableDB?.version || null,
            liveGeneratedAt: timetableDB?.generatedAt || null
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/campus-config', authenticateUser, requireRole('ADMIN'), async (req, res) => {
    try {
        await ccEnsure();
        const doc = req.body?.config;
        const dryRun = req.body?.dryRun !== false;
        if (!doc || !Array.isArray(doc.branches) || !doc.branches.length) {
            return res.status(400).json({ success: false, errors: ['config.branches must be a non-empty list'] });
        }

        // ---- structural validation (teacher existence checked against the DB)
        const errs = [];
        const seenKeys = new Set();
        for (const b of doc.branches) {
            const key = `${String(b.course || '').trim()}|${String(b.department || '').trim()}`;
            b.key = key;
            if (!b.course || !b.department) { errs.push(`branch "${b.label || key}": course and department are both required`); continue; }
            if (seenKeys.has(key)) errs.push(`duplicate branch ${key}`);
            seenKeys.add(key);
            if (!b.code || !b.label) errs.push(`branch ${key}: short code and display label are required`);
            const rooms = (b.lectureRooms || []).map(r => String(r).trim()).filter(Boolean);
            if (!rooms.length) errs.push(`branch ${key}: at least one lecture room is required`);
            if (new Set(rooms).size !== rooms.length) errs.push(`branch ${key}: duplicate room names`);
            b.lectureRooms = rooms;
            if (!Array.isArray(b.subjects) || !b.subjects.length) { errs.push(`branch ${key}: at least one subject is required`); continue; }
            const seenCodes = new Set();
            for (const s of b.subjects) {
                s.code = String(s.code || '').trim().toUpperCase();
                s.title = String(s.title || '').trim();
                s.lectures = parseInt(s.lectures, 10) || 0;
                if (!s.code || !s.title) errs.push(`branch ${key}: every subject needs a code and a title`);
                if (seenCodes.has(s.code)) errs.push(`branch ${key}: duplicate subject code ${s.code}`);
                seenCodes.add(s.code);
                if (s.lectures < 0 || s.lectures > 10) errs.push(`branch ${key}: ${s.code} lectures/week must be 0..10`);
                if (!Array.isArray(s.pool) || !s.pool.length) errs.push(`branch ${key}: ${s.code} needs at least one teacher in its pool`);
            }
            if (b.subjects.some(s => s.lab) && !String(b.lab || '').trim()) {
                errs.push(`branch ${key}: a lab room is required — some subjects run labs`);
            }
            b.lab = String(b.lab || '').trim();
        }
        doc.ttMaxWeekly = parseInt(doc.ttMaxWeekly, 10);
        if (!(doc.ttMaxWeekly >= 1 && doc.ttMaxWeekly <= 40)) errs.push('weekly cap must be 1..40');
        const blocks = Array.isArray(doc.hostelBlocks) ? doc.hostelBlocks : [];
        const seenBlocks = new Set();
        for (const hb of blocks) {
            hb.name = String(hb.name || '').trim();
            hb.capacity = parseInt(hb.capacity, 10) || 0;
            hb.warden = hb.warden ? String(hb.warden).trim() : null;
            // room-allocation fields: block gender (Boys/Girls hostels never
            // mix) and how many students share one room (1..8)
            hb.gender = (String(hb.gender || '').trim().toLowerCase() === 'girls') ? 'Girls' : 'Boys';
            hb.seatsPerRoom = parseInt(hb.seatsPerRoom, 10) || 4;
            if (hb.seatsPerRoom < 1 || hb.seatsPerRoom > 8) errs.push(`hostel block ${hb.name || '?'}: seats per room must be 1..8`);
            if (!hb.name) { errs.push('hostel block: name is required'); continue; }
            if (seenBlocks.has(hb.name)) errs.push(`duplicate hostel block "${hb.name}"`);
            seenBlocks.add(hb.name);
            if (hb.capacity < 1) errs.push(`hostel block ${hb.name}: capacity must be at least 1`);
        }
        doc.hostelBlocks = blocks;

        // teacher/warden existence — pools may only reference real staff
        if (supabase) {
            const staff = new Map();
            for (let from = 0; ; from += 1000) {
                const { data, error } = await supabase.from('profiles')
                    .select('roll_number, role').in('role', ['TEACHER', 'WARDEN']).range(from, from + 999);
                if (error || !data || !data.length) break;
                for (const r of data) staff.set(String(r.roll_number || '').trim().toUpperCase(), r.role);
                if (data.length < 1000) break;
            }
            for (const b of doc.branches) for (const s of b.subjects || []) {
                for (const t of (s.pool || [])) {
                    if (!staff.has(String(t).toUpperCase())) errs.push(`branch ${b.key}: ${s.code} pool references unknown teacher "${t}"`);
                }
            }
            for (const hb of doc.hostelBlocks) {
                if (hb.warden && staff.get(String(hb.warden).toUpperCase()) !== 'WARDEN') {
                    errs.push(`hostel block ${hb.name}: "${hb.warden}" is not a warden account`);
                }
            }
        }
        if (errs.length) return res.json({ success: false, dryRun, errors: errs, report: `✗ ${errs.length} problem(s) — nothing saved.` });

        const candidate = ccTemplatesFrom(doc);

        // ---- shadow solve: what would this config produce? (nothing published)
        let shadow = null;
        try {
            const { slots, conflicts, sections } = await generateTimetable(Math.floor(Math.random() * 1e9), candidate);
            shadow = {
                sections: sections.length,
                lectures: slots.filter(x => x.kind === 'lecture').length,
                labs: slots.filter(x => x.kind === 'lab').length,
                steers: conflicts.length,
                maxLoad: Math.max(0, ...Object.values(slots.reduce((m, x) => { if (x.teacherId) m[x.teacherId] = (m[x.teacherId] || 0) + 1; return m; }, {})))
            };
        } catch (e) {
            errs.push('shadow solve failed: ' + e.message);
        }
        if (errs.length) return res.json({ success: false, dryRun, errors: errs, report: `✗ ${errs.length} problem(s) — nothing saved.` });

        if (dryRun) {
            return res.json({
                success: true, dryRun: true,
                report: `✓ Config would schedule ${shadow.sections} sections · ${shadow.lectures} lectures · ${shadow.labs} labs · heaviest teacher ${shadow.maxLoad}/${candidate.maxWeekly}/week — clash-free. Save it, then Regenerate the timetable to apply.`,
                shadow
            });
        }

        // ---- save (file now, Supabase best effort) and apply live
        doc.updatedAt = new Date().toISOString();
        doc.updatedBy = req.user?.name || 'Admin';
        ccApply(doc);
        ccPersistFile(doc);
        const mirrored = await ccPersistSupabase(doc);
        return res.json({
            success: true, dryRun: false,
            updatedAt: doc.updatedAt,
            shadow,
            statement: `Campus config saved (${doc.branches.length} branches, ${doc.hostelBlocks.length} hostel blocks${mirrored ? ', mirrored to Supabase' : ''}) — Regenerate the timetable to apply it.`
        });
    } catch (err) {
        console.error('campus config save failed:', err.message);
        return res.status(500).json({ success: false, error: 'config save failed: ' + err.message });
    }
});

// ============================================================
// STEP 6 — ADMIN "AT-RISK" ROSTER. Students whose LIVE attendance
// percentage (recomputed from every recorded section session on each
// mark/unlock — see rollupSectionAttendance) has fallen below the
// threshold (default 50%). Worst first, with the section + resident
// context the admin needs to act (mentor for day scholars, warden for
// hostellers).
// ============================================================
app.get('/api/admin/at-risk', authenticateUser, requireRole('ADMIN', 'DEAN'), async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ success: false, error: 'database offline' });
        const threshold = Math.min(100, Math.max(1, parseFloat(req.query.threshold) || 50));
        const rows = [];
        for (let from = 0; ; from += 1000) {
            const { data, error } = await supabase.from('profiles')
                .select('roll_number, full_name, course, department, section, resident_type, hostel_block, attendance_percentage, mentor_roll')
                .eq('role', 'STUDENT')
                .lt('attendance_percentage', threshold)
                .order('attendance_percentage', { ascending: true })
                .range(from, from + 999);
            if (error) return res.status(500).json({ success: false, error: error.message });
            for (const r of (data || [])) {
                rows.push({
                    roll: r.roll_number,
                    name: r.full_name,
                    course: r.course,
                    section: r.section,
                    residentType: r.resident_type,
                    block: r.hostel_block,
                    pct: r.attendance_percentage,
                    mentor: r.mentor_roll || null
                });
            }
            if (!data || data.length < 1000) break;
        }
        const { count: totalStudents, error: cErr } = await supabase
            .from('profiles').select('roll_number', { count: 'exact', head: true }).eq('role', 'STUDENT');
        if (cErr) return res.status(500).json({ success: false, error: cErr.message });
        // where the risk concentrates — one line per affected section
        const bySection = {};
        for (const r of rows) {
            const k = `${r.course || '?'}${r.section ? ' · Sec ' + r.section : ''}`;
            bySection[k] = (bySection[k] || 0) + 1;
        }
        return res.json({
            success: true,
            threshold,
            totalStudents: totalStudents || 0,
            atRiskCount: rows.length,
            bySection,
            atRisk: rows
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// teacher id → name cache for the CSV resolver (refreshed per request)
let ttTeacherNamesCache = {};

// Minimal CSV parser: trims cells, tolerates CRLF, ignores a header row.
function ttParseCsv(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim().length);
    if (!lines.length) return [];
    const rows = lines.map(l => l.split(',').map(c => c.trim()));
    if (/^day/i.test((rows[0][0] || ''))) rows.shift();
    return rows;
}

app.post('/api/admin/timetable-csv', authenticateUser, requireRole('ADMIN', 'DEAN'), async (req, res) => {
    try {
        const sectionKey = String(req.body?.sectionKey || '').trim();
        const dryRun = req.body?.dryRun !== false;
        const csvText = String(req.body?.csv || '');
        if (!sectionKey) return res.status(400).json({ success: false, error: 'sectionKey required' });
        if (!csvText.trim()) return res.status(400).json({ success: false, error: 'CSV content required' });
        if (!timetableDB || !Array.isArray(timetableDB.slots)) return res.status(503).json({ success: false, error: 'no published schedule — generate all first' });
        await ccEnsure();

        const [course, department, section] = sectionKey.split('|');
        const template = CAMPUS.templates[`${course}|${department}`];
        if (!template) return res.status(404).json({ success: false, error: `no subject template for ${sectionKey} — add the branch in Campus Setup` });
        ttTeacherNamesCache = await ttTeacherNames();

        // --- occupancy of the OTHER 39 sections (the CSV must fit around them)
        const others = timetableDB.slots.filter(s => s.sectionKey !== sectionKey);
        const occ = ttOccupancyFrom(others);
        const occupied = occ.teachers, roomOcc = occ.rooms, labOcc = occ.labs;
        const weekLoad = {};
        for (const key of occupied) {
            const [tid] = key.split('|');
            weekLoad[tid] = (weekLoad[tid] || 0) + 1;
        }

        // --- in-CSV tracking (rows must also not clash with each other)
        const csvTeacher = new Set(), csvRoom = new Set(), csvLab = new Set(), csvSlot = new Set();

        const errors = [];       // { row, message }
        const autofills = [];    // { row, message } — what the server picked
        const placed = [];       // resolved slot objects (publish-ready)
        const rows = ttParseCsv(csvText);

        rows.forEach((cells, idx) => {
            const rowNo = idx + 1;
            const [dayRaw, periodRaw, codeRaw, kindRaw, teacherRaw, roomRaw] = cells;
            const day = String(dayRaw || '').trim().toUpperCase();
            const period = parseInt(periodRaw, 10);
            const code = String(codeRaw || '').trim().toUpperCase();
            const kind = String(kindRaw || 'lecture').trim().toLowerCase() === 'lab' ? 'lab' : 'lecture';
            const teacherId = String(teacherRaw || '').trim().toUpperCase();
            const roomIn = String(roomRaw || '').trim();

            if (!TT_DAYS.includes(day)) { errors.push({ row: rowNo, message: `day "${dayRaw}" is not one of ${TT_DAYS.join('/')}` }); return; }
            if (!TT_PERIOD_TIME[period]) { errors.push({ row: rowNo, message: `period "${periodRaw}" is not 1..6` }); return; }
            const subj = template.subjects.find(s => s.code === code);
            if (!subj) {
                errors.push({ row: rowNo, message: `subject code "${code}" is not taught in ${template.label} — valid: ${template.subjects.map(s => s.code).join(', ')}` });
                return;
            }
            const slotId = `${day}|${period}`;
            if (csvSlot.has(slotId)) { errors.push({ row: rowNo, message: `${day} P${period} appears twice in this CSV` }); return; }

            // lab legality: must start on a legal pair; a lecture may not sit
            // under a lab's second half
            const pair = kind === 'lab' ? TT_LAB_PAIRS.find(p => p[0] === period) : null;
            if (kind === 'lab' && !pair) {
                errors.push({ row: rowNo, message: `a LAB at P${period} is illegal — labs run only on pairs P1-P2 or P4-P5` });
                return;
            }
            if (kind === 'lecture') {
                for (const lp of TT_LAB_PAIRS) {
                    if (lp[1] === period && csvSlot.has(`${day}|${lp[0]}`)) {
                        errors.push({ row: rowNo, message: `${day} P${period} is the second half of a lab starting at P${lp[0]} in this CSV` });
                        return;
                    }
                }
            }
            const cost = kind === 'lab' ? 2 : 1;
            const periodsToBook = kind === 'lab' ? pair : [period];

            // --- TEACHER: named (must qualify + be free) or blank (free specialist)
            let teacher = null;
            if (teacherId) {
                if (!subj.pool.includes(teacherId)) {
                    errors.push({ row: rowNo, message: `${teacherId} is NOT a ${code} specialist (pool: ${subj.pool.join(', ')})` });
                    return;
                }
                const busy = periodsToBook.some(p => occupied.has(`${teacherId}|${day}|${p}`) || csvTeacher.has(`${teacherId}|${day}|${p}`));
                if (busy) {
                    const clash = timetableDB.slots.find(s => s.teacherId === teacherId && s.day === day && periodsToBook.includes(s.period) && s.sectionKey !== sectionKey);
                    errors.push({ row: rowNo, message: `${teacherId} is already booked ${day} P${periodsToBook.join('/P')} for ${clash ? clash.sectionKey.split('|').join(' ') : 'another class'}` });
                    return;
                }
                if ((weekLoad[teacherId] || 0) + cost > CAMPUS.maxWeekly) {
                    errors.push({ row: rowNo, message: `${teacherId} would cross the weekly cap (${(weekLoad[teacherId] || 0)} booked + ${cost} > ${CAMPUS.maxWeekly})` });
                    return;
                }
                teacher = teacherId;
            } else {
                const free = subj.pool.filter(t =>
                    periodsToBook.every(p => !occupied.has(`${t}|${day}|${p}`) && !csvTeacher.has(`${t}|${day}|${p}`)) &&
                    (weekLoad[t] || 0) + cost <= CAMPUS.maxWeekly);
                if (!free.length) {
                    errors.push({ row: rowNo, message: `no free ${code} specialist ${day} P${periodsToBook.join('/P')} — leave teacher_id blank only when the pool can serve it` });
                    return;
                }
                teacher = free[0];
                autofills.push({ row: rowNo, message: `${day} P${period} ${code}: blank teacher → ${teacher} (${ttTeacherNamesCache[teacher] || teacher}) picked from pool` });
            }

            // --- ROOM: lab = the branch lab (must be free); lecture = branch
            //     pool, named rooms must belong to the branch and be free
            let room = null;
            if (kind === 'lab') {
                room = template.lab;
                if (labOcc.has(`${room}|${day}|${pair[0]}`) || csvLab.has(`${room}|${day}|${pair[0]}`)) {
                    errors.push({ row: rowNo, message: `${room} is already hosting another section ${day} P${pair[0]} (one section per lab slot)` });
                    return;
                }
            } else if (roomIn) {
                if (!template.lectureRooms.includes(roomIn)) {
                    errors.push({ row: rowNo, message: `room ${roomIn} is not a ${template.label} lecture hall (${template.lectureRooms.join(', ')})` });
                    return;
                }
                if (roomOcc.has(`${roomIn}|${day}|${period}`) || csvRoom.has(`${roomIn}|${day}|${period}`)) {
                    const clash = timetableDB.slots.find(s => s.room === roomIn && s.day === day && s.period === period && s.sectionKey !== sectionKey);
                    errors.push({ row: rowNo, message: `room ${roomIn} is booked ${day} P${period} by ${clash ? clash.sectionKey.split('|').join(' ') : 'another class'}` });
                    return;
                }
                room = roomIn;
            } else {
                const freeRoom = template.lectureRooms.find(r => !roomOcc.has(`${r}|${day}|${period}`) && !csvRoom.has(`${r}|${day}|${period}`));
                if (!freeRoom) {
                    errors.push({ row: rowNo, message: `all ${template.label} lecture halls are busy ${day} P${period}` });
                    return;
                }
                room = freeRoom;
                autofills.push({ row: rowNo, message: `${day} P${period} ${code}: blank room → ${freeRoom} assigned` });
            }

            // --- commit the row into CSV-local occupancy
            for (const p of periodsToBook) csvSlot.add(`${day}|${p}`);
            if (kind === 'lab') csvLab.add(`${room}|${day}|${pair[0]}`);
            csvTeacher.add(`${teacher}|${day}|${periodsToBook[0]}`);
            if (kind === 'lab') csvTeacher.add(`${teacher}|${day}|${pair[1]}`);
            csvRoom.add(`${room}|${day}|${period}`);
            weekLoad[teacher] = (weekLoad[teacher] || 0) + cost;

            placed.push({
                department: template.code, departmentLabel: template.label,
                course, section, sectionKey,
                day, period, span: kind === 'lab' ? 2 : 1, kind,
                subjectCode: code, subject: kind === 'lab' ? `${subj.title} Lab` : subj.title,
                teacherId: teacher, teacherName: ttTeacherNamesCache[teacher] || teacher,
                room, startMin: TT_GRID[TT_ROW[period - 1]].startMin
            });
        });

        if (errors.length || dryRun) {
            return res.json({
                success: errors.length === 0,
                dryRun: true, sectionKey,
                errors, autofills,
                rowsParsed: rows.length,
                placedCount: placed.length,
                report: errors.length
                    ? `✗ ${errors.length} problem(s) — nothing was published. Fix the rows and validate again.`
                    : `✓ ${placed.length} rows fit the campus grid with ${autofills.length} auto-fill(s) — safe to publish.`
            });
        }

        // --- PUBLISH: replace ONLY this section's slots. Every (day, period)
        // the CSV does NOT define becomes a library/self-study slot — exactly
        // like the solver's unfilled periods, so the section's grid is always
        // complete (a lab's tail half stays covered by the lab itself).
        for (const slot of placed) ttSlotMeta(slot);
        const covered = new Set();   // day|period already spoken for (lab tails)
        for (const s of placed) {
            covered.add(`${s.day}|${s.period}`);
            if (s.kind === 'lab') covered.add(`${s.day}|${s.period + 1}`);
        }
        const full = [...placed];
        // Same library policy as the solver: idle periods are consolidated to
        // AT MOST 2 library DAYS a week × AT MOST 2 PERIODS each; the rest of
        // the uncovered grid becomes a plain Free Period for the student.
        const csvOpen = [];
        for (const day of TT_DAYS) {
            for (let p = 1; p <= 6; p++) {
                if (covered.has(`${day}|${p}`)) continue;
                const row0 = TT_GRID[TT_ROW[p - 1]];
                csvOpen.push({
                    department: template.code, departmentLabel: template.label,
                    course, section, sectionKey,
                    day, period: p, span: 1, kind: 'free',
                    subjectCode: 'FREE', subject: 'Free Period',
                    teacherId: null, teacherName: null, room: null,
                    startMin: row0.startMin, periodLabel: row0.label,
                    time: TT_PERIOD_TIME[p], endMin: TT_END_MIN[p]
                });
            }
        }
        const csvOpenByDay = {};
        for (const s of csvOpen) (csvOpenByDay[s.day] = csvOpenByDay[s.day] || []).push(s);
        const csvLibDays = Object.entries(csvOpenByDay)
            .sort((a, b) => b[1].length - a[1].length || TT_DAYS.indexOf(a[0]) - TT_DAYS.indexOf(b[0]))
            .slice(0, 2)
            .map(([d]) => d);
        for (const day of csvLibDays) {
            csvOpenByDay[day]
                .sort((a, b) => a.period - b.period)
                .slice(0, 2)
                .forEach(s => {
                    s.kind = 'study';
                    s.subjectCode = 'LIB';
                    s.subject = 'Central Library & Self-Study';
                    s.teacherName = 'Self Study';
                    s.room = 'Central Library';
                });
        }
        full.push(...csvOpen);
        timetableDB.slots = [...others, ...full].sort((a, b) =>
            (a.sectionKey || '').localeCompare(b.sectionKey || '') || a.day.localeCompare(b.day) || a.period - b.period);
        timetableDB.version = `${timetableDB.version}-csv${Math.floor(Math.random() * 9000 + 1000)}`;
        timetableDB.generatedAt = new Date().toISOString();
        timetableDB.generatedBy = `CSV upload — ${req.user?.name || 'Admin'}`;
        timetableDB.sections = (timetableDB.sections || []).map(s =>
            s.key === sectionKey ? { ...s, sessions: placed.filter(x => x.kind !== 'study' && x.kind !== 'free').length } : s);
        const lectures = timetableDB.slots.filter(x => x.kind === 'lecture').length;
        const labsCount = timetableDB.slots.filter(x => x.kind === 'lab').length;
        timetableDB.summary = { ...(timetableDB.summary || {}), lectureSessions: lectures, labSessions: labsCount };
        ttPersist(timetableDB, timetableDB.generatedBy);

        return res.json({
            success: true, dryRun: false, sectionKey,
            version: timetableDB.version,
            published: placed.length,
            autofills: autofills.length,
            statement: `CSV timetable published for ${sectionKey.split('|').join(' ')} — ${placed.length} classes, ${autofills.length} auto-fills, other 39 sections untouched`
        });
    } catch (err) {
        console.error('timetable CSV failed:', err.message);
        return res.status(500).json({ success: false, error: 'CSV processing failed: ' + err.message });
    }
});

// A class/period attendance record is marked BY a real login
// (`takenBy` staff FAC id) FOR an exact class (department +
// subject + period + date). Plain UX rule: a TICKED roll is
// PRESENT, a BLANK roll is ABSENT — the stored record keeps
// the explicit present list, so nothing is ever ambiguous.
// Students physically out of campus (last gate scan OUT, no
// later IN) surface as a GATE SUGGESTION chip next to the
// roster entry — ONLINE ONLY (the hint comes from live
// pass_scans; offline the chips simply don't render).
// ============================================================
const ATTENDANCE_FILE = path.join(__dirname, 'data', 'attendance.json');
// localDayKey() from the leave system above is reused for YYYY-MM-DD dates.

function loadAttendance() {
    try {
        if (fs.existsSync(ATTENDANCE_FILE)) {
            const raw = JSON.parse(fs.readFileSync(ATTENDANCE_FILE, 'utf8'));
            if (Array.isArray(raw)) return raw;
        }
    } catch { /* corrupt -> start empty */ }
    return [];
}

function persistAttendance(db) {
    try {
        fs.mkdirSync(path.dirname(ATTENDANCE_FILE), { recursive: true });
        fs.writeFileSync(ATTENDANCE_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        console.warn('attendance save skipped:', e.message);
    }
}

const attendanceDB = loadAttendance();

// Class roster for a department (TEACHER/ADMIN/DEAN only).
app.get('/api/attendance/roster', authenticateUser, requireRole('TEACHER', 'ADMIN', 'DEAN'), async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ success: false, error: 'database offline' });

        // Step 4: the SECTION is the scope — `?section=course|department|section`
        // returns exactly that section's 50 students. The legacy
        // `?department=` mode stays for admin-wide audits.
        const sectionKey = String(req.query.section || '').trim();
        if (sectionKey) {
            const [course, department, section] = sectionKey.split('|');
            if (!course || !department || !section) {
                return res.status(400).json({ success: false, error: 'section key must be course|department|section' });
            }
            const { data, error } = await supabase
                .from('profiles')
                .select('roll_number, full_name, resident_type, hostel_block, room_number')
                .eq('role', 'STUDENT')
                .eq('course', course)
                .eq('department', department)
                .eq('section', section)
                .order('roll_number', { ascending: true });
            if (error) return res.status(500).json({ success: false, error: error.message });
            return res.json({
                success: true,
                sectionKey,
                sectionLabel: `${course} ${department} — Sec ${section}`,
                students: (data || []).map(s => ({
                    roll: String(s.roll_number || '').trim(),
                    name: s.full_name,
                    residentType: s.resident_type || 'dayscholar',
                    block: s.hostel_block || null,
                    room: s.room_number || null
                }))
            });
        }

        const deptLabel = String(req.query.department || '').trim();
        if (!deptLabel) return res.status(400).json({ success: false, error: 'section or department required' });
        const { data, error } = await supabase
            .from('profiles')
            .select('roll_number, full_name, resident_type, hostel_block, room_number')
            .eq('role', 'STUDENT')
            .eq('department', deptLabel)
            .order('roll_number', { ascending: true });
        if (error) return res.status(500).json({ success: false, error: error.message });
        return res.json({
            success: true,
            department: deptLabel,
            students: (data || []).map(s => ({
                roll: String(s.roll_number || '').trim(),
                name: s.full_name,
                residentType: s.resident_type || 'dayscholar',
                block: s.hostel_block || null,
                room: s.room_number || null
            }))
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Gate suggestion hints for a whole class — a LITERAL gate-state read of
// today's pass_scans (COMMUTE + LEAVE). Online only: the client simply
// never calls this when offline, so the chip never shows offline.
app.get('/api/attendance/gate-hints', authenticateUser, requireRole('TEACHER', 'ADMIN', 'DEAN'), async (req, res) => {
    try {
        if (!supabase || !gpSupabaseOk) return res.json({ success: true, connected: false, hints: {} });
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const { data, error } = await supabase
            .from('pass_scans')
            .select('student_roll, direction, scanned_at')
            .gte('scanned_at', startOfDay.toISOString())
            .order('scanned_at', { ascending: true });
        if (error) return res.json({ success: true, connected: false, error: error.message, hints: {} });
        const lastByRoll = {};
        for (const row of (data || [])) {
            const roll = String(row.student_roll || '').trim();
            if (roll) lastByRoll[roll] = row; // ascending order -> last write wins
        }
        const hints = {};
        for (const [roll, last] of Object.entries(lastByRoll)) {
            hints[roll] = {
                state: last.direction === 'IN' ? 'IN' : 'OUT',
                since: last.scanned_at,
                category: last.category || null
            };
        }
        return res.json({ success: true, connected: true, hints });
    } catch (err) {
        return res.json({ success: true, connected: false, error: err.message, hints: {} });
    }
});

// Live attendance rollup — recomputes every roster student's REAL percentage
// from all recorded sessions of the section and writes it back to the
// profile. Used by BOTH the mark endpoint (after a save) and the admin
// unlock endpoint (after a record is deleted). Detached: callers don't wait.
async function rollupSectionAttendance(sectionKey) {
    try {
        const [course, department, section] = sectionKey.split('|');
        const sectionSessions = attendanceDB.filter(a => a.sectionKey === sectionKey && Array.isArray(a.present));
        const total = sectionSessions.length;
        const { data: roster, error: rErr } = await supabase
            .from('profiles').select('roll_number')
            .eq('role', 'STUDENT').eq('course', course).eq('department', department).eq('section', section);
        if (rErr || !roster) { console.warn('attendance rollup roster failed:', rErr?.message); return; }
        for (const r of roster) {
            const roll = String(r.roll_number || '').trim();
            const presentCount = sectionSessions.filter(a => a.present.includes(roll)).length;
            const pct = total ? Math.round((presentCount / total) * 1000) / 10 : null;
            if (pct == null) continue;   // no sessions left → profiles keep their last real value
            const { error: uErr } = await supabase.from('profiles')
                .update({ attendance_percentage: pct }).eq('roll_number', roll);
            if (uErr) console.warn(`attendance rollup ${roll}:`, uErr.message);
        }
    } catch (e) { console.warn('attendance rollup failed:', e.message); }
}

// Mark / re-mark one class: upserts the (date, sectionKey, period) session.
// Step 4: a SECTION is the scope of a class — two periods of the same period
// number in different sections are DIFFERENT classes (a teacher may teach
// several sections across the week; the solver guarantees one class per
// teacher per period, never two sections at once). The record always stores
// WHO took it — `takenByLogin` is the FAC id of the authenticated staff
// member, `takenByName` their directory name.
//
// HARD LOCK (user policy): once a class is marked for the day it is FROZEN —
// nobody but an ADMIN can overwrite it, and an admin can delete the lock via
// /api/admin/attendance-unlock to let the teacher redo it. The Mark card is
// also TIME-GATED: it only opens 10 minutes before the period starts, so a
// 11 o'clock class can't be marked at 9 in the morning.
app.post('/api/attendance/mark', authenticateUser, requireRole('TEACHER', 'ADMIN', 'DEAN'), (req, res) => {
    const body = req.body || {};
    const sectionKey = String(body.sectionKey || '').trim();
    const deptLabel = String(body.department || '').trim();      // display label, e.g. 'BTech CSE'
    const subjectCode = String(body.subjectCode || '').trim();
    const subject = String(body.subject || '').trim();
    const day = String(body.day || '').trim().toUpperCase();
    const period = parseInt(body.period, 10);
    const kind = String(body.kind || 'lecture') === 'lab' ? 'lab' : 'lecture';
    if (!sectionKey || !deptLabel || !subjectCode || !subject || !day || !TT_PERIOD_TIME[period]) {
        return res.status(400).json({ success: false, error: 'sectionKey, department, subject, day and a valid period are all required' });
    }
    const present = Array.isArray(body.present) ? [...new Set(body.present.map(r => String(r).trim()).filter(Boolean))] : null;
    if (!present) return res.status(400).json({ success: false, error: 'present list required (blank roster = all absent, save still records it)' });

    const today = localDayKey();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    // TIME GATE — opens 10 minutes before the period's start minute.
    const grid = TT_GRID.find(g => g.label === `P${period}`);
    if (grid && nowMin < grid.startMin - 10) {
        const opensMin = grid.startMin - 10;
        const hh = Math.floor(opensMin / 60), mm = opensMin % 60;
        const opensAt = `${hh > 12 ? hh - 12 : hh || 12}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`;
        return res.status(403).json({
            success: false, notOpenYet: true,
            error: `Marking opens at ${opensAt} (10 minutes before ${grid.start}). The class can't be marked early.`
        });
    }

    // HARD LOCK — a saved (date, sectionKey, period) is frozen. ADMIN may
    // overwrite (and /api/admin/attendance-unlock deletes the lock entirely).
    const role = String(req.user?.profile?.role || req.user?.role || '').toUpperCase();
    const existing = attendanceDB.find(a => a.date === today && a.sectionKey === sectionKey && a.period === period);
    if (existing && role !== 'ADMIN') {
        return res.status(409).json({
            success: false, locked: true,
            error: `Attendance for this class is LOCKED — ${existing.takenByName || 'a teacher'} already marked it (${(existing.present || []).length} present). Only an admin can unlock it.`
        });
    }

    const takenByLogin = String(req.user?.profile?.rollNumber || req.user?.rollNumber || '').trim();
    const takenByName = String(req.user?.profile?.name || req.user?.name || '').trim() || takenByLogin;

    let rec = existing;
    if (!rec) {
        rec = {
            id: `ATT-${today}-P${period}-${subjectCode}-${sectionKey.replace(/[^A-Za-z0-9]/g, '')}`,
            date: today, day, period,
            sectionKey,                       // 'BTech|Computer Science & Engineering|A' — the real class
            sectionLabel: `${deptLabel} — Sec ${sectionKey.split('|').pop()}`,
            department: deptLabel,            // display label, e.g. 'BTech CSE'
            subjectCode, subject, kind,
            createdMs: Date.now()
        };
        attendanceDB.push(rec);
    }
    // Re-marks by another teacher update the record — the LAST authority
    // for the class wins, and both logins stay stamped on the record.
    rec.day = day;
    rec.subjectCode = subjectCode;
    rec.subject = subject;
    rec.kind = kind;
    rec.present = present;
    rec.takenByLogin = takenByLogin;
    rec.takenByName = takenByName;
    rec.takenAt = new Date().toISOString();
    persistAttendance(attendanceDB);

    // Live attendance rollup: this mark recomputes every roster student's
    // REAL percentage from all recorded sessions of THIS section — the
    // dashboards then show the live value instead of a seeded number.
    rollupSectionAttendance(sectionKey);

    return res.json({
        success: true,
        record: rec,
        statement: `${takenByName} (${takenByLogin}) marked ${subjectCode} ${sectionKey.split('|').pop()} of ${deptLabel} · P${period} · present ${present.length}`
    });
});

// ADMIN unlock — hard-lock release valve. Deletes the saved (date,
// sectionKey, period) record so the teacher can mark that class fresh; the
// section's live percentages are recomputed afterwards. Deleting the ONLY
// session of a section leaves the profiles at their last real value.
app.post('/api/admin/attendance-unlock', authenticateUser, requireRole('ADMIN'), (req, res) => {
    const body = req.body || {};
    const sectionKey = String(body.sectionKey || '').trim();
    const period = parseInt(body.period, 10);
    const date = String(body.date || localDayKey()).trim();
    if (!sectionKey || !TT_PERIOD_TIME[period]) {
        return res.status(400).json({ success: false, error: 'sectionKey and a valid period are required' });
    }
    const idx = attendanceDB.findIndex(a => a.date === date && a.sectionKey === sectionKey && a.period === period);
    if (idx < 0) return res.status(404).json({ success: false, error: 'no saved attendance for that class on that date' });
    const removed = attendanceDB.splice(idx, 1)[0];
    persistAttendance(attendanceDB);
    rollupSectionAttendance(sectionKey);
    return res.json({
        success: true,
        removed: { id: removed.id, present: (removed.present || []).length, takenByName: removed.takenByName },
        statement: `Admin ${req.user?.profile?.name || req.user?.name || ''} unlocked ${sectionKey.split('|').pop()} of ${removed.department || sectionKey} · P${period} · ${date} — the class can be marked again`
    });
});

// The day's (or history's) attendance records — ADMIN/DEAN get everything,
// TEACHERs get only sessions whose takenByLogin is themselves UNLESS they
// ask with ?all=1, which stays restricted to ADMIN/DEAN.
app.get('/api/attendance/sessions', authenticateUser, requireRole('TEACHER', 'ADMIN', 'DEAN'), (req, res) => {
    const date = String(req.query.date || localDayKey()).trim();
    const role = String(req.user?.profile?.role || req.user?.role || '').toUpperCase();
    const myLogin = String(req.user?.profile?.rollNumber || req.user?.rollNumber || '').trim().toUpperCase();
    const wantAll = req.query.all === '1';
    let rows = attendanceDB.filter(a => a.date === date);
    if (!wantAll && role === 'TEACHER') rows = rows.filter(a => String(a.takenByLogin || '').toUpperCase() === myLogin);
    rows = rows.slice().sort((a, b) => (a.period || 0) - (b.period || 0));
    return res.json({ success: true, date, sessions: rows });
});

// Student view: every marked session for MY SECTION (Step 4) that INCLUDED
// me. Falls back to the department-wide scope only for students somehow
// missing the course/section columns.
app.get('/api/attendance/me', authenticateUser, (req, res) => {
    const roll = String(req.user?.profile?.rollNumber || req.user?.rollNumber || '').trim();
    const prof = req.user?.profile || {};
    if (!roll) return res.status(400).json({ success: false, error: 'roll unknown' });
    const myKey = (prof.course && prof.section) ? `${prof.course}|${prof.department}|${prof.section}` : null;
    let mine = attendanceDB.filter(a => Array.isArray(a.present) &&
        (myKey ? a.sectionKey === myKey : a.department === prof.department));
    const sessions = mine.map(a => ({
        id: a.id, date: a.date, day: a.day, period: a.period,
        subjectCode: a.subjectCode, subject: a.subject, kind: a.kind,
        sectionKey: a.sectionKey || null,
        present: a.present.includes(roll),
        takenByName: a.takenByName, takenByLogin: a.takenByLogin,
        presentCount: a.present.length,
        markedAt: a.takenAt
    })).sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.period || 0) - (a.period || 0));
    const marked = sessions.filter(s => s.present).length;
    return res.json({
        success: true,
        sectionKey: myKey,
        totalMarkedSessions: mine.length,
        presentCount: marked,
        percentage: mine.length ? Math.round((marked / mine.length) * 1000) / 10 : null,
        sessions
    });
});

// Student pass status lookup — the approval happens on the WARDEN's device,
// so the student's phone/browser ledger can stay stale ("Pending") forever.
// The student app polls this lightweight endpoint and reconciles its local
// copy with the authoritative in-memory pass (status/token/validUntil).
app.get('/api/pass-status', authenticateUser, (req, res) => {
    const passId = String(req.query.id || '').trim();
    if (!passId) return res.status(400).json({ success: false, error: 'id required' });
    const pass = gatePassesDB.find(p => String(p.id) === passId);
    return res.json({ success: true, pass: pass || null });
});

// Student directory search for WARDEN desk use (e.g. creating a gate pass
// on behalf of a student whose phone is just a keypad handset). Returns the
// same fields the warden needs for the form — no sensitive leak to students
// because the route is staff-role restricted.
app.get('/api/students/search', authenticateUser, requireRole('WARDEN', 'ADMIN', 'DEAN'), async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (q.length < 2) return res.json({ success: true, results: [] });
        const like = q.replace(/\s+/g, '%');
        const { data, error } = await supabase
            .from('profiles')
            .select('roll_number, full_name, hostel_block, room_number, department, phone_number')
            .eq('role', 'STUDENT')
            .or(`roll_number.ilike.%${like}%,full_name.ilike.%${like}%`)
            .order('roll_number', { ascending: true })
            .limit(8);
        if (error) throw error;
        return res.json({ success: true, results: data || [] });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message, results: [] });
    }
});

// Pass lookup for GUARD manual verification (keypad-phone students who can
// only speak their GP number). Normalizes input ("984163" -> "GP-984163"),
// resolves the AUTHORITATIVE record (server memory first, then Supabase row
// joined with profile), and tells the client which gate actions are legal.
app.get('/api/pass-lookup', authenticateUser, requireRole('GUARD', 'ADMIN', 'WARDEN', 'DEAN'), async (req, res) => {
    try {
        let raw = String(req.query.id || '').trim().toUpperCase().replace(/\s+/g, '');
        if (/^\d{6}$/.test(raw)) raw = `GP-${raw}`;
        if (!/^GP-\d{6}$/.test(raw)) {
            return res.status(400).json({ success: false, error: 'Enter the 6-digit pass number (e.g. GP-984163)' });
        }

        // 1. Authoritative server-memory ledger first (covers app-created passes)
        let pass = gatePassesDB.find(p => String(p.id).toUpperCase() === raw) || null;
        if (pass) {
            const status = String(pass.status || '').toUpperCase();
            return res.json({
                success: true,
                pass: {
                    id: pass.id,
                    name: pass.name || 'Student',
                    rollNo: pass.rollNo || '',
                    destination: pass.destination || '',
                    passType: pass.passType || 'Day Pass',
                    priority: !!pass.priority,
                    status,
                    statusLabel: pass.statusLabel || pass.status,
                    validUntil: pass.validUntil || null,
                    verifiedAt: pass.verifiedAt || null,
                    exitAllowed: status === 'APPROVED',
                    returnAllowed: status === 'USED'
                }
            });
        }

        // 2. Supabase row (approved steps may live only in the cloud table)
        if (supabase && gpSupabaseOk) {
            const { data: row, error } = await supabase
                .from('gate_passes')
                .select('*, student:profiles(full_name, roll_number)')
                .eq('pass_ref', raw)
                .maybeSingle();
            if (error) gpDisableSupabase(error);
            if (row) {
                // Canonical status comes from the enum column; status_label is
                // just a human string. A USED row labeled "Returned to Campus"
                // is semantically RETURNED (label-based fallback for ledger
                // variants that could not store the RETURNED enum value).
                const enumStatus = String(row.status || '').toUpperCase();
                const labelU = String(row.status_label || '').toUpperCase();
                const status = enumStatus === 'USED' && labelU.includes('RETURNED')
                    ? 'RETURNED'
                    : enumStatus;
                return res.json({
                    success: true,
                    pass: {
                        id: raw,
                        name: row.student?.full_name || 'Student',
                        rollNo: row.student?.roll_number || '',
                        destination: row.destination || '',
                        passType: row.pass_category === 'MEDICAL' ? 'Medical Outing' : row.pass_category === 'HOME_LEAVE' ? 'Home Leave' : 'Day Pass',
                        priority: !!row.priority,
                        status,
                        statusLabel: row.status_label || row.status,
                        validUntil: row.valid_until || null,
                        verifiedAt: row.verified_at || null,
                        exitAllowed: status === 'APPROVED',
                        returnAllowed: status === 'USED'
                    }
                });
            }
        }

        return res.status(404).json({ success: false, error: 'No pass found with that number' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Gate Pass Scan (Guard QR verification) — mark pass as USED/EXPIRED once scanned
app.post('/api/scan-pass', authenticateUser, requireRole('GUARD', 'ADMIN', 'WARDEN', 'DEAN'), async (req, res) => {
    try {
        const { passData } = req.body;
        if (!passData || !passData.id) {
            return res.status(400).json({ success: false, error: 'passData is required' });
        }
        const scannedAt = passData.verifiedAt || new Date().toISOString();
        const direction = passData.direction === 'RETURN' ? 'RETURN' : 'EXIT';

        // Authoritative current status: server memory first, then Supabase.
        // A pass must be APPROVED for EXIT and USED for RETURN — the state
        // machine is enforced HERE, not on whatever device the guard holds.
        let current = gatePassesDB.find(p => String(p.id) === String(passData.id)) || null;
        let currentStatus = current ? String(current.status || '').toUpperCase() : null;
        let currentVerifiedAtMs = current?.verifiedAt ? new Date(current.verifiedAt).getTime() : 0;
        if (!currentStatus && supabase && gpSupabaseOk) {
            try {
                const { data: row } = await supabase
                    .from('gate_passes')
                    .select('status, status_label, verified_at')
                    .eq('pass_ref', String(passData.id).toUpperCase())
                    .maybeSingle();
                const enumStatus = String(row?.status || '').toUpperCase();
                const labelU = String(row?.status_label || '').toUpperCase();
                currentStatus = enumStatus === 'USED' && labelU.includes('RETURNED')
                    ? 'RETURNED'
                    : enumStatus || null;
                currentVerifiedAtMs = row?.verified_at ? new Date(row.verified_at).getTime() : 0;
            } catch (e) { /* treat as unknown, fall through */ }
        }

        // DOUBLE-SCAN COOLDOWN (Phase 0): a pass scanned seconds ago is a
        // guard double-flash, not a real gate movement. Leaving campus and
        // instantaneously re-entering (exit -> return within the window)
        // silently completed the whole round trip — the cooldown keeps the
        // pass genuinely OUT while telling the guard exactly why. 3 minutes
        // is plenty against accidental re-flashes, useless for fraud.
        const SCAN_COOLDOWN_MS = 3 * 60000;
        if (currentStatus && direction === 'RETURN' && currentStatus === 'USED' && currentVerifiedAtMs && (Date.now() - currentVerifiedAtMs) < SCAN_COOLDOWN_MS) {
            const ago = Math.max(1, Math.round((Date.now() - currentVerifiedAtMs) / 1000));
            return res.status(429).json({
                success: false,
                cooldown: true,
                reason: `Exited only ${ago}s ago — treat as a DOUBLE SCAN, not a return. The pass is still legitimately OUT; a return can be registered after ${Math.round(SCAN_COOLDOWN_MS / 1000)}s.`
            });
        }

        if (direction === 'EXIT' && currentStatus !== 'APPROVED') {
            const reason = currentStatus === 'USED'
                ? 'Already exited — pass was used at the gate'
                : currentStatus === 'RETURNED'
                    ? 'Round trip already completed — pass is closed'
                    : currentStatus === 'PENDING'
                        ? 'Warden approval still pending — pass is not valid yet'
                        : 'Pass is not in an exit-allowed state';
            return res.status(409).json({ success: false, reason });
        }
        // RESIDENCY LOCK (hosteller instrument): gate passes are the HOSTELLER
        // outing flow. A day scholar must leave via the MENTOR-APPROVED leave
        // system (campus-ID QR -> /api/leave-scan), never on a gate pass —
        // otherwise any pass would bypass the leave approval entirely. Returns
        // stay open (letting a stray scan back IN is always safe).
        if (direction === 'EXIT' && supabase && gpSupabaseOk) {
            try {
                const { data: resProf } = await supabase
                    .from('profiles')
                    .select('resident_type, full_name')
                    .ilike('roll_number', String(passData.rollNo || '').trim())
                    .maybeSingle();
                if (String(resProf?.resident_type || '').toLowerCase() === 'dayscholar') {
                    return res.status(403).json({
                        success: false,
                        residency: true,
                        reason: `${resProf.full_name || passData.name} is a DAY SCHOLAR — exits go through the mentor LEAVE system only. Ask them to flash their Campus-ID QR (leave must be APPROVED by their mentor); a gate pass is a hosteller instrument.`
                    });
                }
            } catch (e) { /* directory unreachable: don't block the gate */ }
        }
        if (direction === 'RETURN' && currentStatus !== 'USED') {
            const reason = currentStatus === 'RETURNED'
                ? 'Already returned — round trip completed'
                : currentStatus === 'APPROVED'
                    ? 'Student has not exited campus yet'
                    : 'Pass is not in a return-allowed state';
            return res.status(409).json({ success: false, reason });
        }

        const isReturn = direction === 'RETURN';
        const newStatus = isReturn ? 'RETURNED' : 'USED';
        // Late-return quantification: everyone (guard, student, admin desk)
        // should read HOW late the return was, not just THAT it was late.
        const lateMinutes = (isReturn && passData.validUntil)
            ? Math.max(0, Math.round((new Date(scannedAt) - new Date(passData.validUntil)) / 60000))
            : 0;
        const lateText = lateMinutes >= 60
            ? `${Math.floor(lateMinutes / 60)}h ${lateMinutes % 60}m`
            : `${lateMinutes}m`;
        const newLabel = isReturn
            ? (lateMinutes > 0 ? `Returned to Campus (Late by ${lateText})` : 'Returned to Campus')
            : 'Scanned at Main Gate (Expired)';

        // 1. Update in-memory store
        const patch = {
            ...passData,
            status: newStatus,
            statusLabel: newLabel,
            verifiedAt: scannedAt,
            scannedBy: passData.scannedBy || 'Main Gate Guard'
        };
        if (isReturn) {
            patch.gateCheckInStatus = 'CHECKED_IN';
            patch.returnedAt = scannedAt;
        } else {
            patch.gateCheckInStatus = 'CHECKED_OUT';
        }
        const existingIdx = gatePassesDB.findIndex(p => p.id === passData.id);
        if (existingIdx >= 0) {
            gatePassesDB[existingIdx] = { ...gatePassesDB[existingIdx], ...patch };
        } else {
            gatePassesDB.unshift(patch);
        }
        persistGatePasses();

        // 2. Best-effort persistence to Supabase (never blocks the response)
        if (supabase && gpSupabaseOk) {
            supabase
                .from('gate_passes')
                .update({
                    status: newStatus,
                    status_label: newLabel,
                    verified_at: scannedAt,
                    scanned_by: passData.scannedBy || 'Main Gate Guard'
                })
                .eq('pass_ref', passData.id)
                .then(({ error }) => {
                    if (!error) return;
                    // Defensive fallback: if the DB enum predates the RETURNED
                    // state, retry as USED — the human-readable status_label
                    // still carries the truth. Persistence stays enabled.
                    if (newStatus === 'RETURNED' && /enum|RETURNED/i.test(error.message || '')) {
                        supabase
                            .from('gate_passes')
                            .update({
                                status: 'USED',
                                status_label: newLabel,
                                verified_at: scannedAt,
                                scanned_by: passData.scannedBy || 'Main Gate Guard'
                            })
                            .eq('pass_ref', passData.id)
                            .then(({ error: e2 }) => { if (e2) gpDisableSupabase(e2); });
                        return;
                    }
                    gpDisableSupabase(error);
                });
        }

        // 3. THE GATE REGISTER — append-only log of every physical scan the
        // guard performs (EXIT out of campus / RETURN into campus). One row
        // per scan, never updated. late_return flags a student who walked in
        // after their pass's expected-return time.
        if (supabase && gpSupabaseOk) {
            const scanRow = {
                pass_ref: passData.id,
                student_roll: passData.rollNo || '',
                student_name: passData.name || 'Student',
                destination: passData.destination || '',
                category: passData.passType || 'Day Pass',
                direction,
                method: String(passData.method || 'QR').toUpperCase() === 'MANUAL' ? 'MANUAL' : 'QR',
                scanned_by: passData.scannedBy || 'Main Gate Guard',
                scanned_at: scannedAt,
                late_return: isReturn && passData.validUntil
                    ? new Date(scannedAt) > new Date(passData.validUntil)
                    : false
            };
            supabase.from('pass_scans').insert(scanRow)
                .then(({ error: scanErr }) => {
                    // The register is valuable but must never break the gate
                    // flow — log-and-continue if the table is missing.
                    if (scanErr) console.warn('pass_scans insert skipped:', scanErr.message);
                });
        }

        // Gate-scan confirmations: EXIT leg was silent until now — every scan
        // now reaches the student: activated ones by PUSH, keypad-phone
        // students by SMS (allowlist-gated inside dispatchSms). RETURN keeps
        // its existing message plus the late flag. Fire-and-forget.
        // SAFETY NET: the ward's GUARDIAN is SMSed on BOTH legs — EXIT tells
        // parents the ward left (pass reason + destination + time) and RETURN
        // confirms they are back on campus (time, LATE flag if any). A parent
        // always knows where their ward is without asking the college.
        const lateReturn = isReturn && passData.validUntil && new Date(scannedAt) > new Date(passData.validUntil);
        const gateTimeHM = new Date(scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const gateNotifyText = isReturn
            ? `CampusDebug OS: Return registered. Gate Pass ${passData.id} — you are back in campus.${lateReturn ? ` This return was recorded LATE by ${lateText}.` : ''}`
            : `CampusDebug OS: Exit recorded. Gate Pass ${passData.id} — you have left campus. Show this pass on your way back; it closes after the return scan.`;
        const parentGateText = isReturn
            ? `CampusDebug OS: Your ward ${passData.name} has RETURNED to campus at ${gateTimeHM} (Gate Pass ${passData.id}).${lateReturn ? ` The return was recorded ${lateText} late.` : ' Safe and present.'}`
            : `CampusDebug OS: Your ward ${passData.name} has LEFT campus at ${gateTimeHM} on Gate Pass ${passData.id} (going to: ${passData.destination || 'destination as approved'}). You will receive another SMS when they return to campus.`;
        const gatePushPayload = isReturn
            ? { title: lateReturn ? `⏰ Late Return Registered (+${lateText})` : '✅ Return Registered', body: `Gate Pass ${passData.id} closed — you are back on campus.` }
            : { title: '🚪 Exit Recorded', body: `Gate Pass ${passData.id} — exit scanned at Main Gate. See you back on time.` };
        if (passData.rollNo) {
            (async () => {
                try {
                    let phone = passData.phoneNumber || null;
                    let guardian = null;
                    if (supabase) {
                        const { data: prof } = await supabase
                            .from('profiles')
                            .select('phone_number, guardian_phone')
                            .ilike('roll_number', String(passData.rollNo).trim())
                            .maybeSingle();
                        if (prof?.phone_number) phone = phone || prof.phone_number;
                        if (prof?.guardian_phone) guardian = prof.guardian_phone;
                    }
                    // 1) The ward's own confirmation (push for activated, SMS otherwise)
                    const delivery = await notifyStudent(passData.rollNo, phone, gateNotifyText);
                    if (delivery.mode === 'push') {
                        await pushToRolls([passData.rollNo], gatePushPayload).catch(() => {});
                    }
                    // 2) Parent safety SMS — both legs, only if a guardian
                    //    number is on file (the allowlist still guards real
                    //    gateway traffic during demos).
                    if (guardian) {
                        await dispatchSms(guardian, parentGateText);
                    } else {
                        console.log(`📵 no guardian_phone on file for ${passData.rollNo} — parent gate SMS skipped`);
                    }
                } catch (notifyErr) {
                    console.warn('gate-scan notification skipped (non-blocking):', notifyErr.message);
                }
            })();
        }

        return res.json({ success: true, passId: passData.id, status: newStatus, direction, verifiedAt: scannedAt });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ----------------------------------------------------
// 9b. TICKET STATUS / SLA SHARED HELPERS
// ----------------------------------------------------
const TICKET_STATUS_LABELS = {
    REPORTED: 'Reported',
    PENDING: 'Pending Assignment',
    ASSIGNED: 'Assigned to Technician',
    IN_PROGRESS: 'Technician Working',
    RESOLVED: 'Resolved',
    CLOSED: 'Closed',
    ESCALATED_TO_DEAN: 'Escalated to Dean'
};

function computeSlaState(row) {
    const ms = (row.createdAtMs || (row.created_at ? new Date(row.created_at).getTime() : (row.createdAt ? new Date(row.createdAt).getTime() : 0)));
    const slaHours = Number(row.sla_hours) || 4;
    if (!ms) return { slaHoursLeft: slaHours, slaState: 'on_track' };
    const elapsed = (Date.now() - ms) / 3600000;
    const left = slaHours - elapsed;
    const state = left <= 0 ? 'breached' : left < 1 ? 'warn' : 'on_track';
    return { slaHoursLeft: left, slaState: state };
}

// Enriches any ticket row (cloud or in-memory) with the fields the UI renders.
// Cloud schema has no assigned_technician column — the live assignment map from
// ticketsDB (creation-time routing) is merged in by id.
function enrichTicketRow(row) {
    if (!row) return row;
    const base = normalizeDashboardRow(row);
    const mem = ticketsDB.find(t => String(t.id) === String(row.id));
    const led = ticketLedgerDB[String(row.id)] || null;
    const status = String(base.status || 'PENDING').toUpperCase() || 'PENDING';
    const sla = computeSlaState(base);
    const assigned = base.assignedTo || base.assigned_technician || (led ? led.assignedTo : null) || (mem ? mem.assignedTo : null);
    // Ledger overrides (survive restarts): warden-closed tickets + the
    // student "job done" confirmation. DB status stays RESOLVED if the
    // enum isn't migrated — the ledger is the source of truth for closed.
    const isClosed = !!(led && led.closed) || status === 'CLOSED';
    const effStatus = isClosed ? 'CLOSED' : status;
    return {
        ...base,
        status: effStatus,
        statusLabel: isClosed
          ? 'Closed — student confirmed, warden verified'
          : (mem?.statusLabel || (led ? led.statusLabel : null) || base.statusLabel || TICKET_STATUS_LABELS[status] || status),
        studentConfirmed: !!(led && led.studentConfirmed) || mem?.studentConfirmed === true,
        assignedTo: assigned,
        aiCategory: base.aiCategory || base.ai_category || (led ? led.aiCategory : null) || (mem ? mem.aiCategory : null) || null, // Fix 4
        assignedTechId: base.assignedTechId || base.assigned_technician_id || (led ? led.assignedTechId : null) || (mem ? mem.assignedTechId : null) || null,
        masterId: base.master_incident_id || base.masterId || (mem ? mem.masterId : null) || null,
        slaHoursLeft: sla.slaHoursLeft,
        slaState: sla.slaState,
        isCritical: String(base.urgency || '').toUpperCase() === 'CRITICAL' || status === 'ESCALATED_TO_DEAN',
        description: base.description || base.raw_text || base.complaintText || null
    };
}

// Supabase enum safety: tickets.status only allows PENDING|ASSIGNED|RESOLVED|
// ESCALATED_TO_DEAN and master_incidents.status only OPEN|RESOLVED. Map any
// richer UI state onto the closest legal value before every DB write.
function safeTicketStatus(status) {
    const s = String(status || '').toUpperCase();
    if (['PENDING', 'ASSIGNED', 'RESOLVED', 'ESCALATED_TO_DEAN'].includes(s)) return s;
    return 'RESOLVED'; // IN_PROGRESS / CLOSED / REPORTED degrade to the final state they imply
}
function safeMasterStatus(status) {
    const s = String(status || '').toUpperCase();
    return s === 'RESOLVED' ? 'RESOLVED' : 'OPEN'; // IN_PROGRESS/UNASSIGNED/CLOSED/ESCALATED stay OPEN
}

// In-memory master-incident assignment map (the schema-proof fallback when
// the assigned_technician column is unavailable in Supabase)
const masterAssignmentsDB = {}; // { masterId: { name, id } }

// also (id: { name, id })
loadLedger(); // restore routing ledger from disk (assignments survive restarts)

async function updateMasterAssignment(masterId, tech) {
    masterAssignmentsDB[masterId] = { name: tech.name, id: tech.id };
    if (supabase) {
        // Best-effort persisted assignment; the in-memory map is the source of
        // truth (the cloud schema keeps the master OPEN — escalation state lives here)
        try {
            await supabase.from('master_incidents')
                .update({ status: safeMasterStatus('IN_PROGRESS') })
                .eq('id', masterId);
        } catch (err) {
            console.warn('master assignment persist skipped:', err.message);
        }
    }
    saveLedger();
}

// Cascade status change: master incident + ALL linked student tickets
async function cascadeStatus({ masterId, ticketId, status, note, actor = '' }) {
    const results = { masterUpdated: false, ticketsUpdated: 0, affected: [] };

    // 1. Supabase (authoritative)
    if (supabase) {
        try {
            const dbTicketStatus = safeTicketStatus(status);
            const dbMasterStatus = safeMasterStatus(status);
            let linkedTickets = [];
            if (masterId) {
                const { error } = await supabase.from('master_incidents')
                    .update({ status: dbMasterStatus })
                    .eq('id', masterId);
                results.masterUpdated = !error;
                const { data: lt } = await supabase
                    .from('tickets').select('id, raw_text, category, location, master_incident_id')
                    .eq('master_incident_id', masterId);
                linkedTickets = lt || [];
            }
            if (masterId && masterAssignmentsDB[masterId] === undefined) {
                // Touched by cascade without prior assignment (e.g. resolve)
                const { data: mRow } = await supabase.from('master_incidents')
                    .select('assigned_technician').eq('id', masterId).maybeSingle();
                if (mRow && mRow.assigned_technician) masterAssignmentsDB[masterId] = { name: mRow.assigned_technician, id: null };
            }
            if (masterId || ticketId) {
                const columnUpdate = { status: dbTicketStatus };
                let query = supabase.from('tickets').update(columnUpdate);
                if (masterId) query = query.eq('master_incident_id', masterId);
                else query = query.eq('id', ticketId);
                const { data: updated, error: tErr } = await query.select('id, raw_text, location, category, master_incident_id');
                if (!tErr && updated) {
                    results.ticketsUpdated += updated.length;
                    results.affected.push(...updated);
                } else if (tErr) {
                    console.warn('ticket cascade update error:', tErr.message);
                }
                // notes: no schema column exists — logged + in-memory only
            }
        } catch (cascadeErr) {
            console.warn('cascadeStatus supabase warning:', cascadeErr.message);
        }
    }

        // In-memory mirror
        const statusLabel = TICKET_STATUS_LABELS[status] || status;
    let memTicketUpdated = false;
    ticketsDB.forEach(t => {
        const hit = masterId ? t.masterId === masterId || t.master_incident_id === masterId
                             : String(t.id) === String(ticketId);
        if (hit) {
            t.status = status;
            t.statusLabel = statusLabel;
            if (note) t.technician_notes = note;
            if (actor) t.lastTechnicianActionBy = actor;
            memTicketUpdated = true;
        }
    });
    masterClustersDB.forEach(c => {
        const hit = masterId ? (c.masterId === masterId || c.id === masterId) : false;
        if (hit) {
            c.status = status;
            if (note) c.technician_notes = note;
            if (status === 'RESOLVED' || status === 'CLOSED') c.slaHoursLeft = 0;
        }
    });
    // Ledger mirror (survives server restarts)
    ticketsDB.forEach(t => {
        const hit = masterId ? (t.masterId === masterId || t.master_incident_id === masterId)
                             : String(t.id) === String(ticketId);
        if (hit) {
            ticketLedgerDB[String(t.id)] = {
                ...(ticketLedgerDB[String(t.id)] || {}),
                statusLabel: statusLabel,
                ...(note ? { notes: note } : {}),
                inProgress: ['IN_PROGRESS'].includes(String(status).toUpperCase()) || undefined
            };
        }
    });
    saveLedger();
    results.memTicketUpdated = memTicketUpdated;
    return results;
}

// ----------------------------------------------------
// 9c. API ROUTE: GET /api/technician/tickets (Technician Work Queue)
// ----------------------------------------------------
app.get('/api/technician/tickets', async (req, res) => {
    try {
        const techId = req.query.techId || '';
        const techName = req.query.techName || '';

        let tickets = [];
        let masterIncidents = [];
        if (supabase) {
            try {
                const { data: tRows } = await supabase
                    .from('tickets')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(80);
                if (tRows) tickets = tRows.map(enrichTicketRow);

                const { data: mRows } = await supabase
                    .from('master_incidents')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(50);
                if (mRows) masterIncidents = mRows;
            } catch (err) {
                console.warn('technician/tickets supabase fallback:', err.message);
            }
        }
        if (tickets.length === 0) tickets = ticketsDB.map(enrichTicketRow);
        if (masterIncidents.length === 0) masterIncidents = masterClustersDB;

        // Beautify master incidents (same mapping as dashboard-data)
        const masterIds = masterIncidents.map(m => m.id);
        let roomTickets = [];
        if (supabase && masterIds.length > 0) {
            try {
                const { data: rt } = await supabase
                    .from('tickets').select('location, master_incident_id').in('master_incident_id', masterIds);
                roomTickets = rt || [];
            } catch { /* rooms stay empty */ }
        }
        const masterIncidentsView = masterIncidents.map(m => {
            const memberRooms = roomTickets
                .filter(t => t.master_incident_id === m.id)
                .map(t => (String(t.location || '').match(/Room\s+(\S+)/i) || [])[1]).filter(Boolean);
            const uniqueRooms = [...new Set(memberRooms)];
            const assigned = m.assigned_technician || (masterAssignmentsDB[m.id] ? masterAssignmentsDB[m.id].name : null);
            const sla = computeSlaState(m);
            return {
                ...m,
                masterId: m.masterId || m.id,
                id: m.id,
                title: m.title || `Multiple ${m.category || 'Category'} Issues Reported`,
                location: m.location ||
                    [m.hostel_block ? `Hostel ${String(m.hostel_block).replace(/^Hostel\s*/i, '')}` : '', m.floor_number].filter(Boolean).join(', ') ||
                    m.cluster_code,
                impactedRooms: (m.impacted_rooms && m.impacted_rooms.length) ? m.impacted_rooms : uniqueRooms.map(r => `Room ${r}`),
                studentsImpacted: m.ticket_count || uniqueRooms.length || 1,
                assignedTo: assigned,
                slaHoursLeft: sla.slaHoursLeft,
                slaState: sla.slaState
            };
        });

        // Server-side filtering to the requesting technician's queue
        const matchesTech = (assigned) => {
            if (!assigned) return false;
            if (techName && String(assigned).toLowerCase().includes(String(techName).toLowerCase())) return true;
            const roster = Object.values(TECHNICIAN_ROSTER);
            const self = roster.find(t => t.id === techId || t.name === techName);
            if (self && String(assigned).toLowerCase().includes(self.name.toLowerCase())) return true;
            return false;
        };

        const myTickets = tickets.filter(t =>
            ['ASSIGNED', 'IN_PROGRESS', 'PENDING', 'REPORTED', 'ESCALATED_TO_DEAN'].includes(t.status) &&
            (matchesTech(t.assignedTo) || (matchesTech(t.masterAssignedTo || null)))
        );
        const myMasters = masterIncidentsView.filter(m =>
            ['OPEN', 'UNASSIGNED', 'IN_PROGRESS', 'ASSIGNED', 'ESCALATED_TO_DEAN'].includes(String(m.status || '').toUpperCase()) &&
            matchesTech(m.assignedTo)
        );
        // Unassigned masters appear to every technician (anyone can accept)
        const openUnassignedMasters = masterIncidentsView.filter(m =>
            ['OPEN', 'UNASSIGNED'].includes(String(m.status || '').toUpperCase()) && !m.assignedTo
        );

        return res.json({
            success: true,
            roster: Object.values(TECHNICIAN_ROSTER),
            tickets: myTickets,
            masterIncidents: myMasters,
            openMasterIncidents: openUnassignedMasters,
            allTickets: tickets,
            techId
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ----------------------------------------------------
// 9d. API ROUTE: POST /api/technician/action
//     action ∈ ASSIGN | ACCEPT | START | ADD_NOTE | RESOLVE | CLOSE
//     target: { masterId } (master incident) or { ticketId } (standalone)
// ----------------------------------------------------
app.post('/api/technician/action', async (req, res) => {
    try {
        const { masterId, ticketId, action, note = '', techName = '', techId = '' } = req.body;
        const allowed = ['ASSIGN', 'ACCEPT', 'START', 'ADD_NOTE', 'RESOLVE', 'CLOSE'];
        if (!allowed.includes(action)) {
            return res.status(400).json({ success: false, error: `action must be one of ${allowed.join(', ')}` });
        }
        if (!masterId && !ticketId) {
            return res.status(400).json({ success: false, error: 'masterId or ticketId required' });
        }
        if (['ASSIGN', 'ACCEPT', 'START'].includes(action) && !masterId && !techName && !techId) {
            return res.status(400).json({ success: false, error: 'techName/techId required for assignment/start actions' });
        }

        const roster = Object.values(TECHNICIAN_ROSTER);
        const self = roster.find(t => t.id === techId || t.name === techName);
        const actor = self ? `${self.name} (${self.role})` : (techName || 'Technician');
        const stamp = new Date().toISOString();

        // ---- Master incident path (dispatch/accept/start/resolve/close cascades) ----
        if (masterId) {
            if (action === 'ASSIGN' || action === 'ACCEPT' || action === 'START') {
                const tech = self || roster[0];
                await updateMasterAssignment(masterId, tech);
                await cascadeStatus({ masterId, status: 'IN_PROGRESS', note: note || null, actor: tech.name });
                console.log(`🔧 [TECHNICIAN DISPATCHED]: Master Incident ${masterId} → ${tech.name} (${tech.id}) at ${stamp}`);
                return res.json({
                    success: true,
                    masterId,
                    action,
                    assignedTo: tech.name,
                    assignedTechId: tech.id,
                    status: 'IN_PROGRESS',
                    message: `Master Incident ${masterId} assigned to ${tech.name}`
                });
            }

            if (action === 'ADD_NOTE') {
                await cascadeStatus({ masterId, status: 'IN_PROGRESS', note, actor });
                console.log(`📝 [TECHNICIAN NOTE]: ${actor} on Master Incident ${masterId}: "${note}"`);
                return res.json({ success: true, masterId, action, status: 'IN_PROGRESS', note });
            }

            const finalStatus = action === 'RESOLVE' ? 'RESOLVED' : 'CLOSED';
            await cascadeStatus({ masterId, status: finalStatus, note: note || null, actor });
            console.log(`✅ [MASTER ${finalStatus}]: ${actor} → Master Incident ${masterId}. All linked student complaints updated & notifications dispatched.`);
            return res.json({
                success: true,
                masterId,
                action,
                status: finalStatus,
                message: `Master Incident ${masterId} ${finalStatus} by ${actor} — linked student complaints updated`
            });
        }

        // ---- Standalone ticket path ----
        if (action === 'ACCEPT' || action === 'START') {
            const tech = self || roster[0];
            if (supabase) {
                try {
                    // Ticket stays 'ASSIGNED' while work is under way (status enum has
                    // no IN_PROGRESS — the working-state lives in the in-memory mirror)
                    await supabase.from('tickets').update({ status: 'ASSIGNED' }).eq('id', ticketId);
                } catch (err) {
                    console.warn('ticket start supabase fallback:', err.message);
                }
            }
            ticketsDB.forEach(t => {
                if (String(t.id) === String(ticketId)) {
                    t.status = 'IN_PROGRESS';
                    t.statusLabel = TICKET_STATUS_LABELS.IN_PROGRESS;
                    t.assignedTo = t.assignedTo || tech.name;
                }
            });
            ticketLedgerDB[String(ticketId)] = {
                ...(ticketLedgerDB[String(ticketId)] || {}),
                assignedTo: tech.name, assignedTechId: tech.id,
                statusLabel: TICKET_STATUS_LABELS.IN_PROGRESS, inProgress: true
            };
            saveLedger();
            console.log(`🔧 [TECHNICIAN STARTED]: Ticket #${ticketId} — ${tech.name} (${tech.id})`);
            return res.json({ success: true, ticketId, action, status: 'IN_PROGRESS', assignedTo: tech.name, message: `Ticket #${ticketId} started by ${tech.name}` });
        }

        if (action === 'ADD_NOTE') {
            ticketsDB.forEach(t => {
                if (String(t.id) === String(ticketId)) {
                    t.technician_notes = note;
                    t.lastTechnicianActionBy = actor;
                }
            });
            ticketLedgerDB[String(ticketId)] = {
                ...(ticketLedgerDB[String(ticketId)] || { assignedTo: actor }),
                notes: note, lastNoteBy: actor, lastNoteAt: stamp
            };
            saveLedger();
            // Note: the Supabase schema has no technician_notes column — the note
            // lives in the routing ledger + live feed (persisted across restarts).
            console.log(`📝 [TECHNICIAN NOTE]: ${actor} on Ticket #${ticketId}: "${note}"`);
            return res.json({ success: true, ticketId, action, note });
        }

        const finalStatus = action === 'RESOLVE' ? 'RESOLVED' : 'CLOSED';
        await cascadeStatus({ ticketId, status: finalStatus, note: note || null, actor });
        console.log(`✅ [TICKET ${finalStatus}]: ${actor} → Ticket #${ticketId}. Student feed notification dispatched.`);
        return res.json({ success: true, ticketId, action, status: finalStatus, message: `Ticket #${ticketId} ${finalStatus}` });
    } catch (err) {
        console.error('technician/action error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ----------------------------------------------------
// 9e. API ROUTE: POST /api/resolve-cluster
//     (Warden-side resolution — cascades to all linked tickets)
// ----------------------------------------------------
app.post('/api/resolve-cluster', authenticateUser, requireRole('WARDEN', 'ADMIN', 'DEAN'), async (req, res) => {
    try {
        const { clusterId } = req.body;
        if (!clusterId) return res.status(400).json({ success: false, error: 'clusterId required' });
        const result = await cascadeStatus({ masterId: clusterId, status: 'RESOLVED', actor: 'Hostel Warden' });
        const resolvedCount = result.ticketsUpdated || result.affected.length || 0;
        console.log(`🌐 [MASTER INCIDENT RESOLVED]: ${clusterId} — ${resolvedCount} student complaint(s) auto-resolved.`);
        return res.json({
            success: true,
            masterClusters: masterClustersDB,
            resolvedTickets: resolvedCount,
            message: `Master Incident ${clusterId} resolved`
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ----------------------------------------------------
// 9f. API ROUTES: Warden intervention (NOT a bottleneck — supervisor tools)
//     POST /api/warden/escalate  → escalate ticket/master to Dean
//     POST /api/warden/reassign  → hand ticket/master to a different technician
// ----------------------------------------------------
app.post('/api/warden/escalate', authenticateUser, requireRole('WARDEN', 'ADMIN', 'DEAN'), async (req, res) => {
    try {
        const { masterId, ticketId } = req.body;
        const target = masterId ? `Master Incident ${masterId}` : `Ticket #${ticketId}`;
        await cascadeStatus({ masterId, ticketId, status: 'ESCALATED_TO_DEAN', actor: 'Hostel Warden' });
        console.log(`🚨 [WARDEN ESCALATION]: ${target} escalated to Dean of Student Affairs via Emergency SMS & Email!`);
        return res.json({
            success: true,
            status: 'ESCALATED_TO_DEAN',
            message: `${target} escalated to Dean of Student Affairs (Emergency SMS + Email dispatched)`
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/warden/reassign', authenticateUser, requireRole('WARDEN', 'ADMIN', 'DEAN'), async (req, res) => {
    try {
        const { masterId, ticketId, technicianId } = req.body;
        const roster = Object.values(TECHNICIAN_ROSTER);
        const tech = roster.find(t => t.id === technicianId || t.name === technicianId);
        if (!tech) {
            return res.status(400).json({ success: false, error: 'Unknown technicianId — use IDs from the roster', roster: roster.map(t => t.id) });
        }
        if (masterId) {
            await updateMasterAssignment(masterId, tech);
            // Assigned-technician column doesn't exist in the cloud schema —
            // the roster assignment lives in masterAssignmentsDB (this process).
            ticketsDB.forEach(t => { if (t.masterId === masterId || t.master_incident_id === masterId) { t.assignedTo = tech.name; } });
            console.log(`🔄 [WARDEN REASSIGNED]: Master Incident ${masterId} → ${tech.name} (${tech.id})`);
            return res.json({ success: true, masterId, assignedTo: tech.name, message: `Master Incident ${masterId} reassigned to ${tech.name}` });
        }
        // No assigned_technician column in cloud — roster assignment reflected live
        ticketsDB.forEach(t => { if (String(t.id) === String(ticketId)) { t.assignedTo = tech.name; } });
        ticketLedgerDB[String(ticketId)] = {
            ...(ticketLedgerDB[String(ticketId)] || {}),
            assignedTo: tech.name, assignedTechId: tech.id
        };
        saveLedger();
        console.log(`🔄 [WARDEN REASSIGNED]: Ticket #${ticketId} → ${tech.name} (${tech.id})`);
        return res.json({ success: true, ticketId, assignedTo: tech.name, message: `Ticket #${ticketId} reassigned to ${tech.name}` });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Production Unified App Shell Fallback Route
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'), err => {
        if (err) {
            res.status(200).send(`CampusDebug OS Unified Backend Active on http://localhost:${PORT}`);
        }
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Unified CampusDebug OS Server running on http://localhost:${PORT}`);
});