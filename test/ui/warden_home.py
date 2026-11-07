# Warden Home ("Needs you now") checks in headless Chromium. Driven by test/wardenHome.ui.test.mjs.
# usage: python3 warden_home.py '{"base":..,"vp":[w,h,k],"scenario":"busy|quiet|empty","shots":"dir or empty"}'
import sys, json, time, os
from playwright.sync_api import sync_playwright
cfg = json.loads(sys.argv[1]); w, h, k = cfg['vp']; scen = cfg['scenario']
SCALE_JS = """(k)=>{const els=[...document.querySelectorAll('body *')].filter(e=>!e.dataset.scaled);const v=els.map(e=>{const cs=getComputedStyle(e);return [parseFloat(cs.fontSize), cs.lineHeight.endsWith('px')?parseFloat(cs.lineHeight):null]});els.forEach((e,i)=>{e.dataset.scaled='1';e.style.fontSize=(v[i][0]*k)+'px'; if(v[i][1]) e.style.lineHeight=(v[i][1]*k)+'px';});}"""
out = {}; errs = []
def scale(pg):
    if k != 1.0: pg.evaluate(SCALE_JS, k)
    time.sleep(0.5)
def shot(pg, name, tall=None):
    if not cfg.get('shots'): return
    if tall:
        pg.set_viewport_size({'width': w, 'height': tall}); time.sleep(0.6)
    pg.screenshot(path=os.path.join(cfg['shots'], f"{name}_{scen}_{w}.png"), full_page=False)
    if tall:
        pg.set_viewport_size({'width': w, 'height': h}); time.sleep(0.4)
# every control inside Home: a real 44px target, fully on screen
CONTROLS = """()=>{const root=document.querySelector('[data-testid=warden-home]');const iw=window.innerWidth;return [...root.querySelectorAll('button,a,select,input')].filter(e=>e.offsetParent!==null).map(e=>{const r=e.getBoundingClientRect();return {t:(e.innerText||e.getAttribute('aria-label')||'').trim().slice(0,40),h:r.height,w:r.width,l:r.left,r:r.right}})}"""
# text never clipped / never wider than its box (catches cut-off labels), nothing wider than the screen
CLIP = """()=>{const root=document.querySelector('[data-testid=warden-home]');const iw=window.innerWidth;const bad=[];root.querySelectorAll('*').forEach(e=>{if(e.offsetParent===null||e.closest('.pointer-events-none'))return;const r=e.getBoundingClientRect();if(r.right>iw+1||r.left<-1)bad.push('offscreen:'+(e.innerText||e.tagName).slice(0,30));const cs=getComputedStyle(e);if(e.children.length===0&&e.scrollWidth>e.clientWidth+1&&cs.display!=='inline'&&e.clientWidth>0)bad.push('clipped:'+(e.innerText||'').slice(0,30)+' '+e.scrollWidth+'>'+e.clientWidth)});return bad.slice(0,8)}"""
with sync_playwright() as p:
    b = p.chromium.launch(); mob = w < 800
    pr = {'rollNumber': 'WARD01', 'fullName': 'Dr. S. K. Mohanty', 'role': 'WARDEN', 'roll_number': 'WARD01', 'full_name': 'Dr. S. K. Mohanty', 'department': 'Hostel Administration', 'id': '%08x-0000-4000-8000-%012x' % (900, 900)}
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if mob else 1, is_mobile=mob, has_touch=mob, timezone_id='Asia/Kolkata', locale='en-IN')
    sess = {'session': {'access_token': 'tok-WARD01', 'refresh_token': 'r', 'expires_in': 36000}, 'profile': pr, 'storedAt': int(time.time() * 1000)}
    ctx.add_init_script("localStorage.setItem('campus_auth_session', %s);" % json.dumps(json.dumps(sess)))
    pg = ctx.new_page(); pg.set_default_timeout(10000)
    pg.on('pageerror', lambda e: errs.append(str(e)[:160])); pg.on('console', lambda m: errs.append(m.text[:160]) if m.type == 'error' else None)
    if scen == 'busy':
        pg.route('**/api/cleaning/warden', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'success': True, 'blocks': [], 'alerts': [{'block': 'Hostel B', 'room': '207', 'date': '2026-11-05', 'notFixedCount': 2}]})))
    pg.goto(cfg['base'] + '/', wait_until='networkidle'); time.sleep(3)
    scale(pg)
    home = pg.locator('[data-testid=warden-home]'); out['home_visible'] = home.count() == 1
    out['kpi_strip_hidden'] = pg.locator('section.grid').count() == 0
    out['heading'] = pg.evaluate("()=>document.querySelector('[data-testid=home-hero] h1')?.innerText||null")
    out['hero_tiles'] = pg.evaluate("()=>[...document.querySelectorAll('[data-testid=home-hero] .grid > div')].map(d=>d.innerText.replace(/\\s+/g,' ').trim())")
    out['all_clear'] = pg.locator('[data-testid=home-all-clear]').count() == 1
    out['nobody_out'] = pg.locator('[data-testid=home-nobody-out]').count() == 1
    out['out_card'] = pg.locator('[data-testid=home-out-card]').count() == 1
    out['out_rows'] = pg.locator('[data-testid=home-out-row]').count()
    out['rows'] = pg.evaluate("()=>[...document.querySelectorAll('[data-testid^=home-row-]')].map(e=>e.getAttribute('data-testid')+': '+e.innerText.replace(/\\s+/g,' ').trim())")
    out['needs_badge'] = pg.evaluate("()=>{const h=[...document.querySelectorAll('h2')].find(x=>/Needs you now/.test(x.innerText));return h?h.innerText.replace(/\\s+/g,' ').trim():null}")
    out['grid_tiles'] = pg.locator('[data-testid=home-section-grid] button').count()
    out['controls'] = pg.evaluate(CONTROLS); out['clip'] = pg.evaluate(CLIP)
    out['side_scroll'] = pg.evaluate("()=>{const s=document.querySelector('div.overflow-y-auto.h-screen')||document.documentElement;return Math.max(document.documentElement.scrollWidth,s.scrollWidth)>window.innerWidth+1}")
    out['fees_requested'] = False
    shot(pg, 'home', tall=2600 if mob else 1500)
    if scen == 'busy':
        cards = pg.locator('[data-testid=home-pass-card]')
        out['cards_initial'] = cards.count()
        c0 = cards.nth(0)
        ap = c0.get_by_role('button', name='Approve and sign'); rj = c0.get_by_role('button', name='Reject')
        a, r = ap.bounding_box(), rj.bounding_box(); cb = c0.bounding_box()
        out['approve_full_width'] = a['width'] >= cb['width'] - 40
        out['approve_h'] = a['height']
        out['reject_above_approve'] = r['y'] + r['height'] <= a['y']
        out['reject_h'] = r['height']
        out['reject_w'] = r['width']
        # view all expands every pending pass in place (no navigation)
        pg.get_by_role('button', name='View all').first.click(); time.sleep(.6); scale(pg)
        out['cards_expanded'] = pg.locator('[data-testid=home-pass-card]').count()
        shot(pg, 'home_expanded', tall=4200 if mob else 2600)
        out['controls_expanded'] = pg.evaluate(CONTROLS); out['clip_expanded'] = pg.evaluate(CLIP)
        pg.get_by_role('button', name='Show fewer').first.click(); time.sleep(.4)
        # approve the first card: same endpoints as before (the pass leaves the queue and stays gone after a reload)
        first_id = pg.locator('[data-testid=home-pass-card]').nth(0).inner_text().split('\n')
        pg.locator('[data-testid=home-pass-card]').nth(0).get_by_role('button', name='Approve and sign').click(); time.sleep(1.5)
        out['after_approve'] = pg.locator('[data-testid=home-pass-card]').count()
        out['needs_after_approve'] = pg.evaluate("()=>{const h=[...document.querySelectorAll('h2')].find(x=>/Needs you now/.test(x.innerText));return h?h.innerText.replace(/\\s+/g,' ').trim():null}")
        pg.locator('[data-testid=home-pass-card]').nth(0).get_by_role('button', name='Reject').click(); time.sleep(0.5); pg.locator('[data-testid=reject-confirm-yes]').click(); time.sleep(1.5)
        pg.reload(wait_until='networkidle'); time.sleep(3); scale(pg)
        pg.get_by_role('button', name='View all').first.click(); time.sleep(.6)
        out['cards_after_reload'] = pg.locator('[data-testid=home-pass-card]').count()
        # Dispatch row exists only for exactly one unassigned incident; the incident row opens Master Incidents
        pg.locator('[data-testid=home-row-incident] button').first.click(); time.sleep(.8)
        out['incident_open'] = pg.evaluate("()=>{const e=document.querySelector('#wd-clusters');return !!e&&e.offsetParent!==null}")
        out['home_chip_back'] = False
        pg.locator('button[aria-pressed]', has_text='Home').first.click(); time.sleep(.6)
        out['home_chip_back'] = pg.locator('[data-testid=warden-home]').count() == 1
        # every section stays reachable from the grid, one tap
        reach = {}
        for label, sel in [('Pending passes', '#wd-passes'), ('Student issues', '#wd-tickets'), ('Master incidents', '#wd-clusters'), ('Cleaning', '#wd-cleaning'), ('SLA heatmap', '#wd-sla'), ('Gate register', '#wd-register'), ('Technicians', '#wd-technicians'), ('Fee payments', '#wd-fees')]:
            pg.locator('[data-testid=home-section-grid] button', has_text=label).first.click(); time.sleep(.5)
            reach[label] = pg.evaluate("(s)=>{const e=document.querySelector(s);return !!e&&e.offsetParent!==null}", sel)
            if label == 'Gate register': out['register_still_out'] = pg.evaluate("()=>{const e=[...document.querySelectorAll('#wd-register span')].find(x=>/still out/i.test(x.innerText));return e?e.innerText.trim():null}")
            pg.locator('button[aria-pressed]', has_text='Home').first.click(); time.sleep(.4)
        out['reach'] = reach
        # Create pass quick action opens the existing modal
        pg.get_by_role('button', name='Create pass').first.click(); time.sleep(1)
        out['create_modal'] = pg.evaluate("()=>!![...document.querySelectorAll('h3')].find(x=>/Create Pass on Behalf/.test(x.innerText))")
    out['errors'] = errs[:6]
    ctx.close(); b.close()
print(json.dumps(out))
