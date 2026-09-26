#!/usr/bin/env python3
"""Run the real renderer/overlay with a test IPC bridge and a local fixture server.
No Electron/Windows input injection: native hit testing is covered separately by
Node VM tests. Managed Chromium blocks navigations in the build environment, so
HTML is installed with set_content and only local subresources are fetched.
"""
from __future__ import annotations
import functools, http.server, json, os, shutil, threading, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'app/package.json').read_text())['version']
OUT=ROOT/'test-results'; OUT.mkdir(exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
    def end_headers(self):
        # set_content has an opaque origin. Mask SVGs require CORS for this
        # test fixture, unlike production file:// resources in Electron.
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Cross-Origin-Resource-Policy','cross-origin')
        super().end_headers()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=f'http://127.0.0.1:{server.server_port}'
RESULTS=[]

def check(name,condition,detail=None):
    ok=bool(condition); RESULTS.append({'name':name,'passed':ok,**({'detail':detail} if detail is not None else {})})
    print(('PASS ' if ok else 'FAIL ')+name,flush=True)
    if not ok: raise AssertionError(f'{name}: {detail}')

def pause(page,ms=180): page.wait_for_timeout(ms)
def order(page): return page.locator('#library [data-track-root]').evaluate_all('(nodes)=>nodes.map(n=>n.dataset.id)')
def catorder(page,rail): return page.locator(rail+' [data-category]').evaluate_all('(nodes)=>nodes.map(n=>n.dataset.category)')
def center(page,selector):
    r=page.locator(selector).bounding_box(); assert r,selector
    return r['x']+r['width']/2,r['y']+r['height']/2

def page_for(browser,kind='renderer',size=(1440,960),stored=None):
    page=browser.new_page(viewport={'width':size[0],'height':size[1]},bypass_csp=True)
    page.set_default_timeout(8000); page._errors=[]
    page.on('pageerror',lambda error:page._errors.append(str(error)))
    bridge=(ROOT/'tests'/('browser-bridge.js' if kind=='renderer' else 'overlay-bridge.js')).read_text()
    storage='window.__storage='+json.dumps(stored or {})+';'+"Object.defineProperty(window,'localStorage',{value:{getItem:k=>window.__storage[k]||null,setItem:(k,v)=>window.__storage[k]=v},configurable:true});"
    html=(ROOT/f'app/{kind}/index.html').read_text().replace('<head>',f'<head><base href="{BASE}/app/{kind}/"><script>'+storage+bridge+'</script>',1)
    page.set_content(html)
    if kind=='renderer':
        page.wait_for_selector('#library [data-track-root]'); page.wait_for_function(f"document.querySelector('#appVersion').textContent==='{VERSION}'")
    else:
        page.wait_for_function("window.__overlay && window.Icon")
        page.evaluate("""() => {__overlay.emit('config',{mode:'always',cornerRadius:18,showCover:true,showControls:true,showProgress:true,showClickThroughToggle:true,visualizer:false,showLabel:true,backgroundVisible:true,borderVisible:true});__overlay.emit('state',{title:'Трек без обложки',artist:'Morgenstern',playing:false,duration:180,currentTime:30,fallbackCover:new URL('../assets/app-icons/ocean-monitor.png',document.baseURI).href});__overlay.emit('interaction',{clickThrough:true,passThrough:true});} """)
    pause(page,250)
    return page

def start_drag(page,index,target,vertical=False):
    items=page.locator('#library [data-track-root]')
    a=items.nth(index).bounding_box(); b=items.nth(target).bounding_box(); assert a and b
    # Start on the artwork, not on a nested button.
    x=a['x']+(180 if 'list-view' in page.locator('#library').get_attribute('class') else 40); y=a['y']+a['height']/2
    page.mouse.move(x,y);page.mouse.down()
    page.mouse.move(x+(b['x']-a['x']),y+(b['y']-a['y']),steps=12)
    pause(page,100)

def start_cat_drag(page,rail,index,target):
    items=page.locator(rail+' [data-category]');a=items.nth(index).bounding_box();b=items.nth(target).bounding_box(); assert a and b
    page.mouse.move(a['x']+a['width']/2,a['y']+a['height']/2);page.mouse.down()
    # Move just beyond the target's midpoint for insertion AFTER that item.
    side=rail=='#categorySidebar'
    page.mouse.move(b['x']+b['width']/2+(0 if side else 12),b['y']+b['height']/2+(12 if side else 0),steps=12)
    pause(page,120)

def test_branding(browser):
    p=page_for(browser)
    check('Главный слоган заменён',p.locator('.brand').inner_text().find('Твоя локальная музыкальная волна')>=0)
    p.locator('#settingsBtn').click();pause(p)
    check('Версия загружена в нижнюю карточку', f'PulseDeck {VERSION}' in p.locator('#settingsAbout').inner_text())
    about=p.locator('#settingsAbout').bounding_box();nav=p.locator('.settings-nav').bounding_box()
    check('Карточка находится внизу навигации без обрезания',about['y']>nav['y']+nav['height']*.65 and about['y']+about['height']<=nav['y']+nav['height'])
    p.locator('#settingsAbout').click();pause(p)
    check('Карточка открывает локальный раздел о приложении',p.locator('#aboutPanel').is_visible())
    check('Карточка не открывает выдуманный репозиторий',p.evaluate("!__mock.calls.some(c=>c.name==='openExternal')"))
    p.locator('[data-settings-page="player"]').click();pause(p)
    check('Только страница плеера включает предпросмотр',p.evaluate("__mock.calls.filter(c=>c.name==='preview').at(-1).value===true"))
    p.locator('[data-settings-page="library"]').click();pause(p)
    check('Смена категории прекращает предпросмотр',p.evaluate("__mock.calls.filter(c=>c.name==='preview').at(-1).value===false"))
    p.locator('[data-settings-page="appearance"]').click();pause(p)
    p.screenshot(timeout=20000,path=str(OUT/'01-settings-about.png'))
    p.locator('[data-app-icon="builtin:forest"]').click();pause(p,250)
    check('Новая иконка меняет бренд и карточку версии',p.locator('.brand-icon').get_attribute('src').endswith('forest-monitor.png') and p.locator('.settings-about-icon').get_attribute('src').endswith('forest-monitor.png'))
    check('Все заглушки сразу меняются на выбранную иконку',p.locator('.app-cover-fallback').evaluate_all("ns=>ns.length>0&&ns.every(n=>n.src.endsWith('forest-monitor.png')&&n.naturalWidth>0)"))
    check('Настоящая обложка не заменена заглушкой',p.locator('[data-id="t0"] .cover-img').get_attribute('src').endswith('sunset-monitor.png'))
    check('Неисправная обложка заменена иконкой',p.locator('[data-id="t2"] .cover-img').count()==0 and p.locator('[data-id="t2"] .app-cover-fallback').get_attribute('src').endswith('forest-monitor.png'))
    check('Иконка отправлена отдельным fallbackCover для оверлея',p.evaluate("__mock.overlayState.fallbackCover.endsWith('forest-monitor.png') && !__mock.overlayState.cover"))
    # Resolve an older choice late: it must not overwrite the newest one.
    p.evaluate("__mock.iconDelays['builtin:ocean']=400")
    p.locator('[data-app-icon="builtin:ocean"]').click();p.locator('[data-app-icon="builtin:indigo"]').click();pause(p,650)
    check('Поздний ответ старой иконки не перезаписывает новый выбор',p.locator('.brand-icon').get_attribute('src').endswith('indigo-monitor.png'))
    p.keyboard.press('Escape');pause(p)
    p.locator('[data-track-root][data-id="t1"]').click();pause(p,250)
    check('Нижний плеер использует выбранную иконку без обложки',p.locator('#playerCover .app-cover-fallback').get_attribute('src').endswith('indigo-monitor.png') and p.locator('#playerCover .cover-img').count()==0)
    p.locator('#listViewBtn').click();pause(p)
    check('Заглушки работают и в режиме списка',p.locator('#library .app-cover-fallback').evaluate_all("ns=>ns.length===12&&ns.every(n=>n.src.endsWith('indigo-monitor.png'))"))
    p.screenshot(timeout=20000,path=str(OUT/'02-app-icon-placeholders.png'))
    check('Оформление: нет ошибок JavaScript',not p._errors,p._errors)
    p.close()
    p=page_for(browser,size=(900,660));p.locator('#settingsBtn').click();pause(p)
    p.locator('#settingsAbout').scroll_into_view_if_needed();p.screenshot(timeout=20000,path=str(OUT/'03-settings-compact.png'))
    r=p.locator('#settingsAbout').bounding_box()
    check('Карточка доступна в компактном окне',r['x']>=0 and r['y']>=0 and r['x']+r['width']<=900 and r['y']+r['height']<=660)
    check('Полная подпись карточки не обрезается',p.locator('.settings-about-copy small').evaluate('e=>e.scrollHeight<=e.clientHeight+1 && e.scrollWidth<=e.clientWidth+1'))
    p.close()

def test_tracks(browser):
    p=page_for(browser);initial=order(p)
    start_drag(p,0,1)
    check('Горизонтальное перетаскивание запускается',p.locator('.track-drag-ghost').count()==1)
    p.evaluate("window.__held=document.querySelector('.track-drag-placeholder');__mock.emit('library:changed')");pause(p,220)
    check('Тот же список не прерывает удерживаемое перетаскивание',p.evaluate("__held===document.querySelector('.track-drag-placeholder')&&document.body.classList.contains('track-reordering')"))
    p.evaluate("__mock.tracks.push({...__mock.tracks[1],id:'extra',rel:'new-file.wav',title:'Добавленный во время drag',addedAt:1});__mock.emit('library:changed')");pause(p,180)
    check('Новый файл откладывается до отпускания мыши',len(order(p))==12 and p.locator('.track-drag-ghost').count()==1)
    p.screenshot(timeout=20000,path=str(OUT/'04-track-drag-held.png'))
    p.mouse.up();pause(p,350)
    after=order(p)
    check('После отпускания сохранён перенос и показан новый файл',after[:2]==['t1','t0'] and len(after)==13,after)
    check('Drag сохраняет одну операцию и выбирает «Свой порядок»',p.evaluate("__mock.patches.filter(p=>p.trackOrders).length===1 && __mock.settings.sort==='manual'") and p.locator('#sortLabel').inner_text()=='Свой порядок')
    check('Перетаскивание не запускает песню',p.evaluate("!__mock.overlayState.playing"))
    p.keyboard.press('Control+z');pause(p)
    check('Ctrl+Z восстанавливает исходную сортировку',order(p)[:12]==initial and p.locator('#sortLabel').inner_text()=='Сначала новые')
    p.keyboard.press('Control+Shift+z');pause(p)
    check('Ctrl+Shift+Z повторяет перемещение',order(p)==after)
    # Cards can move into a different row, then cancel without persisting.
    patch_count=p.evaluate('__mock.patches.length');before=order(p)
    start_drag(p,0,4)
    check('Карточка переносится в следующую строку',order(p)[4]==before[0],order(p))
    p.keyboard.press('Escape');p.mouse.up();pause(p)
    check('Escape полностью отменяет drag',order(p)==before and p.locator('.track-drag-ghost').count()==0 and p.evaluate('__mock.patches.length')==patch_count)
    # Preserve saved manual order independently of an automatic sort.
    p.locator('#sortTrigger').click();p.locator('[data-sort="titleDesc"]').click();pause(p)
    check('Автоматическая сортировка больше не содержит приписку',p.locator('#sortLabel').inner_text()=='Название · Я-А')
    p.locator('#sortTrigger').click();p.locator('[data-sort="manual"]').click();pause(p)
    check('Возврат к «Своему порядку» восстанавливает ручной порядок',order(p)==before)
    stored=p.evaluate('window.__storage');p.close()
    p=page_for(browser,stored=stored)
    check('Ручной порядок переживает перезапуск интерфейса',order(p)==[x for x in before if x!='extra'])
    p.locator('#listViewBtn').click();pause(p);before=order(p)
    check('Перестановка списка проверяется в настоящем режиме списка',p.locator('#library.list-view').count()==1)
    start_drag(p,0,3)
    p.evaluate("__mock.listDelay=180;__mock.emit('library:changed')");pause(p,280)
    check('Перетаскивание списка переживает асинхронный refresh',p.locator('.track-drag-ghost').count()==1)
    p.mouse.up();pause(p,300)
    after=order(p)
    check('Список сохраняет вертикальное перемещение',after[3]==before[0] and after!=before,after)
    p.keyboard.press('Control+z');pause(p);p.keyboard.press('Control+y');pause(p)
    check('Ctrl+Y повторяет перемещение списка',order(p)==after)
    # A late older response must not lose a file returned by a newer request.
    p.evaluate("__mock.listDelay=300;__mock.emit('library:changed');__mock.tracks.push({...__mock.tracks[1],id:'latest',rel:'latest.wav'});__mock.listDelay=0;__mock.emit('library:changed')");pause(p,450)
    check('Запоздавший ответ библиотеки не стирает более новый список',p.locator('[data-track-root][data-id="latest"]').count()==1)
    check('Перетаскивание: нет ошибок JavaScript',not p._errors,p._errors)
    p.screenshot(timeout=20000,path=str(OUT/'05-list-order.png'));p.close()

def test_playlists(browser):
    p=page_for(browser)
    check('Все 90 пользовательских плейлистов присутствуют',p.locator('#categoryChips [data-category^="custom:"]').count()==90)
    rail='#categoryChips';before=catorder(p,rail)
    start_cat_drag(p,rail,0,2)
    check('Верхний плейлист начинает pointer drag',p.locator('.category-reordering').count()==1)
    p.evaluate("window.__held=document.querySelector('.dragging-category');__mock.emit('library:changed')");pause(p,260)
    check('Обновление библиотеки не заменяет захваченный плейлист',p.evaluate("__held===document.querySelector('.dragging-category')"))
    p.mouse.up();pause(p,300);after=catorder(p,rail)
    check('Порядок верхних плейлистов сохранён',after.index(before[0])>=2 and after!=before and p.evaluate('__mock.settings.categoryOrder')==after,after[:6])
    # Same update during a pending press must not destroy the pointer target.
    start_cat_drag(p,rail,0,2);p.keyboard.press('Escape');p.mouse.up();pause(p,300)
    check('Escape возвращает порядок плейлистов',catorder(p,rail)==after)
    p.mouse.move(*center(p,rail));p.mouse.wheel(0,120000);pause(p)
    check('Колесо достигает последнего плейлиста сверху',p.locator(rail).evaluate('e=>e.scrollLeft>=e.scrollWidth-e.clientWidth-2'))
    p.locator('[data-category-layout="side"]').click();pause(p)
    rail='#categorySidebar';before=catorder(p,rail)
    start_cat_drag(p,rail,0,3)
    p.evaluate("__mock.emit('library:changed')");pause(p,200)
    check('Боковой drag не прерывается при refresh',p.locator(rail+'.category-reordering').count()==1)
    p.mouse.up();pause(p,300);after=catorder(p,rail)
    check('Сохранено вертикальное перемещение плейлиста',after.index(before[0])>=3 and after!=before,after[:6])
    p.mouse.move(*center(p,rail));p.mouse.wheel(0,120000);pause(p,200)
    check('Колесо достигает последнего плейлиста сбоку',p.locator(rail).evaluate('e=>e.scrollTop>=e.scrollHeight-e.clientHeight-2'))
    p.screenshot(timeout=20000,path=str(OUT/'06-playlist-sidebar-scroll.png'))
    stored=p.evaluate('window.__storage');p.close();p=page_for(browser,stored=stored)
    check('Порядок плейлистов сохраняется после перезапуска',catorder(p,'#categorySidebar')==after)
    check('Плейлисты: нет ошибок JavaScript',not p._errors,p._errors);p.close()

def test_overlay(browser):
    p=page_for(browser,'overlay',(480,150))
    check('Оверлей получает несколько интерактивных областей',p.evaluate('__overlay.regions.length>=5'))
    for action in ['previous','playPause','next']:
        el=p.locator(f'[data-action="{action}"]');x,y=center(p,f'[data-action="{action}"]')
        check(f'Кнопка {action} не перекрыта краем или фоном',p.evaluate('([x,y,a])=>document.elementFromPoint(x,y)?.closest("[data-action]")?.dataset.action===a',[x,y,action]))
        el.click();pause(p,60)
        check(f'{action} работает при сквозных кликах',p.evaluate('(a)=>__overlay.calls.some(c=>c.name==="control"&&c.value.action===a)',action))
    check('Жест кнопки отпускает захват после клика',p.evaluate("__overlay.calls.filter(c=>c.name==='gesture').at(-1).value===false"))
    p.locator('#clickThroughToggle').click();pause(p)
    check('Переключатель доступен и выключает сквозные клики',p.locator('#clickThroughToggle').get_attribute('aria-pressed')=='false')
    check('В выключенном состоянии используется crossed SVG',p.locator('#clickThroughToggle span').evaluate("e=>getComputedStyle(e).maskImage.includes('pointer-crossed.svg')"))
    p.locator('#clickThroughToggle').click();pause(p)
    check('Повторный клик включает сквозные клики',p.locator('#clickThroughToggle').get_attribute('aria-pressed')=='true')
    r=p.locator('#progressWrap').bounding_box();assert r
    check('Широкая перемотка не усечена до ста пикселей',r['width']>100 and p.evaluate('(w)=>__overlay.regions.some(r=>r.width>=w-1)',r['width']))
    p.mouse.move(r['x']+r['width']*.35,r['y']+r['height']/2);p.mouse.down();pause(p,350)
    check('Удержание перемотки продлевает захват',p.evaluate("__overlay.calls.filter(c=>c.name==='gesture'&&c.value===true).length>=3"))
    p.mouse.move(r['x']+r['width']+35,r['y']-40,steps=6);p.mouse.up();pause(p)
    seeks=p.evaluate("__overlay.calls.filter(c=>c.name==='control'&&c.value.action==='seekTo').map(c=>c.value.value)")
    check('Перемотка работает за исходными границами и ограничивается концом',len(seeks)>=2 and seeks[-1]==1,seeks)
    check('Отпускание перемотки завершает захват',p.evaluate("__overlay.calls.filter(c=>c.name==='gesture').at(-1).value===false"))
    p.locator('#progressWrap').focus();p.keyboard.press('Home');pause(p)
    check('Клавиатурная перемотка тоже работает',p.evaluate("__overlay.calls.filter(c=>c.name==='control').at(-1).value.value===0"))
    check('Заглушка плеера — выбранная иконка приложения',p.locator('#cover').evaluate("e=>e.src.endsWith('ocean-monitor.png')&&e.naturalWidth>0&&e.classList.contains('is-placeholder')"))
    p.screenshot(timeout=20000,path=str(OUT/'07-player-interactive.png'))
    from PIL import Image
    image=Image.open(OUT/'07-player-interactive.png').convert('RGB'); switch=p.locator('#clickThroughToggle span').bounding_box()
    crop=image.crop((int(switch['x']),int(switch['y']),int(switch['x']+switch['width']),int(switch['y']+switch['height'])))
    check('SVG указателя действительно нарисован внутри кнопки',sum(min(rgb)>200 for rgb in (crop.get_flattened_data() if hasattr(crop,'get_flattened_data') else crop.getdata()))>12)
    p.evaluate("__overlay.emit('config',{showClickThroughToggle:false})");pause(p)
    check('Скрытый переключатель исключён из областей клика',not p.locator('#clickThroughToggle').is_visible())
    p.locator('#playButton').click();pause(p)
    check('Транспорт работает даже со скрытым переключателем',p.evaluate("__overlay.calls.filter(c=>c.name==='control').at(-1).value.action==='playPause'"))
    p.evaluate("__overlay.emit('config',{showControls:false,showProgress:false})");pause(p)
    check('Скрытые транспортные элементы не сохраняют мёртвые hit regions',p.evaluate("__overlay.regions.length===0"),p.evaluate('__overlay.regions'))
    p.evaluate("__overlay.emit('config',{showControls:true,showProgress:true,showClickThroughToggle:true});__overlay.emit('state',{cover:new URL('../assets/app-icons/forest-monitor.png',document.baseURI).href})");pause(p)
    check('Реальная обложка имеет приоритет над заглушкой',p.locator('#cover').evaluate("e=>e.src.endsWith('forest-monitor.png')&&!e.classList.contains('is-placeholder')"))
    p.evaluate("__overlay.emit('state',{cover:new URL('/missing.png',document.baseURI).href})");pause(p,350)
    check('Ошибка загрузки настоящей обложки показывает выбранную иконку',p.locator('#cover').evaluate("e=>e.src.endsWith('ocean-monitor.png')&&e.naturalWidth>0"))
    p.evaluate("__overlay.emit('state',{cover:'',fallbackCover:new URL('../assets/app-icons/indigo-monitor.png',document.baseURI).href})");pause(p)
    check('Смена иконки немедленно обновляет обложку оверлея',p.locator('#cover').get_attribute('src').endswith('indigo-monitor.png'))
    check('В сквозном режиме угловые зоны растягивания выключены',not p.locator('[data-resize="sw"]').is_visible())
    p.locator('#clickThroughToggle').click();pause(p)
    handle=p.locator('[data-resize="sw"]');r=handle.bounding_box();assert r
    point=p.evaluate("""([x,y,w,h])=>{
      const handle=document.querySelector('[data-resize="sw"]');
      for(let yy=y+h-3;yy>=y+3;yy-=2) for(let xx=x+3;xx<=x+w-3;xx+=2){
        if(document.elementFromPoint(xx,yy)?.closest('[data-resize="sw"]')===handle) return [xx,yy];
      }
      return null;
    }""",[r['x'],r['y'],r['width'],r['height']])
    check('После выключения сквозных кликов зона растягивания принимает указатель',point,point)
    p.mouse.move(point[0],point[1]);p.mouse.down();p.mouse.move(20,130,steps=4);p.mouse.up();pause(p)
    check('После выключения сквозных кликов растягивание доступно',p.evaluate("__overlay.calls.some(c=>c.name==='resizeBegin')&&__overlay.calls.some(c=>c.name==='resizeMove')&&__overlay.calls.some(c=>c.name==='resizeEnd')"))
    p.locator('#clickThroughToggle').click();pause(p)
    p.set_viewport_size({'width':900,'height':250});pause(p)
    check('При изменении размеров hit regions пересчитаны',p.evaluate('__overlay.regions.some(r=>r.width>650)'))
    p.set_viewport_size({'width':420,'height':420});p.evaluate("__overlay.emit('config',{visualizerStyle:'orb',visualizer:true,showLabel:false,showPlaylist:false});__overlay.emit('state',{title:'Без обложки',cover:''})");pause(p)
    check('Orb использует ту же выбранную заглушку',p.locator('#orbCover').evaluate("e=>e.src.endsWith('indigo-monitor.png')&&e.naturalWidth>0") and p.locator('#orbCoverShell').is_visible())
    p.locator('#playButton').click();pause(p)
    check('Кнопка плеера кликабельна и в режиме Orb',p.evaluate("__overlay.calls.filter(c=>c.name==='control').at(-1).value.action==='playPause'"))
    p.screenshot(timeout=20000,path=str(OUT/'08-player-orb.png'))
    p.set_viewport_size({'width':180,'height':38});p.evaluate("__overlay.emit('config',{visualizerStyle:'bars',visualizer:false})");pause(p)
    x,y=center(p,'#clickThroughToggle')
    check('Переключатель не перекрывается в минимальном размере',0<=x<=180 and 0<=y<=38 and p.evaluate('([x,y])=>document.elementFromPoint(x,y)?.closest("#clickThroughToggle")!==null',[x,y]))
    p.locator('#clickThroughToggle').click();pause(p)
    check('Минимальный плеер позволяет выключить сквозные клики',p.locator('#clickThroughToggle').get_attribute('aria-pressed')=='false')
    p.screenshot(timeout=20000,path=str(OUT/'09-player-minimum.png'))
    check('Оверлей: нет ошибок JavaScript',not p._errors,p._errors);p.close()

if __name__=='__main__':
    try:
        with sync_playwright() as pw:
            executable=os.environ.get('CHROMIUM') or shutil.which('chromium') or shutil.which('google-chrome')
            browser=pw.chromium.launch(**({'executable_path':executable} if executable else {}),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
            for test in [test_branding,test_tracks,test_playlists,test_overlay]:
                try:test(browser)
                except Exception as error:
                    RESULTS.append({'name':test.__name__+' completion','passed':False,'error':str(error),'trace':traceback.format_exc()})
                    print(traceback.format_exc(),flush=True)
                    for p in browser.contexts:
                        for tab in p.pages:
                            try:tab.screenshot(timeout=12000,path=str(OUT/f'failure-{test.__name__}.png'))
                            except Exception:pass
                finally:
                    for c in browser.contexts:c.close()
            browser.close()
    finally:server.shutdown()
    report={'environment':'Chromium, actual app HTML/CSS/JS, test IPC bridge, local set_content fixture, no native Electron input','passed':sum(r['passed'] for r in RESULTS),'failed':sum(not r['passed'] for r in RESULTS),'checks':RESULTS}
    (OUT/'browser-checks.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(f"RESULT: {report['passed']} passed, {report['failed']} failed",flush=True)
    raise SystemExit(1 if report['failed'] else 0)
