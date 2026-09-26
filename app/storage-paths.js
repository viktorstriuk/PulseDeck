'use strict';
const fs=require('node:fs'),path=require('node:path');
const {atomic,read}=require('./updates/manager');
// Resolve stable paths before creating Chromium profile or touching music. Legacy
// content is deliberately NOT moved: covers, lyrics and vault references stay valid.
function resolveStorage({root,platform,env,home}) {
  const profile=path.join(platform==='win32'?(env.APPDATA||env.LOCALAPPDATA||path.join(root,'data')):(env.XDG_CONFIG_HOME||path.join(home,'.config')),'PulseDeck');
  const local=path.join(platform==='win32'?(env.LOCALAPPDATA||env.APPDATA||path.join(root,'data')):(env.XDG_DATA_HOME||path.join(home,'.local','share')),'PulseDeck');
  const file=path.join(profile,'storage.json'),saved=read(file,null);
  if(fs.existsSync(file)&&!saved)throw new Error('STORAGE_CONFIG_INVALID');
  if(saved && (saved.schema!==1 || !['music','data','tools','languages'].every(k=>typeof saved[k]==='string'&&path.isAbsolute(saved[k]))))throw new Error('STORAGE_CONFIG_INVALID');
  let storage=saved;
  if(!storage){
    const oldMusic=path.join(root,'music'),oldData=path.join(root,'data');
    const legacy=fs.existsSync(oldMusic)||fs.existsSync(path.join(oldData,'settings.json'))||fs.existsSync(path.join(oldData,'lyrics'));
    storage={schema:1,music:legacy?oldMusic:path.join(home,'Music','PulseDeck'),data:legacy?oldData:path.join(local,'data'),tools:path.join(root,'components'),languages:path.join(profile,'languages'),legacyRoot:legacy?root:null};
    fs.mkdirSync(profile,{recursive:true});const settings=path.join(profile,'settings.json');if(fs.existsSync(settings)){const backup=path.join(profile,'backups','before-storage-v1.json');fs.mkdirSync(path.dirname(backup),{recursive:true});if(!fs.existsSync(backup))fs.copyFileSync(settings,backup,fs.constants.COPYFILE_EXCL);}
    atomic(file,storage);
  }
  const applicationTools=path.join(root,'components');
  if(path.resolve(storage.tools)!==path.resolve(applicationTools)){
    const backup=path.join(profile,'backups','before-components-local-2.9.1.json');fs.mkdirSync(path.dirname(backup),{recursive:true});
    if(!fs.existsSync(backup))fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);
    storage={...storage,tools:applicationTools};atomic(file,storage);
  }
  // Installer records the old user-modified catalogs here before replacing code.
  for(const dir of [storage.music,storage.data,storage.tools,storage.languages,path.join(storage.languages,'icons')])fs.mkdirSync(dir,{recursive:true});
  const guide=path.join(storage.languages,'README.md');if(!fs.existsSync(guide)){try{fs.copyFileSync(path.join(__dirname,'languages','README.md'),guide,fs.constants.COPYFILE_EXCL);}catch{}}
  return {...storage,profile,local,legacyTools:path.join(root,'tools'),updates:path.join(local,'updates'),userData:path.join(local,'chromium')};
}
module.exports={resolveStorage};
