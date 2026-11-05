
import http from 'node:http';
import fs from 'node:fs';
const profiles = JSON.parse(fs.readFileSync(process.env.PROFILES_FILE || new URL('./profiles.json', import.meta.url)));
const SEED = process.env.SEED_FILE ? JSON.parse(fs.readFileSync(process.env.SEED_FILE,'utf8')) : {};
const tables = { profiles, gate_passes: [], leave_requests: SEED.leave_requests||[], pass_scans: [], meal_rsvps: [], tickets: [], master_incidents: [], document_requests: [] };
let seq = 1;
const authUsers = [];
function splitTop(s){ const out=[]; let d=0, cur=''; for (const ch of s){ if(ch==='(')d++; if(ch===')')d--; if(ch===','&&d===0){out.push(cur);cur='';} else cur+=ch;} if(cur)out.push(cur); return out; }
function cond(row, col, op, val){
  const cell=row[col];
  const num = (x)=> { const t=Date.parse(x); return isNaN(t)? Number(x): t; };
  switch(op){
    case 'eq': return String(cell)===val;
    case 'neq': return String(cell)!==val;
    case 'ilike': return String(cell??'').toLowerCase()===val.toLowerCase().replace(/%/g,'');
    case 'is': return val==='null' ? (cell===null||cell===undefined) : String(cell)===val;
    case 'gte': return cell!=null && num(cell)>=num(val);
    case 'gt': return cell!=null && num(cell)>num(val);
    case 'lte': return cell!=null && num(cell)<=num(val);
    case 'lt': return cell!=null && num(cell)<num(val);
    case 'in': return val.replace(/^\(|\)$/g,'').split(',').map(x=>x.replace(/"/g,'')).includes(String(cell));
    default: return true;
  }
}
function evalExpr(row, expr){ // "status.eq.PENDING" or "and(a,b)" or "or(a,b)"
  const m=/^(and|or)\((.*)\)$/.exec(expr);
  if(m){ const parts=splitTop(m[2]); return m[1]==='and'? parts.every(p=>evalExpr(row,p)) : parts.some(p=>evalExpr(row,p)); }
  const i=expr.indexOf('.'); const col=expr.slice(0,i); const rest=expr.slice(i+1); const j=rest.indexOf('.');
  return cond(row,col,rest.slice(0,j),rest.slice(j+1));
}
function match(row, params){
  for (const [k,v] of params){
    if (['select','order','limit','offset','on_conflict','columns'].includes(k)) continue;
    if (k==='or'){ if(!evalExpr(row,`or${v}`)) return false; continue; }
    if (k==='and'){ if(!evalExpr(row,`and${v}`)) return false; continue; }
    const m=/^(eq|ilike|neq|in|is|gte|gt|lte|lt)\.(.*)$/.exec(v); if(!m) continue;
    if(!cond(row,k,m[1],m[2])) return false;
  }
  return true;
}
function shape(rows, params){
  const o=params.find(([k])=>k==='order');
  if(o){ const [col,dir]=o[1].split('.'); rows=[...rows].sort((a,b)=>{const x=String(a[col]??''),y=String(b[col]??''); return dir==='desc'? y.localeCompare(x): x.localeCompare(y);}); }
  const l=params.find(([k])=>k==='limit'); if(l) rows=rows.slice(0,Number(l[1]));
  return rows;
}
http.createServer((req,res)=>{
  let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
    const u=new URL(req.url,'http://x');
    const send=(code,obj,extra={})=>{res.writeHead(code,{'content-type':'application/json',...extra}); res.end(obj===undefined?'':JSON.stringify(obj));};
    if(u.pathname==='/auth/v1/user'){
      const t=(req.headers.authorization||'').replace('Bearer ','');
      const p=profiles.find(x=>'tok-'+x.roll_number===t);
      if(!p) return send(401,{code:401,msg:'invalid JWT'});
      return send(200,{id:p.id,email:p.roll_number.toLowerCase()+'@campusdebug.os',aud:'authenticated',role:'authenticated'});
    }
    // --- Supabase Auth (admin users + password sign-in), just enough for the login flow ---
    if(u.pathname==='/__auth_users' && req.method==='POST'){ const list=JSON.parse(body||'[]'); list.forEach(x=>authUsers.push(x)); return send(200,{count:authUsers.length}); }
    if(u.pathname==='/auth/v1/admin/users' && req.method==='GET'){
      const page=Math.max(1,Number(u.searchParams.get('page')||1)), per=Math.max(1,Number(u.searchParams.get('per_page')||50));
      return send(200,{users:authUsers.slice((page-1)*per,page*per).map(x=>({id:x.id||('au-'+x.email),email:x.email,aud:'authenticated'})),aud:'authenticated'},{'x-total-count':String(authUsers.length)});
    }
    if(u.pathname==='/auth/v1/admin/users' && req.method==='POST'){
      const b=JSON.parse(body||'{}'); if(authUsers.some(x=>x.email===b.email)) return send(422,{code:422,error_code:'email_exists',msg:'A user with this email address has already been registered'});
      const nu={id:'au-'+b.email,email:b.email,password:b.password}; authUsers.push(nu); return send(200,{id:nu.id,email:nu.email,aud:'authenticated'});
    }
    if(u.pathname==='/auth/v1/token' && req.method==='POST'){
      const b=JSON.parse(body||'{}'); const au=authUsers.find(x=>x.email===b.email && x.password!==undefined && x.password===b.password);
      if(!au) return send(400,{code:400,error_code:'invalid_credentials',msg:'Invalid login credentials'});
      const roll=au.email.split('@')[0].toUpperCase();
      return send(200,{access_token:'tok-'+(profiles.find(p=>p.roll_number.toLowerCase()===roll.toLowerCase())||{roll_number:roll}).roll_number,refresh_token:'rt-'+roll,expires_in:3600,token_type:'bearer',user:{id:au.id,email:au.email,aud:'authenticated'}});
    }
    if(u.pathname==='/__dump') return send(200,tables[u.searchParams.get('t')]||[]);
    const m=/^\/rest\/v1\/([a-z_]+)/.exec(u.pathname);
    if(!m) return send(404,{msg:'mock: unknown '+u.pathname});
    const tbl=tables[m[1]]||(tables[m[1]]=[]);
    const params=[...u.searchParams.entries()];
    const single=(req.headers.accept||'').includes('vnd.pgrst.object');
    const out=(rows,code=200)=>{
      if(single){ if(rows.length!==1) return send(406,{code:'PGRST116',message:'JSON object requested, multiple (or no) rows returned',details:'',hint:null}); return send(code,rows[0]); }
      return send(code,rows,{'content-range':`0-${Math.max(rows.length-1,0)}/${rows.length}`});
    };
    if(req.method==='GET'||req.method==='HEAD'){
      // PostgREST resource embedding, as far as the app uses it: `alias:profiles!fk_col(cols)` attaches the profile
      // the FK column points at. `gate_passes` has TWO FKs to profiles (student_id, approved_by), so a bare
      // `profiles(...)` embed is ambiguous and the real PostgREST answers 300 PGRST201 (the P1-4 bug).
      const sel=(params.find(([k])=>k==='select')||[,''])[1];
      const embeds=[...sel.matchAll(/(?:(\w+):)?(\w+)(?:!(\w+))?\(([^()]*)\)/g)].map(x=>({alias:x[1]||x[2],target:x[2],hint:x[3],cols:x[4].split(',').map(c=>c.trim())}));
      for(const e of embeds){
        if(m[1]==='gate_passes' && e.target==='profiles' && !e.hint)
          return send(300,{code:'PGRST201',details:[{cardinality:'many-to-one',relationship:'gate_passes_student_id_fkey'},{cardinality:'many-to-one',relationship:'gate_passes_approved_by_fkey'}],hint:"Try changing 'profiles' to one of the following: 'profiles!gate_passes_student_id_fkey', 'profiles!gate_passes_approved_by_fkey'.",message:"Could not embed because more than one relationship was found for 'gate_passes' and 'profiles'"});
      }
      const embed=(row)=>{ if(!embeds.length) return row; const o={...row}; for(const e of embeds){ const fk=(e.hint||'').replace(/^gate_passes_|_fkey$/g,'')||'student_id'; const p=profiles.find(x=>String(x.id)===String(row[fk])); o[e.alias]=p? Object.fromEntries(e.cols.filter(c=>c in p).map(c=>[c,p[c]])) : null; } return o; };
      const all=tbl.filter(r=>match(r,params)); const rows=shape(all,params).map(embed);
      if(single) return out(rows);
      return send(200,rows,{'content-range':`0-${Math.max(rows.length-1,0)}/${all.length}`}); }
    let parsed=[]; try{parsed=JSON.parse(body||'[]');}catch{}
    const arr=Array.isArray(parsed)?parsed:[parsed];
    if(req.method==='POST'){ const made=arr.map(r=>({id:(m[1]==='leave_requests'?`00000000-0000-4000-9000-${String(seq++).padStart(12,'0')}`:'row-'+(seq++)),...r})); made.forEach(r=>tbl.push(r)); return out(made,201); }
    if(req.method==='PATCH'){ const rows=tbl.filter(r=>match(r,params)); rows.forEach(r=>Object.assign(r,arr[0])); return out(rows); }
    if(req.method==='DELETE') return send(200,[]);
    send(200,[]);
  });
}).listen(Number(process.env.MOCK_PORT||54329),()=>console.log("mock on "+(process.env.MOCK_PORT||54329)));
