'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {extractMetadata}=require('../metadata');
const C=require('../vault/crypto'),run=require('../vault/jobs'),Fields=require('../shared/track-enrichment');
const I18n=require('../i18n'),Images=require('./images'),Media=require('../shared/cover-media');
const fail=code=>I18n.error(code);
async function regular(file,max=1024*1024){const st=await fsp.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>max)throw fail('TrackUnsafeFile');return st;}
async function sidecar(file){try{await regular(file);const value=JSON.parse(await fsp.readFile(file,'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw fail('TrackUnsafeFile');return value;}catch(e){if(e.code==='ENOENT')return {};throw e;}}
/** Edits are sidecars, not lossy audio retagging. Audio hashes/lyrics/favourites stay stable. */
class TrackEditor{
  constructor(options){Object.assign(this,options);this.snapshotUsers=0;this.snapshotPromise=null;}
  // One membership scan per batch, not a full library rescan per changed track.
  // Every write still revalidates the real file, current tags and sidecar revision.
  async withSnapshot(fn){this.snapshotUsers++;try{return await fn();}finally{if(!--this.snapshotUsers)this.snapshotPromise=null;}}
  async indexedTrack(rel){
    if(!this.snapshotUsers)return (await this.list()).find(t=>t.rel===rel);
    this.snapshotPromise||=this.list().then(tracks=>new Map(tracks.map(t=>[t.rel,t])));
    return (await this.snapshotPromise).get(rel);
  }
  async resolve(rel){
    if(typeof rel!=='string'||rel.length>4000)throw fail('TrackUnavailable');
    if(rel.startsWith('vault:')){const {s,entry}=await this.vault().lookup(rel);return {s,entry,track:{...entry.meta,rel,coverType:entry.coverType||'',coverUrl:entry.cover?'private:cover':''},revision:entry.meta._pulseRevision||null};}
    let track=await this.indexedTrack(rel);if(!track||this.vault().hidden(rel))throw fail('TrackUnavailable');
    const file=path.resolve(this.music,rel),base=await fsp.realpath(this.music),real=await fsp.realpath(file),relative=path.relative(base,real);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw fail('TrackUnsafeFile');
    const stat=await regular(file,2*1024**3);
    if(this.snapshotUsers){const meta=await extractMetadata(file,this.covers,stat);track={...track,title:meta.title||path.basename(file,path.extname(file)),artist:meta.artist||'',album:meta.album||'',genre:meta.genre||'',duration:Number(meta.duration)||0,coverUrl:meta.coverPath&&fs.existsSync(meta.coverPath)?pathToFileURL(meta.coverPath).href:'',size:stat.size,modifiedAt:stat.mtimeMs,editRevision:meta._pulseRevision||null,coverType:Media.typeOf(meta.coverPath,meta.coverType)};}
    const data=await sidecar(file+'.pulse.json');
    return {file,track,data,revision:data._pulseRevision||null};
  }
  async info(rel){const r=await this.resolve(rel);return {ok:true,track:r.track,revision:r.revision};}
  async update(rel,patch,{revision,coverBuffer,coverFile,onlyMissingCover=false,automatic=false}={}){
    let clean={};if(patch&&Object.keys(patch).length)try{clean=Fields.validatePatch(patch);}catch{throw fail('TrackBadEdit');}
    if(!Object.keys(clean).length&&!coverBuffer&&!coverFile)throw fail('TrackBadEdit');
    const media=coverFile||(coverBuffer?Images.describe(coverBuffer):null),hasCover=!!media;
    return this.vault().exclusive(async()=>{
      const r=await this.resolve(rel);if(revision!==undefined&&revision!==r.revision)throw fail('TrackChanged');
      if(onlyMissingCover&&(r.entry?.cover||r.track.coverUrl))return {ok:true,skipped:true};
      if(automatic&&Object.keys(clean).length&&!Fields.unknown(r.track.artist))return {ok:true,skipped:true};
      const nextRevision=crypto.randomUUID();
      if(r.entry){
        const v=this.vault(),previous=structuredClone(r.entry.meta),oldCover=r.entry.cover,oldType=r.entry.coverType;let created;
        if(hasCover){const id=crypto.randomBytes(16).toString('hex'),tmp=coverFile?.path||path.join(this.covers,'.private-'+id+'.'+media.ext);await fsp.mkdir(this.covers,{recursive:true});
          try{if(coverFile)await Images.assertUnchanged(coverFile);else await fsp.writeFile(tmp,coverBuffer,{flag:'wx',mode:0o600});created=await run('encryptFile',tmp,v.file(r.s.d,id+'.pda'),id);if(coverFile)await Images.assertUnchanged(coverFile);}
          catch(error){await fsp.unlink(v.file(r.s.d,id+'.pda')).catch(()=>{});throw error;}finally{if(!coverFile)await fsp.unlink(tmp).catch(()=>{});}
          if(v.sessions.get(r.s.d.id)!==r.s){await fsp.unlink(v.file(r.s.d,id+'.pda')).catch(()=>{});throw fail('TrackUnavailable');}
          v.index.objects[id]={file:v.relative(v.file(r.s.d,id+'.pda')),refs:[r.s.d.id]};await v.persist();
        }
        if(v.sessions.get(r.s.d.id)!==r.s)throw fail('TrackUnavailable');
        r.entry.meta={...r.entry.meta,...clean,_pulseRevision:nextRevision};if(created){r.entry.cover=created;r.entry.coverType=media.type;}
        try{await v.saveManifest(r.s);}catch(error){r.entry.meta=previous;r.entry.cover=oldCover;r.entry.coverType=oldType;throw error;}
        if(created){const identity=`${r.s.d.id}:${r.entry.id}:cover`,token=v.tokenKeys.get(identity);if(token)v.tokens.delete(token);v.tokenKeys.delete(identity);}
      }else{
        let coverPath=r.data.coverPath;if(coverFile)coverPath=await Images.storeFile(coverFile,this.covers);else if(coverBuffer){const digest=crypto.createHash('sha256').update(coverBuffer).digest('hex');coverPath=path.join(this.covers,'custom-'+digest+'.'+media.ext);await fsp.mkdir(this.covers,{recursive:true});await fsp.writeFile(coverPath,coverBuffer,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});}
        // Keep one prior metadata snapshot inside the same sidecar. Vault capture
        // already removes this file, so no new plaintext backup is left outside it.
        const prior={title:r.track.title,artist:r.track.artist,...(r.data.coverPath?{coverPath:r.data.coverPath,coverType:Media.typeOf(r.data.coverPath,r.data.coverType)}:{})};
        const data={...r.data,...clean,...(hasCover?{coverPath,coverType:media.type}:{}),_pulseTrackId:r.track.id,_pulseAddedAt:r.track.addedAt,_pulseRevision:nextRevision,_pulsePrevious:prior};
        await C.durableJson(r.file+'.pulse.json',data);
      }
      this.notify();return {ok:true,revision:nextRevision,patch:clean};
    });
  }
}
module.exports={TrackEditor,regular,sidecar};
