#!/usr/bin/env python3
"""Packaging smoke checks: real renderer/CSS, mocked Electron IPC, no remote downloads."""
from pathlib import Path
import importlib.util, json, shutil, traceback
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'test-results/2.7.0'; OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('fixture',ROOT/'tests/browser-regression.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
VERSION=json.loads((ROOT/'app/package.json').read_text())['version'];checks=[]
def check(name,value):
 checks.append({'name':name,'passed':bool(value)})
 print(('PASS ' if value else 'FAIL ')+name,flush=True)
 if not value: raise AssertionError(name)
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(headless=True,executable_path=shutil.which('chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
  p=b.new_page(viewport={'width':1440,'height':960},bypass_csp=True);p.set_default_timeout(12000);errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
  bridge=(ROOT/'tests/browser-bridge.js').read_text().replace("version:'2.6.9'",f"version:'{VERSION}'")
  storage="window.__storage={};Object.defineProperty(window,'localStorage',{value:{getItem:k=>window.__storage[k]||null,setItem:(k,v)=>window.__storage[k]=v},configurable:true});"
  html=(ROOT/'app/renderer/index.html').read_text().replace('<head>',f'<head><base href="{m.BASE}/app/renderer/"><script>'+storage+bridge+'</script>',1)
  p.set_content(html);p.wait_for_selector('#library [data-track-root]');p.wait_for_function(f"document.querySelector('#appVersion').textContent==='{VERSION}'")
  check('renderer initializes and shows packaged version',True)
  p.locator('#settingsBtn').click();p.locator('[data-settings-page=hotkeys]').click();p.wait_for_timeout(150)
  check('all eighteen global actions, including video toggle, are displayed',p.locator('#hotkeyList .hotkey-row').count()==18 and p.locator('[data-hotkey-row=toggleVideo]').count()==1)
  check('global switch has grid layout and text in distinct rows',p.locator('#hotkeysEnabled').evaluate("el=>{const row=el.parentElement;return getComputedStyle(row).display==='grid'&&row.querySelector('b').getBoundingClientRect().bottom<=row.querySelector('small').getBoundingClientRect().top+2;}"))
  p.screenshot(path=str(OUT/'270-hotkeys.png'))
  p.locator('[data-settings-page=appearance]').click();p.locator('#customIconBtn').click()
  check('custom icon editor opens with four background stops and one glyph stop',p.locator('#customBgStops .custom-stop-row').count()==4 and p.locator('#customFgStops .custom-stop-row').count()==1)
  p.locator('[data-custom-stop-pos="bg:0"]').evaluate("el=>{el.value=67;el.dispatchEvent(new Event('input',{bubbles:true}));}")
  check('moving gradient stop keeps the input node connected',p.locator('[data-custom-stop-pos="bg:0"]').input_value()=='67')
  p.locator('#addBgStopBtn').click();p.locator('#addBgStopBtn').click();p.locator('#addBgStopBtn').click()
  check('background gradient limit is seven colours',p.locator('#customBgStops .custom-stop-row').count()==7 and p.locator('#addBgStopBtn').is_disabled())
  p.locator('#addFgStopBtn').click();p.locator('#addFgStopBtn').click();p.locator('#addFgStopBtn').click()
  check('foreground gradient limit is four colours',p.locator('#customFgStops .custom-stop-row').count()==4 and p.locator('#addFgStopBtn').is_disabled())
  p.screenshot(path=str(OUT/'270-custom-icon.png'))
  p.evaluate("""() => {
    pulse.appearance.saveGeneratedIcon=async(name,data)=>{__mock.iconPng=data;return {ref:'custom-icons/0123456789abcdef01234567.png'};};
    const original=pulse.appearance.iconUrl;pulse.appearance.iconUrl=async ref=>ref.startsWith('custom-icons/')?new URL('../assets/app-icons/sky-monitor.png',document.baseURI).href:original(ref);
  }""")
  p.locator('#customIconSave').click();p.wait_for_function("document.querySelector('#customIconModal').classList.contains('hidden')")
  check('saving sends PNG raster and persists editor draft',p.evaluate("__mock.iconPng.startsWith('data:image/png;base64,')&&__mock.settings.customIconStyle.bg.length===7&&__mock.settings.appIcon.startsWith('custom-icons/')"))
  p.locator('#customIconBtn').click();check('editor restores last saved colours',p.locator('#customBgStops .custom-stop-row').count()==7);p.locator('#customIconCancel').click()
  p.locator('#surfaceApplyAll').check();p.locator('[data-surface-style=outline]').click();p.locator('#surfaceBorderThickness').evaluate("el=>{el.value=2.5;el.dispatchEvent(new Event('input',{bubbles:true}));}")
  p.wait_for_timeout(350)
  check('surface preferences are sent to persistence',p.evaluate("__mock.settings.surfaceStyle==='outline'&&__mock.settings.surfaceBorderThickness===2.5"))
  p.locator('[data-surface-style=invisible]').click();check('invisible mode has transparent panel fill',p.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--panel-bg').trim()==='transparent'"))
  p.locator('[data-surface-style=glass]').click()
  p.locator('[data-settings-page=library]').click();check('library action labels inherit button foreground',p.locator('#settingsFolderBtn').evaluate("el=>getComputedStyle(el).color===getComputedStyle(el.querySelector('[data-i18n]')).color"))
  p.locator('[data-settings-page=appearance]').click();p.evaluate("document.querySelector('[data-settings-panel=appearance]').scrollTop=0")
  p.screenshot(path=str(OUT/'270-appearance.png'))
  p.evaluate("pulse.i18n.setLanguage('en')");p.wait_for_timeout(200)
  p.locator('#customIconBtn').click();check('new editor labels translate to English',p.locator('#customIconTitle').inner_text()=='Build your own application icon');p.locator('#customIconCancel').click()
  check('no uncaught renderer JavaScript exceptions during smoke checks',not errors)
  b.close()
except Exception as error:
 checks.append({'name':'smoke completion','passed':False,'error':str(error),'trace':traceback.format_exc()});print(traceback.format_exc())
finally:
 m.server.shutdown()
 report={'version':VERSION,'environment':'Chromium; actual HTML/CSS/JS; test Electron IPC bridge. Not an actual Windows installation.','passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks),'checks':checks}
 (OUT/'browser-package.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({k:report[k] for k in ['passed','failed']}))
raise SystemExit(1 if report['failed'] else 0)
