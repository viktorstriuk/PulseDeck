'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const L=require('../app/shared/library-model'),C=require('../app/vault/crypto');
const {harness,trackFile,tree}=require('./main-harness');
const clone=x=>JSON.parse(JSON.stringify(x));
const base=()=>L.normalizeOrganization({customCategories:[{id:'custom:a',name:'Личное',tracks:['secret.wav']},{id:'custom:b',name:'Второе',tracks:[]},{id:'custom:c',name:'Открытое',tracks:[]}],favorites:['secret.wav'],playlistMembership:{recent:{included:['secret.wav'],excluded:[]}},trackOrders:{all:{manual:['secret.wav','other.wav']}}});
const song=(rel,artist)=>({id:rel,rel,artist,title:rel,addedAt:2,duration:1});
const ts=[song('m1.wav','Morgenstern'),song('m2.wav','Morgenstern'),song('buy.wav','BUYSELL'),song('s.wav','Slipknot')];
function hm(name,fn){test(name,async()=>{const h=harness();try{return await fn(h);}finally{h.close();}});}
function setup(h){h.api.saveSettings(base(),{skipEffects:true});const f=trackFile(h,'secret.wav','Secret Artist',{title:'PRIVATE TITLE UNIQUE',album:'PRIVATE ALBUM',sourceUrl:'https://example.test/private'});fs.copyFileSync(path.join(__dirname,'fixtures/silence.wav'),f);trackFile(h,'other.wav','Other');return f;}
const cmd=(h,p)=>h.invoke('vault:command',p);
const protect=(h,key='custom:a',password='my long test password')=>cmd(h,{type:'protect',key,name:key==='custom:a'?'Личное':'Второе',password});
const unlock=(h,key='custom:a',password='my long test password')=>cmd(h,{type:'unlock',key,password});
function strings(dir){return Object.entries(tree(dir)).filter(([n,v])=>v!=='directory'&&!n.endsWith('.pda')&&!n.endsWith('.pdv')).map(([n])=>fs.readFileSync(path.join(dir,n),'utf8')).join('\n');}

test('264 selection: playing/outside artist is not a selected artist',()=>{
 const s=L.aliasArtist(L.normalizeOrganization({}),ts,'artist:buysell','artist:morgenstern').settings;
 assert.equal(L.selectionArtists(s,ts,['m1.wav','m2.wav']).groups.length,0);
 assert.equal(L.selectionArtists(s,ts,['m1.wav','buy.wav']).groups.length,1);
 assert.throws(()=>L.splitSelectedArtists(s,ts,['m1.wav','m2.wav']));
});
test('264 bulk unfavorite changes exactly the selection; mixed favorites are added, not toggled',()=>{
 let s=L.normalizeOrganization({favorites:['m1.wav','m2.wav','buy.wav']});
 s=L.bulkRemove(s,ts,'favorite',['m1.wav','m2.wav']).settings;assert.deepEqual(s.favorites,['buy.wav']);
 s=L.bulkAdd(s,ts,'favorite',['m1.wav','buy.wav']).settings;assert.deepEqual(new Set(s.favorites),new Set(['buy.wav','m1.wav']));
});
test('264 removal is membership only for custom, artist, recent and downloads; All is protected',()=>{
 for(const key of ['custom:a','artist:morgenstern','recent','downloads']){
 let s=L.normalizeOrganization({customCategories:[{id:'custom:a',name:'A',tracks:ts.map(t=>t.rel)}]});
 s=L.bulkAdd(s,ts,key,['m1.wav','m2.wav']).settings;s=L.bulkRemove(s,ts,key,['m1.wav']).settings;
 assert.equal(L.membershipPredicate(s,key)(ts[0]),false);assert.equal(L.membershipPredicate(s,key)(ts[1]),true);
 assert.equal(L.view(ts,s,'all','recent').length,4);
 }
 assert.throws(()=>L.bulkRemove({},ts,'all',['m1.wav']));
});
test('264 batch playlist operations prevalidate system rules and merge without duplicates',()=>{
 const s=L.normalizeOrganization({customCategories:[{id:'custom:a',name:'A',tracks:['m1.wav']},{id:'custom:b',name:'B',tracks:['m1.wav','m2.wav']}]}),before=clone(s);
 assert.deepEqual(L.bulkCategories(s,ts,['custom:a','all'],'delete').skipped,['all']);assert.deepEqual(clone(s),before);
 const merged=L.bulkCategories(s,ts,['custom:a','custom:b'],'merge','custom:b').settings;
 assert.equal(merged.customCategories.length,1);assert.deepEqual(merged.customCategories[0].tracks,['m1.wav','m2.wav']);
 const hidden=L.bulkCategories(s,ts,['all','custom:b'],'hide').settings;assert.ok(hidden.categoryStyles.all.hidden);assert.ok(hidden.customCategories[1].hidden);
});
test('264 password length counts codepoints and preserves significant whitespace',()=>{
 assert.throws(()=>C.password('ab'));assert.throws(()=>C.password('x'.repeat(49)));assert.equal(C.password('   '),'   ');assert.equal(C.password('🎶'.repeat(48)).length,96);
});
test('264 GCM seals metadata and rejects a changed tag, key or context',()=>{
 const key=crypto.randomBytes(32),box=C.seal({title:'CLASSIFIED'},key,'manifest:a');assert.equal(C.open(box,key,'manifest:a').title,'CLASSIFIED');
 assert.ok(!JSON.stringify(box).includes('CLASSIFIED'));assert.throws(()=>C.open(box,key,'manifest:b'));assert.throws(()=>C.open(box,crypto.randomBytes(32),'manifest:a'));
 const altered=clone(box);altered.tag=Buffer.alloc(16).toString('base64');assert.throws(()=>C.open(altered,key,'manifest:a'));
});
test('264 password wrapping is randomized, verifies password and rejects downgraded KDF',async()=>{
 const a=await C.wrap({master:'secret key material'},'strong password','master:a'),b=await C.wrap({master:'secret key material'},'strong password','master:a');
 assert.notDeepEqual(a,b);assert.equal((await C.unwrap(a,'strong password','master:a')).master,'secret key material');
 await assert.rejects(C.unwrap(a,'wrong password','master:a'));const lowered=clone(a);lowered.kdf.N=1024;await assert.rejects(C.unwrap(lowered,'strong password','master:a'));
 assert.ok(!JSON.stringify(a).includes('strong password'));
});
test('264 chunked encryption: multi-chunk round trip, byte range, corruption and truncation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pd264-crypto-'));
 try{
 const bytes=crypto.randomBytes(C.CHUNK*2+3721),src=path.join(dir,'song'),enc=path.join(dir,'blob.pda'),out=path.join(dir,'output');fs.writeFileSync(src,bytes);
 const desc=await C.encryptFile(src,enc);assert.deepEqual(fs.readFileSync(src),bytes);assert.equal(fs.statSync(enc).size,bytes.length+48);
 await C.verifyFile(enc,desc);await C.decryptFile(enc,out,desc);assert.deepEqual(fs.readFileSync(out),bytes);
 await assert.rejects(C.decryptFile(enc,out,desc));assert.deepEqual(fs.readFileSync(out),bytes);
 let parts=[];for await(const chunk of C.chunks(enc,desc,desc.key,C.CHUNK-17,C.CHUNK+45))parts.push(chunk);assert.deepEqual(Buffer.concat(parts),bytes.subarray(C.CHUNK-17,C.CHUNK+46));
 const tamper=fs.readFileSync(enc);tamper[C.CHUNK+26]^=1;fs.writeFileSync(enc,tamper);await assert.rejects(C.verifyFile(enc,desc));
 fs.truncateSync(enc,33);await assert.rejects(C.verifyFile(enc,desc));assert.deepEqual(fs.readFileSync(src),bytes);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
hm('264 protecting removes original audio, metadata, favorites/orders and scan entries; password never persisted',async h=>{
 const file=setup(h),bytes=fs.readFileSync(file),r=await protect(h);assert.equal(r.added,1);assert.equal(r.warnings.length,0);assert.ok(!fs.existsSync(file));assert.ok(!fs.existsSync(file+'.pulse.json'));
 assert.deepEqual(clone((await h.api.scanLibrary(true)).map(t=>t.rel)),['other.wav']);assert.deepEqual(clone(h.api.getSettings().favorites),[]);
 const clear=strings(h.api.paths.music)+'\n'+strings(h.api.paths.data);for(const privateValue of ['my long test password','PRIVATE TITLE UNIQUE','PRIVATE ALBUM','secret.wav','Secret Artist','https://example.test/private'])assert.ok(!clear.includes(privateValue),privateValue);
 const view=await unlock(h);assert.equal(view.tracks[0].title,'PRIVATE TITLE UNIQUE');const response=await fetch(view.tracks[0].audioUrl);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 assert.equal(response.headers.get('cache-control'),'no-store');
});
hm('264 locked view leaks no track metadata; wrong password never changes storage; each re-entry locks',async h=>{
 setup(h);await protect(h);await cmd(h,{type:'enter',key:'all'});const locked=await cmd(h,{type:'enter',key:'custom:a'});assert.equal(locked.locked,true);assert.deepEqual(clone(locked.tracks),[]);
 const before=tree(h.api.paths.music);await assert.rejects(unlock(h,'custom:a','incorrect password'));assert.deepEqual(tree(h.api.paths.music),before);
 const view=await unlock(h),url=view.tracks[0].audioUrl;await cmd(h,{type:'enter',key:'custom:c'});assert.equal((await fetch(url)).status,404);
 assert.equal((await cmd(h,{type:'enter',key:'custom:a'})).locked,true);
});
hm('264 authenticated streaming supports Range/HEAD, rejects foreign origin and revoked capabilities',async h=>{
 const f=setup(h),bytes=fs.readFileSync(f);await protect(h);const view=await unlock(h),url=view.tracks[0].audioUrl;
 let r=await fetch(url,{headers:{Range:'bytes=123-523',Origin:'null'}});assert.equal(r.status,206);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes.subarray(123,524));
 r=await fetch(url,{method:'HEAD'});assert.equal(r.status,200);assert.equal(Number(r.headers.get('content-length')),bytes.length);
 r=await fetch(url,{headers:{Range:'bytes=999999999999-'}});assert.equal(r.status,416);
 r=await fetch(url,{headers:{Origin:'https://evil.example'}});assert.equal(r.status,403);
 await cmd(h,{type:'lock'});assert.equal((await fetch(url)).status,404);
});
hm('264 stale renderer settings cannot republish private paths or manual orders',async h=>{
 setup(h);await protect(h);const view=await unlock(h),rel=view.tracks[0].rel;
 await h.invoke('settings:set',{favorites:['secret.wav',rel],lastTrack:rel,customCategories:[{id:'custom:a',name:'Личное',tracks:['secret.wav',rel]}],trackOrders:{'custom:a':{manual:[rel]},all:{manual:['secret.wav',rel]}}});
 const text=JSON.stringify(h.api.getSettings());assert.ok(!text.includes('secret.wav'));assert.ok(!text.includes(rel));
});
hm('264 private-to-private requires both passwords and shares ciphertext, not duplicate audio',async h=>{
 setup(h);await protect(h);await protect(h,'custom:b','second password');const v=await unlock(h),rels=v.tracks.map(t=>t.rel);const before=Object.keys(h.api.getVault().index.objects);
 await assert.rejects(cmd(h,{type:'transfer',source:'custom:a',target:'custom:b',rels,password:'my long test password',targetPassword:'bad'}));
 await cmd(h,{type:'transfer',source:'custom:a',target:'custom:b',rels,password:'my long test password',targetPassword:'second password'});
 assert.deepEqual(Object.keys(h.api.getVault().index.objects),before);const b=await unlock(h,'custom:b','second password');assert.equal(b.tracks.length,1);assert.equal(b.tracks[0].title,'PRIVATE TITLE UNIQUE');
});
hm('264 public export asks original password, leaves a single clear audio shared by private views',async h=>{
 const f=setup(h),bytes=fs.readFileSync(f);await protect(h);await protect(h,'custom:b','second password');let a=await unlock(h);const rels=a.tracks.map(t=>t.rel);
 await cmd(h,{type:'transfer',source:'custom:a',target:'custom:b',rels,password:'my long test password',targetPassword:'second password'});
 await assert.rejects(cmd(h,{type:'transfer',source:'custom:a',target:'custom:c',rels,password:'bad'}));assert.ok(!fs.existsSync(f));
 await cmd(h,{type:'transfer',source:'custom:a',target:'custom:c',rels,password:'my long test password'});assert.deepEqual(fs.readFileSync(f),bytes);
 assert.equal(Object.keys(h.api.getVault().index.objects).length,0);assert.ok(h.api.getSettings().customCategories.find(c=>c.id==='custom:c').tracks.includes('secret.wav'));
 const b=await unlock(h,'custom:b','second password');assert.equal(b.tracks[0].publicCopy,true);assert.deepEqual(Buffer.from(await (await fetch(b.tracks[0].audioUrl)).arrayBuffer()),bytes);
});
hm('264 re-protecting exported audio removes former public and private references',async h=>{
 setup(h);await protect(h);const a=await unlock(h);await cmd(h,{type:'transfer',source:'custom:a',target:'custom:c',rels:a.tracks.map(t=>t.rel),password:'my long test password'});
 await protect(h,'custom:c','third password');const old=await unlock(h);assert.equal(old.tracks.length,0);const fresh=await unlock(h,'custom:c','third password');assert.equal(fresh.tracks.length,1);assert.equal(fresh.tracks[0].publicCopy,false);
});
hm('264 remove from protected playlist archives without data loss, restore needs password',async h=>{
 setup(h);await protect(h);const a=await unlock(h),before=Object.keys(h.api.getVault().index.objects);
 await cmd(h,{type:'remove',key:'custom:a',rels:a.tracks.map(t=>t.rel),password:'my long test password'});assert.equal((await unlock(h)).tracks.length,0);assert.deepEqual(Object.keys(h.api.getVault().index.objects),before);
 await cmd(h,{type:'lock'});await cmd(h,{type:'restore',key:'custom:a',password:'my long test password'});assert.equal((await unlock(h)).tracks.length,1);
});
hm('264 grouped access verifies every credential first; common password unlocks lazy peer sessions',async h=>{
 setup(h);await protect(h);await protect(h,'custom:b','second password');
 await assert.rejects(cmd(h,{type:'link',keys:['custom:a','custom:b'],passwords:{'custom:a':'my long test password','custom:b':'wrong'},password:'shared password'}));assert.equal(Object.keys(h.api.getVault().index.groups).length,0);
 await cmd(h,{type:'link',keys:['custom:a','custom:b'],passwords:{'custom:a':'my long test password','custom:b':'second password'},password:'shared password'});
 await unlock(h,'custom:a','shared password');const d=h.api.getVault().descriptor('custom:b');assert.equal(h.api.getVault().sessions.get(d.id).manifest,null);
 assert.equal((await cmd(h,{type:'enter',key:'custom:b'})).locked,false);
 await cmd(h,{type:'enter',key:'all'});assert.equal((await cmd(h,{type:'enter',key:'custom:a'})).locked,true);
 await unlock(h);assert.equal((await cmd(h,{type:'enter',key:'custom:b'})).locked,true,'personal password must not grant peers');
});
hm('264 private playlist deletion keeps recovery archive; wrong password never deletes data',async h=>{
 setup(h);await protect(h);const before=tree(h.api.paths.music);
 await assert.rejects(cmd(h,{type:'bulk-categories',action:'delete',keys:['custom:a'],passwords:{'custom:a':'bad'}}));assert.deepEqual(tree(h.api.paths.music),before);
 await cmd(h,{type:'bulk-categories',action:'delete',keys:['custom:a'],passwords:{'custom:a':'my long test password'}});assert.equal(h.api.getSettings().protectedPlaylists['custom:a'],undefined);
 assert.equal((await cmd(h,{type:'archives'})).archives.length,1);
 await cmd(h,{type:'restore-archive',key:'custom:a',password:'my long test password'});assert.equal((await unlock(h)).tracks.length,1);
});
hm('264 disabling protection exports all songs and recovers ordinary playlist memberships',async h=>{
 setup(h);await protect(h);await cmd(h,{type:'unprotect',key:'custom:a',password:'my long test password'});
 assert.ok(fs.existsSync(path.join(h.api.paths.music,'secret.wav')));assert.equal(h.api.getSettings().protectedPlaylists['custom:a'],undefined);
 assert.ok(h.api.getSettings().customCategories.find(c=>c.id==='custom:a').tracks.includes('secret.wav'));
});
hm('264 protecting a system playlist hides its snapshot from every public view',async h=>{
 setup(h);await cmd(h,{type:'protect',key:'all',name:'Все',password:'all password'});assert.equal((await h.api.scanLibrary(true)).length,0);assert.equal((await unlock(h,'all','all password')).tracks.length,2);
 const result=await cmd(h,{type:'bulk-categories',action:'delete',keys:['all'],passwords:{all:'all password'}});assert.equal(result.count,0);assert.ok(h.api.getSettings().protectedPlaylists.all);
});
hm('264 private merge into public and public into private preserve actual bytes and target',async h=>{
 setup(h);await protect(h);await cmd(h,{type:'bulk-categories',action:'merge',keys:['custom:a','custom:c'],target:'custom:c',passwords:{'custom:a':'my long test password'}});
 assert.ok(fs.existsSync(path.join(h.api.paths.music,'secret.wav')));assert.ok(h.api.getSettings().customCategories.find(c=>c.id==='custom:c').tracks.includes('secret.wav'));
 await protect(h,'custom:b','second password');await cmd(h,{type:'bulk-categories',action:'merge',keys:['custom:c','custom:b'],target:'custom:b',passwords:{'custom:b':'second password'}});
 assert.ok(!fs.existsSync(path.join(h.api.paths.music,'secret.wav')));assert.equal((await unlock(h,'custom:b','second password')).tracks.length,1);
});
hm('264 manual private order is encrypted and validates exact manifest membership',async h=>{
 setup(h);await protect(h);const a=await unlock(h),rels=a.tracks.map(t=>t.rel);await cmd(h,{type:'order',key:'custom:a',order:rels});assert.deepEqual(clone((await unlock(h)).order),rels);
 assert.ok(!JSON.stringify(h.api.getSettings()).includes(rels[0]));await assert.rejects(cmd(h,{type:'order',key:'custom:a',order:['vault:bad:bad']}));
});
hm('264 secret command IPC rejects a renderer other than main window',async h=>{
 await assert.rejects(async()=>h.handlers.get('vault:command')({sender:h.overlay.webContents},{type:'lock'}));
});

hm('264 fault injection: pending source file survives failed purge and completes safely on next unlock',async h=>{
 const f=setup(h),v=h.api.getVault(),purge=v.purge;v.purge=async()=>{throw Error('simulated locked sidecar')};
 const result=await protect(h);assert.equal(result.warnings.length,1);assert.ok(fs.existsSync(f));assert.equal((await h.api.scanLibrary()).some(t=>t.rel==='secret.wav'),false);
 v.purge=purge;await unlock(h);assert.ok(!fs.existsSync(f));assert.equal((await unlock(h)).tracks.length,1);
});
hm('264 fault injection: modifying source during protection never silently deletes the new bytes',async h=>{
 const f=setup(h),v=h.api.getVault(),purge=v.purge;let once=false;
 v.purge=async(...args)=>{await purge(...args);if(!once){fs.appendFileSync(f,'NEW BYTES');once=true;}};
 const result=await protect(h);assert.ok(result.warnings.length);assert.ok(fs.readFileSync(f).includes(Buffer.from('NEW BYTES')));
});
hm('264 transfer validates stale public destination before decrypting any song',async h=>{
 const f=setup(h);await protect(h);const a=await unlock(h);
 await assert.rejects(cmd(h,{type:'transfer',source:'custom:a',target:'custom:missing',rels:a.tracks.map(t=>t.rel),password:'my long test password'}));assert.ok(!fs.existsSync(f));
});
hm('264 recovery works with personal password even without the global index and changes no source files',async h=>{
 const {recover}=require('../app/tools/recover-vault'),file=setup(h),bytes=fs.readFileSync(file);await protect(h);const v=h.api.getVault(),folder=v.full(v.descriptor('custom:a').folder);
 fs.unlinkSync(v.indexFile);const before=tree(h.api.paths.music),out=path.join(h.temp,'recovered');
 await assert.rejects(recover({music:h.api.paths.music,folder,output:out,password:'wrong'}));assert.ok(!fs.existsSync(out));
 const r=await recover({music:h.api.paths.music,folder,output:out,password:'my long test password'});assert.equal(r.restored.length,1);assert.equal(r.failed.length,0);assert.deepEqual(fs.readFileSync(path.join(out,r.restored[0])),bytes);assert.deepEqual(tree(h.api.paths.music),before);
});
hm('264 Trash preserves encrypted metadata/keys, so restored ciphertext can be recovered',async h=>{
 const {recover}=require('../app/tools/recover-vault');setup(h);await protect(h);const a=await unlock(h),v=h.api.getVault(),file=v.full(Object.values(v.index.objects)[0].file);
 await cmd(h,{type:'remove',key:'custom:a',rels:a.tracks.map(t=>t.rel),password:'my long test password',erase:true});assert.equal((await unlock(h)).tracks.length,0);
 fs.copyFileSync(path.join(h.temp,'trash-1'),file);const r=await recover({music:h.api.paths.music,folder:v.full(v.descriptor('custom:a').folder),output:path.join(h.temp,'trash-recovery'),password:'my long test password'});assert.equal(r.restored.length,1);assert.equal(r.failed.length,0);
});
hm('264 explicit private artist rules require consent/password and never publish private paths',async h=>{
 setup(h);trackFile(h,'secret2.wav','Another Secret');h.api.saveSettings({customCategories:[...base().customCategories.map(c=>c.id==='custom:a'?{...c,tracks:['secret.wav','secret2.wav']}:c)]},{skipEffects:true});await protect(h);const a=await unlock(h),rels=a.tracks.map(t=>t.rel);
 await assert.rejects(cmd(h,{type:'artist-selection',source:'custom:a',rels,action:'alias',target:'artist:other',password:'my long test password'}));
 const r=await cmd(h,{type:'artist-selection',source:'custom:a',rels,action:'alias',target:'artist:other',password:'my long test password',discloseArtistNames:true});assert.equal(r.settings.artistAliases['secret artist'],'other');
 assert.equal((await unlock(h)).tracks.length,2);assert.equal((await h.api.scanLibrary()).length,1);for(const rel of rels)assert.ok(!JSON.stringify(h.api.getSettings()).includes(rel));
 await cmd(h,{type:'artist-selection',source:'custom:a',rels,action:'split',password:'my long test password',discloseArtistNames:true});assert.equal(Object.keys(h.api.getSettings().artistAliases).length,0);
});
hm('264 simultaneous private/online preview startup shares one loopback server',async h=>{
 const v=h.api.getVault(),ports=await Promise.all(Array.from({length:15},()=>v.port()));
 assert.equal(new Set(ports).size,1);assert.ok(ports[0]>0);
 assert.equal((await fetch(`http://127.0.0.1:${ports[0]}/vault/unknown`)).status,404);
});
hm('264 artwork is encrypted, served only while unlocked, and cached plaintext is purged',async h=>{
 setup(h);const covers=path.join(h.api.paths.data,'covers');fs.mkdirSync(covers,{recursive:true});
 const cover=path.join(covers,'secret-art.png'),image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a35sAAAAASUVORK5CYII=','base64');fs.writeFileSync(cover,image);
 const v=h.api.getVault(),publicList=v.listPublic;v.listPublic=async()=>{const t=await publicList();return t.map(x=>x.rel==='secret.wav'?{...x,coverUrl:require('node:url').pathToFileURL(cover).href}:x);};
 await protect(h);assert.ok(!fs.existsSync(cover));const list=await unlock(h),url=list.tracks[0].coverUrl;assert.ok(url.includes('/vault/'));
 assert.deepEqual(Buffer.from(await(await fetch(url)).arrayBuffer()),image);await cmd(h,{type:'lock'});assert.equal((await fetch(url)).status,404);
});
test('264 capability cache reuses URLs without quadratic scans and drops them at lock',()=>{
 const {VaultStore}=require('../app/vault/store'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'pd264-caps-'));
 try{const v=new VaultStore({music:dir}),s={d:{id:'f'.repeat(32)}};
 for(let i=0;i<10000;i++){const e={id:String(i)},a=v.issue(s,e,'audio');assert.equal(v.issue(s,e,'audio'),a);}
 assert.equal(v.tokens.size,10000);v.lock();assert.equal(v.tokens.size,0);assert.equal(v.tokenKeys.size,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
hm('264 deleting the intentional public copy removes shared private entries; disabling protection still works',async h=>{
 setup(h);await protect(h);const a=await unlock(h);await cmd(h,{type:'transfer',source:'custom:a',target:'custom:c',rels:a.tracks.map(t=>t.rel),password:'my long test password'});
 await h.invoke('library:delete','secret.wav');assert.equal((await unlock(h)).tracks.length,0);
 await cmd(h,{type:'unprotect',key:'custom:a',password:'my long test password'});assert.equal(h.api.getSettings().protectedPlaylists['custom:a'],undefined);
});
hm('264 protected favorites still mark their own songs as favorites without publishing audio',async h=>{
 const f=setup(h);await protect(h,'favorite','favorite password');const view=await unlock(h,'favorite','favorite password');
 assert.equal(view.tracks.length,1);assert.equal(view.tracks[0].favorite,true);assert.equal(view.tracks[0].publicCopy,false);assert.ok(!fs.existsSync(f));
 await cmd(h,{type:'remove',key:'favorite',rels:view.tracks.map(t=>t.rel),password:'favorite password'});assert.equal((await unlock(h,'favorite','favorite password')).tracks.length,0);
});
