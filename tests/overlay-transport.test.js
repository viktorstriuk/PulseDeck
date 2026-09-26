'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter, once} = require('node:events');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {OverlayHostTransport, createDiagnosticLog, MAX_LINE_BYTES} = require('../app/game-overlay/transport');

class Clock {
  constructor(){this.time=0;this.id=0;this.tasks=new Map();}
  now=()=>this.time;
  setTimeout=(fn,ms)=>{const id=++this.id;this.tasks.set(id,{fn,at:this.time+ms});return id;};
  clearTimeout=id=>this.tasks.delete(id);
  tick(ms){const until=this.time+ms;for(let n=0;n<10000;n++){const next=[...this.tasks].filter(([,v])=>v.at<=until).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!next)break;this.time=next[1].at;this.tasks.delete(next[0]);next[1].fn();if(n===9999)throw Error('timer loop');}this.time=until;}
}
class Stream extends EventEmitter {
  constructor(){super();this.writable=true;this.destroyed=false;this.writableEnded=false;this.writableFinished=false;this.calls=[];this.callbacks=[];this.accept=true;this.sync=false;this.throws=null;}
  setEncoding(){}
  write(line,cb){if(this.throws)throw this.throws;this.calls.push(JSON.parse(line));this.callbacks.push(cb);if(this.sync)this.complete();return this.accept;}
  complete(error){const cb=this.callbacks.shift();assert.ok(cb,'expected pending write');cb(error);}
  end(){this.writableEnded=true;this.writableFinished=true;this.writable=false;this.emit('finish');}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.writable=false;this.emit('close');}
}
let nextPid=1000;
class Child extends EventEmitter {
  constructor(){super();this.pid=++nextPid;this.killed=false;this.exitCode=null;this.signalCode=null;this.stdin=new Stream();this.stdout=new Stream();this.stderr=new Stream();this.killCalls=0;}
  hello(){this.stdout.emit('data',JSON.stringify({type:'hello',version:'2.6.5',pid:this.pid})+'\n');}
  close(code=0,signal=null){this.exitCode=code;this.signalCode=signal;this.emit('exit',code,signal);this.emit('close',code,signal);}
  kill(){this.killCalls++;this.killed=true;this.close(null,'SIGTERM');return true;}
}
function fixture(extra={}){
  const clock=new Clock(),children=[],statuses=[],messages=[],logs=[];
  const t=new OverlayHostTransport({executable:'helper.exe',platform:'win32',exists:()=>true,clock,
    spawn:()=>{const c=new Child();children.push(c);return c;},onMessage:m=>messages.push(m),onStatus:s=>statuses.push(s),log:e=>logs.push(e),...extra});
  return {t,clock,children,statuses,messages,logs};
}
function ep(code='EPIPE'){return Object.assign(new Error('channel closed'),{code});}
function begin(extra){const f=fixture(extra);assert.equal(f.t.start(),true);f.c=f.children[0];f.c.hello();return f;}

for(const channel of ['stdin','stdout','stderr','process'])test(`All ${channel} asynchronous errors are handled locally, not as uncaught exceptions`,()=>{
  const f=begin();assert.doesNotThrow(()=> (channel==='process'?f.c:f.c[channel]).emit('error',ep()));
  assert.equal(f.t.snapshot().failures,1);assert.equal(f.t.send({type:'audio',freq:[1]}),false);
  f.clock.tick(0);assert.equal(f.c.killCalls,1);assert.equal(f.t.session,null);
  assert.ok(f.statuses.some(s=>s.active===false&&s.renderer==='none'));f.t.dispose();
});
test('Write callback EPIPE plus stream error and process exit counts exactly one failure',()=>{
  const f=begin();f.t.send({type:'audio',freq:[1]});f.c.stdin.complete(ep());f.c.stdin.emit('error',ep());f.c.close(2);
  assert.equal(f.t.snapshot().failures,1);assert.equal(f.t.retryCount,1);assert.equal(f.t.session,null);
  f.clock.tick(500);assert.equal(f.children.length,2);f.t.dispose();f.clock.tick(350);
});
test('Synchronous write throws are also handled without a global exception handler',()=>{
  const f=begin();f.c.stdin.throws=ep('ERR_STREAM_DESTROYED');assert.equal(f.t.send({type:'state',state:{}}),false);
  assert.equal(f.t.snapshot().failures,1);f.t.dispose();f.clock.tick(350);
});
test('Only hello enables writes; split UTF-8 JSON/status and unknown lines are tolerated',()=>{
  const f=fixture();f.t.start();const c=f.children[0];f.t.send({type:'bind',overlayHwnd:'0xff'});assert.equal(c.stdin.calls.length,0);
  c.stdout.emit('data','nonsense\n{"type":"status","active":true}\n');assert.equal(f.messages.length,0);
  c.stdout.emit('data','{"type":"hel');c.stdout.emit('data','lo","version":"тест"}\n');assert.equal(c.stdin.calls.length,1);
  c.stdout.emit('data','{"type":"status","reason":"Игра"}\n{"type":"unknown"}\n');assert.equal(f.messages.length,2);
  c.hello();assert.equal(f.messages.length,2);f.t.dispose();f.clock.tick(350);
});
test('Backpressure holds at most one in-flight write and one latest payload per type',()=>{
  const f=begin();f.c.stdin.accept=false;
  f.t.send({type:'audio',freq:[-1]});
  for(let i=0;i<100000;i++)f.t.send({type:'audio',freq:[i]});
  f.t.send({type:'state',state:{title:'latest'}});f.t.send({type:'bind',overlayHwnd:'0x55'});
  assert.equal(f.c.stdin.calls.length,1);assert.equal(f.t.snapshot().queued,3);assert.equal(f.t.snapshot().coalesced,99999);
  f.c.stdin.complete();assert.equal(f.c.stdin.calls.length,1);
  f.c.stdin.accept=true;f.c.stdin.emit('drain');assert.deepEqual(f.c.stdin.calls[1],{type:'audio',freq:[99999]});
  f.c.stdin.complete();assert.equal(f.c.stdin.calls[2].type,'state');f.c.stdin.complete();assert.equal(f.c.stdin.calls[3].type,'bind');f.c.stdin.complete();
  assert.equal(f.t.snapshot().queued,0);f.t.dispose();f.clock.tick(350);
});
test('Synchronous completion and drain-before-callback do not lose or duplicate writes',()=>{
  const f=begin();f.c.stdin.sync=true;
  for(let i=0;i<200;i++)assert.equal(f.t.send({type:'state',state:{i}}),true);
  assert.equal(f.c.stdin.calls.length,200);assert.equal(f.t.snapshot().inFlight,false);
  f.c.stdin.sync=false;f.c.stdin.accept=false;f.t.send({type:'audio',freq:[1]});f.t.send({type:'audio',freq:[2]});
  f.c.stdin.accept=true;f.c.stdin.emit('drain');assert.equal(f.c.stdin.calls.length,201);f.c.stdin.complete();assert.equal(f.c.stdin.calls.length,202);
  f.c.stdin.complete();f.t.dispose();f.clock.tick(350);
});
test('Stalled writer, missing handshake and missing heartbeat are bounded failures',()=>{
  for(const mode of ['startup','write','heartbeat']){
    const f=fixture({startupMs:20,stallMs:20,heartbeatMs:30});f.t.start();const c=f.children[0];
    if(mode!=='startup')c.hello();if(mode==='write')f.t.send({type:'audio',freq:[]});
    f.clock.tick(mode==='heartbeat'?30:20);assert.equal(f.t.snapshot().failures,1,mode);assert.equal(c.killCalls,1,mode);f.t.dispose();
  }
});
test('Shutdown error, late stream error and end error do not restart a disabled module',()=>{
  const f=begin();f.t.stop();assert.equal(f.c.stdin.calls[0].type,'stop');f.c.stdin.complete(ep());
  f.c.stdin.emit('error',ep());f.c.stderr.emit('error',ep());f.clock.tick(350);f.clock.tick(100000);
  assert.equal(f.children.length,1);assert.equal(f.t.snapshot().enabled,false);assert.equal(f.t.snapshot().failures,0);
  assert.doesNotThrow(()=>f.c.stdin.emit('error',ep()));
});
test('Graceful stop writes stop then ends stdin and clears pending frames',()=>{
  const f=begin();f.t.send({type:'audio',freq:[1]});f.t.send({type:'audio',freq:[2]});f.t.stop();
  assert.equal(f.t.snapshot().queued,1);f.c.stdin.complete();assert.equal(f.c.stdin.calls[1].type,'stop');
  f.c.stdin.complete();assert.equal(f.c.stdin.writableEnded,true);f.c.close(0);f.clock.tick(10000);assert.equal(f.children.length,1);assert.equal(f.clock.tasks.size,0);
});
test('Restart waits for actual close; old callbacks/status cannot alter the replacement',()=>{
  const f=begin();f.t.send({type:'audio',freq:[1]});f.t.restart();f.t.restart();assert.equal(f.children.length,1);
  f.c.close(0);assert.equal(f.children.length,2);const next=f.children[1];next.hello();const count=f.messages.length;
  f.c.stdin.complete(ep());f.c.stdin.emit('error',ep());f.c.stdout.emit('data','{"type":"status","active":true}\n');f.c.emit('close',1);
  assert.equal(f.t.session.child,next);assert.equal(f.messages.length,count);assert.equal(f.t.snapshot().failures,0);f.t.dispose();f.clock.tick(350);
});
test('Rapid off/on waits for old process; off cancels a pending automatic restart',()=>{
  const f=begin();f.t.stop();assert.equal(f.t.start(),false);assert.equal(f.children.length,1);f.c.close(0);assert.equal(f.children.length,2);
  f.children[1].close(2);f.t.stop();f.clock.tick(100000);assert.equal(f.children.length,2);
});
test('Retries stop after initial launch plus four retries until explicit restart',()=>{
  const f=begin();for(let i=0;i<5;i++){f.children[i].close(2);if(i<4){f.clock.tick([500,1500,4000,10000][i]);f.children[i+1].hello();}}
  for(let i=0;i<500;i++)f.t.start();f.clock.tick(100000);
  assert.equal(f.children.length,5);assert.ok(f.statuses.at(-1).reason.includes('приостановлен'));
  f.t.restart();assert.equal(f.children.length,6);assert.equal(f.t.retryCount,0);f.t.dispose();f.clock.tick(350);
});
test('Healthy session resets retry budget, heartbeats prevent spurious restarts',()=>{
  const f=begin({stableMs:100,heartbeatMs:40});f.c.close(2);f.clock.tick(500);const c=f.children[1];c.hello();
  for(let i=0;i<5;i++){f.clock.tick(25);c.stdout.emit('data','{"type":"status"}\n');}
  assert.equal(f.t.retryCount,0);assert.equal(f.t.snapshot().failures,1);f.t.dispose();f.clock.tick(350);
});
test('Invalid, cyclic, oversized payloads and oversized stdout are bounded',()=>{
  const f=begin();const cycle={type:'state'};cycle.state=cycle;
  for(const value of [null,{}, {type:'notAllowed'}, cycle,{type:'state',state:{title:'x'.repeat(MAX_LINE_BYTES)}}])assert.equal(f.t.send(value),false);
  f.c.stdout.emit('data','x'.repeat(MAX_LINE_BYTES+1));assert.equal(f.t.snapshot().failures,1);f.t.dispose();f.clock.tick(350);
});
test('No helper/unsupported platform do not spawn; asynchronous/synchronous spawn failure is handled',()=>{
  for(const extra of [{exists:()=>false},{platform:'linux'}]){const f=fixture(extra);assert.equal(f.t.start(),false);assert.equal(f.children.length,0);f.t.dispose();}
  const f=fixture({spawn:()=>{throw ep('ENOENT')}});assert.doesNotThrow(()=>f.t.start());assert.equal(f.t.retryCount,1);f.t.dispose();
});
test('An already ended stream or child exit status rejects writes without relying on killed',()=>{
  for(const field of ['writableEnded','destroyed','exitCode','signalCode']){
    const f=begin();if(field==='exitCode')f.c.exitCode=0;else if(field==='signalCode')f.c.signalCode='SIGTERM';else f.c.stdin[field]=true;
    assert.equal(f.t.send({type:'state',state:{}}),false,field);assert.equal(f.c.stdin.calls.length,0);f.t.dispose();f.clock.tick(350);
  }
});
test('Diagnostics rotate and do not contain command payloads, music or passwords',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pd-overlay-log-'));try{
    const file=path.join(dir,'nested','overlay.jsonl'),log=createDiagnosticLog(file,240),f=begin({log});
    f.c.stdin.sync=true;f.t.send({type:'state',state:{title:'PRIVATE TRACK',artist:'PRIVATE ARTIST',password:'SECRET'}});
    f.c.stderr.emit('data','private/path');f.c.stdin.emit('error',ep());f.clock.tick(0);f.t.dispose();
    for(let i=0;i<20;i++)log({event:'rotation-test',index:i});
    const text=[file,file+'.1'].filter(fs.existsSync).map(p=>fs.readFileSync(p,'utf8')).join('');
    assert.doesNotMatch(text,/PRIVATE|SECRET|private\/path/);assert.ok(fs.existsSync(file+'.1'));assert.ok(fs.statSync(file).size<600);
    assert.doesNotThrow(()=>createDiagnosticLog(path.join(file,'impossible'))({event:'test'}));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,timeout=4000){const start=Date.now();while(!predicate()){if(Date.now()-start>timeout)throw Error('timed out');await wait(10);}}

test('REAL pipe: receiver closes stdin while alive; async EPIPE is contained and playback timer keeps ticking',async()=>{
  let child,ready=false,failures=[],ticks=0;const keepPlaying=setInterval(()=>ticks++,5);
  const script="const fs=require('fs');fs.closeSync(0);process.stdout.write(JSON.stringify({type:'hello',version:'fixture'})+'\\n');setInterval(()=>{},1000);";
  const t=new OverlayHostTransport({executable:process.execPath,platform:'win32',exists:()=>true,spawn:()=>child=spawn(process.execPath,['-e',script],{stdio:['pipe','pipe','pipe']}),
    retryDelays:[],onMessage:m=>{if(m.type==='hello')ready=true},log:e=>{if(e.event==='failure')failures.push(e)},stopMs:50});
  try{
    t.start();await until(()=>ready);assert.equal(child.exitCode,null);
    t.send({type:'audio',freq:Array(96).fill(200)});await until(()=>failures.length>0);await until(()=>t.session===null);
    assert.equal(failures[0].code,'EPIPE');const before=ticks;await wait(30);assert.ok(ticks>before,'ordinary playback/event loop stopped');assert.equal(t.metrics.launches,1);
  }finally{t.dispose();child?.kill('SIGKILL');clearInterval(keepPlaying);}
});
test('REAL helper subprocess: crash, recovered handshake replay, stop during continuous audio',async()=>{
  const children=[],frames=[],states=[];let ready=0;
  const script="process.stdout.write(JSON.stringify({type:'hello',version:'fixture'})+'\\n');const rl=require('readline').createInterface({input:process.stdin});rl.on('line',s=>{const m=JSON.parse(s);if(m.type==='stop')process.exit(0);process.stdout.write(JSON.stringify({type:'status',command:m.type,title:m.state?.title})+'\\n')});rl.on('close',()=>process.exit(0));";
  let transport;transport=new OverlayHostTransport({executable:process.execPath,platform:'win32',exists:()=>true,
    spawn:()=>{const c=spawn(process.execPath,['-e',script],{stdio:['pipe','pipe','pipe']});children.push(c);return c},retryDelays:[30],stopMs:100,
    onMessage:m=>{if(m.type==='hello'){ready++;transport.send({type:'config',mode:'auto',enabled:true});transport.send({type:'bind',overlayHwnd:'0xff'});transport.send({type:'state',state:{title:'current song'}})}else{frames.push(m.command);if(m.title)states.push(m.title)}}});
  let timer;
  try{
    transport.start();await until(()=>ready===1&&states.length===1);children[0].kill('SIGKILL');await until(()=>ready===2&&states.length===2);
    assert.deepEqual(states,['current song','current song']);assert.ok(frames.filter(x=>x==='bind').length===2);
    timer=setInterval(()=>transport.send({type:'audio',freq:[1,2,3]}),1);await wait(100);transport.stop();await until(()=>transport.session===null);await wait(100);
    assert.equal(children.length,2);assert.equal(transport.metrics.failures,1);assert.equal(transport.snapshot().queued,0);
  }finally{clearInterval(timer);transport.dispose();for(const c of children)c.kill('SIGKILL');}
});

test('REAL spawn ENOENT event is handled and reaches closed state without hanging',async()=>{
  const logs=[];
  const t=new OverlayHostTransport({executable:path.join(os.tmpdir(),'pd-deliberately-absent-helper-'+process.pid),platform:'win32',exists:()=>true,retryDelays:[],log:e=>logs.push(e)});
  try{t.start();await until(()=>logs.some(e=>e.event==='close'));assert.equal(t.session,null);assert.ok(logs.some(e=>e.event==='failure'&&e.code==='ENOENT'));assert.equal(t.metrics.launches,1);}
  finally{t.dispose();}
});
test('REAL stop command tolerates EPIPE on a receiver that already closed stdin',async()=>{
  let child,ready=false;
  const script="require('fs').closeSync(0);process.stdout.write('{\"type\":\"hello\"}\\n');setInterval(()=>{},1000);";
  const t=new OverlayHostTransport({executable:process.execPath,platform:'win32',exists:()=>true,spawn:()=>child=spawn(process.execPath,['-e',script],{stdio:['pipe','pipe','pipe']}),
    retryDelays:[],onMessage:()=>{ready=true},stopMs:25});
  try{t.start();await until(()=>ready);t.stop();await until(()=>t.session===null);assert.equal(t.metrics.launches,1);assert.equal(t.metrics.failures,0);assert.equal(t.enabled,false);}
  finally{t.dispose();child?.kill('SIGKILL');}
});
