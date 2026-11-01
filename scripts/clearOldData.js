// CampusDebug OS — Clear Old Cloud Data
// Wipes previous testing rows from the Supabase cloud tables so the app only
// shows items created from this point forward. Runs with a confirmation prompt.
//
// Usage:  node scripts/clearOldData.js
//         node scripts/clearOldData.js --force   (skip the confirmation prompt)

import { createClient } from '@supabase/supabase-js';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env manually (same pattern as server.js)
let SUPABASE_URL = process.env.SUPABASE_URL;
let SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL) {
  try {
    const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
      if (m) {
        if (m[1] === 'SUPABASE_URL') SUPABASE_URL = m[2];
        if (m[1] === 'SUPABASE_SERVICE_ROLE_KEY' || m[1] === 'SUPABASE_PUBLISHABLE_KEY') SUPABASE_KEY = m[2];
      }
    }
  } catch { /* no .env file */ }
}

const TABLES = ['tickets', 'gate_passes', 'master_incidents'];  // cloud data tables

const force = process.argv.includes('--force');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

const main = async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ SUPABASE_URL / service key not found (check .env). Aborting.');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  // Show what will be deleted
  for (const table of TABLES) {
    const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true });
    console.log(`   ${table}: ${error ? `⚠️ could not count (${error.message})` : `${count || 0} rows`}`);
  }

  if (!force) {
    const ans = await ask('\n⚠️  This DELETES all rows in the tables above from the cloud database.\nType YES to continue: ');
    if (ans.trim() !== 'YES') {
      console.log('Cancelled — nothing was deleted.');
      rl.close();
      process.exit(0);
    }
  }

  for (const table of TABLES) {
    const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) {
      console.error(`❌ Failed to clear ${table}: ${error.message}`);
    } else {
      console.log(`✅ Cleared ${table}`);
    }
  }

  console.log('\nDone. The app now shows only data you create from this point forward.');
  rl.close();
};

main();
