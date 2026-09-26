'use strict';
const fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const S=require('./security'),T=require('./transport');
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(temp,file);}
function read(file,fallback={}){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
class UpdateManager extends EventEmitter {
  constructor({config,current,profile,cache,platform=process.platform,arch=process.arch,transport=T,clock=Date.now,guard=async()=>[],install=async()=>{throw S.fail('UPDATE_INSTALL_UNAVAILABLE');}}) {
    super();Object.assign(this,{config,current,profile,cache,platform,arch,transport,clock,guard,install});
    fs.mkdirSync(cache,{recursive:true});this.file=path.join(profile,'updates.json');const stored=read(this.file);
    this.prefs={automatic:stored.automatic!==false,prerelease:stored.prerelease===true,components:stored.components!==false,lastCheck:Number(stored.lastCheck)||0,lastAttempt:Number(stored.lastAttempt)||0};
    this.channel=this.prefs.prerelease?'beta':'stable';this.controller=null;this.checkPromise=null;this.timer=null;this.manifest=null;this.envelope=null;this.failures=0;this.downloadPromise=null;this.installing=false;
    this.state={phase:S.ready(config)?'idle':'unconfigured',current,available:'',progress:0,error:'',lastCheck:this.prefs.lastCheck,configured:S.ready(config),repository:S.repoURL(config),channel:this.channel,prefs:{...this.prefs},pendingMode:stored.pending?.mode||''};
    this.pending=stored.pending||null;
  }
  snapshot(){return JSON.parse(JSON.stringify({...this.state,prefs:this.prefs}));}
  emitState(patch={}){Object.assign(this.state,patch);this.emit('changed',this.snapshot());return this.snapshot();}
  persist(){atomic(this.file,{...this.prefs,pending:this.pending});}
  configure(patch={}){
    if(this.controller||this.installing)throw S.fail('UPDATE_BUSY');
    for(const k of ['automatic','prerelease','components'])if(typeof patch[k]==='boolean')this.prefs[k]=patch[k];
    const channel=this.prefs.prerelease?'beta':'stable';
    if(channel!==this.channel){this.channel=channel;this.manifest=null;this.envelope=null;this.pending=null;this.emitState({phase:S.ready(this.config)?'idle':'unconfigured',available:'',notes:{},pendingMode:'',channel});}
    this.persist();this.schedule();return this.emitState();
  }
  schedule(){clearTimeout(this.timer);if(!this.prefs.automatic||!S.ready(this.config))return;
    const interval=(this.config.checkIntervalHours||12)*3600000;const backoff=Math.min(4,Math.max(1,2**Math.min(this.failures,2)));const delay=Math.max(15000,interval*backoff-(this.clock()-this.prefs.lastAttempt));
    this.timer=setTimeout(()=>{this.check(false).catch(()=>{}).finally(()=>this.schedule());},delay);this.timer.unref?.();
  }
  async check(manual=true){
    if(!S.ready(this.config))return this.emitState({phase:'unconfigured',error:'',configured:false});
    if(this.platform!=='win32'||this.arch!=='x64')return this.emitState({phase:'unsupported',error:'UPDATE_UNSUPPORTED'});
    if(this.pending||this.installing)return this.snapshot();if(this.controller && !this.checkPromise)return this.snapshot();if(this.checkPromise)return this.checkPromise;
    if(!manual && (!this.prefs.automatic||this.clock()-this.prefs.lastAttempt<(this.config.checkIntervalHours||12)*3600000))return this.snapshot();
    // Explicit requests are coalesced and rate-limited as well, never flood the GitHub API.
    if(manual && this.clock()-this.prefs.lastAttempt<30000 && this.prefs.lastAttempt)return this.snapshot();
    this.prefs.lastAttempt=this.clock();this.persist();this.controller=new AbortController();this.emitState({phase:'checking',error:''});
    this.checkPromise=(async()=>{
      try{
        const envelope=await this.transport.fetchFeed(this.config,this.channel,'application',{signal:this.controller.signal});
        const m=S.applicationManifest(S.verifyEnvelope(envelope,this.config),this.config,{current:this.current,channel:this.channel,platform:this.platform,arch:this.arch});
        this.prefs.lastCheck=this.clock();this.failures=0;this.persist();this.emit('checked',{channel:this.channel});this.manifest=m;this.envelope=Buffer.from(envelope).toString('base64');
        return this.emitState({phase:m.newer?'available':'current',available:m.newer?m.version:'',notes:m.notes,lastCheck:this.prefs.lastCheck,error:''});
      }catch(e){this.failures++;return this.emitState({phase:e.name==='AbortError'?'idle':'error',error:e.name==='AbortError'?'':e.code||'UPDATE_NETWORK_ERROR'});}
      finally{this.controller=null;this.checkPromise=null;}
    })();return this.checkPromise;
  }
  async download(mode='ready'){
    if(!['ready','restart','next-launch'].includes(mode))throw S.fail('UPDATE_INVALID_MODE');
    if(this.downloadPromise)return this.downloadPromise;
    if(!this.manifest?.newer || !this.envelope)throw S.fail('UPDATE_NOT_AVAILABLE');
    if(this.controller||this.installing)throw S.fail('UPDATE_BUSY');
    const manifest=this.manifest,envelope=this.envelope;
    this.controller=new AbortController();this.emitState({phase:'downloading',progress:0,error:'',pendingMode:mode});
    this.downloadPromise=(async()=>{
      const target=path.join(this.cache,`PulseDeck-${manifest.version}.exe`);
      try{
        await this.transport.download(manifest.file,target,{config:this.config,signal:this.controller.signal,onProgress:p=>this.emitState({progress:p.percent,received:p.received,total:p.total})});
        if(this.controller.signal.aborted)throw S.fail('UPDATE_CANCELLED');
        this.pending={mode,version:manifest.version,envelope,file:path.basename(target),repository:S.repoURL(this.config)};this.persist();this.emitState({phase:'ready',progress:100,pendingMode:mode});
      }catch(e){this.pending=null;this.persist();this.emitState({phase:e.name==='AbortError'||e.code==='UPDATE_CANCELLED'?'available':'error',error:e.name==='AbortError'||e.code==='UPDATE_CANCELLED'?'':e.code||'UPDATE_DOWNLOAD_FAILED'});}
      finally{this.controller=null;this.downloadPromise=null;}
      if(this.pending && mode==='restart')await this.apply();return this.snapshot();
    })();return this.downloadPromise;
  }
  cancel(){if(this.state.phase==='downloading'||this.state.phase==='checking')this.controller?.abort();}
  async validatePending(){
    const p=this.pending;if(!p || !S.ready(this.config) || p.repository!==S.repoURL(this.config))throw S.fail('UPDATE_PENDING_INVALID');
    const m=S.applicationManifest(S.verifyEnvelope(Buffer.from(p.envelope,'base64'),this.config),this.config,{current:this.current,channel:this.channel,platform:this.platform,arch:this.arch});
    if(!m.newer||p.version!==m.version||p.file!==`PulseDeck-${m.version}.exe`)throw S.fail('UPDATE_PENDING_INVALID');
    const full=path.join(this.cache,p.file),st=await fs.promises.lstat(full);
    if(!st.isFile()||st.isSymbolicLink()||st.size!==m.file.size||await this.transport.sha256(full)!==m.file.sha256)throw S.fail('UPDATE_HASH_MISMATCH');
    return {full,manifest:m};
  }
  async restore(){
    if(!this.pending)return this.snapshot();
    try{const {manifest}=await this.validatePending();this.manifest=manifest;this.envelope=this.pending.envelope;return this.emitState({phase:'ready',available:manifest.version,notes:manifest.notes,progress:100,pendingMode:this.pending.mode});}
    catch{this.pending=null;this.persist();return this.emitState({phase:S.ready(this.config)?'idle':'unconfigured',pendingMode:''});}
  }
  async defer(mode='next-launch'){if(!this.pending)throw S.fail('UPDATE_NOT_AVAILABLE');if(!['next-launch','ready'].includes(mode))throw S.fail('UPDATE_INVALID_MODE');this.pending.mode=mode;this.persist();return this.emitState({pendingMode:mode});}
  async apply({startup=false}={}){
    if(this.installing)return this.snapshot();this.installing=true;
    try{
      const {full,manifest}=await this.validatePending();const blockers=await this.guard({startup});
      if(blockers.length)return this.emitState({phase:'ready',error:'UPDATE_WORK_IN_PROGRESS',blockers});
      this.emitState({phase:'installing',error:'',blockers:[]});
      // Validate again after renderer acknowledgement: never run a replaced cached file.
      await this.validatePending();await this.install(full,manifest);
      return this.snapshot();
    }catch(e){return this.emitState({phase:this.pending?'ready':'error',error:e.code||'UPDATE_INSTALL_FAILED'});}
    finally{this.installing=false;}
  }
  async onStartup({failed=false}={}){await this.restore();if(failed&&this.pending){this.pending.mode='ready';this.persist();this.emitState({phase:'ready',pendingMode:'ready',error:'UPDATE_INSTALL_FAILED'});}if(!failed&&this.pending?.mode==='next-launch')await this.apply({startup:true});this.schedule();return this.snapshot();}
  close(){clearTimeout(this.timer);this.controller?.abort();}
}
module.exports={UpdateManager,atomic,read};
