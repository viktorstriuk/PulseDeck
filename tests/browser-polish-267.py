#!/usr/bin/env python3
"""2.6.7 UI checks against actual scripts/styles, real media clock, model-backed IPC.
All lyric text here is invented. File/crypto persistence is tested by Node separately.
"""
import importlib.util,json,traceback,shutil,os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('lyrics266',ROOT/'tests/browser-lyrics-266.py');l=importlib.util.module_from_spec(s);s.loader.exec_module(l)
r=l.r;check=r.check;pause=r.pause;OUT=r.OUT

def snap(p,name):p.screenshot(path=str(OUT/name),animations='disabled')
def no_errors(p,label):check('267 '+label+': no page errors',not p._errors,p._errors)
def start_empty(b,size=(1440,960)):
 p=r.page_for(b,size=size)
 p.evaluate('''async()=>{const base=new URL(document.baseURI).origin;__mock.playbackUrl=URL.createObjectURL(await (await fetch(base+'/tests/fixtures/lyrics-clock.wav')).blob());__mock.tracks[0].duration=64;__mock.tracks[0].title='Ночная волна';__mock.tracks[0].artist='PulseDeck · Демонстрация';__mock.emit('library:changed');}''');pause(p)
 p.locator('#library [data-track-root]').first.dblclick();p.wait_for_function('audio.duration===64');p.evaluate('audio.pause()');p.locator('#lyricsBtn').click();p.wait_for_selector('#lyricsEmpty');pause(p)
 return p

def edit(p,text):
 p.locator('#lyricsPasteBtn').click() if p.locator('#lyricsPasteBtn').is_visible() else p.locator('#lyricsEditBtn').click()
 
 if p.locator('#lyricsRawBtn').is_visible():p.locator('#lyricsRawBtn').click()
 p.locator('#lyricsInput').fill(text);p.locator('#lyricsTimingBtn').click();pause(p)

def cat(p,k,rail='#categoryChips'):return p.locator(f'{rail} [data-category="{k}"]')
def select(p,*keys,rail='#categoryChips'):
 for k in keys:cat(p,k,rail).click(modifiers=['Control'])
 pause(p)
def cmenu(p,rail='#categoryChips'):
 p.locator(rail+' .playlist-selected').first.click(button='right');pause(p)
def close_menu(p):p.keyboard.press('Escape');pause(p)
def field(p,row,key):return p.locator(f'.ly-time-field[data-time-row="{row}"][data-time-key="{key}"]')

def test_empty_focus(b):
 for size in [(1440,960),(800,600)]:
  p=start_empty(b,size);actions=p.locator('.ly-empty .ly-actions').bounding_box();secondary=p.locator('#lyricsEmptySecondary').bounding_box();z=p.locator('#lyricsZipBtn').bounding_box()
  check('267 Empty export links directly below primary buttons '+str(size),z['y']>=actions['y']+actions['height'] and z['y']<actions['y']+actions['height']+55 and abs((secondary['x']+secondary['width']/2)-(actions['x']+actions['width']/2))<2)
  check('267 One ZIP/export pair, disabled export accurately indicates no text '+str(size),p.locator('#lyricsZipBtn').count()==1 and p.locator('#lyricsExportBtn').count()==1 and p.locator('#lyricsExportBtn').is_disabled())
  check('267 Supplied microphone uses theme mask '+str(size),'lyrics-microphone.svg' in p.locator('#lyricsBtn .ly-microphone').evaluate('e=>getComputedStyle(e).maskImage'))
  p.locator('#lyricsFocusBtn').click();pause(p);player=p.locator('#player').bounding_box();lyrics=p.locator('#lyricsView').bounding_box()
  check('267 Focus retains original grid transport and reserves its space '+str(size),p.locator('#player').evaluate("n=>getComputedStyle(n).display==='grid'") and abs(lyrics['y']+lyrics['height']-player['y'])<2 and player['y']+player['height']<=size[1]+1)
  check('267 Transport play control is clickable above lyric layer '+str(size),p.locator('#playBtn').evaluate("n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}"))
  t=p.evaluate('audio.currentTime');p.locator('#playBtn').click();p.wait_for_function('!audio.paused');p.locator('#playBtn').click();p.wait_for_function('audio.paused');check('267 Focus transport operates the same audio '+str(size),p.evaluate('audio.currentTime')>=t)
  snap(p,'50-focus-player-'+str(size[0])+'.png');p.keyboard.press('Escape');snap(p,'49-empty-actions-'+str(size[0])+'.png');no_errors(p,'empty and focus');p.close()

def test_settings_blank(b):
 p=start_empty(b);p.locator('#lyricsSettingsBtn').click();pause(p)
 check('267 Offset and gap enabled without text',p.locator('#lyricsGap').is_enabled() and p.locator('#lyricsEarlier').is_enabled())
 p.locator('#lyricsGap').select_option('5000');p.locator('#lyricsLater').click();p.locator('#lyricsLater').click()
 check('267 Auto text colors hidden with explanation, not mysteriously disabled',not p.locator('#lyricsManualColors').is_visible() and 'автоматически' in p.locator('#lyricsAutoHelp').inner_text())
 cb=p.locator('#lyricsAutoContrast');cb.uncheck();pause(p);check('267 Disabling automatic contrast reveals stored manual colors',p.locator('#lyricsManualColors').is_visible() and p.locator('#lyricsTextColor').is_enabled())
 check('267 Custom circular supplied check replaces platform checkbox',cb.evaluate("n=>getComputedStyle(n).appearance==='none'&&getComputedStyle(n).borderRadius==='50%'&&getComputedStyle(n,'::before').maskImage.includes('select.svg')"))
 cb.focus();p.keyboard.press('Space');check('267 Circular check remains keyboard-operable',cb.is_checked());pause(p)
 p.locator('#lyricsSettingsMode').click();pause(p);check('267 No-cover solid mode hides gradient editor',not p.locator('#lyricsGradientGroup').is_visible());p.locator('#lyricsSettingsMode').click()
 snap(p,'51-settings-before-text.png');p.locator('#lyricsSettingsSave').click();p.wait_for_function('!document.querySelector("#lyricsSettings").open')
 record=p.evaluate('__mock.lyrics.records[__mock.tracks[0].rel]');check('267 Blank settings saved separately without inventing lyrics',record['doc'] is None and record['timing']=={'offsetMs':200,'gapThresholdMs':5000})
 p.locator('#lyricsCloseBtn').click();p.locator('#lyricsBtn').click();p.wait_for_selector('#lyricsEmpty');p.locator('#lyricsSettingsBtn').click()
 check('267 Saved blank settings survive reopening',p.locator('#lyricsGap').input_value()=='5000' and '0,20' in p.locator('#lyricsOffsetValue').inner_text())
 p.locator('#lyricsEarlier').click();p.locator('#lyricsGap').select_option('3000');p.locator('#lyricsSettingsClose').click();p.locator('#lyricsSettingsBtn').click();check('268 Closing auto-saved settings retains offset and pause threshold',p.locator('#lyricsGap').input_value()=='3000' and '0,10' in p.locator('#lyricsOffsetValue').inner_text());p.locator('#lyricsSettingsClose').click()
 p.locator('#lyricsPasteBtn').click();p.locator('#lyricsInput').fill('Lanterns over quiet water');p.locator('#lyricsSaveBtn').click();p.wait_for_function('!document.querySelector("#lyricsEditor").open');doc=p.evaluate('__mock.lyrics.records[__mock.tracks[0].rel].doc');check('267 First pasted text inherits preconfigured timing',doc['offsetMs']==100 and doc['gapThresholdMs']==3000)
 no_errors(p,'settings persistence');p.close()

def test_word_editor(b):
 p=start_empty(b);edit(p,'[00:01]Lanterns over quiet water\n[00:09]The evening brings us home')
 check('267 Clickable words preserve exact text',p.locator('[data-words-row="0"] .ly-word-token').count()==4 and p.locator('[data-words-row="0"]').inner_text()=='Lanterns over quiet water')
 p.locator('[data-timing-row="0"] .ly-row-more').click();end=field(p,0,'endMs');check('267 Missing end shows inference without storing a measured end',end.get_attribute('data-value')=='' and '00:09' in end.locator('.ly-time-hint').inner_text())
 p.locator('[data-word-row="0"][data-word-index="1"]').click();word=p.locator('.ly-word-panel:not(.hidden) [data-word-time]');check('267 Untimed word shows inherited group rather than a mandatory timestamp',word.get_attribute('data-value')=='' and 'Вместе: 00:01' in word.inner_text())
 sec=word.locator('[data-part="seconds"]');sec.fill('02');sec.press('ArrowUp');check('267 Up arrow changes selected seconds, not playback position',word.get_attribute('data-value')=='3000' and p.evaluate('audio.paused'))
 sec.press('ArrowLeft');check('267 Left arrow selects minute segment',p.evaluate("document.activeElement.dataset.part==='minutes'"));p.keyboard.press('ArrowRight');p.keyboard.press('ArrowDown');check('267 Right then down edits seconds without leaving field',word.get_attribute('data-value')=='2000')
 word.locator('.ly-time-precision').click();ms=word.locator('[data-part="milliseconds"]');ms.fill('125');ms.press('ArrowUp');check('267 Optional milliseconds allow exact per-word adjustment',word.get_attribute('data-value')=='2126');word.locator('.ly-time-precision').click();check('267 Hiding milliseconds preserves their value visibly',word.get_attribute('data-value')=='2126' and '126 мс' in word.inner_text())
 p.locator('.ly-word-panel:not(.hidden) button[title="Следующее слово"]').click();check('267 Next word inherits newly measured group time',p.locator('.ly-word-panel:not(.hidden) .ly-time-hint').inner_text().find('00:02.126')>=0)
 l.clock(p,4);p.locator('.ly-word-panel:not(.hidden) button').filter(has_text='Сейчас → следующее').click();check('267 Stamp-and-next advances exactly one word',p.locator('.ly-word-token.chosen').inner_text().strip()=='water')
 snap(p,'52-word-timing-editor.png');p.locator('#lyricsPreviewBtn').click();p.keyboard.press('Control+a');check('267 Editor shortcut never selects hidden tracks',p.locator('#library .track-selected').count()==0)
 p.locator('#lyricsSaveBtn').click();p.wait_for_function('!document.querySelector("#lyricsEditor").open');d=p.evaluate('__mock.lyrics.records[__mock.tracks[0].rel].doc');check('267 Word changes saved as phrase groups without redundant end times',d['lines'][0]['endMs'] is None and d['lines'][0]['segments']==[{'text':'Lanterns ','startMs':1000},{'text':'over ','startMs':2126},{'text':'quiet water','startMs':4000}])
 l.clock(p,2.3);check('267 Saved word timestamp drives actual lyric highlight',p.locator('.ly-active .ly-sung').count()==2)
 p.locator('#lyricsEditBtn').click();p.locator('[data-word-row="0"][data-word-index="1"]').click();p.locator('.ly-word-panel:not(.hidden) .ly-time-clear').click();p.locator('#lyricsSaveBtn').click();p.wait_for_function('!document.querySelector("#lyricsEditor").open');d=p.evaluate('__mock.lyrics.records[__mock.tracks[0].rel].doc');check('267 Clearing word time reunites only its inherited phrase',d['lines'][0]['segments'][0]['text']=='Lanterns over ' and d['lines'][0]['segments'][1]['text']=='quiet water')
 no_errors(p,'word authoring');p.close()

def test_time_input_and_errors(b):
 p=start_empty(b);edit(p,'[00:01.250]A measured phrase\n[00:09]Next phrase');start=field(p,0,'startMs');start.locator('[data-part="seconds"]').press('ArrowUp');check('267 Start shift preserves imported subsecond precision',start.get_attribute('data-value')=='2250')
 start.locator('.ly-time-clear').click();check('267 Null start is distinct from zero',start.get_attribute('data-value')=='');start.locator('[data-part="minutes"]').fill('0');start.locator('[data-part="seconds"]').fill('01');start.locator('[data-part="seconds"]').press('ArrowUp');check('267 Zero-filled timer allows fresh keyboard entry',start.get_attribute('data-value')=='2000')
 start.locator('[data-part="seconds"]').evaluate("n=>{const data=new DataTransfer();data.setData('text/plain','00:03.456');n.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));}")
 check('267 Whole timestamp paste populates minute/second/fraction parts',start.get_attribute('data-value')=='3456')
 p.locator('[data-word-row="0"][data-word-index="1"]').click();word=p.locator('.ly-word-panel:not(.hidden) [data-word-time]');word.locator('[data-part="seconds"]').fill('01');p.locator('#lyricsSaveBtn').click();check('267 Backward word timestamp blocks save with readable error',p.locator('#lyricsEditor').evaluate('d=>d.open') and bool(p.locator('#lyricsEditorError').inner_text()) and p.evaluate('__mock.lyrics.records[__mock.tracks[0].rel]===undefined'))
 p.emulate_media(reduced_motion='reduce');check('267 Reduced-motion disables dialog and word-panel animations',p.locator('#lyricsEditor').evaluate("n=>getComputedStyle(n).animationName==='none'") and word.evaluate("n=>getComputedStyle(n.closest('.ly-word-panel')).animationName==='none'"))
 p.locator('#lyricsEditorClose').click();p.locator('#lyricsConfirmYes').click();no_errors(p,'timers and validation');p.close()

def test_playlist_zone_and_partial(b):
 p=r.page_for(b);cat(p,'favorite').click(button='right');pause(p);check('267 Right-click enters playlist editing',p.locator('#categoryChips [data-category-drag]').count()>0)
 rail=p.locator('#categoryChips').bounding_box();zone=p.locator('.category-zone').bounding_box();p.mouse.click(rail['x']+20,rail['y']-9);pause(p)
 check('267 Clicking padded area dismisses menu but retains editing',not p.locator('#contextMenu').is_visible() and p.locator('#categoryChips [data-category-drag]').count()>0)
 p.locator('h1').click();pause(p);check('267 Clicking genuinely outside still ends editing',p.locator('#categoryChips [data-category-drag]').count()==0)
 # A sweep strictly above the chips now selects their columns; no toolbar needed.
 rail=p.locator('#categoryChips').bounding_box();a=cat(p,'favorite').bounding_box();b2=cat(p,'downloads').bounding_box();y=rail['y']-8
 p.mouse.move(a['x']+2,y);p.mouse.down();p.mouse.move(b2['x']+b2['width']-2,y+2,steps=15);p.mouse.up();pause(p)
 check('267 Selection can start and continue above playlist buttons',p.locator('#categoryChips .playlist-selected').count()>=2 and p.locator('#contextMenu').get_attribute('data-menu-kind')=='playlists')
 check('267 Playlist selection toolbar is completely absent',p.locator('#playlistSelectionStatus,#playlistSelectionActions').count()==0)
 snap(p,'53-playlist-selection-zone.png');close_menu(p)
 select(p,'favorite','recent','custom:0');cmenu(p);label=p.locator('[data-batch-playlist="delete"]').inner_text();check('267 Mixed delete is enabled and names eligible count','1 из 3' in label and p.locator('[data-batch-playlist="delete"]').is_enabled())
 snap(p,'54-partial-playlist-actions.png');p.locator('[data-batch-playlist="delete"]').click();check('267 Partial confirmation explains what stays intact','1 из 3' in p.locator('#confirmText').inner_text());p.locator('#confirmDelete').click();pause(p,450)
 check('267 Partial delete removes only ordinary category',p.evaluate("!__mock.settings.customCategories.some(c=>c.id==='custom:0')&&__mock.settings.customCategories.some(c=>c.id==='custom:1')&&__mock.tracks.length===12"))
 check('267 Skipped systems remain selected for further action',p.locator('#categoryChips .playlist-selected').evaluate_all("ns=>ns.map(n=>n.dataset.category).sort().join()==='favorite,recent'"))
 p.keyboard.press('Shift+F10');pause(p);check('267 Removed toolbar replaced by standard keyboard context menu',p.locator('#contextMenu').is_visible() and p.locator('[data-batch-playlist="merge"]').is_visible())
 no_errors(p,'playlist zones and partial actions');p.close()

def test_system_merge(b):
 p=r.page_for(b);select(p,'favorite','recent','downloads','custom:0');cmenu(p);p.locator('[data-batch-playlist="merge"]').click();pause(p)
 opts=p.locator('#batchMergeTarget option').evaluate_all('ns=>ns.map(n=>n.value)');check('267 Merge offers all four targets including multiple systems',set(opts)==set(['favorite','recent','downloads','custom:0']))
 p.locator('#batchMergeTarget').select_option('custom:0');check('267 Ordinary destination selectable even with three system sources',p.locator('#confirmDelete').is_enabled());snap(p,'55-merge-systems.png');before=p.evaluate('JSON.stringify(__mock.settings.favorites)');p.locator('#confirmDelete').click();pause(p,450)
 check('267 System sources hidden and their favorites retained after merge',p.evaluate("__mock.settings.categoryStyles.favorite.hidden&&__mock.settings.categoryStyles.recent.hidden&&__mock.settings.categoryStyles.downloads.hidden") and p.evaluate('JSON.stringify(__mock.settings.favorites)')==before)
 check('267 Destination remains active and files intact',cat(p,'custom:0').evaluate("n=>n.classList.contains('active')") and p.evaluate('__mock.tracks.length')==12)
 no_errors(p,'system merge');p.close()

def test_playlist_rectangles_side(b):
 p=r.page_for(b);select(p,'all','favorite','recent','downloads');cmenu(p)
 g=p.locator('#categoryChips .playlist-selected').evaluate_all("ns=>ns.map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {y:r.y,h:r.height,shadow:s.boxShadow,transform:s.transform,padding:s.padding}})")
 check('267 Top selected rectangles have equal centers and heights',max(x['y'] for x in g)-min(x['y'] for x in g)<1 and max(x['h'] for x in g)-min(x['h'] for x in g)<1 and all(x['transform']=='none' for x in g))
 snap(p,'56-playlist-top-alignment.png');close_menu(p);p.locator('[data-category-layout="side"]').click();pause(p)
 a=cat(p,'all','#categorySidebar').bounding_box();d=cat(p,'downloads','#categorySidebar').bounding_box();rail=p.locator('#categorySidebar').bounding_box();x=rail['x']+2
 p.mouse.move(x,a['y']+3);p.mouse.down();p.mouse.move(x+1,d['y']+d['height']-3,steps=16);p.mouse.up();pause(p)
 check('267 Sidebar gutter selection is available without direct chip press',p.locator('#categorySidebar .playlist-selected').count()>=3)
 g=p.locator('#categorySidebar .playlist-selected').evaluate_all("ns=>ns.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,w:r.width,h:r.height}})")
 check('267 Sidebar rectangles align consistently',max(x['x'] for x in g)-min(x['x'] for x in g)<1 and max(x['w'] for x in g)-min(x['w'] for x in g)<1)
 snap(p,'57-playlist-side-alignment.png');no_errors(p,'playlist rectangle geometry');p.close()

def test_partial_alias_and_rename(b):
 p=r.page_for(b);before_categories=p.evaluate('JSON.stringify(__mock.settings.customCategories)');select(p,'all','artist:morgenstern','artist:slipknot');cmenu(p)
 check('267 Mixed selection exposes artist action for the relevant subset','2 из 3' in p.locator('[data-submenu-trigger="batch-artist"]').inner_text())
 p.locator('[data-submenu-trigger="batch-artist"]').click();p.locator('[data-batch-alias="artist:morgenstern"]').click();p.locator('#confirmDelete').click();pause(p,400)
 check('267 Partial artist action leaves system and custom lists intact',p.evaluate("__mock.settings.artistAliases.slipknot==='morgenstern'") and p.evaluate('JSON.stringify(__mock.settings.customCategories)')==before_categories and cat(p,'all').count()==1)
 p.locator('h1').click();cat(p,'favorite').click(button='right');pause(p);check('267 System playlist rename is enabled',p.locator('[data-category-command="rename"]').is_enabled());p.locator('[data-category-command="rename"]').click();pause(p);p.locator('#categoryNameInput').fill('Мои любимые');p.locator('#categoryStyleSave').click();pause(p,300)
 check('267 Cosmetic system rename preserves the stable category ID','Мои любимые' in cat(p,'favorite').inner_text() and p.evaluate("__mock.settings.categoryStyles.favorite.name==='Мои любимые'"))
 cat(p,'favorite').click(button='right');p.locator('[data-submenu-trigger="merge"]').click();p.locator('[data-merge-target="recent"]').click();pause(p)
 check('267 Pair system merge offers both directions and no false deletion warning',p.locator('#mergeChoices input:disabled').count()==0 and p.locator('#mergeChoices input').count()==2 and 'системный - скрыт' in p.locator('.merge-explanation').inner_text())
 p.locator('#mergeChoices input').first.check();p.locator('#mergeConfirm').click();pause(p,300);check('267 Pair merge uses revised model and hides only source',p.evaluate("__mock.settings.categoryStyles.favorite.hidden===true") and cat(p,'recent').count()==1)
 no_errors(p,'partial alias, rename, pair merge');p.close()

if __name__=='__main__':
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  for fn in [test_empty_focus,test_settings_blank,test_word_editor,test_time_input_and_errors,test_playlist_zone_and_partial,test_system_merge,test_playlist_rectangles_side,test_partial_alias_and_rename]:
   try:fn(browser)
   except Exception as e:
    print(traceback.format_exc(),flush=True);r.RESULTS.append({'name':fn.__name__,'passed':False,'error':str(e)})
    for ctx in browser.contexts:
     for page in ctx.pages:
      try:snap(page,'failure-267-'+fn.__name__+'.png')
      except:pass
   finally:
    for ctx in browser.contexts:ctx.close()
  browser.close()
 r.server.shutdown();report={'environment':'Chromium, real renderer/styles/audio clock, model-backed IPC','passed':sum(x['passed'] for x in r.RESULTS),'failed':sum(not x['passed'] for x in r.RESULTS),'checks':r.RESULTS};(OUT/'browser-polish-267.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(report['passed'],'passed,',report['failed'],'failed');raise SystemExit(bool(report['failed']))
