'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {Engine, safeLocale} = require('../shared/i18n');
const MAX_FILE = 2 * 1024 * 1024;
const CODE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ICON = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.svg$/i;
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
function loadCatalogs(directory) {
  const catalogs = Object.create(null), languages = [], diagnostics = [];
  let entries = [];
  try { entries = fs.readdirSync(directory, {withFileTypes:true}); } catch (error) { diagnostics.push({key:'LanguageDirectoryUnavailable',params:{detail:error.code || ''}}); }
  for (const entry of entries.sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const code = entry.name.slice(0,-5), file = path.join(directory,entry.name);
    if (!CODE.test(code)) continue;
    try {
      if (fs.statSync(file).size > MAX_FILE) throw new Error('CATALOG_TOO_LARGE');
      const catalog = JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
      if (!isRecord(catalog) || !isRecord(catalog.meta) || !isRecord(catalog.messages)
        || typeof catalog.meta.name !== 'string' || !catalog.meta.name.trim()
        || catalog.meta.name.length > 100 || (catalog.meta.code && catalog.meta.code !== code)) throw new Error('CATALOG_SCHEMA');
      const messages = Object.create(null);
      for (const [key,value] of Object.entries(catalog.messages)) {
        if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(key) || ['__proto__','prototype','constructor'].includes(key)) continue;
        if (typeof value === 'string') messages[key] = value;
        else if (isRecord(value)) {
          const forms = Object.create(null);
          for (const form of ['zero','one','two','few','many','other']) if (typeof value[form] === 'string') forms[form]=value[form];
          if (Object.keys(forms).length) messages[key]=forms;
        }
      }
      const meta = {code, name:catalog.meta.name.trim(), locale:safeLocale(catalog.meta.locale || code), direction:catalog.meta.direction==='rtl'?'rtl':'ltr', icon:''};
      let iconUrl = '';
      if (typeof catalog.meta.icon === 'string' && ICON.test(catalog.meta.icon)) {
        const icon = path.join(directory,'icons',catalog.meta.icon);
        try {
          const iconDirectory=fs.lstatSync(path.join(directory,'icons'));
          const stat = fs.lstatSync(icon);
          if (iconDirectory.isDirectory() && !iconDirectory.isSymbolicLink() && stat.isFile() && !stat.isSymbolicLink() && stat.size <= 256*1024) {
            // Images are never injected as markup or loaded as executable SVG documents.
            meta.icon = catalog.meta.icon; iconUrl = pathToFileURL(icon).href + '?v=' + stat.mtimeMs;
          }
        } catch {}
      }
      catalogs[code]={meta,messages}; languages.push({...meta,iconUrl});
    } catch (error) { diagnostics.push({key:'LanguageFileInvalid', params:{file:entry.name,detail:error instanceof SyntaxError?'JSON':String(error.message || error.code || '')}}); }
  }
  return {catalogs,languages,diagnostics,directory};
}
class CatalogService extends Engine {
  constructor(directory = path.join(__dirname,'..','languages'), language = 'ru') {
    super({language,...loadCatalogs(directory)}); this.watchers=[]; this.timer=null;
  }
  setOverrideDirectory(directory) {this.builtinDirectory ||= this.directory;this.overrideDirectory=directory;return this.reload();}
  reload() {
    const language=this.language,base=loadCatalogs(this.builtinDirectory||this.directory);
    if(this.overrideDirectory){
      const extra=loadCatalogs(this.overrideDirectory);
      for(const [code,catalog]of Object.entries(extra.catalogs))base.catalogs[code]={meta:catalog.meta,messages:{...(base.catalogs[code]?.messages||{}),...catalog.messages}};
      const languages=new Map(base.languages.map(l=>[l.code,l]));for(const l of extra.languages)languages.set(l.code,{...l,iconUrl:l.iconUrl||languages.get(l.code)?.iconUrl||''});
      base.languages=[...languages.values()];base.diagnostics.push(...extra.diagnostics);base.directory=this.overrideDirectory;
    }
    this.install({language,...base});return this.snapshot();
  }
  watch(onChange) {
    this.close();
    const changed=()=>{clearTimeout(this.timer);this.timer=setTimeout(()=>{this.reload();onChange(this.snapshot());},250);this.timer.unref?.();};
    for(const directory of [...new Set([this.directory,path.join(this.directory,'icons'),this.builtinDirectory,path.join(this.builtinDirectory||this.directory,'icons')].filter(Boolean))]) try {
      const watcher=fs.watch(directory,{persistent:false},changed);watcher.on('error',()=>{});this.watchers.push(watcher);
    } catch {}
  }
  close() { clearTimeout(this.timer);for(const watcher of this.watchers || [])watcher.close();this.watchers=[]; }

}
const service = new CatalogService();
module.exports = service;
module.exports.CatalogService = CatalogService;
module.exports.loadCatalogs = loadCatalogs;
