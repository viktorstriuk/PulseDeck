#!/usr/bin/env python3
"""Real Chromium rendering and real audio clock. IPC is an explicit deterministic fixture."""
import importlib.util,json,traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
spec=importlib.util.spec_from_file_location('reg',Path(__file__).with_name('browser-regression.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
OUT=r.OUT;check=r.check;pause=r.pause
TEXT=['Мы оставим огни за спиной','Снова слышу дыхание города','Время не ждёт у закрытой двери','Тихие улицы помнят шаги','Свет собирается в окнах домов','Эта мелодия рядом со мной','Здесь начинается новая строка','Музыка держит нас на плаву']
def seed(p,cover='lyrics-cover-dark',plain=False):
 p.evaluate('''async ({lines,cover,plain})=>{const base=new URL(document.baseURI).origin;__mock.playbackUrl=URL.createObjectURL(await (await fetch(base+'/tests/fixtures/lyrics-clock.wav')).blob());__mock.tracks[0].title='Ночная волна';__mock.tracks[0].artist='PulseDeck · Демонстрация';__mock.tracks[0].duration=64;__mock.tracks[0].coverUrl=cover?base+'/tests/fixtures/'+cover+'.png':'';const doc=PulseLyrics.normalize({theme:{mode:'gradient',background:'#26354b',gradientColors:['#26354b','#3a2442'],fontScale:100},lines:Array.from({length:28},(_,i)=>plain?{text:lines[i%lines.length]}:i===1?{startMs:3000,endMs:5500,segments:[{startMs:3000,text:'Снова '},{startMs:3700,text:'слышу дыхание '},{startMs:4600,text:'города'}]}:{startMs:1000+i*2000,endMs:2500+i*2000,text:lines[i%lines.length]})}).doc;__mock.lyrics.records[__mock.tracks[0].rel]={doc,theme:doc.theme,revision:'initial'};__mock.emit('library:changed');}''',{'lines':TEXT,'cover':cover,'plain':plain})
 pause(p,200);p.locator('#library [data-track-root]').first.dblclick();p.wait_for_function("document.querySelector('#audio').duration===64")
 p.evaluate("document.querySelector('#audio').pause()");p.locator('#lyricsBtn').click();p.wait_for_selector('.ly-line');pause(p,150)
def clock(p,t):
 p.evaluate('(t)=>{const a=document.querySelector("#audio");a.currentTime=t;a.dispatchEvent(new Event("timeupdate"));}',t);pause(p,80)
def test_clock_scroll(browser):
 p=r.page_for(browser);seed(p);clock(p,4)
 check('266 Microphone opens lyric canvas, keeps one audio and transport',p.locator('audio').count()==3 and p.locator('#lyricsBtn').get_attribute('aria-pressed')=='true' and p.locator('#player').is_visible())
 check('266 Word timing highlights only elapsed phrase, not future word',p.locator('.ly-active .ly-sung').count()==2 and p.locator('.ly-active [data-segment]').count()==3)
 active=p.locator('.ly-active');sung=active.locator('.ly-sung').first.evaluate('(e)=>getComputedStyle(e).color');unsung=active.locator('[data-segment]').last.evaluate('(e)=>getComputedStyle(e).color')
 check('266 Past and future fragments have visibly distinct colors',sung!=unsung,{'sung':sung,'future':unsung})
 p.screenshot(path=str(OUT/'40-lyrics-word-sync.png'))
 clock(p,4.7);check('266 Next word lights directly from real audio currentTime',p.locator('.ly-active .ly-sung').count()==3)
 clock(p,3.2);check('266 Backward seek removes future word highlights',p.locator('.ly-active .ly-sung').count()==1)
 p.locator('#lyricsWordMode').click();check('266 Line mode lights entire sparse phrase',p.locator('.ly-active .ly-sung').count()==3 and p.locator('#lyricsWordMode').get_attribute('aria-pressed')=='false')
 check('266 Word/line mode persisted as display setting only',p.evaluate("__mock.settings.lyricsDisplay.wordMode==='lines'"))
 p.locator('#lyricsWordMode').click();p.locator('#lyricsScroller').hover();p.mouse.wheel(0,1300);pause(p,350)
 top=p.locator('#lyricsScroller').evaluate('(e)=>e.scrollTop');check('266 Real wheel scroll moves freely and shows Synchronize',top>600 and p.locator('#lyricsResync').is_visible(),top)
 clock(p,6);top2=p.locator('#lyricsScroller').evaluate('(e)=>e.scrollTop');check('266 Audio progression does not wrestle manual scroll',abs(top2-top)<2)
 p.screenshot(path=str(OUT/'41-lyrics-manual-scroll.png'))
 p.locator('#lyricsResync').click();pause(p,300);check('266 Synchronize returns to current row and resumes following',not p.locator('#lyricsResync').is_visible() and p.locator('#lyricsScroller').evaluate('(e)=>e.scrollTop')<top-300)
 p.locator('#lyricsScroller').focus();p.keyboard.press('Control+a');check('266 Ctrl+A selects text, not hidden songs or playlists',p.evaluate("getSelection().toString().includes('Снова')") and p.locator('#library .track-selected').count()==0)
 p.evaluate('getSelection().removeAllRanges()');p.locator('[data-lyric-row="4"]').click();check('266 Clicking a timed row seeks without resuming paused audio',p.evaluate('Math.abs(audio.currentTime-9)<.1&&audio.paused'))
 clock(p,63);pause(p,350);near_end=p.locator('#lyricsScroller').evaluate('(e)=>e.scrollTop');clock(p,64);pause(p,300);check('266 End of song holds the last cue instead of jumping to the first',near_end>500 and p.locator('#lyricsScroller').evaluate('(e)=>e.scrollTop')>near_end-80)
 clock(p,1.2);pause(p,350);check('266 Restarting song returns directly to its first timed cue',p.locator('#lyricsScroller').evaluate('(e)=>e.scrollTop')<300)
 p.locator('#lyricsFocusBtn').click();check('267 Focus mode preserves transport and audio clock',p.locator('#player').is_visible());p.keyboard.press('Escape');check('266 Escape exits focus before closing lyrics',p.locator('#player').is_visible() and p.locator('#lyricsView').is_visible())
 p.locator('#lyricsCloseBtn').click();check('266 Closing returns to original library',p.locator('#library').is_visible() and not p.locator('#lyricsView').is_visible())
 check('266 Clock/scroll: no JavaScript errors',not p._errors,p._errors);p.close()
def test_themes(browser):
 p=r.page_for(browser);seed(p);clock(p,4)
 check('266 Gradient is default with a single compact mode icon',p.locator('#lyricsBackgroundMode').get_attribute('data-mode')=='gradient' and p.locator('#lyricsBackgroundMode').inner_text()=='')
 p.locator('#lyricsBackgroundMode').click();pause(p,150);check('266 Cover mode uses actual translucent cover with guaranteed contrast',p.locator('#lyricsView').get_attribute('data-background')=='cover' and float(p.locator('#lyricsView').get_attribute('data-contrast'))>=4.5)
 check('266 Dark cover selects white active text',p.locator('#lyricsView').get_attribute('data-foreground')=='white')
 p.screenshot(path=str(OUT/'42-lyrics-dark-cover.png'))
 p.locator('#lyricsBackgroundMode').click();check('266 Cover cycles to a single main color',p.locator('#lyricsView').get_attribute('data-background')=='solid');p.locator('#lyricsBackgroundMode').click()
 p.locator('#lyricsSettingsBtn').click();p.locator('#lyricsAddColor').click();p.locator('#lyricsAddColor').click();check('266 Gradient supports 2–4 colors and stops at four',p.locator('.ly-gradient-stop').count()==4 and p.locator('#lyricsAddColor').is_disabled())
 p.locator('#lyricsGradientAngle').evaluate('(e)=>{e.value=240;e.dispatchEvent(new Event("input"));}');p.locator('#lyricsFontScale').evaluate('(e)=>{e.value=120;e.dispatchEvent(new Event("input"));}');p.screenshot(path=str(OUT/'43-lyrics-gradient-settings.png'))
 p.locator('#lyricsSettingsSave').click();pause(p,150);check('266 Theme colors, angle and text scale saved per recording',p.evaluate("Object.values(__mock.lyrics.records)[0].theme.gradientColors.length===4&&Object.values(__mock.lyrics.records)[0].theme.gradientAngle===240&&Object.values(__mock.lyrics.records)[0].theme.fontScale===120"))
 p.locator('#lyricsSettingsBtn').click();p.locator('#lyricsFontScale').evaluate('(e)=>{e.value=65;e.dispatchEvent(new Event("input"));}');p.keyboard.press('Escape');check('268 Closing appearance keeps immediately applied scale',p.locator('#lyricsView').evaluate("e=>e.style.getPropertyValue('--ly-scale')")== '0.65')
 p.locator('#lyricsEditBtn').click();draft=json.loads(p.locator('#lyricsInput').input_value());check('266 Editing text preserves the most recently saved gradient',draft['theme']['gradientAngle']==240 and draft['theme']['fontScale']==65 and len(draft['theme']['gradientColors'])==4);p.locator('#lyricsEditorClose').click()
 check('266 Settings: no JavaScript errors',not p._errors,p._errors);p.close()
 p=r.page_for(browser);seed(p,'lyrics-cover-light');p.locator('#lyricsBackgroundMode').click();clock(p,4);check('266 Bright cover selects black text',p.locator('#lyricsView').get_attribute('data-foreground')=='black');p.screenshot(path=str(OUT/'44-lyrics-light-cover.png'));p.close()
 p=r.page_for(browser,size=(800,600));seed(p,'');check('266 No cover means only single and gradient choices, no placeholder-as-cover',p.locator('#lyricsBackgroundMode').get_attribute('data-available')=='gradient,solid');p.locator('#lyricsBackgroundMode').click();p.locator('#lyricsBackgroundMode').click();check('266 Missing cover mode never entered',p.locator('#lyricsView').get_attribute('data-background')=='gradient');clock(p,4);p.screenshot(path=str(OUT/'45-lyrics-compact.png'));check('266 Compact controls stay within window',p.locator('#lyricsCloseBtn').bounding_box()['x']+p.locator('#lyricsCloseBtn').bounding_box()['width']<=800 and p.locator('#lyricsBtn').is_visible());p.close()
 p=r.page_for(browser);seed(p,'cover-does-not-exist');pause(p,300);check('266 Failed cover decode removes Cover from the cycle without an error popup',p.locator('#lyricsBackgroundMode').get_attribute('data-available')=='gradient,solid' and not p._errors)
 p.evaluate("__mock.lyrics.records[__mock.tracks[0].rel].theme.mode='cover'");p.locator('#lyricsCloseBtn').click();p.locator('#lyricsBtn').click();p.wait_for_selector('.ly-line');pause(p,200);p.locator('#lyricsBackgroundMode').click();check('266 A saved but unavailable cover falls back and switches to solid on the first click',p.locator('#lyricsView').get_attribute('data-background')=='solid');p.close()
def test_editor(browser):
 p=r.page_for(browser);seed(p,'',True);check('266 Unsynced lyrics scroll with no fake highlight, word switch disabled',p.locator('#lyricsWordMode').is_disabled() and p.locator('.ly-active').count()==0)
 p.locator('#lyricsScroller').hover();p.mouse.wheel(0,900);pause(p,200);check('266 Unsynced text scrolls without sync button',p.locator('#lyricsScroller').evaluate('(e)=>e.scrollTop')>500 and not p.locator('#lyricsResync').is_visible())
 p.locator('#lyricsEditBtn').click();p.locator('#lyricsRawBtn').click();p.locator('#lyricsInput').fill('(00:01):"One 😀00:02😀group of words"\n{00:05}:"Next"')
 p.locator('#lyricsPreviewBtn').click();check('266 Compact marker preview recognizes phrase and counts lines','С фрагментами: 1' in p.locator('#lyricsImportSummary').inner_text())
 p.keyboard.press('Control+a');p.keyboard.press('Control+c');check('266 Editor selection never affects hidden library',p.locator('#library .track-selected').count()==0)
 p.locator('#lyricsTimingBtn').click();check('266 Timing editor has per-line start/end and suppression control',p.locator('.ly-timing-row').count()==2 and p.locator('.ly-no-gap input').nth(1).is_checked())
 clock(p,1.5);p.locator('#lyricsStampNext').click();check('266 Stamp uses real clock and moves cursor to next phrase',p.locator('.ly-timing-row.current').get_attribute('data-timing-row')=='1' and p.locator('.ly-timing-row .ly-time-field[data-time-key="startMs"]').first.get_attribute('data-value')=='1500')
 p.screenshot(path=str(OUT/'46-lyrics-timing-editor.png'));p.locator('#lyricsSaveBtn').click();p.wait_for_function("!document.querySelector('#lyricsEditor').open");clock(p,2.7);check('266 Saved phrase timing is actually used by display',p.locator('.ly-active').inner_text()=='One group of words')
 p.locator('#lyricsEditBtn').click();saved=p.evaluate('JSON.stringify(__mock.lyrics.records)');p.locator('#lyricsRawBtn').click();p.locator('#lyricsInput').fill('{bad json');p.locator('#lyricsSaveBtn').click();check('266 Invalid import keeps editor open with error and saved data intact',p.locator('#lyricsEditor').evaluate('(e)=>e.open') and bool(p.locator('#lyricsEditorError').inner_text()) and p.evaluate('JSON.stringify(__mock.lyrics.records)')==saved)
 p.locator('#lyricsEditorClose').click();p.locator('#lyricsConfirmYes').click();p.locator('#lyricsEditBtn').click();p.locator('#lyricsRawBtn').click();p.locator('#lyricsInput').fill(json.dumps({'recordingId':'f'*64,'lines':[{'text':'Imported'}]}));p.locator('#lyricsSaveBtn').click();check('266 Mismatched audio identity requires explicit confirmation','Подтверди' in p.locator('#lyricsEditorError').inner_text());p.locator('#lyricsAllowMismatch').check();p.locator('#lyricsSaveBtn').click();p.wait_for_function("!document.querySelector('#lyricsEditor').open")
 p.locator('#lyricsEditBtn').click();p.locator('#lyricsExportBtn').click();p.locator('[data-lyrics-export="lrc"]').click();pause(p);check('266 LRC export is exposed as a deliberate lossy choice',p.evaluate("__mock.calls.some(c=>c.name==='lyrics'&&c.value.type==='export-text'&&c.value.format==='lrc')"))
 p.locator('#lyricsZipBtn').click();check('266 AI package requires consent and warns about open audio',p.locator('#lyricsConfirmText').inner_text().find('открытая копия')>=0);p.locator('#lyricsConfirmYes').click();pause(p);check('266 Confirmed ZIP invokes explicit export only',p.evaluate("__mock.calls.filter(c=>c.name==='lyrics'&&c.value.type==='export-package').length===1"))
 check('266 Editor: no JavaScript errors',not p._errors,p._errors);p.close()
def test_search_races(browser):
 p=r.page_for(browser);seed(p);p.locator('#lyricsEditBtn').click();p.locator('#lyricsSourceBtn').click();check('266 Opening search never sends request automatically',p.evaluate("!__mock.calls.some(c=>c.name==='lyrics'&&c.value.type==='search')"))
 p.evaluate("__mock.lyrics.results=[{id:1,title:'Версия',artist:'Артист',album:'Live',duration:70,delta:6,instrumental:false,synced:'[00:01]Пример строки',plain:'',url:'https://lrclib.net/api/get/1'}]")
 p.locator('#lyricsSearchSubmit').click();p.wait_for_selector('.ly-result');check('266 Provider displays synchronization and duration mismatch', 'Есть синхронизация' in p.locator('.ly-result').inner_text() and 'отличается' in p.locator('.ly-result').inner_text());p.locator('.ly-result button').click();check('266 Found text opens editable preview, does not overwrite immediately',p.locator('#lyricsEditor').evaluate('(e)=>e.open') and 'отличается' in p.locator('#lyricsImportSummary').inner_text());p.locator('#lyricsEditorClose').click()
 p.locator('#lyricsEditBtn').click();p.locator('#lyricsSourceBtn').click();p.locator('#lyricsGoogle').click();check('266 Browser search goes through external URL with no audio',p.evaluate("__mock.calls.some(c=>c.name==='openExternal'&&c.value.startsWith('https://www.google.com/search?q='))"));p.locator('#lyricsSearchClose').click()
 p.locator('#lyricsCloseBtn').click();p.evaluate("__mock.lyrics.delays[__mock.tracks[0].rel]=500");p.locator('#lyricsBtn').click();p.locator('#lyricsCloseBtn').click();p.locator('#library [data-track-root]').nth(1).dblclick();p.locator('#lyricsBtn').click();pause(p,700)
 check('266 Late previous-track response never paints into next track',p.locator('#lyricsTitle').inner_text().startswith('02') and p.locator('#lyricsLines').inner_text()=='')
 p.locator('#lyricsPasteBtn').click();p.locator('#lyricsInput').fill('<img src=x onerror=window.PWNED=1>\nПросто текст');p.locator('#lyricsSaveBtn').click();p.wait_for_selector('.ly-line');check('266 Imported markup rendered as text, not HTML',p.locator('#lyricsLines img').count()==0 and p.evaluate('window.PWNED===undefined'))
 p.evaluate("__mock.emit('lyrics:locked')");pause(p);check('266 Unrelated vault lock does not discard public lyrics', 'Просто текст' in p.locator('#lyricsLines').inner_text())
 check('266 Search/races: no JavaScript errors',not p._errors,p._errors);p.close()
def test_drop(browser):
 for side in [False,True]:
  p=r.page_for(browser)
  if side:p.evaluate("__mock.settings.categoryLayout='side';__mock.emit('library:changed')");p.locator('#settingsBtn').click();pause(p);p.locator('#settingsModal .close-modal').click() if p.locator('#settingsModal .close-modal').count() else p.keyboard.press('Escape')
  # actual layout is driven by the existing switch, not the fixture object alone
  if side:
   p.close();stored=r.page_for(browser);settings=stored.evaluate('__mock.settings');stored.close();settings['categoryLayout']='side';p=r.page_for(browser,stored={'pd-test-settings':json.dumps(settings)})
  rail='#categorySidebar' if side else '#categoryChips';target=p.locator(rail+' [data-category="favorite"]');tr=target.bounding_box();a=p.locator('#library [data-track-root]').nth(1).bounding_box()
  p.mouse.move(a['x']+40,a['y']+a['height']/2);p.mouse.down();p.mouse.move(a['x']+60,a['y']+a['height']/2,steps=2);p.mouse.move(tr['x']+tr['width']/2,tr['y']+tr['height']/2,steps=15);pause(p,140)
  ghost=p.locator('.track-drag-ghost').bounding_box();rr=p.locator(rail).bounding_box();check('266 '+('Side' if side else 'Top')+' ghost cannot overlap playlist rail',(ghost['x']>=rr['x']+rr['width']+10) if side else (ghost['y']>=rr['y']+rr['height']+10),{'ghost':ghost,'rail':rr})
  check('266 '+('Side' if side else 'Top')+' real pointer still highlights intended target',target.evaluate("e=>e.classList.contains('track-drop-target')"))
  style=target.evaluate('e=>({radius:getComputedStyle(e).borderRadius,outline:getComputedStyle(e).outlineStyle})');check('266 '+('Side' if side else 'Top')+' drop highlight rounded, no rectangular outline',style['radius']=='12px' and style['outline']=='none',style)
  badge=target.locator('.drop-target-badge').bounding_box();check('266 '+('Side' if side else 'Top')+' small add badge fully inside the visible rail',badge['y']>=rr['y'] and badge['y']+badge['height']<=rr['y']+rr['height'])
  before=p.locator('.track-drag-ghost').bounding_box();p.mouse.move(tr['x']+tr['width']/2+(0 if side else 75),tr['y']+tr['height']/2+(24 if side else 0),steps=10);pause(p,60);after=p.locator('.track-drag-ghost').bounding_box()
  check('266 '+('Side' if side else 'Top')+' visual clone continues on the free axis without crossing the rail',abs(after['x']-before['x'])<1 and after['y']>before['y'] if side else abs(after['y']-before['y'])<1 and after['x']>before['x'],{'before':before,'after':after})
  p.mouse.move(tr['x']+tr['width']/2,tr['y']+tr['height']/2,steps=10);pause(p,60)
  p.screenshot(path=str(OUT/('48-drop-side.png' if side else '47-drop-top.png')))
  p.mouse.up();pause(p,250);check('266 '+('Side' if side else 'Top')+' release adds exactly held track',p.evaluate("__mock.calls.some(c=>c.name==='organize'&&c.value.type==='bulk-add'&&c.value.key==='favorite'&&c.value.rels.length===1&&c.value.rels[0]==='Old artist/song-1.wav')"))
  check('266 '+('Side' if side else 'Top')+' no stranded clone, target, plus or edit mode',p.locator('.track-drag-ghost,.track-drop-target,[data-track-drop-plus]').count()==0 and not p.locator('body').evaluate("e=>e.classList.contains('category-edit-mode')"))
  check('266 '+('Side' if side else 'Top')+' drag: no JavaScript errors',not p._errors,p._errors);p.close()
if __name__=='__main__':
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
   for test in [test_clock_scroll,test_themes,test_editor,test_search_races,test_drop]:
    try:test(browser)
    except Exception as e:
     r.RESULTS.append({'name':test.__name__,'passed':False,'error':str(e),'trace':traceback.format_exc()});print(traceback.format_exc(),flush=True)
     for c in browser.contexts:
      for p in c.pages:
       try:p.screenshot(path=str(OUT/('failure-266-'+test.__name__+'.png')),timeout=8000)
       except:pass
    finally:
     for c in browser.contexts:c.close()
   browser.close()
 finally:r.server.shutdown()
 report={'environment':'Chromium, real media clock, actual HTML/CSS/JS, deterministic IPC fixture; no native Windows', 'passed':sum(x['passed'] for x in r.RESULTS),'failed':sum(not x['passed'] for x in r.RESULTS),'checks':r.RESULTS}
 (OUT/'browser-lyrics-266.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print('RESULT',report['passed'],'passed',report['failed'],'failed');raise SystemExit(bool(report['failed']))
