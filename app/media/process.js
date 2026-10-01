'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
const I18n=require('../i18n');
/** Cancel the owned process tree, including yt-dlp's FFmpeg merger. Killing
 * only yt-dlp can orphan a writer that keeps a Windows staging file locked. */
function terminate(child,{platform=process.platform,env=process.env,spawnProcess=spawn,killGroup=process.kill.bind(process)}={}){
  if(!child)return;
  const kill=()=>{try{child.kill('SIGKILL');}catch{}};
  const pid=Number(child.pid);
  if(!Number.isSafeInteger(pid)||pid<=0){kill();return;}
  if(platform!=='win32'){try{killGroup(-pid,'SIGKILL');}catch{kill();}return;}
  const root=env.SystemRoot||env.WINDIR;
  if(!root||!path.win32.isAbsolute(root)){kill();return;}
  let utility,timer;
  try{
    // Use the OS utility by absolute path, never a PATH-supplied executable.
    // Leave the parent alive until /T has discovered its descendants.
    utility=spawnProcess(path.win32.join(root,'System32','taskkill.exe'),['/PID',String(pid),'/T','/F'],{windowsHide:true,shell:false,stdio:'ignore'});
    utility.once('error',()=>{clearTimeout(timer);kill();});
    utility.once('close',code=>{clearTimeout(timer);if(code!==0)kill();});
    timer=setTimeout(()=>{try{utility.kill('SIGKILL');}catch{}kill();},2000);timer.unref?.();utility.unref?.();
  }catch{kill();}
}
/** Only absolute, managed executables supplied by main are accepted. */
function execute(executable,args,{signal,env,timeout=180000,maxBytes=4*1024*1024,onStderr=()=>{}}={}){
  if(!executable||!path.isAbsolute(executable))return Promise.reject(I18n.error('MediaComponents'));
  return new Promise((resolve,reject)=>{
    let done=false,size=0,stderr='',chunks=[],child,timer,failure=null,killTimer;
    const finish=(e,result)=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);if(e&&child?.exitCode===null)terminate(child);e?reject(e):resolve(result);};
    const stop=e=>{if(done||failure)return;failure=e;if(!child){finish(e);return;}terminate(child);killTimer=setTimeout(()=>finish(e),5000);killTimer.unref?.();};
    const abort=()=>stop(I18n.error('MediaCancelled'));
    if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
    try{child=spawn(executable,args,{env,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});}
    catch(e){finish(e);return;}
    timer=setTimeout(()=>stop(I18n.error('MediaTimeout')),timeout);timer.unref?.();
    child.on('error',e=>finish(e));child.stdout.on('error',e=>stop(e));child.stderr.on('error',e=>stop(e));
    child.stdout.on('data',b=>{size+=b.length;if(size>maxBytes){stop(I18n.error('MediaTooLarge'));return;}if(!failure)chunks.push(b);});
    child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-128*1024);try{onStderr(b.toString());}catch{}});
    child.on('close',code=>{if(failure){finish(failure);return;}if(code!==0){const error=I18n.error('MediaProcessFailed');error.diagnostic=stderr.slice(-8000);finish(error);return;}finish(null,{stdout:Buffer.concat(chunks),stderr});});
  });
}
module.exports={execute,terminate};
