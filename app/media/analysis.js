'use strict';
const path=require('node:path');
const {Worker}=require('node:worker_threads');
const {execute}=require('./process');
const I18n=require('../i18n');
const M=require('../shared/media');
const INPUT=['-hide_banner','-nostdin','-protocol_whitelist','file,http,tcp,pipe','-format_whitelist','mp3,mov,matroska,webm,wav,flac,ogg,aac,aiff,ape,asf,ac3,wv,dsf,dff'];
async function loudness(input,{ffmpeg,signal,seconds=1800}={}){
  const r=await execute(ffmpeg,[...INPUT,'-i',input,'-map','0:a:0','-vn','-sn','-dn','-t',String(Math.max(1,Math.min(1800,seconds))),'-af','loudnorm=I=-18:TP=-1:LRA=11:print_format=json','-f','null','-'],{signal,timeout:240000});
  const text=r.stderr,raw=text.slice(text.lastIndexOf('{'),text.lastIndexOf('}')+1);
  let result;try{result=JSON.parse(raw);}catch{throw I18n.error('MediaAnalysisFailed');}
  return M.profile({lufs:Number(result.input_i),peakDB:Number(result.input_tp)});
}
async function pcm(input,{ffmpeg,signal}={}){
  return (await execute(ffmpeg,[...INPUT,'-loglevel','error','-i',input,'-map','0:a:0','-vn','-sn','-dn','-t','1800','-ac','1','-ar','8000','-f','f32le','pipe:1'],{signal,timeout:180000,maxBytes:8000*4*1800+4096})).stdout;
}
async function synchronize(audio,video,options={}){
  // Decode sequentially: bounded memory, no plaintext PCM temporary files.
  const a=await pcm(audio,options),b=await pcm(video,options);
  if(options.signal?.aborted)throw I18n.error('MediaCancelled');
  return new Promise((resolve,reject)=>{
    const aBytes=Uint8Array.from(a).buffer,bBytes=Uint8Array.from(b).buffer;
    let settled=false;
    const worker=new Worker(path.join(__dirname,'sync-worker.js'),{workerData:{a:aBytes,b:bBytes},transferList:[aBytes,bBytes]});
    const finish=(e,v)=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);worker.terminate().catch(()=>{});e?reject(e):resolve(v);};
    const abort=()=>finish(I18n.error('MediaCancelled'));
    const timer=setTimeout(()=>finish(I18n.error('MediaTimeout')),90000);timer.unref?.();
    options.signal?.addEventListener('abort',abort,{once:true});
    if(options.signal?.aborted)abort();
    worker.on('message',m=>m.error?finish(I18n.error('MediaAnalysisFailed')):finish(null,m));
    worker.on('error',e=>finish(e));worker.on('exit',()=>{if(!settled)finish(I18n.error('MediaAnalysisFailed'));});
  });
}
module.exports={loudness,pcm,synchronize,INPUT};
