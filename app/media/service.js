'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const I18n=require('../i18n'),M=require('../shared/media'),Analysis=require('./analysis'),{execute}=require('./process');
const {durableJson}=require('../vault/crypto');
/** Privileged, token-based media service. Renderer requests contain IDs, never
 * executable names, output paths, protocol allowlists or FFmpeg arguments. */
class MediaService{
  constructor(options){Object.assign(this,options);this.jobs=new Map();this.running=0;this.waiters=[];this.prepared=new Map();this.profiles=new Map();this.pending=new Map();this.epoch=0;this.root=path.join(this.data,'media-staging');this.cacheFile=path.join(this.data,'audio-profiles.json');this.cacheTail=Promise.resolve();this.ready=this.initialize();}
  async initialize(){
    await fsp.mkdir(this.root,{recursive:true});const st=await fsp.lstat(this.root);if(st.isSymbolicLink()||!st.isDirectory())throw I18n.error('MediaInvalid');
    for(const name of await fsp.readdir(this.root))if(/^[a-f0-9-]{36}$/.test(name)){const p=path.join(this.root,name);const s=await fsp.lstat(p);if(s.isDirectory()&&!s.isSymbolicLink())await fsp.rm(p,{recursive:true,force:true,maxRetries:5,retryDelay:150});}
    try{const st=await fsp.stat(this.cacheFile);if(st.size<512*1024){const c=JSON.parse(await fsp.readFile(this.cacheFile,'utf8'));if(c.version===1)for(const [id,p]of Object.entries(c.profiles||{}))if(/^[a-f0-9]{64}$/.test(id)&&M.profile(p))this.profiles.set(id,p);}}catch{}
  }
  tool(name){const exe=this.components().resolve(name+'.exe');if(!exe)throw I18n.error('MediaComponents');return exe;}
  async operation(command,fn){
    await this.ready;const id=String(command.requestId||crypto.randomUUID());if(!/^[\w-]{1,100}$/.test(id)||this.jobs.has(id))throw I18n.error('MediaInvalid');
    if(this.jobs.size>=18)throw I18n.error('MediaBusy');
    const controller=new AbortController(),job={controller,token:command.token,epoch:this.epoch,id,private:String(command.rel||'').startsWith('vault:')};job.finished=new Promise(resolve=>job.finish=resolve);this.jobs.set(id,job);this.busy?.(true);
    const progress=(phase,percent)=>{if(!controller.signal.aborted)this.progress?.({requestId:id,phase,percent});};
    try{await this.acquire(controller.signal);job.acquired=true;if(controller.signal.aborted)throw I18n.error('MediaCancelled');progress('working',0);const r=await fn(job,progress);if(controller.signal.aborted||job.epoch!==this.epoch)throw I18n.error('MediaCancelled');return r;}
    finally{if(job.acquired){this.running--;this.waiters.shift()?.();}this.jobs.delete(id);job.finish();this.busy?.(false);}
  }
  async acquire(signal){
    if(this.running<2){this.running++;return;}
    await new Promise((resolve,reject)=>{const start=()=>{signal.removeEventListener('abort',abort);this.running++;resolve();},abort=()=>{const index=this.waiters.indexOf(start);if(index>=0)this.waiters.splice(index,1);reject(I18n.error('MediaCancelled'));};this.waiters.push(start);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
  }
  async input(rel){const r=await this.lyrics().resolve(rel);const input=r.entry?(await this.vault().playback(rel)).audioUrl:r.file;return {r,input};}
  validateSession(r,epoch){if(epoch!==this.epoch||(r?.entry&&this.vault().sessions.get(r.s.d.id)!==r.s))throw I18n.error('MediaCancelled');}
  async profile(command){
    await this.ready;const {r,input}=await this.input(command.rel),epoch=this.epoch;
    if(!r.entry&&this.profiles.has(r.recordingId))return this.profiles.get(r.recordingId);
    if(this.pending.has(command.rel))return this.pending.get(command.rel);
    const promise=this.operation(command,async job=>{
      if(r.track.duration>1800)throw I18n.error('MediaDuration');
      const p=await Analysis.loudness(input,{ffmpeg:this.tool('ffmpeg'),signal:job.controller.signal});this.validateSession(r,epoch);
      if(!r.entry&&p){
        if(await this.lyrics().fingerprint(r.file)!==r.recordingId)throw I18n.error('TrackChanged');
        if(this.profiles.size>=256)this.profiles.delete(this.profiles.keys().next().value);this.profiles.set(r.recordingId,p);
        this.cacheTail=this.cacheTail.catch(()=>{}).then(()=>durableJson(this.cacheFile,{version:1,profiles:Object.fromEntries(this.profiles)}));await this.cacheTail;
      }
      return p;
    });this.pending.set(command.rel,promise);try{return await promise;}finally{this.pending.delete(command.rel);}
  }
  async search(command){
    if(command.consent!==true)throw I18n.error('EnrichConsent');
    return this.operation(command,async job=>{
      let track=null;if(command.rel)track=(await this.lyrics().resolve(command.rel)).track;
      const query=String(command.query||[track?.artist,track?.title,'official music video'].filter(Boolean).join(' ')).trim().slice(0,400);
      if(!query)throw I18n.error('MediaInvalid');this.tool('yt-dlp');
      const page=await this.extractor().fallback({provider:'youtube',query,cursor:command.cursor,signal:job.controller.signal});
      const items=(page?.items||[]).filter(x=>M.youtube(x.url)&&!x.is_live).map(x=>({url:M.youtube(x.url),title:String(x.title||'').slice(0,300),artist:String(x.uploader||x.channel||'').slice(0,200),duration:Number(x.duration)||0,thumbnail:/^https:\/\//.test(x.thumbnail||'')?x.thumbnail:''}));
      return {items,cursor:page?.cursor||null};
    });
  }
  async probe(file,signal){
    const raw=await execute(this.tool('ffprobe'),['-v','error','-protocol_whitelist','file','-format_whitelist','mov,matroska,webm','-show_entries','format=duration:stream=codec_type,codec_name','-of','json',file],{signal,timeout:20000});let p;try{p=JSON.parse(raw.stdout);}catch{throw I18n.error('MediaInvalid');}
    const duration=Number(p.format?.duration);if(!p.streams?.some(x=>x.codec_type==='video')||!p.streams.some(x=>x.codec_type==='audio'))throw I18n.error('MediaNoAudioVideo');
    if(!Number.isFinite(duration)||duration<=0||duration>1800)throw I18n.error('MediaDuration');return {duration};
  }
  token(value){const item=this.prepared.get(value);if(!item||item.epoch!==this.epoch)throw I18n.error('MediaExpired');item.touched=Date.now();return item;}
  async prepare(command){
    const url=M.youtube(command.url);if(!url||command.consent!==true)throw I18n.error('MediaInvalid');
    return this.operation(command,async(job,progress)=>{
      // A fresh request cannot accumulate unbounded, forgotten multi-GB sources.
      if(this.prepared.size+[...this.jobs.values()].filter(j=>j.preparing).length>=3)throw I18n.error('MediaCloseEditors');
      // Reserve a slot before the first await: parallel downloads must not
      // both claim the last slot. operation() removes failed/cancelled jobs.
      job.preparing=true;
      if(command.rel)await this.lyrics().resolve(command.rel);
      const ffmpeg=this.tool('ffmpeg'),ytdlp=this.tool('yt-dlp'),id=crypto.randomUUID(),dir=path.join(this.root,id);await fsp.mkdir(dir,{recursive:false});
      const controller=job.controller,signal=controller.signal;
      let committed=false;
      try{
        const opts=await this.extractor().environment(url);
        const info=await this.extractor().inspect(url,{signal});
        if(!info||info.is_live||info.duration>1800||!(info.duration>0))throw I18n.error('MediaDuration');
        progress('download',0);
        await execute(ytdlp,[...opts.args,'--no-playlist','--no-warnings','--socket-timeout','15','--retries','2','--max-filesize','2G','--no-mtime','--restrict-filenames','--newline','--progress','--progress-template','download:%(progress._percent_str)s','--ffmpeg-location',path.dirname(ffmpeg),'-f','bv[height<=1080][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[height<=1080][ext=mp4]/b[height<=720]','--merge-output-format','mp4','-o',path.join(dir,'source.%(ext)s'),'--',url],{signal,env:opts.env,timeout:900000,onStderr:text=>{const n=/([\d.]+)%/.exec(text);if(n)progress('download',Math.min(99,Number(n[1])));}});
        const candidates=(await fsp.readdir(dir)).filter(n=>/^source\.(mp4|webm|mkv)$/.test(n));if(candidates.length!==1)throw I18n.error('MediaInvalid');
        let file=path.join(dir,candidates[0]);const st=await fsp.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>2*1024**3)throw I18n.error('MediaTooLarge');
        const meta=await this.probe(file,signal);progress('analysis',0);
        // MP4 H.264/AAC is selected above for immediate Chromium preview. Saved
        // clips are explicitly transcoded to a self-contained VP9/Opus WebM.
        const profile=await Analysis.loudness(file,{ffmpeg,signal});
        if(signal.aborted||job.epoch!==this.epoch)throw I18n.error('MediaCancelled');
        const token=crypto.randomBytes(24).toString('hex');
        this.prepared.set(token,{dir,file,url,duration:meta.duration,profile,epoch:this.epoch,private:job.private,touched:Date.now()});committed=true;job.preparing=false;
        progress('ready',100);return {token,url:pathToFileURL(file).href,sourceUrl:url,duration:meta.duration,profile,title:String(info.title||'').slice(0,300)};
      }finally{if(!committed)await fsp.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:150});}
    });
  }
  async autoSync(command){
    return this.operation(command,async(job,progress)=>{
      const item=this.token(command.token),{r,input}=await this.input(command.rel);progress('sync',0);
      const result=await Analysis.synchronize(input,item.file,{ffmpeg:this.tool('ffmpeg'),signal:job.controller.signal});this.validateSession(r,job.epoch);progress('sync',100);return result;
    });
  }
  async save(command){
    return this.operation(command,async(job,progress)=>{
      const item=this.token(command.token),r=await this.lyrics().resolve(command.rel),cut=M.trim(command.start,command.end,item.duration),mapping=M.sync(command);
      const record=await this.lyrics().get(command.rel);
      if(record.musicVideo&&command.replace!==true)throw I18n.error('MediaAlreadyExists');
      if((command.revision??null)!==(record.revision??null))throw I18n.error('LyricsAnotherActionHasChangedTheAppearanceReopenThe');
      const file=path.join(item.dir,crypto.randomUUID()+'.webm'),signal=job.controller.signal,ffmpeg=this.tool('ffmpeg');
      try{
        progress('encode',0);
        await execute(ffmpeg,[...Analysis.INPUT,'-loglevel','error','-ss',String(cut.start),'-i',item.file,'-t',String(cut.duration),'-map','0:v:0','-map','0:a:0','-sn','-dn','-map_metadata','-1','-vf',"scale='trunc(min(1920,iw)/2)*2':-2",'-c:v','libvpx-vp9','-crf','31','-b:v','0','-deadline','realtime','-cpu-used','6','-row-mt','1','-threads','2','-c:a','libopus','-b:a','160k','-f','webm',file],{signal,timeout:1800000});
        const meta=await this.probe(file,signal),profile=await Analysis.loudness(file,{ffmpeg,signal});this.validateSession(r,job.epoch);
        const result=await this.vault().exclusive(async()=>{
          this.validateSession(r,job.epoch);
          return this.lyrics().setMusicVideo({rel:command.rel,revision:command.revision,file,asBackground:command.asBackground===true,info:{...mapping,offset:mapping.offset-cut.start,duration:meta.duration,sourceUrl:item.url,profile}});
        });progress('saved',100);return result;
      }finally{await fsp.unlink(file).catch(()=>{});}
    });
  }
  async release(token){const item=this.prepared.get(token);if(!item)return true;this.prepared.delete(token);const users=[...this.jobs.values()].filter(job=>job.token===token);for(const job of users)job.controller.abort();await Promise.all(users.map(job=>job.finished));await fsp.rm(item.dir,{recursive:true,force:true,maxRetries:5,retryDelay:150});return true;}
  async command(c){
    if(!c||typeof c!=='object')throw I18n.error('MediaInvalid');
    switch(c.action){
      case 'profile':return this.profile(c);
      case 'preview-profile':return this.operation(c,job=>Analysis.loudness(this.previewInput(c.previewId),{ffmpeg:this.tool('ffmpeg'),signal:job.controller.signal,seconds:20}));
      case 'info':return this.lyrics().get(c.rel);
      case 'search':return this.search(c);
      case 'prepare':return this.prepare(c);
      case 'sync':return this.autoSync(c);
      case 'save':return this.save(c);
      case 'edit':return this.vault().exclusive(()=>this.lyrics().updateMusicVideo(c));
      case 'release':return this.release(c.token);
      case 'cancel':this.jobs.get(String(c.requestId))?.controller.abort();return true;
      case 'background-select':{
        if(c.consent!==true)throw I18n.error('EnrichConsent');
        return this.operation(c,async job=>{
          await this.lyrics().resolve(c.rel);const bytes=await this.coverSearch().download(c.id,{signal:job.controller.signal}),dir=path.join(this.root,crypto.randomUUID());await fsp.mkdir(dir);
          try{const file=path.join(dir,'background.png');await fsp.writeFile(file,await this.normalizeCover(bytes),{flag:'wx'});if(job.controller.signal.aborted)throw I18n.error('MediaCancelled');return await this.vault().exclusive(()=>this.lyrics().setBackground({rel:c.rel,revision:c.revision,file}));}
          finally{await fsp.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:150});}
        });
      }
      default:throw I18n.error('MediaInvalid');
    }
  }
  lock(){this.epoch++;for(const job of this.jobs.values())job.controller.abort();for(const token of this.prepared.keys())this.release(token).catch(()=>{});this.pending.clear();}
  dispose(){this.lock();}
}
module.exports={MediaService};
