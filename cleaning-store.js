// Storage for the room cleaning checks: Supabase tables (cleaning_checks,
// cleaning_schedules, technicians.block) when migration.sql has been run; a
// local JSON file on this server when they are missing (setupPending is then
// true and the warden screen says so). Same methods either way.
import fs from 'fs';
import crypto from 'crypto';

const MISSING = /does not exist|could not find the table|42P01|42703|PGRST205|PGRST204|schema cache|column .* does not exist/i;

export function createCleaningStore({ supabase, file }) {
  const state = { setupPending: !supabase, lastError: null };
  let mem = { checks: [], schedules: {}, pushLog: {} };
  // The "push sent" log has its own table (cleaning_push_log). If only THAT table is missing we use the
  // local file for it alone — the checks keep going to the database (state.setupPending is NOT touched).
  const pushState = { local: !supabase, lastError: null };
  try {
    if (file && fs.existsSync(file)) mem = { ...mem, ...JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) };
  } catch { /* start empty */ }
  const save = () => { if (!file) return; try { fs.writeFileSync(file, JSON.stringify(mem), 'utf8'); } catch (e) { console.warn('cleaning store write skipped:', e.message); } };

  // Run the Supabase call; if the table/column is not there, go local for good.
  async function viaDb(dbFn, localFn) {
    if (!supabase || state.setupPending) return localFn();
    try {
      const { data, error } = await dbFn();
      if (error) {
        if (MISSING.test(`${error.message || ''} ${error.code || ''}`)) { state.setupPending = true; state.lastError = error.message; return localFn(); }
        throw new Error(error.message || 'cleaning store query failed');
      }
      return data;
    } catch (e) {
      if (MISSING.test(e.message || '')) { state.setupPending = true; state.lastError = e.message; return localFn(); }
      throw e;
    }
  }

  const key = (r) => `${r.block}|${r.room}|${r.check_date}`;
  const local = {
    list: ({ block, date } = {}) => mem.checks.filter((c) => (!block || c.block === block) && (!date || c.check_date === date)),
    upsert: (row) => {
      const i = mem.checks.findIndex((c) => key(c) === key(row));
      const saved = { id: i >= 0 ? mem.checks[i].id : crypto.randomUUID(), ...(i >= 0 ? mem.checks[i] : {}), ...row };
      if (i >= 0) mem.checks[i] = saved; else mem.checks.push(saved);
      save();
      return saved;
    }
  };

  // push log: mem.pushLog = { 'YYYY-MM-DD': [roll, ...] }; days older than 14 are dropped on write.
  const pushLocal = {
    list: (date) => new Set((mem.pushLog[date] || []).map(String)),
    add: (date, rolls) => {
      const set = pushLocal.list(date);
      rolls.forEach((r) => set.add(String(r)));
      mem.pushLog[date] = [...set];
      const keep = Object.keys(mem.pushLog).sort().slice(-14);
      for (const d of Object.keys(mem.pushLog)) if (!keep.includes(d)) delete mem.pushLog[d];
      save();
    }
  };
  async function pushVia(dbFn, localFn) {
    if (pushState.local) return localFn();
    try {
      const { data, error } = await dbFn();
      if (error) {
        if (MISSING.test(`${error.message || ''} ${error.code || ''}`)) { pushState.local = true; pushState.lastError = error.message; return localFn(); }
        throw new Error(error.message || 'cleaning push log query failed');
      }
      return data;
    } catch (e) {
      if (MISSING.test(e.message || '')) { pushState.local = true; pushState.lastError = e.message; return localFn(); }
      throw e;
    }
  }

  return {
    state,
    pushState,
    // Students (roll numbers) of this block who already got the "room check" push on this cleaning day.
    async listPushed({ block, date }) {
      const rows = await pushVia(
        () => supabase.from('cleaning_push_log').select('roll_number').eq('check_date', date).eq('block', block).limit(10000),
        () => null
      );
      if (rows === null) return pushLocal.list(date);
      return new Set((rows || []).map((r) => String(r.roll_number)));
    },
    // Record the push BEFORE it is sent, so a crash or a second tick can never send it twice.
    async markPushed({ block, date, rolls }) {
      if (!rolls.length) return;
      const rows = rolls.map((roll) => ({ check_date: date, roll_number: String(roll), block }));
      await pushVia(
        () => supabase.from('cleaning_push_log').upsert(rows, { onConflict: 'check_date,roll_number', ignoreDuplicates: true }),
        () => { pushLocal.add(date, rolls); return null; }
      );
    },
    async listChecks({ block, date } = {}) {
      const data = await viaDb(async () => {
        let q = supabase.from('cleaning_checks').select('*');
        if (block) q = q.eq('block', block);
        if (date) q = q.eq('check_date', date);
        return q.limit(5000);
      }, () => local.list({ block, date }));
      return data || [];
    },
    async getCheck(block, room, date) {
      const rows = await this.listChecks({ block, date });
      return rows.find((c) => String(c.room) === String(room)) || null;
    },
    async upsertCheck(row) {
      const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
      const data = await viaDb(
        () => supabase.from('cleaning_checks').upsert(clean, { onConflict: 'block,room,check_date' }).select().single(),
        () => local.upsert(clean)
      );
      return data;
    },
    async listSettings() {
      const data = await viaDb(
        () => supabase.from('cleaning_schedules').select('*'),
        () => Object.entries(mem.schedules).map(([block, s]) => ({ block, ...s }))
      );
      return data || [];
    },
    async saveSettings(block, patch) {
      const row = { block, ...patch };
      const data = await viaDb(
        () => supabase.from('cleaning_schedules').upsert(row, { onConflict: 'block' }).select().single(),
        () => { mem.schedules[block] = { ...(mem.schedules[block] || {}), ...patch }; save(); return { block, ...mem.schedules[block] }; }
      );
      return data;
    },
    // Cleaners = active Cleanliness technicians. technicians.block (migration) says which block;
    // before the migration there is no block column, so the one Cleanliness technician covers every block.
    async listCleaners() {
      if (!supabase) return [];
      const read = async (cols) => supabase.from('technicians').select(cols).eq('category', 'Cleanliness').eq('active', true).order('id');
      try {
        let { data, error } = await read('id, full_name, phone_number, active, block, category');
        if (error && MISSING.test(`${error.message} ${error.code || ''}`)) ({ data, error } = await read('id, full_name, phone_number, active, category'));
        if (error) return [];
        const list = (data || []).map((t) => ({ id: String(t.id), name: t.full_name, phone: t.phone_number || '', block: t.block || null }));
        // once any cleaner has a block, block-less rows (old supervisor) are not cleaners
        return list.some((c) => c.block) ? list.filter((c) => c.block) : list;
      } catch { return []; }
    }
  };
}
