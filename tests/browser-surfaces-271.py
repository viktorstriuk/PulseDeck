#!/usr/bin/env python3
"""Actual renderer, CSS and Chromium, with explicit test Electron IPC.
No YouTube/network downloads, no Windows global-shortcut emulation.
"""
from pathlib import Path
import importlib.util,json,shutil,traceback,base64
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/2.7.1';OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('fixture',ROOT/'tests/browser-regression.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
VERSION=json.loads((ROOT/'app/package.json').read_text())['version'];checks=[];errors=[]
def check(name,ok,detail=None):
 checks.append({'name':name,'passed':bool(ok),**({'detail':detail} if detail is not None else {})});print(('PASS ' if ok else 'FAIL ')+name,flush=True)
 if not ok: raise AssertionError(name+': '+str(detail))
def make_page(browser,patch=None,size=(1440,1000),scheme='dark',storage=None,dpr=1):
 p=browser.new_page(viewport={'width':size[0],'height':size[1]},device_scale_factor=dpr,color_scheme=scheme,bypass_csp=True);p.set_default_timeout(12000);p.on('pageerror',lambda e:errors.append(str(e)))
 bridge=(ROOT/'tests/browser-bridge.js').read_text().replace("version:'2.6.9'",f"version:'{VERSION}'")
 store='window.__storage='+json.dumps(storage or {})+';' + "Object.defineProperty(window,'localStorage',{value:{getItem:k=>window.__storage[k]||null,setItem:(k,v)=>window.__storage[k]=v},configurable:true});"
 seed="""Object.assign(__mock.settings,{surfaceApplyAll:true,customCategories:[],theme:'nord',accent:'crimson',categoryStyles:{downloads:{hidden:true},recent:{hidden:true},'artist:morgenstern':{color:'#af949f',glow:true,gradient:['#af949f']}},backgroundMode:'track',backgroundOpacity:62});
 __mock.tracks=__mock.tracks.slice(0,5);__mock.tracks[4].artist='Slipknot';
 __mock.settings.lastTrack=__mock.tracks[0].rel;__mock.tracks[0].coverUrl=new URL('../../tests/fixtures/lyrics-cover-dark.png',document.baseURI).href;
 __mock.iconSaveCalls=0;
 pulse.appearance.saveGeneratedIcon=async(name,png)=>{__mock.iconSaveCalls++;__mock.iconPng=png;return {ok:true,ref:'custom-icons/0123456789abcdef01234567.png'};};
 const builtinIconUrl=pulse.appearance.iconUrl;pulse.appearance.iconUrl=async ref=>ref.startsWith('custom-icons/')?new URL('../assets/app-icons/sky-monitor.png',document.baseURI).href:builtinIconUrl(ref);
 """+('Object.assign(__mock.settings,'+json.dumps(patch or {})+');')
 html=(ROOT/'app/renderer/index.html').read_text().replace('<head>',f'<head><base href="{m.BASE}/app/renderer/"><script>'+store+bridge+seed+'</script>',1)
 p.set_content(html);p.wait_for_selector('#library [data-track-root]');p.wait_for_function(f"document.querySelector('#appVersion').textContent==='{VERSION}'");p.wait_for_timeout(200);return p

def settings(p):
 if not p.locator('#settingsModal').is_visible():p.locator('#settingsBtn').click()
 p.locator('[data-settings-page=appearance]').click();p.locator('#surfaceSettings').scroll_into_view_if_needed()
def close_settings(p):
 p.locator('[data-close=settingsModal]').click();p.mouse.move(300,130);p.wait_for_timeout(200)
def setrange(p,id,v,event='input'):
 p.locator('#'+id).evaluate('(el,v)=>{el.value=v;el.dispatchEvent(new Event("'+event+'",{bubbles:true}));}',v)
def mode(p,value):settings(p);p.locator('[data-surface-style='+value+']').click();p.wait_for_timeout(50)
def style(p,selector):return p.locator(selector).first.evaluate('(e)=>{const s=getComputedStyle(e);return {bg:s.backgroundColor,image:s.backgroundImage,shadow:s.boxShadow,filter:s.backdropFilter,border:s.borderWidth,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height};}')
def transparent(s):return s['bg'] in ['rgba(0, 0, 0, 0)','transparent'] or s['bg'].endswith('/ 0)')
def rects(p,selectors):return {s:p.locator(s).first.evaluate('e=>{let r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}') for s in selectors}
def assert_tabs(p,rail,label):
 vals=p.locator(rail+' .category-tab').evaluate_all("ns=>ns.map(n=>{const s=getComputedStyle(n);return {bg:s.backgroundColor,img:s.backgroundImage,sh:s.boxShadow,bd:s.borderWidth,f:s.backdropFilter};})")
 check(label,len(vals)>1 and all(v['bg']=='rgba(0, 0, 0, 0)' and v['img']=='none' and v['sh']=='none' and v['bd']=='0px' and v['f']=='none' for v in vals),vals)
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(headless=True,executable_path=shutil.which('chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
  p=make_page(b)
  check('271 loads version and surface stylesheet',p.locator('link[href="surfaces.css"]').count()==1)
  settings(p);p.locator('#surfaceSettings').screenshot(path=str(OUT/'271-surface-settings-ru.png'))
  check('five presets are in a real grid, not inherited flex columns',p.locator('#surfaceStyleOptions').evaluate("e=>getComputedStyle(e).display==='grid'&&getComputedStyle(e).gridTemplateColumns.split(' ').length===5"))
  check('only chosen preset has aria-pressed',p.locator('#surfaceStyleOptions [aria-pressed=true]').count()==1)
  check('glass also blurs the standalone settings window', 'blur(16px)' in style(p,'#settingsModal .modal')['filter'])
  check('all three range controls have 22px pointer targets, no textbox border or padding',p.locator('.surface-tuning input[type=range]').evaluate_all("es=>es.length===3&&es.every(e=>{const s=getComputedStyle(e);return parseFloat(s.height)===22&&s.padding==='0px'&&s.borderWidth==='0px';})"))
  r=p.locator('#surfaceOpacity').bounding_box();p.mouse.click(r['x']+r['width']*.42,r['y']+r['height']/2);p.wait_for_timeout(240)
  check('opacity slider responds to real pointer input and persists',37<=float(p.locator('#surfaceOpacity').input_value())<=47 and p.evaluate('__mock.settings.surfaceOpacity')<50)
  p.locator('#surfaceBorderThickness').focus();p.keyboard.press('ArrowRight');p.wait_for_timeout(250)
  check('border slider supports keyboard input in half-pixel steps',float(p.locator('#surfaceBorderThickness').input_value())==1.5)
  p.locator('#surfaceBorderColorBtn').click();check('border uses the existing application colour picker',p.locator('#colorModal').is_visible())
  p.locator('#colorHexInput').fill('#8BB8C8');p.locator('#rgbApply').click();p.wait_for_timeout(200)
  check('colour picker updates border and settings, not accent',p.evaluate("__mock.settings.surfaceBorderColor==='#8bb8c8'&&__mock.settings.accent==='crimson'"))
  setrange(p,'surfaceOpacity',55);setrange(p,'surfaceBorderOpacity',60);setrange(p,'surfaceBorderThickness',0)
  close_settings(p)
  selectors=['.track-card','.track-card .card-cover','.track-card .track-copy','#sortTrigger','.toolbar-toggle-group>.segmented','#gridViewBtn','#listViewBtn','.top-search','#onlineBtn']
  before=rects(p,selectors);settings(p);setrange(p,'surfaceBorderThickness',6);close_settings(p);after=rects(p,selectors)
  check('0→6px border leaves card, cover, text and button geometry unchanged',before==after,{'before':before,'after':after})
  check('card uses full 6px inset contour', '6px inset' in style(p,'.track-card')['shadow'])
  check('compact segmented contour adapts to 2px', '2px inset' in style(p,'.toolbar-toggle-group>.segmented')['shadow'])
  check('normal buttons adapt to 3px contour','3px inset' in style(p,'#onlineBtn')['shadow'])
  check('active segment stays completely inside segmented container',p.locator('#gridViewBtn').evaluate("e=>{const a=e.getBoundingClientRect(),b=e.parentElement.getBoundingClientRect();return a.left>=b.left+3&&a.top>=b.top+3&&a.right<=b.right-3&&a.bottom<=b.bottom-3}"))
  check('cover has a safe inset beyond max decorative border',p.locator('.track-card').first.evaluate("e=>{const a=e.getBoundingClientRect(),c=e.querySelector('.cover').getBoundingClientRect();return c.left-a.left>=9&&c.top-a.top>=9&&a.bottom-c.bottom>=9}"))
  p.screenshot(path=str(OUT/'271-grid-border-6px.png'));assert_tabs(p,'#categoryChips','top playlist tabs remain unboxed at 6px')
  p.locator('#listViewBtn').click();p.locator('[data-category-layout=side]').click();p.wait_for_timeout(600)
  list_before=rects(p,['#library','.list-row','.list-row .list-title-cell','.category-sidebar'])
  mode(p,'outline');close_settings(p)
  check('outline removes fill from actual list container',transparent(style(p,'#library')))
  check('outline removes fill from actual sidebar',transparent(style(p,'.category-sidebar')))
  check('ordinary table rows no longer have an opaque grey fill',transparent(style(p,'.list-row')))
  assert_tabs(p,'#categorySidebar','side playlist labels and icons remain unboxed')
  mode(p,'invisible');close_settings(p)
  for sel in ['#library','.category-sidebar','#folderBtn','#refreshBtn','#sortTrigger','.top-search','#onlineBtn','.toolbar-toggle-group>.segmented']:
   s=style(p,sel);check('invisible removes fill/blur/decorative stroke: '+sel,transparent(s) and s['filter']=='none' and ('0px inset' in s['shadow'] or s['shadow']=='none'),s)
  check('mode changes do not move list cells or sidebar geometry',list_before==rects(p,['#library','.list-row','.list-row .list-title-cell','.category-sidebar']),{'before':list_before,'after':rects(p,['#library','.list-row','.list-row .list-title-cell','.category-sidebar'])})
  p.screenshot(path=str(OUT/'271-invisible-list-sidebar.png'))
  settings(p);check('invisible disables only inapplicable settings, not preset buttons',p.locator('#surfaceOpacity').is_disabled() and p.locator('#surfaceBorderThickness').is_disabled() and p.locator('#surfaceBorderColorBtn').is_disabled() and p.locator('#surfaceStyleOptions button:disabled').count()==0)
  p.locator('[data-surface-style=outline]').click();check('outline enables border settings but disables fill',p.locator('#surfaceOpacity').is_disabled() and not p.locator('#surfaceBorderThickness').is_disabled())
  p.locator('[data-surface-style=gradient]').click();check('re-enabling fill restores stored opacity and thickness',p.locator('#surfaceOpacity').input_value()=='55' and p.locator('#surfaceBorderThickness').input_value()=='6')
  close_settings(p);check('gradient reaches list and sidebar', '145deg' in style(p,'#library')['image'] and '145deg' in style(p,'.category-sidebar')['image']);p.screenshot(path=str(OUT/'271-gradient-list-sidebar.png'))
  # Real pointer drag, not an artificial class: only sidebar ghost is a surface.
  m.start_cat_drag(p,'#categorySidebar',1,2);p.wait_for_selector('.playlist-drag-ghost')
  check('sidebar drag ghost is explicitly opted into surface style',p.locator('.playlist-drag-ghost').evaluate("e=>e.classList.contains('playlist-drag-from-sidebar')") and '145deg' in style(p,'.playlist-drag-ghost')['image'])
  p.screenshot(path=str(OUT/'271-sidebar-drag.png'));p.mouse.up();p.wait_for_timeout(450)
  check('drag completes, removes ghost and saves new order',p.locator('.playlist-drag-ghost').count()==0 and p.evaluate('__mock.settings.categoryOrder.length')>0)
  assert_tabs(p,'#categorySidebar','side playlist tabs return to their own appearance after drag')
  p.locator('#playlistLayoutControl [data-category-layout=top]').click();p.wait_for_timeout(600)
  check('layout switch directly after sidebar drag changes to top without a stale click',p.evaluate("document.documentElement.dataset.categoryLayout==='top'"))
  m.start_cat_drag(p,'#categoryChips',1,2)
  p.wait_for_selector('.playlist-drag-ghost')
  check('top drag ghost does not acquire grey surface styling',transparent(style(p,'.playlist-drag-ghost')) and style(p,'.playlist-drag-ghost')['image']=='none');p.mouse.up();p.wait_for_timeout(400)
  # Menus: correct fixed submenu coordinate system and transparent style.
  p.locator('#library [data-action=menu]').first.click();p.wait_for_timeout(150)
  check('context menu uses gradient without introducing a containing block', '145deg' in style(p,'#contextMenu')['image'] and style(p,'#contextMenu')['filter']=='none')
  check('first track menu click after playlist drag is not lost to reflow',p.locator('#contextMenu').is_visible() and p.locator('#contextMenu [data-submenu-trigger]').count()==1)
  p.locator('#contextMenu [data-submenu-trigger]').click();p.wait_for_timeout(150)
  check('nested menu adopts style and remains inside viewport',p.locator('.context-submenu').evaluate("e=>{const r=e.getBoundingClientRect();return getComputedStyle(e).backgroundImage.includes('145deg')&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}"))
  p.screenshot(path=str(OUT/'271-nested-menu.png'));p.mouse.click(450,135)
  mode(p,'glass');setrange(p,'surfaceOpacity',0);setrange(p,'surfaceBorderThickness',0);close_settings(p)
  check('0% fill plus 0px contour is truly transparent and has no blur',transparent(style(p,'.category-sidebar')) and style(p,'.category-sidebar')['filter']=='none')
  settings(p);p.locator('#surfaceResetBtn').click();p.wait_for_timeout(200)
  check('surface reset preserves theme and other preferences',p.evaluate("__mock.settings.surfaceStyle==='glass'&&__mock.settings.surfaceOpacity===94&&__mock.settings.surfaceBorderThickness===1&&__mock.settings.theme==='nord'"))
  # Original icon in tile/editor and live PNG export.
  p.locator('#appIconOptions').scroll_into_view_if_needed();p.locator('#appIconOptions').screenshot(path=str(OUT/'271-original-icon-presets.png'))
  check('custom tile uses recovered original mark, not generic monitor',p.locator('#customIconBtn .original-monitor-mark').count()==1)
  p.locator('#customIconBtn').click();check('custom editor uses the canonical recovered path',p.locator('#customIconPreview [data-monitor-mark]').evaluate('e=>e.getAttribute("d")===PulseAppIcon.markPath'))
  p.locator('[data-custom-stop-color="fg:0"]').evaluate("e=>{e.value='#111111';e.dispatchEvent(new Event('input',{bubbles:true}));}")
  for _ in range(3):p.locator('#addFgStopBtn').click()
  check('same original mark supports four foreground gradient stops',p.locator('#customFgStops .custom-stop-row').count()==4 and p.locator('#customIconPreview #fgGrad stop').count()==4)
  p.locator('[data-custom-stop-pos="bg:1"]').focus();p.keyboard.press('ArrowRight')
  check('gradient position input remains focused and responds to keyboard',p.locator('[data-custom-stop-pos="bg:1"]').input_value()=='34')
  p.screenshot(path=str(OUT/'271-custom-original-mark.png'));p.locator('#customIconSave').click();p.wait_for_function("document.querySelector('#customIconModal').classList.contains('hidden')")
  check('save exports PNG and marks original-symbol migration complete',p.evaluate("__mock.iconSaveCalls===1&&__mock.iconPng.startsWith('data:image/png;base64,')&&__mock.settings.appIconMarkVersion===1"))
  (OUT/'271-custom-icon-export.png').write_bytes(base64.b64decode(p.evaluate('__mock.iconPng').split(',',1)[1]))
  p.locator('#customIconBtn').click();check('saved foreground/background colours survive reopening',p.locator('#customFgStops .custom-stop-row').count()==4 and p.locator('[data-custom-stop-color="fg:0"]').input_value()=='#111111');p.locator('#customIconCancel').click()
  saved=p.evaluate('JSON.parse(JSON.stringify(__mock.settings))');p.close()
  q=make_page(b,patch=saved);check('relaunch preserves colours and does not migrate already-current custom icon',q.evaluate('__mock.iconSaveCalls===0&&__mock.settings.customIconStyle.fg.length===4'));q.close()
  legacy={**saved,'appIconMarkVersion':0};q=make_page(b,patch=legacy)
  check('old saved custom icon is regenerated once without changing colours',q.evaluate('__mock.iconSaveCalls===1&&__mock.settings.appIconMarkVersion===1') and q.evaluate('__mock.settings.customIconStyle')==legacy['customIconStyle']);q.close()
  # Language/size/theme visual matrix: both RU/EN, light/dark, high-DPI.
  for width,height,theme,lang,dpr in [(1600,1000,'light','en',1),(1280,900,'dark','ru',1.25),(1000,800,'dawn','en',1),(800,720,'nord','ru',1)]:
   q=make_page(b,patch={'theme':theme,'language':lang},size=(width,height),scheme='light' if theme in ['light','dawn'] else 'dark',dpr=dpr)
   settings(q)
   q.locator('#surfaceSettings').evaluate("e=>{const panel=e.closest('.settings-page');panel.scrollTop+=e.getBoundingClientRect().top-panel.getBoundingClientRect().top-12;}")
   q.screenshot(path=str(OUT/f'271-controls-{width}-{theme}-{lang}.png'))
   if width<=860:check('compact settings navigation keeps eight visible labelled icons',q.locator('.settings-nav-item').evaluate_all("es=>es.length===8&&es.every(e=>e.getAttribute('aria-label')&&e.querySelector('[data-icon]').getBoundingClientRect().width>=18&&e.getBoundingClientRect().height>=44)"))
   check(f'no horizontal overflow at {width}px/{theme}/{lang}',q.locator('#surfaceSettings').evaluate('e=>e.scrollWidth<=e.clientWidth+1') and q.locator('[data-settings-panel=appearance]').evaluate('e=>e.scrollWidth<=e.clientWidth+1'))
   check(f'range tracks retain pointer targets at {width}px',q.locator('#surfaceOpacity').evaluate('e=>e.getBoundingClientRect().height===22'))
   check(f'labels translated at {width}px',not ('Surface' in q.locator('#surfaceSettings').inner_text()) and (('Background opacity' in q.locator('#surfaceSettings').inner_text()) if lang=='en' else ('Непрозрачность фона' in q.locator('#surfaceSettings').inner_text())))
   reachable=True
   for control in ['#surfaceOpacity','#surfaceBorderThickness','#surfaceBorderOpacity','#surfaceBorderColorBtn','#surfaceResetBtn']:
    q.locator(control).scroll_into_view_if_needed()
    reachable=reachable and q.locator(control).evaluate("e=>{const r=e.getBoundingClientRect(),p=e.closest('.settings-page').getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom+1&&r.left>=p.left&&r.right<=p.right;}")
   check(f'all controls and reset are reachable by internal scrolling at {width}px',reachable)
   if width<=1040:q.screenshot(path=str(OUT/f'271-controls-{width}-{theme}-{lang}-bottom.png'))
   mode(q,'translucent');close_settings(q);check(f'translucent neutral colours follow {theme}',transparent(style(q,'.track-card'))==False)
   q.close()
  check('no uncaught renderer errors across all scenarios',not errors,errors)
  b.close()
except Exception as e:
 checks.append({'name':'completion','passed':False,'error':str(e),'trace':traceback.format_exc()});print(traceback.format_exc(),flush=True)
finally:
 m.server.shutdown()
 report={'version':VERSION,'environment':'Real Chromium/HTML/CSS/JS with test IPC, not Windows Electron','passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks),'errors':errors,'checks':checks}
 (OUT/'browser-surfaces.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:report[k] for k in ['passed','failed']}))
raise SystemExit(bool(report['failed']))
