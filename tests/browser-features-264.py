#!/usr/bin/env python3
"""264 public interaction regression: real pointer events and real model, simulated IPC."""
import importlib.util,json,traceback,shutil,os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('base',ROOT/'tests/browser-regression.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
check=r.check;pause=r.pause;OUT=r.OUT

def choose(p,*ids):
 for i in ids:p.locator(f'#library [data-track-root][data-id="{i}"]').click(position={'x':180 if 'list-view' in p.locator('#library').get_attribute('class') else 42,'y':32},modifiers=['Control'])
 pause(p,50)
def menu(p):p.locator('#trackSelectionActions').click();pause(p,70)
def playlist(p,key,rail='#categoryChips'):return p.locator(f'{rail} [data-category="{key}"]')
def select_playlists(p,*keys,rail='#categoryChips'):
 for key in keys:playlist(p,key,rail).click(modifiers=['Control'])
 pause(p,60)
def playlist_menu(p):
 p.locator('#categoryChips .playlist-selected:visible,#categorySidebar .playlist-selected:visible').first.click(button='right');pause(p,80)
def drag_to(p,source,target):
 a=p.locator(source).bounding_box();p.mouse.move(a['x']+40,a['y']+a['height']/2);p.mouse.down();p.mouse.move(a['x']+48,a['y']+a['height']/2+10,steps=3);pause(p,30)
 p.locator(target).scroll_into_view_if_needed();b=p.locator(target).bounding_box();p.mouse.move(b['x']+b['width']/2,b['y']+b['height']/2,steps=14);pause(p,120)

def test_track_actions(b):
 p=r.page_for(b)
 p.evaluate("__mock.tracks[2].artist='BUYSELL';__mock.tracks[0].sourceUrl='https://example.test/one';__mock.tracks[1].sourceUrl='https://example.test/two';__mock.tracks[2].sourceUrl='https://example.test/playing';__mock.settings.artistAliases={buysell:'morgenstern'};__mock.settings.favorites=__mock.tracks.slice(0,3).map(t=>t.rel.toLowerCase());__mock.emit('library:changed')");pause(p,200)
 p.locator('[data-track-root][data-id="t2"]').click();pause(p,160);choose(p,'t0','t1');menu(p)
 check('264: playing BUYSELL is not included in two selected Morgenstern tracks',json.loads(p.locator('#contextMenu').get_attribute('data-track-ids'))==['t0','t1'])
 check('264: no false artist split for same original artist',p.locator('[data-bulk-action="split"]').count()==0)
 check('264: bulk unfavorite is enabled and named explicitly',p.locator('[data-bulk-action="unfavorite"]').inner_text()=='Убрать из избранного')
 p.locator('[data-bulk-action="unfavorite"]').click();pause(p)
 check('264: bulk unfavorite leaves playing/outside track favorite',p.evaluate("JSON.stringify(__mock.settings.favorites)===JSON.stringify(['old artist/song-2.wav'])"))
 menu(p);p.locator('[data-bulk-action="sources"]').click();pause(p)
 check('264: open sources uses selected songs only',p.evaluate("JSON.stringify(__mock.calls.filter(c=>c.name==='openExternal').map(c=>c.value))===JSON.stringify(['https://example.test/one','https://example.test/two'])"))
 menu(p);p.locator('[data-submenu-trigger="bulk-add"]').click();p.locator('[data-bulk-add="custom:0"]').click();pause(p)
 playlist(p,'custom:0').click();pause(p);check('264: only chosen tracks were added',len(r.order(p))==2)
 p.locator('[data-track-root]').first.click(button='right');pause(p)
 check('264: single song has remove-current-playlist action', 'Плейлист 001' in p.locator('[data-menu="remove-current"]').inner_text())
 p.locator('[data-menu="remove-current"]').click();pause(p);check('264: single removal preserves library file count',len(r.order(p))==1 and p.evaluate('__mock.tracks.length')==12)
 choose(p,'t1');menu(p);p.locator('[data-bulk-action="remove-current"]').click();pause(p)
 check('264: bulk removal empties playlist, not library',len(r.order(p))==0 and p.evaluate('__mock.tracks.length')==12)
 check('264: selected-only actions have no JS errors',not p._errors,p._errors);p.close()

def test_list_outline(b):
 p=r.page_for(b);p.locator('#listViewBtn').click();pause(p);choose(p,'t0','t1','t2');
 geometry=p.locator('.list-row.track-selected').evaluate_all("ns=>ns.map(n=>({start:n.classList.contains('selection-start'),end:n.classList.contains('selection-end'),shadow:getComputedStyle(n).boxShadow,top:getComputedStyle(n,'::after').borderTopWidth,bottom:getComputedStyle(n,'::after').borderBottomWidth,left:getComputedStyle(n,'::after').borderLeftWidth}))")
 check('264: contiguous selection has exactly one start and one end',sum(g['start'] for g in geometry)==1 and sum(g['end'] for g in geometry)==1)
 check('264: interior selected row has only side edges',geometry[1]['top']=='0px' and geometry[1]['bottom']=='0px' and geometry[1]['left']=='2px')
 check('264: former per-row rectangle removed',all(g['shadow']=='none' for g in geometry))
 p.screenshot(path=str(OUT/'20-selection-single-outline.png'))
 choose(p,'t1');g=p.locator('.list-row.track-selected').evaluate_all("ns=>ns.every(n=>n.classList.contains('selection-start')&&n.classList.contains('selection-end'))")
 check('264: separate selected runs have separate clean outlines',g)
 p.close()

def test_playlist_groups(b):
 p=r.page_for(b);select_playlists(p,'custom:0','custom:1');playlist_menu(p)
 check('264: playlist selection does not switch active category',playlist(p,'all').evaluate("n=>n.classList.contains('active')"))
 check('264: playlist group has hide/delete/merge actions',p.locator('[data-batch-playlist]').count()==3)
 p.screenshot(path=str(OUT/'21-playlist-batch-menu.png'))
 p.locator('[data-batch-playlist="merge"]').click();p.locator('#batchMergeTarget').select_option('custom:1');p.locator('#confirmDelete').click();pause(p,350)
 check('264: selected playlists merge and chosen target survives',p.evaluate("!__mock.settings.customCategories.some(c=>c.id==='custom:0')&&__mock.settings.customCategories.some(c=>c.id==='custom:1')"))
 select_playlists(p,'custom:1','custom:2');playlist_menu(p);p.locator('[data-batch-playlist="hide"]').click();p.locator('#confirmDelete').click();pause(p,250)
 check('264: bulk hide affects only selected playlists',p.evaluate("__mock.settings.customCategories.filter(c=>c.hidden).map(c=>c.id).sort().join()===['custom:1','custom:2'].join()"))
 select_playlists(p,'all','recent');playlist_menu(p)
 check('264: deleting selected system playlists is disabled',p.locator('[data-batch-playlist="delete"]').is_disabled())
 p.keyboard.press('Escape');pause(p,100)
 select_playlists(p,'artist:morgenstern','artist:slipknot');playlist_menu(p)
 check('264: distinct selected artist playlists show bulk alias menu',p.locator('[data-submenu-trigger="batch-artist"]').count()==1)
 p.keyboard.press('Escape');pause(p,100)
 p.locator('[data-category-layout="side"]').click();pause(p)
 # Long-hold paints a sidebar selection; no drift/reorder gesture is claimed.
 a=playlist(p,'all','#categorySidebar').bounding_box();b2=playlist(p,'recent','#categorySidebar').bounding_box()
 p.mouse.move(a['x']+50,a['y']+a['height']/2);p.mouse.down();pause(p,420);p.mouse.move(b2['x']+50,b2['y']+b2['height']/2,steps=9);p.mouse.up();pause(p,130)
 check('264: sidebar hold-sweep selects playlists and opens group menu',p.locator('#contextMenu').get_attribute('data-menu-kind')=='playlists' and p.locator('#categorySidebar .playlist-selected').count()>=3)
 check('264: selection leaves no playlist drag ghost',p.locator('.playlist-drag-ghost').count()==0)
 check('264: grouped playlist UI has no errors',not p._errors,p._errors);p.close()

def test_playlist_delete_alias(b):
 p=r.page_for(b);select_playlists(p,'custom:0','custom:1');playlist_menu(p);p.locator('[data-batch-playlist="delete"]').click();p.locator('#confirmDelete').click();pause(p,300)
 check('264: group delete removes exactly chosen custom playlists',p.evaluate("!__mock.settings.customCategories.some(c=>['custom:0','custom:1'].includes(c.id))&&__mock.settings.customCategories.some(c=>c.id==='custom:2')"))
 check('264: group delete never deletes track files',p.evaluate('__mock.tracks.length')==12)
 select_playlists(p,'artist:morgenstern','artist:slipknot');playlist_menu(p);p.locator('[data-submenu-trigger="batch-artist"]').click();p.locator('[data-batch-alias="artist:morgenstern"]').click();p.locator('#confirmDelete').click();pause(p,300)
 check('264: group artist action saves alias for selected artist playlists',p.evaluate("__mock.settings.artistAliases.slipknot==='morgenstern'"))
 check('264: group artist action leaves custom playlists intact',p.evaluate("__mock.settings.customCategories.some(c=>c.id==='custom:2')"))
 check('264: group delete and alias produce no JS errors',not p._errors,p._errors);p.close()

def test_drag_and_drop(b):
 p=r.page_for(b)
 r.start_cat_drag(p,'#categoryChips',0,2)
 style=p.locator('.playlist-drag-ghost').evaluate("e=>({bg:getComputedStyle(e).backgroundColor,shadow:getComputedStyle(e).boxShadow})")
 check('264: top playlist drag ghost no longer has rectangle/shadow',style=={'bg':'rgba(0, 0, 0, 0)','shadow':'none'},style)
 p.keyboard.press('Escape');p.mouse.up();pause(p)
 p.locator('[data-category-layout="side"]').click();pause(p);r.start_cat_drag(p,'#categorySidebar',0,2)
 check('264: sidebar drag ghost keeps original background',p.locator('.playlist-drag-ghost').evaluate("n=>getComputedStyle(n).backgroundColor!=='rgba(0, 0, 0, 0)'"))
 p.keyboard.press('Escape');p.mouse.up();pause(p);p.locator('[data-category-layout="top"]').click();pause(p)
 # Exit edit mode first.
 p.locator('h1').click();pause(p);before=r.order(p)
 drag_to(p,'[data-track-root][data-id="t0"]','#categoryChips [data-category="custom:0"]')
 check('264: dragging song shows temporary plus, without playlist edit handles',p.locator('#categoryChips [data-track-drop-plus]').count()==1 and not p.locator('#categoryChips').evaluate("e=>e.classList.contains('category-editing')"))
 check('264: target playlist is highlighted during song drag',p.locator('#categoryChips [data-category="custom:0"]').evaluate("e=>e.classList.contains('track-drop-target')"))
 p.mouse.up();pause(p,240)
 check('264: dropping adds single song, keeps library order',p.evaluate("__mock.settings.customCategories.find(c=>c.id==='custom:0').tracks.includes('old artist/song-0.wav')") and r.order(p)==before)
 check('264: temporary plus removed after drop',p.locator('[data-track-drop-plus]').count()==0)
 choose(p,'t0','t1');drag_to(p,'[data-track-root][data-id="t0"]','#categoryChips [data-category="custom:1"]');p.mouse.up();pause(p,250)
 check('264: dragging a selected song adds the selected group only',p.evaluate("__mock.settings.customCategories.find(c=>c.id==='custom:1').tracks.length===2"))
 drag_to(p,'[data-track-root][data-id="t0"]','#categoryChips [data-track-drop-plus]');p.mouse.up();pause(p,150)
 check('264: plus drop opens editor with two-song grammatical heading','2 выбранные песни' in p.locator('#categoryStyleTitle').inner_text())
 p.locator('#categoryNameInput').fill('Из перетаскивания');p.screenshot(path=str(OUT/'22-drop-create-playlist.png'));p.locator('#categoryStyleSave').click();pause(p,300)
 check('264: plus drop creates playlist and adds both songs',p.evaluate("__mock.settings.customCategories.at(-1).name==='Из перетаскивания'&&__mock.settings.customCategories.at(-1).tracks.length===2"))
 check('264: drop UI has no errors',not p._errors,p._errors);p.close()

if __name__=='__main__':
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  for fn in [test_track_actions,test_list_outline,test_playlist_groups,test_playlist_delete_alias,test_drag_and_drop]:
   try:fn(b)
   except Exception as e:
    print(traceback.format_exc(),flush=True);r.RESULTS.append({'name':fn.__name__,'passed':False,'error':str(e)})
    for ctx in b.contexts:
     for p in ctx.pages:
      try:p.screenshot(path=str(OUT/('failure-264-'+fn.__name__+'.png')))
      except:pass
   finally:
    for ctx in b.contexts:ctx.close()
  b.close()
 r.server.shutdown()
 report={'environment':'actual renderer, local Chromium, model-backed test bridge','passed':sum(x['passed'] for x in r.RESULTS),'failed':sum(not x['passed'] for x in r.RESULTS),'checks':r.RESULTS};(OUT/'browser-features-264.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(report['passed'],'passed,',report['failed'],'failed');raise SystemExit(bool(report['failed']))
