'use strict';
const I18n = require("../i18n");
const fs=require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const crypto=require('node:crypto');
const {fileURLToPath}=require('node:url');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const C=require('./crypto');
const run=require('./jobs');
const L=require('../shared/library-model');
const copy=x=>JSON.parse(JSON.stringify(x));
const random=()=>crypto.randomBytes(16).toString('hex');
function filename(s){return String(s||I18n.t("UIPlaylist")).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||I18n.t("UIPlaylist");}
function audioName(original,meta={}){const leaf=path.basename(original||meta.title||I18n.t("PlaylistIconTrack")),ext=path.extname(leaf)||'.'+String(meta.ext||'mp3').toLowerCase();let base=filename(path.extname(leaf)?leaf.slice(0,-ext.length):leaf).slice(0,90);if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base))base='_'+base;return base+ext;}
function readJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw I18n.error("VaultProtectedPlaylistIndexIsCorruptedRestoreMusicFrom");}}
function range(value,size){
  if(!value)return {start:0,end:size-1,partial:false};
  const m=/^bytes=(\d*)-(\d*)$/.exec(value);if(!m||(!m[1]&&!m[2]))throw I18n.error("VaultInvalidRange");
  let start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2])),end=m[1]?(m[2]?Math.min(size-1,Number(m[2])):size-1):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)throw I18n.error("VaultInvalidRange");
  return {start,end,partial:true};
}
class VaultStore{
  constructor({music,settings,commit,listPublic,purge,notify=()=>{},port,trash,lyricsBridge=null,onLock=()=>{}}){
    Object.assign(this,{music,settings,commit,listPublic,purge,notify,port,trash,lyricsBridge,onLock});
    this.indexFile=path.join(music,'.pulsedeck-vault-index.json');
    this.index=readJson(this.indexFile,{v:1,vaults:{},groups:{},objects:{},publicRefs:{},hidden:{},retired:{},deleted:{}});
    if(this.index.v!==1)throw I18n.error("VaultUnsupportedProtectedPlaylistIndex");
    for(const key of ['vaults','groups','objects','publicRefs','hidden','retired','deleted'])this.index[key] ||= {};
    this.sessions=new Map();this.tokens=new Map();this.tokenKeys=new Map();this.streams=new Set();this.activeGroup='';this.activeKey='';this.tail=Promise.resolve();
  }
  exclusive(fn){const p=this.tail.then(fn);this.tail=p.catch(()=>{});return p;}
  relative(file){const rel=path.relative(this.music,file);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw I18n.error("VaultInvalidPath");return rel.replaceAll('\\','/');}
  full(rel){const out=path.resolve(this.music,rel);this.relative(out);return out;}
  hidden(rel){return !!this.index.hidden[crypto.createHash('sha256').update(L.token(rel)).digest('hex')];}
  markHidden(rel,id){const hash=crypto.createHash('sha256').update(L.token(rel)).digest('hex');this.index.hidden[hash]=id;this.index.retired[hash]=true;}
  isPrivateReference(rel){if(this.hidden(rel))return true;const hash=crypto.createHash('sha256').update(L.token(rel)).digest('hex');if(!this.index.retired[hash])return false;try{return !fs.existsSync(this.full(rel));}catch{return true;}}
  unhide(rel){delete this.index.hidden[crypto.createHash('sha256').update(L.token(rel)).digest('hex')];}
  descriptor(key){const d=this.index.vaults[key];if(!d||d.deleted)throw I18n.error("VaultProtectedPlaylistNotFound");return d;}
  file(d,name){return this.full(`${d.folder}/${name}`);}
  async persist(){await C.durableJson(this.indexFile,this.index);this.syncSettings();}
  syncSettings(){
    const protectedPlaylists={};for(const [key,d] of Object.entries(this.index.vaults))if(!d.deleted)protectedPlaylists[key]={id:d.id,name:d.name,folder:d.folder,group:d.group||''};
    // Public registry never contains track metadata, key material or password hashes.
    this.commit({...this.settings(),protectedPlaylists});
  }
  session(key){const d=this.descriptor(key),s=this.sessions.get(d.id);if(!s)throw I18n.error("VaultEnterThePlaylistPasswordFirst");return s;}
  async readManifest(d,key){const sealed=readJson(this.file(d,'playlist.pdv'),null);if(!sealed)throw I18n.error("VaultNoEncryptedSongList");return run('open',sealed,key,`manifest:${d.id}`);}
  async saveManifest(s){await C.durableJson(this.file(s.d,'playlist.pdv'),await run('seal',s.manifest,s.key,`manifest:${s.d.id}`));}
  async authenticate(key,secret,allowDeleted=false){
    const d=allowDeleted?this.index.vaults[key]:this.descriptor(key),header=readJson(this.file(d,'.pulsedeck-vault'),null);
    if(!header||header.id!==d.id)throw I18n.error("VaultNoProtectedPlaylistKey");
    // One shared KDF unlocks key envelopes, not all audio files.
    if(d.group&&this.index.groups[d.group]){
      const g=this.index.groups[d.group];
      try{const values=await run('unwrap',g.wrapped,secret,`group:${d.group}`);if(!values[d.id])throw I18n.error("VaultInvalidGroup");const allowed=new Set(Object.values(this.index.vaults).filter(v=>v.group===d.group&&!v.deleted).map(v=>v.id));return {keys:Object.fromEntries(Object.entries(values).filter(([id])=>allowed.has(id))),group:d.group};}catch{}
    }
    const value=await run('unwrap',header.wrapped,secret,`master:${d.id}`);
    if(!/^[a-f0-9]{64}$/.test(value.master))throw I18n.error("VaultCorruptedKey");
    return {keys:{[d.id]:Buffer.from(value.master,'hex').toString('base64')},group:''};
  }
  lock(){
    this.onLock();
    this.tokens.clear();this.tokenKeys.clear();for(const stream of this.streams)stream.destroy();this.streams.clear();
    // Strings managed by V8 cannot be guaranteed wiped; no persistent session cache.
    this.sessions.clear();this.activeGroup='';this.activeKey='';
  }
  async enter(key){
    const d=this.index.vaults[key];
    if(!d||d.deleted){this.lock();return {locked:false,tracks:[]};}
    if(key!==this.activeKey && !(this.activeGroup&&d.group===this.activeGroup))this.lock();
    this.activeKey=key;
    return this.sessions.has(d.id)?this.list(key):{locked:true,tracks:[],groupSize:d.group?this.index.groups[d.group]?.members.length||1:1};
  }
  async unlock(key,secret){
    const auth=await this.authenticate(key,secret),d=this.descriptor(key);
    this.lock();this.activeKey=key;this.activeGroup=auth.group;
    // Read only the requested manifest. Peers retain keys and read lazily on enter.
    const peers=new Map(Object.values(this.index.vaults).filter(v=>!v.deleted).map(v=>[v.id,v]));
    for(const [id,master]of Object.entries(auth.keys)){
      const peer=peers.get(id);
      if(peer)this.sessions.set(id,{d:peer,key:master,manifest:null});
    }
    const s=this.sessions.get(d.id);s.manifest=await this.readManifest(d,s.key);
    const warnings=await this.finishPending(s);
    return {...await this.list(key),warnings};
  }
  async ready(key){const s=this.session(key);if(!s.manifest)s.manifest=await this.readManifest(s.d,s.key);return s;}
  async list(key){
    const s=await this.ready(key),port=await this.port();
    const tracks=[];
    for(const entry of s.manifest.tracks){
      if(this.index.deleted[entry.id])continue;
      const exported=this.index.publicRefs[entry.id];
      const audioToken=this.issue(s,entry,'audio'),coverToken=entry.cover?this.issue(s,entry,'cover'):'';
      const rel=`vault:${s.d.id}:${entry.id}`;
      tracks.push({...copy(entry.meta),id:`v-${s.d.id}-${entry.id}`,rel,vaultKey:key,vaultId:s.d.id,
        publicCopy:!!exported,favorite:key==='favorite'||(!!exported&&(this.settings().favorites||[]).includes(L.token(exported.rel))),coverUrl:coverToken?`http://127.0.0.1:${port}/vault/${coverToken}`:'',
        audioUrl:`http://127.0.0.1:${port}/vault/${audioToken}`});
    }
    return {locked:false,tracks,order:s.manifest.order||null,archived:s.manifest.archived?.length||0,groupSize:this.activeGroup?Object.keys(this.index.groups[this.activeGroup]?.members||{}).length:1};
  }
  issue(s,entry,kind){
    // Refresh of a view reuses its capabilities instead of leaking thousands of tokens.
    const identity=`${s.d.id}:${entry.id}:${kind}`,existing=this.tokenKeys.get(identity);
    if(existing&&this.tokens.get(existing)?.s===s){this.tokens.get(existing).entry=entry;return existing;}
    if(existing)this.tokens.delete(existing);
    const token=crypto.randomBytes(32).toString('hex');this.tokens.set(token,{s,entry,kind});this.tokenKeys.set(identity,token);return token;
  }
  async playback(rel){const {s,entry}=await this.lookup(rel);return {rel,audioUrl:`http://127.0.0.1:${await this.port()}/vault/${this.issue(s,entry,'audio')}`};}
  async lookup(rel){const m=/^vault:([a-f0-9]{32}):([a-f0-9]{32})$/.exec(rel||'');if(!m)throw I18n.error("VaultInvalidProtectedTrack");
    const s=this.sessions.get(m[1]);if(!s)throw I18n.error("LyricsPlaylistLocked");
    if(!s.manifest)s.manifest=await this.readManifest(s.d,s.key);
    const entry=s.manifest.tracks.find(t=>t.id===m[2]);if(!entry||this.index.deleted[entry.id])throw I18n.error("VaultTrackIsNoLongerAvailable");return {s,entry};}
  async serve(req,res){
    const token=(req.url||'').split('/')[2],cap=this.tokens.get(token);
    if(!cap||!this.sessions.has(cap.s.d.id)||!['GET','HEAD'].includes(req.method)||this.index.deleted[cap.entry.id]){res.writeHead(404,{'Cache-Control':'no-store'});res.end();return;}
    if(req.headers.origin&&req.headers.origin!=='null'){res.writeHead(403);res.end();return;}
    const {entry,kind}=cap,desc=kind==='cover'?entry.cover:entry.blob;
    const exported=kind==='audio'?this.index.publicRefs[entry.id]:null;
    const file=exported?this.full(exported.rel):this.full(this.index.objects[desc.id]?.file||'');
    const size=exported?(await fsp.stat(file)).size:desc.size;
    let r;try{r=range(req.headers.range,size);}catch{res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}
    const type=kind==='cover'?(entry.coverType||'image/jpeg'):({MP3:'audio/mpeg',M4A:'audio/mp4',MP4:'audio/mp4',M4B:'audio/mp4',WAV:'audio/wav',FLAC:'audio/flac',OGG:'audio/ogg',OPUS:'audio/ogg',WEBM:'audio/webm',AAC:'audio/aac'}[entry.meta.ext]||'application/octet-stream');
    res.writeHead(r.partial?206:200,{'Content-Type':type,'Content-Length':Math.max(0,r.end-r.start+1),'Accept-Ranges':'bytes','Cache-Control':'no-store','Pragma':'no-cache','Access-Control-Allow-Origin':'null','X-Content-Type-Options':'nosniff',...(r.partial?{'Content-Range':`bytes ${r.start}-${r.end}/${size}`}:{})});
    if(req.method==='HEAD'){res.end();return;}
    const stream=exported?fs.createReadStream(file,{start:r.start,end:r.end}):Readable.from(C.chunks(file,desc,desc.key,r.start,r.end));
    this.streams.add(stream);res.once('close',()=>stream.destroy());
    try{await pipeline(stream,res);}finally{this.streams.delete(stream);}
  }
  async create(key,name,secret){
    C.password(secret);if(this.index.vaults[key]&&!this.index.vaults[key].deleted)throw I18n.error("VaultPlaylistIsAlreadyProtected");
    const id=random(),d={id,name:String(name||I18n.t("UIPlaylist")),folder:`${filename(name)} [${id.slice(0,8)}]`};
    const master=crypto.randomBytes(32),keyString=master.toString('base64');
    const wrapped=await run('wrap',{master:master.toString('hex')},secret,`master:${id}`);master.fill(0);
    const s={d,key:keyString,manifest:{v:1,tracks:[],archived:[]}};
    await fsp.mkdir(this.full(d.folder),{recursive:false});
    await C.durableJson(this.file(d,'.pulsedeck-vault'),{v:1,id,wrapped});await this.saveManifest(s);
    this.index.vaults[key]=d;await this.persist();this.sessions.set(id,s);return s;
  }
  async finishPending(s){
    const warnings=[];let changed=false;
    for(const entry of [...s.manifest.tracks,...(s.manifest.archived||[])]){
      if(!entry.pendingRel)continue;
      try{
        // The verified encrypted file + encrypted manifest were both committed first.
        // Purge references before releasing scanner exclusion; retry safely on unlock.
        const object=this.index.objects[entry.blob.id];
        if(!object)throw I18n.error("VaultNoVerifiedEncryptedCopy");
        await run('verifyFile',this.full(object.file),entry.blob);
        if(this.lyricsBridge&&!entry.lyricsMigrated){
          await this.lyricsBridge.capture({...entry.meta,rel:entry.pendingRel},entry);await this.saveManifest(s);
        }
        await this.purge([entry.pendingRel],entry.coverSource?[entry.coverSource]:[],entry);
        if(fs.existsSync(this.full(entry.pendingRel)))await run('verifySource',this.full(entry.pendingRel),entry.blob);
        for(const rel of [entry.pendingRel,entry.pendingRel+'.pulse.json',entry.pendingRel+'.info.json',entry.pendingRel.slice(0,-path.extname(entry.pendingRel).length)+'.info.json'])await fsp.unlink(this.full(rel)).catch(e=>{if(e.code!=='ENOENT')throw e;});
        this.unhide(entry.pendingRel);delete entry.pendingRel;delete entry.coverSource;changed=true;
      }catch{warnings.push(I18n.t("VaultTransferIsIncompleteTheSourceFileIsBusy"));}
    }
    if(changed)await this.saveManifest(s);await this.persist();return [...new Set(warnings)];
  }
  async ingest(key,tracks,secret){
    // Even adding to an unlocked destination verifies a password supplied for this action.
    const auth=await this.authenticate(key,secret),d=this.descriptor(key);
    const s=this.sessions.get(d.id)||{d,key:auth.keys[d.id],manifest:null};
    if(!s.manifest)s.manifest=await this.readManifest(d,s.key);this.sessions.set(d.id,s);
    let added=0;const warnings=[];
    for(const track of tracks){
      if(track.rel.startsWith('vault:'))throw I18n.error("VaultUseSecureAddingForProtectedTracks");
      if(s.manifest.tracks.some(e=>L.token(e.originalRel)===L.token(track.rel)&&!this.index.publicRefs[e.id]))continue;
      const id=random(),file=this.file(d,`${id}.pda`);
      const blob=await run('encryptFile',this.full(track.rel),file,id);
      const entry={id,blob,originalRel:track.rel,pendingRel:track.rel,meta:copy(track)};
      if(this.lyricsBridge)await this.lyricsBridge.capture(track,entry);
      for(const field of ['rel','audioUrl','coverUrl','favorite'])delete entry.meta[field];
      if(track.coverUrl?.startsWith('file:')){
        const coverFile=fileURLToPath(track.coverUrl),cid=random();
        try{
          entry.cover=await run('encryptFile',coverFile,this.file(d,`${cid}.pda`),cid);
          entry.coverType=path.extname(coverFile).toLowerCase()==='.png'?'image/png':'image/jpeg';entry.coverSource=coverFile;
          this.index.objects[cid]={file:this.relative(this.file(d,`${cid}.pda`)),refs:[d.id]};
        }catch{warnings.push(I18n.t("VaultCouldNotSaveASeparateCoverForOne"));}
      }
      for(const [oldId,ref]of Object.entries(this.index.publicRefs))if(L.token(ref.rel)===L.token(track.rel)){this.index.deleted[oldId]=true;delete this.index.publicRefs[oldId];}
      s.manifest.tracks.push(entry);
      this.index.objects[id]={file:this.relative(file),refs:[d.id]};this.markHidden(track.rel,d.id);
      // Journal inside manifest; a failure here leaves the original untouched.
      await this.saveManifest(s);await this.persist();
      warnings.push(...await this.finishPending(s));added++;
    }
    this.notify();return {added,warnings:[...new Set(warnings)]};
  }
  async protect(key,name,secret){
    const publicTracks=await this.listPublic();const tracks=publicTracks.filter(L.membershipPredicate(this.settings(),key));
    if(!L.categories(publicTracks,this.settings(),true).some(c=>c.key===key))throw I18n.error("VaultPlaylistNotFound");
    await this.create(key,name,secret);return this.ingest(key,tracks,secret);
  }
  async authorizedEntries(sourceKey,rels,secret){
    const auth=await this.authenticate(sourceKey,secret),d=this.descriptor(sourceKey);
    const s=this.sessions.get(d.id)||{d,key:auth.keys[d.id],manifest:null};
    if(!s.manifest)s.manifest=await this.readManifest(d,s.key);this.sessions.set(d.id,s);
    const unique=[...new Set(rels)],prefix=`vault:${d.id}:`;
    const selected=unique.map(rel=>{if(!rel.startsWith(prefix))throw I18n.error("VaultMixedPrivateSourcesAreNotAllowed");return s.manifest.tracks.find(t=>t.id===rel.slice(prefix.length)&&!this.index.deleted[t.id]);});
    if(!selected.length||selected.some(e=>!e))throw I18n.error("VaultRefreshYourSelection");return {s,entries:selected};
  }
  async addFromPrivate(sourceKey,rels,targetKey,sourcePassword,targetPassword){
    if(!L.categories(await this.listPublic(),this.settings(),true).some(c=>c.key===targetKey))throw I18n.error("VaultDestinationPlaylistNoLongerExists");
    const {entries}=await this.authorizedEntries(sourceKey,rels,sourcePassword);
    if(sourceKey===targetKey)return {added:0};
    if(this.index.vaults[targetKey]&&!this.index.vaults[targetKey].deleted){
      const auth=await this.authenticate(targetKey,targetPassword),d=this.descriptor(targetKey);
      const target=this.sessions.get(d.id)||{d,key:auth.keys[d.id],manifest:null};
      if(!target.manifest)target.manifest=await this.readManifest(d,target.key);
      let added=0;
      for(const entry of entries){
        if(target.manifest.tracks.some(e=>e.id===entry.id))continue;
        target.manifest.tracks.push(copy(entry));added++;
        for(const blob of [entry.blob,entry.cover].filter(Boolean))if(this.index.objects[blob.id])this.index.objects[blob.id].refs=[...new Set([...this.index.objects[blob.id].refs,d.id])];
      }
      await this.saveManifest(target);await this.persist();this.sessions.set(d.id,target);return {added};
    }
    const exported=await this.exportEntries(entries);
    const tracks=await this.listPublic();const result=L.bulkAdd(this.settings(),tracks,targetKey,exported);
    this.commit(result.settings);this.notify();return {added:result.added,exported:exported.length};
  }
  async exportEntries(entries){
    const rels=[];
    for(const entry of entries){
      const existing=this.index.publicRefs[entry.id];
      if(existing&&fs.existsSync(this.full(existing.rel))){rels.push(existing.rel);continue;}
      const original=audioName(entry.originalRel,entry.meta);
      const ext=path.extname(original),base=original.slice(0,original.length-ext.length);let rel=original,n=2;
      while(fs.existsSync(this.full(rel)))rel=`${base} (${n++})${ext}`;
      const object=this.index.objects[entry.blob.id];if(!object)throw I18n.error("VaultEncryptedFileNotFound");
      await run('decryptFile',this.full(object.file),this.full(rel),entry.blob);
      // Clear output is intentional and explicitly confirmed; failed sidecar write
      // does not delete ciphertext or destroy the only recoverable source.
      let coverPath='';
      if(entry.cover&&this.index.objects[entry.cover.id]){coverPath=this.full(path.basename(rel,path.extname(rel))+'.'+random().slice(0,6)+(entry.coverType==='image/png'?'.png':'.jpg'));await run('decryptFile',this.full(this.index.objects[entry.cover.id].file),coverPath,entry.cover);}
      await C.durableJson(this.full(rel+'.pulse.json'),{coverPath,title:entry.meta.title,artist:entry.meta.artist,album:entry.meta.album,genre:entry.meta.genre,duration:entry.meta.duration,sourceUrl:entry.meta.sourceUrl,downloaded:entry.meta.downloaded,_pulseTrackId:entry.meta.id,_pulseAddedAt:entry.meta.addedAt});
      if(this.lyricsBridge)await this.lyricsBridge.exportPublic(entry);
      this.index.publicRefs[entry.id]={rel};await this.persist();
      await fsp.unlink(this.full(object.file));delete this.index.objects[entry.blob.id];await this.persist();rels.push(rel);
    }
    return rels;
  }
  async retirePublicReferences(rels){
    const removed=new Set(rels.map(L.token));let changed=false;
    for(const [id,entry]of Object.entries(this.index.publicRefs))if(removed.has(L.token(entry.rel))){this.index.deleted[id]=true;delete this.index.publicRefs[id];changed=true;}
    if(changed){await this.persist();this.tokens.clear();this.tokenKeys.clear();}
  }
  async remove(key,rels,secret,{erase=false}={}){
    const {s,entries}=await this.authorizedEntries(key,rels,secret),ids=new Set(entries.map(e=>e.id));
    if(erase){
      // Keep encrypted file keys/metadata BEFORE Trash so restoring ciphertext is
      // recoverable with the personal password, even after interruption.
      s.manifest.trashed ||= [];const recorded=new Set(s.manifest.trashed.map(e=>e.id));
      s.manifest.trashed.push(...entries.filter(e=>!recorded.has(e.id)).map(copy));await this.saveManifest(s);
      const removed=new Set(),failed=[];
      for(const entry of entries){
        try{
          const exposed=this.index.publicRefs[entry.id],obj=this.index.objects[entry.blob.id];
          if(exposed){await this.trash(this.full(exposed.rel));await this.purge([exposed.rel],[]);await fsp.unlink(this.full(exposed.rel+'.pulse.json')).catch(()=>{});delete this.index.publicRefs[entry.id];}
          else if(obj){await this.trash(this.full(obj.file));delete this.index.objects[entry.blob.id];}
          this.index.deleted[entry.id]=true;await this.persist();removed.add(entry.id);
        }catch(e){failed.push({id:entry.id,message:I18n.t("VaultCouldNotMoveTheFileToTheRecycle")});}
      }
      s.manifest.tracks=s.manifest.tracks.filter(e=>!removed.has(e.id));await this.saveManifest(s);this.tokens.clear();this.tokenKeys.clear();
      return {removed:removed.size,failed};
    }else{s.manifest.archived ||= [];s.manifest.archived.push(...entries);}
    s.manifest.tracks=s.manifest.tracks.filter(e=>!ids.has(e.id));await this.saveManifest(s);await this.persist();return {removed:entries.length};
  }
  async restoreRemoved(key,secret){
    const auth=await this.authenticate(key,secret),d=this.descriptor(key);
    if(!this.sessions.has(d.id))this.sessions.set(d.id,{d,key:auth.keys[d.id],manifest:null});const s=await this.ready(key);
    const existing=new Set(s.manifest.tracks.map(t=>t.id));for(const e of s.manifest.archived||[])if(!existing.has(e.id)&&!this.index.deleted[e.id])s.manifest.tracks.push(e);
    s.manifest.archived=[];await this.saveManifest(s);return {ok:true};
  }
  async unprotect(key,secret){
    const d=this.descriptor(key),auth=await this.authenticate(key,secret),s=this.sessions.get(d.id)||{d,key:auth.keys[d.id],manifest:null};
    if(!s.manifest)s.manifest=await this.readManifest(d,s.key);
    const rels=await this.exportEntries([...s.manifest.tracks,...(s.manifest.archived||[])].filter(e=>!this.index.deleted[e.id]));
    d.deleted=true;delete d.group;await this.persist();
    // Keep only encrypted metadata as a recoverable archive. No second audio copy.
    const next=this.settings();L.addTracks(next,key,rels);this.commit(next);this.lock();this.notify();return {exported:rels.length};
  }
  async link(keys,passwords,secret){
    C.password(secret);const wanted=[...new Set(keys||[])];if(wanted.length<2)throw I18n.error("VaultSelectAtLeastTwoProtectedPlaylists");
    const masters={};
    for(const key of wanted){const d=this.descriptor(key),auth=await this.authenticate(key,passwords[key]);masters[d.id]=auth.keys[d.id];}
    const id=random(),wrapped=await run('wrap',masters,secret,`group:${id}`);
    this.index.groups[id]={members:wanted,wrapped};for(const key of wanted)this.index.vaults[key].group=id;
    // A replaced access group no longer grants entry through the UI. Original
    // individual passwords still open their own playlist (documented recovery).
    for(const [gid,g]of Object.entries(this.index.groups))if(gid!==id&&!Object.values(this.index.vaults).some(d=>d.group===gid))delete this.index.groups[gid];
    await this.persist();this.lock();return {count:wanted.length};
  }
  archives(){return Object.entries(this.index.vaults).filter(([key,d])=>d.deleted).map(([key,d])=>({key,name:d.name}));}
  async restoreArchive(key,secret){
    const d=this.index.vaults[key];if(!d?.deleted)throw I18n.error("VaultArchiveNotFound");
    await this.authenticate(key,secret,true);d.deleted=false;
    const next=this.settings();
    if(key.startsWith('custom:')&&!next.customCategories.some(c=>c.id===key))next.customCategories.push({id:key,name:d.name,tracks:[],icon:'pi:star',hidden:false});
    else next.categoryStyles[key]={...(next.categoryStyles[key]||{}),deleted:false,hidden:false};
    this.commit(next);await this.persist();return {ok:true};
  }
  async deletePlaylists(keys,passwords){
    for(const key of keys)if(this.index.vaults[key]&&!this.index.vaults[key].deleted)await this.authenticate(key,passwords[key]);
    for(const key of keys)if(this.index.vaults[key])this.index.vaults[key].deleted=true;
    await this.persist();this.lock();return {ok:true};
  }
}
module.exports={VaultStore,filename,audioName,range};
