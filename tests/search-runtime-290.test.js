'use strict';
const test=require('node:test'),A=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),os=require('node:os');
const M=require('../app/shared/online-search'),{createSearchService,Gate}=require('../app/online/service'),{abortError}=require('../app/online/http'),{DiscoveryStore}=require('../app/discovery/store');
function tracker(){
 const audio=new EventTarget(),win=new EventTarget(),doc=new EventTarget(),calls=[];let now=1000,t={rel:'song.wav',duration:180},enabled=true;
 Object.assign(audio,{currentTime:0,paused:false,seeking:false});
 const context=vm.createContext({window:win,document:doc,performance:{now:()=>now}});vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/renderer/listening-tracker.js'),'utf8'),context);
 const instance=new win.PulseListeningTracker({audio,getTrack:()=>t,isEnabled:()=>enabled,command:async c=>{calls.push(c);return {ok:true};},clock:()=>now});
 const tick=(seconds=1,media=seconds)=>{now+=seconds*1000;audio.currentTime+=media;audio.dispatchEvent(new Event('timeupdate'));};
 return {audio,win,doc,calls,instance,tick,track:x=>{t=x;},enable:v=>{enabled=v;},start:()=>audio.dispatchEvent(new Event('timeupdate'))};
}
test('290 real wall time produces 15-second heartbeats',()=>{const x=tracker();x.start();for(let i=0;i<16;i++)x.tick();A.equal(x.calls.length,1);A.equal(x.calls[0].seconds,15);A.equal(x.calls[0].rel,'song.wav');});
test('290 seeking never converts skipped media duration into listening',()=>{const x=tracker();x.start();x.tick(1,120);x.audio.dispatchEvent(new Event('seeking'));x.tick(1,120);x.audio.dispatchEvent(new Event('seeked'));x.tick();x.tick();x.audio.dispatchEvent(new Event('pause'));A.ok(x.calls.reduce((n,c)=>n+c.seconds,0)<=2);});
test('290 background sleep gap is not counted as playback',()=>{const x=tracker();x.start();x.tick(120,120);x.audio.dispatchEvent(new Event('pause'));A.equal(x.calls.length,0);});
test('290 double speed counts wall time rather than double history',()=>{const x=tracker();x.start();for(let i=0;i<15;i++)x.tick(1,2);A.equal(x.calls[0].seconds,15);});
for(const flag of ['vaultKey','vaultId','private','protected'])test('290 tracker excludes '+flag,()=>{const x=tracker();x.track({rel:'private.wav',[flag]:true});x.start();for(let i=0;i<20;i++)x.tick();A.equal(x.calls.length,0);});
test('290 online/trim preview without local owner does not count',()=>{const x=tracker();x.track(null);x.start();for(let i=0;i<20;i++)x.tick();A.equal(x.calls.length,0);});
test('290 disabled history is never queued',()=>{const x=tracker();x.enable(false);x.start();for(let i=0;i<20;i++)x.tick();A.equal(x.calls.length,0);});
test('290 clearing or pausing discards pending renderer history',()=>{const x=tracker();x.start();for(let i=0;i<8;i++)x.tick();x.doc.dispatchEvent(new Event('pulsedeck:discovery-reset'));x.audio.dispatchEvent(new Event('pause'));A.equal(x.calls.length,0);});
test('290 switching a public song flushes real elapsed time once',()=>{const x=tracker();x.start();for(let i=0;i<8;i++)x.tick();x.track({rel:'other.wav'});x.tick();A.equal(x.calls.length,1);A.equal(x.calls[0].seconds,8);A.equal(x.calls[0].skipped,true);});
test('290 paused audio does not accumulate timeupdate events',()=>{const x=tracker();x.audio.paused=true;x.start();for(let i=0;i<20;i++)x.tick();A.equal(x.calls.length,0);});
const url=i=>'https://www.youtube.com/watch?v=runtime'+i;
const providers={youtube:async({cursor})=>({items:[{title:'Song',url:url(cursor?.page||1)}],cursor:{page:(cursor?.page||1)+1}})};
test('290 pagination cursor expires and rejects renderer objects/oversized tokens',async()=>{let now=100;const s=createSearchService({providers,clock:()=>now});const p=await s.command({type:'page',provider:'youtube',query:'Song'});now+=16*60000;for(const cursor of [p.cursor,{url:'http://127.0.0.1'},'x'.repeat(5000)])A.equal((await s.command({type:'page',provider:'youtube',query:'Song',cursor})).error.code,'SEARCH_BAD_CURSOR');s.dispose();});
test('290 source cache, known result and cursor maps remain bounded',async()=>{const s=createSearchService({providers});for(let i=0;i<225;i++)A.equal((await s.command({type:'page',provider:'youtube',query:'Song '+i})).ok,true);const st=s.stats();A.ok(st.pages<=90&&st.cursors<=200&&st.known<=4000);s.dispose();A.equal(s.stats().pages,0);});
test('290 queued cancellation releases capacity rather than leaking tasks',async()=>{const gate=new Gate(1),controller=new AbortController();let release;const first=gate.run(()=>new Promise(r=>release=r));await Promise.resolve();const second=gate.run(()=>{throw Error('must never run');},controller.signal);controller.abort();await A.rejects(second,e=>e.code==='SEARCH_CANCELLED');release();await first;A.equal(gate.active,0);A.equal(gate.queue.length,0);});
test('290 availability probe concurrency never exceeds two',async()=>{let active=0,max=0;const s=createSearchService({providers:{youtube:async()=>({items:Array.from({length:8},(_,i)=>({title:'Song',url:url(i)}))})},extractInfo:async()=>{max=Math.max(max,++active);await new Promise(r=>setTimeout(r,8));active--;return {formats:[{url:'https://cdn.example/audio',acodec:'opus',vcodec:'none'}]};}});const p=await s.command({type:'page',provider:'youtube',query:'Song'});await Promise.all(p.items.map(i=>s.command({type:'probe',url:i.url})));A.equal(max,2);A.equal(s.stats().probing,0);s.dispose();});
test('290 dispose cancels in-flight metadata and leaves no request entries',async()=>{const s=createSearchService({providers:{youtube:({signal})=>new Promise((r,reject)=>signal.addEventListener('abort',()=>reject(abortError())))}});const p=s.command({type:'page',provider:'youtube',query:'Song'});await new Promise(r=>setTimeout(r,5));s.dispose();A.equal((await p).error.code,'SEARCH_CANCELLED');A.equal(s.stats().requests,0);});
test('290 changed item title invalidates rank cache, unchanged availability does not break rank',()=>{const a=M.normalizeItem({title:'Wrong',url:url(1)},'youtube'),b=M.normalizeItem({title:'Song',url:url(2)},'youtube');A.equal(M.rank([a,b],'Song')[0],b);a.title='Song';b.title='Wrong';A.equal(M.rank([a,b],'Song')[0],a);a.availability={state:'blocked'};A.equal(M.rank([a,b],'Song')[0],b);});
test('290 confirmed clear duplicate is not hidden by a different blocked source',()=>{const a=M.normalizeItem({url:url(1),title:'Song',availability:{state:'blocked'}},'ytmusic'),b=M.normalizeItem({url:url(1),title:'Song',availability:{state:'available'}},'youtube');A.equal(M.rank([a,b],'Song').length,1);A.equal(M.rank([a,b],'Song')[0].provider,'youtube');});
test('290 local profile records contain no remote history export transport',()=>{const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pd-discovery-'));try{const s=new DiscoveryStore(path.join(temp,'history.json'));A.equal(fs.existsSync(s.file),false);s.configure(true);s.record({rel:'track.wav',artist:'Sensitive artist'}, {seconds:30});const raw=fs.readFileSync(s.file,'utf8');A.ok(!raw.includes('Sensitive artist'));s.clear();A.deepEqual(JSON.parse(fs.readFileSync(s.file)).records,{});}finally{fs.rmSync(temp,{recursive:true,force:true});}});

test('290 missing artist metadata is not proof of a filter mismatch',()=>{const item=M.normalizeItem({title:'Song',url:url(1)},'youtube');A.equal(M.matches(item,M.parseQuery('Song',{artist:'Wanted'})),true);});

const {createExtractor}=require('../app/online/extractor');
for(const [version,flag] of [['22.16.0','--experimental-permission'],['23.4.0','--experimental-permission'],['23.5.0','--permission'],['24.0.0','--permission']]){
 test('290 bundled runtime '+version+' uses its supported permission flag and caches the check',async()=>{
  const calls=[],e=createExtractor({runtimePath:'/runtime',resolve:()=>'/tool',run:async(exe,args)=>{calls.push({exe,args});return {stdout:exe==='/runtime'?version:'{}'};}});
  const first=await e.environment(url(1)),second=await e.environment(url(2));
  A.equal(calls.length,2);A.equal(calls[1].args[0],flag);A.ok(first.args.includes('node:/runtime'));A.deepEqual(first.args,second.args);
 });
}
test('290 an unsupported or restricted bundled runtime is not advertised to the extractor',async()=>{
 for(const version of ['20.19.0','not a version','24.0.0']){
  let n=0;const e=createExtractor({runtimePath:'/runtime',resolve:()=>'/tool',run:async()=>{if(++n===2)throw Error('Permission flag unavailable');return {stdout:version};}});
  const result=await e.environment(url(1));A.ok(!result.args.includes('--js-runtimes'));
 }
});
test('290 current real Node runtime accepts the chosen permission mode',async()=>{
 const {execFile}=require('node:child_process'),{promisify}=require('node:util'),exec=promisify(execFile);
 const e=createExtractor({runtimePath:process.execPath,resolve:()=>'/not-used',run:(exe,args,opts)=>exec(exe,args,{env:opts.env,timeout:6000})});
 const env=await e.environment(url(1));A.ok(env.args.includes('node:'+process.execPath));
});
