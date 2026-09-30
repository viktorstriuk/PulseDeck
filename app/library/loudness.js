'use strict';
const {spawn}=require('node:child_process');
const fs=require('node:fs'),crypto=require('node:crypto');
const {JsonSettingsStore}=require('../settings-store');
const I18n=require('../i18n');
const VERSION=1;
const key=rel=>crypto.createHash('sha256').update(String(rel).replaceAll('\\','/').toLowerCase()).digest('hex');
const signature=t=>`${VERSION}:${t.size}:${t.modifiedAt}:${t.changedAt}`;
function parseSummary(stderr){
  // Frame logs also contain I:. Only accept the final integrated-loudness summary.
  const summary=String(stderr).slice(String(stderr).lastIndexOf('Summary:'));
  const match=/Integrated loudness:\s*I:\s*(-?(?:\d+(?:\.\d+)?|inf))\s+LUFS/i.exec(summary);
  if(!match)return null;const value=Number(match[1]);
  return match[1].toLowerCase()==='-inf'?-120:Number.isFinite(value)?Math.max(-120,Math.min(20,value)):null;
}
function measure(input,{ffmpeg,signal,timeoutMs=45000}={}){
  // Production callers must supply the managed component; never search PATH.
  if(!ffmpeg)return Promise.reject(I18n.error('LoudnessMissingComponent'));
  return new Promise((resolve,reject)=>{
    let child,done=false,stderr='',timer;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(child?.exitCode===null&&!child.killed)child.kill();error?reject(error):resolve(value);};
    const abort=()=>finish(I18n.error('LoudnessCancelled'));
    if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
    try{
      child=spawn(ffmpeg,['-hide_banner','-nostdin','-loglevel','info','-protocol_whitelist','file,http,tcp,pipe',
        '-t','10','-i',input,'-map','0:a:0','-vn','-sn','-dn',
        '-af','atrim=duration=10,asetpts=PTS-STARTPTS,ebur128=framelog=verbose','-f','null','-'],
        {windowsHide:true,stdio:['ignore','ignore','pipe']});
      timer=setTimeout(()=>finish(I18n.error('LoudnessTimedOut')),timeoutMs);timer.unref?.();
      child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-65536);});
      child.stderr.on('error',()=>finish(I18n.error('LoudnessReadFailed')));
      child.once('error',e=>finish(I18n.error(e.code==='ENOENT'?'LoudnessMissingComponent':'LoudnessReadFailed')));
      child.once('close',code=>{const value=parseSummary(stderr);finish(code!==0||value===null?I18n.error('LoudnessReadFailed'):null,value);});
    }catch(e){finish(e);}
  });
}
class LoudnessStore{
  constructor({file,resolve,ffmpeg,playback,privateValid=()=>true,onProgress=()=>{}}){
    Object.assign(this,{resolve,ffmpeg,playback,privateValid,onProgress});this.generation=0;this.controllers=new Set();
    this.store=new JsonSettingsStore({file,defaults:{v:VERSION,entries:{}},normalize:raw=>({v:VERSION,entries:raw?.v===VERSION&&raw.entries&&typeof raw.entries==='object'?Object.fromEntries(Object.entries(raw.entries).filter(([k,v])=>/^[a-f0-9]{64}$/.test(k)&&typeof v?.signature==='string'&&typeof v?.value==='number'&&Number.isFinite(v.value)).slice(-20000)):{}})});
    this.memory=new Map();this.entries=this.store.get().entries;
  }
  peek(track){const entry=track.rel?.startsWith('vault:')?this.memory.get(track.rel):this.entries[key(track.rel)];return entry?.signature===signature(track)?entry.value:null;}
  cancel(clearPrivate=false){this.generation++;for(const c of this.controllers)c.abort();this.controllers.clear();if(clearPrivate)this.memory.clear();}
  forget(rels){const current=this.store.get();for(const rel of rels){delete current.entries[key(rel)];this.memory.delete(rel);}this.entries=this.store.set(current).entries;}
  async analyze(rels,requestId=''){
    this.cancel();const generation=this.generation,exe=this.ffmpeg();if(!exe)throw I18n.error('LoudnessMissingComponent');
    const requested=[...new Set((Array.isArray(rels)?rels:[]).filter(r=>typeof r==='string'&&r.length<4000))];
    if(requested.length>20000)throw I18n.error('LoudnessTooMany');
    const results=[];let cursor=0,finished=0;const pending={};
    const worker=async()=>{while(cursor<requested.length&&generation===this.generation){
      const rel=requested[cursor++],controller=new AbortController();this.controllers.add(controller);
      try{
        const r=await this.resolve(rel);if(generation!==this.generation)break;
        const isPrivate=!!r.entry,stat=isPrivate?null:await fs.promises.stat(r.file);
        const track={...r.track,rel,...(stat?{size:stat.size,modifiedAt:stat.mtimeMs,changedAt:stat.ctimeMs}:{modifiedAt:r.entry.blob.sha256,changedAt:VERSION,size:r.entry.blob.size})};
        const cached=isPrivate?this.memory.get(rel):this.entries[key(rel)];
        let value=cached?.signature===signature(track)?cached.value:null;
        if(value===null)value=await measure(isPrivate?(await this.playback(rel)).audioUrl:r.file,{ffmpeg:exe,signal:controller.signal});
        if(generation!==this.generation)break;
        if(isPrivate&&!this.privateValid(r))throw I18n.error('LyricsPlaylistLocked');
        if(!isPrivate){const after=await fs.promises.stat(r.file);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs)throw I18n.error('TrackChanged');pending[key(rel)]={signature:signature(track),value};}
        else this.memory.set(rel,{signature:signature(track),value});
        results.push({rel,value});
      }catch(error){if(generation!==this.generation)break;results.push({rel,value:null,error:I18n.errorMessage(error)});}
      finally{this.controllers.delete(controller);}
      finished++;this.onProgress({requestId,finished,total:requested.length});
    }};
    await Promise.all([worker(),worker()]);
    if(generation!==this.generation)return {cancelled:true,results:[]};
    // Durable once per batch, no slow synchronous disk write per audio frame.
    if(Object.keys(pending).length){const current=this.store.get();this.entries=this.store.set({...current,entries:{...current.entries,...pending}}).entries;}
    return {cancelled:false,results};
  }
}
module.exports={LoudnessStore,measure,parseSummary,signature};
