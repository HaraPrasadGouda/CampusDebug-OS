// Storage for demo fee payments (receipts): Supabase table public.fee_payments when
// migration_fee_payments.sql has been run; a local JSON file on this server when the table
// is missing. Same methods either way, so the app works before and after the migration.
// A receipt is NEVER lost: if the database insert fails for any reason it is kept in the
// local file, and listings merge both places (deduplicated by receipt_id).
import fs from 'fs';
import crypto from 'crypto';

const MISSING = /does not exist|could not find the table|42P01|PGRST205|PGRST204|schema cache|column .* does not exist/i;
const DUP = /23505|duplicate key|unique constraint/i;
// no 0/O/1/I/L so a receipt id read aloud or typed from a screenshot is unambiguous
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function receiptDay(date = new Date()) {
  // YYMMDD in India time (the college's calendar day), independent of the server's TZ
  const ist = new Date(date.getTime() + 330 * 60000);
  return `${String(ist.getUTCFullYear()).slice(2)}${String(ist.getUTCMonth() + 1).padStart(2, '0')}${String(ist.getUTCDate()).padStart(2, '0')}`;
}
export function newReceiptId(date = new Date()) {
  let s = '';
  const b = crypto.randomBytes(4);
  for (let i = 0; i < 4; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return `RCP-${receiptDay(date)}-${s}`;
}
const money = (n) => Math.round(Number(n) * 100) / 100;
const shape = (r) => ({
  receipt_id: r.receipt_id, roll_number: r.roll_number, payer_name: r.payer_name || null,
  amount: money(r.amount), method: r.method || 'DEMO', status: r.status || 'PAID', paid_at: r.paid_at
});
const newest = (a, b) => (a.paid_at < b.paid_at ? 1 : a.paid_at > b.paid_at ? -1 : (a.receipt_id < b.receipt_id ? 1 : -1));

export function createFeeStore({ supabase, file }) {
  const state = { tableMissing: !supabase, lastError: null };
  let mem = { payments: [] };
  try {
    if (file && fs.existsSync(file)) mem = { ...mem, ...JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) };
  } catch { /* start empty */ }
  const save = () => { if (!file) return; try { fs.writeFileSync(file, JSON.stringify(mem), 'utf8'); } catch (e) { console.warn('fee store write skipped:', e.message); } };

  const dbGuard = (error) => {
    const msg = `${error?.message || ''} ${error?.code || ''}`;
    if (MISSING.test(msg)) { state.tableMissing = true; state.lastError = error.message; return 'missing'; }
    if (DUP.test(msg)) return 'dup';
    return 'other';
  };

  const localAdd = (row) => { mem.payments.push(row); save(); };
  const localList = () => mem.payments.map(shape);

  async function dbList(apply) {
    if (!supabase || state.tableMissing) return [];
    try {
      const { data, error } = await apply(supabase.from('fee_payments').select('receipt_id,roll_number,payer_name,amount,method,status,paid_at'));
      if (error) { if (dbGuard(error) === 'missing') return []; console.warn('fee store read failed (using local copy only):', error.message); return []; }
      return (data || []).map(shape);
    } catch (e) {
      if (MISSING.test(e.message || '')) { state.tableMissing = true; state.lastError = e.message; return []; }
      console.warn('fee store read failed (using local copy only):', e.message);
      return [];
    }
  }
  const merge = (...lists) => {
    const seen = new Map();
    for (const l of lists) for (const r of l) if (!seen.has(r.receipt_id)) seen.set(r.receipt_id, r);
    return [...seen.values()].sort(newest);
  };

  return {
    state,
    // Is this receipt id already used anywhere? (the unique constraint is the real guard in the database)
    async exists(receiptId) {
      if (mem.payments.some((p) => p.receipt_id === receiptId)) return true;
      const rows = await dbList((q) => q.eq('receipt_id', receiptId).limit(1));
      return rows.length > 0;
    },
    // Save one receipt. Returns the saved row. Never throws for storage trouble: falls back to the local file.
    // Returns null (nothing saved) ONLY when the database says the receipt id is taken, so the caller can pick another id.
    async add({ receipt_id, roll_number, student_id = null, payer_name, amount, method = 'DEMO', paid_at }) {
      const row = { receipt_id, roll_number: String(roll_number), student_id, payer_name: payer_name || null, amount: money(amount), method, status: 'PAID', paid_at: paid_at || new Date().toISOString() };
      if (supabase && !state.tableMissing) {
        try {
          const { error } = await supabase.from('fee_payments').insert(row);
          if (!error) return shape(row);
          const kind = dbGuard(error);
          if (kind === 'dup') return null;
          if (kind === 'other') console.warn('fee store insert failed, kept in local file:', error.message);
        } catch (e) {
          if (MISSING.test(e.message || '')) { state.tableMissing = true; state.lastError = e.message; }
          else console.warn('fee store insert failed, kept in local file:', e.message);
        }
      }
      if (mem.payments.some((p) => p.receipt_id === receipt_id)) return null;
      localAdd(row);
      return shape(row);
    },
    async listByRoll(roll, limit = 50) {
      const r = String(roll);
      const db = await dbList((q) => q.eq('roll_number', r).order('paid_at', { ascending: false }).limit(limit));
      return merge(db, localList().filter((p) => p.roll_number === r)).slice(0, limit);
    },
    async latestByRoll(roll) { return (await this.listByRoll(roll, 1))[0] || null; },
    // Staff view: newest first, plus the totals over everything read (up to 5000 rows).
    async listAll({ limit = 200 } = {}) {
      const db = await dbList((q) => q.order('paid_at', { ascending: false }).limit(5000));
      const all = merge(db, localList());
      return { payments: all.slice(0, limit), totalCount: all.length, totalAmount: money(all.reduce((s, p) => s + p.amount, 0)) };
    }
  };
}
