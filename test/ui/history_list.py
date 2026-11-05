# Headless-Chromium check of the student's request/history list. Driven by test/historyList.ui.test.mjs.
# usage: python3 history_list.py '{"base":..,"roll":..,"name":..,"profile":{..},"vp":[w,h,k],"shots":"dir or empty","shotName":".."}'
import sys, json, time, os
from playwright.sync_api import sync_playwright
cfg = json.loads(sys.argv[1])
SCALE_JS = """(k)=>{const els=[...document.querySelectorAll('body *')].filter(e=>!e.dataset.scaled);const v=els.map(e=>{const cs=getComputedStyle(e);return [parseFloat(cs.fontSize), cs.lineHeight.endsWith('px')?parseFloat(cs.lineHeight):null]});els.forEach((e,i)=>{e.dataset.scaled='1';e.style.fontSize=(v[i][0]*k)+'px'; if(v[i][1]) e.style.lineHeight=(v[i][1]*k)+'px';});}"""
MEASURE_JS = """()=>{
  const feed=[...document.querySelectorAll('h2')].find(h=>/Live Action/.test(h.textContent));
  const card=feed&&feed.closest('.rounded-2xl');
  const rows=[...card.querySelectorAll('[data-testid=row-tracker]')].map(t=>t.parentElement);
  const allRows=[...card.querySelectorAll('div.group')].filter(r=>r.parentElement&&r.parentElement.classList.contains('space-y-2'));
  const rect=e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.left*10)/10,w:Math.round(r.width*10)/10,y:Math.round(r.top+scrollY),h:Math.round(r.height*10)/10,r:Math.round(r.right*10)/10}};
  const out=allRows.map(r=>{
    const t=r.querySelector('[data-testid=row-tracker]');
    const title=r.querySelector('p');
    const bar=t&&t.querySelector('[aria-label^="Progress"]');
    const kids=[...r.querySelectorAll('*')];
    const overflowing=kids.filter(e=>{const cs=getComputedStyle(e); if(cs.position==='absolute') return false; const b=e.getBoundingClientRect(); const rb=r.getBoundingClientRect(); return b.width>0 && (b.right>rb.right+1 || b.left<rb.left-1);}).length;
    return {text:r.innerText.replace(/\s+/g,' ').trim().slice(0,160), row:rect(r), tracker:t?rect(t):null, bar:bar?rect(bar):null, barLabel:bar?bar.getAttribute('aria-label'):null,
      title:title?rect(title):null, titleLines:title?Math.round(title.getBoundingClientRect().height/parseFloat(getComputedStyle(title).lineHeight)):null,
      scrollOverflow:r.scrollWidth>r.clientWidth+1, overflowing};
  });
  return {rows:out, card:rect(card), doc:[document.documentElement.scrollWidth, window.innerWidth], count:allRows.length};
}"""
w, h, k = cfg['vp']
out = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    mob = w < 800
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if mob else 1, is_mobile=mob, has_touch=mob, timezone_id='Asia/Kolkata', locale='en-IN')
    sess = {'session': {'access_token': 'tok-' + cfg['roll'], 'refresh_token': 'r', 'expires_in': 36000}, 'profile': cfg['profile'], 'storedAt': int(time.time() * 1000)}
    ctx.add_init_script("localStorage.setItem('campus_auth_session', %s);" % json.dumps(json.dumps(sess)))
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(cfg['base'] + '/', wait_until='networkidle'); time.sleep(3.5)
    if k != 1.0: pg.evaluate(SCALE_JS, k); time.sleep(0.4)
    pg.evaluate("()=>{const h=[...document.querySelectorAll('h2')].find(h=>/Live Action/.test(h.textContent)); if(h) h.scrollIntoView();}"); time.sleep(0.6)
    m = pg.evaluate(MEASURE_JS)
    out.update(m); out['errors'] = errs[:6]; out['k'] = k
    if cfg.get('shots'):
        pg.set_viewport_size({'width': w, 'height': 3400 if mob else 1100}); time.sleep(0.5)
        # full-page clip of the feed card only (no browser chrome)
        card = pg.evaluate("()=>{const h=[...document.querySelectorAll('h2')].find(h=>/Live Action/.test(h.textContent));const c=h.closest('.rounded-2xl');c.scrollIntoView();return true}")
        el = pg.locator('xpath=//h2[contains(.,"Live Action")]/ancestor::div[contains(@class,"rounded-2xl")][1]')
        el.screenshot(path=os.path.join(cfg['shots'], cfg.get('shotName', 'history_%d' % w) + '.png'))
    ctx.close(); b.close()
print(json.dumps(out))
