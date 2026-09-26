#!/usr/bin/env python3
"""2.6.3 regression scenarios: real DOM and mouse gestures, test-only IPC bridge."""
import importlib.util,json,traceback,os,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('base',ROOT/'tests/browser-regression.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
check=r.check;pause=r.pause;page_for=r.page_for;OUT=r.OUT

def ctrl(p,*ids):
    for ident in ids:p.locator(f'#library [data-id="{ident}"][data-track-root]').click(position={'x':45,'y':30},modifiers=['Control'])
    pause(p,60)
def menu(p):
    p.locator('#trackSelectionActions').click();pause(p,80)
def selected(p):return p.locator('#library .track-selected').evaluate_all('(ns)=>ns.map(n=>n.dataset.id)')
def dismiss(p):p.keyboard.press('Escape');pause(p,80)

def test_area_bulk(browser):
    p=page_for(browser);before=r.order(p)
    a=p.locator('[data-track-root]').nth(0).bounding_box();b=p.locator('[data-track-root]').nth(1).bounding_box()
    p.mouse.move(a['x']-5,a['y']+4);p.mouse.down();p.mouse.move(b['x']+b['width']-5,b['y']+b['height']-5,steps=12)
    check('Выделение от свободного места подсвечивает две карточки',set(selected(p))=={'t0','t1'},selected(p))
    check('Во время выделения нет прямоугольника или drag-копии',p.locator('.track-drag-ghost,.selection-rect,.selection-marquee').count()==0)
    p.mouse.up();pause(p)
    check('Меню группы открывается автоматически после отпускания',p.locator('#contextMenu').get_attribute('data-menu-kind')=='tracks' and p.locator('#contextMenu').is_visible())
    check('Выделение не меняет порядок и не запускает воспроизведение',r.order(p)==before and not p.evaluate('__mock.overlayState.playing'))
    check('У группового меню есть Удалить все и нет Показать в папке',p.locator('[data-bulk-action="delete"]').inner_text()=='Удалить все' and p.locator('#contextMenu [data-menu="reveal"]').count()==0)
    check('Без источников команда отключена',p.locator('[data-bulk-action="sources"]').is_disabled())
    check('Один обычный артист не предлагает ни объединение ни разделение',p.locator('[data-submenu-trigger="bulk-alias"],[data-bulk-action="split"]').count()==0)
    p.screenshot(path=str(OUT/'10-selection-cards.png'))
    p.locator('[data-bulk-action="favorite"]').click();pause(p)
    check('Избранное получает все выбранные треки одним действием',set(p.evaluate('__mock.settings.favorites'))=={'old artist/song-0.wav','old artist/song-1.wav'})
    menu(p);check('Уже избранные треки предлагают явное групповое удаление',p.locator('[data-bulk-action="unfavorite"]').is_enabled())
    p.locator('[data-submenu-trigger="bulk-add"]').click();pause(p)
    check('Меню группы содержит все 96 плейлистов без усечения',p.locator('[data-bulk-add]').count()==96)
    p.locator('[data-bulk-add="custom:1"]').click();pause(p)
    check('В плейлист добавляются оба трека',len(p.evaluate('__mock.settings.customCategories.find(c=>c.id==="custom:1").tracks'))==2)
    menu(p);p.locator('[data-submenu-trigger="bulk-add"]').click();pause(p)
    check('Повторное добавление всех треков отключено',p.locator('[data-bulk-add="custom:1"]').is_disabled())
    p.locator('[data-bulk-action="new-playlist"]').click();p.locator('#categoryNameInput').fill('Из выделенного');p.locator('#categoryStyleSave').click();pause(p)
    check('Новый плейлист сразу получает выбранную группу',p.evaluate('__mock.settings.customCategories.at(-1).name==="Из выделенного"&&__mock.settings.customCategories.at(-1).tracks.length===2'))
    check('При переходе в новый плейлист прежнее выделение снято',selected(p)==[])
    check('Групповые действия: нет ошибок JavaScript',not p._errors,p._errors);p.close()

def test_hold_modifiers_list(browser):
    p=page_for(browser);before=r.order(p)
    a=p.locator('[data-track-root]').nth(0).bounding_box();b=p.locator('[data-track-root]').nth(2).bounding_box()
    p.mouse.move(a['x']+110,a['y']+40);p.mouse.down();pause(p,410)
    check('Удержание трека запускает выделение, не перестановку',p.locator('body.track-selecting').count()==1 and p.locator('.track-drag-ghost').count()==0)
    p.mouse.move(b['x']+100,b['y']+40,steps=8);p.mouse.up();pause(p)
    check('Проведение по карточкам собирает три трека',len(selected(p))==3 and r.order(p)==before,selected(p))
    dismiss(p);check('Escape убирает выделение и групповое меню',not selected(p) and not p.locator('#contextMenu').is_visible())
    ctrl(p,'t0','t6');check('Ctrl+клик выбирает несоседние треки без воспроизведения',set(selected(p))=={'t0','t6'} and not p.evaluate('__mock.overlayState.playing'))
    p.locator('#listViewBtn').click();pause(p)
    check('Кнопка списка срабатывает сразу после Ctrl+выделения',p.locator('#library.list-view').count()==1 and p.evaluate('__mock.settings.view==="list"'))
    check('Выделение сохраняется при смене карточек на список',set(selected(p))=={'t0','t6'})
    menu(p);check('Разные артисты дают подменю Считать артистов за',p.locator('[data-submenu-trigger="bulk-alias"]').count()==1)
    p.mouse.move(30,155);pause(p,150)
    p.screenshot(path=str(OUT/'11-selection-list.png'))
    dismiss(p)
    # Range extension is on a track cell, never a nested transport button.
    p.locator('#library [data-id="t1"][data-track-root]').click(position={'x':185,'y':25},modifiers=['Control'])
    p.locator('#library [data-id="t4"][data-track-root]').click(position={'x':185,'y':25},modifiers=['Shift']);pause(p)
    check('Shift+клик выделяет диапазон в списке',set(selected(p))=={'t1','t2','t3','t4'},selected(p))
    dismiss(p)
    a=p.locator('[data-track-root]').nth(0).bounding_box();b=p.locator('[data-track-root]').nth(3).bounding_box()
    p.mouse.move(a['x']+185,a['y']+25);p.mouse.down();pause(p,400);p.mouse.move(b['x']+185,b['y']+25,steps=12);p.mouse.up();pause(p,100)
    check('Удержание и проведение вниз выделяет строки настоящего списка',p.locator('#library.list-view').count()==1 and set(selected(p))=={'t0','t1','t2','t3'} and p.locator('#contextMenu').is_visible(),selected(p))
    p.screenshot(path=str(OUT/'11-selection-list.png'))
    dismiss(p)
    p.locator('#searchInput').fill('01 —');pause(p)
    check('Смена поиска снимает старое выделение',selected(p)==[])
    p.locator('#searchInput').press('Tab');p.keyboard.press('Control+a');pause(p)
    check('Ctrl+A выделяет только видимые результаты поиска',selected(p)==['t0'],selected(p))
    p.locator('#searchInput').click();p.keyboard.press('Control+a');pause(p)
    check('Ctrl+A внутри поиска остаётся текстовым выделением',p.locator('#searchInput').evaluate('e=>e.selectionStart===0&&e.selectionEnd===e.value.length'))
    check('Удержание/клавиши: нет ошибок JavaScript',not p._errors,p._errors);p.close()

def test_alias_split_sources(browser):
    p=page_for(browser)
    p.evaluate("__mock.tracks[0].sourceUrl='https://example.com/music';__mock.tracks[6].sourceUrl='https://example.com/music';__mock.emit('library:changed')");pause(p)
    ctrl(p,'t0','t6');menu(p);p.locator('[data-bulk-action="sources"]').click();pause(p)
    check('Одинаковые источники открываются один раз',p.evaluate('__mock.calls.filter(c=>c.name==="openExternal"&&c.value==="https://example.com/music").length===1'))
    menu(p);p.locator('[data-submenu-trigger="bulk-alias"]').click();pause(p);p.locator('[data-bulk-alias="artist:morgenstern"]').click();pause(p)
    check('Объединение группы явно предупреждает о всех текущих и будущих треках','все текущие и будущие' in p.locator('#confirmText').inner_text() and 'не только выделенные' in p.locator('#confirmText').inner_text())
    p.locator('#confirmCancel').click();pause(p)
    check('Отмена не сохраняет правила артистов',p.evaluate('Object.keys(__mock.settings.artistAliases).length===0'))
    menu(p);p.locator('[data-submenu-trigger="bulk-alias"]').click();pause(p);p.locator('[data-bulk-alias="artist:morgenstern"]').click();p.locator('#confirmDelete').click();pause(p)
    check('Правило группы объединяет все 12 треков двух артистов',p.evaluate('__mock.settings.artistAliases.slipknot==="morgenstern"') and p.locator('[data-track-root]').count()==12)
    check('Отдельный исходный плейлист исчезает',p.locator('#categoryChips [data-category="artist:slipknot"]').count()==0)
    ctrl(p,'t0','t6');menu(p)
    check('Для уже объединённых разных артистов есть только Разделить',p.locator('[data-bulk-action="split"]').count()==1 and p.locator('[data-submenu-trigger="bulk-alias"]').count()==0)
    p.locator('[data-bulk-action="split"]').click();pause(p)
    check('Разделение предупреждает, что затронет не только выделенные','не только для выделенных' in p.locator('#confirmText').inner_text())
    p.screenshot(path=str(OUT/'12-split-confirmation.png'));p.locator('#confirmDelete').click();pause(p)
    check('Разделение возвращает два артистических плейлиста без дублирования',p.locator('#categoryChips [data-category^="artist:"]').count()==2 and p.locator('[data-track-root]').count()==6)
    # Recreate a single rule through the existing playlist menu, not by mutating renderer state.
    p.locator('#categoryChips [data-category="artist:slipknot"]').click(button='right');pause(p)
    check('У самостоятельного артиста нет команды разделения',p.locator('[data-category-command="split"]').count()==0)
    p.locator('[data-submenu-trigger="alias"]').click();pause(p);p.locator('[data-alias-target="artist:morgenstern"]').click();p.locator('#confirmDelete').click();pause(p)
    p.locator('[data-category-layout="side"]').click();pause(p)
    p.locator('#categorySidebar [data-category="artist:morgenstern"]').click(button='right');pause(p)
    check('Разделение есть в редактировании объединённого плейлиста сбоку',p.locator('[data-category-command="split"]').count()==1)
    p.screenshot(path=str(OUT/'13-playlist-split-menu.png'))
    p.locator('[data-category-command="split"]').click();p.locator('#confirmDelete').click();pause(p)
    check('Разделение из меню плейлиста действительно отменяет правило',p.evaluate('Object.keys(__mock.settings.artistAliases).length===0') and p.locator('#categorySidebar [data-category="artist:slipknot"]').count()==1)
    stored=p.evaluate('window.__storage');p.close();p=page_for(browser,stored=stored)
    check('Разделение сохраняется после перезапуска',p.evaluate('Object.keys(__mock.settings.artistAliases).length===0') and p.locator('#categorySidebar [data-category^="artist:"]').count()==2)
    check('Артисты: нет ошибок JavaScript',not p._errors,p._errors);p.close()

def test_delete_cancel_failure(browser):
    p=page_for(browser);ctrl(p,'t0','t1');menu(p);p.locator('[data-bulk-action="delete"]').click();pause(p)
    check('Удаление группы требует подтверждения с точным количеством','(2)' in p.locator('#confirmTitle').inner_text() and 'корзину Windows' in p.locator('#confirmText').inner_text())
    p.locator('#confirmCancel').click();pause(p)
    check('Отмена удаления не вызывает файловую операцию',p.evaluate('__mock.calls.every(c=>c.name!=="removeMany")') and len(r.order(p))==12)
    p.evaluate("__mock.failRemoval=[__mock.tracks[1].rel]");menu(p);p.locator('[data-bulk-action="delete"]').click();p.locator('#confirmDelete').click();pause(p,300)
    check('Частичная ошибка не удаляет остальные треки',len(r.order(p))==11 and 't0' not in r.order(p) and 't1' in r.order(p))
    check('Неудалённый трек остаётся выделенным для повтора',selected(p)==['t1'],selected(p))
    check('Ошибка удаления видна пользователю','Не удалось: 1' in p.locator('#toastStack').inner_text())
    p.evaluate('__mock.failRemoval=[]');menu(p);p.locator('[data-bulk-action="delete"]').click();p.locator('#confirmDelete').click();pause(p)
    check('Повторное удаление работает только с оставшимся треком',len(r.order(p))==10 and not selected(p))
    check('Удаление группы: нет ошибок JavaScript',not p._errors,p._errors);p.close()

def test_autoscroll_refresh(browser):
    p=page_for(browser)
    p.evaluate("__mock.tracks.push(...Array.from({length:120},(_,i)=>({...__mock.tracks[0],id:'extra'+i,rel:'extra'+i+'.wav',title:'Extra '+i,addedAt:1000-i})));__mock.emit('library:changed')");pause(p)
    a=p.locator('#library [data-track-root]').first.bounding_box();c=p.locator('.content').bounding_box()
    p.mouse.move(a['x']+45,a['y']+40);p.mouse.down();pause(p,380)
    p.mouse.move(a['x']+45,c['y']+c['height']-6,steps=8);pause(p,650)
    check('Выделение автопрокручивает длинную библиотеку',p.locator('.content').evaluate('e=>e.scrollTop>50'))
    old_count=p.locator('[data-track-root]').count()
    p.evaluate("__heldSelection=document.querySelector('#library [data-track-root]');__mock.tracks.push({...__mock.tracks[0],id:'during',rel:'during.wav'});__mock.emit('library:changed')");pause(p,180)
    check('Обновление библиотеки не обрывает активное выделение',p.locator('body.track-selecting').count()==1 and p.locator('[data-track-root]').count()==old_count and p.evaluate('__heldSelection===document.querySelector("#library [data-track-root]")'))
    p.mouse.up();pause(p,350)
    check('После жеста отложенный новый трек появляется',p.locator('[data-track-root]').count()==old_count+1 and p.locator('#contextMenu').is_visible())
    check('Выделение с прокруткой: нет ошибок JavaScript',not p._errors,p._errors);p.close()

def test_sidebar_no_drift(browser):
    p=page_for(browser);p.locator('[data-category-layout="side"]').click();pause(p)
    p.locator('#categorySidebar [data-category="favorite"]').click(button='right');pause(p);p.locator('[data-category-command="move"]').click();pause(p)
    a=p.locator('#categorySidebar [data-category="favorite"]').bounding_box()
    p.mouse.move(a['x']+a['width']/2,a['y']+a['height']/2);p.mouse.down();pause(p,290)
    samples=[]
    for step in range(90):
        p.mouse.move(a['x']+a['width']/2+(step%7-3)*7,a['y']+a['height']/2+min(step*2,115))
        samples.append(p.evaluate('()=>{let e=document.querySelector("#categorySidebar .dragging-category"),g=document.querySelector(".playlist-drag-ghost");return {x:e.getBoundingClientRect().x,gx:g.getBoundingClientRect().x,gy:g.getBoundingClientRect().y,top:e.parentElement.getBoundingClientRect().top}}'))
    check('Боковой плейлист не накапливает горизонтальный дрейф при 90 движениях',max(s['x'] for s in samples)-min(s['x'] for s in samples)<.1)
    check('Drag-копия привязана к колонке даже при движении мыши вправо-влево',max(s['gx'] for s in samples)-min(s['gx'] for s in samples)<.1)
    check('Drag-копия не выезжает вверх из боковой панели',all(s['gy']>=s['top'] for s in samples))
    p.screenshot(path=str(OUT/'14-sidebar-drag-fixed.png'));p.mouse.up();pause(p)
    check('После завершения нет оставшейся копии',p.locator('.playlist-drag-ghost').count()==0)
    check('Боковой drag: нет ошибок JavaScript',not p._errors,p._errors);p.close()

def test_preview_border_resize(browser):
    p=page_for(browser,'overlay',(480,150))
    check('При включённых сквозных кликах ни один resize handle не принимает мышь',p.locator('[data-resize]').evaluate_all('ns=>ns.every(n=>getComputedStyle(n).display==="none"&&getComputedStyle(n).pointerEvents==="none")'))
    check('Resize-области не отправляются основному процессу',p.evaluate('__overlay.regions.every(r=>r.kind!=="resize")'))
    p.mouse.move(8,75);p.mouse.down();p.mouse.move(25,90);p.mouse.up();pause(p)
    check('Попытка потянуть край в сквозном режиме не отправляет resizeBegin',p.evaluate('__overlay.calls.every(c=>c.name!=="resizeBegin")'))
    p.evaluate("__overlay.emit('config',{borderVisible:false,backgroundVisible:false});__overlay.emit('preview',true)");pause(p)
    check('Настройка без рамки получает пунктирную границу',p.locator('#card').evaluate('e=>getComputedStyle(e).borderTopStyle==="dashed"&&getComputedStyle(e).borderTopColor!=="rgba(0, 0, 0, 0)"'))
    check('Подсказка не обещает растягивание при сквозных кликах','сквозные клики включены' in p.locator('#previewBadge').inner_text())
    check('Пунктир не включает геометрию при ручном сквозном режиме',p.evaluate('__overlay.regions.every(r=>r.kind!=="resize")'))
    check('Бейдж настройки не становится обходной drag-зоной',p.locator('#previewBadge').evaluate('e=>getComputedStyle(e).getPropertyValue("-webkit-app-region")==="no-drag"'))
    p.screenshot(path=str(OUT/'15-player-dashed-preview.png'))
    p.evaluate("__overlay.emit('preview',false)");pause(p)
    check('После выхода из настроек пунктир исчезает',p.locator('#card').evaluate('e=>getComputedStyle(e).borderTopColor==="rgba(0, 0, 0, 0)"'))
    p.evaluate("__overlay.emit('config',{borderVisible:true});__overlay.emit('preview',true)");pause(p)
    check('Включённая настоящая рамка остаётся сплошной',p.locator('#card').evaluate('e=>getComputedStyle(e).borderTopStyle==="solid"'))
    p.locator('#clickThroughToggle').click();pause(p)
    check('Выключение сквозного режима возвращает восемь resize-областей',p.evaluate('__overlay.regions.filter(r=>r.kind==="resize").length===8'))
    p.locator('#clickThroughToggle').click();pause(p);p.locator('#playButton').click();pause(p)
    check('Повторное включение не блокирует play/pause',p.evaluate('__overlay.calls.filter(c=>c.name==="control").at(-1).value.action==="playPause"'))
    check('Границы плеера: нет ошибок JavaScript',not p._errors,p._errors);p.close()

if __name__=='__main__':
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
            for fn in [test_area_bulk,test_hold_modifiers_list,test_alias_split_sources,test_delete_cancel_failure,test_autoscroll_refresh,test_sidebar_no_drift,test_preview_border_resize]:
                try:fn(browser)
                except Exception as e:
                    r.RESULTS.append({'name':fn.__name__+' completion','passed':False,'error':str(e),'trace':traceback.format_exc()});print(traceback.format_exc(),flush=True)
                    for c in browser.contexts:
                        for p in c.pages:
                            try:p.screenshot(path=str(OUT/f'failure-{fn.__name__}.png'),timeout=10000)
                            except Exception:pass
                finally:
                    for c in browser.contexts:c.close()
            browser.close()
    finally:r.server.shutdown()
    result={'environment':'Chromium real DOM/gestures, test Electron IPC bridge; no native Windows execution','passed':sum(x['passed'] for x in r.RESULTS),'failed':sum(not x['passed'] for x in r.RESULTS),'checks':r.RESULTS}
    (OUT/'features-263-checks.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(f"RESULT: {result['passed']} passed, {result['failed']} failed",flush=True)
    raise SystemExit(bool(result['failed']))
