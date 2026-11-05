
# Headless-Chromium check for the Settle Dues confirm step. Driven by test/feeConfirm.ui.test.mjs.
# usage: python3 confirm_flow.py '{"base":..,"roll":..,"name":..,"due":..,"shots":"dir or empty"}'
import sys, json, time, os
from playwright.sync_api import sync_playwright
cfg = json.loads(sys.argv[1])
SCALE_JS = """(k)=>{const els=[...document.querySelectorAll('body *')].filter(e=>!e.dataset.scaled);const v=els.map(e=>{const cs=getComputedStyle(e);return [parseFloat(cs.fontSize), cs.lineHeight.endsWith('px')?parseFloat(cs.lineHeight):null]});els.forEach((e,i)=>{e.dataset.scaled='1';e.style.fontSize=(v[i][0]*k)+'px'; if(v[i][1]) e.style.lineHeight=(v[i][1]*k)+'px';});}"""
out = {'viewports': {}}
prof = {'rollNumber': cfg['roll'], 'fullName': cfg['name'], 'role': 'STUDENT', 'hostelBlock': 'A', 'roomNumber': '101', 'resident_type': 'hosteller', 'department': 'Computer Science & Engineering', 'course': 'BTech', 'section': 'A', 'feeDue': cfg['due']}
def mkctx(b, w, h):
    mob = w < 800
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, is_mobile=mob, has_touch=mob, timezone_id='Asia/Kolkata', locale='en-IN')
    sess = {'session': {'access_token': 'tok-' + cfg['roll'], 'refresh_token': 'r', 'expires_in': 36000}, 'profile': prof, 'storedAt': int(time.time() * 1000)}
    ctx.add_init_script("localStorage.setItem('campus_auth_session', %s);" % json.dumps(json.dumps(sess)))
    return ctx
def click_card(pg, w):
    if w < 1024: pg.get_by_label('Fees & Dues').first.click()
    else: pg.get_by_role('button', name='Pay Now').first.click()
    pg.get_by_role('button', name='Settle Dues').first.wait_for(timeout=8000)
def open_modal(pg, w):
    pg.goto(cfg['base'] + '/', wait_until='networkidle'); time.sleep(2.5)
    click_card(pg, w)
def shot(pg, name, k, w):
    if not cfg.get('shots'): return
    if k != 1.0: pg.evaluate(SCALE_JS, k); time.sleep(0.5)
    pg.screenshot(path=os.path.join(cfg['shots'], name + '.png'))
def metrics(pg):
    return pg.evaluate("()=>[document.documentElement.scrollWidth, window.innerWidth]")
def tall(pg, sel):
    return pg.evaluate("(s)=>{const e=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===s);if(!e)return null;const r=e.getBoundingClientRect();return [r.height,r.bottom,window.innerHeight]}", sel)
def underneath(b):
    # dues cleared elsewhere while the confirm view is open -> Confirm shows the settled state, never an error
    ctx = mkctx(b, 390, 844); pg = ctx.new_page(); errs = []; r = {}
    pg.on('pageerror', lambda e: errs.append(str(e)))
    open_modal(pg, 390)
    pg.get_by_role('button', name='Settle Dues').first.click(); time.sleep(0.4)
    r['asked'] = pg.get_by_test_id('fee-confirm').count() == 1
    r['elsewhere_status'] = pg.evaluate("async()=>{const x=await fetch('/api/fees/pay',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer tok-%s'},body:'{}'});return x.status}" % cfg['roll'])
    pg.get_by_test_id('fee-confirm-pay').click(); time.sleep(1.5)
    body = pg.inner_text('body')
    r['paid_card'] = pg.get_by_text('Paid ₹', exact=False).count() > 0
    r['no_error_text'] = ('could not' not in body.lower()) and ('error' not in body.lower())
    r['receipts_note'] = pg.get_by_text('Paid ₹', exact=False).count()
    r['errors'] = errs[:6]
    ctx.close(); return r
with sync_playwright() as p:
    b = p.chromium.launch()
    if cfg.get('scenario') == 'underneath':
        print(json.dumps(underneath(b))); sys.exit(0)
    # ---------- behaviour (390 wide, 130% text) ----------
    for vp in cfg.get('viewports', [[360, 740, 1.3], [390, 844, 1.3], [412, 915, 1.3], [1440, 900, 1.0]]):
        w, h, k = vp
        ctx = mkctx(b, w, h); pg = ctx.new_page(); errs = []; pays = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('request', lambda r: pays.append(r.url) if '/api/fees/pay' in r.url and r.method == 'POST' else None)
        open_modal(pg, w)
        r = {}
        r['dues_view_has_confirm'] = pg.get_by_test_id('fee-confirm').count()
        shot(pg, f'confirm_{w}_1_dues', k, w)
        pg.get_by_role('button', name='Settle Dues').first.click(); time.sleep(0.6)
        r['pays_after_settle_tap'] = len(pays)
        r['confirm_text'] = pg.get_by_test_id('fee-confirm').inner_text()
        r['confirm_btn_h'] = tall(pg, 'Confirm & Pay'); r['cancel_btn_h'] = tall(pg, 'Cancel')
        r['dialogs'] = pg.evaluate("()=>document.querySelectorAll('.fixed.inset-0.z-50').length")
        shot(pg, f'confirm_{w}_2_confirm', k, w)
        r['scroll_confirm'] = metrics(pg)
        # Cancel
        pg.get_by_test_id('fee-cancel').click(); time.sleep(0.5)
        r['after_cancel_confirm_gone'] = pg.get_by_test_id('fee-confirm').count() == 0
        r['after_cancel_settle_back'] = pg.get_by_role('button', name='Settle Dues').count() == 1
        r['pays_after_cancel'] = len(pays)
        # Escape
        pg.get_by_role('button', name='Settle Dues').first.click(); time.sleep(0.4)
        pg.keyboard.press('Escape'); time.sleep(0.4)
        r['after_escape_confirm_gone'] = pg.get_by_test_id('fee-confirm').count() == 0
        # tap outside (backdrop)
        pg.get_by_role('button', name='Settle Dues').first.click(); time.sleep(0.4)
        pg.mouse.click(2, 2); time.sleep(0.4)
        r['after_outside_confirm_gone'] = pg.get_by_test_id('fee-confirm').count() == 0
        r['pays_after_escape_outside'] = len(pays)
        # close (X) while confirming, reopen -> back to dues view
        pg.get_by_role('button', name='Settle Dues').first.click(); time.sleep(0.4)
        pg.get_by_role('button', name='Close').last.click() if pg.get_by_role('button', name='Close').count() else None
        time.sleep(0.4)
        r['pays_after_all_cancels'] = len(pays)
        if pg.get_by_role('button', name='Settle Dues').count() == 0:
            click_card(pg, w); time.sleep(0.6)
        r['reopen_shows_dues_not_confirm'] = pg.get_by_test_id('fee-confirm').count() == 0 and pg.get_by_role('button', name='Settle Dues').count() == 1
        if cfg.get('stop') == 'before_confirm':
            r['errors'] = errs[:6]; out['viewports'][str(w)] = r; ctx.close(); continue
        # Confirm with a DOUBLE click
        pg.get_by_role('button', name='Settle Dues').first.click(); time.sleep(0.4)
        # two clicks in the same tick (a hard double tap) + a real double click afterwards
        res = pg.evaluate("""async()=>{const b=document.querySelector('[data-testid=fee-confirm-pay]');b.click();b.click();await new Promise(r=>setTimeout(r,0));return {disabled:b.disabled,text:b.textContent.trim(),cancelDisabled:document.querySelector('[data-testid=fee-cancel]').disabled}}""")
        r['buttons_disabled_while_running'] = res['disabled'] and res['cancelDisabled']; r['processing_text'] = res['text']
        time.sleep(2.0)
        r['pays_after_confirm_dblclick'] = len(pays)
        r['paid_card'] = pg.get_by_text('Paid ₹', exact=False).count() > 0
        r['settle_gone'] = pg.get_by_role('button', name='Settle Dues').count() == 0
        shot(pg, f'confirm_{w}_3_paid', 1.0, w)
        r['scroll_paid'] = metrics(pg)
        r['errors'] = errs[:6]
        out['viewports'][str(w)] = r
        ctx.close()
    b.close()
print(json.dumps(out))
