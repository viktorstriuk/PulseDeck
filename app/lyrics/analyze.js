'use strict';
const I18n = require("../i18n");
const {spawn}=require('node:child_process');const {Worker}=require('node:worker_threads');const path=require('node:path');
// Never writes decoded PCM to disk and never downloads a model or sends audio online.
function analyzeAudio(input,{ffmpeg,signal,durationMs=0,onProgress=()=>{}}={}){
  if(durationMs>1800000)return Promise.reject(I18n.error("LyricsAnalysisSupportsSongsUpToMinutesLong"));
  return new Promise((resolve,reject)=>{
    let done=false,decoded=false,pending=0,bytes=0,lastProgress=-1,child,worker,timer;
    const finish=async(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
      if(child&&child.exitCode===null&&!child.killed)child.kill();await worker?.terminate().catch(()=>{});error?reject(error):resolve(value);};
    const cancel=()=>finish(I18n.error("LyricsAnalysisCancelled"));
    if(signal?.aborted){cancel();return;}signal?.addEventListener('abort',cancel,{once:true});
    try{worker=new Worker(path.join(__dirname,'analysis-worker.js'),{workerData:{language:I18n.language}});
      child=spawn(ffmpeg||'ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file,http,tcp,pipe','-i',input,'-vn','-sn','-dn','-t','1801','-ac','1','-ar','16000','-f','f32le','pipe:1'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
      timer=setTimeout(()=>finish(I18n.error("LyricsAnalysisTimedOutTheOriginalTimestampsWerePreserved")),180000);timer.unref?.();
      const maybeEnd=()=>{if(decoded&&pending===0&&!done)worker.postMessage({end:true});};
      child.on('error',e=>finish(Error(e.code==='ENOENT'?I18n.t("LyricsFFmpegWasNotFoundInstallTheFullPulseDeck"):I18n.t("LyricsCouldNotStartAudioAnalysis"))));
      child.stdout.on('error',()=>finish(I18n.error("LyricsAnalysisStreamWasInterrupted")));child.stderr.on('error',()=>{});child.stderr.on('data',()=>{});
      child.stdout.on('data',chunk=>{if(done)return;bytes+=chunk.length;if(bytes>16000*4*1801){finish(I18n.error("LyricsRecordingIsTooLongToAnalyse"));return;}
        child.stdout.pause();pending++;const transfer=Uint8Array.from(chunk).buffer;worker.postMessage({bytes:transfer},[transfer]);});
      worker.on('message',m=>{if(done)return;if(m.error){finish(m.errorInfo?I18n.fromErrorPacket(m.errorInfo):Error(m.error));return;}if(m.result){finish(null,m.result);return;}
        if(m.ack){pending--;const progress=durationMs>0?Math.min(99,Math.floor(m.at/durationMs*100)):0;if(progress!==lastProgress){lastProgress=progress;try{onProgress(progress);}catch{}}if(!decoded)child.stdout.resume();maybeEnd();}});
      worker.once('error',()=>finish(I18n.error("LyricsAudioAnalysisStopped")));worker.once('exit',code=>{if(!done)finish(I18n.error("AudioAnalysisEndedEarly",{code}));});
      child.once('close',code=>{if(done)return;if(code!==0){finish(I18n.error("LyricsCouldNotDecodeTheAudioTheOriginalFile"));return;}decoded=true;maybeEnd();});
    }catch(error){finish(error);}
  });
}
module.exports={analyzeAudio};
