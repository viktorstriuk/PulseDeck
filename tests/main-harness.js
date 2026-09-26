'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {EventEmitter}=require('node:events');
const root=path.resolve(__dirname,'..');
function harness(options={}){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pulsedeck-263-'));
  const timers=new Set(),handlers=new Map(),ipc=new EventEmitter();
  const rawHandlers=new Map(), i18n=require('../app/i18n');
  const decode=error=>{throw i18n.fromErrorPacket(i18n.errorPacket(error));};
  ipc.handle=(name,fn)=>{rawHandlers.set(name,fn);handlers.set(name,(...args)=>{
    try {const result=fn(...args);return result?.then ? result.catch(decode) : result;} catch(error){return decode(error);}
  });};
  const app=new EventEmitter();
  Object.assign(app,{setPath(){},setAppUserModelId(){},requestSingleInstanceLock:()=>false,quit(){},isReady:()=>false});
  const clock={now:1000000};
  class ClockDate extends Date {static now(){return clock.now;}}
  const point={x:0,y:0};
  const screen={getCursorScreenPoint:()=>point,getDisplayMatching:()=>({workArea:{x:0,y:0,width:1920,height:1080}})};
  const timer=(fn,ms)=>{const t={fn,ms,unref(){}};timers.add(t);return t;};
  class Window extends EventEmitter {
    constructor(){super();this.visible=true;this.minimized=false;this.bounds={x:100,y:100,width:900,height:250};this.calls=[];this.messages=[];
      this.webContents={send:(name,value)=>this.messages.push({name,value}),getZoomFactor:()=>this.zoom||1};}
    isDestroyed(){return false;}isVisible(){return this.visible;}isMinimized(){return this.minimized;}
    getContentBounds(){return this.bounds;}getBounds(){return this.bounds;}
    setIgnoreMouseEvents(value,options){this.ignore=value;this.calls.push({value,options});}setFocusable(value){this.focusable=value;}
    setResizable(value){this.resizable=value;}setMovable(value){this.movable=value;}
    setBounds(bounds){this.bounds=bounds;}setAlwaysOnTop(){}showInactive(){this.visible=true;}hide(){this.visible=false;}
  }
  const trashed=[],trashFailures=new Set();
  const electron={app,BrowserWindow:Window,ipcMain:ipc,screen,globalShortcut:{},nativeTheme:{},nativeImage:{},dialog:{},shell:{openExternal:async url=>url,trashItem:async file=>{if(trashFailures.has(file))throw Error('File locked');trashed.push(file);fs.renameSync(file,path.join(temp,'trash-'+trashed.length));}}};
  const requireReal=createRequire(path.join(root,'app/main.js'));
  const context=vm.createContext({console,Buffer,URL,URLSearchParams,__dirname:path.join(root,'app'),
    process:{...process,resourcesPath:path.join(temp,'resources'),defaultApp:false,platform:'win32',env:{...process.env,APPDATA:path.join(temp,'profile'),LOCALAPPDATA:path.join(temp,'local'),USERPROFILE:path.join(temp,'home')}},
    require:name=>name==='electron'?electron:(options.requireOverrides?.[name] || requireReal(name)),setTimeout:timer,setInterval:timer,clearTimeout:t=>timers.delete(t),clearInterval:t=>timers.delete(t),Date:ClockDate});
  const source=fs.readFileSync(path.join(root,'app/main.js'),'utf8');
  vm.runInContext(source+`\n globalThis.testApi={getLyrics,getVault,vaultCommand,closeServices(){libraryEnrichment?.dispose();coverSearch?.dispose();libraryImporter?.dispose();searchService?.dispose?.();lyricsStore?.dispose();gameOverlayController?.dispose();vaultStore?.lock();previewServer?.closeAllConnections();previewServer?.close();},scanLibrary,organizeLibrary,getSettings,saveSettings,registerIpc,publishMusicFile,resolveMusicRelative,normalizeSettings,
    updateOverlayInteractivity,currentOverlayPolicy,beginOverlayResize,updateOverlayResize,endOverlayResize,toggleOverlayClickThrough,
    useWindows(main,overlay){mainWindow=main;overlayWindow=overlay;},
    setConfig(config){settingsStore.set({...getSettings(),playerOverlay:{...getSettings().playerOverlay,...config}});overlayRuntimeConfig=null;},
    setPreview(requested,override=null){overlayPreviewRequested=requested;overlayPreviewOverride=override;},
    protect(file){pendingLibraryWrites.add(Library.token(file));},unprotect(file){pendingLibraryWrites.delete(Library.token(file));},
    getGameOverlayController,startGameOverlayHost,stopGameOverlayHost,applyGameOverlayConfiguration,sendGameOverlayCommand,handleGameOverlayHostMessage,pushOverlayState,launchRTSS,
    quitting(value){isQuitting=value;},
    paths:{music:MUSIC_DIR,data:DATA_DIR},polling:()=>!!overlayHitTimer};`,context,{filename:'main.js'});
  const api=context.testApi,main=new Window(),overlay=new Window();api.useWindows(main,overlay);api.registerIpc();
  return {api,app,context,main,overlay,electron,handlers,rawHandlers,ipc,point,clock,timers,temp,trashed,trashFailures,invoke:(name,...args)=>handlers.get(name)({sender:main.webContents},...args),
    send:(name,value,sender=overlay.webContents)=>ipc.emit(name,{sender},value),
    close:()=>{api.closeServices();fs.rmSync(temp,{recursive:true,force:true});}};
}
function trackFile(h,rel,artist='Artist',extra={}){
  const file=path.join(h.api.paths.music,rel);fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,Buffer.from('RIFF0123456789WAVE data stable audio bytes'));
  fs.writeFileSync(file+'.pulse.json',JSON.stringify({artist,title:rel,duration:12,...extra}));
  return file;
}
function tree(dir){
  const crypto=require('node:crypto'),out={};
  function walk(d){for(const name of fs.readdirSync(d).sort()){const p=path.join(d,name),key=path.relative(dir,p).replaceAll('\\','/');
    if(fs.statSync(p).isDirectory()){out[key+'/']='directory';walk(p);}else out[key]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}}
  walk(dir);return out;
}
module.exports={harness,trackFile,tree};
