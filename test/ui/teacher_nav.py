# Teacher navigation checks (headless Chromium). Driven by test/teacherNav.ui.test.mjs.
# usage: python3 teacher_nav.py '{"base":..,"vp":[w,h,k],"scenario":"busy|quiet|one|student|admin","shots":"dir or empty"}'
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
    if who != 'teacher':
        out['bar'] = has('[data-testid=teacher-bottom-bar]'); out['sections'] = has('[data-testid=sidebar-sections]'); out['side'] = side(); out['errors'] = errs[:6]
        print(json.dumps(out)); ctx.close(); sys.exit(0)
    # ---------- today (busy / quiet / one request) ----------
    out['tab0'] = tab(); out['bar_present'] = has('[data-testid=teacher-bottom-bar]') and vis('[data-testid=teacher-bottom-bar]')
    out['today'] = {
        'all_clear': has('[data-testid=all-clear]'), 'next_class': has('[data-testid=next-class]'), 'quick': pg.locator('[data-testid=quick-actions] button').count(),
        'quiet_line': pg.locator('[data-testid=cover-quiet-line]').inner_text() if has('[data-testid=cover-quiet-line]') else None,
        'needs_badge': pg.locator('[data-testid=needs-badge]').inner_text() if has('[data-testid=needs-badge]') else None,
        'own_row': pg.locator('[data-testid=row-own-requests]').inner_text() if has('[data-testid=row-own-requests]') else None,
        'cover_row': pg.locator('[data-testid=row-covering]').inner_text() if has('[data-testid=row-covering]') else None,
        'cover_cards': pg.locator('[data-testid=cover-cards-today] button:has-text("I\'ll take it")').count(),
        'cover_text': pg.locator('[data-testid=cover-cards-today]').inner_text() if has('[data-testid=cover-cards-today]') else '',
        'banner': has('[data-testid=alerts-banner]'), 'timetable': has('#td-timetable'),
        'present_btn': has('#td-status'),
        'mark_btn': pg.locator('[data-testid=next-class-mark]').count(),
        'next_text': pg.locator('[data-testid=next-class]').inner_text() if has('[data-testid=next-class]') else None,
    }
    shot('today')
    out['side_today'] = side()
    if mob:
        bar = pg.evaluate("()=>{const r=document.querySelector('[data-testid=teacher-bottom-bar]').getBoundingClientRect();return {top:r.top,bottom:r.bottom,h:r.height,iw:window.innerWidth,ih:window.innerHeight}}")
        btns = pg.evaluate("()=>[...document.querySelectorAll('[data-testid=teacher-bottom-bar] button')].map(b=>{const r=b.getBoundingClientRect();const l=b.querySelector('span:last-child');return {tab:b.dataset.tab,w:r.width,h:r.height,left:r.left,right:r.right,labelClip:l.scrollWidth>l.clientWidth+1,text:l.innerText,badge:(b.querySelector('b')||{}).innerText||null}})")
        out['bar'] = bar; out['btns'] = btns
        # content never hides behind the bar: scroll to the end, the last thing (footer spacer) ends above the bar
        out['bottom_gap'] = pg.evaluate("()=>{const s=document.getElementById('app-scroll');s.scrollTop=s.scrollHeight;const f=document.querySelector('footer').getBoundingClientRect();return {footerBottom:f.bottom,barTop:document.querySelector('[data-testid=teacher-bottom-bar]').getBoundingClientRect().top}}")
        pg.evaluate("()=>{document.getElementById('app-scroll').scrollTop=0}")
    else:
        out['sections'] = pg.evaluate("()=>{const s=document.querySelector('[data-testid=sidebar-sections]');return s?{vis:s.getBoundingClientRect().height>0,labels:[...s.querySelectorAll('button')].map(b=>b.dataset.section)}:null}")
        out['sidebar_text'] = pg.evaluate("()=>document.querySelector('aside').innerText")
        out['bar_present'] = has('[data-testid=teacher-bottom-bar]') and vis('[data-testid=teacher-bottom-bar]')
    # ---------- tabs switch ----------
    seen = {}
    for t in ['students', 'classes', 'me', 'today']:
        go(t); seen[t] = tab(); out.setdefault('side_tabs', {})[t] = side()
        if t != 'today': shot(t)
        if t == 'students': out['students'] = {'approvals': has('#td-approvals'), 'gatelog': has('#td-gatelog'), 'covering': has('#td-covering'), 'covering_text': pg.locator('#td-covering').inner_text()[:80] if has('#td-covering') else None, 'create': has('button:has-text("Create leave for student")'), 'mentees': has('#td-mentees'), 'search': has('input[placeholder^="Search students"]')}
        if t == 'classes': out['classes'] = {'attendance': has('[data-testid=attendance-list]'), 'cover': has('[data-testid=cover-board]'), 'insights': has('#td-insights'), 'tabs': pg.locator('#td-insights [role=tab]').all_inner_texts()}
        if t == 'me':
            txt = pg.locator('[data-testid=tab-me]').inner_text()
            out['me'] = {'rows': pg.locator('[data-testid=me-rows] > [data-testid^=me-]').count(), 'ids': pg.evaluate("()=>[...document.querySelectorAll('[data-testid=me-rows] > [data-testid^=me-]')].map(e=>e.dataset.testid)"), 'text': txt, 'identity': pg.locator('[data-testid=me-identity]').inner_text(), 'toggle': has('[data-testid=me-alerts-toggle]')}
    out['tabs_seen'] = seen
    # ---------- drawer (phone) ----------
    if mob:
        pg.locator('header button').first.click(); time.sleep(.8)
        out['drawer'] = pg.evaluate("()=>{const a=document.querySelector('aside');const nav=a.querySelector('nav');return {items:[...nav.querySelectorAll('button')].filter(b=>b.offsetParent!==null).map(b=>b.innerText.trim()),sectionsVisible:(()=>{const s=a.querySelector('[data-testid=sidebar-sections]');return !!s&&s.getBoundingClientRect().height>0})(),label:[...nav.querySelectorAll('p')].find(p=>p.offsetParent!==null).innerText.trim(),x:a.getBoundingClientRect().left}}")
        shot('drawer')
        out['bar_over_drawer'] = pg.evaluate("()=>{const bar=document.querySelector('[data-testid=teacher-bottom-bar]');const a=document.querySelector('aside');return {zbar:+getComputedStyle(bar).zIndex,zaside:+getComputedStyle(a).zIndex}}")
        pg.keyboard.press('Escape'); pg.locator('aside button[title="Close Sidebar"]').click(); time.sleep(.5)
    # ---------- bar steps aside for a modal and for the keyboard ----------
    if mob:
        go('students')
        pg.get_by_text('Create leave for student').first.click(); time.sleep(1.2)
        out['bar_hidden_in_modal'] = not has('[data-testid=teacher-bottom-bar]')
        pg.keyboard.press('Escape'); time.sleep(.8)
        out['bar_back_after_modal'] = has('[data-testid=teacher-bottom-bar]')
        pg.locator('input[placeholder^="Search students"]').first.focus(); time.sleep(.5)
        out['bar_hidden_with_keyboard'] = not has('[data-testid=teacher-bottom-bar]')
        pg.evaluate("()=>document.activeElement.blur()"); time.sleep(.6)
        out['bar_back_after_keyboard'] = has('[data-testid=teacher-bottom-bar]')
    # ---------- per-tab scroll position ----------
    if sc in ('busy',):
        go('students'); pg.evaluate("()=>{document.getElementById('app-scroll').scrollTop=400}"); time.sleep(.3)
        go('classes'); a = pg.evaluate("()=>document.getElementById('app-scroll').scrollTop")
        go('students'); b2 = pg.evaluate("()=>document.getElementById('app-scroll').scrollTop")
        out['scroll'] = {'other_tab': a, 'students_restored': b2}
        # today rows jump to the right place in Students
        go('today')
        if has('[data-testid=row-own-requests]'):
            pg.locator('[data-testid=row-own-requests]').click(); time.sleep(.8)
            top = None; series = []
            for _ in range(20):   # smooth scrolling on a loaded box: wait until it settles
                top = pg.evaluate("()=>{const e=document.getElementById('td-approvals');return e?Math.round(e.getBoundingClientRect().top):null}")
                series.append([top, pg.evaluate("()=>document.getElementById('app-scroll').scrollTop")])
                if top is not None and top < 200: break
                time.sleep(.3)
            out['row_jump'] = {'tab': tab(), 'approvals_top': top, 'series': series[:8]}
        go('today')
        if has('[data-testid=row-covering]'):
            pg.locator('[data-testid=row-covering]').click(); time.sleep(1.2)
            out['cover_jump'] = {'tab': tab(), 'visible': vis('#td-covering')}
    # ---------- quick actions (quiet) ----------
    if sc in ('quiet', 'one'):
        go('today')
        pg.locator('[data-testid=qa-gate-log]').click(); time.sleep(1.2); out['qa_gate'] = {'tab': tab(), 'gate': has('#td-gatelog')}
        go('today'); pg.locator('[data-testid=qa-lesson-plan]').click(); time.sleep(1.2)
        out['qa_plan'] = {'tab': tab(), 'plan_selected': pg.locator('#td-insights [role=tab][aria-selected=true]').inner_text() if has('#td-insights [role=tab]') else None}
        go('today'); pg.locator('[data-testid=qa-create-leave]').click(); time.sleep(1.2)
        out['qa_create'] = {'tab': tab(), 'modal': has('#td-create-leave-title') or has('text=Create leave for student')}
        pg.keyboard.press('Escape'); time.sleep(.5)
    # ---------- alerts: banner + Me toggle ----------
    go('today')
    out['alerts'] = {'banner': has('[data-testid=alerts-banner]')}
    if out['alerts']['banner']:
        pg.locator('[data-testid=alerts-banner] button[aria-label=Dismiss]').click(); time.sleep(.4)
        out['alerts']['after_dismiss'] = has('[data-testid=alerts-banner]')
        load(); out['alerts']['after_reload'] = has('[data-testid=alerts-banner]')
    go('me'); out['alerts']['me_sub'] = pg.locator('[data-testid=me-alerts]').inner_text()
    pg.locator('[data-testid=me-leaves]').click(); time.sleep(1.2); scale()
    out['my_leaves_open'] = has('#td-myleaves'); shot('me_leaves')
    pg.locator('[data-testid=me-notices]').click(); time.sleep(1.0)
    out['notices_open'] = pg.evaluate("()=>/notice/i.test(document.body.innerText) && !!document.querySelector('.fixed.inset-0')")
    pg.keyboard.press('Escape')
    # ---------- deep link ----------
    load('/?tab=students'); out['deep_students'] = tab()
    load('/#classes'); out['deep_hash'] = tab()
    out['side_final'] = side()
    out['errors'] = errs[:6]
    ctx.close()
print(json.dumps(out))
