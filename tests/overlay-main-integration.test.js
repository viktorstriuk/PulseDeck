'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {OverlayHostTransport}=require('../app/game-overlay/transport');
const {harness}=require('./main-harness');
const tick=()=>new Promise(r=>setImmediate(r));
class Helper extends EventEmitter {
  constructor(){super();this.pid=101;this.exitCode=null;this.signalCode=null;this.killed=false;this.writes=[];
    this.stdin=new EventEmitter();Object.assign(this.stdin,{writable:true,destroyed:false,writableEnded:false,
      write:(line,cb)=>{this.writes.push(JSON.parse(line));cb();return true},end:()=>{this.stdin.writableEnded=true;queueMicrotask(()=>this.close(0))},destroy:()=>{this.stdin.destroyed=true;this.stdin.emit('close')}});
    this.stdout=new EventEmitter();this.stderr=new EventEmitter();this.stdout.setEncoding=this.stderr.setEncoding=()=>{};
  }
  hello(){this.stdout.emit('data',JSON.stringify({type:'hello',pid:101,version:'2.6.5',backends:['rtss','window']})+'\n')}
  close(code){if(this.exitCode!==null)return;this.exitCode=code;this.emit('exit',code,null);this.emit('close',code,null)}
  kill(){this.killed=true;this.close(2);return true}
}
function setup(overrides={}){
  const children=[],logs=[];
  class Transport extends OverlayHostTransport {constructor(opts){super({...opts,exists:()=>true,spawn:()=>{const c=new Helper();children.push(c);return c},stopMs:1,retryDelays:[]})}}
  const h=harness({requireOverrides:{'./game-overlay/transport':{OverlayHostTransport:Transport,createDiagnosticLog:()=>e=>logs.push(e)},...overrides}});
  h.main.getNativeWindowHandle=()=>Buffer.from('3412000000000000','hex');h.overlay.getNativeWindowHandle=()=>Buffer.from('7856000000000000','hex');
  h.app.isReady=()=>true;
  const settings=c=>h.api.saveSettings({gameOverlay:c},{skipEffects:true});
  const close=()=>{h.api.stopGameOverlayHost();for(const c of children)c.close(0);h.close()};
  return {h,children,logs,settings,close};
}

test('Main hello replays current handles, settings, song and cover-derived colors',async()=>{
  const f=setup();try{
    f.settings({mode:'auto',rtssAnchor:'bottom-right'});
    await f.h.invoke('overlay:state',{title:'Actual song',playing:true,currentTime:24});
    f.h.send('gameOverlay:visual',{color1:'#112233',color2:'#abcdef'},f.h.main.webContents);
    await f.h.api.applyGameOverlayConfiguration();const c=f.children[0];assert.equal(c.writes.length,0);c.hello();
    const latest=type=>c.writes.filter(x=>x.type===type).at(-1);
    assert.equal(latest('bind').mainHwnd,'0x1234');assert.equal(latest('bind').overlayHwnd,'0x5678');
    assert.equal(latest('config').rtssAnchor,'bottom-right');assert.equal(latest('state').state.title,'Actual song');assert.equal(latest('visual').color1,'#112233');
    assert.equal((await f.h.invoke('gameOverlay:status')).hostVersion,'2.6.5');
  }finally{f.close()}
});
test('Main EPIPE path leaves normal player visible, audio frames and controls operational',async()=>{
  const f=setup();try{
    f.settings({mode:'auto'});await f.h.api.applyGameOverlayConfiguration();const c=f.children[0];c.hello();
    f.h.send('overlay:audio-frame',{freq:[1],wave:[2]});c.stdin.emit('error',Object.assign(new Error('write EPIPE'),{code:'EPIPE'}));
    const before=f.h.overlay.messages.length;f.h.send('overlay:audio-frame',{freq:[3],wave:[4]});
    assert.equal(f.h.overlay.messages.length,before+1);assert.equal(f.h.overlay.messages.at(-1).name,'overlay:audio-frame');assert.equal(f.h.overlay.visible,true);
    f.h.send('overlay:control',{action:'playPause'});assert.equal(f.h.main.messages.at(-1).name,'hotkey:action');
    assert.equal((await f.h.invoke('gameOverlay:status')).active,false);assert.equal(f.logs.filter(x=>x.event==='failure').length,1);
  }finally{f.close()}
});
test('Restart rebinds CURRENT state, not old song/colors/handles',async()=>{
  const f=setup();try{
    f.settings({mode:'auto'});await f.h.api.applyGameOverlayConfiguration();f.children[0].hello();
    await f.h.invoke('gameOverlay:restartHost');
    await f.h.invoke('overlay:state',{title:'New song',playing:false});
    f.h.send('gameOverlay:visual',{color1:'#aa2211',color2:'#ffcc44'});
    f.h.overlay.getNativeWindowHandle=()=>Buffer.from('9922000000000000','hex');
    await tick();assert.equal(f.children.length,2);const c=f.children[1];c.hello();
    assert.equal(c.writes.find(x=>x.type==='bind').overlayHwnd,'0x2299');assert.equal(c.writes.find(x=>x.type==='state').state.title,'New song');assert.equal(c.writes.find(x=>x.type==='visual').color1,'#aa2211');
  }finally{f.close()}
});
test('Off/window modes do not run or restart the helper and ignore stale native status',async()=>{
  for(const mode of ['off','window']){
    const f=setup();try{f.settings({mode});await f.h.api.applyGameOverlayConfiguration();assert.equal(f.children.length,0);assert.equal(await f.h.invoke('gameOverlay:restartHost'),false);
      f.h.api.handleGameOverlayHostMessage({type:'status',active:true,renderer:'rtss'});assert.equal((await f.h.invoke('gameOverlay:status')).active,false);
    }finally{f.close()}
  }
});
test('Changing auto to Windows mode stops helper without hiding the ordinary overlay',async()=>{
  const f=setup();try{
    f.settings({mode:'auto'});await f.h.api.applyGameOverlayConfiguration();f.children[0].hello();
    f.settings({mode:'window'});await f.h.api.applyGameOverlayConfiguration();await tick();
    assert.equal(f.h.overlay.visible,true);assert.equal(f.children[0].writes.at(-1).type,'stop');assert.equal((await f.h.invoke('gameOverlay:status')).running,false);
  }finally{f.close()}
});
test('Shutdown prevents both explicit restart and stale hello replay',async()=>{
  const f=setup();try{
    f.settings({mode:'auto'});await f.h.api.applyGameOverlayConfiguration();const c=f.children[0];
    f.h.api.quitting(true);f.h.api.stopGameOverlayHost();c.hello();
    assert.equal(await f.h.invoke('gameOverlay:restartHost'),false);assert.equal(f.h.api.startGameOverlayHost(),false);assert.ok(c.writes.every(x=>x.type==='stop'));
  }finally{f.close()}
});
test('Destroyed renderer during native status publication is contained',async()=>{
  const f=setup();try{
    f.h.main.webContents.send=()=>{throw Error('Object has been destroyed')};f.settings({mode:'auto'});
    await assert.doesNotReject(f.h.api.applyGameOverlayConfiguration());assert.doesNotThrow(()=>f.children[0].hello());
  }finally{f.close()}
});
test('Launch RTSS reports asynchronous spawn rejection instead of uncaught error',async()=>{
  const child=new EventEmitter();child.unref=()=>{};
  const f=setup({'child_process':{...require('child_process'),spawn:()=>{queueMicrotask(()=>child.emit('error',Object.assign(Error('Blocked by Windows'),{code:'EACCES'})));return child}}});
  try{
    const dir=path.join(f.h.temp,'programs');fs.mkdirSync(path.join(dir,'RivaTuner Statistics Server'),{recursive:true});fs.writeFileSync(path.join(dir,'RivaTuner Statistics Server','RTSS.exe'),'fixture');f.h.context.process.env.ProgramFiles=dir;
    const result=await f.h.invoke('gameOverlay:launchRtss');assert.equal(result.ok,false);assert.match(result.reason,/Blocked/);assert.equal((await f.h.invoke('gameOverlay:status')).lastError,'EACCES');
  }finally{f.close()}
});
