'use strict';
// 2.8.0 copied stock catalogs into the user's override folder. Remove only values
// that still match known shipped text, once. Real edits and extra packs stay intact.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fingerprints=require('./migrations/281-stock.json');
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(record(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
const digest=value=>crypto.createHash('sha256').update(canonical(value)).digest('hex');
function noLinks(file){
 for(let current=path.resolve(file);;current=path.dirname(current)){
  try{if(fs.lstatSync(current).isSymbolicLink())return false;}catch(e){if(e.code!=='ENOENT')return false;}
  if(path.dirname(current)===current)return true;
 }
}
function atomic(file,data){
 const tmp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
 try{fs.writeFileSync(tmp,data,{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}finally{try{fs.unlinkSync(tmp);}catch{}}
}
function upgradeStockOverrides(directory){
 const result={updated:[],errors:[]};
 if(!fs.existsSync(directory))return result;
 if(!noLinks(directory)){result.errors.push({file:'languages',code:'UNSAFE_PATH'});return result;}
 const marker=path.join(directory,'.stock-copy-2.8.1');
 let completed=[];
 try{if(fs.existsSync(marker)){if(!noLinks(marker))throw new Error('UNSAFE_PATH');const data=JSON.parse(fs.readFileSync(marker,'utf8'));if(!Array.isArray(data))throw new Error('MIGRATION_STATE');completed=data.filter(v=>typeof v==='string');}}catch(e){result.errors.push({file:path.basename(marker),code:e.code||e.message});return result;}
 for(const [code,known]of Object.entries(fingerprints.catalogs)){
  if(completed.includes(code))continue;
  const file=path.join(directory,code+'.json');
  try{
   if(!fs.existsSync(file)){completed.push(code);continue;}
   const st=fs.lstatSync(file);if(!st.isFile()||st.size>2*1024*1024||!noLinks(file))throw new Error('UNSAFE_CATALOG');
   const bytes=fs.readFileSync(file),catalog=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
   if(!record(catalog)||!record(catalog.meta)||!record(catalog.messages))throw new Error('CATALOG_SCHEMA');
   let count=0;
   for(const [key,value]of Object.entries(catalog.messages))if(Object.hasOwn(known,key)&&known[key].includes(digest(value))){delete catalog.messages[key];count++;}
   if(count){
    const backupDir=path.join(path.dirname(directory),'language-backups','copy-2.8.1');
    if(!noLinks(backupDir))throw new Error('UNSAFE_BACKUP');fs.mkdirSync(backupDir,{recursive:true});
    const backup=path.join(backupDir,`${code}-${crypto.createHash('sha256').update(bytes).digest('hex').slice(0,16)}.json`);
    if(fs.existsSync(backup)){if(!noLinks(backup)||!fs.readFileSync(backup).equals(bytes))throw new Error('BACKUP_CONFLICT');}
    else fs.writeFileSync(backup,bytes,{flag:'wx',mode:0o600});
    atomic(file,JSON.stringify(catalog,null,2)+'\n');result.updated.push({code,count,backup});
   }
   completed.push(code);
  }catch(e){result.errors.push({file:path.basename(file),code:e.code||e.message});}
 }
 try{if(noLinks(marker))atomic(marker,JSON.stringify(completed)+'\n');}catch(e){result.errors.push({file:path.basename(marker),code:e.code||e.message});}
 return result;
}
module.exports={upgradeStockOverrides,digest,canonical};
