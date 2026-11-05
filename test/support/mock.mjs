
import http from 'node:http';
import fs from 'node:fs';
const profiles = JSON.parse(fs.readFileSync(process.env.PROFILES_FILE || new URL('./profiles.json', import.meta.url)));
const SEED = process.env.SEED_FILE ? JSON.parse(fs.readFileSync(process.env.SEED_FILE,'utf8')) : {};
const tables = { profiles, gate_passes: [], leave_requests: SEED.leave_requests||[], pass_scans: [], meal_rsvps: [], tickets: [], master_incidents: [], document_requests: [] };
let seq = 1;
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
    if(req.method==='GET'||req.method==='HEAD'){ const all=tbl.filter(r=>match(r,params)); const rows=shape(all,params);
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
