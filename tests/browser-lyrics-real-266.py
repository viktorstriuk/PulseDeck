#!/usr/bin/env python3
"""Production lyric IPC, crypto, file storage, worker ZIP and real audio; window/dialog OS shims only."""
import json,subprocess,os,zipfile,traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1];OUT=R/'test-results';checks=[]
def check(name,ok,detail=None):
 checks.append({'name':name,'passed':bool(ok),'detail':detail});print(('PASS ' if ok else 'FAIL ')+name,flush=True)
 if not ok:raise AssertionError(name+': '+str(detail))
def invoke(p,c,*args):return p.evaluate('([c,a])=>__rpc(c,...a)',[c,list(args)])
def pause(p,t=150):p.wait_for_timeout(t)
def test_all(p):
 tracks=invoke(p,'library:list');song=next(t for t in tracks if t['rel']=='private-one.wav')
 initial=invoke(p,'lyrics:command',{'type':'get','rel':song['rel']})
 check('Real backend reads local LRC on demand',initial['doc']['lines'][0]['text']=='PRIVATE LYRIC FIRST')
 custom={'format':'pulsedeck-lyrics','version':1,'lines':[{'startMs':1000,'endMs':2500,'text':'PRIVATE LYRIC FIRST'},{'startMs':3000,'endMs':5500,'segments':[{'startMs':3000,'text':'PRIVATE '},{'startMs':4000,'text':'PHRASE GROUP '},{'startMs':5000,'text':'LAST'}]},{'startMs':8000,'endMs':9000,'text':'PRIVATE LYRIC THIRD'}],'theme':{'mode':'gradient','background':'#182e36','gradientColors':['#182e36','#342b46']}}
 invoke(p,'lyrics:command',{'type':'save','rel':song['rel'],'doc':custom,'revision':None})
 invoke(p,'vault:command',{'type':'protect','key':'custom:secret','name':'Личная коллекция','password':'my real password'})
 p.evaluate("__mock.emit('library:changed')");pause(p,250)
 info=invoke(p,'__inspect');check('Protecting moves saved lyrics and neighbor into ciphertext',len(info['lyricPrivateFiles'])==1 and len(info['lyricPublicFiles'])==0 and 'private-one.wav.lrc' not in info['musicFiles'])
 p.locator('#categoryChips [data-category="custom:secret"]').click();p.wait_for_selector('#vaultUnlockForm');p.locator('#vaultUnlockForm input').fill('my real password');p.locator('#vaultUnlockForm button').click();p.wait_for_selector('#library [data-track-root]',timeout=20000)
 p.locator('#library [data-track-root]').filter(has_text='Тихий океан').click();p.wait_for_function('audio.duration===64',timeout=12000);p.evaluate('audio.pause()');p.locator('#lyricsBtn').click();p.wait_for_selector('.ly-line',timeout=10000)
 check('Real decrypted lyric manifest reaches actual reader', 'PRIVATE LYRIC FIRST' in p.locator('#lyricsLines').inner_text())
 p.evaluate('audio.currentTime=4.2');p.wait_for_function('audio.currentTime>=4',timeout=8000);pause(p)
 check('Encrypted audio Range stream drives word sync, not a fake timer',p.locator('.ly-active .ly-sung').count()==2 and '/vault/' in p.locator('#audio').get_attribute('src'))
 p.locator('#lyricsEditBtn').click();p.locator('#lyricsRawBtn').click();text=json.loads(p.locator('#lyricsInput').input_value());text['lines'][0]['text']='PRIVATE REVISED';p.locator('#lyricsInput').fill(json.dumps(text));p.locator('#lyricsSaveBtn').click();p.wait_for_function("!document.querySelector('#lyricsEditor').open")
 check('Edits write back to authenticated encrypted lyric storage',len(invoke(p,'__inspect')['lyricPublicFiles'])==0)
 p.screenshot(path=str(OUT/'49-lyrics-encrypted-stream.png'))
 # Production PCM decoding + Worker + encrypted Range input, driven from the editor UI.
 p.locator('#lyricsEditBtn').click();p.locator('#lyricsAutoSync').click()
 p.wait_for_function("document.querySelector('#lyricsRhythmState').textContent.includes('Все строки уже размечены')",timeout=30000)
 check('268 Real protected analysis retains existing complete timing until opt-in',p.locator('#lyricsRhythmApply').is_disabled())
 p.locator('#lyricsRhythmKeep').uncheck();p.wait_for_function("!document.querySelector('#lyricsRhythmApply').disabled")
 check('268 Real local audio analysis produces reviewable candidate rows',p.locator('#lyricsRhythmPreview time').count()==3)
 p.screenshot(path=str(OUT/'67-real-protected-analysis.png'));p.locator('#lyricsRhythmApply').click()
 check('268 Applying real acoustic result edits draft without publishing plaintext',len(invoke(p,'__inspect')['lyricPublicFiles'])==0 and p.locator('.ly-timing-row').count()==3)
 p.locator('#lyricsUndo').click();p.locator('#lyricsEditorClose').click();p.wait_for_function("!document.querySelector('#lyricsEditor').open")
 check('268 Acoustic undo restores saved version without discard prompt',not p.locator('#lyricsConfirm').evaluate('(e)=>e.open'))
 p.locator('#lyricsSettingsBtn').click();p.locator('#lyricsFontScale').evaluate("e=>{e.value=115;e.dispatchEvent(new Event('input',{bubbles:true}))}")
 p.wait_for_function("document.querySelector('#lyricsAutosaveStatus').textContent==='Сохранено автоматически'")
 check('268 Private appearance autosaves with no public lyric cache',len(invoke(p,'__inspect')['lyricPublicFiles'])==0)
 p.locator('#lyricsSettingsClose').click()

 p.locator('#lyricsEditBtn').click();p.locator('#lyricsShiftLater').click();p.locator('#lyricsZipBtn').click();p.locator('#lyricsConfirmYes').click();p.wait_for_selector('#vaultPasswordModal:not(.hidden)');check('ZIP from private track prompts for fresh password',p.locator('[data-secret-field="source"]').count()==1)
 p.locator('[data-secret-field="source"]').fill('wrong');p.locator('#vaultPasswordSubmit').click();p.wait_for_function("document.body.innerText.includes('Неверный пароль')",timeout=10000)
 check('Wrong password does not produce an open ZIP',not Path(invoke(p,'__inspect')['exportPath']).exists())
 check('282 Private export returns to editor with unsaved draft and undo intact',p.locator('#lyricsEditor').is_visible() and not p.locator('#lyricsUndo').is_disabled())
 p.locator('#lyricsUndo').click()
 p.locator('#lyricsZipBtn').click();p.locator('#lyricsConfirmYes').click();p.locator('[data-secret-field="source"]').fill('my real password');p.locator('#vaultPasswordSubmit').click();p.wait_for_function("document.body.innerText.includes('Архив для ИИ сохранён')",timeout=15000)
 info=invoke(p,'__inspect')
 with zipfile.ZipFile(info['exportPath']) as z:
  check('Production ZIP has valid CRCs and original audio bytes',z.testzip() is None and z.read('audio.wav')==(R/'tests/fixtures/studio-audio.wav').read_bytes())
  check('ZIP includes current text, schema example and AI instructions','PRIVATE REVISED' in z.read('text.txt').decode() and {'track.json','README.md','INSTRUCTIONS.md','example.lyrics.json'}.issubset(z.namelist()))
 check('ZIP export did not unprotect original or recreate library audio','private-one.wav' not in info['musicFiles'] and len(info['lyricPublicFiles'])==0)
 # Keep editor open when main explicitly locks, to verify wiping not merely closing a view.
 p.locator('[data-word-row="0"][data-word-index="0"]').click();check('267 Private word editor opens on decrypted data',p.locator('.ly-word-panel:not(.hidden)').is_visible());invoke(p,'vault:command',{'type':'lock'});pause(p,200)
 check('Native lock notification clears private rows, editor and search fields',p.locator('#lyricsLines').inner_text()=='' and p.locator('#lyricsInput').input_value()=='' and p.locator('#lyricsSearchSong').input_value()=='' and not p.locator('#lyricsEditor').evaluate('(e)=>e.open'))
 check('282 Lock purges both decoded scene layers',p.locator('.ly-scene img[src]').count()==0)
 check('267 Lock wipes all word authoring DOM',p.locator('.ly-word-token,.ly-word-panel,.ly-time-field[data-time-row]').count()==0)
 check('Lock revokes backend access as well as hiding UI',invoke(p,'__inspect')['sessions']==0)
 p.locator('#lyricsCloseBtn').click();p.locator('#categoryChips [data-category="all"]').click();p.locator('#categoryChips [data-category="custom:secret"]').click();p.wait_for_selector('#vaultUnlockForm');p.locator('#vaultUnlockForm input').fill('my real password');p.locator('#vaultUnlockForm button').click();p.wait_for_selector('#library [data-track-root]',timeout=15000);p.locator('#library [data-track-root]').filter(has_text='Тихий океан').click();p.locator('#lyricsBtn').click();p.wait_for_selector('.ly-line')
 check('Re-unlock restores revised text and per-recording theme','PRIVATE REVISED' in p.locator('#lyricsLines').inner_text() and p.locator('#lyricsView').get_attribute('data-background')=='gradient')
 check('268 Encrypted autosaved scale survives lock and unlock',p.locator('#lyricsView').evaluate("e=>e.style.getPropertyValue('--ly-scale')")== '1.15')
 check('Real encrypted lyrics workflow has no uncaught JS error',not p._errors,p._errors)
if __name__=='__main__':
 server=subprocess.Popen(['node',str(R/'tests/vault-server.js')],env={**os.environ,'PD_LYRICS_TEST':'1'},stdout=subprocess.PIPE,stderr=open(OUT/'lyrics-real-server.log','w'),text=True)
 try:
  base='http://127.0.0.1:'+str(json.loads(server.stdout.readline())['port'])
  with sync_playwright() as pw:
   b=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);p=b.new_page(viewport={'width':1440,'height':960},bypass_csp=True);p.set_default_timeout(10000);p._errors=[];p.on('pageerror',lambda e:p._errors.append(str(e)))
   bridge=(R/'tests/browser-bridge.js').read_text()+'''
    window.__rpc=async(channel,...args)=>{const r=await fetch('''+json.dumps(base+'/__rpc')+''',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channel,args})});const m=await r.json();for(const e of m.events||[])__mock.emit(e.name,e.value);if(!m.ok)throw Error(m.error);return m.value;};
    pulse.vault={command:async c=>{const r=await __rpc('vault:command',c);if(r.settings)__mock.settings={...__mock.settings,...r.settings};return r;}};
    pulse.lyrics.command=c=>__rpc('lyrics:command',c);
    pulse.settings.get=async()=>{const s=await __rpc('settings:get');__mock.settings=s;return s;};pulse.settings.set=async s=>{const r=await __rpc('settings:set',s);__mock.settings=r;return r;};
    pulse.library.list=()=>__rpc('library:list');pulse.library.organize=c=>__rpc('library:organize',c);pulse.library.playback=rel=>__rpc('library:playback',rel);
   '''
   storage="Object.defineProperty(window,'localStorage',{value:{getItem:()=>null,setItem:()=>{}},configurable:true});"
   html=(R/'app/renderer/index.html').read_text().replace('<head>','<head><base href="'+base+'/app/renderer/"><script>'+storage+bridge+'</script>',1);p.set_content(html);p.wait_for_selector('#library [data-track-root]');pause(p,200)
   try:test_all(p)
   except Exception as e:
    checks.append({'name':'real lyrics completion','passed':False,'error':str(e),'trace':traceback.format_exc(),'jsErrors':p._errors});print(traceback.format_exc());p.screenshot(path=str(OUT/'failure-266-real.png'))
   b.close()
 finally:server.terminate();server.wait(timeout=10)
 report={'environment':'Actual renderer, main IPC, real file system, AES workers, protected range stream and ZIP; Electron APIs shims','passed':sum(x['passed'] for x in checks),'failed':sum(not x['passed'] for x in checks),'checks':checks};(OUT/'browser-lyrics-real-266.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(report['passed'],'passed',report['failed'],'failed');raise SystemExit(bool(report['failed']))
