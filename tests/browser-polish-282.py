#!/usr/bin/env python3
"""2.8.2 real HTML/CSS/JS in Chromium, explicit mock Electron bridge.
No claim of interactive Windows validation. Screenshots are part of the output.
"""
import importlib.util,json,traceback,shutil,time
from pathlib import Path
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1];OUT=R/'test-results'/'2.8.2';OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('base',R/'tests/browser-regression.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
checks=[]
def check(name,ok,detail=None):
 checks.append({'name':name,'passed':bool(ok),'detail':detail});print(('PASS ' if ok else 'FAIL ')+name,flush=True)
 if not ok:raise AssertionError(name+': '+str(detail))
def page(browser,settings=None,size=(1440,1000),scheme='dark'):
 p=browser.new_page(viewport={'width':size[0],'height':size[1]},color_scheme=scheme,bypass_csp=True);p.set_default_timeout(12000);p._errors=[];p.on('pageerror',lambda e:p._errors.append(str(e)))
 bridge=(R/'tests/browser-bridge.js').read_text()
 store="Object.defineProperty(window,'localStorage',{value:{getItem:()=>null,setItem(){}},configurable:true});"
 seed='Object.assign(__mock.settings,'+json.dumps(settings or {})+');'
 html=(R/'app/renderer/index.html').read_text().replace('<head>',f'<head><base href="{base.BASE}/app/renderer/"><script>'+store+bridge+seed+'</script>',1)
 # Test-only access to the real reader instance, no production debug hooks.
 html=html.replace('<script src="app.js"></script>',"<script>const Reader=PulseLyricsView;window.PulseLyricsView=class extends Reader{constructor(...args){super(...args);window.__reader=this;}}</script><script src=\"app.js\"></script>")
 p.set_content(html);p.wait_for_selector('#library [data-track-root]');p.wait_for_function("version => document.querySelector('#appVersion').textContent===version", arg=json.loads((R/'app/package.json').read_text())['version']);p.wait_for_timeout(200);return p
def appearance(p):
 if not p.locator('#settingsModal').is_visible():p.click('#settingsBtn')
 p.click('[data-settings-page=appearance]');p.locator('#surfaceSettings').scroll_into_view_if_needed();p.wait_for_timeout(50)
def tune(p,id,value):p.locator('#'+id).evaluate('(e,v)=>{e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));}',value);p.wait_for_timeout(80)
def props(p,selector):return p.locator(selector).first.evaluate('e=>{const s=getComputedStyle(e);return {bg:s.backgroundColor,image:s.backgroundImage,shadow:s.boxShadow,filter:s.backdropFilter,outline:s.outlineWidth};}')
def shot(p,name):p.screenshot(path=str(OUT/(name+'.png')))
def seed_lyrics(p):
 p.evaluate("""()=>{const t=__mock.tracks[0];t.coverUrl=new URL('../../tests/fixtures/lyrics-cover-dark.png',document.baseURI).href;
 const doc=PulseLyrics.normalize({format:'pulsedeck-lyrics',version:1,lines:Array.from({length:12},(_,i)=>({startMs:i*5000,text:['Ночь становится тише','Музыка остаётся с нами','Только слова и свет'][i%3]+' '+(i+1)})),theme:{mode:'gradient',background:'#182e36',gradientColors:['#182e36','#342b46']}}).doc;__mock.lyrics.records[t.rel]={doc,theme:doc.theme,revision:'initial'};__mock.emit('library:changed');}""")
 p.wait_for_timeout(150);p.locator('#library [data-track-root]').first.dblclick();p.evaluate('audio.pause()');p.click('#lyricsBtn');p.wait_for_selector('.ly-line');p.wait_for_timeout(450)
def suite(browser):
 p=page(browser,{'theme':'nord','surfaceStyle':'gradient','surfaceOpacity':59,'surfaceBorderThickness':.5})
 appearance(p)
 check('Independent profiles are the default',not p.locator('#surfaceApplyAll').is_checked() and p.locator('#surfaceTargetOptions').is_visible())
 check('Seven independently editable surface groups',p.locator('[data-surface-target]').count()==7)
 check('Legacy style seeds all groups without discarding it',p.locator('#surfaceOpacity').input_value()=='59' and p.locator('button[data-surface-style=gradient]').get_attribute('aria-pressed')=='true')
 shot(p,'282-surfaces-initial')
 before=props(p,'#settingsModal .modal');tune(p,'surfaceOpacity',25)
 check('Block edit persists in its profile, not the common template',p.evaluate('__mock.settings.surfaceProfiles.blocks.surfaceOpacity===25 && __mock.settings.surfaceOpacity===59'))
 check('Block edit leaves window appearance unchanged',props(p,'#settingsModal .modal')==before)
 check('Nested card uses its own profile',props(p,'#surfaceSettings')['bg']!=before['bg'])
 p.click('[data-surface-target=contextMenus]');check('Untouched group starts from common template',p.locator('#surfaceOpacity').input_value()=='59')
 p.click('button[data-surface-style=outline]');tune(p,'surfaceBorderThickness',3)
 check('Context profile is stored separately',p.evaluate('__mock.settings.surfaceProfiles.contextMenus.surfaceStyle==="outline"&&__mock.settings.surfaceProfiles.blocks.surfaceOpacity===25'))
 p.click('[data-surface-target=blocks]');check('Switching back restores its exact editor values',p.locator('#surfaceOpacity').input_value()=='25' and p.locator('button[data-surface-style=gradient]').get_attribute('aria-pressed')=='true')
 p.check('#surfaceApplyAll');check('Common switch hides targets and template-reset action',not p.locator('#surfaceTargetOptions').is_visible() and not p.locator('#surfaceCommonResetBtn').is_visible())
 tune(p,'surfaceOpacity',73);check('Common mode changes the template without deleting profiles',p.evaluate('__mock.settings.surfaceOpacity===73&&__mock.settings.surfaceProfiles.blocks.surfaceOpacity===25'))
 p.uncheck('#surfaceApplyAll');check('Leaving common mode restores customized profiles',p.locator('#surfaceOpacity').input_value()=='25')
 p.click('[data-surface-target=menus]');check('Untouched group follows latest common template',p.locator('#surfaceOpacity').input_value()=='73')
 p.click('[data-surface-target=blocks]');p.click('#surfaceCommonResetBtn');check('Restore common style affects only selected group',p.locator('#surfaceOpacity').input_value()=='73' and p.evaluate('!__mock.settings.surfaceProfiles.blocks&&__mock.settings.surfaceProfiles.contextMenus.surfaceBorderThickness===3'))
 p.click('[data-surface-target=controls]');p.click('button[data-surface-style=invisible]');check('Invisible disables unsuitable sliders only',p.locator('#surfaceOpacity').is_disabled() and p.locator('#surfaceBorderThickness').is_disabled() and not p.locator('button[data-surface-style=glass]').is_disabled())
 p.click('#surfaceResetBtn');check('Factory reset resets only selected profile',p.locator('#surfaceOpacity').input_value()=='94' and p.evaluate('__mock.settings.surfaceProfiles.contextMenus.surfaceStyle==="outline"&&__mock.settings.surfaceOpacity===73'))
 # Profile round trip is through the actual save snapshot in the renderer bridge.
 saved=p.evaluate('__mock.settings');p.close();p=page(browser,saved);appearance(p);p.click('[data-surface-target=contextMenus]')
 check('Profiles survive a fresh renderer',p.locator('#surfaceBorderThickness').input_value()=='3' and p.locator('button[data-surface-style=outline]').get_attribute('aria-pressed')=='true')
 p.click('[data-close=settingsModal]');p.wait_for_timeout(100)
 p.locator('#library [data-track-root]').first.click(button='right');p.wait_for_selector('#contextMenu:not(.hidden)')
 # Reveal the add-to submenu through pointer, not forced style.
 p.locator('#contextMenu .context-submenu-wrap').first.hover();p.wait_for_timeout(200)
 new=p.locator('#contextMenu .new-playlist-item').first
 check('New playlist aligns left and has no fixed grey fill',new.evaluate("e=>getComputedStyle(e).justifyContent==='flex-start'&&getComputedStyle(e).textAlign==='left'&&getComputedStyle(e).backgroundColor==='rgba(0, 0, 0, 0)'"))
 shot(p,'282-context-outline');p.keyboard.press('Escape')
 check('No script errors in surfaces',not p._errors,p._errors);p.close()
 # Actual OS media preference stays independent of arbitrary app theme/accent.
 p=page(browser,{'theme':'sand','accent':'purple'},scheme='dark');appearance(p)
 sw=p.locator('.theme-swatch.system');a=sw.evaluate("e=>[e.style.getPropertyValue('--sw-bg'),e.style.getPropertyValue('--sw-surface'),e.style.getPropertyValue('--sw-accent')]")
 check('System preview follows OS dark while app is light',sw.get_attribute('data-system-scheme')=='dark' and a[0]=='#0a0b0f')
 p.locator('button[data-theme=forest]').click();p.locator('button[data-accent=gold]').click()
 check('App theme and accent do not recolour System preview',a==sw.evaluate("e=>[e.style.getPropertyValue('--sw-bg'),e.style.getPropertyValue('--sw-surface'),e.style.getPropertyValue('--sw-accent')]"))
 p.emulate_media(color_scheme='light');p.wait_for_timeout(70)
 check('System preview responds to a live OS change',sw.get_attribute('data-system-scheme')=='light' and sw.evaluate("e=>e.style.getPropertyValue('--sw-bg')")== '#f4f5f8')
 p.locator('.theme-grid').screenshot(path=str(OUT/'282-system-light.png'))
 p.locator('#appIconOptions').screenshot(path=str(OUT/'282-icon-grid.png'))
 check('Pastel presets retain compatible stored IDs with new names',p.locator('[data-app-icon="builtin:sky"]').inner_text()=='Розовый жемчуг' and p.locator('[data-app-icon="builtin:coral"]').inner_text()=='Фарфор' and p.locator('[data-app-icon="builtin:lime"]').inner_text()=='Шампань')
 p.click('#settingsAbout');p.wait_for_timeout(250);p.locator('.about-author').screenshot(path=str(OUT/'282-author.png'))
 check('Author artwork is larger and optically lifted',p.locator('.author-art img').evaluate('e=>parseFloat(getComputedStyle(e).width)===144') and p.locator('.author-art').evaluate('e=>parseFloat(getComputedStyle(e).top)<0'))
 p.click('[data-close=settingsModal]');p.click('#minBtn')
 check('Pointer focus leaves no unwanted border on minimize',props(p,'#minBtn')['outline']=='0px')
 p.keyboard.press('Tab');p.focus('#minBtn');check('Keyboard users retain a contained focus indicator',props(p,'#minBtn')['outline']=='2px' and p.locator('#minBtn').evaluate('e=>parseFloat(getComputedStyle(e).outlineOffset)<0'))
 p.mouse.click(300,200);p.close()
 # Layout and localization at compact sizes.
 for size,lang in [((800,600),'ru'),((1024,768),'en')]:
  p=page(browser,{'language':lang},size=size);appearance(p)
  check(f'Profile controls fit at {size[0]} ({lang})',p.locator('#surfaceSettings').evaluate('e=>e.scrollWidth<=e.clientWidth+1'))
  check(f'Target labels localized ({lang})',not any(x.startswith('Surface') for x in p.locator('[data-surface-target]').all_text_contents()))
  shot(p,f'282-surfaces-{size[0]}-{lang}');p.close()
 p=page(browser);seed_lyrics(p)
 check('Viewing lyrics has no source/export/mode footer',p.locator('#lyricsView .ly-bottom').count()==0 and not p.locator('#lyricsZipBtn').is_visible() and not p.locator('#lyricsSourceBtn').is_visible())
 p.click('#lyricsEditBtn');check('Source and export remain available in editor',p.locator('#lyricsSourceBtn').is_visible() and p.locator('#lyricsZipBtn').is_visible() and p.locator('#lyricsExportBtn').is_visible())
 p.wait_for_timeout(3900);check('Editing is never hidden by inactivity',not p.locator('body').evaluate("e=>e.classList.contains('lyrics-idle')"));p.click('#lyricsEditorClose')
 p.mouse.move(530,420);p.wait_for_timeout(3100);check('Reader stays visible before 3.5 seconds',not p.locator('body').evaluate("e=>e.classList.contains('lyrics-idle')"))
 p.wait_for_timeout(700);check('After 3.5 seconds only lyrics and background remain',p.locator('body').evaluate("e=>e.classList.contains('lyrics-idle')") and p.locator('#player').evaluate("e=>getComputedStyle(e).opacity==='0'&&e.inert"))
 check('Idle reader uses whole viewport',p.locator('#lyricsView').evaluate('e=>{const r=e.getBoundingClientRect();return r.top===0&&r.bottom===innerHeight&&r.left===0&&r.right===innerWidth}'))
 shot(p,'282-lyrics-idle');p.mouse.move(550,421);p.wait_for_timeout(260)
 check('Mouse movement restores controls and interactivity',not p.locator('body').evaluate("e=>e.classList.contains('lyrics-idle')") and p.locator('#player').evaluate("e=>getComputedStyle(e).opacity==='1'&&!e.inert"))
 shot(p,'282-lyrics-awake')
 # Opacity samples are from the real compositor animation, no per-frame renderer.
 p.click('#lyricsBackgroundMode');p.wait_for_timeout(110)
 check('Background change uses an opacity crossfade',p.locator('.ly-scene').count()==2 and p.evaluate("__reader.backdrop.busy&&__reader.backdrop.animation?.effect.getKeyframes().every(k=>'opacity' in k)"))
 shot(p,'282-lyrics-crossfade');p.wait_for_timeout(400)
 check('Crossfade releases compositor hint after completion',not p.locator('.ly-backdrop').evaluate("e=>e.classList.contains('ly-transitioning')"))
 p.evaluate("()=>{for(let i=0;i<24;i++)document.querySelector('#lyricsBackgroundMode').click()}");p.wait_for_timeout(1000)
 check('Rapid background switches stay bounded and settle on latest scene',p.locator('.ly-scene').count()==2 and p.evaluate("!__reader.backdrop.busy&&!__reader.backdrop.pending&&JSON.parse(__reader.backdrop.key).cover===document.querySelector('#lyricsCover').src"))
 p.emulate_media(reduced_motion='reduce');p.click('#lyricsBackgroundMode');p.wait_for_timeout(70)
 check('Reduced motion skips background animation',p.evaluate('!__reader.backdrop.animation&&!__reader.backdrop.busy'))
 p.emulate_media(reduced_motion='no-preference');p.mouse.move(590,410);p.wait_for_timeout(3800);p.keyboard.press('Tab');p.wait_for_timeout(250)
 check('Keyboard wakes hidden controls before focus navigation',not p.locator('body').evaluate("e=>e.classList.contains('lyrics-idle')") and p.locator('#player').evaluate('e=>!e.inert'))
 p.click('#lyricsSettingsBtn');p.wait_for_timeout(3800)
 check('Appearance dialog remains usable during inactivity',p.locator('#lyricsSettings').is_visible() and not p.locator('body').evaluate("e=>e.classList.contains('lyrics-idle')"));p.click('#lyricsSettingsClose')
 p.evaluate("window.dispatchEvent(new Event('blur'))");p.wait_for_timeout(3800)
 check('Blur stops inactivity timer',p.evaluate('__reader.immersive.timer===0&&!__reader.immersive.idle'))
 p.evaluate("window.dispatchEvent(new Event('focus'))");p.mouse.move(600,420);p.wait_for_timeout(3800);p.mouse.move(602,422);p.wait_for_timeout(260);p.click('#lyricsCloseBtn')
 check('Close cancels timers, animations and hidden state',p.evaluate("__reader.immersive.timer===0&&!__reader.immersive.idle&&!__reader.backdrop.animation&&!document.querySelector('#player').inert"))
 check('No script errors in reader',not p._errors,p._errors);p.close()
if __name__=='__main__':
 failure=None
 try:
  with sync_playwright() as pw:
   b=pw.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox','--disable-dev-shm-usage']);suite(b);b.close()
 except Exception as e:failure=str(e);traceback.print_exc()
 finally:
  (OUT/'browser-polish-282.json').write_text(json.dumps({'checks':checks,'failure':failure},ensure_ascii=False,indent=2));base.server.shutdown()
 if failure:raise SystemExit(1)
