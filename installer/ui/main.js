'use strict';
const {app,BrowserWindow,ipcMain,screen,nativeTheme}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const args=Object.fromEntries(process.argv.filter(s=>/^--[a-z-]+=/.test(s)).map(s=>{const i=s.indexOf('=');return [s.slice(2,i),s.slice(i+1)];}));
const root=path.resolve(__dirname,'../..'),entry=pathToFileURL(path.join(__dirname,'index.html')).href;
const packageInfo=JSON.parse(fs.readFileSync(path.join(root,'app/package.json'),'utf8'));
const {loadCatalogs}=require('../../app/i18n');
const {choose}=require('../../app/shared/language-choice');
const languageData=loadCatalogs(path.join(root,'app/languages'));
const catalogs=Object.fromEntries(Object.entries(languageData.catalogs).map(([code,catalog])=>[code,catalog.messages]));
let selectedLanguage='en';
let win=null,busy=false,completed='',mode=args['uninstall-target']?'uninstall':'install';
const engine=path.resolve(root,'maintenance.exe'),archive=path.resolve(args['runtime-archive']||''),target=args['uninstall-target']||args.target||path.join(os.homedir(),'AppData','Local','Programs','PulseDeck');
// The engine path is derived from this temporary package, never from an IPC value.
if(args.engine && path.resolve(args.engine)!==engine)throw new Error('SetupErrorIntegrity');
app.setPath('userData',path.join(root,'ui-profile'));app.setAppUserModelId('com.pulsedeck.setup');
function authorized(event){return win && event.sender===win.webContents && (!event.senderFrame || event.senderFrame===win.webContents.mainFrame) && event.sender.getURL()===entry;}
function handle(channel,callback){ipcMain.handle(channel,async(event,...values)=>{if(!authorized(event))throw new Error('SetupErrorGeneric');return callback(...values);});}
function existing(folder){try{return JSON.parse(fs.readFileSync(path.join(folder,'resources/app/package.json'),'utf8')).name==='pulsedeck';}catch{return false;}}
function pathText(value){if(typeof value!=='string'||value.length>2048||/[\0\r\n]/.test(value)||!path.isAbsolute(value)||value.startsWith('\\\\'))throw new Error('SetupErrorPath');return path.resolve(value);}
async function folders(value){const folder=pathText(value);const st=await fs.promises.lstat(folder);if(st.isSymbolicLink()||!st.isDirectory())throw new Error('SetupErrorPath');
 const entries=await fs.promises.readdir(folder,{withFileTypes:true});return {folder,parent:path.dirname(folder),items:entries.filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&!e.name.startsWith('.')).slice(0,500).sort((a,b)=>a.name.localeCompare(b.name)).map(e=>({name:e.name,path:path.join(folder,e.name)}))};}
function emit(value){if(win&&!win.isDestroyed())win.webContents.send('setup:progress',value);}
function execute(request){if(busy)throw new Error('SetupErrorLocked');const folder=pathText(request?.target);if(!fs.existsSync(engine))throw new Error('SetupErrorIntegrity');busy=true;completed='';
 const language=request?.language;if(mode==='install'&&!Object.hasOwn(catalogs,language)){busy=false;throw new Error('SetupErrorLanguage');}const command=['--engine','--target',folder];if(mode==='install')command.push('--language',language);if(mode==='uninstall')command.push('--uninstall');else command.push('--runtime-archive',archive);if(request?.desktop===true && mode==='install')command.push('--desktop');
 return new Promise((resolve)=>{let buffered='',last=null,terminal=false;const child=spawn(engine,command,{windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{buffered+=data;if(buffered.length>1024*1024){child.kill();return;}const lines=buffered.split(/\r?\n/);buffered=lines.pop();for(const line of lines){try{const event=JSON.parse(line);if(typeof event.phase!=='string')continue;last=event;emit(event);}catch{}}});
  child.stderr.on('data',()=>{});
  const finish=(code)=>{if(terminal)return;terminal=true;busy=false;const success=code===0&&['done','removed'].includes(last?.phase);if(success){completed=folder;resolve({ok:true,target:folder});}else{emit({phase:'error',error:last?.error||'SetupErrorGeneric'});resolve({ok:false,error:last?.error||'SetupErrorGeneric'});}};
  child.once('error',()=>finish(1));child.once('exit',finish);
 });}
app.whenReady().then(()=>{
 nativeTheme.themeSource='system';selectedLanguage=choose(languageData.languages,app.getPreferredSystemLanguages(),args.language);
 const area=screen.getPrimaryDisplay().workAreaSize;win=new BrowserWindow({width:Math.min(1020,area.width),height:Math.min(742,area.height),minWidth:760,minHeight:580,frame:false,transparent:true,backgroundColor:'#00000000',resizable:true,maximizable:false,fullscreenable:false,show:false,hasShadow:false,title:'PulseDeck',icon:path.join(root,'app/assets/icon.png'),webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e,url)=>{if(url!==entry)e.preventDefault();});win.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));win.webContents.session.setPermissionCheckHandler(()=>false);
 win.on('close',event=>{if(busy){event.preventDefault();emit({phase:'blocked'});}});win.once('ready-to-show',()=>win.show());
 handle('setup:bootstrap',()=>({version:packageInfo.version,language:selectedLanguage,catalogs,languages:languageData.languages,systemLanguages:app.getPreferredSystemLanguages(),target,mode,existing:existing(target),places:[{key:'SetupHome',path:os.homedir()},{key:'SetupDesktop',path:app.getPath('desktop')},{key:'SetupDocuments',path:app.getPath('documents')},{key:'SetupApplications',path:path.dirname(target)}]}));
 handle('setup:inspect',value=>({existing:existing(pathText(value))}));handle('setup:folders',folders);handle('setup:execute',execute);
 handle('setup:minimize',()=>win.minimize());handle('setup:close',()=>{if(!busy)win.close();return !busy;});
 handle('setup:launch',()=>{if(!completed||busy||mode==='uninstall')return false;const exe=path.join(completed,'PulseDeck.exe');if(!fs.existsSync(exe))return false;const child=spawn(exe,[],{detached:true,windowsHide:true,stdio:'ignore'});return new Promise(resolve=>{child.once('error',()=>resolve(false));child.once('spawn',()=>{child.unref();resolve(true);win.close();});});});
 win.loadURL(entry);
});
app.on('window-all-closed',()=>app.quit());
