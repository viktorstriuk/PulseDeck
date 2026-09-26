#!/usr/bin/env python3
"""Real renderer, synthetic audio, controlled IPC. Production files are not instrumented."""
import importlib.util,json,traceback,os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('regression',ROOT/'tests/browser-regression.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
OUT=r.OUT;check=r.check;pause=r.pause
# Test-only capture after scripts load but before app creates the view. No production hooks.
original=(ROOT/'app/renderer/index.html').read_text()

def page_for(b,size=(1440,960),cover=True):
 p=b.new_page(viewport={'width':size[0],'height':size[1]},bypass_csp=True);p.set_default_timeout(6500);p._errors=[];p.on('pageerror',lambda e:p._errors.append(str(e)))
 bridge=(ROOT/'tests/browser-bridge.js').read_text()+";__mock.settings.accent='clay';";storage="window.__storage={};Object.defineProperty(window,'localStorage',{value:{getItem:k=>window.__storage[k]||null,setItem:(k,v)=>window.__storage[k]=v},configurable:true});"
 html=original.replace('<head>',f'<head><base href="{r.BASE}/app/renderer/"><script>'+storage+bridge+'</script>',1).replace('<script src="app.js"></script>','<script>const capture=PulseLyricsView.prototype.initStudio;PulseLyricsView.prototype.initStudio=function(){window.__lv=this;return capture.call(this);};</script><script src="app.js"></script>')
 p.set_content(html);p.wait_for_selector('#library [data-track-root]');p.wait_for_function('!!window.__lv');pause(p,150)
 p.evaluate('''async cover=>{const base=new URL(document.baseURI).origin;__mock.playbackUrl=URL.createObjectURL(await(await fetch(base+'/tests/fixtures/lyrics-clock.wav')).blob());__mock.tracks[0].duration=64;__mock.tracks[0].title='Ночная волна';__mock.tracks[0].artist='PulseDeck · Демонстрация';__mock.tracks[0].coverUrl=cover?base+'/tests/fixtures/lyrics-cover-dark.png':'';__mock.emit('library:changed');}''',cover)
 pause(p);p.locator('#library [data-track-root]').first.dblclick();p.wait_for_function('audio.duration===64');p.evaluate('audio.pause()');p.locator('#lyricsBtn').click();p.wait_for_function('__lv.recordingId && !__lv.loading');pause(p)
 return p

def done(p,label):check('268 '+label+' / no page errors',not p._errors,p._errors);p.close()
def snapshot(p,name):p.screenshot(path=str(OUT/name),animations='disabled')
def draft(p,text):
 p.locator('#lyricsEditBtn').click() if p.locator('#lyricsEditBtn').is_enabled() and p.evaluate('!!__lv.doc') else p.locator('#lyricsPasteBtn').click()
 if p.locator('#lyricsRawBtn').is_visible():p.locator('#lyricsRawBtn').click()
 p.locator('#lyricsInput').fill(text);p.locator('#lyricsTimingBtn').click();pause(p,100)
def field(p,row,key='startMs'):return p.locator(f'.ly-time-field[data-time-row="{row}"][data-time-key="{key}"]')
def saved(p):return p.evaluate('__mock.lyrics.records[__lv.track.rel]')
def times(p):return p.evaluate('__lv.editDraft.lines.map(r=>r.startMs)')
def change(p,selector,value):p.locator(selector).evaluate('(n,v)=>{n.value=v;n.dispatchEvent(new Event("input",{bubbles:true}));}',str(value))
TEXT='[00:03]Тихий ветер в открытом окне\n[00:09]Город медленно смотрит на нас\n[00:16]Мы оставим огни за спиной\n[00:23]Эта музыка рядом с тобой\n[00:29]Ночь встречает своими огнями\n[00:38]Там где звёзды идут над домами\n[00:48]И последний фонарь не погас'

def test_autosave(b):
 p=page_for(b);p.locator('#lyricsSettingsBtn').click();change(p,'#lyricsFontScale',120)
 check('268 Font changes immediately before any save click',p.locator('#lyricsView').evaluate("n=>n.style.getPropertyValue('--ly-scale')")== '1.2')
 p.wait_for_function('__mock.lyrics.records[__lv.track.rel]?.theme.fontScale===120');check('268 Appearance-only autosave persists without inventing text',saved(p)['doc'] is None)
 change(p,'#lyricsPrimaryColor','#774422');p.locator('#lyricsGap').select_option('5000');p.locator('#lyricsLater').click();p.locator('#lyricsSettingsClose').click()
 p.wait_for_function('__mock.lyrics.records[__lv.track.rel].theme.background==="#774422"');p.locator('#lyricsSettingsBtn').click()
 check('268 Close flushes color and timing preferences instead of reverting',p.locator('#lyricsPrimaryColor').input_value()=='#774422' and p.locator('#lyricsGap').input_value()=='5000' and '0,10' in p.locator('#lyricsOffsetValue').inner_text())
 check('268 Saved state explicitly shown', 'автоматически' in p.locator('#lyricsAutosaveStatus').inner_text())
 snapshot(p,'60-settings-autosave.png');p.locator('#lyricsSettingsClose').click();p.locator('#lyricsCloseBtn').click();p.locator('#lyricsBtn').click();p.wait_for_function('!__lv.loading');check('268 Saved manual palette survives close/reopen',p.evaluate('__lv.theme.background')=='#774422')
 draft(p,TEXT);p.locator('#lyricsSaveBtn').click();p.wait_for_function('!document.querySelector("#lyricsEditor").open');check('268 Plain/LRC first save inherits appearance and offset',saved(p)['theme']['background']=='#774422' and saved(p)['doc']['offsetMs']==100)
 p.locator('#lyricsSettingsBtn').click();p.evaluate('__mock.lyrics.saveError="Test disk is full"');change(p,'#lyricsFontScale',125);p.wait_for_function('document.querySelector("#lyricsAutosaveStatus").textContent==="Не сохранено"')
 check('268 Persistence error is visible and not falsely labelled saved', 'Test disk' in p.locator('#lyricsSettingsError').inner_text() and p.locator('#lyricsSettingsSave').inner_text()=='Повторить')
 p.evaluate('__mock.lyrics.saveError=null');p.locator('#lyricsSettingsSave').click();p.wait_for_function('!document.querySelector("#lyricsSettings").open');check('268 Failed autosave can retry without losing words',saved(p)['theme']['fontScale']==125 and len(saved(p)['doc']['lines'])==7);done(p,'autosave')

def test_palette_and_replace(b):
 p=page_for(b);initial=p.evaluate('__lv.theme.gradientColors');check('268 Initial gradient derived from cover',initial!=['#302036','#141b30'])
 p.evaluate('''__mock.lyrics.results=[{id:1,title:'Ночная волна',artist:'PulseDeck',duration:64,synced:'[00:03]One invented line\\n[00:09]Another invented line',url:'https://lrclib.net/api/get/1'}]''')
 p.locator('#lyricsFindBtn').click();p.locator('#lyricsSearchSubmit').click();p.wait_for_selector('#lyricsSearchResults button');p.locator('#lyricsSearchResults button').first.click();p.locator('#lyricsSaveBtn').click();p.wait_for_function('!document.querySelector("#lyricsEditor").open')
 check('268 LRCLIB import never replaces cover gradient with default palette',p.evaluate('__lv.theme.gradientColors')==initial)
 p.locator('#lyricsEditBtn').click();check('268 Saved lyrics open directly in timing studio',p.locator('#lyricsTiming').is_visible())
 p.locator('#lyricsTextMenuBtn').click();p.locator('#lyricsReplaceText').click();p.locator('#lyricsConfirmYes').click();p.wait_for_selector('#lyricsInput:not(.hidden)');p.locator('#lyricsInput').fill('My replacement\nAnother original line');p.locator('#lyricsSaveBtn').click();p.wait_for_function('!document.querySelector("#lyricsEditor").open');check('268 Replace changes only words and not palette',saved(p)['doc']['lines'][0]['text']=='My replacement' and p.evaluate('__lv.theme.gradientColors')==initial)
 p.locator('#lyricsEditBtn').click();p.locator('#lyricsTextMenuBtn').click();p.locator('#lyricsRefindText').click();p.wait_for_function('document.querySelector("#lyricsSearch").open');check('268 Search another version does not erase saved text',saved(p)['doc']['lines'][0]['text']=='My replacement');p.locator('#lyricsSearchClose').click()
 p.locator('#lyricsEditBtn').click();p.locator('#lyricsRawBtn').click();p.locator('#lyricsInput').fill(json.dumps({'theme':{'background':'#ff0000','gradientColors':['#ff0000','#00ff00']},'lines':[{'text':'Fresh JSON words'}]}));p.locator('#lyricsSaveBtn').click();p.wait_for_function('!document.querySelector("#lyricsEditor").open');check('268 Explicit imported JSON colors cannot overwrite background either',p.evaluate('__lv.theme.gradientColors')==initial)
 p.locator('#lyricsEditBtn').click();p.locator('#lyricsTextMenuBtn').click();p.locator('#lyricsDeleteText').click();snapshot(p,'65-delete-lyrics-confirm.png');p.locator('#lyricsConfirmYes').click();p.wait_for_function('!__lv.doc');check('268 Delete leaves audio and appearance, remembers tombstone',saved(p)['suppressed'] and len(p.evaluate('__mock.tracks'))==12 and p.evaluate('__lv.theme.gradientColors')==initial)
 p.locator('#lyricsCloseBtn').click();p.locator('#lyricsBtn').click();p.wait_for_function('!__lv.loading');check('268 Deleted lyrics stay deleted after reopen',p.evaluate('__lv.doc') is None)
 p.evaluate('''__mock.tracks[0].coverUrl=new URL('../tests/fixtures/lyrics-cover-light.png',document.baseURI).href.replace('/app/tests/','/tests/');__mock.emit('library:changed')''');p.wait_for_function('__lv.track.coverUrl.includes("light")');pause(p,300);check('268 Automatic palette follows a genuine cover change',p.evaluate('__lv.theme.gradientColors')!=initial)
 p.locator('#lyricsSettingsBtn').click();change(p,'#lyricsPrimaryColor','#663311');p.locator('#lyricsSettingsClose').click();p.wait_for_function('__mock.lyrics.records[__lv.track.rel].theme.paletteSource==="manual"');manual=p.evaluate('__lv.theme.gradientColors')
 p.evaluate('''__mock.tracks[0].coverUrl=new URL(document.baseURI).origin+'/tests/fixtures/lyrics-cover-dark.png';__mock.emit('library:changed')''');pause(p,350);check('268 Manual palette remains protected on cover refresh',p.evaluate('__lv.theme.gradientColors')==manual);done(p,'palette + replacement')

def test_studio(b):
 p=page_for(b);draft(p,TEXT);p.locator('#lyricsEditorSeek').fill('3.4');p.wait_for_function('audio.currentTime>3');check('268 Unsaved draft drives preview through the same audio clock','Тихий ветер' in p.locator('#lyricsDraftPreview').inner_text() and p.evaluate('__lv.doc') is None)
 check('268 Scrubbing does not start paused playback',p.evaluate('audio.paused'));p.locator('#lyricsEditorPlay').click();p.wait_for_function('!audio.paused');p.locator('#lyricsEditorPlay').click();p.wait_for_function('audio.paused');check('268 In-editor transport can play/pause',True)
 p.locator('#lyricsShiftLater').click();check('268 No-selection shift changes every row in one operation',times(p)==[3100,9100,16100,23100,29100,38100,48100]);p.keyboard.press('Control+z');check('268 Undo restores all original timestamps atomically',times(p)==[3000,9000,16000,23000,29000,38000,48000]);p.keyboard.press('Control+Shift+z');check('268 Redo restores the grouped change',times(p)[0]==3100);p.locator('#lyricsUndo').click()
 p.locator('[data-select-row="1"]').click();p.locator('[data-select-row="2"]').click(modifiers=['Shift']);p.locator('#lyricsShiftDialogBtn').click();p.locator('#lyricsShiftSeconds').fill('1.5');p.locator('#lyricsShiftApply').click();check('268 Shift-selected uses only chosen rows',times(p)==[3000,10500,17500,23000,29000,38000,48000]);p.locator('#lyricsShiftEarlier').click();check('268 Selection retained for repeated group adjustments',times(p)[1:3]==[10400,17400]);snapshot(p,'62-editor-selected-lines.png')
 p.locator('#lyricsEditorSelection').click();check('268 One-click selection reset returns actions to all lines',p.locator('#lyricsEditorSelection').inner_text()=='Все строки')
 p.locator('#lyricsShiftDialogBtn').click();p.locator('#lyricsShiftSeconds').fill('-100');before=times(p);p.locator('#lyricsShiftApply').click();check('268 Out-of-bounds shift reports reason and touches nothing',times(p)==before and 'границы' in p.locator('#lyricsShiftError').inner_text());p.locator('#lyricsShiftCancel').click()
 p.locator('[data-word-row="0"][data-word-index="1"]').click();p.locator('[data-word-row="0"][data-word-index="2"]').click(modifiers=['Control']);p.locator('#lyricsShiftEarlier').click();check('268 Multiword selection remains selected after operation',p.evaluate('__lv.selectedWords.size')==2)
 check('268 Unselected words retain their actual time',p.evaluate('PulseLyricsEditor.tokens(__lv.editDraft.lines[0]).map(x=>x.startMs)')==[3000,2900,2900,3000,3000]);p.locator('#lyricsUndo').click()
 p.locator('[data-word-row="0"][data-word-index="1"]').click();word=p.locator('.ly-word-panel:not(.hidden) [data-word-time]');# Edit the actual word field, not a simulated state mutation.
 sec=word.locator('[data-part="seconds"]');sec.fill('04');sec.press('Tab');p.locator('#lyricsEditorSeek').fill('4.5');pause(p,80);check('268 Word field updates live unsaved word preview',p.locator('#lyricsDraftPreview .ly-draft-sung').count()>=2)
 snapshot(p,'61-editor-word-preview.png');before=p.evaluate('__lv.editDraft.lines.length');p.locator('#lyricsSplitLine').click();check('268 Split at word preserves textual contents and adds a row',p.evaluate('__lv.editDraft.lines.length')==before+1);p.locator('#lyricsUndo').click()
 p.locator('#lyricsEditorSpeed').select_option('0.75');check('268 Listening speed affects existing player',p.evaluate('audio.playbackRate')==.75)
 p.locator('#lyricsEditorSeek').fill('3.5');p.locator('[data-select-row="0"]').click();p.locator('#lyricsLoopRow').click();p.locator('#lyricsEditorPlay').click();p.wait_for_function('!audio.paused');p.evaluate('audio.currentTime=10.5;__lv.tick(true)');pause(p,100);check('268 Selected-line loop seeks to its start',p.evaluate('audio.currentTime')<5,p.evaluate('({time:audio.currentTime,paused:audio.paused,loop:__lv.studioLoop,selected:[...__lv.selectedRows],mark:__lv.markIndex,times:__lv.editDraft.lines.map(r=>[r.startMs,r.endMs]),offset:__lv.editDraft.offsetMs})'));p.evaluate('audio.pause()');p.locator('#lyricsLoopRow').click()
 # An intentionally out-of-order draft is repaired only by an explicit command.
 field(p,0).locator('[data-part="seconds"]').fill('20');field(p,0).locator('[data-part="seconds"]').press('Tab');check('268 Out-of-order error is visible instead of silently sorting','возрастать' in p.locator('#lyricsEditorError').inner_text());p.locator('#lyricsSortTimes').click();check('268 Explicit chronological sort repairs sequence',times(p)==sorted(times(p)));p.locator('#lyricsUndo').click();p.locator('#lyricsUndo').click()
 p.locator('#lyricsEditorClose').click();p.locator('#lyricsConfirmYes').click();p.wait_for_function('!document.querySelector("#lyricsEditor").open');check('268 Closing discarded draft restores playback speed and saved text',p.evaluate('audio.playbackRate')==1 and p.evaluate('__lv.doc') is None);done(p,'studio actions')

def test_rhythm(b):
 p=page_for(b);draft(p,'Тихий ветер\nГород ждёт\nМузыка рядом\nСвет в окне');before=times(p);p.locator('#lyricsAutoSync').click();p.wait_for_function('!document.querySelector("#lyricsRhythmApply").disabled');check('268 Rhythm proposal is a preview, not a saved mutation',times(p)==before and p.evaluate('__lv.doc') is None);check('268 Acoustic limitation is explicit before applying','не распознавание' in p.locator('#lyricsRhythmDialog').inner_text());snapshot(p,'63-acoustic-draft-preview.png')
 p.locator('#lyricsRhythmApply').click();after=times(p);check('268 Apply rhythm writes only unsaved line timing with unknown ends',all(isinstance(t,int) for t in after) and p.evaluate('__lv.editDraft.lines.every(x=>x.endMs===null)') and p.evaluate('__lv.doc') is None);p.locator('#lyricsUndo').click();check('268 Whole acoustic draft is one undo operation',times(p)==before)
 p.locator('#lyricsRedo').click();p.locator('#lyricsAutoSync').click();pause(p,50);check('268 Existing full timing not silently replaced',p.locator('#lyricsRhythmApply').is_disabled() and 'уже размечены' in p.locator('#lyricsRhythmState').inner_text());p.locator('#lyricsRhythmKeep').uncheck();p.wait_for_function('!document.querySelector("#lyricsRhythmApply").disabled');p.locator('#lyricsRhythmCancel').click();check('268 Cancel proposal keeps prior draft',times(p)==after)
 p.evaluate('__lv.studioAnalysis=null;__mock.lyrics.analysisDelay=500');p.locator('#lyricsAutoSync').click();p.locator('#lyricsRhythmCancel').click();pause(p,600);check('268 Late cancelled analyzer result cannot populate UI',p.evaluate('__lv.rhythmDoc') is None and not p.evaluate('document.querySelector("#lyricsRhythmDialog").open'))
 p.evaluate('__lv.clearPrivate()');pause(p);check('268 Lock clears draft history, waveform, time widgets and acoustic proposal',p.evaluate('__lv.history.undoStack.length===0 && __lv.studioAnalysis===null && __lv.rhythmDoc===null && !document.querySelector("#lyricsTimingRows").children.length && !document.querySelector("#lyricsRhythmStartSlot").children.length'))
 done(p,'rhythm lifecycle')

def test_search_identity(b):
 p=page_for(b);p.evaluate('''__lv.track.artist='BUYSELL';__lv.track.title='Моргенштерн - Повод [HD]';__lv.openSearch()''');check('268 Search prefills title artist rather than uploader',p.locator('#lyricsSearchArtist').input_value()=='Моргенштерн' and p.locator('#lyricsSearchSong').input_value()=='Повод');snapshot(p,'64-clean-search-query.png');p.locator('#lyricsSearchClose').click()
 p.evaluate('''__lv.track.artist='MORGENSHTERN';__lv.track.title='Моргенштерн — Последняя Любовь (Official Video, 2024)';__lv.openSearch()''');check('268 Search cleans cross-script prefix and production labels',p.locator('#lyricsSearchSong').input_value()=='Последняя Любовь');p.locator('#lyricsSearchSong').fill('Последння Любовь');p.locator('#lyricsSearchSubmit').click();pause(p);check('268 User can submit an inexact edited title',any(x['name']=='lyrics' and x['value'].get('type')=='search' and x['value'].get('title')=='Последння Любовь' for x in p.evaluate('__mock.calls')));done(p,'search query')

def test_autosave_switch(b):
 p=page_for(b);first=p.evaluate('__lv.track.rel');p.locator('#lyricsSettingsBtn').click();p.evaluate('__mock.lyrics.saveDelay=180');change(p,'#lyricsFontScale',135);p.locator('#lyricsSettingsClose').click();p.evaluate('''__lv.trackChanged({...__mock.tracks[1],duration:64})''');p.wait_for_function('__lv.track.rel===__mock.tracks[1].rel && !__lv.loading');check('268 Pending autosave uses its original recording after switching songs',p.evaluate('(k)=>__mock.lyrics.records[k].theme.fontScale',first)==135 and p.evaluate('__lv.theme.fontScale')==100)
 p.evaluate('__lv.trackChanged({...__mock.tracks[0],duration:64})');p.wait_for_function('!__lv.loading');check('268 Reenter waits for pending writes and restores latest preferences',p.evaluate('__lv.theme.fontScale')==135);done(p,'save race')

def test_responsive(b):
 for size in [(1440,960),(1000,700),(800,600),(600,550)]:
  p=page_for(b,size=size);draft(p,TEXT);p.locator('[data-word-row="0"][data-word-index="1"]').click();pause(p,120)
  dims=p.locator('#lyricsEditor').evaluate('n=>({w:n.clientWidth,sw:n.scrollWidth,h:n.clientHeight,sh:n.scrollHeight,r:n.getBoundingClientRect().toJSON()})')
  check('268 Editor does not overflow horizontally '+str(size),dims['sw']<=dims['w']+1,dims)
  check('268 Save footer and transport visible '+str(size),p.locator('#lyricsSaveBtn').bounding_box()['y']+p.locator('#lyricsSaveBtn').bounding_box()['height']<=size[1] and p.locator('#lyricsEditorSeek').is_visible())
  snapshot(p,'66-studio-'+str(size[0])+'.png');p.locator('[data-timing-row="0"] .ly-row-more').click();check('268 Optional end is accessible without forcing a timestamp '+str(size),field(p,0,'endMs').is_visible() and field(p,0,'endMs').get_attribute('data-value')=='')
  p.emulate_media(reduced_motion='reduce');check('268 Reduced motion honoured '+str(size),p.locator('#lyricsEditor').evaluate('n=>getComputedStyle(n).animationName')=='none');done(p,'responsive '+str(size))

if __name__=='__main__':
 failed=[]
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  for fn in [test_autosave,test_palette_and_replace,test_studio,test_rhythm,test_search_identity,test_autosave_switch,test_responsive]:
   try:fn(b)
   except Exception as e:
    traceback.print_exc();failed.append({'test':fn.__name__,'error':str(e)})
    for c in b.contexts:
     for p in c.pages:
      print('PAGE ERRORS',p._errors);snapshot(p,'failure-268-'+fn.__name__+'.png')
     c.close()
  b.close()
 r.server.shutdown();(OUT/'browser-studio-268.json').write_text(json.dumps({'checks':r.RESULTS,'failures':failed},ensure_ascii=False,indent=2));print('CHECKS',len(r.RESULTS),'FAILURES',len(failed));raise SystemExit(1 if failed else 0)
