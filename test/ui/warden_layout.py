# Warden / guard phone-layout checks (headless Chromium). Driven by test/wardenLayout.ui.test.mjs.
# usage: python3 warden_layout.py '{"base":..,"vp":[w,h,k],"shots":"dir or empty","guard":false}'
import sys, json, time, os
from playwright.sync_api import sync_playwright
cfg = json.loads(sys.argv[1]); w, h, k = cfg['vp']
SCALE_JS = """(k)=>{const els=[...document.querySelectorAll('body *')].filter(e=>!e.dataset.scaled);const v=els.map(e=>{const cs=getComputedStyle(e);return [parseFloat(cs.fontSize), cs.lineHeight.endsWith('px')?parseFloat(cs.lineHeight):null]});els.forEach((e,i)=>{e.dataset.scaled='1';e.style.fontSize=(v[i][0]*k)+'px'; if(v[i][1]) e.style.lineHeight=(v[i][1]*k)+'px';});}"""
def prof(roll, name, role, i):
    return {'rollNumber': roll, 'fullName': name, 'role': role, 'roll_number': roll, 'full_name': name, 'id': '%08x-0000-4000-8000-%012x' % (i, i)}
out = {}; errs = []
def scale(pg):
    if k != 1.0: pg.evaluate(SCALE_JS, k); time.sleep(0.5)
def shot(pg, name):
    if cfg.get('shots'): pg.screenshot(path=os.path.join(cfg['shots'], f"{name}_{w}.png"), full_page=False)
LINES = """(sel)=>{const e=document.querySelector(sel);if(!e)return null;const r=e.getBoundingClientRect();const lh=parseFloat(getComputedStyle(e).lineHeight)||parseFloat(getComputedStyle(e).fontSize)*1.3;return {w:r.width,h:r.height,lines:Math.round(r.height/lh),left:r.left,right:r.right,iw:window.innerWidth}}"""
with sync_playwright() as p:
    b = p.chromium.launch(); mob = w < 800
    def ctx_for(pr):
        ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if mob else 1, is_mobile=mob, has_touch=mob, timezone_id='Asia/Kolkata', locale='en-IN')
        sess = {'session': {'access_token': 'tok-' + pr['roll_number'], 'refresh_token': 'r', 'expires_in': 36000}, 'profile': pr, 'storedAt': int(time.time() * 1000)}
        ctx.add_init_script("localStorage.setItem('campus_auth_session', %s);" % json.dumps(json.dumps(sess)))
        pg = ctx.new_page(); pg.set_default_timeout(10000)
        pg.on('pageerror', lambda e: errs.append(str(e)[:160])); pg.on('console', lambda m: errs.append(m.text[:160]) if m.type == 'error' else None)
        pg.goto(cfg['base'] + '/', wait_until='networkidle'); time.sleep(3)
        return ctx, pg
    # ---- warden
    ctx, pg = ctx_for(prof('WARD01', 'Mr. Subrat Kumar Panda', 'WARDEN', 900))
    scale(pg)
    # Home is the first screen now (covered by wardenHome.ui.test.mjs); these checks open the Pending Passes section first
    pg.locator('[data-testid=home-section-grid] button', has_text='Pending passes').first.click(); time.sleep(1); scale(pg)
    # 1) pass queue header: the title keeps real width (not a 1-3 word sliver) and Create stays a 44px target inside the screen
    out['hdr'] = pg.evaluate("""()=>{const s=document.querySelector('#wd-passes');const t=[...s.querySelectorAll('h2')].find(x=>/Pending Passes/.test(x.innerText));const r=t.getBoundingClientRect();const lh=parseFloat(getComputedStyle(t).lineHeight);const b=[...s.querySelectorAll('button')].find(x=>/Create/.test(x.innerText)).getBoundingClientRect();return {titleW:r.width,titleLines:Math.round(r.height/lh),btnH:b.height,btnL:b.left,btnR:b.right,iw:window.innerWidth}}""")
    # 2) KPI sub-labels never break mid-word ("Sign-" / "off", "Auto-" / "grouped")
    out['kpi'] = pg.evaluate("""()=>[...document.querySelectorAll('section[class*="hidden xl:grid"] span.whitespace-nowrap')].filter(e=>e.offsetParent!==null).map(e=>{const lh=parseFloat(getComputedStyle(e).lineHeight)||parseFloat(getComputedStyle(e).fontSize)*1.3;return {t:e.innerText,lines:Math.round(e.getBoundingClientRect().height/lh)}})""")
    shot(pg, 'w_passes')
    # 3) cluster card: an incident with no mapped rooms shows a dash, not an empty box
    pg.locator('button[aria-pressed]', has_text='Master Incidents').first.click(); time.sleep(1); scale(pg)
    out['rooms_empty'] = pg.evaluate("""()=>{const l=[...document.querySelectorAll('#wd-clusters span')].find(x=>/Impacted Rooms/.test(x.innerText));if(!l)return null;return l.parentElement.innerText.replace(/\\s+/g,' ').trim()}""")
    shot(pg, 'w_clusters')
    # 4) gate register: pass ref stays on one line
    pg.locator('button[aria-pressed]', has_text='Gate Register').first.click(); time.sleep(1); scale(pg)
    out['ref'] = pg.evaluate("""()=>{const e=[...document.querySelectorAll('#wd-register span')].find(x=>/^GP-\\d+$/.test(x.innerText.trim()));if(!e)return null;const lh=parseFloat(getComputedStyle(e).lineHeight)||parseFloat(getComputedStyle(e).fontSize)*1.3;return {lines:Math.round(e.getBoundingClientRect().height/lh),t:e.innerText}}""")
    shot(pg, 'w_register')
    # 5) Create Pass on Behalf modal: close and fields are real 44px targets
    pg.locator('button[aria-pressed]', has_text='Pending Passes').first.click(); time.sleep(.8)
    pg.get_by_role('button', name='Create').first.click(); time.sleep(1.2); scale(pg)
    out['modal'] = pg.evaluate("""()=>{const h=[...document.querySelectorAll('h3')].find(x=>/Create Pass on Behalf/.test(x.innerText));let n=h,close=null;while(n&&!close){n=n.parentElement;close=n&&[...n.querySelectorAll('button')].find(x=>!x.innerText.trim()&&x.querySelector('svg'));}const c=close.getBoundingClientRect();const inp=document.querySelector('input[placeholder^="Name or roll"]').getBoundingClientRect();return {closeW:c.width,closeH:c.height,inputH:inp.height}}""")
    shot(pg, 'w_modal')
    out['w_side_scroll'] = False
    ctx.close()
    ctx, pg = ctx_for(prof('WARD01', 'Mr. Subrat Kumar Panda', 'WARDEN', 900))
    scale(pg)
    out['w_side_scroll'] = pg.evaluate("()=>{const s=document.querySelector('div.overflow-y-auto.h-screen')||document.documentElement;return Math.max(document.documentElement.scrollWidth,s.scrollWidth)>window.innerWidth+1}")
    ctx.close()
    # ---- guard
    ctx, pg = ctx_for(prof('GUARD01', 'Gate Guard Bhaskar', 'GUARD', 901))
    scale(pg)
    out['glog'] = pg.evaluate("""()=>{const e=[...document.querySelectorAll('h3 span')].find(x=>/Gate Log/.test(x.innerText));const r=e.getBoundingClientRect();const lh=parseFloat(getComputedStyle(e).lineHeight)||parseFloat(getComputedStyle(e).fontSize)*1.3;const c=[...document.querySelectorAll('span')].find(x=>/Verified Records/.test(x.innerText)).getBoundingClientRect();return {lines:Math.round(r.height/lh),cRight:c.right,iw:window.innerWidth}}""")
    out['g_side_scroll'] = pg.evaluate("()=>{const s=document.querySelector('div.overflow-y-auto.h-screen')||document.documentElement;return Math.max(document.documentElement.scrollWidth,s.scrollWidth)>window.innerWidth+1}")
    shot(pg, 'g_home')
    ctx.close()
out['errors'] = errs[:6]
print(json.dumps(out))
