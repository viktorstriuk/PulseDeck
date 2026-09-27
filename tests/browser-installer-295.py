#!/usr/bin/env python3
"""Installer diagnostics/social polish rendered in real Chromium with mocked IPC."""
from pathlib import Path
import importlib.util,json,shutil,traceback
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/2.9.5';OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('fixture',ROOT/'tests/browser-regression.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
VERSION=json.loads((ROOT/'app/package.json').read_text())['version'];checks=[]
def check(name,value):
 checks.append({'name':name,'passed':bool(value)});print(('PASS ' if value else 'FAIL ')+name,flush=True)
 if not value: raise AssertionError(name)
try:
 en=json.loads((ROOT/'app/languages/en.json').read_text())['messages'];ru=json.loads((ROOT/'app/languages/ru.json').read_text())['messages']
 mock=f"""window.__setup={{links:[],reports:0}};window.setup={{bootstrap:async()=>({{version:{json.dumps(VERSION)},language:'ru',catalogs:{{ru:{json.dumps(ru,ensure_ascii=False)},en:{json.dumps(en)}}},languages:[{{code:'ru',name:'Русский',locale:'ru-RU'}},{{code:'en',name:'English',locale:'en-US'}}],systemLanguages:['ru-RU'],target:'C:\\\\Users\\\\Fixture\\\\AppData\\\\Local\\\\Programs\\\\PulseDeck',mode:'install',existing:false,places:[]}}),inspect:async()=>({{existing:false}}),folders:async p=>({{folder:p,parent:p,items:[]}}),execute:async()=>({{ok:true}}),minimize:async()=>true,close:async()=>true,launch:async()=>true,openReport:async()=>{{__setup.reports++;return true;}},openLink:async id=>{{__setup.links.push(id);return true;}},onProgress:cb=>{{window.__progress=cb;return()=>{{}};}}}};"""
 with sync_playwright() as pw:
  b=pw.chromium.launch(headless=True,executable_path=shutil.which('chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
  for scheme,width,height in [('dark',1020,742),('light',1020,742),('dark-800',800,600)]:
   color='dark' if scheme.startswith('dark') else 'light'
   p=b.new_page(viewport={'width':width,'height':height},bypass_csp=True,color_scheme=color);p.set_default_timeout(10000);errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
   html=(ROOT/'installer/ui/index.html').read_text().replace('<head>',f'<head><base href="{m.BASE}/installer/ui/"><script>{mock}</script>',1)
   p.set_content(html);p.wait_for_function("document.body.classList.contains('ready')")
   check(f'{scheme}: five author socials fit inside identity pane',p.locator('.maker-social').count()==5 and p.locator('.maker-socials').evaluate("el=>el.getBoundingClientRect().right<=el.closest('.identity-pane').getBoundingClientRect().right-12"))
   check(f'{scheme}: author footer stays inside pane',p.locator('.maker-block').evaluate("el=>el.getBoundingClientRect().bottom<=el.closest('.identity-pane').getBoundingClientRect().bottom"))
   p.locator('[data-social=github]').click();p.wait_for_function("__setup.links.includes('github')")
   check(f'{scheme}: social icon opens allowlisted link id',p.evaluate("__setup.links.includes('github')"))
   p.evaluate("__progress({phase:'error',error:'SetupErrorDisk',data:{drive:'C:',needed:'1.2 GB'},report:'C:\\\\Users\\\\Fixture\\\\AppData\\\\Local\\\\PulseDeck\\\\logs\\\\setup-report.log',target:'C:\\\\PulseDeck'})")
   check(f'{scheme}: disk error is specific', 'C:' in p.locator('#resultHint').inner_text() and '1.2 GB' in p.locator('#resultHint').inner_text())
   check(f'{scheme}: retry and report share one row',p.locator('#errorActions').evaluate("el=>{const a=[...el.children].map(n=>n.getBoundingClientRect());return getComputedStyle(el).display==='grid'&&Math.abs(a[0].top-a[1].top)<2&&Math.abs(a[0].width-a[1].width)<3}"))
   p.locator('#openReport').click();p.wait_for_function('__setup.reports===1');check(f'{scheme}: report button calls backend',p.evaluate('__setup.reports===1'))
   p.evaluate("__progress({phase:'error',error:'SetupErrorSourceMissing',data:{status:'404',host:'github.com'},report:'C:\\\\x.log'})")
   check(f'{scheme}: missing source renders repository link',p.locator('#resultHint .inline-link').inner_text()=='репозиторий PulseDeck')
   p.locator('#resultHint .inline-link').click();p.wait_for_function("__setup.links.includes('project')")
   p.screenshot(path=str(OUT/f'295-installer-{scheme}.png'))
   check(f'{scheme}: no renderer exceptions',not errors);p.close()
  b.close()
except Exception as e:
 checks.append({'name':'completion','passed':False,'error':str(e),'trace':traceback.format_exc()});print(traceback.format_exc())
finally:
 m.server.shutdown();report={'version':VERSION,'passed':sum(c['passed'] for c in checks),'failed':sum(not c['passed'] for c in checks),'checks':checks};(OUT/'browser-installer-295.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:report[k] for k in ['passed','failed']}))
raise SystemExit(1 if report['failed'] else 0)
