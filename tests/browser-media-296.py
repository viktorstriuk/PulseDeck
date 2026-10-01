#!/usr/bin/env python3
"""Actual renderer/media graph, clip controls, UI layout and async ownership.
IPC/network/device enumeration is deterministic; native acceptance is separate.
"""
import importlib.util,json,os,subprocess,traceback,re
from pathlib import Path
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1];OUT=R/'test-results/2.9.6';OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('base296',R/'tests/browser-regression.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
results=[]
def check(name,value,detail=None):
 results.append({'name':name,'passed':bool(value),'detail':detail});print(('PASS ' if value else 'FAIL ')+name,flush=True)
 if not value:raise AssertionError((name,detail))
def page(browser,size=(1366,960),seed=''):
 p=browser.new_page(viewport={'width':size[0],'height':size[1]},bypass_csp=True);p.set_default_timeout(15000);p._errors=[];p.on('pageerror',lambda e:p._errors.append(str(e)))
 # SimpleHTTPRequestHandler does not implement byte ranges. Chromium otherwise
 # reports seekable=[0,0] and clamps every seek to zero. Exercise the same 206
 # contract as file:// and the existing private-media range server, not a
 # monkey-patched media clock.
 def media_range(route):
  file=R/route.request.url.split(base.BASE+'/',1)[-1]
  data=file.read_bytes();size=len(data);header=route.request.headers.get('range','')
  headers={'Access-Control-Allow-Origin':'*','Accept-Ranges':'bytes','Content-Type':'audio/wav' if file.suffix=='.wav' else 'video/webm'}
  match=re.fullmatch(r'bytes=(\d*)-(\d*)',header)
  if not match:return route.fulfill(status=200,headers=headers,body=data)
  lo=int(match[1]) if match[1] else max(0,size-int(match[2]));hi=min(size-1,int(match[2]) if match[1] and match[2] else size-1)
  if lo>hi:return route.fulfill(status=416,headers={**headers,'Content-Range':f'bytes */{size}'})
  route.fulfill(status=206,headers={**headers,'Content-Range':f'bytes {lo}-{hi}/{size}'},body=data[lo:hi+1])
 p.route(re.compile(re.escape(base.BASE)+r'/.*\.(wav|webm)$'),media_range)
 bridge='\n'.join((R/('tests/'+n)).read_text() for n in ['browser-bridge.js','search-browser-bridge.js','library-browser-bridge.js','features-295-browser-bridge.js','media-296-browser-bridge.js'])
 storage="window.__storage={};Object.defineProperty(window,'localStorage',{value:{getItem:k=>__storage[k]||null,setItem:(k,v)=>__storage[k]=v},configurable:true});"
 initial="Object.assign(__mock.settings,{theme:'ocean',accent:'gold',language:'ru',sort:'manual'});Object.assign(__mock.tracks[0],{title:'Signal Drift',duration:64,artist:'PulseDeck test recording',coverUrl:new URL('../assets/app-icons/sunset-monitor.png',document.baseURI).href});"
 html=(R/'app/renderer/index.html').read_text().replace('<head>',f'<head><base href="{base.BASE}/app/renderer/"><script>'+storage+bridge+initial+seed+'</script>',1)
 capture="<script>for(const [key,field]of [['PulseTrackTools','__tools'],['PulseLyricsView','__lyrics'],['PulseSoundUI','__soundUI'],['PulseMusicVideoUI','__video'],['PulseOnlineSearchUI','__search']]){const B=window[key];window[key]=class extends B{constructor(...args){super(...args);window[field]=this;}};}</script>"
 html=html.replace('<script src="app.js"></script>',capture+'<script src="app.js"></script>');p.set_content(html);p.wait_for_selector('#library [data-track-root][data-id=t0]');p.wait_for_function('window.__soundUI&&window.__video');p.evaluate('async()=>{__mock.playbackUrl=URL.createObjectURL(await (await fetch(__mock.playbackUrl)).blob());}');return p

def close(p):check('No uncaught renderer exception',not p._errors,p._errors);p.close()
def shot(p,name,selector=None):(p.locator(selector) if selector else p).screenshot(path=str(OUT/(name+'.png')),timeout=10000)
def select(p):
 p.locator('#library [data-track-root][data-id=t0]').click();p.wait_for_function('document.querySelector("#audio").readyState>=2&&!document.querySelector("#audio").paused')
def pause(p):p.evaluate('__video.transport.pause()')
def open_editor(p):
 p.click('#videoBtn');p.wait_for_selector('#musicVideoSearch[open] .pd-video-result');p.locator('.pd-video-result').first.click();p.wait_for_function('__video.editor?.prepared&&!__video.editor.busy');p.wait_for_function('document.querySelector("#clipPreview").readyState>=2')

def keyed_navigation(browser):
 p=page(browser);p.evaluate('window.railNodes=[...document.querySelectorAll("#categoryChips [data-category],#categorySidebar [data-category]")];window.railSVG=railNodes.map(n=>n.querySelector("svg"))')
 for key in ['favorite','custom:0','all','favorite','all']:p.locator('#categoryChips [data-category="'+key+'"]').click()
 check('Playlist navigation preserves button and SVG identity instead of rebuilding DOM',p.evaluate('railNodes.every((n,i)=>n.isConnected&&n.querySelector("svg")===railSVG[i])'))
 # Real folder edit/create/navigation, then repeat click in the active folder.
 p.locator('#categoryChips [data-category=all]').click(button='right');p.locator('[data-category-command=move]').click();p.locator('[data-add-folder]').first.click();p.fill('#categoryNameInput','Studio');p.click('#categoryStyleSave');p.wait_for_selector('[data-folder-back]');p.keyboard.press('Escape')
 p.evaluate('window.folderButtons=[...document.querySelectorAll("#categoryChips [data-category]")]');p.locator('#categoryChips [data-category$="|favorite"]').click();p.locator('#categoryChips [data-category$="|all"]').click()
 check('Folder playlist buttons retain identity across selections',p.evaluate('folderButtons.every(n=>n.isConnected)'))
 close(p)

def sound_settings(browser):
 p=page(browser);select(p);pause(p);p.click('#settingsBtn');p.click('[data-settings-page=sound]')
 check('Sound section defaults to operating-system output',p.locator('#soundDevice').input_value()=='')
 p.select_option('#soundDevice','speakers');p.wait_for_function('__mock.settings.sound.deviceId==="speakers"');check('Output choice persists and routes the one shared context',p.evaluate('__mock.sinks.at(-1)==="speakers"'))
 p.evaluate('__mock.devices.push({kind:"audiooutput",deviceId:"headset",label:"USB Headphones"});navigator.mediaDevices.dispatchEvent(new Event("devicechange"))');p.wait_for_selector('#soundDeviceNotice');check('New device offers one-click switch with its actual label','USB Headphones' in p.locator('#soundDeviceNotice').inner_text());p.locator('#soundDeviceNotice .primary').click();p.wait_for_function('__mock.settings.sound.deviceId==="headset"')
 p.evaluate('__mock.devices=__mock.devices.filter(x=>x.deviceId!=="headset");navigator.mediaDevices.dispatchEvent(new Event("devicechange"))');p.wait_for_function('__mock.sinks.at(-1)===""');check('Disconnected device falls back to system output without discarding preference',p.evaluate('__mock.settings.sound.deviceId==="headset"'))
 p.check('#soundNormalize');p.select_option('#soundReference','fixed');p.locator('#soundTargetLUFS').fill('-24');p.locator('#soundTargetLUFS').dispatch_event('change');p.wait_for_function('__mock.settings.sound.targetLUFS===-24')
 p.wait_for_function('__soundUI.sound.gain(__video.transport.audio)<-5');check('Loudness correction is a separate gain with dB display',p.evaluate('__soundUI.sound.gain(__video.transport.audio)===-6&&__video.transport.volume===__soundUI.sound.master'))
 p.evaluate('window.masterNode=document.querySelector("#volume");masterNode.focus();masterNode.value=31;masterNode.dispatchEvent(new Event("input",{bubbles:true}));__soundUI.sound.setProfile(__video.transport.audio,{lufs:-8,peakDB:-1},"late-analysis")')
 check('Late normalization never fights or replaces the user volume thumb',p.evaluate('masterNode===document.querySelector("#volume")&&masterNode.value==="31"&&document.activeElement===masterNode'))
 shot(p,'296-sound-settings','[data-settings-panel=sound]')
 p.locator('#soundTest').click();p.wait_for_function('document.querySelector("#soundTest").disabled');p.wait_for_function('!document.querySelector("#soundTest").disabled',timeout=15000)
 check('Test sound uses the selected recording through the common graph and cleans its source',p.evaluate('[...__soundUI.sound.entries.values()].filter(e=>e.role==="test").every(e=>!e.element.getAttribute("src")&&e.element.paused)'))
 close(p)

def video_flow(browser):
 p=page(browser);select(p);pause(p);open_editor(p);shot(p,'296-video-editor','#musicVideoEditor')
 check('Editor exposes independent trim and sync without native video controls',p.locator('#clipPreview').evaluate('v=>!v.controls') and p.locator('#clipAutoSync').is_visible())
 p.fill('#clipStart','1');p.fill('#clipEnd','17');p.fill('#clipOffset','2');p.fill('#clipRate','100');p.locator('#clipAutoSync').click();p.wait_for_function('!__video.editor.busy')
 check('Auto sync applies a reported match and preserves independent trim',p.locator('#clipOffset').input_value()=='2' and p.locator('#clipStart').input_value()=='1.00')
 p.evaluate('__mock.syncResult={matched:false,reason:"different-edit"}');p.click('#clipAutoSync');p.wait_for_function('!__video.editor.busy');check('Uncertain auto sync leaves manual mapping unchanged',p.locator('#clipOffset').input_value()=='2')
 p.locator('#clipPlay').click();p.wait_for_function('!document.querySelector("#clipPreview").paused');check('Clip preview obeys the same master volume',p.evaluate('document.querySelector("#clipPreview").volume===__video.transport.volume'))
 p.locator('#clipHearAudio').click();p.wait_for_function('!document.querySelector("#clipReferenceAudio").paused');check('Reference comparison cannot play both sources at once',p.evaluate('document.querySelector("#clipPreview").paused'))
 p.check('#clipAsBackground');p.click('#clipSave');p.wait_for_function('!__video.editor');p.keyboard.press('Escape');p.wait_for_function('!!__video.transport.clip')
 check('Saving associates video and lyrics backdrop with the track, not its artwork',p.evaluate('__video.record.musicVideo.ref===__video.record.theme.customBackground&&__mock.tracks[0].coverUrl.endsWith("sunset-monitor.png")'))
 # Raw duration stays 64s while the clip controls expose its own shorter duration.
 p.evaluate('__video.transport.currentTime=4');p.click('#videoBtn');p.wait_for_function('__video.transport.videoMode');check('Toggle maps audio time into clip time and preserves pause',p.evaluate('Math.abs(__video.transport.currentTime-5)<.1&&__video.transport.paused'))
 check('Video mode has only the video surface and existing player',p.locator('#musicVideoStage').is_visible() and p.locator('#musicVideo').evaluate('v=>!v.controls') and p.locator('.player').is_visible())
 check('Video pair level is matched even with global normalization off',p.evaluate('__soundUI.sound.gain(__video.transport.video)===-6'))
 shot(p,'296-video-mode')
 p.evaluate('__mock.emit("hotkey:action",{action:"toggleVideo",source:"global"})');p.wait_for_function('!__video.transport.videoMode');check('Configurable video hotkey switches back to aligned audio',p.evaluate('Math.abs(__video.transport.currentTime-4)<.12'))
 p.evaluate('__video.transport.currentTime=32');p.click('#videoBtn');p.wait_for_timeout(150);check('No-overlap switch does not jump to an unrelated end position',p.evaluate('!__video.transport.videoMode&&__video.transport.currentTime>31'))
 p.evaluate('__video.transport.currentTime=3');p.click('#playBtn');p.wait_for_function('!__video.transport.paused');p.click('#videoBtn');p.wait_for_function('__video.transport.videoMode&&!__video.transport.paused');p.wait_for_function('__video.transport.audio.paused');check('Playing handover leaves exactly one raw source playing',p.evaluate('!__video.transport.video.paused&&__video.transport.audio.paused'))
 p.keyboard.press('Escape');p.wait_for_function('!__video.transport.videoMode');check('Clip duration never overwrites audio library metadata',p.evaluate('__video.currentTrack().duration===64'))
 p.click('#lyricsBtn');p.wait_for_function('__lyrics.opened&&!__lyrics.loading');p.wait_for_function('__lyrics.backdrop.front>=0');p.wait_for_function('!__lyrics.backdrop.busy');p.wait_for_timeout(400)
 check('Associated lyrics video is muted and follows song time instead of looping independently',p.evaluate('(()=>{const v=__lyrics.backdrop.layers[__lyrics.backdrop.front].image;return v.tagName==="VIDEO"&&v.muted&&!v.loop&&Math.abs(v.currentTime-(__video.transport.audioTime+1))<.3;})()'))
 close(p)

def background_search(browser):
 p=page(browser);select(p);pause(p);p.click('#lyricsBtn');p.wait_for_function('__lyrics.opened&&!__lyrics.loading');p.click('#lyricsSettingsBtn');p.wait_for_selector('#lyricsSettings[open]');shot(p,'296-lyrics-search-actions','#lyricsSettings')
 p.click('#lyricsBackgroundFind');p.wait_for_selector('[data-track-tools-popover] [data-cover-id=background-result]');p.locator('[data-cover-id=background-result]').click();p.wait_for_function('__lyrics.customBackground?.type==="image/png"')
 check('Find background reuses the cover picker but invokes only lyrics-background storage',p.evaluate('__mock.mediaCalls.some(c=>c.action==="background-select")&&!__mock.calls.some(c=>c.value?.type==="cover-select")&&__mock.tracks[0].coverUrl.endsWith("sunset-monitor.png")'))
 close(p)

def responsive_and_menus(browser):
 for size in [(800,760),(1280,900)]:
  p=page(browser,size,seed="__mock.settings.theme='light';" if size[0]==800 else '')
  select(p);pause(p);p.locator('#library [data-track-root][data-id=t0]').click(button='right');p.wait_for_selector('[data-normalize-track]');p.locator('[data-normalize-track]').click();p.wait_for_function('__mock.settings.sound?.reference==="manual"');check('Track context menu sets an explicit normalization reference',p.evaluate('__mock.settings.sound.manualLUFS===-18'))
  open_editor(p);p.locator('#clipSave').scroll_into_view_if_needed();shot(p,'296-video-editor-'+str(size[0]),'#musicVideoEditor');check('Narrow editor stays within viewport and save remains reachable',p.locator('#clipSave').evaluate('n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}'))
  p.click('#clipCancel');p.keyboard.press('Escape');p.locator('#categoryChips [data-category=all]').click(button='right');p.locator('[data-submenu-trigger=enrich]').hover();p.wait_for_selector('[data-video-batch]',state='visible');p.locator('[data-video-batch]').click();p.wait_for_selector('#musicVideoSearch[open]')
  check('Playlist video search asks before sending its track names',p.evaluate('!!__video.batch&&!__mock.mediaCalls.some(c=>c.action==="search"&&c.rel!==__mock.tracks[0].rel)'))
  p.keyboard.press('Escape');close(p)


def rms(p):
 return p.evaluate("""async()=>{const a=__soundUI.sound.analyser,data=new Float32Array(a.fftSize);let sum=0;for(let i=0;i<12;i++){a.getFloatTimeDomainData(data);sum+=data.reduce((s,x)=>s+x*x,0)/data.length;await new Promise(r=>setTimeout(r,25));}return Math.sqrt(sum/12)}""")

def sound_signal_and_races(browser):
 p=page(browser);select(p)
 p.evaluate('__soundUI.sound.setMaster(.5,false)');p.wait_for_timeout(120);a=rms(p)
 p.evaluate('__soundUI.sound.setMaster(.25,false)');p.wait_for_timeout(120);b=rms(p)
 check('Decoded local audio really follows master gain, not just slider properties',a>.015 and .46<b/a<.54,{'half':a,'quarter':b})
 p.evaluate('__soundUI.sound.setMaster(.25,true)');p.wait_for_timeout(120);check('Mute silences the actual shared signal',rms(p)<1e-6)
 p.evaluate('__soundUI.sound.setMaster(.25,false);__soundUI.sound.configure({enabled:true,reference:"fixed",targetLUFS:-24});__soundUI.sound.setProfile(__video.transport.audio,{lufs:-18,peakDB:-4},__video.currentTrack().rel)');p.wait_for_timeout(300);c=rms(p)
 check('Measured normalization attenuates actual decoded samples independently of master',.46<c/b<.54 and p.evaluate('__video.transport.volume===.25'),{'ratio':c/b})
 # Refresh settings on the current source must not remove already applied gain.
 p.evaluate('__soundUI.settings=PulseMedia.sound({enabled:true,reference:"fixed",targetLUFS:-24});__mock.profileDelay=500;__soundUI.cache.clear();window.refreshProfile=__soundUI.prepareTrack(__video.currentTrack(),__video.transport.audio)')
 check('Refreshing a current profile never briefly removes existing attenuation',p.evaluate('__soundUI.sound.gain(__video.transport.audio)===-6'));p.evaluate('refreshProfile');p.evaluate('__mock.profileDelay=0')
 p.evaluate('__soundUI.sound.configure({enabled:true,reference:"first-played"});__soundUI.sound.setTarget(-22);__soundUI.sound.configure({...__soundUI.sound.settings,toleranceDB:1})')
 check('Changing tolerance preserves the selected first-played reference',p.evaluate('__soundUI.sound.target===-22'))
 p.evaluate('__soundUI.settings=PulseMedia.sound();__soundUI.sound.configure({enabled:false})');pause(p);open_editor(p);p.click('#clipPlay');p.wait_for_function('!document.querySelector("#clipPreview").paused');a=rms(p)
 p.evaluate('__soundUI.sound.setMaster(.125,false)');p.wait_for_timeout(120);b=rms(p)
 check('Decoded clip preview uses the same master signal path',a>.006 and .46<b/a<.54,{'ratio':b/a})
 p.click('#clipCancel');p.keyboard.press('Escape')
 # Install a known mapping through the same renderer API, then suspend a single
 # async resume to reproduce pause/track changes during handover deterministically.
 p.evaluate('async()=>{const t=__video.currentTrack(),r={revision:"race",musicVideo:{url:__mock.clipURL,ref:"race",duration:18,offset:0,rate:1,profile:{lufs:-18,peakDB:-4}}};await __video.acceptRecord(t,r);await __video.pairPreparation;__video.transport.currentTime=2;}')
 p.click('#playBtn');p.wait_for_function('!__video.transport.paused')
 p.evaluate('()=>{const sound=__soundUI.sound;window.realResume=sound.resume.bind(sound);sound.resume=()=>new Promise(r=>window.resumeHandover=r);window.switchResult=__video.transport.toggle().catch(e=>e.name);}')
 p.wait_for_function('!!window.resumeHandover')
 p.evaluate('__video.transport.pause();__soundUI.sound.resume=realResume;resumeHandover()');p.evaluate('switchResult')
 check('Pausing during asynchronous handover cannot restart an inactive video',p.evaluate('__video.transport.paused&&__video.transport.video.paused&&!__video.transport.videoMode'))
 p.evaluate('()=>{__soundUI.sound.resume=()=>new Promise(r=>window.resumePlay=r);window.playResult=__video.transport.play().catch(e=>e.name);}')
 p.wait_for_function('!!window.resumePlay');p.evaluate('__video.transport.pause();__soundUI.sound.resume=realResume;resumePlay()')
 check('Pausing while the output route resumes also cancels a pending ordinary play',p.evaluate('playResult')=='AbortError' and p.evaluate('__video.transport.audio.paused&&__video.transport.video.paused'))
 close(p)

def download_with_video(browser):
 p=page(browser);select(p);pause(p);p.fill('#searchInput','Signal Drift');p.wait_for_selector('#onlineResults .online-download');p.locator('#onlineResults .online-download').first.click();p.wait_for_selector('#trimModal:not(.hidden)')
 p.locator('#trimStart').fill('3');p.locator('#trimStart').dispatch_event('input');p.locator('#trimEnd').fill('15');p.locator('#trimEnd').dispatch_event('input')
 p.click('#trimPreviewToggle');p.wait_for_function('!document.querySelector("#trimPreviewAudio").paused');p.evaluate('__soundUI.sound.setMaster(.25,false)');p.wait_for_timeout(120);a=rms(p)
 p.evaluate('__soundUI.sound.setMaster(.125,false)');p.wait_for_timeout(120);b=rms(p)
 check('Audio trim preview obeys actual common master attenuation',a>.005 and .46<b/a<.54,{'ratio':b/a})
 p.click('#trimAddVideo');p.wait_for_function('__video.editor?.prepared&&!__video.editor.busy');p.wait_for_function('document.querySelector("#clipPreview").readyState>=2')
 check('Audio download offers a second independent video crop with same-source mapping',p.evaluate('__video.editor.audioDraft.start===3&&__video.editor.audioDraft.end===15&&__video.editor.offset===3'))
 p.fill('#clipStart','1');p.fill('#clipEnd','17');p.evaluate('__mock.mediaFailSave=true');p.click('#clipSave');p.wait_for_function('__video.editor?.audioResult&&!__video.editor.busy');check('A failed video save retains one successful audio download',p.evaluate('__mock.downloadCount===1&&__mock.lastAudioDownload.options.start===3&&__mock.lastAudioDownload.options.end===15'))
 shot(p,'296-video-save-retry','#musicVideoEditor');p.click('#clipSave');p.wait_for_function('!__video.editor');check('Retry saves the video without downloading or duplicating the audio again',p.evaluate('__mock.downloadCount===1&&__mock.lyrics.records["new-download-1.wav"].musicVideo.offset===2&&__mock.lyrics.records["new-download-1.wav"].musicVideo.duration===16'))
 check('Successful paired save closes the original audio trim session',p.locator('#trimModal.hidden').count()==1)
 # Existing online-result preview also uses the same decoded path.
 p.fill('#searchInput','Signal Drift');p.wait_for_selector('#onlineResults .online-preview-btn');p.locator('#onlineResults .online-preview-btn').first.click();p.wait_for_function('!document.querySelector("#onlinePreviewAudio").paused');p.evaluate('__soundUI.sound.setMaster(.25,false)');p.wait_for_timeout(120);a=rms(p)
 p.evaluate('__soundUI.sound.setMaster(.125,false)');p.wait_for_timeout(120);b=rms(p);check('Search preview obeys actual common master attenuation',a>.005 and .46<b/a<.54,{'ratio':b/a})
 close(p)

def empty_sound_and_hotkeys(browser):
 p=page(browser);p.click('#settingsBtn');p.click('[data-settings-page=hotkeys]');p.wait_for_selector('[data-hotkey-row=toggleVideo]');check('Video action is present in editable hotkey settings','Alt' in p.locator('[data-hotkey-row=toggleVideo]').inner_text())
 p.locator('[data-record-hotkey=toggleVideo]').click();p.keyboard.press('Control+Alt+v');p.wait_for_function('__mock.settings.hotkeys.toggleVideo==="Ctrl+Alt+V"');check('Custom video shortcut persists through the existing registration contract',p.evaluate('__mock.settings.hotkeys.toggleVideo==="Ctrl+Alt+V"'))
 p.click('[data-settings-page=sound]');p.evaluate('async()=>{__mock.tracks=[];await __mock.emit("library:changed");}');p.wait_for_timeout(150);p.click('#soundTest');p.wait_for_function('document.querySelector("#soundTest").disabled');p.wait_for_timeout(160);value=rms(p);check('Empty-library test emits a real, quiet reference tone',0<value<.06,value);p.wait_for_function('!document.querySelector("#soundTest").disabled');check('Empty-library tone cleans up without resuming a nonexistent track',p.evaluate('[...__soundUI.sound.entries.values()].filter(e=>e.role==="test").every(e=>e.element.paused&&!e.element.getAttribute("src"))'));close(p)

def localized_media(browser):
 p=page(browser);select(p);pause(p);open_editor(p)
 p.fill('#clipStart','1.25');p.fill('#clipEnd','15.5');p.fill('#clipOffset','2.125');p.evaluate('window.savedClipNode=document.querySelector("#clipPreview");window.savedOffsetField=document.querySelector("#clipOffset")')
 p.evaluate('pulse.i18n.setLanguage("en")');p.wait_for_function('PulseI18n.language==="en"');p.wait_for_timeout(120)
 check('Language switch preserves clip editor nodes and unsaved trim/sync values',p.evaluate('savedClipNode===document.querySelector("#clipPreview")&&savedOffsetField===document.querySelector("#clipOffset")&&savedOffsetField.value==="2.125"&&__video.editor.start===1.25&&__video.editor.end===15.5'))
 def untranslated():return p.evaluate('''()=>{const out=[];for(const root of document.querySelectorAll('#musicVideoEditor,#musicVideoSearch,[data-settings-panel="sound"]')){const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const n=walker.currentNode;if(/[А-Яа-яЁё]/.test(n.nodeValue))out.push(n.nodeValue.trim());}for(const e of [root,...root.querySelectorAll('[title],[aria-label],[placeholder]')])for(const a of ['title','aria-label','placeholder'])if(/[А-Яа-яЁё]/.test(e.getAttribute(a)||''))out.push(e.getAttribute(a));}return out;}''')
 remaining=untranslated();check('Open media editor and sound settings relocalize owned labels and accessibility text',not remaining,remaining)
 shot(p,'296-video-editor-en','#musicVideoEditor');p.click('#clipCancel');p.wait_for_selector('#musicVideoSearch[open]');remaining=untranslated();check('Retained video search relocalizes without rebuilding or losing service results',not remaining and p.locator('.pd-video-result').count()==2,remaining)
 close(p)

if __name__=='__main__':
 ffmpeg=os.environ.get('PULSEDECK_TEST_FFMPEG','/usr/bin/ffmpeg')
 subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','testsrc2=size=384x216:rate=12:duration=18','-f','lavfi','-i','sine=frequency=440:sample_rate=24000:duration=18','-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-threads','1','-c:a','libopus','-y',str(OUT/'session.webm')],check=True)
 subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=24000:duration=64','-y',str(OUT/'session.wav')],check=True)
 with sync_playwright() as pw:
  b=pw.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
  for fn in [keyed_navigation,sound_settings,video_flow,background_search,responsive_and_menus,sound_signal_and_races,download_with_video,empty_sound_and_hotkeys,localized_media]:
   try:fn(b)
   except Exception as e:
    print(traceback.format_exc(),flush=True);results.append({'name':fn.__name__,'passed':False,'detail':str(e)})
    for context in b.contexts:
     for i,p in enumerate(context.pages):
      try:p.screenshot(path=str(OUT/f'296-failure-{fn.__name__}-{i}.png'),timeout=5000)
      except Exception:pass
     context.close()
  b.close()
 (OUT/'media-browser.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(sum(r['passed'] for r in results),'passed',sum(not r['passed'] for r in results),'failed',flush=True)
 raise SystemExit(int(any(not r['passed'] for r in results)))
