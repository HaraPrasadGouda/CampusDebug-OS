# Admin / Dean Home ("Needs you now") checks, headless Chromium. Driven by test/adminHome.ui.test.mjs.
# usage: python3 admin_home.py '{"base":..,"vp":[w,h,k],"roll":"ADMIN01","profile":{..},"now":"2026-11-04T14:05:00+05:30","scenario":"busy|quiet|actions","shots":""}'
import sys, json, time, os
from datetime import datetime
from playwright.sync_api import sync_playwright
cfg = json.loads(sys.argv[1]); w, h, k = cfg['vp']; scen = cfg.get('scenario', 'busy')
SCALE_JS = """(k)=>{const els=[...document.querySelectorAll('body *')].filter(e=>!e.dataset.scaled);const v=els.map(e=>{const cs=getComputedStyle(e);return [parseFloat(cs.fontSize), cs.lineHeight.endsWith('px')?parseFloat(cs.lineHeight):null]});els.forEach((e,i)=>{e.dataset.scaled='1';e.style.fontSize=(v[i][0]*k)+'px'; if(v[i][1]) e.style.lineHeight=(v[i][1]*k)+'px';});}"""
WANT = datetime.fromisoformat(cfg['now']).timestamp() * 1000
def skew(off): return "(()=>{const off=%d;const _D=Date;class D extends _D{constructor(...a){if(a.length===0)super(_D.now()+off);else super(...a);}static now(){return _D.now()+off;}};D.parse=_D.parse;D.UTC=_D.UTC;window.Date=D;})();" % off
out = {}; errs = []
def scale(pg):
    if k != 1.0: pg.evaluate(SCALE_JS, k); time.sleep(0.4)
def shot(pg, name, full=True):
    if cfg.get('shots'): pg.screenshot(path=os.path.join(cfg['shots'], f"{name}_{scen}_{w}.png"), full_page=full)
def small_targets(pg):
    return pg.evaluate("""()=>[...document.querySelectorAll('.admin-dash button, .admin-dash select, .admin-dash textarea, .admin-dash input:not([type=checkbox]):not([type=radio]):not([type=file])')].filter(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&r.height<43.5}).map(e=>[e.tagName,(e.innerText||e.placeholder||e.title||'').trim().slice(0,30),Math.round(e.getBoundingClientRect().height)])""")
def side_scroll(pg): return pg.evaluate("()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)>window.innerWidth+1")
def counters(pg): return pg.evaluate("()=>Object.fromEntries([...document.querySelectorAll('[data-home-counter]')].map(e=>[e.dataset.homeCounter,e.querySelector('p').innerText]))")
def past_edge(pg): return pg.evaluate("()=>{const iw=innerWidth;return [...document.querySelectorAll('[data-admin-home] *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>iw+1||r.left<-1)&&!String(e.className).includes('pointer-events-none')}).slice(0,5).map(e=>[e.tagName,(e.innerText||'').slice(0,30),Math.round(e.getBoundingClientRect().right)])}")
def clipped(pg): return pg.evaluate("()=>[...document.querySelectorAll('[data-admin-home] p, [data-admin-home] button, [data-admin-home] h1, [data-admin-home] h2')].filter(e=>e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflow!=='visible').slice(0,5).map(e=>(e.innerText||'').slice(0,40))")
mob = w < 800
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if mob else 1, is_mobile=mob, has_touch=mob, timezone_id='Asia/Kolkata', locale='en-IN')
    ctx.add_init_script(skew(int(WANT - time.time() * 1000)))
    sess = {'session': {'access_token': 'tok-' + cfg['roll'], 'refresh_token': 'r', 'expires_in': 36000}, 'profile': cfg['profile'], 'storedAt': int(WANT)}
    ctx.add_init_script("localStorage.setItem('campus_auth_session', %s);" % json.dumps(json.dumps(sess)))
    ctx.add_init_script("localStorage.setItem('campusdebug_session', %s);" % json.dumps(json.dumps({'role': 'Admin', 'identity': cfg['roll'], 'name': cfg['profile']['full_name'], 'profileRole': cfg['profile']['role']})))
    pg = ctx.new_page(); pg.set_default_timeout(10000); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text[:160]) if m.type == 'error' else None)
    pg.on('response', lambda r: errs.append('HTTP %d %s %s' % (r.status, r.request.method, r.url.split('/', 3)[-1][:80])) if r.status >= 400 else None)
    pg.goto(cfg['base'] + '/', wait_until='networkidle'); time.sleep(3)
    pg.locator('[data-admin-home]').wait_for(); time.sleep(1.5); scale(pg); time.sleep(.3)
    if cfg.get('shotOnly'):
        pg.screenshot(path=os.path.join(cfg['shots'], f"{'phone' if mob else 'laptop'}_{scen}_full.png")); ctx.close(); print(json.dumps({})); sys.exit(0)
    out['counters'] = counters(pg)
    out['hasForm'] = pg.locator('[data-admin-home] form').count()
    out['clear'] = pg.locator('[data-home-clear]').count()
    out['needs'] = {kk: pg.locator(f'[data-home-need="{kk}"]').count() for kk in ('cover', 'docs', 'escalated')}
    out['docRows'] = pg.locator('[data-home-doc]').count()
    out['escRows'] = pg.locator('[data-home-escalated]').count()
    out['cancelledRows'] = pg.locator('[data-home-cancelled]').count()
    out['quick'] = pg.locator('[data-home-go="dispatcher"], [data-home-go="fees"], [data-home-go="security"]').locator('visible=true').count()
    out['greeting'] = pg.locator('[data-admin-home] h1').inner_text()
    out['tiles'] = pg.locator('[data-home-tiles] > div').count()
    out['small'] = small_targets(pg); out['side'] = side_scroll(pg); out['edge'] = past_edge(pg); out['clipped'] = clipped(pg)
    # first screen (phone): the "Needs you now" heading and the first action are visible without scrolling, above the bottom bar
    out['first'] = pg.evaluate("""()=>{const hd=[...document.querySelectorAll('[data-admin-home] h2')].find(x=>/Needs you now/.test(x.innerText));const hr=hd.getBoundingClientRect();const first=document.querySelector('[data-home-need] button, [data-home-clear]');const fr=first?first.getBoundingClientRect():null;const nav=document.querySelector('nav.fixed');const nt=nav&&getComputedStyle(nav).display!=='none'?nav.getBoundingClientRect().top:innerHeight;return {headTop:hr.top,headBottom:hr.bottom,firstBottom:fr?fr.bottom:null,navTop:nt,ih:innerHeight}}""")
    if mob:
        out['bar'] = pg.evaluate("""()=>[...document.querySelectorAll('[data-admin-group]')].map(b=>{const s=b.querySelector('span:last-child');const br=b.getBoundingClientRect();const sr=s.getBoundingClientRect();return {t:s.innerText,l:br.left,r=br.right,sl:sr.left,sr:sr.right,clip:s.scrollWidth>s.clientWidth+1}})""".replace('r=br.right','r:br.right'))
    shot(pg, 'home')
    if cfg.get('shots'): pg.screenshot(path=os.path.join(cfg['shots'], f"{'phone' if mob else 'laptop'}_{scen}_top.png"), full_page=False)
    if scen == 'actions':
        res = {}
        ids = pg.evaluate("()=>[...document.querySelectorAll('[data-home-doc]')].map(e=>e.dataset.homeDoc)")
        res['docIds'] = ids[:2]
        before = counters(pg)
        pg.locator(f'[data-home-doc="{ids[0]}"] button').first.click(); time.sleep(1.5)
        pg.locator(f'[data-home-doc="{ids[1]}"] button').nth(1).click(); time.sleep(1.5)
        res['docCounters'] = [before['Requests'], counters(pg)['Requests']]
        res['gone'] = pg.locator(f'[data-home-doc="{ids[0]}"]').count() + pg.locator(f'[data-home-doc="{ids[1]}"]').count()
        # Mark class cancelled (one tap, no confirm step) -> row moves to Today's covers with Undo; Undo brings it back
        res['coverBefore'] = [counters(pg)['No cover'], pg.locator('[data-home-cancelled]').count()]
        pg.get_by_role('button', name='Mark class cancelled').first.click(); time.sleep(2)
        res['coverAfterCancel'] = [counters(pg)['No cover'], pg.locator('[data-home-cancelled]').count(), pg.locator('[data-home-need="cover"]').count()]
        scale(pg); shot(pg, 'afterCancel')
        pg.locator('[data-testid=undo-cancel]').first.click(); time.sleep(2)
        res['coverAfterUndo'] = [counters(pg)['No cover'], pg.locator('[data-home-cancelled]').count(), pg.locator('[data-home-need="cover"]').count()]
        # Send notice stays one tap away on phones; on the laptop the form is already on Home
        if mob:
            pg.locator('[data-home-go="dispatcher"]').locator('visible=true').first.click(); time.sleep(1)
            res['noticeForm'] = pg.locator('.admin-dash form').count()
            pg.locator('[data-admin-group="Home"]').locator('visible=true').first.click(); time.sleep(1)
        else:
            res['noticeForm'] = pg.locator('[data-home-side] form').count()
        res['backHome'] = pg.locator('[data-admin-home]').count()
        # every admin tool still reachable
        reach = {}
        if mob:
            for g in ('Notices', 'Academics', 'Campus', 'More'):
                pg.locator(f'[data-admin-group="{g}"]').locator('visible=true').first.click(); time.sleep(.6)
                reach[g] = pg.evaluate("()=>[...document.querySelectorAll('.admin-dash [data-admin-tab]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.dataset.adminTab)")
                if g in ('Notices', 'Academics'):
                    reach[g] = [{'Notices': 'dispatcher', 'Academics': 'timetable'}[g]] if pg.locator('.admin-dash h3').count() else []
        else:
            reach['sidebar'] = pg.evaluate("()=>[...document.querySelectorAll('#admin-tool-nav [data-admin-tab]')].map(e=>e.dataset.adminTab)")
            pg.locator('#admin-tool-nav [data-admin-tab="docs"]').click(); time.sleep(1)
            res['leftHome'] = pg.locator('[data-admin-home]').count()
            pg.get_by_role('button', name='Home', exact=True).first.click(); time.sleep(1.2)
            res['backHome'] = pg.locator('[data-admin-home]').count()
        res['reach'] = reach
        out['actions'] = res
    out['errors'] = [e for e in errs if 'favicon' not in e][:6]
    ctx.close()
print(json.dumps(out))
