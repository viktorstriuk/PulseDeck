#!/usr/bin/env python3
"""Real renderer+overlay localization, UI state preservation, security and fallback."""
from pathlib import Path
import importlib.util,json,re,traceback
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/2.6.9';OUT.mkdir(parents=True,exist_ok=True)
s=importlib.util.spec_from_file_location('studio',ROOT/'tests/browser-studio-268.py');studio=importlib.util.module_from_spec(s);s.loader.exec_module(studio);r=studio.r
checks=[]
def check(name,value,detail=None):
 checks.append({'name':name,'passed':bool(value),**({'detail':detail} if detail is not None else {})});print(('PASS ' if value else 'FAIL ')+name,flush=True)
 if not value:raise AssertionError(name+': '+str(detail))
def change(p,code):p.evaluate('(code)=>pulse.i18n.setLanguage(code)',code);r.pause(p,180)
def no_source_text(p,extra=None):
 result=p.evaluate('''extra=>{const owned=[...(__mock?.tracks||[]).flatMap(t=>[t.title,t.artist,t.album]),...(__mock?.settings?.customCategories||[]).map(c=>c.name),'Русский',...(extra||[])].filter(Boolean).sort((a,b)=>b.length-a.length),out=[];
 const inspect=(e,a,v)=>{for(const word of owned)v=v.split(word).join('');if(/[А-Яа-яЁё]/.test(v))out.push({id:e.id,attr:a,text:v.trim().slice(0,250)});};const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const n=walker.currentNode,e=n.parentElement;if(e&&!e.closest('script,style'))inspect(e,'text',n.nodeValue);}for(const e of document.querySelectorAll('[title],[aria-label],[placeholder],[aria-valuetext]'))for(const a of ['title','aria-label','placeholder','aria-valuetext'])inspect(e,a,e.getAttribute(a)||'');return out;}''',extra or [])
 check('No Russian application text remains in English DOM, including hidden text and accessibility attributes',not result,result)
def clean(p,label):check(label+' has no uncaught JavaScript errors',not p._errors,p._errors);p.close()

def settings(b):
 p=r.page_for(b);original=p.evaluate('JSON.stringify(__mock.tracks)');p.locator('#settingsBtn').click();p.locator('[data-settings-page="language"]').click();p.wait_for_selector('#languageList [value="en"]')
 check('Both shipped languages are listed',p.locator('#languageList input').count()==2)
 check('Russian is selected initially',p.locator('#languageList [value="ru"]').is_checked())
 p.wait_for_function('[...document.querySelectorAll("#languageList img")].every(n=>n.naturalWidth>0)')
 check('Both SVG icons load as images',p.locator('#languageList img').count()==2)
 p.locator('#languageList [value="en"]').check();p.wait_for_function('PulseI18n.language==="en" && !document.querySelector("#languageList input").disabled')
 check('Language preference is saved',p.evaluate('__mock.settings.language')=='en')
 check('Root language changes',p.locator('html').get_attribute('lang')=='en')
 check('Settings button takes the English catalog value',p.locator('#settingsBtn').get_attribute('title')==p.evaluate('PulseI18n.t("SettingsButton")'))
 check('Language action buttons use application styling',p.locator('#reloadLanguagesBtn').evaluate('n=>n.getBoundingClientRect().height>=38 && parseFloat(getComputedStyle(n).borderRadius)>0'))
 check('Keyboard focus stays on selected language',p.evaluate('document.activeElement?.dataset.language')=='en')
 check('Changing UI language does not change metadata or user playlist names',p.evaluate('JSON.stringify(__mock.tracks)')==original)
 for tab in ['appearance','player','games','hotkeys','library','language']:
  p.locator('[data-settings-page="'+tab+'"]').click();r.pause(p,100);check('Settings section '+tab+' remains available',p.locator('[data-settings-panel="'+tab+'"]').is_visible())
 p.evaluate("document.querySelector('.visualizer-colors').classList.add('cover-driven')");check('CSS pseudo-element text also comes from English catalog',p.locator('.visualizer-colors').evaluate("n=>getComputedStyle(n,'::after').content.includes('Fallback colours')"))
 no_source_text(p);p.screenshot(path=str(OUT/'269-language-en.png'))
 saved=p.evaluate('__storage');p.evaluate('__mock.failLanguageSave=true');p.locator('#languageList [value="ru"]').click();r.pause(p,250)
 check('Failed save keeps English preference and selected radio',p.evaluate('PulseI18n.language')=='en' and p.locator('#languageList [value="en"]').is_checked())
 check('Failed save has translated explanatory message','Could not save' in p.locator('#languageStatus').inner_text())
 p.evaluate('__mock.failLanguageSave=false');p.locator('#reloadLanguagesBtn').click();r.pause(p);check('Catalog reload keeps selected language',p.evaluate('PulseI18n.language')=='en')
 p.locator('#languageList [value="ru"]').check();r.pause(p);check('Switching back uses Russian catalog',p.locator('#settingsBtn').get_attribute('title')==p.evaluate('PulseI18n.t("SettingsButton")'))
 p.screenshot(path=str(OUT/'269-language-ru.png'));clean(p,'Language settings')
 p=r.page_for(b,stored=saved);check('Restart initializes English before app UI',p.evaluate('PulseI18n.language')=='en' and p.locator('#settingsBtn').get_attribute('title')=='Settings');no_source_text(p);clean(p,'Restart')

def player_and_studio(b):
 p=studio.page_for(b);p.evaluate('audio.currentTime=5;audio.play()');r.pause(p,150);before=p.evaluate('({time:audio.currentTime,src:audio.src,rel:__lv.track.rel})');change(p,'en');after=p.evaluate('({time:audio.currentTime,src:audio.src,rel:__lv.track.rel,paused:audio.paused})')
 check('Switching language does not pause or reload audio',not after['paused'] and before['src']==after['src'] and before['rel']==after['rel'] and after['time']>=before['time'])
 p.evaluate('audio.pause()');change(p,'ru');studio.draft(p,'[00:03]ЮзерОдин ЮзерДва\n[00:07]ЮзерТри ЮзерЧетыре');p.evaluate('__lv.openWord(0,0,false)');field=p.locator('[data-time-row="0"][data-time-key="startMs"] input[data-part="seconds"]');field.focus();field.evaluate('n=>n.setSelectionRange(0,2)')
 before=p.evaluate('({draft:JSON.stringify(__lv.editDraft),history:JSON.stringify(__lv.history),input:document.activeElement,selection:[document.activeElement.selectionStart,document.activeElement.selectionEnd]})');p.evaluate('window.__focusedField=document.activeElement;window.__draftBefore=JSON.stringify(__lv.editDraft);window.__historyBefore=JSON.stringify(__lv.history)');change(p,'en')
 check('Unsaved lyric draft is byte-for-byte preserved',p.evaluate('JSON.stringify(__lv.editDraft)===__draftBefore'))
 check('Undo/redo history is preserved',p.evaluate('JSON.stringify(__lv.history)===__historyBefore'))
 check('Timing input DOM and selection survive switch',p.evaluate('document.activeElement===__focusedField && document.activeElement.selectionStart===0 && document.activeElement.selectionEnd===2'))
 check('Timing spinbutton labels change without rebuilding fields',not re.search('[А-Яа-яЁё]',field.get_attribute('aria-label')))
 check('User lyric tokens are not translated',p.locator('[data-word-row="0"][data-word-index="0"]').inner_text().strip()=='ЮзерОдин')
 check('Compact source-markup button keeps its icon after language changes',p.locator('#lyricsRawBtn').inner_text().strip()=='{ }' and p.locator('#lyricsRawBtn').get_attribute('aria-label')==p.evaluate('PulseI18n.t("LyricsSourceMarkupJSON")'))
 no_source_text(p,['ЮзерОдин','ЮзерДва','ЮзерТри','ЮзерЧетыре']);p.screenshot(path=str(OUT/'269-editor-en.png'))
 p.evaluate('''()=>{const e=Error("Error invoking remote method 'lyrics:command': Error: "+PulseI18n.encodeError(PulseI18n.error('LyricsServiceUnavailableHttp',{value1:503})));PulseI18n.setText(document.querySelector('#lyricsEditorError'),()=>PulseI18n.errorMessage(e));}''')
 check('Visible remote error is English without IPC wrapper','503' in p.locator('#lyricsEditorError').inner_text() and 'remote method' not in p.locator('#lyricsEditorError').inner_text())
 change(p,'ru');check('Existing error relocalizes without a new request','Сервис текста' in p.locator('#lyricsEditorError').inner_text())
 clean(p,'Active playback and editor')

def safety_and_fallback(b):
 p=r.page_for(b);change(p,'en')
 p.evaluate('''()=>{const s=PulseI18n.snapshot();s.language='zz';s.catalogs.zz={meta:{code:'zz',name:'<img src=x onerror="window.__bad=1">',locale:'en',direction:'rtl'},messages:{SettingsButton:'<svg onload="window.__bad=2">'} };s.languages.push({...s.catalogs.zz.meta,iconUrl:''});PulseI18n.applySnapshot(s);const e=document.createElement('span');e.id='fallbackProbe';e.dataset.i18n='OnlyMissingKey';document.body.append(e);}''');r.pause(p)
 check('Translation markup stays literal in title',p.locator('#settingsBtn').get_attribute('title').startswith('<svg'))
 check('Language display name stays literal text','<img' in p.locator('#languageList').inner_text())
 check('Translation and metadata cannot inject executable HTML',not p.evaluate('window.__bad') and p.locator('#languageList img').count()==2)
 check('Pack direction is applied',p.locator('html').get_attribute('dir')=='rtl')
 check('Missing key in both catalogs displays cleaned key',p.locator('#fallbackProbe').inner_text()=='OnlyMissingKey')
 check('Missing selected translation uses English',p.locator('#onlineSearchBtn').inner_text()==p.evaluate('PulseI18n.catalogs.en.messages.UIFind'))
 p.evaluate('''()=>{const s=PulseI18n.snapshot();s.catalogs.zz.messages.SettingsButton='';delete s.catalogs.en.messages.SettingsButton;PulseI18n.applySnapshot(s);}''');r.pause(p)
 check('No Russian fallback when English also lacks key',p.locator('#settingsBtn').get_attribute('title')=='SettingsButton')
 change(p,'en');p.locator('#settingsBtn').click();p.locator('[data-settings-page="language"]').click();check('Added language does not require rebuilding settings UI',p.locator('#languageList [value="en"]').is_visible())
 clean(p,'Fallback and inert translations')

def overlay(b):
 p=r.page_for(b,kind='overlay');p.evaluate("__overlay.emit('help',{playPause:'Ctrl+Alt+P',next:'Ctrl+Alt+Right'});__overlay.emit('preview',true)");r.pause(p)
 p.evaluate("pulseOverlay.i18n.setLanguage('en')");r.pause(p)
 result=p.evaluate('''()=>{let s=document.body.innerText.replaceAll('Трек без обложки','');for(const n of document.querySelectorAll('[title],[aria-label]'))s+=' '+(n.title||'')+' '+(n.getAttribute('aria-label')||'');return /[А-Яа-яЁё]/.test(s)?s:'';}''')
 check('Mini-player controls, preview and help relocalize',not result,result)
 check('Overlay preserves user track title','Трек без обложки' in p.locator('body').text_content())
 p.screenshot(path=str(OUT/'269-overlay-en.png'));clean(p,'Overlay')

def compact(b):
 for size in [(900,660),(1440,960)]:
  p=r.page_for(b,size=size);change(p,'en');p.locator('#settingsBtn').click();p.locator('[data-settings-page="language"]').click();r.pause(p)
  check('Language settings fit viewport '+str(size),p.locator('.settings-modal').evaluate('n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;}'))
  check('Language descriptions wrap rather than widening layout '+str(size),p.locator('[data-settings-panel="language"]').evaluate('n=>n.scrollWidth<=n.clientWidth+1'))
  clean(p,'Compact settings')

if __name__=='__main__':
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  for fn in [settings,player_and_studio,safety_and_fallback,overlay,compact]:
   try:fn(b)
   except Exception as e:checks.append({'name':fn.__name__+' completes','passed':False,'detail':traceback.format_exc()});print(traceback.format_exc(),flush=True)
  b.close()
 report={'environment':'Chromium 1440x960 and 900x660, real production renderer and overlay with local IPC/audio fixtures; not Windows Electron automation','passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks),'checks':checks}
 (OUT/'browser-i18n-269.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(report['passed'],'passed',report['failed'],'failed');raise SystemExit(bool(report['failed']))
