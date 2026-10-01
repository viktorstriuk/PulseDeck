'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const L=require('../shared/library-model'),F=L.Folders,C=require('../vault/crypto'),I=require('../i18n');
const fail=key=>I.error(key);
const clone=x=>JSON.parse(JSON.stringify(x));
const ORGANIZATION=['libraryFolders','folderArtistAliases','folderArtistNames','folderArtistAliasHistory','favorites','customCategories','categoryOrder','categoryStyles','artistAliases','artistNames','artistAliasHistory','playlistMembership','trackOrders','trackOrderSchema','coverAnimation','lastTrack'];
const snapshot=settings=>Object.fromEntries(ORGANIZATION.filter(k=>settings[k]!==undefined).map(k=>[k,clone(settings[k])]));
const hash=async file=>{const digest=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))digest.update(chunk);return digest.digest('hex');};
const exists=async file=>{try{return await fsp.lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
/** Public music moves are staged without removing originals, journalled, then
 * settings are committed with a transaction marker. Recovery rolls back staged
 * files before that marker, or completes cleanup afterwards. Never overwrite a
 * destination or remove a file that changed since the operation was prepared. */
class FolderStore{
  constructor({music,data,settings,commit,list,editor,vault,notify=()=>{},busy=()=>{}}){
    Object.assign(this,{music,data,settings,commit,list,editor,vault,notify,busy});this.journalFile=path.join(data,'folder-operation.json');this.active=false;this.journal=null;
  }
  async full(rel,{allowMissing=false}={}){
    if(typeof rel!=='string'||rel.length>4000||rel.includes('\\')||rel.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.'))||path.isAbsolute(rel)||/^[a-z]:/i.test(rel))throw fail('FolderUnsafePath');
    const file=path.resolve(this.music,rel),relative=path.relative(path.resolve(this.music),file);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw fail('FolderUnsafePath');
    let parent=this.music;for(const part of rel.split('/')){parent=path.join(parent,part);const stat=await exists(parent);if(stat?.isSymbolicLink())throw fail('FolderUnsafePath');if(!stat&&!allowMissing)throw fail('TrackUnavailable');}
    const root=await fsp.realpath(this.music);let probe=path.dirname(file);while(!(await exists(probe)))probe=path.dirname(probe);
    const real=await fsp.realpath(probe),r=path.relative(root,real);if(r.startsWith('..')||path.isAbsolute(r))throw fail('FolderUnsafePath');return file;
  }
  hidden(rel){return !!this.journal&&(this.settings().lastFolderTransaction===this.journal.id?this.journal.files.some(f=>f.cleanup&&L.token(f.source)===L.token(rel)):this.journal.files.some(f=>L.token(f.target)===L.token(rel)));}
  validateJournal(j){if(!j||j.v!==1||!/^[-\da-f]{36}$/.test(j.id||'')||!Array.isArray(j.files)||j.files.length>300000||!j.after||typeof j.after!=='object')throw fail('FolderRecoveryFailed');for(const f of j.files)if(!/^[a-f0-9]{64}$/.test(f.hash||'')||typeof f.target!=='string'||typeof f.source!=='string'||typeof f.cleanup!=='boolean')throw fail('FolderRecoveryFailed');return j;}
  async recover(){
    const stat=await exists(this.journalFile);if(!stat)return {ok:true};if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)throw fail('FolderRecoveryFailed');
    this.journal=this.validateJournal(JSON.parse(await fsp.readFile(this.journalFile,'utf8')));this.active=true;
    try{if(this.settings().lastFolderTransaction===this.journal.id)await this.finish(this.journal);else await this.rollback(this.journal);return {ok:true};}
    finally{this.active=false;}
  }
  async rollback(j){
    // Only complete files with our recorded digest are ours to discard.
    for(const f of [...j.files].reverse()){
      const target=await this.full(f.target,{allowMissing:true}),st=await exists(target);if(!st)continue;
      if(!st.isFile()||st.isSymbolicLink()||await hash(target)!==f.hash)throw fail('FolderRecoveryFailed');
      await fsp.unlink(target);
    }
    await fsp.unlink(this.journalFile);this.journal=null;
    for(const dir of [...(j.directories||[])].reverse())await fsp.rmdir(await this.full(dir,{allowMissing:true})).catch(()=>{});
  }
  async finish(j){
    // Check EVERY destination before deleting any original.
    for(const f of j.files){const target=await this.full(f.target);if(await hash(target)!==f.hash)throw fail('FolderRecoveryFailed');}
    // A previously decrypted track can still be referenced by private manifests.
    // Persist those public references before removing originals; repeat safely
    // after a crash between the settings commit and this cleanup.
    if(this.vault)await this.vault().remapPublicReferences(j.files.filter(f=>f.cleanup).map(f=>({from:f.source,to:f.target})));
    for(const f of j.files)if(f.cleanup){
      const source=await this.full(f.source,{allowMissing:true}),st=await exists(source);if(!st)continue;
      if(!st.isFile()||st.isSymbolicLink()||await hash(source)!==(f.sourceHash||f.hash))throw fail('FolderSourceChanged');
      await fsp.unlink(source);
    }
    await fsp.unlink(this.journalFile);this.journal=null;
    // Best effort only: external documents and shared sidecars are never deleted.
    for(const dir of j.oldDirectories||[])if(dir)await fsp.rmdir(await this.full(dir,{allowMissing:true})).catch(()=>{});
  }
  async command(c){
    if(this.active)throw fail('FolderBusy');
    if(this.journal||await exists(this.journalFile))await this.recover();
    if(c.type==='folder-save')return this.save(c);
    if(c.type==='folder-delete')return this.remove(c.id);
    if(c.type==='folder-move')return this.move(c);
    throw fail('AppUnknownOperation');
  }
  async save({id='',style={}}){
    const before=this.settings(),name=String(style.name||'').trim().slice(0,40);if(!name)throw fail('FolderNameRequired');
    const next=clone(before);let folder=next.libraryFolders.find(f=>f.id===id),created=false;
    if(id&&!folder)throw fail('FolderNotFound');
    if(!folder){
      if(next.libraryFolders.length>=250)throw fail('FolderTooMany');
      let stem=name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/^\.+/,'_').replace(/[. ]+$/,'')||'Music';if(!F.safeDirectory(stem))stem='_'+stem;
      let dir=stem,index=1;while(await exists(path.join(this.music,dir))||next.libraryFolders.some(f=>L.token(f.dir)===L.token(dir)))dir=`${stem} (${++index})`;
      folder={id:'folder:'+crypto.randomBytes(16).toString('hex'),dir};await fsp.mkdir(await this.full(dir,{allowMissing:true}));created=true;next.libraryFolders.push(folder);
    }
    Object.assign(folder,{name,icon:style.icon||'folder',color:style.color,glow:style.glow,glowIntensity:style.glowIntensity,gradient:style.gradient});
    try{this.commit({...before,libraryFolders:F.normalize(next.libraryFolders)});}catch(e){if(created)await fsp.rmdir(path.join(this.music,folder.dir)).catch(()=>{});throw e;}
    this.notify();return {ok:true,folder:clone(folder),settings:L.organizationPatch(this.settings())};
  }
  async remove(id){
    const current=this.settings(),folder=current.libraryFolders.find(f=>f.id===id);if(!folder)throw fail('FolderNotFound');
    if((await this.list()).some(t=>F.ofTrack(t,current)===id)||(current.customCategories||[]).some(c=>c.folderId===id)||Object.keys(current.protectedPlaylists||{}).some(k=>F.ofCategory(k,current)===id))throw fail('FolderNotEmpty');
    const dir=await this.full(folder.dir);if((await fsp.readdir(dir)).length)throw fail('FolderNotEmpty');
    // Settings first, then rmdir; a failure simply leaves an empty normal directory.
    const next=clone(current);next.libraryFolders=next.libraryFolders.filter(f=>f.id!==id);for(const field of ['folderArtistAliases','folderArtistNames','folderArtistAliasHistory'])delete next[field]?.[id];
    next.categoryOrder=next.categoryOrder.filter(k=>F.split(k).folderId!==id);
    for(const field of ['categoryStyles','playlistMembership','trackOrders'])for(const k of Object.keys(next[field]||{}))if(F.split(k).folderId===id)delete next[field][k];
    this.commit(next);await fsp.rmdir(dir).catch(()=>{});this.notify();return {ok:true,settings:L.organizationPatch(this.settings())};
  }
  transferPlaylists(next,sourceKey,targetFolder,all){
    const sourceFolder=F.ofCategory(sourceKey,next);
    const cats=L.categories([],next,true).filter(c=>all?F.ofCategory(c.key,next)===sourceFolder:c.key===sourceKey);
    // Automatic artist tabs with no current tracks still have styles/orders worth keeping.
    const keys=new Set([sourceKey,...cats.map(c=>c.key),...(all?[...Object.keys(next.categoryStyles||{}),...Object.keys(next.playlistMembership||{}),...Object.keys(next.trackOrders||{}),...(next.categoryOrder||[])].filter(k=>F.ofCategory(k,next)===sourceFolder):[])]);
    for(const key of keys){
      const custom=next.customCategories.find(c=>c.id===key);if(custom){custom.folderId=targetFolder;continue;}
      const target=F.scoped(targetFolder,key);if(key===target)continue;
      if(next.protectedPlaylists?.[key])throw fail('FolderProtectedSystem');
      for(const field of ['categoryStyles','playlistMembership','trackOrders']){
        const value=next[field]?.[key];if(!value)continue;
        if(field==='categoryStyles')next[field][target]={...value,...(next[field][target]||{}),hidden:false};
        else if(field==='playlistMembership')next[field][target]={included:L.unique([...(next[field][target]?.included||[]),...(value.included||[])]),excluded:L.unique([...(next[field][target]?.excluded||[]),...(value.excluded||[])])};
        else {next[field][target]||={};for(const [sort,rels]of Object.entries(value))next[field][target][sort]=L.unique([...(next[field][target][sort]||[]),...rels]);}
        delete next[field][key];
      }
      next.categoryOrder=next.categoryOrder.map(k=>k===key?target:k);
    }
    if(all){const from=F.aliasState(next,sourceFolder),to=F.aliasState(next,targetFolder);Object.assign(to.aliases,from.aliases);Object.assign(to.names,from.names);to.history.push(...from.history);}
    return next;
  }
  async move({sourceKey,targetFolder='',movePlaylist=false}){
    const settings=this.settings(),target=settings.libraryFolders.find(f=>f.id===targetFolder);
    if(targetFolder&&!target)throw fail('FolderNotFound');
    const tracks=await this.list(),category=L.categories(tracks,settings,true).find(c=>c.key===sourceKey);
    if(!category)throw fail('LibraryPlaylistNoLongerExists');
    const sourceFolder=F.ofCategory(sourceKey,settings);if(sourceFolder===targetFolder)return {ok:true,count:0,settings:L.organizationPatch(settings)};
    if(category.protected){
      // A custom protected playlist is already an isolated encrypted directory.
      // Re-group its tab without decrypting/re-encrypting or changing its keys.
      if(!movePlaylist||category.kind!=='custom')throw fail('FolderProtectedSystem');
      const next=clone(settings);next.customCategories.find(c=>c.id===sourceKey).folderId=targetFolder;this.commit(next);this.notify();return {ok:true,count:0,targetKey:sourceKey,settings:L.organizationPatch(this.settings())};
    }
    const selected=tracks.filter(L.membershipPredicate(settings,sourceKey)),source=settings.libraryFolders.find(f=>f.id===sourceFolder),files=[],moves=[],reserved=new Set(),directories=new Set();
    this.snapshotTracks=tracks;this.active=true;this.busy(true);
    try{
      // Freeze all original metadata before staging any destination.
      await this.editor.withSnapshot(async()=>{for(const track of selected){
        const r=await this.editor.resolve(track.rel);if(r.entry)throw fail('FolderProtectedSystem');
        const inside=source?track.rel.slice(source.dir.length+1):track.rel;
        const original=await this.full(track.rel),extension=path.posix.extname(inside),stem=inside.slice(0,-extension.length),base=target?target.dir+'/':'';
        const oldStem=track.rel.slice(0,-path.posix.extname(track.rel).length);
        const attached=[['.info.json',true],['.lyrics.json',true],['.lrc',true]].map(([suffix,cleanup])=>({source:track.rel+suffix,suffix,cleanup,stem:false}));
        for(const suffix of ['.info.json','.lyrics.json','.lrc','.txt'])attached.push({source:oldStem+suffix,suffix,cleanup:false,stem:true});
        const sidecars=[];for(const item of attached){const file=await this.full(item.source,{allowMissing:true}),stat=await exists(file);if(stat){if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw fail('FolderUnsafePath');sidecars.push(item);}}
        let n=0,rel;
        for(;;){rel=base+stem+(n?` (${n+1})`:'')+extension;const newStem=rel.slice(0,-extension.length),candidates=[rel,rel+'.pulse.json',...sidecars.map(s=>s.stem?newStem+s.suffix:rel+s.suffix)];
          let free=true;for(const candidate of candidates)if(reserved.has(L.token(candidate))||await exists(await this.full(candidate,{allowMissing:true}))){free=false;break;}
          if(free){candidates.forEach(c=>reserved.add(L.token(c)));break;}if(++n>100000)throw fail('FolderNameRequired');}
        files.push({source:track.rel,target:rel,hash:await hash(original),cleanup:true});moves.push({from:track.rel,to:rel});
        const oldPulse=await this.full(track.rel+'.pulse.json',{allowMissing:true}),oldPulseStat=await exists(oldPulse);
        const pulse={...r.data,_pulseTrackId:track.id,_pulseAddedAt:track.addedAt};
        const content=JSON.stringify(pulse,null,2)+'\n';files.push({source:track.rel+'.pulse.json',target:rel+'.pulse.json',content,hash:crypto.createHash('sha256').update(content).digest('hex'),sourceHash:oldPulseStat?await hash(oldPulse):null,cleanup:!!oldPulseStat});
        for(const side of sidecars){const newStem=rel.slice(0,-extension.length);files.push({...side,target:side.stem?newStem+side.suffix:rel+side.suffix,hash:await hash(await this.full(side.source))});}
        for(const f of files.slice(-sidecars.length-2)){const parent=path.posix.dirname(f.target);if(parent!=='.')directories.add(parent);}
      }});
      let next=F.remap(this.settings(),moves);
      if(movePlaylist)next=this.transferPlaylists(next,sourceKey,targetFolder,F.split(sourceKey).base==='all');
      next=L.normalizeOrganization(next);const id=crypto.randomUUID();
      const journal={v:1,id,files,after:snapshot(next),directories:[...directories],oldDirectories:[...new Set(moves.map(m=>path.posix.dirname(m.from)).filter(d=>d!=='.'))]};
      await C.durableJson(this.journalFile,journal);this.journal=journal;
      for(const file of files){
        const out=await this.full(file.target,{allowMissing:true});await fsp.mkdir(path.dirname(out),{recursive:true});
        if(file.content!==undefined){const handle=await fsp.open(out,'wx',0o600);try{await handle.writeFile(file.content);await handle.sync();}finally{await handle.close();}}
        else {const input=await this.full(file.source);if(await hash(input)!==file.hash)throw fail('FolderSourceChanged');
          try{await fsp.link(input,out);}catch(e){if(!['EXDEV','EPERM','EOPNOTSUPP','ENOTSUP'].includes(e.code))throw e;await fsp.copyFile(input,out,fs.constants.COPYFILE_EXCL);}
          // FlushFileBuffers (Node fsync on Windows) requires GENERIC_WRITE.
          // Do not swallow EPERM: genuine write/flush failures must roll back.
          const handle=await fsp.open(out,'r+');try{await handle.sync();}finally{await handle.close();}
          if(await hash(out)!==file.hash)throw fail('FolderSourceChanged');
        }
      }
      this.commit({...this.settings(),...journal.after,lastFolderTransaction:id});
      let warning='';try{await this.finish(journal);}catch{warning=I.t('FolderCleanupPending');}
      this.notify();return {ok:true,count:moves.length,moves,targetKey:movePlaylist?F.scoped(targetFolder,sourceKey):F.scoped(targetFolder,'all'),warning,settings:L.organizationPatch(this.settings()),coverAnimation:this.settings().coverAnimation,lastTrack:this.settings().lastTrack};
    }catch(error){if(this.journal&&this.settings().lastFolderTransaction!==this.journal.id){try{await this.rollback(this.journal);}catch(recovery){throw fail('FolderRecoveryFailed');}}throw error;}
    finally{this.active=false;this.snapshotTracks=null;this.busy(false);this.notify();}
  }
}
module.exports={FolderStore,snapshot,hash};
