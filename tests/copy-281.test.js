'use strict';
const test=require('node:test'),A=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{createRequire}=require('node:module');
const {choose}=require('../app/shared/language-choice'),{upgradeStockOverrides,digest}=require('../app/i18n/stock-upgrade'),{CatalogService}=require('../app/i18n');
const root=path.resolve(__dirname,'..'),packs=Object.fromEntries(['ru','en'].map(c=>[c,JSON.parse(fs.readFileSync(path.join(root,'app/languages/'+c+'.json'),'utf8'))]));
const langs=[{code:'en',locale:'en-GB'},{code:'ru',locale:'ru-RU'},{code:'pt-BR',locale:'pt-BR'}];
for(const [preferred,explicit,want]of [[['ru-RU'],'','ru'],[['en-US'],'','en'],[['de-DE','ru-RU','en'],'','ru'],[['zh-Hant'],'','en'],[['ru'],'en','en'],[['ru'],'../../file','ru'],[['RU_ru'],'','ru'],[['pt-PT'],'','pt-BR'],[[],'','en']])test(`281 language preference ${JSON.stringify(preferred)} explicit ${explicit}`,()=>A.equal(choose(langs,preferred,explicit),want));
test('281 language matching is pure and supports an all-new language list',()=>{const l=[{code:'fr',locale:'fr-FR'}],before=JSON.stringify(l);A.equal(choose(l,['de-DE']),'fr');A.equal(choose(null,null),'en');A.equal(JSON.stringify(l),before);});
for(const code of ['ru','en'])test('281 '+code+' catalog punctuation and placeholders',()=>{
 const entries=Object.entries(packs[code].messages);A.ok(entries.length>=1800);for(const [key,value]of entries)for(const text of Object.values(typeof value==='string'?{text:value}:value)){
  A.ok(!text.includes('—'),key);A.ok(text.trim().length,key);
  if(key!=='UIHttpsYoutubeComHttpsSoundcloudCom')A.ok(!/[.\u2026]+(?=[ \t]*(?:\n|\r|$))/.test(text),key);
 }
 A.equal(packs[code].messages.AboutExecutionModel,'GPT-6 Astra {pro} reasoning');
 A.equal(packs[code].messages.AboutExecutionPro,'Pro');
});
test('281 exact requested author and credits text, no markup in catalog',()=>{
 const m=packs.ru.messages;A.equal(m.CreditsSVGRepoDescription,'Иконки в редакторе плейлистов, указатели и исходные формы знака PulseDeck были сделаны с иконками отсюда');
 A.ok(m.CreditsFontAwesomeDescription.startsWith('Иконки соц.сетей'));
 A.equal(m.AboutAuthorDescription,'Идеи для функций, направление проекта и фирменный знак PulseDeck, ну и частичка души конечно же :)');
 A.equal(m.SetupHeadline,'Твоя локальная музыкальная волна');A.ok(!/[<>]/.test(m.AboutExecution));
});
function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pd281-copy-'));const languages=path.join(dir,'languages');fs.mkdirSync(languages);try{fn({dir,languages,write:(code,object)=>fs.writeFileSync(path.join(languages,code+'.json'),JSON.stringify(object))});}finally{fs.rmSync(dir,{recursive:true,force:true});}}
const oldRU={meta:{code:'ru',name:'Русский',locale:'ru-RU',icon:'ru.svg'},messages:{CreditsSubtitle:'Проекты и ресурсы, которые помогают PulseDeck звучать и выглядеть лучше.',AboutAuthorDescription:'Идея, направление проекта и фирменный знак PulseDeck. Музыка объединяет — оставайся на связи.',UserExtra:'Пользовательская строка — без изменений.',SetupNoAccount:'Без аккаунта'}};
test('281 known stock fingerprints use canonical values',()=>{const known=require('../app/i18n/migrations/281-stock.json');for(const key of ['CreditsSubtitle','AboutAuthorDescription'])A.ok(known.catalogs.ru[key].includes(digest(oldRU.messages[key])));A.equal(digest({b:'B',a:'A'}),digest({a:'A',b:'B'}));});
test('281 upgrade makes new copy visible while retaining real user edits and extra keys',()=>fixture(f=>{
 const old=structuredClone(oldRU);old.messages.SetupNoAccount='Собственная подпись.';old.meta.name='Мой русский';f.write('ru',old);const bytes=fs.readFileSync(path.join(f.languages,'ru.json'));
 const r=upgradeStockOverrides(f.languages);A.deepEqual(r.errors,[]);A.equal(r.updated.length,1);A.ok(fs.readFileSync(r.updated[0].backup).equals(bytes));
 const service=new CatalogService(path.join(root,'app/languages'),'ru');service.setOverrideDirectory(f.languages);
 A.equal(service.t('CreditsSubtitle'),packs.ru.messages.CreditsSubtitle);A.equal(service.t('AboutAuthorDescription'),packs.ru.messages.AboutAuthorDescription);
 A.equal(service.t('SetupNoAccount'),'Собственная подпись.');A.equal(service.t('UserExtra'),old.messages.UserExtra);A.equal(service.languages.find(l=>l.code==='ru').name,'Мой русский');service.close();
}));
test('281 later deliberate use of old wording is not overwritten by repeated migration',()=>fixture(f=>{f.write('ru',oldRU);upgradeStockOverrides(f.languages);f.write('ru',oldRU);A.equal(upgradeStockOverrides(f.languages).updated.length,0);A.equal(JSON.parse(fs.readFileSync(path.join(f.languages,'ru.json'))).messages.CreditsSubtitle,oldRU.messages.CreditsSubtitle);}));
test('281 unknown language file remains byte-identical',()=>fixture(f=>{f.write('de',{meta:{name:'Deutsch'},messages:{Example:'Beispiel.'}});const before=fs.readFileSync(path.join(f.languages,'de.json'));upgradeStockOverrides(f.languages);A.ok(before.equals(fs.readFileSync(path.join(f.languages,'de.json'))));}));
test('281 corrupt catalog preserved and can be retried after repair',()=>fixture(f=>{const file=path.join(f.languages,'ru.json');fs.writeFileSync(file,'{broken');A.equal(upgradeStockOverrides(f.languages).errors.length,1);A.equal(fs.readFileSync(file,'utf8'),'{broken');f.write('ru',oldRU);A.equal(upgradeStockOverrides(f.languages).updated.length,1);}));
test('281 catalog symlink cannot overwrite external file',()=>fixture(f=>{const file=path.join(f.dir,'external.json');fs.writeFileSync(file,JSON.stringify(oldRU));fs.symlinkSync(file,path.join(f.languages,'ru.json'));const before=fs.readFileSync(file);A.equal(upgradeStockOverrides(f.languages).errors.length,1);A.ok(before.equals(fs.readFileSync(file)));}));
test('281 backup conflict leaves override intact',()=>fixture(f=>{f.write('ru',oldRU);const result=upgradeStockOverrides(f.languages),backup=result.updated[0].backup;fs.unlinkSync(path.join(f.languages,'.stock-copy-2.8.1'));f.write('ru',oldRU);fs.writeFileSync(backup,'corrupt');A.equal(upgradeStockOverrides(f.languages).errors[0].code,'BACKUP_CONFLICT');A.equal(JSON.parse(fs.readFileSync(path.join(f.languages,'ru.json'))).messages.CreditsSubtitle,oldRU.messages.CreditsSubtitle);}));
test('281 no markup or SVG redraw substituted for supplied user-off graphic',()=>{
 const svg=fs.readFileSync(path.join(root,'app/assets/ui/user-off.svg'),'utf8');A.ok(svg.includes('viewBox="0 0 512 512"'));A.ok(!/<script|onload=|<foreignObject/i.test(svg));
 const css=fs.readFileSync(path.join(root,'installer/ui/styles.css'),'utf8');A.ok(css.includes('/assets/ui/user-off.svg'));A.ok(css.includes('(prefers-color-scheme:light)')||css.includes('(prefers-color-scheme: light)'));
});
async function setupMain(preferred=['ru-RU'],args=[]){
 const file=path.join(root,'installer/ui/main.js'),events=[],handlers=new Map(),nativeTheme={},windows=[];
 class W extends EventEmitter{constructor(){super();windows.push(this);this.webContents={mainFrame:{},getURL:()=>require('node:url').pathToFileURL(path.join(root,'installer/ui/index.html')).href,setWindowOpenHandler(){},on(){},send(){},session:{setPermissionRequestHandler(){},setPermissionCheckHandler(){}}};}loadURL(){}isDestroyed(){return false;}show(){}close(){}minimize(){}}
 const app=new EventEmitter();Object.assign(app,{whenReady:()=>Promise.resolve(),getPreferredSystemLanguages:()=>preferred,setPath(){},setAppUserModelId(){},getPath:()=>os.tmpdir(),quit(){}});
 const real=createRequire(file),mockFS=Object.create(fs);mockFS.existsSync=file=>file.endsWith('maintenance.exe')||fs.existsSync(file);
 const spawn=(exe,argv)=>{events.push({exe,argv});const child=new EventEmitter();child.stdout=new EventEmitter();child.stdout.setEncoding=()=>{};child.stderr=new EventEmitter();child.kill=()=>{};process.nextTick(()=>{child.stdout.emit('data',JSON.stringify({phase:'done'})+'\n');child.emit('exit',0);child.emit('close',0);});return child;};
 const ctx=vm.createContext({Buffer,URL,console,process:{...process,argv:['node','setup',...args]},__dirname:path.dirname(file),require:name=>name==='electron'?{app,BrowserWindow:W,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},screen:{getPrimaryDisplay:()=>({workAreaSize:{width:1020,height:742}})},nativeTheme}:name==='node:fs'?mockFS:name==='node:child_process'?{spawn}:real(name)});
 new vm.Script(fs.readFileSync(file,'utf8'),{filename:file}).runInContext(ctx);await new Promise(resolve=>setImmediate(resolve));
 const sender=windows[0].webContents;return {nativeTheme,events,call:(name,...args)=>handlers.get(name)({sender,senderFrame:sender.mainFrame},...args)};
}
test('281 real setup bootstrap discovers metadata and flags and follows preferred UI languages',async()=>{const h=await setupMain(['de-DE','ru-RU']);const cfg=await h.call('setup:bootstrap');A.equal(cfg.language,'ru');A.equal(h.nativeTheme.themeSource,'system');A.equal(cfg.version,require('../app/package.json').version);for(const code of ['ru','en']){const l=cfg.languages.find(l=>l.code===code);A.ok(l.name&&l.iconUrl.startsWith('file:'));}});
test('281 explicit installer language survives bootstrap and reaches Go process',async()=>{const h=await setupMain(['ru-RU'],['--language=en']);A.equal((await h.call('setup:bootstrap')).language,'en');const result=await h.call('setup:execute',{target:os.tmpdir(),desktop:true,language:'ru'});A.ok(result.ok);const a=h.events[0].argv;A.equal(a[a.indexOf('--language')+1],'ru');A.ok(a.includes('--desktop'));});
test('281 invalid IPC language never starts installer engine',async()=>{const h=await setupMain();await A.rejects(h.call('setup:execute',{target:os.tmpdir(),language:'../../run'}),/SetupErrorLanguage/);A.equal(h.events.length,0);});
test('281 supported UI language fallback is English rather than forced Russian',async()=>{const h=await setupMain(['ja-JP']);A.equal((await h.call('setup:bootstrap')).language,'en');});
