require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
    const { data, error } = await sb.from('meal_rsvps').select('*').limit(3);
    console.log(error ? 'QUERY ERR: ' + error.message : JSON.stringify(data, null, 2));
})();
