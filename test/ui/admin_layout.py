# Admin / Dean console phone-layout checks (headless Chromium). Driven by test/adminLayout.ui.test.mjs.
# usage: python3 admin_layout.py '{"base":..,"vp":[w,h,k],"roll":"ADMIN01","profile":{..},"now":"2026-11-04T13:05:00+05:30","shots":""}'
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
    pg.locator('#admin-cover-alerts').wait_for(); scale(pg); time.sleep(.3)
    # 1) cover banner (phone): icon and text sit in one row; the action button is a full-width 44px target
    out['banner'] = pg.evaluate("""()=>{const b=document.querySelector('#admin-cover-alerts > div');const ic=b.querySelector('span');const tx=b.querySelector('p');const bt=b.querySelector('button');const r=(e)=>e.getBoundingClientRect();return {iconTop:r(ic).top,textTop:r(tx).top,iconRight:r(ic).right,textLeft:r(tx).left,btnH:bt?r(bt).height:null,btnL:bt?r(bt).left:null,btnR:bt?r(bt).right:null,iw:innerWidth}}""")
    out['side_home'] = side_scroll(pg); out['small_home'] = small_targets(pg); shot(pg, 'home')
    # 2) bottom bar (phone): every group label fully visible and not overlapping its neighbour
    if mob:
        out['bar'] = pg.evaluate("""()=>[...document.querySelectorAll('[data-admin-group]')].map(b=>{const s=b.querySelector('span:last-child');const br=b.getBoundingClientRect();const sr=s.getBoundingClientRect();return {t:s.innerText,l:br.left,r:br.right,sl:sr.left,sr:sr.right,clip:s.scrollWidth>s.clientWidth+1,w:br.width}})""")
    # 3) notice form tab (home): selects not squeezed, tap targets
    out['small_notice'] = small_targets(pg)
    sel = pg.evaluate("()=>[...document.querySelectorAll('.admin-dash form select')].map(e=>{const r=e.getBoundingClientRect();return [Math.round(r.width),Math.round(r.right),innerWidth]})")
    out['selects'] = sel
    # 4) Fee Payments: totals on one line each, refresh a 44px target beside search, nothing past the edge
    def tab(group, tid):
        if mob:
            pg.locator(f'[data-admin-group="{group}"]').locator('visible=true').first.click(); time.sleep(.5)
            if tid not in ('dispatcher','timetable','setup','docs','csv'):
                pg.locator(f'[data-admin-tab="{tid}"]').locator('visible=true').last.click()
        else:
            pg.locator(f'[data-admin-tab="{tid}"]').locator('visible=true').first.click()
        time.sleep(1.8); scale(pg)
    tab('Support', 'fees'); time.sleep(.5)
    out['fees'] = pg.evaluate("""()=>{const root=document.querySelector('[data-testid=fee-payments]');const ps=[...root.querySelectorAll('.font-mono.font-extrabold')].slice(0,2);const kp=ps.map(p=>{const lh=parseFloat(getComputedStyle(p).lineHeight)||parseFloat(getComputedStyle(p).fontSize)*1.25;return Math.round(p.getBoundingClientRect().height/lh)});const rf=root.querySelector('button[aria-label="Refresh fee payments"]').getBoundingClientRect();const sr=root.querySelector('label').getBoundingClientRect();return {kpiLines:kp,refreshW:rf.width,refreshH:rf.height,refreshRight:rf.right,searchRight:sr.right,refreshLeft:rf.left,searchTop:sr.top,refreshTop:rf.top,iw:innerWidth,amounts:ps.map(p=>p.innerText)}}""")
    out['fee_search'] = pg.evaluate("""()=>{const e=document.querySelector('[data-testid=fee-payments] input');const cs=getComputedStyle(e);const c=document.createElement('canvas').getContext('2d');c.font=cs.fontWeight+' '+cs.fontSize+' '+cs.fontFamily;return [c.measureText(e.placeholder).width, e.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)]}""")
    out['small_fees'] = small_targets(pg); out['side_fees'] = side_scroll(pg); shot(pg, 'fees')
    # 5) Timetable engine: section names are not cut off, and the section list scrolls inside a bounded box
    tab('Academics', 'timetable'); time.sleep(1)
    out['tt'] = pg.evaluate("""()=>{const l=document.querySelector('[data-testid=tt-section-list]');if(!l)return null;const cs=getComputedStyle(l);const names=[...l.querySelectorAll('p.font-bold')].map(p=>[p.innerText,p.scrollWidth<=p.clientWidth+1]);return {overflowY:cs.overflowY,maxH:parseFloat(cs.maxHeight),names}}""")
    out['small_tt'] = small_targets(pg); out['side_tt'] = side_scroll(pg); shot(pg, 'timetable')
    # 6) Section title above each tool wraps instead of ending in "..."
    tab('Campus & Hostel', 'mess'); time.sleep(1)
    out['title'] = pg.evaluate("""()=>{const h=[...document.querySelectorAll('h3')].find(x=>/Mess Kitchen Forecast/.test(x.innerText));const cs=getComputedStyle(h);return {clip:h.scrollWidth>h.clientWidth+1,ellipsis:cs.textOverflow}}""")
    out['small_mess'] = small_targets(pg); out['side_mess'] = side_scroll(pg)
    tab('Support', 'docs'); out['small_docs'] = small_targets(pg); out['side_docs'] = side_scroll(pg)
    tab('Campus & Hostel', 'setup'); out['small_setup'] = small_targets(pg); out['side_setup'] = side_scroll(pg); shot(pg, 'setup')
    out['errors'] = [e for e in errs if 'favicon' not in e][:6]
    ctx.close()
print(json.dumps(out))
