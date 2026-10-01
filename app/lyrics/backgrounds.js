'use strict';
/** Per-recording visual assets, separate from album covers. Public assets live
 * in the profile. Private ones are authenticated encrypted streams: descriptors
 * never cross IPC, and their capabilities are revoked with the vault session. */
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const L=require('../shared/lyrics'),E=require('../shared/lyrics-editor'),I18n=require('../i18n');
const Images=require('../library/images'),Media=require('../shared/cover-media'),C=require('../vault/crypto'),run=require('../vault/jobs');
const PUBLIC=/^custom-[a-f0-9]{64}\.(png|jpe?g|webp|gif|bmp|avif|mp4|webm|mov|ogv)$/;
const PRIVATE=/^private-([a-f0-9]{32})\.(png|jpe?g|webp|gif|bmp|avif|mp4|webm|mov|ogv)$/;
function directory(store,id){store.publicFile(id);return path.join(store.data,'lyrics','backgrounds',id);}
function publicPath(store,id,ref){if(!PUBLIC.test(ref||''))throw I18n.error('LyricsBackgroundInvalid');return path.join(directory(store,id),ref);}
function privatePath(store,asset){const m=PRIVATE.exec(asset?.ref||'');if(!m||asset.blob?.id!==m[1])throw I18n.error('LyricsBackgroundInvalid');return path.join(store.music,'.pulsedeck-lyrics','backgrounds',m[1]+'.pda');}
async function regular(file){const st=await fsp.lstat(file);if(!st.isFile()||st.isSymbolicLink())throw I18n.error('LyricsBackgroundInvalid');return st;}
function setTheme(record,ref){record.theme=L.theme({...record.theme,customBackground:ref});if(record.doc)record.doc.theme=record.theme;}
async function encrypt(store,media){
  const id=crypto.randomBytes(16).toString('hex'),asset={ref:`private-${id}.${media.ext}`,type:media.type,blob:{id}};
  await Images.assertUnchanged(media);asset.blob=await run('encryptFile',media.path,privatePath(store,asset),id);await Images.assertUnchanged(media);return asset;
}
module.exports={
  async visibleRecord(r,record){
    const {backgroundAsset,videoAsset,originalSidecars,...visible}=record||{};
    let background=null;
    const ref=visible.theme?.customBackground;
    if(ref){
      try{
        if(PRIVATE.test(ref)&&r.entry&&backgroundAsset?.ref===ref){
          await regular(privatePath(this,backgroundAsset));
          background={url:await this.getVault().lyricsAsset(r.s,r.entry,backgroundAsset),type:backgroundAsset.type};
        }else if(PUBLIC.test(ref)){
          const file=publicPath(this,r.recordingId,ref);await regular(file);
          background={url:pathToFileURL(file).href,type:Media.typeOf(file)};
        }
      }catch(e){if(e.code!=='ENOENT')throw e;visible.warnings=[...(visible.warnings||[]),I18n.t('LyricsBackgroundMissing')];}
    }
    let musicVideo=null;
    if(visible.musicVideo?.ref){
      try{
        const info=visible.musicVideo,ref=info.ref;
        if(PRIVATE.test(ref)&&r.entry&&videoAsset?.ref===ref){await regular(privatePath(this,videoAsset));musicVideo={...info,url:await this.getVault().lyricsAsset(r.s,r.entry,videoAsset)};}
        else if(PUBLIC.test(ref)){const file=publicPath(this,r.recordingId,ref);await regular(file);musicVideo={...info,url:pathToFileURL(file).href};}
      }catch(e){if(e.code!=='ENOENT')throw e;visible.warnings=[...(visible.warnings||[]),I18n.t('MediaMissing')];}
    }
    return {...visible,background,musicVideo};
  },
  async pickBackground({rel,revision}){
    await this.resolve(rel);
    const result=await this.dialog.showOpenDialog(this.parent(),{title:I18n.t('LyricsBackgroundChoose'),properties:['openFile'],filters:[{name:I18n.t('CoverImages'),extensions:Object.keys(Media.TYPES)}]});
    if(result.canceled||!result.filePaths?.length)return {canceled:true};
    return this.setBackground({rel,revision,file:result.filePaths[0]});
  },
  async setBackground({rel,revision,file}){
    const epoch=this.lockEpoch,r=await this.resolve(rel),old=await this.readRecord(r);
    if((old?.revision||null)!==(revision||null))throw I18n.error('LyricsAnotherActionHasChangedTheAppearanceReopenThe');
    if(!this.inspectBackground)throw I18n.error('LyricsBackgroundInvalid');
    const media=await this.inspectBackground(file);
    const isPrivate=!!r.entry&&!this.getVault().index.publicRefs[r.entry.id];
    let ref,asset;
    if(isPrivate){asset=await encrypt(this,media);ref=asset.ref;}
    else ref=path.basename(await Images.storeFile(media,directory(this,r.recordingId)));
    if(epoch!==this.lockEpoch||(r.entry&&this.getVault().sessions.get(r.s.d.id)!==r.s))throw I18n.error('LyricsPlaylistLocked');
    // Recheck the revision after I/O. The main bridge also serializes these
    // mutations with edits, encryption and physical library moves.
    const latest=await this.readRecord(r);
    if((latest?.revision||null)!==(revision||null))throw I18n.error('LyricsAnotherActionHasChangedTheAppearanceReopenThe');
    const record={...(old||{}),doc:old?.doc||null,timing:E.preferences(old?.doc||old?.timing),revision:crypto.randomUUID(),updatedAt:Date.now(),theme:L.theme({...old?.theme,mode:'custom',customBackground:ref})};
    if(asset)record.backgroundAsset=asset;else delete record.backgroundAsset;
    if(record.doc)record.doc.theme=record.theme;
    await this.writeRecord(r,record);
    // Clean only the formerly referenced, application-owned public asset. Never
    // delete the selected source, an external cover or an encrypted descriptor.
    const previous=old?.theme?.customBackground;
    if(PUBLIC.test(previous||'')&&previous!==ref&&previous!==old?.musicVideo?.ref)await fsp.unlink(publicPath(this,r.recordingId,previous)).catch(()=>{});
    return this.visibleRecord(r,{...record,recordingId:r.recordingId,private:isPrivate});
  },
  async setMusicVideo({rel,revision,file,info,asBackground=false}){
    const epoch=this.lockEpoch,r=await this.resolve(rel),old=await this.readRecord(r);
    if((old?.revision||null)!==(revision||null))throw I18n.error('LyricsAnotherActionHasChangedTheAppearanceReopenThe');
    const media=await this.inspectBackground(file);
    if(!media.type.startsWith('video/'))throw I18n.error('LyricsBackgroundInvalid');
    const isPrivate=!!r.entry&&!this.getVault().index.publicRefs[r.entry.id];
    let asset,ref;
    if(isPrivate){asset=await encrypt(this,media);ref=asset.ref;}
    else ref=path.basename(await Images.storeFile(media,directory(this,r.recordingId)));
    const latest=await this.readRecord(r);
    if(epoch!==this.lockEpoch||(r.entry&&this.getVault().sessions.get(r.s.d.id)!==r.s))throw I18n.error('LyricsPlaylistLocked');
    if((latest?.revision||null)!==(revision||null))throw I18n.error('LyricsAnotherActionHasChangedTheAppearanceReopenThe');
    const M=require('../shared/media');
    const record={...(old||{}),revision:crypto.randomUUID(),updatedAt:Date.now(),musicVideo:{ref,type:media.type,duration:Math.max(0,Number(info.duration)||0),sourceUrl:M.youtube(info.sourceUrl)||'',...M.sync(info),profile:M.profile(info.profile)}};
    if(asset)record.videoAsset=asset;else delete record.videoAsset;
    if(asBackground){record.theme=L.theme({...record.theme,mode:'custom',customBackground:ref});if(asset)record.backgroundAsset=asset;else delete record.backgroundAsset;if(record.doc)record.doc.theme=record.theme;}
    await this.writeRecord(r,record);
    const previous=old?.musicVideo?.ref;
    if(PUBLIC.test(previous||'')&&previous!==ref&&previous!==record.theme?.customBackground)await fsp.unlink(publicPath(this,r.recordingId,previous)).catch(()=>{});
    return this.visibleRecord(r,{...record,recordingId:r.recordingId,private:isPrivate});
  },
  async updateMusicVideo({rel,revision,sync,remove=false,asBackground=false}){
    const r=await this.resolve(rel),old=await this.readRecord(r);
    if(!old?.musicVideo)throw I18n.error('MediaMissing');
    if((old.revision||null)!==(revision||null))throw I18n.error('LyricsAnotherActionHasChangedTheAppearanceReopenThe');
    const record={...old,revision:crypto.randomUUID(),updatedAt:Date.now()};
    if(remove){
      if(record.theme?.customBackground===record.musicVideo.ref){record.theme=L.theme({...record.theme,mode:'gradient',customBackground:''});delete record.backgroundAsset;if(record.doc)record.doc.theme=record.theme;}
      delete record.musicVideo;delete record.videoAsset;
    }else{
      record.musicVideo={...record.musicVideo,...require('../shared/media').sync(sync)};
      if(asBackground){record.theme=L.theme({...record.theme,mode:'custom',customBackground:record.musicVideo.ref});if(record.videoAsset)record.backgroundAsset=record.videoAsset;if(record.doc)record.doc.theme=record.theme;}
    }
    await this.writeRecord(r,record);
    if(remove&&PUBLIC.test(old.musicVideo.ref)&&old.musicVideo.ref!==record.theme?.customBackground)await fsp.unlink(publicPath(this,r.recordingId,old.musicVideo.ref)).catch(()=>{});
    return this.visibleRecord(r,{...record,recordingId:r.recordingId});
  },
  async sealBackground(record,id){
    const encrypted=new Map();
    for(const [ref,slot]of [[record.theme?.customBackground,'backgroundAsset'],[record.musicVideo?.ref,'videoAsset']]){
      if(!PUBLIC.test(ref||''))continue;
      const file=publicPath(this,id,ref);await regular(file);
      const st=await fsp.lstat(file),asset=encrypted.get(ref)||await encrypt(this,{path:file,size:st.size,mtimeMs:st.mtimeMs,ctimeMs:st.ctimeMs,ino:st.ino,dev:st.dev,type:Media.typeOf(file),ext:path.extname(file).slice(1)});
      encrypted.set(ref,asset);record[slot]=asset;if(slot==='backgroundAsset')setTheme(record,asset.ref);else record.musicVideo={...record.musicVideo,ref:asset.ref};
    }
  },
  async retireBackground(entry){
    const root=directory(this,entry.lyricsRecordingId);
    const names=await fsp.readdir(root).catch(e=>{if(e.code==='ENOENT')return [];throw e;});if(!names.length)return;
    const box=JSON.parse(await fsp.readFile(this.privateFile(entry.id),'utf8'));
    const sealed=await run('open',box,entry.blob.key,`lyrics:${entry.id}`);
    for(const asset of [sealed.backgroundAsset,sealed.videoAsset])if(asset)await run('verifyFile',privatePath(this,asset),asset.blob);
    // Refuse unknown files/symlinks; this is not a recursive deletion primitive.
    for(const name of names){if(!PUBLIC.test(name)&&!/^\.cover-[\w-]+\.tmp$/.test(name))throw I18n.error('LyricsBackgroundInvalid');await regular(path.join(root,name));}
    for(const name of names)await fsp.unlink(path.join(root,name));await fsp.rmdir(root);
  },
  async exportBackground(record,id){
    for(const slot of ['backgroundAsset','videoAsset']){
      const asset=record[slot];
      if(asset){
        const file=privatePath(this,asset),ref='custom-'+asset.blob.sha256+'.'+Media.extension(asset.type),target=publicPath(this,id,ref);
        await fsp.mkdir(directory(this,id),{recursive:true});
        try{await regular(target);await run('verifySource',target,asset.blob);}catch(e){if(e.code!=='ENOENT')throw e;await run('decryptFile',file,target,asset.blob);}
        if(slot==='backgroundAsset')setTheme(record,ref);else record.musicVideo={...record.musicVideo,ref};
      }
      delete record[slot];
    }
  },
};
