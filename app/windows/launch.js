'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const tokenFrom=argv=>argv.find(x=>/^--pulsedeck-launch-token=[a-f0-9]{48}$/.test(x))?.split('=')[1]||'';
const launchRoot=(env=process.env)=>path.join(env.LOCALAPPDATA||env.APPDATA||os.tmpdir(),'PulseDeck','launch');
function cleanEnvironment(env=process.env){
 const result={...env};
 for(const name of Object.keys(result))if(['ELECTRON_RUN_AS_NODE','ELECTRON_NO_ASAR','NODE_OPTIONS','NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE'].includes(name.toUpperCase()))delete result[name];
 return result;
}
function signalReady({argv=process.argv,execPath=process.execPath,version,env=process.env}={}){
 const token=tokenFrom(argv);if(!token)return false;
 const directory=launchRoot(env),file=path.join(directory,token+'.json'),temp=file+'.tmp';
 try{fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.writeFileSync(temp,JSON.stringify({token,version,exe:execPath,pid:process.pid}),{flag:'wx',mode:0o600});fs.renameSync(temp,file);return true;}
 catch{return false;}finally{try{fs.unlinkSync(temp);}catch{}}
}
/** Resolve only after a visible PulseDeck window acknowledges startup. A spawn
 * event means CreateProcess succeeded; it does not mean Electron loaded the app.
 * The caller keeps its UI open and can show a retry/report on timeout. */
async function launchInstalled(target,{version,timeoutMs=25000,env=process.env,spawnProcess=spawn}={}){
 const exe=path.join(target,'PulseDeck.exe'),token=crypto.randomBytes(24).toString('hex'),directory=launchRoot(env),file=path.join(directory,token+'.json');
 if(!fs.statSync(exe).isFile())throw new Error('SetupLaunchFailed');
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 let child,spawnError=null,exited=null;
 try{
  child=spawnProcess(exe,['--pulsedeck-launch-token='+token],{cwd:target,env:cleanEnvironment(env),detached:true,windowsHide:false,stdio:'ignore'});
  child.once('error',e=>{spawnError=e;});child.once('exit',(code,signal)=>{exited={code,signal};});child.unref();
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
   if(spawnError)throw spawnError;
   try{
    const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>4096)throw new Error('SetupLaunchFailed');
    const ready=JSON.parse(fs.readFileSync(file,'utf8'));
    if(ready.token===token&&(!version||ready.version===version)&&path.resolve(ready.exe).toLowerCase()===path.resolve(exe).toLowerCase())return {ok:true,pid:ready.pid};
   }catch(e){if(e.code!=='ENOENT')throw e;}
   // Exit(0) can be the expected single-instance handoff; its existing window
   // still has to acknowledge this nonce. Nonzero exits fail immediately.
   if(exited&&exited.code!==0)throw new Error('SetupLaunchFailed: '+String(exited.code??exited.signal));
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('SetupLaunchTimeout');
 }finally{try{fs.unlinkSync(file);}catch{}}
}
module.exports={cleanEnvironment,tokenFrom,launchRoot,signalReady,launchInstalled};
