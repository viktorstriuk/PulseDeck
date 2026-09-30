#!/usr/bin/env python3
"""2.9.4 actual Chromium UI/decoder checks with deterministic IPC fixtures.
No claim of live-provider availability or Windows Electron installation testing.
"""
import importlib.util, json, os, subprocess, tempfile, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]; OUT=R/'test-results/2.9.4';OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('base294',R/'tests/browser-regression.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
checks=[]
def check(name,value,detail=None):
 checks.append({'name':name,'passed':bool(value),'detail':detail});print(('PASS ' if value else 'FAIL ')+name,flush=True)
 if not value:raise AssertionError((name,detail))
def page(browser,size=(1280,900),theme='ocean',lang='ru'):
 p=browser.new_page(viewport={'width':size[0],'height':size[1]},bypass_csp=True);p.set_default_timeout(10000);p._errors=[];p.on('pageerror',lambda e:p._errors.append(str(e)))
 bridge='\n'.join((R/('tests/'+n)).read_text() for n in ['browser-bridge.js','search-browser-bridge.js','library-browser-bridge.js'])
 storage="window.__storage={};Object.defineProperty(window,'localStorage',{value:{getItem:k=>__storage[k]||null,setItem:(k,v)=>__storage[k]=v},configurable:true});"
 seed='Object.assign(__mock.settings,'+json.dumps({'theme':theme,'accent':'gold','language':lang})+');'
 html=(R/'app/renderer/index.html').read_text().replace('<head>',f'<head><base href="{base.BASE}/app/renderer/"><script>'+storage+bridge+seed+'</script>',1)
 capture="<script>for(const [key,field]of [['PulseTrackTools','__tools'],['PulseOnlineSearchUI','__search'],['PulseLyricsView','__lyrics']]){const Base=window[key];window[key]=class extends Base{constructor(...args){super(...args);window[field]=this;}};}</script>"
 html=html.replace('<script src="app.js"></script>',capture+'<script src="app.js"></script>');p.set_content(html)
 p.wait_for_selector('#library [data-track-root][data-id=t0]');p.wait_for_function('window.__tools && window.__search && window.__lyrics');return p
def close(p):
 check('No uncaught renderer exceptions',not p._errors,p._errors);p.close()
def shot(p,name,selector=None):
 (p.locator(selector) if selector else p).screenshot(path=str(OUT/(name+'.png')))
def menu(p):
 p.locator('#library [data-track-root][data-id=t0]').click(button='right');p.locator('[data-submenu-trigger=track-edit]').hover();p.wait_for_selector('[data-track-edit=title]',state='visible')
def picker(p):
 menu(p);p.locator('[data-track-cover]').click();p.wait_for_selector('.track-cover-picker')
def settled(p):p.wait_for_function('__tools.popup && !__tools.popup.loading')

def editing(browser):
 p=page(browser)
 for field,value in [('artist','Новый исполнитель'),('title','Новое название')]:
  menu(p);p.locator('[data-track-edit='+field+']').click();p.fill('.track-rename input',value)
  p.locator('.track-rename-form button[type=submit]').click();p.wait_for_selector('.track-rename',state='detached')
  check('Save click persists '+field,p.evaluate('__mock.tracks[0].'+field)==value)
  check('Closing '+field+' rename does not open search',p.evaluate('__search.mode')=='closed' and not p.locator('#searchPopover').is_visible())
  check('Rename restores a useful non-search focus',p.evaluate('document.activeElement.closest("[data-track-root],#library")!==null'))
 picker(p);settled(p);p.press('.cover-search-row input','Escape')
 check('Closing artwork picker does not open search',p.evaluate('__search.mode')=='closed')
 p.evaluate('async()=>{Object.assign(__mock.tracks[0],{sourceProvider:"youtube",sourceUrl:"https://www.youtube.com/watch?v=fixture1234"});await __tools.o.refresh();}')
 p.locator('#library [data-track-root][data-id=t0]').click(button='right')
 check('Trim button uses the shared scissors glyph',p.locator('[data-menu=trim] .scissors-icon').count()==1)
 close(p)

def search(browser):
 p=page(browser);p.focus('#searchInput');p.wait_for_selector('[data-source-toggle]')
 check('Source rail has exactly one button per source',p.evaluate('(()=>{const a=[...document.querySelectorAll("[data-source-toggle]")].map(x=>x.dataset.sourceToggle);return a.length===6&&a.length===new Set(a).size})()'))
 for _ in range(3):p.evaluate('__search.renderSources()')
 check('Rerendering does not duplicate SoundCloud',p.locator('[data-source-toggle=soundcloud]').count()==1)
 p.evaluate('''()=>{__search.discovery={enabled:true,items:[{track:{...__mock.tracks[0],artist:'Artist'},reason:'DiscoveryReasonArtist',value:'Artist'}]};__search.renderDiscovery();}''')
 p.locator('[data-discovery-search]').click()
 p.wait_for_function('__search.query==="Artist"')
 p.locator('.search-filter-toggle').click();p.wait_for_selector('#searchFiltersPanel',state='visible')
 check('Artist discovery only changes query, not filter values',p.locator('[data-search-filter=artist]').input_value()=='' and p.evaluate('Object.keys(__search.filters).length')==0)
 p.fill('[data-search-filter=album]','Deliberate album');p.evaluate('q=>{__search.closeAux(false);__search.setQuery(q,true)}','artist:"Another" track:"Song"')
 check('Query syntax does not backfill filter fields',p.locator('[data-search-filter=artist]').input_value()=='' and p.locator('[data-search-filter=track]').input_value()=='')
 check('Explicitly entered filters remain intact',p.locator('[data-search-filter=album]').input_value()=='Deliberate album')
 close(p)

def progress(browser):
 p=page(browser);p.evaluate('''()=>{const original=pulse.library.command;window.coverCalls=[];window.finishCover=null;
 const make=(id)=>({id,image:new URL('../assets/app-icons/sky-monitor.png',document.baseURI).href+'?'+id,title:id,artist:'Fixture',source:'Fixture'});
 pulse.library.command=async c=>{if(c.type!=='cover-search')return original(c);coverCalls.push(c);
 if(c.phase==='catalog')return {ok:true,items:[]};if(c.cursor)return {ok:true,items:[make('late-page'),make('first')],cursor:null};
 window.activeCoverRequest=c.requestId;setTimeout(()=>__toolsMock.progress({kind:'covers',requestId:c.requestId,items:[make('first')]}),20);
 return await new Promise(resolve=>window.finishCover=()=>resolve({ok:true,items:Array.from({length:36},(_,i)=>make(i===0?'first':'batch-'+i)),cursor:'page-two'}));};}''')
 picker(p);p.wait_for_selector('[data-cover-id=first]')
 check('A single result appears while other providers are still pending',p.evaluate('__tools.popup.loading') and p.locator('.cover-tile').count()==1)
 check('Search progress has an animated visible status region',p.locator('.cover-searching').is_visible() and p.locator('.cover-searching').evaluate('n=>getComputedStyle(n,"::before").animationName')=='cover-search-spin')
 shot(p,'294-artwork-progress','.track-cover-picker')
 p.evaluate('finishCover()');settled(p)
 check('Final response deduplicates the streamed first item',p.locator('[data-cover-id=first]').count()==1 and p.locator('.cover-tile').count()==36)
 p.locator('.cover-grid').evaluate('n=>{n.scrollTop=n.scrollHeight;n.dispatchEvent(new Event("scroll"));}')
 p.wait_for_selector('[data-cover-id=late-page]')
 check('Scrolling fetches the next cursor and appends, instead of replacing',p.evaluate('coverCalls.some(c=>c.cursor==="page-two")') and p.locator('.cover-tile').count()==37)
 p.evaluate('''()=>__toolsMock.progress({kind:'covers',requestId:'old-closed-request',items:[{id:'stale',image:'https://invalid.test/x.png'}]})''')
 check('Stale progress cannot pollute the current picker',p.locator('[data-cover-id=stale]').count()==0)
 p.emulate_media(reduced_motion='reduce');p.fill('.cover-search-row input','new query');p.wait_for_function('__tools.popup.loading')
 check('Reduced motion keeps status visible without spinning',p.locator('.cover-searching').evaluate('n=>getComputedStyle(n,"::before").animationName')=='none')
 p.keyboard.press('Escape');p.evaluate('finishCover()');p.wait_for_timeout(50)
 check('Completing a dismissed search cannot reopen it',p.locator('.track-cover-picker').count()==0 and p.evaluate('__search.mode')=='closed')
 close(p)

def updates(browser):
 for size,theme,lang in [((1280,900),'ocean','ru'),((800,760),'light','en')]:
  p=page(browser,size,theme,lang);p.click('#settingsBtn');p.click('[data-settings-page=updates]');p.wait_for_selector('#updatesInterval')
  check('Default interval displayed as 12 hours',p.locator('#updatesIntervalValue').input_value()=='12' and p.locator('#updatesIntervalUnit').input_value()=='hours')
  p.fill('#updatesIntervalValue','1,5');p.press('#updatesIntervalValue','Enter');p.wait_for_function('__mock.updatePrefs?.intervalMinutes===90')
  check('Decimal comma normalizes to 90 minutes',p.locator('#updatesIntervalValue').input_value()=='1.5')
  p.select_option('#updatesIntervalUnit','minutes');p.wait_for_function('__mock.updatePrefs?.intervalUnit==="minutes"')
  check('Changing units preserves duration',p.locator('#updatesIntervalValue').input_value()=='90' and p.evaluate('__mock.updatePrefs.intervalMinutes')==90)
  p.fill('#updatesIntervalValue','-40');p.press('#updatesIntervalValue','Enter');p.wait_for_function('__mock.updatePrefs.intervalMinutes===1')
  check('Negative number is corrected to a safe minimum',p.locator('#updatesIntervalValue').input_value()=='1')
  p.fill('#updatesIntervalValue','oops');p.press('#updatesIntervalValue','Enter');p.wait_for_function('document.querySelector("#updatesIntervalValue").value==="1"')
  check('Invalid text keeps last valid period',p.evaluate('__mock.updatePrefs.intervalMinutes')==1)
  p.fill('#updatesIntervalValue','999999999');p.press('#updatesIntervalValue','Enter');p.wait_for_function('__mock.updatePrefs.intervalMinutes===43200')
  p.select_option('#updatesIntervalUnit','days');p.wait_for_function('__mock.updatePrefs.intervalUnit==="days"')
  check('Overflow is clamped and displayed consistently as 30 days',p.locator('#updatesIntervalValue').input_value()=='30')
  p.locator('label:has(#updatesAuto)').click();p.wait_for_function('__mock.updatePrefs.automatic===false');check('Interval field collapses with automatic checks off',not p.locator('#updatesInterval').is_visible())
  p.locator('label:has(#updatesAuto)').click();p.wait_for_function('__mock.updatePrefs.automatic===true');check('Re-enabling restores the saved period',p.locator('#updatesIntervalValue').input_value()=='30')
  # Slow IPC must not lose the second of two quickly edited settings.
  p.evaluate('''()=>{const original=pulse.updates.configure;window.preferenceInFlight=0;window.maxPreferenceInFlight=0;pulse.updates.configure=async patch=>{maxPreferenceInFlight=Math.max(maxPreferenceInFlight,++preferenceInFlight);await new Promise(r=>setTimeout(r,100));try{return await original(patch);}finally{preferenceInFlight--;}};}''')
  p.fill('#updatesIntervalValue','2');p.select_option('#updatesIntervalUnit','hours');p.wait_for_function('__mock.updatePrefs.intervalMinutes===2880&&__mock.updatePrefs.intervalUnit==="hours"&&preferenceInFlight===0')
  check('Rapid value/unit edits are serialized without lost preferences',p.evaluate('maxPreferenceInFlight')==1 and p.locator('#updatesIntervalValue').input_value()=='48')
  check('Interval controls fit without horizontal overflow',p.locator('#updatesInterval').evaluate('n=>n.scrollWidth<=n.clientWidth+1'))
  p.evaluate('()=>__mock.emit("updates:changed",{phase:"idle",configured:true,current:"2.9.4",prefs:{...__mock.updatePrefs,components:true}})')
  shot(p,'294-updates-'+lang);close(p)

def drop(p,selector,filename,mime):
 p.evaluate('''([selector,name,type])=>{const dt=new DataTransfer();dt.items.add(new File(['fixture'],name,{type}));const target=document.querySelector(selector);for(const event of ['dragenter','dragover','drop'])target.dispatchEvent(new DragEvent(event,{dataTransfer:dt,bubbles:true,cancelable:true}));}''',[selector,filename,mime])

def media_and_lyrics(browser):
 p=page(browser);p.evaluate('''()=>{window.artworkDrops=[];pulse.library.setCoverFromDrop=async(file,rel,revision)=>{artworkDrops.push({name:file.name,type:file.type,rel,revision,isFile:file instanceof File});const t=__mock.tracks.find(x=>x.rel===rel);if((t.editRevision||null)!==revision)throw Error('revision');Object.assign(t,{coverType:file.type,coverUrl:new URL('../../tests/fixtures/artwork-294.'+(file.type.startsWith('video/')?'webm':'gif'),document.baseURI).href,editRevision:'drop-'+artworkDrops.length});return {ok:true,revision:t.editRevision};};}''')
 row='#library [data-track-root][data-id=t0]'
 drop(p,row,'original.gif','image/gif');p.wait_for_function('window.artworkDrops.length===1');p.wait_for_selector(row+' img[src$=".gif"]')
 check('Dropping GIF on a track routes the File directly, not an import job',p.evaluate('artworkDrops[0].isFile') and not p.evaluate('__toolsMock.calls.some(c=>c.type==="prepare-drop")'))
 check('GIF URL survives renderer refresh with original format',p.locator(row+' img[src$=".gif"]').evaluate('n=>n.complete&&n.naturalWidth===96'))
 picker(p);settled(p);drop(p,'.track-cover-picker','motion.webm','video/webm');p.wait_for_function('window.artworkDrops.length===2');p.wait_for_selector('.cover-tile.selected video')
 check('Dropping video inside picker saves and selects it',p.evaluate('__mock.tracks[0].coverType')=='video/webm' and p.locator('.cover-tile.selected').count()==1)
 p.keyboard.press('Escape');p.locator(row).click();p.wait_for_selector('#playerCover video');p.wait_for_function('document.querySelector("#playerCover video").readyState>=2')
 check('Player video is decodable, muted, looping and noninteractive',p.locator('#playerCover video').evaluate('v=>v.videoWidth===96&&v.muted&&v.defaultMuted&&v.loop&&!v.controls&&v.tabIndex===-1'))
 p.emulate_media(reduced_motion='reduce');p.wait_for_function('[...document.querySelectorAll("video[data-cover-media]")].every(v=>v.paused)')
 check('Reduced motion pauses decorative videos',p.locator('#playerCover video').evaluate('v=>v.paused'))
 p.emulate_media(reduced_motion='no-preference');p.wait_for_function('!document.querySelector("#playerCover video").paused')
 check('Video cover resumes independently of song playback',p.locator('#playerCover video').evaluate('v=>!v.paused'))
 # Per-frame observations verify that no fallback gradient is ever visible.
 p.evaluate('''()=>{const rel=__mock.tracks[0].rel;__mock.lyrics.records[rel]={doc:PulseLyrics.parse('[00:00.00]First line\\n[00:02.00]Second line',{kind:'lrc'}).doc,theme:{mode:'solid',background:'#123456',paletteSource:'manual'},revision:'theme-1'};__mock.lyrics.delays[rel]=350;window.lyricFrames=[];window.observeLyrics=true;function frame(){const v=document.querySelector('#lyricsView');if(!v.classList.contains('hidden'))lyricFrames.push({mode:v.dataset.background,base:v.style.getPropertyValue('--ly-base'),front:__lyrics.backdrop.front});if(observeLyrics)requestAnimationFrame(frame)}requestAnimationFrame(frame);}''')
 p.click('#lyricsBtn');p.wait_for_timeout(100)
 check('Lyrics stay hidden while saved presentation is pending',not p.locator('#lyricsView').is_visible() and p.locator('#lyricsBtn').get_attribute('aria-busy')=='true')
 p.wait_for_selector('#lyricsView:not(.hidden)');p.wait_for_function('lyricFrames.length>=3')
 check('Every first-open frame uses the saved solid colour, never a gradient',p.evaluate('lyricFrames.every(f=>f.mode==="solid"&&f.base==="#123456"&&f.front>=0)'),p.evaluate('lyricFrames'))
 shot(p,'294-lyrics-solid-first-frame');p.click('#lyricsCloseBtn')
 p.evaluate('''()=>{lyricFrames=[];__mock.lyrics.records[__mock.tracks[0].rel].theme={mode:'cover',paletteSource:'manual'};}''');p.click('#lyricsBtn');p.wait_for_selector('#lyricsView:not(.hidden) .ly-scene video');p.wait_for_function('lyricFrames.length>=3')
 check('Cover background first appears only after video decoder is ready',p.evaluate('lyricFrames.every(f=>f.mode==="cover"&&f.front>=0)') and p.locator('.ly-scene video').evaluate('v=>v.readyState>=2&&v.muted'))
 shot(p,'294-lyrics-video');p.click('#lyricsCloseBtn')
 p.click('#lyricsBtn');p.wait_for_timeout(40);p.click('#lyricsBtn');p.wait_for_timeout(500)
 check('Closing before decode/read completes cannot reopen lyrics',not p.locator('#lyricsView').is_visible() and p.evaluate('__lyrics.opened') is False)
 p.evaluate('''()=>{__mock.lyrics.records[__mock.tracks[0].rel].theme={mode:'solid',background:'#123456',paletteSource:'manual'};__mock.lyrics.delays[__mock.tracks[0].rel]=0;window.originalLoadCover=__lyrics.loadCover;window.resolveSlowArtwork=null;__lyrics.loadCover=()=>new Promise(resolve=>resolveSlowArtwork=resolve);}''')
 p.click('#lyricsBtn');p.wait_for_selector('#lyricsView:not(.hidden)',timeout=1500)
 check('Saved custom colour does not wait for unrelated slow artwork',p.evaluate('typeof resolveSlowArtwork==="function"') and p.locator('#lyricsView').evaluate('v=>v.dataset.background==="solid"&&v.style.getPropertyValue("--ly-base")==="#123456"'))
 p.click('#lyricsCloseBtn');p.evaluate('resolveSlowArtwork();__lyrics.loadCover=originalLoadCover;observeLyrics=false');close(p)

def decoder(browser):
 # Managed Chromium blocks file navigations here. Keep the production decoder
 # expression, adapting only its file URL to our local fixture HTTP server.
 # Electron's file-only CSP/BrowserWindow lifecycle is checked separately by
 # Node tests; this test does not claim to run the real Electron shell.
 p=browser.new_page(bypass_csp=True);p.set_default_timeout(20000);p.set_content((R/'app/library/cover-probe.html').read_text())
 def expression(file,video=False):
  code="""const {probeMedia}=require('./app/library/media-probe');class W{constructor(){this.webContents={setWindowOpenHandler(){},executeJavaScript(s){console.log(JSON.stringify(s));return Promise.resolve({width:1,height:1});}}}loadFile(){return Promise.resolve()}isDestroyed(){return false}destroy(){}}probeMedia(process.argv[1],{video:process.argv[2]==='true'},W).catch(e=>{console.error(e);process.exitCode=1});"""
  script=json.loads(subprocess.check_output(['node','-e',code,str(file),str(video).lower()],cwd=R,text=True))
  from urllib.parse import quote
  return script.replace(json.dumps(file.as_uri()),json.dumps(base.BASE+'/'+quote(file.relative_to(R).as_posix())))
 for filename,is_video in [('artwork-294.gif',False),('artwork-294.webm',True)]:
  result=p.evaluate(expression(R/'tests/fixtures'/filename,is_video));check('Production decoder accepts '+filename,result=={'width':96,'height':96})
 with tempfile.TemporaryDirectory(prefix='pd294-decoder-',dir=OUT) as directory:
  # Browser-generated fixture avoids a Pillow dependency in GitHub CI.
  data=p.evaluate('''async()=>{const c=document.createElement('canvas');c.width=6000;c.height=5000;c.getContext('2d').fillRect(0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1];}''')
  import base64
  file=Path(directory)/'large.png';file.write_bytes(base64.b64decode(data)+bytes(17*1024*1024))
  result=p.evaluate(expression(file));check('Production decoder accepts actual 30 MP / 17+ MB artwork',result=={'width':6000,'height':5000})
  file=Path(directory)/'broken.gif';file.write_bytes(b'GIF89a'+bytes(100));failed=False
  try:p.evaluate(expression(file))
  except Exception:failed=True
  check('Broken media is rejected without reintroducing byte/pixel limits',failed)
 p.close()

if __name__=='__main__':
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),args=['--no-sandbox','--allow-file-access-from-files'])
   for suite in [editing,search,progress,updates,media_and_lyrics,decoder]:
    try:suite(browser)
    except Exception:
     checks.append({'name':suite.__name__+' completes','passed':False,'detail':traceback.format_exc()})
     for i,p in enumerate(browser.contexts):
      for j,tab in enumerate(p.pages):
       try:tab.screenshot(path=str(OUT/f'294-failure-{suite.__name__}-{i}-{j}.png'))
       except Exception:pass
     raise
   browser.close()
 except Exception:
  traceback.print_exc();raise
 finally:
  (OUT/'browser-artwork-294.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2));print('CHECKS',len(checks),'FAILURES',sum(not x['passed'] for x in checks),flush=True)
