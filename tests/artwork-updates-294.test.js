'use strict';
const test=require('node:test'),A=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const Media=require('../app/shared/cover-media'),Images=require('../app/library/images'),Interval=require('../app/shared/update-interval');
const {createCovers}=require('../app/online/covers'),{Enrichment,bestLyrics,bestCover}=require('../app/library/enrichment'),Search=require('../app/shared/lyrics-search');
const {TrackEditor}=require('../app/library/editor'),{UpdateManager}=require('../app/updates/manager'),{harness}=require('./main-harness');
const gif=fs.readFileSync(path.join(__dirname,'fixtures/artwork-294.gif')),video=fs.readFileSync(path.join(__dirname,'fixtures/artwork-294.webm'));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/NgAAAAASUVORK5CYII=','base64');
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pd294-')),remove=d=>fs.rmSync(d,{force:true,recursive:true}),tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const item=(n=0,more={})=>({title:'Song',artist:'Artist',thumbnail:`https://i.ytimg.com/vi/id${n}/hqdefault.jpg`,provider:'youtube',...more});
const track={title:'Song',artist:'Artist',duration:180,rel:'one.wav'};

test('294 media types come from signatures, preserve GIF and detect extensionless Vault video',()=>{
 A.equal(Images.describe(gif).type,'image/gif');A.equal(Images.describe(video).type,'video/webm');
 A.equal(Media.isVideo('http://127.0.0.1/vault/opaque','video/webm'),true);A.equal(Media.typeOf('C:\\cover.GIF'),'image/gif');
 for(const bad of [Buffer.from('<svg onload="alert(1)">'),Buffer.from('<html></html>'),Buffer.alloc(32)])A.throws(()=>Images.describe(bad));
});
test('294 valid image buffers are not downscaled or rewritten above the former byte and pixel limits',()=>{
 const large=Buffer.concat([png,Buffer.alloc(17*1024*1024)]);large.writeUInt32BE(9000,16);large.writeUInt32BE(4000,20);
 const decoder={createFromBuffer:b=>({isEmpty:()=>false,getSize:()=>({width:9000,height:4000}),resize:()=>{throw Error('must not resize');},toPNG:()=>{throw Error('must not reencode');}})};
 A.equal(Images.sanitizeImage(large,decoder),large);A.deepEqual(Images.dimensions(large),{width:9000,height:4000});
});
test('294 streamed media store keeps bytes, extension and source; malformed files and symlinks are refused',async()=>{
 const d=temp();try{const source=path.join(d,'input.data');fs.writeFileSync(source,video);let validated=0;
 const media=await Images.inspectFile(source,{}, {validateMedia:async(file,m)=>{A.equal(file,source);A.equal(m.type,'video/webm');validated++;}});
 const stored=await Images.storeFile(media,path.join(d,'covers'));A.equal(validated,1);A.ok(stored.endsWith('.webm'));A.deepEqual(fs.readFileSync(stored),video);A.deepEqual(fs.readFileSync(source),video);
 A.equal(await Images.storeFile(media,path.join(d,'covers')),stored);A.equal(fs.readdirSync(path.dirname(stored)).length,1);
 fs.writeFileSync(source,Buffer.concat([video,Buffer.from('changed')]));await A.rejects(Images.storeFile(media,path.join(d,'covers')),{i18nKey:'TrackChanged'});
 fs.symlinkSync(source,path.join(d,'link.webm'));await A.rejects(Images.inspectFile(path.join(d,'link.webm'),{}));
 }finally{remove(d);}
});
test('294 GIF file edit retains original animation and MIME in public sidecars',async()=>{
 const h=harness();try{const file=path.join(h.api.paths.music,'one.wav'),source=path.join(h.temp,'cover.gif');fs.mkdirSync(h.api.paths.music,{recursive:true});fs.writeFileSync(file,'audio');fs.writeFileSync(file+'.pulse.json',JSON.stringify({title:'Song',artist:'Artist'}));fs.writeFileSync(source,gif);
 const editor=new TrackEditor({music:h.api.paths.music,covers:path.join(h.temp,'covers294'),list:()=>h.api.scanLibrary(),vault:()=>h.api.getVault(),notify(){}});
 const media=await Images.inspectFile(source,{}, {validateMedia:async()=>{}}),info=await editor.info('one.wav');await editor.update('one.wav',{}, {coverFile:media,revision:info.revision});
 const meta=JSON.parse(fs.readFileSync(file+'.pulse.json'));A.equal(meta.coverType,'image/gif');A.deepEqual(fs.readFileSync(meta.coverPath),gif);const t=(await h.api.scanLibrary(true)).find(t=>t.rel==='one.wav');A.equal(t.coverType,'image/gif');A.ok(t.coverUrl.endsWith('.gif'));
 }finally{h.close();}
});
test('294 private video cover is encrypted, supports range reads, and never replaces the playing audio token',async()=>{
 const h=harness();try{fs.mkdirSync(h.api.paths.music,{recursive:true});fs.writeFileSync(path.join(h.api.paths.music,'one.wav'),'original audio');fs.writeFileSync(path.join(h.api.paths.music,'one.wav.pulse.json'),JSON.stringify({title:'Song',artist:'Artist'}));h.api.saveSettings({customCategories:[{id:'custom:a',name:'Private',tracks:['one.wav']}]},{skipEffects:true});await h.api.vaultCommand({type:'protect',key:'custom:a',name:'Private',password:'strong test password'});const before=await h.api.vaultCommand({type:'unlock',key:'custom:a',password:'strong test password'}),t=before.tracks[0],v=h.api.getVault(),source=path.join(h.temp,'video.webm'),covers=path.join(h.temp,'covers294');fs.writeFileSync(source,video);
 const editor=new TrackEditor({music:h.api.paths.music,covers,list:()=>h.api.scanLibrary(),vault:()=>v,notify(){}}),info=await editor.info(t.rel),coverFile=await Images.inspectFile(source,{}, {validateMedia:async()=>{}});
 await editor.update(t.rel,{}, {coverFile,revision:info.revision});const after=(await h.api.vaultCommand({type:'enter',key:'custom:a'})).tracks[0];A.equal(after.audioUrl,t.audioUrl);A.equal(after.coverType,'video/webm');
 const response=await fetch(after.coverUrl,{headers:{Range:'bytes=0-31'}});A.equal(response.status,206);A.equal(response.headers.get('content-type'),'video/webm');A.deepEqual(Buffer.from(await response.arrayBuffer()),video.subarray(0,32));
 A.deepEqual(fs.readFileSync(source),video);A.equal(fs.readdirSync(covers).length,0);await h.api.vaultCommand({type:'lock'});A.notEqual((await fetch(after.coverUrl)).status,200);
 }finally{h.close();}
});
test('294 artwork drop IPC accepts the main frame only',async()=>{const h=harness();try{await A.rejects(Promise.resolve().then(()=>h.rawHandlers.get('library:cover-drop')({sender:h.overlay.webContents},'/tmp/file','one.wav')));h.main.webContents.mainFrame={};await A.rejects(Promise.resolve().then(()=>h.rawHandlers.get('library:cover-drop')({sender:h.main.webContents,senderFrame:{}},'/tmp/file','one.wav')));}finally{h.close();}});

test('294 first cover is delivered before the slowest provider finishes',async()=>{
 const gate=deferred(),events=[],s=createCovers({progress:p=>events.push(p),search:{cancel(){},command:async c=>{if(c.provider==='soundcloud')await gate.promise;return {ok:true,items:[item(c.provider==='youtube'?1:2)]};}},fetch:async()=>new Response(png)});
 try{let settled=false;const finding=s.find({query:'Artist Song',prefs:{enabled:['youtube','soundcloud']},requestId:'progress'}).then(x=>(settled=true,x));await tick();A.equal(settled,false);A.equal(events.length,1);A.equal(events[0].requestId,'progress');A.equal(events[0].items.length,1);gate.resolve();A.equal((await finding).items.length,2);}finally{gate.resolve();s.dispose();}
});
test('294 provider continuations load more than one fixed batch without duplicate art',async()=>{
 const s=createCovers({search:{cancel(){},command:async c=>{const page=Number(c.cursor||0);return {ok:true,items:Array.from({length:30},(_,i)=>item(page*29+i)),cursor:page<4?String(page+1):null};}},fetch:async()=>new Response(png)});
 try{const images=new Set();let cursor,count=0;do{const r=await s.find({query:'Artist Song',prefs:{enabled:['youtube']},requestId:'paging',cursor});A.equal(r.ok,true);for(const i of r.items){A.ok(!images.has(i.image));images.add(i.image);}cursor=r.cursor;count++;}while(cursor);A.equal(images.size,146);A.equal(count,5);}finally{s.dispose();}
});
test('294 catalog pages recordings and linked releases, uses original artwork for saving',async()=>{
 let clock=0;const urls=[],s=createCovers({clock:()=>clock,search:{cancel(){}},fetch:async raw=>{
  const u=new URL(raw);urls.push(raw);
  if(u.hostname==='musicbrainz.org'){clock+=2000;const offset=+u.searchParams.get('offset');return Response.json(u.pathname.includes('/recording/')?{count:97,recordings:Array.from({length:Math.min(20,97-offset)},(_,i)=>({title:'Song','artist-credit':[{name:'Artist'}],releases:[{id:`00000000-0000-0000-0000-${String(offset+i).padStart(12,'0')}`,title:'Album'}]}))}:{count:0,releases:[]});}
  if(u.pathname.endsWith('.jpg'))return new Response(png);
  return Response.json({images:[{front:true,image:raw+'/original.jpg',thumbnails:{500:raw+'/thumb.jpg'}}]});
 }});
 try{let cursor,count=0,first;do{const r=await s.find({query:'Artist Song',track,phase:'catalog',requestId:'catalog',cursor});A.equal(r.ok,true);first||=r.items[0];count+=r.items.length;cursor=r.cursor;}while(cursor);A.equal(count,97);A.ok(urls[0].includes('recording%3A%22Song%22'));A.ok(urls.some(u=>u.includes('offset=80')));await s.download(first.id);A.ok(urls.at(-1).endsWith('/original.jpg'));}finally{s.dispose();}
});
test('294 failed providers retain a retryable cursor; successful results are not erased',async()=>{
 let fail=true;const s=createCovers({search:{cancel(){},command:async c=>c.provider==='soundcloud'&&fail?{ok:false,error:{code:'SEARCH_NETWORK'}}:{ok:true,items:[item(c.provider==='youtube'?1:2)]}},fetch:async()=>new Response(png)});
 try{const p={query:'Artist Song',prefs:{enabled:['youtube','soundcloud']},requestId:'partial'};const first=await s.find(p);A.equal(first.items.length,1);A.equal(first.partial,true);A.ok(first.cursor);fail=false;const next=await s.find({...p,cursor:first.cursor});A.equal(next.items.length,1);A.equal(next.cursor,null);}finally{s.dispose();}
});
test('294 cancellation suppresses stale cover events and foreign cursors cannot change query',async()=>{
 const gate=deferred(),events=[],s=createCovers({progress:p=>events.push(p),search:{cancel(){},command:async()=>{await gate.promise;return {ok:true,items:[item(1)],cursor:'next'};}},fetch:async()=>new Response(png)});
 try{const pending=s.find({query:'Artist Song',prefs:{enabled:['youtube']},requestId:'old'});await tick();s.cancel('old');gate.resolve();A.equal((await pending).ok,false);A.equal(events.length,0);const r=await s.find({query:'Artist Song',prefs:{enabled:['youtube']}});A.equal((await s.find({query:'Other Song',cursor:r.cursor,prefs:{enabled:['youtube']}})).ok,false);}finally{gate.resolve();s.dispose();}
});
test('294 image download has no application file-size cap; JSON metadata still has one',async()=>{
 const bytes=Buffer.alloc(17*1024*1024,7),s=createCovers({search:{cancel(){}},fetch:async()=>new Response(bytes,{headers:{'content-length':String(bytes.length)}})});
 try{A.equal((await s.request('https://i.ytimg.com/a')).length,bytes.length);await A.rejects(s.request('https://musicbrainz.org/ws/2/recording',{json:true}),{code:'SEARCH_RESPONSE_LIMIT'});}finally{s.dispose();}
});
test('294 automatic matching accepts strong identity without measured duration and modest timing differences',()=>{
 const sample={title:'Unsainted',artist:'Slipknot',synced:'[00:00.00]test',duration:262,delta:null,matchScore:80};A.equal(bestLyrics([sample],{title:'Slipknot - Unsainted (Official Video)',artist:'Slipknot',duration:0}),sample);
 A.ok(bestLyrics([{...sample,delta:8}],{title:'Unsainted',artist:'Slipknot',duration:270}));
 A.equal(bestLyrics([{...sample,variantMismatch:true}],{title:'Unsainted',artist:'Slipknot'}),null);A.equal(bestLyrics([{...sample,artist:'Another Band'}],{title:'Unsainted',artist:'Slipknot'}),null);
});
test('294 artwork fallback accepts the same artist but not unrelated uploaders',()=>{
 const album={title:'Other album',artist:'Artist'};A.equal(bestCover([album],track),album);A.equal(bestCover([{title:'Song',artist:'Random uploader'}],track),null);
 A.ok(bestCover([{title:'Artist - Song (Official Video)',artist:'Uploader'}],track));
});
test('294 automatic cover selection retries a broken first candidate before saving; preserves revision',async()=>{
 const downloads=[],writes=[],q=new Enrichment({covers:{find:async()=>({ok:true,items:[{id:'broken',title:'Song',artist:'Artist'},{id:'good',title:'Song',artist:'Artist'}]}),download:async id=>(downloads.push(id),id==='broken'?Buffer.from('bad'):png)},sanitize:async b=>{if(b.toString()==='bad')throw Error('decode');return b;},editor:{update:async(...args)=>(writes.push(args),{ok:true})},preferences:()=>({})});
 const saved=await q.fillCover({id:'job',controller:new AbortController()},track,'known-revision');A.equal(saved.ok,true);A.deepEqual(downloads,['broken','good']);A.equal(writes.length,1);A.equal(writes[0][2].revision,'known-revision');A.equal(writes[0][2].onlyMissingCover,true);
});
test('294 capabilities publish the first missing cover before the first slow lyrics read',async()=>{
 const gate=deferred(),events=[],resolved=[];const q=new Enrichment({editor:{resolve:async rel=>(resolved.push(rel),{track:{...track,rel}})},lyrics:()=>({get:async()=>{await gate.promise;return {doc:null};}}),progress:p=>events.push(p)});
 try{const work=q.capabilities(['first','second'],{requestId:'cap'});await tick();A.equal(events[0].counts.covers,1);A.deepEqual(resolved,['first']);A.equal(events[0].requestId,'cap');gate.resolve();const r=await work;A.equal(r.counts.covers,2);A.equal(r.counts.lyrics,2);}finally{gate.resolve();q.dispose();}
});
test('294 cancelling a capability scan stops before resolving later tracks',async()=>{
 const gate=deferred(),resolved=[];const q=new Enrichment({editor:{resolve:async rel=>(resolved.push(rel),{track:{...track,rel}})},lyrics:()=>({get:async()=>{await gate.promise;return {};}}),progress(){}});
 try{const work=q.capabilities(['first','second'],{requestId:'cap'});await tick();q.cancelCapabilities('cap');gate.resolve();await work;A.deepEqual(resolved,['first']);}finally{q.dispose();}
});

for(const [input,unit,expected]of [['1,5','hours',90],['0','days',1],['-200','minutes',1],['99999999999','days',43200],['.5','days',720],['1.01','minutes',1],['banana','hours',720],['','minutes',720],['1e9','days',720]])test(`294 interval normalization ${input} ${unit}`,()=>A.equal(Interval.fromInput(input,unit).intervalMinutes,expected));
test('294 unit conversion preserves the exact whole-minute interval without drift',()=>{
 for(const minutes of [1,59,61,719,1441,43200])for(const intervalUnit of ['minutes','hours','days']){const text=Interval.display({intervalMinutes:minutes,intervalUnit});A.equal(Interval.fromInput(text,intervalUnit).intervalMinutes,minutes);}
 A.deepEqual(Interval.normalize({}),{intervalMinutes:720,intervalUnit:'hours'});
});
function managerFixture(extra={}){const root=temp(),config=require('../app/updates/config.json'),m=new UpdateManager({config,current:'2.9.4',platform:'win32',arch:'x64',profile:path.join(root,'profile'),cache:path.join(root,'cache'),transport:{fetchFeed:async()=>{throw Object.assign(Error('test'),{name:'AbortError'});}},...extra});return {m,root,close(){m.close();remove(root);}};}
test('294 saved interval is used by actual scheduler, disabled checks have no timer, long periods are chunked',()=>{
 const f=managerFixture({clock:()=>1_000_000_000});try{f.m.prefs.lastAttempt=1_000_000_000;f.m.configure({intervalMinutes:2,intervalUnit:'minutes'});A.equal(f.m.timer._idleTimeout,120000);f.m.configure({intervalMinutes:43200,intervalUnit:'days'});A.equal(f.m.timer._idleTimeout,Interval.MAX_TIMEOUT);f.m.configure({automatic:false});A.equal(f.m.timer,null);A.equal(JSON.parse(fs.readFileSync(f.m.file)).intervalMinutes,43200);const next=new UpdateManager({config:f.m.config,current:'2.9.4',profile:path.dirname(f.m.file),cache:f.m.cache});try{A.equal(next.prefs.intervalMinutes,43200);A.equal(next.prefs.intervalUnit,'days');}finally{next.close();}}finally{f.close();}
});
test('294 closing an in-flight check never rearms its automatic timer',async()=>{
 const gate=deferred(),f=managerFixture({transport:{fetchFeed:async()=>{await gate.promise;throw Object.assign(Error('cancel'),{name:'AbortError'});}}});
 try{const check=f.m.check();await tick();f.m.close();gate.resolve();await check;A.equal(f.m.timer,null);}finally{gate.resolve();f.close();}
});
test('294 shorter configured intervals affect eligibility; manual checks remain independent',async()=>{
 let now=1_000_000,calls=0;const f=managerFixture({clock:()=>now,transport:{fetchFeed:async()=>{calls++;throw Object.assign(Error('test'),{name:'AbortError'});}}});
 try{f.m.configure({intervalMinutes:2});f.m.prefs.lastAttempt=now;now+=119000;await f.m.check(false);A.equal(calls,0);now+=1000;await f.m.check(false);A.equal(calls,1);f.m.configure({automatic:false});now+=31000;await f.m.check(true);A.equal(calls,2);}finally{f.close();}
});

test('294 background lyrics search continues beyond an exact but untimed first result',async()=>{
 const h=harness();try{
  const {trackFile}=require('./main-harness');trackFile(h,'lookup.wav','Slipknot',{title:'Unsainted',duration:262});const store=h.api.getLyrics(),queries=[];
  store.fetchJson=async url=>{queries.push(String(url));return [{id:queries.length,artistName:'Slipknot',trackName:'Unsainted',duration:262,plainLyrics:'fixture',syncedLyrics:queries.length>1?'[00:00.00]timed fixture':''}];};
  const results=await store.search({rel:'lookup.wav',consent:true,background:true});A.equal(queries.length,2);A.ok(bestLyrics(results,{artist:'Slipknot',title:'Unsainted',duration:262}));
  A.equal((await store.get('lookup.wav')).doc,null); // Search alone never commits provider data.
 }finally{h.close();}
});
test('294 decoder probe uses a sandboxed local page, JSON-escapes filenames, and always destroys its window',async()=>{
 const {probeMedia}=require('../app/library/media-probe');let options,expression,loaded,destroyed=0,handler;
 class Window{constructor(o){options=o;this.webContents={setWindowOpenHandler:f=>handler=f,executeJavaScript:s=>(expression=s,Promise.resolve({width:96,height:96}))};}async loadFile(file){loaded=file;}isDestroyed(){return false;}destroy(){destroyed++;}}
 const file=path.resolve('cover "name".gif');A.deepEqual(await probeMedia(file,{video:false},Window),{width:96,height:96});A.equal(options.show,false);A.equal(options.webPreferences.sandbox,true);A.equal(options.webPreferences.nodeIntegration,false);A.equal(options.webPreferences.contextIsolation,true);A.equal(handler().action,'deny');A.ok(loaded.endsWith('cover-probe.html'));A.ok(expression.includes(JSON.stringify(require('node:url').pathToFileURL(file).href)));A.equal(destroyed,1);
 class Broken extends Window{async loadFile(){throw Error('broken local page');}}
 await A.rejects(probeMedia(file,{video:false},Broken),{i18nKey:'CoverInvalidImage'});A.equal(destroyed,2);
});
test('294 automatic artwork continues when the first catalog page has no image',async()=>{
 const calls=[],writes=[],q=new Enrichment({covers:{find:async c=>{calls.push(c);return c.phase==='music'?{ok:true,items:[]}:!c.cursor?{ok:true,items:[],cursor:'page-two'}:{ok:true,items:[{id:'good',title:'Song',artist:'Artist'}]};},download:async()=>png},sanitize:async b=>b,editor:{update:async(...args)=>(writes.push(args),{ok:true})},preferences:()=>({})});
 A.equal((await q.fillCover({id:'pagination',controller:new AbortController()},track,null)).ok,true);A.ok(calls.some(c=>c.phase==='catalog'&&c.cursor==='page-two'));A.equal(writes.length,1);
});
