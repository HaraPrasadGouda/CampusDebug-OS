# Teacher 'Edit attendance' checks (headless Chromium). Driven by test/attendanceEdit.ui.test.mjs.
# usage: python3 teacher_att_edit.py '{"base":..,"vp":[w,h,k],"scenario":"inhours|after","now":iso,"shots":"dir or empty"}'
import sys, json, time, os
from datetime import datetime
from playwright.sync_api import sync_playwright
cfg = json.loads(sys.argv[1]); w, h, k = cfg['vp']; sc = cfg['scenario']; mob = w < 1024
SCALE_JS = """(k)=>{const els=[...document.querySelectorAll('body *')].filter(e=>!e.dataset.scaled);const v=els.map(e=>{const cs=getComputedStyle(e);return [parseFloat(cs.fontSize), cs.lineHeight.endsWith('px')?parseFloat(cs.lineHeight):null]});els.forEach((e,i)=>{e.dataset.scaled='1';e.style.fontSize=(v[i][0]*k)+'px'; if(v[i][1]) e.style.lineHeight=(v[i][1]*k)+'px';});}"""
PROFS = {
    'teacher': {'rollNumber': 'FAC003', 'fullName': 'Dr. Priya Mishra', 'role': 'TEACHER', 'department': 'Computer Science & Engineering', 'roll_number': 'FAC003', 'full_name': 'Dr. Priya Mishra', 'id': '00000003-0000-4000-8000-000000000003'},
    'student': {'rollNumber': '2301109001', 'fullName': 'Ananya Mishra', 'role': 'STUDENT', 'roll_number': '2301109001', 'full_name': 'Ananya Mishra', 'id': '00000013-0000-4000-8000-000000000013', 'resident_type': 'dayscholar', 'department': 'CSE'},
    'admin': {'rollNumber': 'ADMIN01', 'fullName': 'Admin A', 'role': 'ADMIN', 'roll_number': 'ADMIN01', 'full_name': 'Admin A', 'id': '0000002c-0000-4000-8000-00000000002c', 'phone_number': '9000000999'},
}
who = sc if sc in ('student', 'admin') else 'teacher'
prof = PROFS[who]
WANT = datetime.fromisoformat(cfg.get('now', '2026-11-04T10:30:00+05:30')).timestamp() * 1000
def skew(off): return "(()=>{const off=%d;const _D=Date;class D extends _D{constructor(...a){if(a.length===0)super(_D.now()+off);else super(...a);}static now(){return _D.now()+off;}};D.parse=_D.parse;D.UTC=_D.UTC;window.Date=D;})();" % off
out = {}; errs = []
def shots_dir(): return cfg.get('shots') or ''
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if mob else 1, is_mobile=mob, has_touch=mob, timezone_id='Asia/Kolkata', locale='en-IN')
    ctx.add_init_script(skew(int(WANT - time.time() * 1000)))
    sess = {'session': {'access_token': 'tok-' + prof['roll_number'], 'refresh_token': 'r', 'expires_in': 36000}, 'profile': prof, 'storedAt': int(WANT)}
    ctx.add_init_script("localStorage.setItem('campus_auth_session', %s);" % json.dumps(json.dumps(sess)))
    pg = ctx.new_page(); pg.set_default_timeout(10000)
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text[:160]) if m.type == 'error' else None)
    def scale():
        if k != 1.0: pg.evaluate(SCALE_JS, k); time.sleep(.4)
    def load(url='/'):
        pg.goto(cfg['base'] + url, wait_until='networkidle'); time.sleep(3); scale()
    def shot(name):
        if shots_dir(): pg.screenshot(path=os.path.join(shots_dir(), f'{name}_{sc}_{w}.png'))
    def go(name):
        pg.locator(f'[data-testid=teacher-bottom-bar] [data-tab={name}]' if mob else f'[data-testid=sidebar-sections] [data-section={name}]').click(); time.sleep(.7); scale()
    def tab(): return pg.locator('[data-teacher-tab]').first.get_attribute('data-teacher-tab')
    def side(): return pg.evaluate("()=>document.documentElement.scrollWidth>window.innerWidth+1")
    def has(sel): return pg.locator(sel).count() > 0
    def vis(sel): return pg.locator(sel).first.is_visible() if has(sel) else False
    load()
    out['bar_present'] = has('[data-testid=teacher-bottom-bar]') and vis('[data-testid=teacher-bottom-bar]')
    # ---- Today: "My day" timeline + Next-class card ----
    out['today'] = {'edit_btns': pg.locator('[data-testid=att-edit]').count(), 'next_edit': pg.locator('[data-testid=next-class-edit]').count(),
                    'timeline': pg.locator('#td-timetable').inner_text() if has('#td-timetable') else '', 'next_text': pg.locator('[data-testid=next-class]').inner_text() if has('[data-testid=next-class]') else ''}
    out['today']['has_locked_word'] = 'Locked' in (out['today']['timeline'] + out['today']['next_text'])
    if has('#td-timetable'): pg.locator('#td-timetable').scroll_into_view_if_needed(); time.sleep(.4)
    shot('today_myday')
    out['side_today'] = side()
    # ---- Classes tab: attendance list ----
    go('classes'); time.sleep(.5)
    out['classes'] = {'edit_btns': pg.locator('[data-testid=classes-edit]').count(), 'mark_btns': pg.locator('[data-testid=classes-mark]').count(), 'text': pg.locator('main').first.inner_text()[:1500] if has('main') else ''}
    shot('classes')
    out['side_classes'] = side()
    if sc == 'inhours':
        pg.locator('[data-testid=classes-edit]').first.click(); time.sleep(1.5); scale()
        out['modal'] = {'title': pg.locator('div.fixed.inset-0.z-50 h3').first.inner_text(), 'ticked': pg.locator('button.text-left.bg-emerald-600').count(), 'save': pg.locator('button:has-text("Save")').last.inner_text()}
        shot('edit_modal')
        out['modal']['side'] = side()
        pg.locator('button.text-left.bg-emerald-600').first.click(); time.sleep(.3)   # untick the first present student, then save the edit
        pg.locator('button:has-text("Save changes")').click(); time.sleep(1.5)
        out['after_save_modal_open'] = pg.locator('h3:has-text("Edit Attendance")').count()
    out['errors'] = errs[:6]
    print(json.dumps(out)); ctx.close()
