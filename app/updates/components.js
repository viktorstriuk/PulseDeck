'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{EventEmitter}=require('node:events');
const S=require('./security'),T=require('./transport'),{atomic,read}=require('./manager'),{extractTools}=require('./zip');
const IDS=['ffmpeg','ytdlp'],BINARIES={ffmpeg:['ffmpeg.exe','ffprobe.exe'],ytdlp:['yt-dlp.exe']};
const Upstream=require('./upstream-components');
function localPath(root,file){
  const base=path.resolve(root),relative=path.relative(base,path.resolve(file));if(relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))return false;
  let current=base;for(const part of ['',...relative.split(path.sep).filter(Boolean)]){if(part)current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())return false;}catch(e){if(e.code!=='ENOENT')return false;}}return true;
}
function localBinary(root,file){try{if(!localPath(root,file))return false;const st=fs.lstatSync(file);if(!st.isFile()||st.size<2)return false;const fd=fs.openSync(file,'r'),head=Buffer.alloc(2);try{fs.readSync(fd,head,0,2,0);}finally{fs.closeSync(fd);}return head.toString()==='MZ';}catch{return false;}}

class ComponentManager extends EventEmitter {
  constructor({root,legacy,config,current,transport=T,isBusy=()=>false,probe=async()=>true,platform=process.platform}) {
    super();Object.assign(this,{root,legacy,config,current,transport,isBusy,probe,platform});this.file=path.join(root,'index.json');this.index=read(this.file);this.sequences=read(path.join(root,'catalog-sequences.json'));this.catalog={};this.busy=false;this.controller=null;this.cache=path.join(root,'downloads');if(!localPath(root,this.cache)||!localPath(root,this.file))throw S.fail('COMPONENT_UNSAFE_PATH');fs.mkdirSync(this.cache,{recursive:true});
    this.state={phase:platform==='win32'?'idle':'unsupported',error:'',progress:0,active:'',errors:{}};
  }
  resolve(binary){
    const id=binary==='yt-dlp.exe'?'ytdlp':['ffmpeg.exe','ffprobe.exe'].includes(binary)?'ffmpeg':null;if(!id)return '';
    const active=this.index[id]?.active;
    if(active){
      if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(active))return '';
      const dir=path.join(this.root,id,active);
      // Never combine a new FFmpeg with a legacy FFprobe. An incomplete active
      // version must be repaired instead of being masked by an older tools folder.
      return BINARIES[id].every(name=>localBinary(this.root,path.join(dir,name)))?path.join(dir,binary):'';
    }
    // Compatibility only with tools inside THIS application directory. Never PATH,
    // AppData, another installation, a user-provided executable or a symlink.
    const installRoot=path.dirname(path.resolve(this.root));
    const old=this.legacy&&path.join(this.legacy,binary);return old&&localPath(installRoot,old)&&BINARIES[id].every(name=>localBinary(installRoot,path.join(this.legacy,name)))?old:'';
  }
  installed(id){return !!BINARIES[id]?.every(name=>this.resolve(name));}
  signedCatalog(){return this.config.componentsMode!=='publishers'&&S.ready(this.config)&&typeof this.config.componentsAsset==='string'&&!!this.config.componentsAsset.trim();}
  snapshot(){return {...this.state,directory:this.root,source:this.signedCatalog()?'signed':'publishers',items:IDS.map(id=>({id,version:this.index[id]?.active||'',legacy:!this.index[id]?.active&&this.installed(id),available:this.catalog[id]?.version||'',rollback:!!this.index[id]?.previous,installed:this.installed(id),error:this.state.errors?.[id]||''}))};}
  emitState(p={}){Object.assign(this.state,p);this.emit('changed',this.snapshot());return this.snapshot();}
  async check(channel='stable'){
    if(this.platform!=='win32')return this.emitState({phase:'unsupported',error:''});if(this.busy)return this.snapshot();if(!this.signedCatalog())return this.checkPublishers();
    this.busy=true;this.controller=new AbortController();this.emitState({phase:'checking',error:''});
    try{
      const envelope=await this.transport.fetchFeed(this.config,channel,'components',{signal:this.controller.signal}),m=S.verifyEnvelope(envelope,this.config);
      if(!Number.isSafeInteger(m.sequence)||m.sequence<1||m.sequence<(this.sequences[channel]||0))throw S.fail('COMPONENT_OLD_CATALOG');
      if(m.kind!=='components'||m.platform!=='win32'||m.arch!=='x64'||m.channel!==channel||!Array.isArray(m.components)||m.components.length>2)throw S.fail('COMPONENT_BAD_CATALOG');
      const catalog={};for(const c of m.components){if(!IDS.includes(c.id)||catalog[c.id]||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(c.version||''))throw S.fail('COMPONENT_BAD_CATALOG');if(c.minimumVersion&&S.compare(this.current,c.minimumVersion)<0)continue;
        if(c.id==='ffmpeg'&&c.format!=='zip'||c.id==='ytdlp'&&c.format!=='exe')throw S.fail('COMPONENT_BAD_CATALOG');
        if(c.version!==this.index[c.id]?.active||!this.installed(c.id))catalog[c.id]={...c,file:S.fileSpec(c.file,this.config,{component:true}),envelope:Buffer.from(envelope).toString('base64')};}
      this.sequences[channel]=m.sequence;atomic(path.join(this.root,'catalog-sequences.json'),this.sequences);this.catalog=catalog;return this.emitState({phase:'current',error:''});
    }catch(e){return this.emitState({phase:'error',error:e.code||'UPDATE_NETWORK_ERROR'});}finally{this.busy=false;this.controller=null;}
  }
  async checkPublishers(){
    this.busy=true;this.controller=new AbortController();this.emitState({phase:'checking',error:'',errors:{}});
    try{
      const results=await Promise.allSettled(IDS.map(id=>Upstream.fetchComponent(id,this.transport,{signal:this.controller.signal}))),errors={},catalog={};
      for(let n=0;n<IDS.length;n++){const id=IDS[n],r=results[n];if(r.status==='rejected'){errors[id]=r.reason?.code||'UPDATE_NETWORK_ERROR';continue;}
        const c=r.value,active=this.index[id]?.active;if(!Upstream.newerOrEqual(c.version,active)){errors[id]='COMPONENT_OLD_CATALOG';continue;}
        if(c.version!==active||!this.installed(id))catalog[id]=c;
      }
      if(this.controller.signal.aborted)return this.emitState({phase:'idle',error:'UPDATE_CANCELLED'});
      // A failed check never removes a still-usable result from the other publisher.
      for(const id of IDS)if(errors[id]&&this.catalog[id])catalog[id]=this.catalog[id];
      this.catalog=catalog;return this.emitState({phase:Object.keys(errors).length?'error':'current',error:Object.values(errors)[0]||'',errors,lastCheck:Date.now()});
    }finally{this.busy=false;this.controller=null;}
  }
  // Bundled pins use the same installer/validator as remotely approved versions.
  async install(id,pin=null){
    if(this.platform!=='win32')throw S.fail('UPDATE_UNSUPPORTED');const provisioning=!!pin&&!this.installed(id);
    if(this.busy||(!provisioning&&this.isBusy()))throw S.fail('COMPONENT_BUSY');
    const c=pin||this.catalog[id];if(!IDS.includes(id)||!c)throw S.fail('COMPONENT_NOT_AVAILABLE');
    if(!pin&&c.origin!=='upstream')S.fileSpec(c.file,this.config,{component:true});else{S.allowedURL(c.file.url,this.config,{component:true});if(!/^[a-f0-9]{64}$/.test(c.file.sha256)||c.file.size<0||c.file.size>536870912||(!c.file.size&&!(c.file.maxSize>0&&c.file.maxSize<=536870912)))throw S.fail('COMPONENT_BAD_CATALOG');}if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(c.version))throw S.fail('COMPONENT_BAD_CATALOG');
    if(!localPath(this.root,path.join(this.root,id,c.version))||!localPath(this.root,this.cache))throw S.fail('COMPONENT_UNSAFE_PATH');
    this.busy=true;this.controller=new AbortController();this.emitState({phase:'downloading',active:id,error:'',progress:0});
    const stage=path.join(this.root,id,'.stage-'+crypto.randomUUID()),archive=path.join(this.cache,`${id}-${c.version}.${c.format}`);
    try{
      await fs.promises.mkdir(stage,{recursive:true});await this.transport.download(c.file,archive,{config:this.config,component:true,signal:this.controller.signal,onProgress:p=>this.emitState({progress:p.percent})});
      if(this.controller.signal.aborted)throw S.fail('UPDATE_CANCELLED');this.emitState({phase:'verifying'});
      if(c.format==='zip')await extractTools(archive,stage);else if(c.format==='exe')await fs.promises.copyFile(archive,path.join(stage,'yt-dlp.exe'));else throw S.fail('COMPONENT_BAD_CATALOG');
      const binaries=BINARIES[id],hashes={};
      for(const binary of binaries){const full=path.join(stage,binary),fd=await fs.promises.open(full,'r');const magic=Buffer.alloc(2);try{await fd.read(magic,0,2,0);}finally{await fd.close();}if(magic.toString()!=='MZ')throw S.fail('COMPONENT_BAD_BINARY');hashes[binary]=await this.transport.sha256(full);await this.probe(full);}
      atomic(path.join(stage,'receipt.json'),{schema:1,id,version:c.version,hashes,source:c.file.url,archiveSha256:c.file.sha256,license:c.license||'',sourceURL:c.sourceURL||'',envelope:c.envelope||null});
      // Switching an active version is deferred while *any* local media job is busy.
      if(this.controller.signal.aborted)throw S.fail('UPDATE_CANCELLED');if(!provisioning&&this.isBusy())throw S.fail('COMPONENT_BUSY');
      const final=path.join(this.root,id,c.version);
      if(fs.existsSync(final)) {
        const receipt=read(path.join(final,'receipt.json'));if(receipt.archiveSha256&&receipt.archiveSha256!==c.file.sha256)throw S.fail('COMPONENT_VERSION_CONFLICT');
        let valid=true;for(const binary of binaries){try{if(!localBinary(this.root,path.join(final,binary))||await this.transport.sha256(path.join(final,binary))!==hashes[binary])valid=false;}catch{valid=false;}}
        if(valid)await fs.promises.rm(stage,{recursive:true,force:true});
        else{const damaged=final+'.damaged-'+crypto.randomUUID();await fs.promises.rename(final,damaged);try{await fs.promises.rename(stage,final);}catch(e){await fs.promises.rename(damaged,final);throw e;}await fs.promises.rm(damaged,{recursive:true,force:true}).catch(()=>{});}
      }else await fs.promises.rename(stage,final);
      const nextIndex={...this.index,[id]:{active:c.version,previous:this.index[id]?.active===c.version?this.index[id]?.previous||null:this.index[id]?.active||null}};atomic(this.file,nextIndex);this.index=nextIndex;delete this.catalog[id];return this.emitState({phase:'current',active:'',progress:100,error:''});
    }catch(e){this.emitState({phase:'error',error:e.name==='AbortError'?'UPDATE_CANCELLED':e.code||'COMPONENT_INSTALL_FAILED'});throw e;}
    finally{this.busy=false;this.controller=null;await fs.promises.rm(stage,{recursive:true,force:true}).catch(()=>{});await fs.promises.unlink(archive).catch(()=>{});}
  }
  async rollback(id){
    if(!IDS.includes(id)||this.busy||this.isBusy())throw S.fail('COMPONENT_BUSY');this.busy=true;
    try{const entry=this.index[id],previous=entry?.previous;if(!previous||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(previous))throw S.fail('COMPONENT_NO_ROLLBACK');
      const dir=path.join(this.root,id,previous);if(!localPath(this.root,dir))throw S.fail('COMPONENT_UNSAFE_PATH');const r=read(path.join(dir,'receipt.json'));if(r.id!==id||r.version!==previous)throw S.fail('COMPONENT_BAD_BINARY');
      for(const name of id==='ffmpeg'?['ffmpeg.exe','ffprobe.exe']:['yt-dlp.exe'])if(await this.transport.sha256(path.join(dir,name))!==r.hashes?.[name])throw S.fail('COMPONENT_BAD_BINARY');
      if(this.isBusy())throw S.fail('COMPONENT_BUSY');const nextIndex={...this.index,[id]:{active:previous,previous:entry.active}};atomic(this.file,nextIndex);this.index=nextIndex;return this.emitState({phase:'current',error:''});
    }finally{this.busy=false;}
  }
  cancel(){this.controller?.abort();}
}
module.exports={ComponentManager,localPath,localBinary};
