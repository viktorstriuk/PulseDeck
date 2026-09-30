#!/usr/bin/env python3
"""Real 2.9.5 renderer and Chromium media/layout tests with deterministic IPC.
Native Windows pinning and real multi-monitor behavior require a Windows run.
"""
import importlib.util,json,os,traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1];OUT=R/'test-results/2.9.5';OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('base295',R/'tests/browser-regression.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
results=[]
def check(name,value,detail=None):
 results.append({'name':name,'passed':bool(value),'detail':detail});print(('PASS ' if value else 'FAIL ')+name,flush=True)
 if not value:raise AssertionError((name,detail))
def page(browser,size=(1280,900),seed=''):
 p=browser.new_page(viewport={'width':size[0],'height':size[1]},bypass_csp=True);p.set_default_timeout(12000);p._errors=[];p.on('pageerror',lambda e:p._errors.append(str(e)))
 bridge='\n'.join((R/('tests/'+n)).read_text() for n in ['browser-bridge.js','search-browser-bridge.js','library-browser-bridge.js','features-295-browser-bridge.js'])
 storage="window.__storage={};Object.defineProperty(window,'localStorage',{value:{getItem:k=>__storage[k]||null,setItem:(k,v)=>__storage[k]=v},configurable:true});"
 initial="Object.assign(__mock.settings,{theme:'ocean',accent:'gold',language:'ru',sort:'manual'});__mock.tracks[0].coverUrl=new URL('../assets/app-icons/sunset-monitor.png',document.baseURI).href;"
 html=(R/'app/renderer/index.html').read_text().replace('<head>',f'<head><base href="{base.BASE}/app/renderer/"><script>'+storage+bridge+initial+seed+'</script>',1)
 capture="<script>for(const [key,field]of [['PulseTrackTools','__tools'],['PulseOnlineSearchUI','__search'],['PulseLyricsView','__lyrics'],['PulsePresetsUI','__presets']]){const Base=window[key];window[key]=class extends Base{constructor(...args){super(...args);window[field]=this;}};}</script>"
 html=html.replace('<script src="app.js"></script>',capture+'<script src="app.js"></script>');p.set_content(html)
 p.wait_for_selector('#library [data-track-root][data-id=t0]');p.wait_for_function('window.__tools && window.__lyrics && window.__presets');return p

def close(p):check('No uncaught renderer exception',not p._errors,p._errors);p.close()
def shot(p,name,selector=None):(p.locator(selector) if selector else p).screenshot(path=str(OUT/(name+'.png')))
def menu(p):p.locator('#library [data-track-root][data-id=t0]').click(button='right');p.wait_for_selector('#contextMenu:not(.hidden)')
def order(p):return p.locator('#contextMenu > [data-order-id]').evaluate_all('(a)=>a.map(n=>n.dataset.orderId)')

def menus(browser):
 p=page(browser)
 p.locator('#categoryChips [data-category="custom:0"]').click();menu(p)
 check('Remove from playlist precedes Add to in the default track menu',order(p).index('data-menu:remove-current')<order(p).index('data-menu:addTo'))
 before=order(p);p.evaluate('window.originalMenuNodes=[...document.querySelectorAll("#contextMenu > [data-order-id]")]')
 p.locator('#contextMenu [data-menu=favorite]').click(button='right')
 check('Right-click reveals a left drag handle on every root command',p.locator('#contextMenu > .context-item > .menu-move-handle,#contextMenu > .context-submenu-wrap > .context-item > .menu-move-handle').count()==len(before))
 p.locator('#contextMenu [data-menu=favorite] > .menu-move-handle').focus();p.keyboard.press('ArrowDown')
 p.wait_for_function('__mock.settings.menuOrders.track?.[0]!=="data-menu:favorite"')
 after=order(p);check('Keyboard move changes vertical menu order and persists immediately',after!=before and p.evaluate('__mock.settings.menuOrders.track')==after)
 p.keyboard.press('Control+z');p.wait_for_function('JSON.stringify(__mock.settings.menuOrders.track)===JSON.stringify(window.originalMenuNodes.map(n=>n.dataset.orderId))')
 check('Ctrl+Z undoes and persists the menu move',order(p)==before)
 p.keyboard.press('Control+Shift+z');p.wait_for_function('__mock.settings.menuOrders.track[0]!=="data-menu:favorite"');check('Ctrl+Shift+Z redoes the menu move',order(p)==after)
 check('Reordering preserves actual DOM nodes',p.evaluate('originalMenuNodes.every(n=>n.isConnected&&document.querySelector("#contextMenu").contains(n))'))
 # Real pointer gesture, not a synthetic call to the controller.
 h=p.locator('#contextMenu [data-menu=favorite] .menu-move-handle').bounding_box();target=p.locator('#contextMenu [data-menu=delete]').bounding_box()
 p.mouse.move(h['x']+h['width']/2,h['y']+h['height']/2);p.mouse.down();p.mouse.move(target['x']+8,target['y']+target['height']-2,steps=12);p.mouse.up()
 p.wait_for_function('__mock.settings.menuOrders.track.at(-1)==="data-menu:favorite"')
 check('Pointer drag moves a command smoothly along Y and saves its final slot',order(p)[-1]=='data-menu:favorite')
 shot(p,'295-menu-reorder','#contextMenu');p.keyboard.press('Escape');p.keyboard.press('Escape');menu(p)
 check('Saved menu order is used on the next opening',order(p)[-1]=='data-menu:favorite')
 close(p)

def animation(browser):
 p=page(browser,seed="Object.assign(__mock.tracks[0],{coverUrl:new URL('../../tests/fixtures/artwork-294.webm',document.baseURI).href,coverType:'video/webm',animateCover:true});")
 p.locator('#library [data-track-root][data-id=t0]').click();p.locator('#playerCover').click(button='right');p.wait_for_selector('#contextMenu:not(.hidden)')
 check('Right-clicking the bottom cover opens this track’s context menu',p.locator('#contextMenu').get_attribute('data-track-id')=='t0')
 p.locator('[data-submenu-trigger=track-edit]').hover();p.wait_for_selector('[data-track-animate]',state='visible')
 p.evaluate('window.savedAnimationButton=document.querySelector("[data-track-animate]");window.savedArtVideo=document.querySelector("#library [data-id=t0] video");window.savedArtVideoParent=savedArtVideo.parentElement;window.savedAudio=document.querySelector("audio");')
 p.locator('[data-track-animate]').click();p.wait_for_function('__mock.tracks[0].animateCover===false')
 check('Animation toggle keeps submenu open and updates only its check/X state',p.locator('[data-track-animate]').is_visible() and p.locator('[data-track-animate]').get_attribute('aria-checked')=='false')
 check('Animation preference does not replace artwork or menu DOM',p.evaluate('savedAnimationButton===document.querySelector("[data-track-animate]")&&savedArtVideo.isConnected&&savedArtVideo.parentElement===savedArtVideoParent'))
 check('Disabled animation pauses the existing video element',p.evaluate('savedArtVideo.paused'))
 p.locator('[data-track-animate]').click();p.wait_for_function('__mock.tracks[0].animateCover===true');check('Animation toggles back in place',p.locator('[data-track-animate]').get_attribute('aria-checked')=='true')
 p.keyboard.press('Escape');p.keyboard.press('Escape');p.locator('#library [data-track-root][data-id=t1]').click(button='right');p.locator('[data-submenu-trigger=track-edit]').hover();check('Static or missing artwork has no animation menu item',p.locator('[data-track-animate]').count()==0)
 close(p)

def gradients(browser):
 p=page(browser,seed="__mock.settings.lyricsLastGradient=['#112233','#663344'];")
 p.locator('#library [data-track-root][data-id=t0]').click();p.click('#lyricsBtn');p.wait_for_function('__lyrics.opened&&!__lyrics.loading&&__lyrics.coverReady');p.click('#lyricsSettingsBtn')
 p.wait_for_selector('#lyricsSettings[open]');p.wait_for_function('document.querySelectorAll("#lyricsGradientPresets button:not(:disabled)").length===8')
 check('Eight compact squares: four cover variants, three fixed and previous',p.locator('#lyricsGradientPresets [data-gradient-source=cover]').count()==4 and p.locator('#lyricsGradientPresets [data-gradient-source=fixed]').count()==3 and p.locator('#lyricsGradientPresets [data-gradient-source=previous]').count()==1)
 check('Suggestions match extracted cover colors, not fixed defaults',p.evaluate('[...document.querySelectorAll("[data-gradient-source=cover]")].every((n,i)=>n.style.background.includes(parseInt(__lyrics.coverVariants[i][0].slice(1,3),16)))'))
 dims=p.locator('#lyricsGradientPresets .ly-preset').first.bounding_box();check('Gradient swatches are compact squares',abs(dims['width']-dims['height'])<1 and dims['width']<=38,dims)
 old=p.evaluate('__lyrics.theme.gradientColors.slice()');p.click('#lyricsSwitchColors');check('Bare switch icon reverses actual stop colors',p.evaluate('__lyrics.theme.gradientColors')==old[::-1])
 check('Switch button has no backdrop, border or shadow',p.locator('#lyricsSwitchColors').evaluate('n=>{const s=getComputedStyle(n);return s.backgroundColor==="rgba(0, 0, 0, 0)"&&s.boxShadow==="none"&&parseFloat(s.borderWidth)===0}'))
 p.locator('[data-gradient-source=fixed]').first.click();p.evaluate('__lyrics.flushPresentation()');p.wait_for_function('__mock.settings.lyricsLastGradient?.[0]==="#794332"');check('Last-used manual gradient is saved durably through settings',p.evaluate('__mock.settings.lyricsLastGradient')==['#794332','#362144'])
 shot(p,'295-lyrics-gradients','#lyricsSettings')
 before=p.evaluate('__mock.tracks[0].coverUrl');p.click('#lyricsBackgroundChoose');p.wait_for_function('__lyrics.theme.mode==="custom"&&!!__lyrics.customBackground')
 check('Custom video appears as an independent lyrics-only background',p.evaluate('__mock.tracks[0].coverUrl')==before and p.locator('#lyricsThemeMode').inner_text()=='Свой фон')
 check('Custom video preview decodes without replacing the cover',p.locator('#lyricsThemePreview video').count()==1)
 p.wait_for_function('document.querySelector("#lyricsThemePreview video")?.readyState>=2');shot(p,'295-lyrics-custom-background','#lyricsSettings')
 # A file drop uses the lyrics bridge and never the track cover drop bridge.
 p.locator('#lyricsThemePreview').dispatch_event('drop',{'dataTransfer':p.evaluate_handle('()=>{const d=new DataTransfer();d.items.add(new File(["fixture"],"background.webm",{type:"video/webm"}));return d;}')})
 p.wait_for_function('!__lyrics.backgroundBusy');check('Dropping a lyrics backdrop keeps album artwork untouched',p.evaluate('__mock.tracks[0].coverUrl')==before)
 p.click('#lyricsSettingsClose');p.click('#lyricsCloseBtn');p.locator('#library [data-track-root][data-id=t1]').click();p.click('#lyricsBtn');p.wait_for_function('__lyrics.track?.id==="t1"&&!__lyrics.loading');p.click('#lyricsSettingsBtn')
 for _ in range(4):p.click('#lyricsSettingsMode');check('Cover mode is unavailable on a track with no cover',p.evaluate('__lyrics.scene.mode')!='cover')
 close(p)

def presets(browser):
 for size in [(1280,900),(800,760)]:
  p=page(browser,size);p.locator('#library [data-track-root][data-id=t0]').click();p.evaluate('window.presetAudio=document.querySelector("audio");window.presetAudioSrc=presetAudio.currentSrc;')
  p.click('#settingsBtn');p.click('[data-settings-page=presets]');p.click('#presetCreate');p.wait_for_selector('#presetEditor[open]');p.fill('#presetName','Рабочий стол')
  check('Preset editor lets users choose every settings section',p.locator('#presetSections input').count()==9 and p.locator('#presetSections input:checked').count()==9)
  shot(p,'295-preset-editor-'+str(size[0]),'#presetEditor');p.click('#presetSave');p.wait_for_selector('.preset-card')
  check('Preset saves real selected settings including icon and player bounds',p.evaluate('__mock.presets[0].settings.appIcon==="builtin:blue-violet"&&!!__mock.presets[0].settings.playerOverlay'))
  p.evaluate('()=>{__mock.settings.theme="light";document.body.dataset.theme="light";}');p.locator('.preset-apply').click();p.wait_for_function('!__presets.busy&&__mock.settings.theme==="ocean"')
  check('One-click preset application restores settings without replacing audio',p.evaluate('presetAudio===document.querySelector("audio")&&presetAudio.currentSrc===presetAudioSrc'))
  shot(p,'295-presets-'+str(size[0]),'[data-settings-panel=presets]')
  check('Preset cards remain inside the viewport',p.locator('.preset-card').evaluate('n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}'))
  close(p)

def folders(browser):
 p=page(browser);p.click('#playlistMenuBtn') if p.locator('#playlistMenuBtn').count() else None
 # Use the real playlist context menu to enter edit mode.
 p.locator('#categoryChips [data-category=all]').click(button='right');p.locator('[data-category-command=move]').click()
 p.wait_for_selector('#categoryChips [data-add-folder]');check('Folder plus appears left of all tabs only in edit mode',p.locator('#categoryChips').evaluate('n=>n.firstElementChild.matches("[data-add-folder]")'))
 p.locator('#categoryChips [data-add-folder]').click();p.wait_for_selector('#categoryStyleModal:not(.hidden)');p.fill('#categoryNameInput','Алексей');p.click('#categoryStyleSave')
 p.wait_for_function('__mock.settings.libraryFolders.length===1');p.wait_for_selector('#categoryChips [data-folder-back]')
 check('Creating a folder opens its own All playlist with a compact breadcrumb',p.locator('#categoryChips [data-category$="|all"]').is_visible())
 check('Empty folder explains how to transfer music, without untranslated keys',p.locator('#library .no-results').inner_text().find('Алексей')>=0 and 'FolderEmpty' not in p.locator('#library').inner_text());p.wait_for_timeout(260);shot(p,'295-folder-inside');p.locator('#categoryChips [data-folder-back]').click();check('Folder overview shows new folder and shared root without flattening tabs',p.locator('#categoryChips [data-folder-open]').count()==2 and p.locator('#categoryChips [data-category]').count()==0)
 f=p.evaluate('__mock.settings.libraryFolders[0].id');p.locator('#categoryChips [data-folder-open="'+f+'"]').click(button='right');p.locator('[data-submenu-trigger=folder-import]').hover();p.locator('[data-folder-source=all]').click();p.wait_for_selector('#confirmModal:not(.hidden)')
 check('Folder transfer explicitly asks before moving real files',p.locator('#confirmModal').inner_text().find('12')>=0)
 p.click('#confirmDelete');p.wait_for_function('__mock.tracks.every(t=>t.rel.startsWith("Алексей/"))');p.wait_for_selector('#library [data-track-root]')
 check('Folder All shows moved tracks, while shared All is independent',p.locator('#library [data-track-root]').count()==12)
 shot(p,'295-folder-library');p.locator('#categoryChips [data-folder-back]').click();p.locator('#categoryChips [data-folder-open=""]').click();check('Shared root becomes empty after physical transfer',p.locator('#library [data-track-root]').count()==0)
 close(p)

def progress(browser):
 p=base.page_for(browser,'overlay',size=(800,110))
 for elapsed,remaining in [(False,False),(False,True),(True,False)]:
  p.evaluate('(v)=>__overlay.emit("config",{mode:"persistent",showCover:false,showTitle:false,showArtist:false,showLabel:false,showControls:false,showElapsed:v[0],showRemaining:v[1],showProgress:true})',[elapsed,remaining])
  p.wait_for_timeout(40)
  result=p.locator('#progressWrap').bounding_box()
  check('Progress has usable width independently of time labels '+str((elapsed,remaining)),result and result['width']>150,result)
 shot(p,'295-independent-progress');close(p)

if __name__=='__main__':
 with sync_playwright() as pw:
  b=pw.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
  for fn in [menus,animation,gradients,presets,folders,progress]:
   try:fn(b)
   except Exception as e:
    print(traceback.format_exc(),flush=True);results.append({'name':fn.__name__,'passed':False,'detail':str(e)})
    for n,p in enumerate(b.contexts):
     for i,pg in enumerate(p.pages):
      try:pg.screenshot(path=str(OUT/f'295-failure-{fn.__name__}-{n}-{i}.png'))
      except Exception:pass
     p.close()
  b.close()
 (OUT/'features-295-browser.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(sum(r['passed'] for r in results),'passed',sum(not r['passed'] for r in results),'failed',flush=True)
 raise SystemExit(int(any(not r['passed'] for r in results)))
