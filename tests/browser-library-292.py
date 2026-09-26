#!/usr/bin/env python3
"""Actual renderer in Chromium, isolated deterministic IPC. No live services."""
import importlib.util,json,traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1];OUT=R/'test-results/2.9.2';OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('base292',R/'tests/browser-regression.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
checks=[]
def check(name,ok,detail=None):
 checks.append({'name':name,'passed':bool(ok),'detail':detail});print(('PASS ' if ok else 'FAIL ')+name,flush=True)
 if not ok:raise AssertionError((name,detail))
def page(browser,size=(1280,900),theme='ocean',lang='ru'):
 p=browser.new_page(viewport={'width':size[0],'height':size[1]},bypass_csp=True);p.set_default_timeout(8000);p._errors=[];p.on('pageerror',lambda e:p._errors.append(str(e)))
 bridge='\n'.join((R/('tests/'+n)).read_text() for n in ['browser-bridge.js','search-browser-bridge.js','library-browser-bridge.js'])
 storage="Object.defineProperty(window,'localStorage',{value:{getItem:()=>null,setItem(){}},configurable:true});"
 seed='Object.assign(__mock.settings,'+json.dumps({'theme':theme,'accent':'gold','language':lang})+');'
 html=(R/'app/renderer/index.html').read_text().replace('<head>',f'<head><base href="{base.BASE}/app/renderer/"><script>'+storage+bridge+seed+'</script>',1)
 capture="<script>for(const [key,field]of [['PulseTrackTools','__tools'],['PulseOnlineSearchUI','__search']]){const Base=window[key];window[key]=class extends Base{constructor(...args){super(...args);window[field]=this;}};}</script>"
 html=html.replace('<script src="app.js"></script>',capture+'<script src="app.js"></script>')
 p.set_content(html);p.wait_for_selector('#library [data-track-root][data-id=t0]');p.wait_for_function('window.__tools && window.__search');return p

def trackmenu(p):
 p.locator('#library [data-track-root][data-id=t0]').click(button='right');p.locator('[data-submenu-trigger=track-edit]').hover();p.wait_for_timeout(110)
def open_cover(p):
 trackmenu(p);p.locator('[data-track-cover]').click();p.wait_for_selector('.cover-grid .cover-tile');p.wait_for_timeout(100)
def errors(p):check('No uncaught renderer errors',not p._errors,p._errors)
def screenshot(p,name):p.screenshot(path=str(OUT/(name+'.png')))

def editing(browser):
 p=page(browser);trackmenu(p)
 check('Track hover opens editing submenu',p.locator('[data-track-edit=artist]').is_visible())
 p.locator('[data-track-cover]').hover();p.wait_for_timeout(100)
 check('Artwork picker never opens or searches on hover',p.locator('.track-cover-picker').count()==0 and p.evaluate('__toolsMock.calls.every(c=>c.type!=="cover-search")'))
 p.locator('[data-track-edit=artist]').click();p.wait_for_selector('.track-rename input')
 p.fill('.track-rename input','Маяк и друзья');p.press('.track-rename input','Enter');p.wait_for_selector('.track-rename',state='detached')
 check('Artist edit persists in the actual library rendering',p.evaluate('__mock.tracks[0].artist')=='Маяк и друзья' and 'Маяк и друзья' in p.locator('#library [data-track-root][data-id=t0]').inner_text())
 trackmenu(p);p.locator('[data-track-edit=title]').click();p.fill('.track-rename input','Тихий свет');p.press('.track-rename input','Enter');p.wait_for_selector('.track-rename',state='detached')
 check('Title edit is independent of artist',p.evaluate('__mock.tracks[0].title')=='Тихий свет' and p.evaluate('__mock.tracks[0].artist')=='Маяк и друзья')
 open_cover(p)
 check('Click opens adjacent cover picker in the top layer',p.locator('.track-cover-picker').evaluate('e=>e.matches(":popover-open")'))
 check('Music sources are searched before cover catalog',p.evaluate('__toolsMock.calls.filter(c=>c.type==="cover-search").map(c=>c.phase).join(",")')=='music,catalog')
 check('Cover results use four columns and no permanent text labels',p.locator('.cover-grid').evaluate('e=>getComputedStyle(e).gridTemplateColumns.split(" ").length===4&&[...e.children].every(b=>!b.textContent.trim())'))
 p.locator('[data-cover-id=music-2]').click();p.wait_for_function('document.querySelector("[data-cover-id=music-2]")?.classList.contains("selected")')
 check('One click saves cover and marks it with accent outline and supplied SVG',p.locator('.cover-tile.selected').count()==1 and p.locator('.cover-tile.selected').get_attribute('aria-pressed')=='true' and p.locator('.cover-selected-mark').first.evaluate('e=>getComputedStyle(e,"::after").maskImage.includes("cover-selected.svg")'))
 check('Picker stays open after selecting a cover',p.locator('.track-cover-picker').is_visible())
 check('Artwork change is reflected on the track',bool(p.evaluate('__mock.tracks[0].coverUrl')))
 screenshot(p,'292-cover-picker-fixtures')
 p.fill('.cover-search-row input','slow old query');p.wait_for_timeout(360);p.fill('.cover-search-row input','Новый запрос');p.wait_for_timeout(600)
 check('New artwork query replaces old requests without losing selected tile',p.evaluate('__tools.popup.query')=='Новый запрос' and p.locator('.cover-tile.selected').count()==1)
 p.press('.cover-search-row input','Escape');check('Escape closes only the adjacent picker',p.locator('.track-cover-picker').count()==0)
 errors(p);p.close()

def playlists(browser):
 p=page(browser)
 def menu(counts):
  p.evaluate('(counts)=>__toolsMock.cap=counts',counts)
  p.locator('#categoryChips [data-category="custom:0"]').first.click(button='right');p.wait_for_timeout(120)
 menu({'artists':1,'covers':3,'lyrics':4})
 check('Multiple eligible actions are grouped in More',p.locator('[data-submenu-trigger=enrich]').is_visible())
 p.locator('[data-submenu-trigger=enrich]').hover();p.wait_for_timeout(80)
 check('All three eligible batch actions are exposed',p.locator('[data-enrich-action]').count()==3)
 screenshot(p,'292-playlist-actions-fixtures')
 p.locator('[data-enrich-action=artists]').click();p.wait_for_selector('#libraryImportDialog[open]')
 check('Batch action requests confirmation before starting',not p.evaluate('__toolsMock.calls.some(c=>c.type==="batch-start")'))
 p.locator('#libraryImportDialog .import-actions .primary').click();p.wait_for_function('__tools.importState?.phase==="complete"')
 check('Local-only artist inference does not grant network consent',p.evaluate('__toolsMock.calls.find(c=>c.type==="batch-start").consent') is False)
 p.locator('#libraryImportDialog .library-import-heading button').click()
 menu({'artists':0,'covers':2,'lyrics':0})
 check('A single eligible action is flattened into playlist menu',p.locator('[data-submenu-trigger=enrich]').count()==0 and p.locator('[data-enrich-action=covers]').is_visible())
 p.keyboard.press('Escape');menu({'artists':0,'covers':0,'lyrics':0})
 check('No extra entry is shown when nothing needs enrichment',p.locator('[data-submenu-trigger=enrich],[data-enrich-action]').count()==0)
 errors(p);p.close()

def imports(browser):
 p=page(browser)
 p.evaluate('''()=>{const dt=new DataTransfer();dt.items.add(new File(['zip'],'Моя музыка.zip',{type:'application/zip'}));document.dispatchEvent(new DragEvent('dragenter',{dataTransfer:dt,bubbles:true,cancelable:true}));window.drop292=dt;}''')
 check('File drop overlay appears without changing the library',p.locator('.library-drop-overlay').is_visible() and not p.evaluate('__toolsMock.calls.some(c=>c.type==="batch-start")'))
 p.evaluate('document.dispatchEvent(new DragEvent("drop",{dataTransfer:drop292,bubbles:true,cancelable:true}))');p.wait_for_selector('#libraryImportDialog[open] .import-actions')
 check('Drop shows a count and music destination before copying','3' in p.locator('.import-question').inner_text() and 'music' in p.locator('.import-question').inner_text())
 check('Suggested enrichment is optional and off by default',p.locator('.import-option input').count()==3 and p.locator('.import-option input:checked').count()==0)
 check('Drop filenames reach the bridge and no download starts before confirmation',p.evaluate('__toolsMock.calls.find(c=>c.type==="prepare-drop").names[0]')=='Моя музыка.zip' and not p.evaluate('__toolsMock.calls.some(c=>c.type==="batch-start")'))
 p.check('input[name=enrichment][value=artists]');p.check('input[name=enrichment][value=covers]');screenshot(p,'292-import-confirm-fixtures')
 p.evaluate('pulse.i18n.setLanguage("en")');p.wait_for_timeout(150)
 check('Open import dialog relocalizes without losing selected actions','3 tracks' in p.locator('.import-question').inner_text() and p.locator('.import-option input:checked').count()==2)
 check('Hidden drop overlay relocalizes too','Drop to add' in p.locator('.library-drop-overlay strong').inner_text())
 p.evaluate('pulse.i18n.setLanguage("ru")');p.wait_for_timeout(150)
 p.evaluate('__toolsMock.jobDelay=500');p.locator('#libraryImportDialog .primary').click();p.wait_for_selector('.import-progress')
 p.locator('#libraryImportDialog>.button').click();p.wait_for_function('__tools.importState?.phase==="complete"')
 check('Stopping a job is explicit and remaining queue is cancelled',p.evaluate('__toolsMock.cancel') is True)
 check('Only selected enrichment actions are requested',p.evaluate('__toolsMock.calls.find(c=>c.type==="batch-start").actions.join(",")')=='artists,covers')
 check('Network consent is granted only alongside selected online actions',p.evaluate('__toolsMock.calls.find(c=>c.type==="batch-start").consent') is True)
 p.locator('#libraryImportDialog>.button').click();check('Completed dialog can be closed',not p.locator('#libraryImportDialog').is_visible())
 errors(p);p.close()

def link_search(browser):
 p=page(browser);url='https://www.youtube.com/watch?v=abcdefghijk';p.click('#searchInput');p.fill('#searchInput',url);p.wait_for_timeout(550)
 p.wait_for_function('__search.link?.item && [...__search.sources.values()].some(s=>s.items.length)')
 check('A link is resolved directly from the ordinary search field',p.evaluate('__searchMock.calls.some(c=>c.type==="resolve")'))
 check('Resolved track is pinned first and other sources get its identity',p.locator('#onlineResults .online-item').first.inner_text().startswith('Тихий свет') and p.evaluate('__searchMock.calls.filter(c=>c.type==="page").every(c=>c.query==="Маяк Тихий свет")'))
 check('No separate direct-link field or divider remains in DOM',p.locator('#urlInput,#urlDownloadBtn,.search-direct-import,.search-direct-divider').count()==0)
 check('Source results are available alongside the linked track',p.locator('#onlineResults .online-item').count()>1)
 p.locator('.search-filter-toggle').click();p.fill('[data-search-filter=album]','Альбом');p.wait_for_timeout(430)
 check('Filters do not lose the linked track or trigger a second resolution',p.evaluate('__search.link?.item?.title')=='Тихий свет' and p.evaluate('__searchMock.calls.filter(c=>c.type==="resolve").length')==1)
 p.keyboard.press('Escape');p.locator('.search-expand').click();p.wait_for_timeout(100)
 check('Expanded search retains the original URL',p.input_value('#onlineSearchInput')==url)
 screenshot(p,'292-link-search-fixtures')
 p.fill('#onlineSearchInput','https://www.youtube.com/watch?v=slowlink000');p.wait_for_timeout(345);p.fill('#onlineSearchInput','Совсем другой трек');p.wait_for_timeout(650)
 check('Delayed link result cannot replace a newer text search',p.evaluate('__search.link===null && __search.activeEffective.includes("Совсем другой трек")'))
 errors(p);p.close()

def layouts(browser):
 for size,theme,lang in [((800,600),'sand','ru'),((1024,768),'light','en'),((1440,900),'ocean','ru')]:
  p=page(browser,size,theme,lang);open_cover(p)
  check('Cover picker stays inside viewport '+str(size),p.locator('.track-cover-picker').evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}'))
  screenshot(p,'292-covers-'+theme+'-'+str(size[0])+'-'+lang)
  p.press('.cover-search-row input','Escape');p.evaluate('__tools.chooseFiles()');p.wait_for_selector('.import-actions')
  check('Import confirmation fits compact window '+str(size),p.locator('#libraryImportDialog').evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth}'))
  check('Checkbox label remains vertically aligned '+str(size),p.locator('.import-option').first.evaluate('e=>{const t=e.querySelector("span:not(.import-option-icon)").getBoundingClientRect(),r=e.getBoundingClientRect();return Math.abs((t.top+t.bottom-r.top-r.bottom)/2)<2}'))
  screenshot(p,'292-import-'+theme+'-'+str(size[0])+'-'+lang)
  errors(p);p.close()

if __name__=='__main__':
 try:
  with sync_playwright() as w:
   browser=w.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
   for fn in [editing,playlists,imports,link_search,layouts]:fn(browser)
   browser.close()
 except Exception:
  traceback.print_exc();raise
 finally:(OUT/'browser-library-292.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2))
