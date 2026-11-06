# Admin Timetable tab after the attendance-lock removal. Driven by test/attendanceEdit.admin.ui.test.mjs.
# usage: python3 admin_tt_nolock.py '{"base":..,"vp":[w,h,k],"roll":"ADMIN01","profile":{..},"now":"2026-11-04T13:05:00+05:30","shots":""}'
import sys, json, time, os
from datetime import datetime
from playwright.sync_api import sync_playwright
cfg = json.loads(sys.argv[1]); w, h, k = cfg['vp']
SCALE_JS = """(k)=>{const els=[...document.querySelectorAll('body *')].filter(e=>!e.dataset.scaled);const v=els.map(e=>{const cs=getComputedStyle(e);return [parseFloat(cs.fontSize), cs.lineHeight.endsWith('px')?parseFloat(cs.lineHeight):null]});els.forEach((e,i)=>{e.dataset.scaled='1';e.style.fontSize=(v[i][0]*k)+'px'; if(v[i][1]) e.style.lineHeight=(v[i][1]*k)+'px';});}"""
WANT = datetime.fromisoformat(cfg['now']).timestamp() * 1000
def skew(off): return "(()=>{const off=%d;const _D=Date;class D extends _D{constructor(...a){if(a.length===0)super(_D.now()+off);else super(...a);}static now(){return _D.now()+off;}};D.parse=_D.parse;D.UTC=_D.UTC;window.Date=D;})();" % off
out = {}; errs = []
def scale(pg):
    if k != 1.0: pg.evaluate(SCALE_JS, k); time.sleep(0.5)
def shot(pg, name):
    if cfg.get('shots'): pg.screenshot(path=os.path.join(cfg['shots'], f"{name}_{w}.png"), full_page=True)
def small_targets(pg):
    # visible buttons / selects / text boxes inside the admin console (.admin-dash) that are under 44px tall
    return pg.evaluate("""()=>[...document.querySelectorAll('.admin-dash button, .admin-dash select, .admin-dash textarea, .admin-dash input:not([type=checkbox]):not([type=radio]):not([type=file])')].filter(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&r.height<43.5}).map(e=>[e.tagName,(e.innerText||e.placeholder||e.title||'').trim().slice(0,30),Math.round(e.getBoundingClientRect().height)])""")
def side_scroll(pg): return pg.evaluate("()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)>window.innerWidth+1")
with sync_playwright() as p:
    b = p.chromium.launch(); mob = w < 800
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if mob else 1, is_mobile=mob, has_touch=mob, timezone_id='Asia/Kolkata', locale='en-IN')
    ctx.add_init_script(skew(int(WANT - time.time() * 1000)))
    sess = {'session': {'access_token': 'tok-' + cfg['roll'], 'refresh_token': 'r', 'expires_in': 36000}, 'profile': cfg['profile'], 'storedAt': int(WANT)}
    ctx.add_init_script("localStorage.setItem('campus_auth_session', %s);" % json.dumps(json.dumps(sess)))
    pg = ctx.new_page(); pg.set_default_timeout(10000); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text[:160]) if m.type == 'error' else None)
    pg.goto(cfg['base'] + '/', wait_until='networkidle'); time.sleep(3)
    if mob:
        pg.locator('[data-admin-group="Academics"]').locator('visible=true').first.click(); time.sleep(.5)
    else:
        pg.locator('[data-admin-tab="timetable"]').locator('visible=true').first.click()
    time.sleep(2.2); scale(pg)
    txt = pg.locator('.admin-dash').first.inner_text(); low = txt.lower()
    out['has_tt'] = 'academic timetable engine' in low
    out['has_locks'] = ('attendance locks' in low) or ('unlock' in low)
    out['has_atrisk'] = 'at-risk students' in low
    out['side'] = side_scroll(pg) if 'side_scroll' in globals() else pg.evaluate("()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)>window.innerWidth+1")
    out['small'] = small_targets(pg)[:6]
    out['errors'] = errs[:6]
    if cfg.get('shots'):
        pg.evaluate("()=>{const e=[...document.querySelectorAll('.admin-dash p')].find(p=>/At-Risk/.test(p.innerText)); if(e) e.scrollIntoView({block:'center'});}"); time.sleep(.5)
        shot(pg, 'admin_timetable_after')
    print(json.dumps(out)); ctx.close()
