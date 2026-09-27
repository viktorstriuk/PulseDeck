#!/usr/bin/env python3
"""Real encryption/storage/HTTP streaming + production renderer, mocked Electron window APIs only."""
import json,subprocess,shutil,os,traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1];OUT=R/'test-results';checks=[]
def check(name,value):
 checks.append({'name':name,'passed':bool(value)});print(('PASS ' if value else 'FAIL ')+name,flush=True)
 if not value:raise AssertionError(name)
def pause(p,n=120):p.wait_for_timeout(n)
def cat(p,key):return p.locator(f'#categoryChips [data-category="{key}"]')
def invoke(p,channel,*args):return p.evaluate('([c,a])=>__rpc(c,...a)',[channel,list(args)])
def secrets(p,values):
 for key,value in values.items():p.locator(f'[data-secret-field="{key}"]').fill(value)
 p.locator('#vaultPasswordSubmit').click()
def wait_rows(p,n,timeout=60000):
 # Real scrypt work can legitimately take longer on a contended hosted runner.
 # Wait for the unlocked render itself instead of treating a 20s CPU spike as a product failure.
 p.wait_for_function('(n)=>!document.querySelector("#vaultUnlockForm")&&document.querySelectorAll("#library [data-track-root]").length===n',arg=n,timeout=timeout)
def unlock(p,password):p.locator('#vaultUnlockForm input').fill(password);p.locator('#vaultUnlockForm button').click()
def test_all(p):
 check('Vault integration: library starts with four clear songs',p.locator('#library [data-track-root]').count()==4)
 cat(p,'custom:secret').click(button='right');p.locator('[data-category-command="style"]').click();p.locator('#categoryProtectedToggle').check();
 check('Protecting shows irrecoverability warning and password inputs',p.locator('#categoryPasswordFields').is_visible() and 'парол' in p.locator('#categoryPasswordFields').inner_text().lower())
 p.locator('#categoryPasswordInput').fill('my real password');p.locator('#categoryPasswordConfirm').fill('different');p.locator('#categoryStyleSave').click();pause(p)
 check('Mismatched creation passwords do not encrypt anything',invoke(p,'__inspect')['vaultCount']==0)
 p.locator('#categoryPasswordConfirm').fill('my real password');p.screenshot(path=str(OUT/'23-protection-settings.png'))
 # UI event loop must remain responsive while the real scrypt workers run.
 p.evaluate('window.__beats=0;window.__beatTimer=setInterval(()=>__beats++,10)');p.locator('#categoryStyleSave').click();p.wait_for_selector('#categoryStyleModal.hidden',state='attached',timeout=20000);wait_rows(p,2)
 check('Crypto worker did not block renderer event loop',p.evaluate('__beats')>=20);p.evaluate('clearInterval(__beatTimer)')
 info=invoke(p,'__inspect');check('Actual music directory no longer contains clear protected songs','private-one.wav' not in info['musicFiles'] and 'private-two.wav' not in info['musicFiles'])
 check('Public all list no longer discloses private titles','Тихий океан' not in p.locator('#library').inner_text() and 'Ночное небо' not in p.locator('#library').inner_text())
 cat(p,'custom:secret').click();p.wait_for_selector('#vaultUnlockForm');
 check('Locked playlist shows no song metadata',p.locator('#library [data-track-root]').count()==0 and 'Ночное небо' not in p.locator('body').inner_text())
 p.screenshot(path=str(OUT/'24-locked-playlist.png'))
 unlock(p,'wrong password');p.wait_for_function('document.querySelector("#vaultUnlockError").textContent.length>0',timeout=10000)
 check('Wrong password preserves usable lock form',p.locator('#vaultUnlockForm button').is_enabled() and p.locator('#vaultUnlockForm input').input_value()=='')
 unlock(p,'my real password');wait_rows(p,2)
 check('Correct password decrypts actual manifest with both titles','Тихий океан' in p.locator('#library').inner_text() and 'Ночное небо' in p.locator('#library').inner_text())
 p.screenshot(path=str(OUT/'25-unlocked-playlist.png'))
 p.locator('#library [data-track-root]').first.click();p.wait_for_function('document.querySelector("audio").duration>0',timeout=10000)
 media=p.locator('#audio').evaluate('a=>({src:a.src,cross:a.crossOrigin,duration:a.duration,error:a.error?.code})')
 check('Private audio uses real authenticated loopback stream', '/vault/' in media['src'] and media['cross']=='anonymous' and not media.get('error'))
 p.locator('#audio').evaluate('a=>{a.currentTime=4}');p.wait_for_function('document.querySelector("audio").currentTime>=4')
 check('Protected stream supports actual browser seeking',p.locator('#audio').evaluate('a=>a.currentTime>=4'))
 cat(p,'custom:open').click();pause(p);info=invoke(p,'__inspect')
 check('Leaving private category clears audio and live keys/tokens',info['sessions']==0 and info['tokens']==0 and p.locator('#audio').get_attribute('src') is None)
 cat(p,'custom:secret').click();p.wait_for_selector('#vaultUnlockForm');unlock(p,'my real password');wait_rows(p,2)
 check('Returning to same private playlist requires password again',True)
 # Password is required for transfers, even while source playlist is unlocked.
 item=p.locator('#library [data-track-root]').first;item.click(button='right');p.locator('[data-submenu-trigger="addTo"]').click();p.locator('[data-add-category="custom:open"]').click();p.wait_for_selector('#vaultPasswordModal:not(.hidden)')
 check('Export warning explicitly says the song will become public','без пароля' in p.locator('#vaultPasswordText').inner_text())
 secrets(p,{'source':'wrong'});p.wait_for_function('document.querySelector("body").innerText.includes("Неверный пароль")',timeout=10000)
 check('Wrong transfer password leaves public destination empty',len(invoke(p,'settings:get')['customCategories'][2]['tracks'])==0)
 # Reopen context: a rejected operation must not disable later actions.
 p.keyboard.press('Escape');p.locator('#library [data-track-root]').first.click(button='right');p.locator('[data-submenu-trigger="addTo"]').click();p.locator('[data-add-category="custom:open"]').click();secrets(p,{'source':'my real password'})
 p.wait_for_function('document.querySelector("#vaultInfoBanner")?.innerText.includes("открытыми")',timeout=12000)
 check('A formerly private song now has an explicit public-copy indicator','открытыми' in p.locator('#vaultInfoBanner').inner_text())
 info=invoke(p,'__inspect');check('Export wrote exactly one intentional public audio copy',sum(n in info['musicFiles'] for n in ['private-one.wav','private-two.wav'])==1)
 # Link access using production commands, then exercise UI navigation into lazy peers.
 cat(p,'custom:second').click(button='right');p.locator('[data-category-command="style"]').click();p.locator('#categoryProtectedToggle').check();p.locator('#categoryPasswordInput').fill('second real password');p.locator('#categoryPasswordConfirm').fill('second real password');p.locator('#categoryStyleSave').click();p.wait_for_selector('#categoryStyleModal.hidden',state='attached',timeout=20000);pause(p,250)
 # Source is active: link via real group UI.
 cat(p,'custom:secret').click(button='right');p.locator('[data-submenu-trigger="access-link"]').click();p.locator('[data-link-access="custom:second"]').click();p.wait_for_selector('#vaultPasswordModal:not(.hidden)')
 secrets(p,{'custom:secret':'my real password','custom:second':'second real password','new':'group real password','confirm':'group real password'})
 p.wait_for_selector('#vaultUnlockForm',timeout=15000);unlock(p,'group real password');wait_rows(p,2)
 cat(p,'custom:second').click();p.wait_for_function('!document.querySelector("#vaultUnlockForm")',timeout=8000)
 check('Shared password opens linked second playlist without a second prompt',p.locator('#vaultUnlockForm').count()==0 and p.locator('#vaultInfoBanner').count()==1)
 cat(p,'custom:secret').click();wait_rows(p,2)
 check('Linked playlists remain separate and retain their contents',len(invoke(p,'settings:get')['customCategories'])==3)
 cat(p,'all').click();pause(p);cat(p,'custom:secret').click();p.wait_for_selector('#vaultUnlockForm')
 check('Leaving linked group revokes shared access',invoke(p,'__inspect')['sessions']==0)
 check('No uncaught JavaScript errors in real encrypted workflow',not p._errors)

if __name__=='__main__':
 server=subprocess.Popen(['node',str(R/'tests/vault-server.js')],stdout=subprocess.PIPE,stderr=open(OUT/'vault-server-stderr.log','w'),text=True)
 try:
  BASE='http://127.0.0.1:'+str(json.loads(server.stdout.readline())['port'])
  with sync_playwright() as pw:
   b=pw.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
   p=b.new_page(viewport={'width':1440,'height':1000},bypass_csp=True);p.set_default_timeout(10000);p._errors=[];p.on('pageerror',lambda e:p._errors.append(str(e)))
   storage="Object.defineProperty(window,'localStorage',{value:{getItem:()=>null,setItem:()=>{}},configurable:true});"
   bridge=(R/'tests/browser-bridge.js').read_text()+'''
   window.__rpc=async(channel,...args)=>{const r=await fetch('''+json.dumps(BASE+'/__rpc')+''',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channel,args})});const m=await r.json();if(!m.ok)throw Error(m.error);return m.value;};
   pulse.vault={command:async c=>{const r=await __rpc('vault:command',c);if(r.settings)__mock.settings={...__mock.settings,...r.settings};return r;}};
   pulse.settings.get=async()=>{const s=await __rpc('settings:get');__mock.settings=s;return s;};
   pulse.settings.set=async s=>{const r=await __rpc('settings:set',s);__mock.settings=r;return r;};
   pulse.library.list=()=>__rpc('library:list');pulse.library.organize=c=>__rpc('library:organize',c);pulse.library.playback=rel=>__rpc('library:playback',rel);
   '''
   html=(R/'app/renderer/index.html').read_text().replace('<head>','<head><base href="'+BASE+'/app/renderer/"><script>'+storage+bridge+'</script>',1)
   p.set_content(html);p.wait_for_selector('#library [data-track-root]');pause(p,300)
   try:test_all(p)
   except Exception as e:
    checks.append({'name':'encrypted workflow completion','passed':False,'error':str(e),'trace':traceback.format_exc(),'jsErrors':p._errors});print(traceback.format_exc(),flush=True);p.screenshot(path=str(OUT/'failure-264-vault.png'));print(p.locator('body').inner_text()[-3000:],flush=True)
   b.close()
 finally:server.terminate();server.wait(timeout=10)
 report={'environment':'Chromium actual renderer + production main handlers/crypto workers/files/HTTP stream; Electron window APIs mocked','passed':sum(x['passed'] for x in checks),'failed':sum(not x['passed'] for x in checks),'checks':checks};(OUT/'browser-vault-264.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(report['passed'],'passed,',report['failed'],'failed');raise SystemExit(bool(report['failed']))
