#!/usr/bin/env python3
"""Real renderer/browser audio + native status fixtures. No Windows claims."""
import importlib.util,json,traceback,shutil,os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('base',ROOT/'tests/browser-regression.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
check=r.check;pause=r.pause;OUT=r.OUT

def status(p,**kwargs):
 d={'supported':True,'running':False,'active':False,'renderer':'none','reason':'', 'rtss':{'running':False,'hooked':False},'candidates':[],'foreground':None}
 d.update(kwargs);p.evaluate('(s)=>__mock.emit("game-status",s)',d);pause(p,50)

def run(browser):
 p=r.page_for(browser)
 p.evaluate('()=>{window.pulse.gameOverlay.configure=async c=>{__mock.settings.gameOverlay=structuredClone(c);return {settings:c}}}')
 check('265: package version shown',p.locator('#appVersion').inner_text()==json.loads((ROOT/'app/package.json').read_text())['version'])
 initial=r.order(p)
 p.locator('[data-track-root][data-id="t0"]').click(position={'x':100,'y':35})
 p.wait_for_function('!document.querySelector("#audio").paused && document.querySelector("#audio").currentTime > .05')
 p.locator('#audio').evaluate('a=>a.loop=true')
 p.locator('#settingsBtn').click();p.locator('[data-settings-page="games"]').click();pause(p,200)
 p.locator('[data-game-overlay-mode="auto"]').click();pause(p,200)
 check('265: automatic mode stays available',p.evaluate('__mock.settings.gameOverlay.mode')=='auto')
 status(p,running=True,active=True,renderer='rtss',hostVersion='2.6.5',reason='RTSS рисует PulseDeck внутри игры',foreground={'process':'bodycam.exe','title':'Bodycam (test fixture)','fullscreen':True},rtss={'running':True,'hooked':True,'version':'2.20','api':'Direct3D 12','renderWidth':1440,'renderHeight':1080,'outputWidth':1920,'outputHeight':1080,'stretched':True,'aspectScaleX':4/3})
 check('265: RTSS backend renders status', 'RTSS' in p.locator('#gameOverlayRenderer').inner_text())
 check('265: API and process appear',p.locator('#gameOverlayProcess').inner_text()=='bodycam.exe' and '12' in p.locator('#gameOverlayRtssApi').inner_text())
 check('265: stretch diagnostic retained',not p.locator('#gameOverlayStretchState').evaluate('e=>e.classList.contains("hidden")'))
 p.screenshot(path=str(OUT/'30-overlay-rtss-connected.png'))
 before=p.locator('#audio').evaluate('a=>a.currentTime')
 status(p,lastError='EPIPE: write EPIPE',restarting=True,reason='Связь с игровым модулем прервалась; обычный плеер продолжает работать')
 check('265: disconnected state clears active status',not p.locator('#gameOverlayHeaderStatus').evaluate('e=>e.classList.contains("active")'))
 check('265: failure reason fits and is visible','прервалась' in p.locator('#gameOverlayLiveReason').inner_text())
 check('265: native failure does not alter library/order',r.order(p)==initial)
 pause(p,350)
 after=p.locator('#audio').evaluate('a=>({time:a.currentTime,paused:a.paused,readyState:a.readyState,networkState:a.networkState,error:a.error?.message,src:a.currentSrc,duration:a.duration})')
 check('265: real browser audio continues through failure',not after['paused'] and after['time']>before,{'before':before,'after':after})
 status(p,restarting=False,retryAttempt=5,reason='Игровой модуль приостановлен после повторных сбоев. Нажми «Перезапустить модуль» в настройках')
 p.locator('#gameOverlayRestartBtn').scroll_into_view_if_needed();pause(p,100)
 p.screenshot(path=str(OUT/'31-overlay-restart-after-failure.png'))
 check('265: retry exhaustion remains recoverable',p.locator('#gameOverlayRestartBtn').is_enabled())
 p.evaluate("()=>{window.pulse.gameOverlay.restartHost=async()=>{__mock.calls.push({name:'restartHost'});return true}}")
 p.locator('#gameOverlayRestartBtn').click();pause(p,100)
 check('265: restart button disables during request',not p.locator('#gameOverlayRestartBtn').is_enabled())
 check('265: restart does not falsely announce completion','Перезапускаю игровой модуль' in p.locator('body').inner_text())
 pause(p,700);check('265: restart button becomes available again',p.locator('#gameOverlayRestartBtn').is_enabled())
 status(p,running=True,active=True,renderer='window-fallback',reason='RTSS не подключён; используется обычное окно проигрывателя')
 check('265: Windows fallback status survives recovery',p.locator('#gameOverlayLiveTitle').inner_text()=='Работает оконный плеер')
 p.evaluate('()=>{window.pulse.gameOverlay.restartHost=async()=>false}');p.locator('#gameOverlayRestartBtn').click();pause(p,100)
 check('265: rejected restart is not shown as success','Модуль не запущен' in p.locator('body').inner_text())
 pause(p,750);p.evaluate("()=>{window.pulse.gameOverlay.restartHost=async()=>{throw Error('test IPC failure')}}");p.locator('#gameOverlayRestartBtn').click();pause(p,100)
 check('265: IPC rejection handled in UI','Не удалось запросить перезапуск' in p.locator('body').inner_text())
 check('265: no unhandled browser exceptions',not p._errors,p._errors)
 p.close()

if __name__=='__main__':
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  try:run(b)
  except Exception as e:
   print(traceback.format_exc(),flush=True);r.RESULTS.append({'name':'overlay-265','passed':False,'error':str(e)})
   for ctx in b.contexts:
    for p in ctx.pages:
     try:p.screenshot(path=str(OUT/'failure-overlay-265.png'))
     except:pass
  finally:b.close()
 r.server.shutdown()
 report={'environment':'real renderer and Chromium audio; simulated native status/IPC','passed':sum(x['passed'] for x in r.RESULTS),'failed':sum(not x['passed'] for x in r.RESULTS),'checks':r.RESULTS}
 (OUT/'browser-overlay-265.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(report['passed'],'passed,',report['failed'],'failed');raise SystemExit(bool(report['failed']))
