# Teacher dashboard phone-layout checks (headless Chromium). Driven by test/teacherLayout.ui.test.mjs.
# usage: python3 teacher_layout.py '{"base":..,"vp":[w,h,k],"shots":"dir or empty"}'
import sys, json, time, os
from playwright.sync_api import sync_playwright
cfg = json.loads(sys.argv[1]); w, h, k = cfg['vp']
SCALE_JS = """(k)=>{const els=[...document.querySelectorAll('body *')].filter(e=>!e.dataset.scaled);const v=els.map(e=>{const cs=getComputedStyle(e);return [parseFloat(cs.fontSize), cs.lineHeight.endsWith('px')?parseFloat(cs.lineHeight):null]});els.forEach((e,i)=>{e.dataset.scaled='1';e.style.fontSize=(v[i][0]*k)+'px'; if(v[i][1]) e.style.lineHeight=(v[i][1]*k)+'px';});}"""
prof = {'rollNumber': 'FAC003', 'fullName': 'Dr. Priya Mishra', 'role': 'TEACHER', 'department': 'Computer Science & Engineering', 'roll_number': 'FAC003', 'full_name': 'Dr. Priya Mishra', 'id': '00000003-0000-4000-8000-000000000003'}
FIT = """(sel)=>{const e=document.querySelector(sel);if(!e)return null;const cs=getComputedStyle(e);const c=document.createElement('canvas').getContext('2d');c.font=cs.fontWeight+' '+cs.fontSize+' '+cs.fontFamily;const inner=e.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);return [c.measureText(e.placeholder).width, inner, e.scrollHeight, e.clientHeight]}"""
def scale(pg):
    if k != 1.0: pg.evaluate(SCALE_JS, k); time.sleep(0.5)
def go(pg, name):
    # the teacher home is split into tabs: phone = bottom bar, laptop = sidebar SECTIONS
    pg.locator(f'[data-testid=teacher-bottom-bar] [data-tab={name}]' if w < 1024 else f'[data-testid=sidebar-sections] [data-section={name}]').click(); time.sleep(.8)
def shot(pg, name):
    if cfg.get('shots'): pg.screenshot(path=os.path.join(cfg['shots'], f"{name}_{w}.png"))
from datetime import datetime
WANT = datetime.fromisoformat(cfg.get('now', '2026-11-04T10:30:00+05:30')).timestamp() * 1000
def skew(off): return "(()=>{const off=%d;const _D=Date;class D extends _D{constructor(...a){if(a.length===0)super(_D.now()+off);else super(...a);}static now(){return _D.now()+off;}};D.parse=_D.parse;D.UTC=_D.UTC;window.Date=D;})();" % off
out = {}; errs = []
with sync_playwright() as p:
    b = p.chromium.launch(); mob = w < 800
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if mob else 1, is_mobile=mob, has_touch=mob, timezone_id='Asia/Kolkata', locale='en-IN')
    ctx.add_init_script(skew(int(WANT - time.time() * 1000)))
    sess = {'session': {'access_token': 'tok-FAC003', 'refresh_token': 'r', 'expires_in': 36000}, 'profile': prof, 'storedAt': int(WANT)}
    ctx.add_init_script("localStorage.setItem('campus_auth_session', %s);" % json.dumps(json.dumps(sess)))
    pg = ctx.new_page(); pg.set_default_timeout(10000); pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text[:160]) if m.type == 'error' else None)
    pg.goto(cfg['base'] + '/', wait_until='networkidle'); time.sleep(3)
    # 1) Gate Log header: the title keeps real width next to the refresh button
    go(pg, 'students'); pg.locator('#td-gatelog').scroll_into_view_if_needed(); scale(pg); time.sleep(.3)
    out['gate'] = pg.evaluate("()=>{const h=document.querySelector('#td-gatelog h3');const r=h.getBoundingClientRect();const lh=parseFloat(getComputedStyle(h).lineHeight);const b=document.querySelector('#td-gatelog button[title=\"Refresh gate log\"]').getBoundingClientRect();return {w:r.width,lines:Math.round(r.height/lh),btnW:b.width,btnH:b.height,btnRight:b.right,iw:window.innerWidth}}")
    shot(pg, 'gatelog')
    # 2) Mark Attendance modal
    pg.reload(wait_until='networkidle'); time.sleep(3)
    pg.locator('#td-timetable button:has-text("Mark attendance")').first.click(); time.sleep(2); scale(pg); time.sleep(.4)   # Today tab = My day
    out['att'] = pg.evaluate("""()=>{const bs=[...document.querySelectorAll('button')];const s=bs.find(x=>/^\\s*Save/.test(x.innerText));const c=bs.find(x=>x.innerText.trim()==='Cancel');const r=s.getBoundingClientRect(), rc=c.getBoundingClientRect();
      const hint=[...document.querySelectorAll('span')].find(x=>/Gate hints live|gate suggestion chips hidden/.test(x.innerText));const hr=hint.getBoundingClientRect();const lh=parseFloat(getComputedStyle(hint).lineHeight)||12;
      return {saveL:r.left,saveR:r.right,saveH:r.height,cancelH:rc.height,cancelL:rc.left,iw:window.innerWidth,hintW:hr.width,hintLines:Math.round(hr.height/lh),docScroll:document.documentElement.scrollWidth}}""")
    out['att_search'] = pg.evaluate(FIT, 'input[placeholder^="Search roll"]')
    shot(pg, 'attendance')
    # Save still works as before: tick one student and save
    pg.locator('button:has-text("ALL PRESENT")').first.click(); time.sleep(.4)
    out['att_saved'] = False
    pg.get_by_role('button', name='Save').first.click(); time.sleep(1.5)
    out['att_saved'] = pg.locator('button:has-text("Save")').count() == 0
    # 3) Create leave rows
    pg.reload(wait_until='networkidle'); time.sleep(3)
    go(pg, 'students'); pg.get_by_text('Create leave for student').first.click(); time.sleep(1.5); scale(pg); time.sleep(.4)
    out['rows'] = pg.evaluate("""()=>{const d=document.querySelector('[role=dialog]');const rows=[...d.querySelectorAll('button.w-full')];return rows.map(b=>{const r=b.getBoundingClientRect();const s=[...b.querySelectorAll('span.font-mono')][0];if(!s)return null;const q=s.getBoundingClientRect();return {rollW:q.width,rollRight:q.right,rowRight:r.right,rowH:r.height,scr:s.scrollWidth<=s.clientWidth+1,txt:s.innerText}}).filter(Boolean)}""")
    shot(pg, 'createleave')
    # 4) Approval card: note box shows its whole placeholder; the repeated 'one-way leave' line is gone from mentor cards
    pg.reload(wait_until='networkidle'); time.sleep(3)
    go(pg, 'students'); pg.locator('#td-approvals').scroll_into_view_if_needed(); scale(pg); time.sleep(.4)
    out['cards'] = pg.locator('#td-approvals textarea').count()
    out['approval_text'] = pg.locator('#td-approvals').inner_text()
    out['note_fit'] = pg.evaluate(FIT, '#td-approvals textarea')
    # lines the placeholder needs (word-wrap safety +4%) x line height + padding must fit the box height
    out['note_need'] = pg.evaluate("()=>{const e=document.querySelector('#td-approvals textarea');const cs=getComputedStyle(e);const c=document.createElement('canvas').getContext('2d');c.font=cs.fontWeight+' '+cs.fontSize+' '+cs.fontFamily;const inner=e.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);const lh=parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.2;const lines=Math.ceil(c.measureText(e.placeholder).width*1.04/inner);return [lines*lh+parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom), e.clientHeight, lines]}")
    shot(pg, 'approvals')
    out['side_scroll'] = pg.evaluate("()=>document.documentElement.scrollWidth>window.innerWidth+1")
    out['errors'] = errs[:6]
    ctx.close()
print(json.dumps(out))
