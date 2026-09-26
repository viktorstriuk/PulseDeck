#!/usr/bin/env python3
"""2.8.1: actual app/setup HTML, CSS and JS with isolated IPC fixtures. No Windows runtime claims."""
import importlib.util,json,traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/2.8.1';OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('release',ROOT/'tests/browser-release-280.py');release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
base=release.base;RESULTS=[]
def check(name,condition,detail=None):
 ok=bool(condition);RESULTS.append({'name':name,'passed':ok,**({'detail':detail} if detail is not None else {})});print(('PASS ' if ok else 'FAIL ')+name,flush=True)
 if not ok:raise AssertionError((name,detail))
def shot(p,name):
 p.wait_for_timeout(350);p.screenshot(path=str(OUT/(name+'.png')),omit_background=True)
def no_overflow(p,sel):return p.locator(sel).evaluate('n=>n.scrollWidth<=n.clientWidth+1')
def fit(p,sel):
 r=p.locator(sel).bounding_box();v=p.viewport_size
 return r and r['x']>=0 and r['y']>=0 and r['x']+r['width']<=v['width']+1 and r['y']+r['height']<=v['height']+1

def suite(browser):
 for size,lang,theme in [((1440,1000),'ru','nord'),((800,760),'en','dark'),((1000,760),'ru','light')]:
  p=base.page_for(browser,size=size,stored={'pd-test-settings':json.dumps({'theme':theme,'language':lang,'view':'grid','sort':'recent','playerOverlay':{'mode':'off','visualizer':False},'gameOverlay':{'mode':'off'}})})
  p.click('#settingsBtn');p.click('#settingsAbout');p.wait_for_timeout(150);label=f'About {size[0]} {lang}'
  check(label+' exact model and separate pink Pro',p.locator('#authorExecution').inner_text().find('GPT-6 Astra Pro reasoning')>=0 and p.locator('.author-model-pro').evaluate("n=>getComputedStyle(n).color==='rgb(209, 71, 200)'"))
  check(label+' website chat clause is bold',p.locator('#authorExecution strong').evaluate('n=>+getComputedStyle(n).fontWeight>=600') and 'Codex' in p.locator('#authorExecution strong').inner_text())
  check(label+' no glow on author art',p.locator('.author-art').evaluate("n=>getComputedStyle(n).backgroundImage==='none'") and p.locator('.author-art img').evaluate("n=>getComputedStyle(n).filter==='none'"))
  image=p.locator('.author-art img');rect=image.bounding_box();image.hover();p.wait_for_timeout(400)
  check(label+' hover image is static',rect==image.bounding_box() and image.evaluate("n=>getComputedStyle(n).transform==='none'"))
  check(label+' compact card without horizontal scrolling',p.locator('.about-author').bounding_box()['height']<270 and no_overflow(p,'#aboutPanel'))
  check(label+' all five social links remain reachable',p.locator('.author-social').count()==5 and all(fit(p,'[data-social='+x+']') for x in ['github','youtube','telegram','twitch','tiktok']))
  shot(p,f'281-about-{size[0]}-{lang}-{theme}')
  p.locator('[data-credit-group=icons] summary').click();p.locator('[data-credit-group=icons]').scroll_into_view_if_needed()
  check(label+' no terminal stops in credit descriptions',p.locator('[data-credit-group=icons] .credit-resource-description').evaluate_all("ns=>ns.length===3&&ns.every(n=>!/[.\\u2026]$/.test(n.textContent.trim())&&!n.textContent.includes('—'))"))
  if lang=='ru':
   check(label+' exact SVG Repo sentence',release.catalogs['ru']['CreditsSVGRepoDescription'] in p.locator('[data-credit-group=icons]').inner_text())
   check(label+' social networks terminology', 'Иконки соц.сетей' in p.locator('[data-credit-group=icons]').inner_text());shot(p,f'281-credits-{size[0]}-ru')
  check(label+' no page errors',not p._errors,p._errors);p.close()
 # Live language switch also rebuilds rich inline slots without markup injection.
 p=base.page_for(browser);p.click('#settingsBtn');p.click('#settingsAbout');p.evaluate("pulse.i18n.setLanguage('en')");p.wait_for_timeout(100)
 check('About language switch updates rich credit',p.locator('#authorExecution').inner_text().startswith('Implementation') and p.locator('#authorExecution .author-model-pro').count()==1)
 p.evaluate("()=>{PulseI18n.catalogs.en.messages.AboutExecutionContext='<img src=x onerror=alert(1)>';document.dispatchEvent(new CustomEvent('pulsedeck:language-changed'))}")
 p.wait_for_timeout(100)
 check('About rich translation never creates HTML from catalog',p.locator('#authorExecution img').count()==0 and '<img' in p.locator('#authorExecution strong').inner_text())
 p.close()
 for size,lang,theme,existing in [((1020,742),'ru','dark',True),((1020,742),'en','light',False),((800,600),'ru','light',True),((800,600),'en','dark',False)]:
  p=release.installer_page(browser,size,lang,theme=theme,existing=existing);label=f'Setup {size[0]} {lang} {theme}'
  check(label+' no kicker above headline',p.locator('[data-i18n=SetupKicker]').count()==0)
  check(label+' system skin resolves correctly',p.locator('html').evaluate('n=>getComputedStyle(n).colorScheme')==theme)
  check(label+' heading correct and not clipped',p.locator('h1').inner_text()==release.catalogs[lang]['SetupHeadline'] and no_overflow(p,'.identity-pane'))
  check(label+' version matches package',p.locator('#version').inner_text()==base.VERSION)
  check(label+' selected language has loaded catalog flag',p.locator('#languageFlag img').evaluate('n=>n.complete&&n.naturalWidth>0'))
  check(label+' uses supplied no-account SVG',p.locator('.user-off-icon').evaluate("n=>getComputedStyle(n).maskImage.includes('/assets/ui/user-off.svg')"))
  check(label+' no-account and other features fit',no_overflow(p,'.feature-stack') if p.locator('.feature-stack').count() else no_overflow(p,'.identity-pane'))
  check(label+' close, minimize, install all fit',all(fit(p,s) for s in ['#close','#minimize','#install','#languageTrigger']))
  check(label+' no horizontal shell overflow',no_overflow(p,'.setup-shell'))
  shot(p,f'281-installer-{size[0]}-{lang}-{theme}')
  p.click('#languageTrigger');check(label+' dropdown opens and current option selected',p.locator('#languageList').is_visible() and p.locator('#languageTrigger').get_attribute('aria-expanded')=='true' and p.locator('[data-language='+lang+']').get_attribute('aria-selected')=='true')
  check(label+' language popup fits visible window',fit(p,'#languageList'))
  shot(p,f'281-language-menu-{size[0]}-{lang}-{theme}')
  other='ru' if lang=='en' else 'en';p.click('[data-language='+other+']');p.wait_for_timeout(80)
  check(label+' language commits without reopening window',p.locator('#languageCode').inner_text()==other.upper() and p.locator('h1').inner_text()==release.catalogs[other]['SetupHeadline'])
  check(label+' keeps custom path when changing language', 'Tester' in p.locator('#targetPath').input_value())
  p.click('#browse');p.wait_for_timeout(100);check(label+' custom folder dialog fully fits',fit(p,'#folderDialog') and no_overflow(p,'#folderDialog'));shot(p,f'281-folder-{size[0]}-{lang}-{theme}');p.click('#folderCancel')
  p.click('#install');check(label+' selected language reaches install command',p.evaluate('__setup.events.at(-1).language')==other)
  check(label+' language locked only during installation',p.locator('#languageTrigger').is_disabled())
  p.evaluate("__setup.cb({phase:'installing',percent:57,done:21,total:37})");check(label+' accessible progress still works',p.locator('#setupProgress').get_attribute('aria-valuenow')=='57');shot(p,f'281-progress-{size[0]}-{lang}-{theme}')
  p.evaluate("__setup.cb({phase:'done'});__setup.finish({ok:true})");p.wait_for_timeout(50)
  check(label+' success retains language and enables launch',p.locator('#languageCode').inner_text()==other.upper() and p.locator('#launch').is_visible() and not p.locator('#languageTrigger').is_disabled())
  check(label+' all interactions without page errors',not p._errors,p._errors);p.close()
 # Keyboard behavior: arrows explore, Escape cancels, Enter/Tab commit.
 p=release.installer_page(browser,language='ru',theme='dark');p.focus('#languageTrigger');p.keyboard.press('ArrowDown');p.keyboard.press('Home')
 check('Language keyboard does not commit on arrows',p.locator('#languageCode').inner_text()=='RU' and p.locator('#languageTrigger').get_attribute('aria-activedescendant')==p.locator('[data-language=en]').get_attribute('id'))
 p.keyboard.press('Escape');check('Language Escape cancels while keeping focus',p.locator('#languageCode').inner_text()=='RU' and p.locator('#languageTrigger').evaluate('n=>n===document.activeElement') and not p.locator('#languageList').is_visible())
 p.keyboard.press('Enter');p.keyboard.press('Home');p.keyboard.press('Enter');check('Language Enter commits English',p.locator('#languageCode').inner_text()=='EN')
 p.keyboard.press('Space');p.keyboard.press('End');p.keyboard.press('Tab');check('Language Tab commits then leaves focus',p.locator('#languageCode').inner_text()=='RU' and not p.locator('#languageTrigger').evaluate('n=>n===document.activeElement'))
 p.focus('#languageTrigger');p.keyboard.press('e');p.keyboard.press('Enter');check('Language typeahead finds English',p.locator('#languageCode').inner_text()=='EN')
 p.click('#languageTrigger');p.click('h1');check('Language outside click dismisses',not p.locator('#languageList').is_visible())
 p.emulate_media(color_scheme='light');check('Installer live system theme change preserves choice',p.locator('html').evaluate('n=>getComputedStyle(n).colorScheme')=='light' and p.locator('#languageCode').inner_text()=='EN');p.close()
 # Future catalogs, missing flags, fallback and label escaping use the same UI.
 languages=[{'code':'en','name':'English','locale':'en-GB','iconUrl':base.BASE+'/app/languages/icons/en.svg'},{'code':'de','name':'Deutsch','locale':'de-DE','iconUrl':base.BASE+'/missing.svg'},{'code':'ru','name':'Русский','locale':'ru-RU','iconUrl':base.BASE+'/app/languages/icons/ru.svg'}]+[{'code':'q'+str(i),'name':'Language '+str(i)+' <img src=x>','locale':'en-US'} for i in range(15)]
 p=release.installer_page(browser,language='',preferred=['de-DE','ru-RU'],languages=languages,extra_catalogs={'de':{'SetupHeadline':'Deine lokale Musikwelle'}},theme='light')
 check('Installer supports new JSON language without a hardcoded RU/EN switch',p.locator('#languageCode').inner_text()=='DE' and p.locator('h1').inner_text()=='Deine lokale Musikwelle')
 check('Partial new language falls back to English',p.locator('#install span').first.inner_text()=='Install PulseDeck')
 check('Broken flag degrades without blocking language',p.locator('#languageFlag').get_attribute('class').find('missing-flag')>=0)
 p.click('#languageTrigger');p.keyboard.press('End');check('Long language list scrolls active option into view',p.locator('#languageList').evaluate('n=>n.scrollHeight>n.clientHeight && n.scrollTop>0'))
 check('Catalog names never create active markup',p.locator('#languageList img[src=x]').count()==0)
 p.keyboard.press('Escape');shot(p,'281-extra-language-fallback');p.close()
 p=release.installer_page(browser,language='',preferred=['ja-JP'],theme='light');check('Unsupported system language falls back to English',p.locator('#languageCode').inner_text()=='EN');p.close()
 p=release.installer_page(browser,mode='uninstall',language='ru',theme='light');check('Uninstall supports same language picker and system skin',p.locator('#browse').is_hidden() and p.locator('#languageTrigger').is_enabled());shot(p,'281-uninstall-light');p.close()

if __name__=='__main__':
 failure=None
 try:
  with sync_playwright() as pw:
   b=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);suite(b);b.close()
 except Exception as e:failure=str(e);traceback.print_exc()
 finally:
  (OUT/'browser-copy-281.json').write_text(json.dumps({'checks':RESULTS,'failure':failure},ensure_ascii=False,indent=2));base.server.shutdown()
 if failure:raise SystemExit(1)
