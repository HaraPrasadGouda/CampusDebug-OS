require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
    const { data } = await sb.from('profiles').select('roll_number,full_name,attendance_percentage,fee_due_balance').ilike('roll_number', '2201106001').maybeSingle();
    console.log('Vivaan row:', JSON.stringify(data));
    // how uniform is the data across students?
    const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('attendance_percentage', 86.4);
    console.log('profiles with exactly 86.4% attendance:', count);
    const { count: feeCount } = await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('fee_due_balance', 3200);
    console.log('profiles with exactly 3200 fee due:', feeCount);
})();
