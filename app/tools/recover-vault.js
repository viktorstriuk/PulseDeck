'use strict';
const I18n = require("../i18n");
/** Read-only recovery/export. Uses the PERSONAL playlist password, never a bypass.
 * node recover-vault.js <music> <playlist-folder> <new-output-folder>
 * The password is requested without echo; do not put it in a command line.
 */
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const {Writable}=require('node:stream');const C=require('../vault/crypto');const {audioName}=require('../vault/store');
async function recover({music,folder,output,password}){
 music=path.resolve(music);folder=path.resolve(folder);output=path.resolve(output);
 const outside=(root,file)=>{const r=path.relative(root,file);return r.startsWith('..'+path.sep)||r==='..'||path.isAbsolute(r);};
 if(!outside(music,output))throw I18n.error("VaultRecoveryFolderMustBeOutsideMusic");
 if(outside(music,folder))throw I18n.error("VaultSpecifyAPlaylistFolderInsideMusic");
 if(fs.existsSync(output))throw I18n.error("VaultRecoveryRequiresANewFolderThatDoesNot");
 const header=JSON.parse(await fs.promises.readFile(path.join(folder,'.pulsedeck-vault'),'utf8'));
 const master=await C.unwrap(header.wrapped,password,`master:${header.id}`);password='';
 const key=Buffer.from(master.master,'hex');let manifest;
 try{manifest=C.open(JSON.parse(await fs.promises.readFile(path.join(folder,'playlist.pdv'),'utf8')),key,`manifest:${header.id}`);}finally{key.fill(0);master.master='';}
 const blobs=new Map();async function walk(dir){for(const entry of await fs.promises.readdir(dir,{withFileTypes:true})){
   const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(entry.isFile()&&/^[a-f0-9]{32}\.pda$/.test(entry.name))blobs.set(entry.name.slice(0,-4),file);
 }}await walk(music);
 let index={};try{index=JSON.parse(await fs.promises.readFile(path.join(music,'.pulsedeck-vault-index.json'),'utf8'));}catch{}
 const entries=[...new Map([...(manifest.tracks||[]),...(manifest.archived||[]),...(manifest.trashed||[])].map(e=>[e.id,e])).values()];
 await fs.promises.mkdir(output,{recursive:false});const restored=[],failed=[];
 for(const entry of entries){
  let name=audioName(entry.originalRel,entry.meta),dest=path.join(output,name),n=2;const ext=path.extname(name),base=name.slice(0,-ext.length);
  while(fs.existsSync(dest))dest=path.join(output,`${base} (${n++})${ext}`);
  try{
   const encrypted=blobs.get(entry.blob.id);
   if(encrypted){await C.verifyFile(encrypted,entry.blob);await C.decryptFile(encrypted,dest,entry.blob);}
   else{
    const rel=index.publicRefs?.[entry.id]?.rel||entry.originalRel,candidate=path.resolve(music,rel||'');
    if(outside(music,candidate)||!fs.existsSync(candidate))throw I18n.error("VaultAudioFileMissingRestoreItFromTheRecycle");
    await C.verifySource(candidate,entry.blob);await fs.promises.copyFile(candidate,dest,fs.constants.COPYFILE_EXCL);
   }
   let coverPath='';if(entry.cover&&blobs.has(entry.cover.id)){coverPath=dest+(entry.coverType==='image/png'?'.png':'.jpg');await C.decryptFile(blobs.get(entry.cover.id),coverPath,entry.cover);}
   await C.durableJson(dest+'.pulse.json',{...entry.meta,coverPath});restored.push(path.basename(dest));
  }catch(e){failed.push({title:entry.meta.title,message:e.message});}
 }
 // This report is intentionally clear, in the explicit recovery destination only.
 await C.durableJson(path.join(output,'RECOVERY-REPORT.json'),{restored,failed});return {restored,failed};
}
async function askPassword(){
 if(!process.stdin.isTTY)throw I18n.error("VaultRunTheUtilityInARegularTerminalPassword");
 process.stdout.write(I18n.t("VaultPersonalPlaylistPassword"));const muted=new Writable({write(_chunk,_encoding,done){done();}});
 const rl=readline.createInterface({input:process.stdin,output:muted,terminal:true});
 try{return await new Promise((resolve,reject)=>{rl.once('SIGINT',()=>reject(I18n.error("VaultCancelled")));rl.question('',resolve);});}finally{rl.close();process.stdout.write('\n');}
}
if(require.main===module)(async()=>{
 const [music,folder,output]=process.argv.slice(2);if(!music||!folder||!output)throw I18n.error("VaultUsageNodeRecoverVaultJsMusicMusicPlaylist");
 let password=await askPassword();const result=await recover({music,folder,output,password});password='';console.log(I18n.t("VaultRecoveredFailedTheSourceFolderWasNotChanged", {value1:(result.restored.length),value2:(result.failed.length)}));if(result.failed.length)process.exitCode=2;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={recover};
