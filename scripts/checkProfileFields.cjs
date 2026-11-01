require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
    const { data } = await sb.from('profiles').select('roll_number,full_name,attendance_percentage,fee_due_balance').ilike('roll_number', '2201106190').maybeSingle();
    console.log(JSON.stringify(data, null, 2));
})();
