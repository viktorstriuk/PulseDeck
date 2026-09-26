#!/usr/bin/env python3
"""Real renderer + deterministic IPC/audio fixtures. Not a live-service/Windows test."""
import importlib.util,json,traceback,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1];OUT=R/'test-results/2.9.1';OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('base291',R/'tests/browser-regression.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
checks=[]
def check(name,ok,detail=None):
 checks.append({'name':name,'passed':bool(ok),'detail':detail});print(('PASS ' if ok else 'FAIL ')+name,flush=True)
 if not ok:raise AssertionError((name,detail))
def page(browser,size=(1280,900),theme='ocean',language='ru'):
 p=browser.new_page(viewport={'width':size[0],'height':size[1]},bypass_csp=True);p.set_default_timeout(10000);p._errors=[];p.on('pageerror',lambda e:p._errors.append(str(e)))
 bridge=(R/'tests/browser-bridge.js').read_text()+(R/'tests/search-browser-bridge.js').read_text()
 seed='Object.assign(__mock.settings,'+json.dumps({'theme':theme,'accent':'gold','volume':.37,'language':language})+');'
 extra="""pulse.components.check=async()=>{__mock.calls.push({name:'components:check'});return {phase:'current',source:'publishers',directory:'D:\\\\PulseDeck\\\\components',items:[{id:'ffmpeg',installed:true,version:'9.0.2'},{id:'ytdlp',installed:true,version:'2026.08.19'}]}};"""
 store="Object.defineProperty(window,'localStorage',{value:{getItem:()=>null,setItem(){}},configurable:true});"
 html=(R/'app/renderer/index.html').read_text().replace('<head>',f'<head><base href="{base.BASE}/app/renderer/"><script>'+store+bridge+seed+extra+'</script>',1)
 html=html.replace('<script src="app.js"></script>',"<script>const Search=PulseOnlineSearchUI;window.PulseOnlineSearchUI=class extends Search{constructor(...a){super(...a);window.__search=this;}};</script><script src=\"app.js\"></script>")
 p.set_content(html);p.wait_for_selector('#library [data-track-root]');p.wait_for_function('window.__search && __search.discovery');return p
def settled(p):
 p.wait_for_function('__search.sources.size>0 && ![...__search.sources.values()].some(x=>x.loading)');p.wait_for_timeout(220)
def shot(p,name):p.screenshot(path=str(OUT/(name+'.png')))
def errors(p):check('No uncaught renderer errors',not p._errors,p._errors)
def search_controls(browser):
 p=page(browser);p.click('#searchInput');p.keyboard.type('The Kid Laroi ',delay=38);p.wait_for_timeout(500);settled(p)
 check('Real keyboard input retains internal and trailing spaces',p.input_value('#searchInput')=='The Kid Laroi ')
 p.keyboard.type('live',delay=40);p.wait_for_timeout(500);settled(p)
 check('Next word can be typed after debounce',p.input_value('#searchInput')=='The Kid Laroi live')
 p.press('#searchInput','Home');p.press('#searchInput','ArrowRight');p.keyboard.type(' X ',delay=30)
 check('Mid-string editing retains caret and typed spaces',p.input_value('#searchInput')=='T X he Kid Laroi live' and p.locator('#searchInput').evaluate('e=>e.selectionStart')==4)
 p.fill('#searchInput','The Kid Laroi');p.wait_for_timeout(500);settled(p)
 check('Source instructions and legal footer no longer take result space',p.locator('.search-source-hint,.search-footer').count()==0)
 check('All sources have vector icons',p.locator('.search-source-icon svg').count()==6)
 check('Source errors do not produce dashed borders',p.locator('.search-source').evaluate_all('ns=>ns.every(n=>getComputedStyle(n).borderStyle!=="dashed"&&!n.classList.contains("failed"))'))
 check('Source scrollbar is hidden while overflow remains scrollable',p.locator('.search-sources').evaluate('e=>getComputedStyle(e).scrollbarWidth==="none"&&e.scrollWidth>e.clientWidth'))
 check('Toolbar actions are icons with accessible names',p.locator('.search-toolbar .search-icon-button').evaluate_all('ns=>ns.every(n=>n.querySelector("svg")&&n.title&&n.getAttribute("aria-label")&&!n.textContent.trim())'))
 p.evaluate('window.__sourceNode=document.querySelector("[data-source=youtube]")');p.click('[data-source-toggle=youtube]');p.wait_for_timeout(60)
 check('Toggle keeps the actual chip DOM node for animation',p.evaluate('__sourceNode===document.querySelector("[data-source=youtube]")'))
 check('Disabled chip exposes pressed=false',p.get_attribute('[data-source-toggle=youtube]','aria-pressed')=='false')
 check('Toggle has a nonzero transition',p.locator('[data-source=youtube]').evaluate('e=>getComputedStyle(e).transitionDuration.split(",").some(x=>parseFloat(x)>0)'))
 p.click('[data-source-toggle=youtube]');p.wait_for_timeout(220)
 rail=p.locator('.search-sources');rail.hover();p.mouse.wheel(0,220);p.wait_for_timeout(100)
 check('Mouse wheel scrolls the source strip horizontally',rail.evaluate('e=>e.scrollLeft')>0)
 before=p.evaluate('JSON.stringify(__search.prefs.enabled)');r=rail.bounding_box();p.mouse.move(r['x']+r['width']/2,r['y']+r['height']/2);p.mouse.down();p.mouse.move(r['x']+r['width']/2+120,r['y']+r['height']/2,steps=8);p.mouse.up();p.wait_for_timeout(280)
 check('Dragging the strip does not accidentally toggle a source',before==p.evaluate('JSON.stringify(__search.prefs.enabled)'))
 check('Pointer completion clears the drag controller',p.evaluate('__search.dragController===null'))
 rail.evaluate('e=>e.scrollLeft=0')
 check('Errors are collapsed initially behind the more button',p.locator('.search-error-toggle').is_visible() and not p.locator('#searchErrorsPanel').is_visible())
 p.click('.search-error-toggle');check('More button reveals source errors and retry',p.locator('#searchErrorsPanel').is_visible() and p.locator('[data-source-retry=newgrounds]').is_visible())
 shot(p,'291-source-details-fixtures');p.keyboard.press('Escape')
 check('Escape closes details, not the whole search',not p.locator('#searchErrorsPanel').is_visible() and p.locator('#searchPopover').is_visible())
 box=p.locator('.search-scroll').bounding_box();p.click('.search-filter-toggle');p.wait_for_timeout(210)
 check('Filters are a separate top-layer popup',p.locator('#searchFiltersPanel').is_visible() and p.locator('#searchFiltersPanel').evaluate('e=>e.matches(":popover-open")&&e.parentElement===document.body'))
 check('Opening filters does not shrink or move search results',p.locator('.search-scroll').bounding_box()==box)
 check('Filter fields have visible borders and useful heights',p.locator('#searchFiltersPanel input').evaluate_all('ns=>ns.every(n=>n.getBoundingClientRect().height>=34&&parseFloat(getComputedStyle(n).borderWidth)>=1)'))
 p.locator('[data-search-filter=artist]').press_sequentially('Тёмный принц',delay=35);check('Spaces also work in filter fields',p.input_value('[data-search-filter=artist]')=='Тёмный принц')
 shot(p,'291-filters-fixtures');p.click('[data-clear-filters]');p.keyboard.press('Escape');p.wait_for_timeout(500);settled(p)
 check('Escape restores focus to the filter button',p.locator('.search-filter-toggle').evaluate('e=>document.activeElement===e'))
 p.click('.search-expand');p.fill('#onlineSearchInput','');p.locator('#onlineSearchInput').press_sequentially('Тёмный принц ',delay=30);p.wait_for_timeout(500);settled(p)
 check('Expanded input keeps typed spaces too',p.input_value('#onlineSearchInput')=='Тёмный принц ')
 p.click('.search-filter-toggle');p.wait_for_timeout(220);shot(p,'291-expanded-filters-fixtures');p.keyboard.press('Escape');p.click('.search-compact')
 p.locator('#onlineResults .online-preview-btn').first.click();p.wait_for_timeout(200)
 check('Preview inherits the main application volume',p.evaluate('document.querySelector("#audio").volume===.37&&document.querySelector("#onlinePreviewAudio").volume===.37'))
 check('Preview bar stays a single compact row',p.locator('#onlinePreviewBar').evaluate('e=>{const b=e.getBoundingClientRect(),x=e.querySelector("#onlinePreviewClose").getBoundingClientRect();return b.height<70&&Math.abs(x.y+x.height/2-b.y-b.height/2)<2}'))
 check('Preview mute button is visible beside the timer',p.locator('#onlinePreviewMute').is_visible() and p.locator('#onlinePreviewMute').evaluate('e=>e.previousElementSibling.classList.contains("online-preview-time")'))
 p.click('#onlinePreviewMute');p.wait_for_timeout(40)
 check('Preview mute sets both audio volumes to zero',p.evaluate('document.querySelector("#audio").volume===0&&document.querySelector("#onlinePreviewAudio").volume===0'))
 check('Muted button has a localized Unmute name',p.locator('#onlinePreviewMute').get_attribute('aria-pressed')=='true' and 'Включить' in p.locator('#onlinePreviewMute').get_attribute('aria-label'))
 p.click('#onlinePreviewMute');p.wait_for_timeout(40);check('Unmute restores the previous shared level',p.evaluate('document.querySelector("#audio").volume===.37&&document.querySelector("#onlinePreviewAudio").volume===.37'))
 p.locator('#volume').evaluate('e=>{e.value=23;e.dispatchEvent(new Event("input",{bubbles:true}))}');p.wait_for_timeout(30)
 check('Changing the main slider immediately affects preview',p.evaluate('document.querySelector("#onlinePreviewAudio").volume===.23'))
 p.click('.search-expand');p.click('#onlinePreviewMute');p.click('.search-compact');check('Mute state survives expanded/compact transition',p.get_attribute('#onlinePreviewMute','aria-pressed')=='true')
 p.click('#onlinePreviewMute');shot(p,'291-floating-fixtures')
 p.emulate_media(reduced_motion='reduce');check('Reduced motion disables chip transitions',p.locator('.search-source').first.evaluate('e=>getComputedStyle(e).transitionDuration.split(",").every(x=>parseFloat(x)<=.001)'))
 p.click('.search-filter-toggle');check('Reduced motion disables popup animation',p.locator('#searchFiltersPanel').evaluate('e=>getComputedStyle(e).animationName==="none"'));p.keyboard.press('Escape');p.keyboard.press('Escape');errors(p);p.close()
def settings_and_empty(browser):
 for size,theme,lang in [((1280,900),'ocean','ru'),((800,600),'sand','ru'),((1024,768),'light','en')]:
  p=page(browser,size,theme,lang);p.click('#settingsBtn');p.click('[data-settings-page=appearance]');p.locator('#surfaceSettings').scroll_into_view_if_needed();p.wait_for_timeout(100)
  header=p.locator('.settings-header').bounding_box()
  for i in range(6):p.locator('#surfaceApplyAll').set_checked(i%2==0);p.wait_for_timeout(50)
  geometry=p.evaluate('''()=>{const shell=document.querySelector('.settings-hub'),layout=document.querySelector('.settings-layout'),page=document.querySelector('.settings-page.active');return {shellScroll:shell.scrollTop,layoutBottom:layout.getBoundingClientRect().bottom,shellBottom:shell.getBoundingClientRect().bottom,pageBottom:page.getBoundingClientRect().bottom,headTop:document.querySelector('.settings-header').getBoundingClientRect().top}}''')
  check(f'Settings shell stays stationary after repeated switches ({size[0]})',geometry['shellScroll']==0 and abs(geometry['headTop']-header['y'])<1,geometry)
  check(f'Settings content fills remaining window, no blank bottom ({size[0]})',abs(geometry['layoutBottom']-geometry['shellBottom'])<3 and abs(geometry['pageBottom']-geometry['layoutBottom'])<3,geometry)
  check(f'Switch and label are vertically centered ({size[0]})',p.locator('.surface-all-row').evaluate('e=>{const a=e.querySelector("span").getBoundingClientRect(),b=e.querySelector("strong").getBoundingClientRect();return Math.abs(a.y+a.height/2-b.y-b.height/2)<2}'))
  shot(p,f'291-settings-{size[0]}-{lang}');p.click('[data-settings-page=updates]');p.wait_for_timeout(120)
  p.locator('#componentsCheck').scroll_into_view_if_needed();p.click('#componentsCheck');p.wait_for_timeout(120)
  check(f'Component check works while app repository is unconfigured ({size[0]})',p.get_attribute('#updatesStatusCard','data-phase')=='unconfigured' and p.evaluate('__mock.calls.some(x=>x.name==="components:check")') and '9.0.2' in p.locator('[data-component=ffmpeg]').inner_text())
  check(f'Components panel displays its application directory ({size[0]})','PulseDeck' in p.locator('#componentsDirectory').inner_text())
  if size[0]==1280:shot(p,'291-component-updates-fixtures')
  p.click('[data-close=settingsModal]');p.click('#searchInput');p.keyboard.type('No local matching music',delay=15);p.wait_for_timeout(500);p.keyboard.press('Escape')
  check(f'Empty library has one unified search action ({size[0]})',p.locator('.online-fallback [data-search-online=all]').count()==1 and p.locator('.online-fallback button').count()==1)
  check(f'No square behind empty-result button ({size[0]})',p.locator('.online-fallback').evaluate('e=>{const s=getComputedStyle(e);return s.backgroundColor==="rgba(0, 0, 0, 0)"&&parseFloat(s.borderWidth)===0&&s.height!=="54px"}'))
  if size[0]==1280:shot(p,'291-empty-library-fixtures')
  p.click('[data-search-online=all]');p.wait_for_timeout(150)
  check(f'Unified action opens the common search ({size[0]})',p.locator('#onlineModal').is_visible() and p.locator('[data-source-toggle][aria-pressed=true]').count()==6)
  p.click('.search-filter-toggle');p.wait_for_timeout(220);r=p.locator('#searchFiltersPanel').bounding_box()
  check(f'Floating filter panel fits compact viewport ({size[0]})',r['x']>=0 and r['y']>=0 and r['x']+r['width']<=size[0]+1 and r['y']+r['height']<=size[1]+1,r)
  shot(p,f'291-filters-{size[0]}-{lang}');errors(p);p.close()
if __name__=='__main__':
 failure=None
 try:
  with sync_playwright() as pw:
   b=pw.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--disable-dev-shm-usage']);search_controls(b);settings_and_empty(b);b.close()
 except Exception as e:failure=str(e);traceback.print_exc()
 finally:
  (OUT/'browser-polish-291.json').write_text(json.dumps({'checks':checks,'failure':failure},ensure_ascii=False,indent=2));base.server.shutdown()
 if failure:raise SystemExit(1)
