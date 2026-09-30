#!/usr/bin/env python3
"""Actual PulseDeck renderer in Chromium; deterministic mock provider/IPC fixtures.
Screenshots verify layout, not live provider reachability or Windows installation.
"""
import importlib.util,json,shutil,traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results'/'2.9.0';OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('base',ROOT/'tests/browser-regression.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
checks=[]
def check(name,ok,detail=None):
 checks.append({'name':name,'passed':bool(ok),**({'detail':detail} if detail is not None else {})});print(('PASS ' if ok else 'FAIL ')+name,flush=True)
 if not ok:raise AssertionError(name+': '+str(detail))
def page(browser,size=(1440,1000),theme='ocean'):
 p=browser.new_page(viewport={'width':size[0],'height':size[1]},bypass_csp=True);p.set_default_timeout(9000);p._errors=[];p.on('pageerror',lambda e:p._errors.append(str(e)))
 bridge=(ROOT/'tests/browser-bridge.js').read_text()+(ROOT/'tests/search-browser-bridge.js').read_text()
 store="window.__storage={};Object.defineProperty(window,'localStorage',{value:{getItem:k=>__storage[k]||null,setItem:(k,v)=>__storage[k]=v},configurable:true});"
 seed='__mock.settings.theme='+json.dumps(theme)+';'
 html=(ROOT/'app/renderer/index.html').read_text().replace('<head>',f'<head><base href="{base.BASE}/app/renderer/"><script>'+store+bridge+seed+'</script>',1)
 html=html.replace('<script src="app.js"></script>',"<script>const Search=PulseOnlineSearchUI;window.PulseOnlineSearchUI=class extends Search{constructor(...a){super(...a);window.__search=this;}};</script><script src=\"app.js\"></script>")
 p.set_content(html);p.wait_for_selector('#library [data-track-root]');p.wait_for_function('window.__search && __search.discovery');return p

def settled(p):
 p.wait_for_function('__search.sources.size>0 && ![...__search.sources.values()].some(s=>s.loading)');p.wait_for_timeout(180)
def query(p,q='Тихий свет'):
 p.fill('#searchInput',q);p.wait_for_timeout(360);settled(p)
def count(p):return p.locator('#onlineResults [data-online-item]').count()
def calls(p):return p.evaluate('__searchMock.calls.filter(c=>c.type==="page").length')
def source_order(p):return p.evaluate('__search.prefs.order')
def noerrors(p):check('No uncaught JavaScript errors',not p._errors,p._errors)

def federated(browser):
 p=page(browser);p.focus('#searchInput');check('Focusing the main field opens the anchored dialog',p.locator('#searchPopover').is_visible())
 check('Empty query sends no provider requests',calls(p)==0)
 check('Recommendations require opt-in',p.locator('[data-discovery-enable]').is_visible() and not p.evaluate('__search.discovery.enabled'))
 check('Six enabled source controls; Music first',p.locator('[data-source-toggle][aria-pressed=true]').count()==6 and source_order(p)[0]=='ytmusic')
 p.fill('#searchInput','Ти');p.wait_for_timeout(110);p.fill('#searchInput','Тихий');p.wait_for_timeout(100);p.fill('#searchInput','Тихий свет')
 p.wait_for_timeout(140);check('Debounce does not dispatch each keystroke',calls(p)==0);p.wait_for_timeout(250);settled(p)
 check('One query automatically dispatched to all enabled sources',p.evaluate('new Set(__searchMock.calls.filter(c=>c.type==="page").map(c=>c.provider)).size')==6)
 check('A failed source does not erase successful sources',count(p)>40 and p.locator('.search-error-toggle').is_visible() and not p.locator('[data-source-retry=newgrounds]').is_visible())
 check('Music is preferred for canonical duplicates',p.locator('[data-result-key="youtube:fixture0000"]').get_attribute('data-provider')=='ytmusic')
 check('Exact result leads the relevance list',p.locator('#onlineResults .online-copy>strong').first.inner_text()=='Тихий свет')
 check('Local library matches appear above web results',p.locator('[data-local-play=t0]').is_visible())
 check('Confirmed DRM is hidden',p.locator('[data-result-key="youtube:fixture0002"]').count()==0)
 check('HTTP 403 is not marked DRM or discarded',p.locator('[data-result-key="youtube:fixture0000"] .search-availability').get_attribute('data-state')=='unknown')
 check('Only two visible availability probes run simultaneously',p.evaluate('__searchMock.maxProbes')<=2)
 first=p.locator('#onlineResults [data-online-item]').first.bounding_box();last=p.locator('#searchPopover').bounding_box();check('Floating panel is anchored below main input and stays in viewport',last['y']>=p.locator('#searchInput').bounding_box()['y'] and last['y']+last['height']<=1000)
 p.evaluate('window.__savedWorkspace=__search.workspace;window.__savedResult=document.querySelector("[data-result-key=\\"youtube:fixture0000\\"]")')
 p.screenshot(path=str(OUT/'290-floating-fixtures.png'))
 p.click('.search-expand');check('Expand moves the same workspace, not a second search',p.evaluate('__savedWorkspace===document.querySelector("#onlineModal #searchWorkspace")') and not p.locator('#searchPopover').is_visible())
 check('Expanded dialog retains result DOM identity',p.evaluate('__savedResult===document.querySelector("[data-result-key=\\"youtube:fixture0000\\"]")'))
 before=calls(p);p.click('[data-source-toggle=soundcloud]');check('Disable source immediately removes its results',p.locator('#onlineResults [data-provider=soundcloud]').count()==0)
 p.click('[data-source-toggle=soundcloud]');check('Re-enable restores cached results without new search',p.locator('#onlineResults [data-provider=soundcloud]').count()>0 and calls(p)==before)
 p.locator('[data-source-drag=youtube]').focus();p.keyboard.press('Home');p.wait_for_function("__search.prefs.order[0]==='youtube'");p.wait_for_function("[...document.querySelectorAll('.search-source')].every(n=>n.getAnimations().every(a=>a.playState!=='running'))")
 check('Keyboard reordering changes priority and selected duplicate',source_order(p)[0]=='youtube' and p.locator('[data-result-key="youtube:fixture0000"]').get_attribute('data-provider')=='youtube')
 check('Priority changes persist without extra provider requests',p.evaluate('__mock.settings.onlineSearch.order[0]')=='youtube' and calls(p)==before)
 a=p.locator('[data-source-drag=ytmusic]').bounding_box();b=p.locator('[data-source=youtube]').bounding_box();p.mouse.move(a['x']+a['width']/2,a['y']+a['height']/2);p.mouse.down()
 try:
  # One decisive move avoids feeding interpolated coordinates back into a rail that reorders beneath the pointer.
  p.mouse.move(b['x']+2,a['y']+a['height']/2);p.wait_for_function("__search.prefs.order[0]==='ytmusic'")
 finally:p.mouse.up()
 check('Horizontal pointer drag restores Music-first priority',source_order(p)[0]=='ytmusic')
 p.evaluate('delete __searchMock.fail.newgrounds');p.click('.search-error-toggle');p.click('[data-source-retry=newgrounds]');settled(p)
 check('Retry affects only the failed source',p.locator('#onlineResults [data-provider=newgrounds]').count()>0 and calls(p)==before+1)
 p.uncheck('.search-availability-toggle input');check('Show unavailable reveals disabled DRM result',p.locator('[data-result-key="youtube:fixture0002"] .online-download').is_disabled())
 p.check('.search-availability-toggle input')
 p.click('.search-filter-toggle');p.select_option('[data-search-filter=version]','live');p.wait_for_timeout(400)
 check('Version filter leaves only live variants',count(p)>0 and all('Live' in s for s in p.locator('#onlineResults .online-copy>strong').all_text_contents()))
 p.screenshot(path=str(OUT/'290-expanded-filters-fixtures.png'))
 p.click('[data-clear-filters]');p.wait_for_timeout(400);p.keyboard.press('Escape');before=count(p)
 p.locator('.search-scroll').evaluate('e=>e.scrollTop=e.scrollHeight');p.wait_for_timeout(450)
 check('Scrolling loads further pages without Search button',count(p)>before)
 check('Pagination does not repeat canonical results',p.locator('#onlineResults [data-result-key]').evaluate_all('ns=>new Set(ns.map(n=>n.dataset.resultKey)).size===ns.length'))
 p.locator('.search-scroll').evaluate('e=>e.scrollTop=480');anchor=p.locator('#onlineResults [data-result-key]').evaluate_all('ns=>ns.find(n=>n.getBoundingClientRect().bottom>document.querySelector(".search-scroll").getBoundingClientRect().top)?.dataset.resultKey');p.evaluate('__search.render()')
 check('Background render preserves the scrolled anchor',anchor==p.locator('#onlineResults [data-result-key]').evaluate_all('ns=>ns.find(n=>n.getBoundingClientRect().bottom>document.querySelector(".search-scroll").getBoundingClientRect().top)?.dataset.resultKey'))
 p.locator('.search-scroll').evaluate('e=>e.scrollTop=0');p.locator('#onlineResults .online-preview-btn').first.click();p.wait_for_timeout(180)
 check('Preview works from a shared search result',p.locator('#onlinePreviewBar').is_visible())
 p.click('.search-compact');p.wait_for_timeout(100)
 check('Compact transition preserves preview and the same workspace',p.locator('#searchPopover').is_visible() and p.locator('#onlinePreviewBar').is_visible() and p.evaluate('__savedWorkspace===document.querySelector("#searchPopover #searchWorkspace")'))
 p.keyboard.press('Escape');check('Escape closes the popover without immediately reopening it',not p.locator('#searchPopover').is_visible() and p.locator('#searchInput').evaluate('e=>document.activeElement===e'))
 check('Closing search stops preview',not p.locator('#onlinePreviewBar').is_visible())
 check('Closing search clears queued availability probes',p.evaluate('__search.probeQueue.length')==0)
 noerrors(p);p.close()

def typing_and_privacy(browser):
 p=page(browser);p.evaluate('__searchMock.fail={};__searchMock.maxPage=1');p.focus('#searchInput')
 p.locator('#searchInput').dispatch_event('compositionstart');p.fill('#searchInput','日本');p.wait_for_timeout(420);check('IME composition never sends an unfinished query',calls(p)==0)
 p.locator('#searchInput').dispatch_event('compositionend');p.wait_for_timeout(450);settled(p);check('IME completion dispatches the final query',calls(p)==6)
 p.fill('#searchInput','старый запрос');p.wait_for_timeout(340);p.fill('#searchInput','новый запрос');p.wait_for_timeout(750);settled(p)
 check('Late old responses never overwrite the latest query',all('новый запрос' in s for s in p.locator('#onlineResults .online-copy>strong').all_text_contents()))
 check('Superseded searches send cancellation commands',p.evaluate('__searchMock.calls.some(c=>c.type==="cancel")'))
 p.uncheck('.search-auto input');before=calls(p);p.fill('#searchInput','ручной поиск');p.wait_for_timeout(500);check('Auto-search can be disabled',calls(p)==before)
 p.press('#searchInput','Enter');settled(p);check('Enter searches immediately in manual mode',calls(p)==before+6)
 p.fill('#searchInput','');p.wait_for_timeout(80);check('Empty query clears stale results and restores discovery',count(p)==0 and p.locator('.search-discovery').is_visible())
 p.evaluate("__searchMock.history.items=[{track:{...__mock.tracks[0],id:'t1',rel:__mock.tracks[1].rel,title:'Другая волна'},reason:'DiscoveryBecauseArtist',value:'Маяк'}];__searchMock.history.count=2")
 before=calls(p);p.click('[data-discovery-enable]');p.wait_for_timeout(100)
 check('Opt-in exposes local recommendations with reasons',p.locator('.search-discovery-row').count()==1 and 'Маяк' in p.locator('.search-discovery-copy small').inner_text())
 check('Recommendation refresh does not send listening data to providers',calls(p)==before)
 p.screenshot(path=str(OUT/'290-local-recommendations-fixtures.png'))
 p.click('[data-discovery-search]');p.wait_for_timeout(150);settled(p);check('More by artist searches the query without implicitly filling filters',p.evaluate('__search.query')=='Маяк' and p.evaluate('__search.filters.artist ?? ""')=='' and calls(p)==before+6)
 p.evaluate('__search.filters={};__search.setQuery("")');p.wait_for_timeout(150);p.click('[data-discovery-clear]');p.wait_for_timeout(100)
 check('Clear removes local history and recommendation cards',p.evaluate('__search.discovery.count')==0 and p.locator('.search-discovery-row').count()==0)
 p.click('[data-discovery-enable]');p.wait_for_timeout(100);check('History collection can be paused',not p.evaluate('__search.discovery.enabled'))
 p.check('.search-auto input');query(p,'<img src=x onerror="window.__xss=1">')
 check('Hostile metadata stays text, not executable HTML',not p.evaluate('!!window.__xss') and p.locator('.online-copy img').count()==0)
 p.fill('#searchInput','');p.wait_for_timeout(50);p.mouse.click(30,400);check('Outside pointer closes the floating panel',not p.locator('#searchPopover').is_visible())
 noerrors(p);p.close()

def responsive(browser):
 for size,theme,lang in [((800,600),'sand','ru'),((1024,768),'ocean','en')]:
  p=page(browser,size,theme);p.evaluate('__searchMock.fail={};__searchMock.maxPage=1');query(p)
  if lang=='en':p.evaluate("pulse.i18n.setLanguage('en')");p.wait_for_timeout(100)
  check(f'Anchored panel fits {size[0]}x{size[1]}',p.locator('#searchPopover').evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&e.scrollWidth<=e.clientWidth+1}'))
  check(f'Results remain scrollable at {size[0]}',p.locator('.search-scroll').evaluate('e=>e.clientHeight>=100&&e.scrollHeight>e.clientHeight'))
  check(f'Source strip exposes horizontal overflow at {size[0]}',p.locator('.search-sources').evaluate('e=>e.scrollWidth>e.clientWidth'))
  if lang=='en':check('Search accessibility labels relocalize',p.locator('#searchPopover').get_attribute('aria-label')=='Music search' and 'Источники' not in p.locator('.search-sources').get_attribute('aria-label'))
  p.screenshot(path=str(OUT/f'290-{theme}-{size[0]}-{lang}-fixtures.png'));noerrors(p);p.close()

if __name__=='__main__':
 failed=False
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  for fn in [federated,typing_and_privacy,responsive]:
   try:fn(b)
   except Exception as e:failed=True;traceback.print_exc();checks.append({'name':fn.__name__+' suite completion','passed':False,'detail':str(e)})
  b.close()
 base.server.shutdown();(OUT/'browser-search-290.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n');print(sum(c['passed'] for c in checks),'passed',sum(not c['passed'] for c in checks),'failed');raise SystemExit(int(failed))
