require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
    const { data, error } = await sb.from('profiles').select('roll_number,full_name,role').neq('role', 'STUDENT');
    console.log('non-student rows:', error ? 'ERR ' + error.message : JSON.stringify(data, null, 2));
    const { data: sample } = await sb.from('profiles').select('roll_number,role').order('roll_number').limit(3);
    console.log('first rows by roll order:', JSON.stringify(sample));
})();
