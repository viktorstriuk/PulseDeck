#!/usr/bin/env python3
"""Actual app/installer renderer, simulated IPC, local HTTP resources. No Windows claims."""
import importlib.util,json,os,traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/2.8.0';OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('base',ROOT/'tests/browser-regression.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
RESULTS=[]
def check(name,condition,detail=None):
 ok=bool(condition);RESULTS.append({'name':name,'passed':ok,**({'detail':detail} if detail is not None else {})});print(('PASS ' if ok else 'FAIL ')+name,flush=True)
 if not ok:raise AssertionError((name,detail))
def shot(p,name):p.screenshot(path=str(OUT/(name+'.png')),omit_background=True)
def calls(p,name):return p.evaluate('(name)=>__mock.calls.filter(x=>x.type===name||x[0]===name)',name)
def visible_box(p,sel):
 n=p.locator(sel);n.scroll_into_view_if_needed();r=n.bounding_box();v=p.viewport_size
 return r and r['x']>=0 and r['y']>=0 and r['x']+r['width']<=v['width']+1 and r['y']+r['height']<=v['height']+1
catalogs={c:json.loads((ROOT/f'app/languages/{c}.json').read_text())['messages'] for c in ['ru','en']}
def installer_page(browser,size=(1020,742),language='ru',mode='install',theme='dark',existing=False,preferred=None,languages=None,extra_catalogs=None):
 languages = languages or [{**json.loads((ROOT/f'app/languages/{c}.json').read_text())['meta'],'iconUrl':base.BASE+'/app/languages/icons/'+c+'.svg'} for c in ['en','ru']]
 cfg={'version':base.VERSION,'language':language,'languages':languages,'systemLanguages':preferred or ['en-US'],'catalogs':{**catalogs,**(extra_catalogs or {})},'target':r'C:\Users\Tester\AppData\Local\Programs\PulseDeck','mode':mode,'existing':existing,'places':[{'key':'SetupHome','path':r'C:\Users\Tester'},{'key':'SetupApplications','path':r'C:\Users\Tester\AppData\Local\Programs'}]}
 bridge=r'''window.__setup={events:[],cb:null,closed:0};window.setup={bootstrap:async()=>(BOOTSTRAP),inspect:async()=>({existing:true}),folders:async folder=>{if(folder==='bad')throw Error('SetupErrorPath');return {folder,parent:'C:\\Users\\Tester',items:[{name:'PulseDeck',path:folder+'\\PulseDeck'},{name:'<img src=x onerror=alert(1)>',path:folder+'\\literal-name'}]};},execute:async r=>{__setup.events.push(r);return new Promise(resolve=>{__setup.finish=resolve;});},minimize:async()=>{__setup.minimized=true},close:async()=>{__setup.closed++},launch:async()=>{__setup.launched=true;return true;},onProgress:cb=>{__setup.cb=cb;}};'''.replace('BOOTSTRAP',json.dumps(cfg))
 p=browser.new_page(viewport={'width':size[0],'height':size[1]},bypass_csp=True,color_scheme=theme);p._errors=[];p.on('pageerror',lambda e:p._errors.append(str(e)));p.set_default_timeout(8000)
 html=(ROOT/'installer/ui/index.html').read_text().replace('<head>',f'<head><base href="{base.BASE}/installer/ui/"><script>{bridge}</script>',1)
 p.set_content(html);p.wait_for_selector('body.ready');p.wait_for_timeout(800);return p

def suite(browser):
 p=base.page_for(browser,size=(1440,1000));p.click('#settingsBtn');p.click('#settingsAbout');p.wait_for_timeout(250)
 check('About: bottom app card opens About instead of an external page',p.locator('#aboutPanel').is_visible())
 check('About: author name and MIT appear',p.locator('#aboutPanel').inner_text().count('MusheP')>=1 and 'MIT' in p.locator('#aboutPanel').inner_text())
 check('About: provided author artwork loads at natural 640px',p.locator('.author-art img').evaluate('n=>n.naturalWidth===640'))
 check('About: all five social buttons use branded SVG masks',p.locator('.author-social').count()==5 and p.locator('.brand-glyph').evaluate_all("ns=>ns.every(n=>getComputedStyle(n).maskImage.includes('/assets/credits/'))"))
 expected=['https://github.com/viktorstriuk','https://www.youtube.com/@mushep','https://t.me/mushepchannel','https://www.twitch.tv/themushep','https://www.tiktok.com/@themushep']
 for name,url in zip(['github','youtube','telegram','twitch','tiktok'],expected):
  p.locator('[data-social='+name+']').click();check('About: exact '+name+' URL',p.evaluate('url=>JSON.stringify(__mock.calls).includes(url)',url))
 check('About: four credit accordions are collapsed initially',p.locator('#creditsGroups .credits-group').count()==4 and p.locator('#creditsGroups .credits-group[open]').count()==0)
 shot(p,'280-about-ru')
 for group,num in [('icons',3),('runtime',4),('audio',4),('development',2)]:
  p.locator(f'[data-credit-group={group}] summary').click();check('Credits: '+group+' opens all resources',p.locator(f'[data-credit-group={group}][open] .credit-resource').count()==num)
  check('Credits: '+group+' uses provided link.svg',p.locator(f'[data-credit-group={group}] .resource-link-glyph').evaluate_all("ns=>ns.every(n=>getComputedStyle(n).maskImage.includes('/assets/ui/link.svg'))"))
  if group=='icons':
   p.locator('[data-credit-group=icons] .credit-resource').first.click();check('Credits: SVG Repo link is the requested PD section',p.evaluate("JSON.stringify(__mock.calls).includes('https://www.svgrepo.com/page/licensing/#PD')"));shot(p,'280-credits-ru')
  p.locator(f'[data-credit-group={group}] summary').click()
 p.click('[data-settings-page=updates]');p.wait_for_timeout(120)
 check('Updates: missing repository is not advertised as current',p.locator('#updatesStatusCard').get_attribute('data-phase')=='unconfigured' and 'актуаль' not in p.locator('#updatesStatus').inner_text().lower())
 check('Updates: beta channel is opt-in',not p.locator('#updatesPrerelease').is_checked())
 p.click('#updatesCheck');check('Updates: manual action wired to backend',p.evaluate("JSON.stringify(__mock.calls).includes('updates:check')"))
 p.locator('label:has(#updatesAuto)').click();p.wait_for_timeout(60);check('Updates: auto-check can be disabled and retained',not p.locator('#updatesAuto').is_checked())
 p.locator('label:has(#updatesPrerelease)').click();p.wait_for_timeout(60);check('Updates: prerelease explicit opt-in retained',p.locator('#updatesPrerelease').is_checked() and not p.locator('#updatesAuto').is_checked())
 shot(p,'280-updates-unconfigured')
 base_state={'configured':True,'current':'2.8.0','available':'2.8.1','lastCheck':0,'prefs':{'automatic':True,'prerelease':False,'components':True}}
 def emit(phase,**kwargs):p.evaluate("s=>__mock.emit('updates:changed',s)",{**base_state,'phase':phase,**kwargs});p.wait_for_timeout(70)
 emit('available',notes={'ru':'<img src=x onerror="alert(1)">\nТестовый список изменений','en':'Test changes'})
 check('Updates: independent immediate/deferred download actions visible',p.locator('#updatesDownloadNow').is_visible() and p.locator('#updatesDownloadLater').is_visible())
 check('Updates: release notes are plain text, never executed HTML',p.locator('#updatesNotes img').count()==0 and '<img' in p.locator('#updatesNotes').text_content())
 check('Updates: available toast offered once per version',p.locator('.update-notice').count()==1);emit('available');check('Updates: repeated event does not duplicate toast',p.locator('.update-notice').count()==1)
 p.click('#updatesDownloadLater');check('Updates: deferred mode sent explicitly',p.evaluate("JSON.stringify(__mock.calls).includes('next-launch')"))
 p.click('#updatesDownloadNow');check('Updates: immediate mode sent explicitly',p.evaluate("JSON.stringify(__mock.calls).includes('restart')"))
 emit('downloading',progress=47);check('Updates: downloading progress accessible and visible',p.locator('#updatesProgress').get_attribute('aria-valuenow')=='47' and p.locator('#updatesProgressWrap').is_visible())
 check('Updates: channel controls blocked during download',p.locator('#updatesPrerelease').is_disabled());p.click('#updatesCancel');check('Updates: cancel remains reachable',p.evaluate("JSON.stringify(__mock.calls).includes('updates:cancel')"));shot(p,'280-updates-progress')
 emit('ready',pendingMode='next-launch');check('Updates: ready state has cancel-deferral and install actions',p.locator('#updatesClearDeferred').is_visible() and p.locator('#updatesInstall').is_visible())
 p.click('#updatesInstall');check('Updates: install delegates to guarded main process',p.evaluate("JSON.stringify(__mock.calls).includes('updates:install')"))
 emit('error',error='UPDATE_BAD_SIGNATURE');check('Updates: invalid signatures show an explicit localized error',p.locator('#updatesError').is_visible() and 'UPDATE_BAD_SIGNATURE' not in p.locator('#updatesError').inner_text())
 p.evaluate("()=>{pulse.updates.check=async()=>{throw Error('UPDATE_NETWORK_ERROR')}}");p.click('#updatesCheck');p.wait_for_timeout(80);check('Updates: IPC errors survive final UI rerender',p.locator('#updatesError').is_visible() and bool(p.locator('#updatesError').inner_text()))
 p.evaluate("__mock.emit('updates:prepare-install',{token:'safe-token'})");check('Updates: clean playback can acknowledge install',p.evaluate("JSON.stringify(__mock.calls).includes('safe-token') && JSON.stringify(__mock.calls.at(-1)).includes('true')"))
 p.evaluate("(()=>{const d=document.createElement('dialog');d.id='dirty-test';document.body.append(d);d.showModal();__mock.emit('updates:prepare-install',{token:'blocked-token'});d.close();d.remove()})()")
 check('Updates: open editor/dialog prevents restart acknowledgement',p.evaluate("JSON.stringify(__mock.calls.at(-1)).includes('blocked-token') && JSON.stringify(__mock.calls.at(-1)).includes('false')"))
 p.evaluate("__mock.emit('components:changed',{phase:'current',items:[{id:'ffmpeg',version:'9.0.1',installed:true,available:'9.0.2',rollback:true},{id:'ytdlp',installed:false}]})")
 check('Components: pair shows installed and approved versions', '9.0.1' in p.locator('[data-component=ffmpeg]').inner_text() and '9.0.2' in p.locator('[data-component=ffmpeg]').inner_text())
 p.click('[data-component=ffmpeg] [data-component-action=rollback]');check('Components: explicit rollback action sent',p.evaluate("JSON.stringify(__mock.calls).includes('components:rollback')"))
 p.evaluate("()=>{pulse.components.install=async()=>{throw Error('COMPONENT_BUSY')}}");p.click('[data-component=ytdlp] [data-component-action=install]');p.wait_for_timeout(100);check('Components: busy errors are visible and translated',p.locator('#componentsError').is_visible() and 'COMPONENT_BUSY' not in p.locator('#componentsError').inner_text())
 p.evaluate("__mock.emit('components:changed',{phase:'downloading',active:'ytdlp',progress:31,items:[]})");check('Components: own progress/cancel does not block music controls',p.locator('#componentsProgressWrap').is_visible() and not p.locator('#componentsCancel').is_disabled());p.click('#componentsCancel')
 check('App: no JavaScript errors in About/updates interaction',not p._errors,p._errors);p.close()
 for size,lang,theme in [((1440,1000),'en','light'),((900,660),'ru','nord'),((800,760),'en','dark')]:
  st={'theme':theme,'language':lang,'accent':'blue','view':'grid','sort':'recent','gameOverlay':{'mode':'off'},'playerOverlay':{'mode':'off','visualizer':False}}
  p=base.page_for(browser,size=size,stored={'pd-test-settings':json.dumps(st)});p.click('#settingsBtn');p.click('#settingsAbout');p.wait_for_timeout(250)
  label=f'App {size[0]} {lang} {theme}'
  check(label+': About scrolls without horizontal overflow',p.locator('#aboutPanel').evaluate('n=>n.scrollWidth<=n.clientWidth+1'))
  for social in ['github','youtube','telegram','twitch','tiktok']:check(label+': '+social+' button fits',visible_box(p,'[data-social='+social+']'))
  p.locator('#aboutPanel').evaluate('n=>n.scrollTop=0');shot(p,f'280-about-{size[0]}-{lang}')
  p.click('[data-settings-page=updates]');p.wait_for_timeout(200);check(label+': updates panel has no horizontal overflow',p.locator('[data-settings-panel=updates]').evaluate('n=>n.scrollWidth<=n.clientWidth+1'));check(label+': manual check is reachable',visible_box(p,'#updatesCheck'));shot(p,f'280-updates-{size[0]}-{lang}')
  check(label+': no page errors',not p._errors,p._errors);p.close()
 for size,lang in [((1020,742),'ru'),((1020,742),'en'),((800,600),'ru')]:
  p=installer_page(browser,size,lang);label=f'Installer {size[0]} {lang}'
  check(label+': custom floating icon protrudes above body but stays inside window',p.evaluate("(()=>{const i=document.querySelector('.floating-logo').getBoundingClientRect(),b=document.querySelector('.setup-shell').getBoundingClientRect();return i.top>=0&&i.left>=0&&i.top<b.top&&i.bottom>b.top&&i.right<innerWidth})()"))
  check(label+': no native select or file-input controls',p.locator('select,input[type=file]').count()==0)
  check(label+': install button fully reachable',visible_box(p,'#install'));check(label+': title buttons inside window',visible_box(p,'#close') and visible_box(p,'#minimize'))
  p.locator('.flow-pane').evaluate('n=>n.scrollTop=0');shot(p,f'280-installer-{size[0]}-{lang}')
  p.click('#browse');p.wait_for_timeout(100);check(label+': custom directory chooser opens',p.locator('#folderDialog').is_visible());check(label+': directory names cannot insert HTML',p.locator('#folderList img').count()==0 and '<img' in p.locator('#folderList').inner_text());check(label+': choose-folder button reachable',visible_box(p,'#useFolder'))
  if size[0]==1020 and lang=='ru':shot(p,'280-installer-folder')
  p.click('#useFolder');check(label+': selected directory set without native dialogs',p.locator('#targetPath').input_value().endswith('Programs\\PulseDeck'))
  p.click('#install');p.evaluate("__setup.cb({phase:'installing',percent:64,done:29,total:43})");check(label+': installation locks close and language during transaction',p.locator('#close').is_disabled() and p.locator('[data-language=en]').is_disabled());check(label+': real phase/progress reflected',p.locator('#setupProgress').get_attribute('aria-valuenow')=='64')
  if size[0]==1020 and lang=='ru':shot(p,'280-installer-progress')
  p.evaluate("__setup.cb({phase:'done',target:'C:\\Programs\\PulseDeck'});__setup.finish({ok:true})");p.wait_for_timeout(80);check(label+': success screen has launch and close',p.locator('#launch').is_visible() and not p.locator('#close').is_disabled());p.click('#launch');check(label+': launch action wired',p.evaluate('!!__setup.launched'))
  check(label+': no page errors',not p._errors,p._errors);p.close()
 p=installer_page(browser);p.click('#browse');p.fill('#folderPath','bad');p.locator('#folderForm').evaluate('n=>n.requestSubmit()');p.wait_for_timeout(100);check('Installer: invalid directory displays an inline error',not p.locator('#folderError').get_attribute('hidden'));p.click('#folderCancel');p.click('#install');p.evaluate("__setup.cb({phase:'error',error:'SetupErrorIntegrity'});__setup.finish({ok:false,error:'SetupErrorIntegrity'})");p.wait_for_timeout(80);check('Installer: integrity failure never offers launch',not p.locator('#launch').is_visible() and p.locator('#retry').is_visible());p.click('#retry');check('Installer: retry returns to intact welcome',p.locator('#welcomeView').is_visible());p.close()
 p=installer_page(browser,mode='uninstall');check('Uninstaller: custom UI hides directory picker and desktop option',not p.locator('#browse').is_visible() and not p.locator('.checkbox-card').is_visible());check('Uninstaller: install target is read-only',p.locator('#targetPath').evaluate('n=>n.readOnly'));p.click('#install');p.evaluate("__setup.cb({phase:'removed'});__setup.finish({ok:true})");p.wait_for_timeout(80);check('Uninstaller: never offers launching removed executable',not p.locator('#launch').is_visible());p.close()
 p=installer_page(browser);p.evaluate("()=>{const f=setup.folders;setup.folders=async folder=>{if(folder.endsWith('Programs'))throw Error('SetupErrorPath');return f(folder);};}");p.click('#browse');p.wait_for_timeout(120)
 check('Installer: missing Programs folder falls back to home',p.locator('#folderPath').input_value()==r'C:\Users\Tester')
 check('Installer: fallback chooser has no false error',not p.locator('#folderError').is_visible());p.close()
 p=installer_page(browser);p.emulate_media(reduced_motion='reduce');check('Installer: reduced motion disables decorative animations',p.locator('.signal-art span').first.evaluate('n=>getComputedStyle(n).animationName')=='none');p.close()

if __name__=='__main__':
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),args=['--no-sandbox']);suite(browser);browser.close()
 finally:
  (OUT/'browser-release-280.json').write_text(json.dumps(RESULTS,ensure_ascii=False,indent=2));print('CHECKS',len(RESULTS),'FAILURES',sum(not r['passed'] for r in RESULTS),flush=True)
