'use strict';
const test=require('node:test'),A=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process'),{fileURLToPath}=require('node:url');
const L=require('../app/shared/library-model'),F=L.Folders,Colors=require('../app/shared/lyrics-colors'),Lyrics=require('../app/shared/lyrics'),Menu=require('../app/shared/menu-order'),Geometry=require('../app/shared/overlay-geometry');
const Presets=require('../app/shared/presets'),{PresetStore}=require('../app/settings/presets'),{FolderStore}=require('../app/library/folders'),{LoudnessStore,measure,parseSummary}=require('../app/library/loudness'),Images=require('../app/library/images');
const {harness,trackFile}=require('./main-harness');
const clone=x=>JSON.parse(JSON.stringify(x)),temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'pd295-')),rm=d=>fs.rmSync(d,{recursive:true,force:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fid='folder:'+'a'.repeat(32),gid='folder:'+'b'.repeat(32);
const folders=[{id:fid,dir:'Alex',name:'Alex'},{id:gid,dir:'Sam',name:'Sam'}];
const tracks=[{id:'a',rel:'root.wav',artist:'Artist A',title:'Root',duration:12,addedAt:Date.now()},{id:'b',rel:'Alex/first.wav',artist:'Artist A',title:'One',duration:12,addedAt:Date.now()},{id:'c',rel:'Sam/second.wav',artist:'Artist B',title:'Two',duration:12,addedAt:Date.now()}];
const options=()=>L.normalizeOrganization({libraryFolders:folders,favorites:tracks.map(t=>t.rel),customCategories:[{id:'custom:alex',folderId:fid,name:'Alex mix',tracks:['Alex/first.wav','root.wav']}]});
const body=fs.readFileSync(path.join(__dirname,'fixtures/artwork-294.webm'));
const image=fs.readFileSync(path.join(__dirname,'fixtures/artwork-294.gif'));
const withMain=(name,fn)=>test('295 '+name,async()=>{const h=harness();try{await fn(h);}finally{h.close();}});

for(const [folder,rel]of [['','root.wav'],[fid,'Alex/first.wav'],[gid,'Sam/second.wav']])test('295 All / Favorites isolate folder '+(folder||'root'),()=>{
 const s=options();for(const key of ['all','favorite','recent'])A.deepEqual(tracks.filter(L.membershipPredicate(s,F.scoped(folder,key))).map(t=>t.rel),[rel]);
 const cats=L.categories(tracks,s,true);A.equal(cats.filter(c=>c.key===F.scoped(folder,'all')).length,1);
});
test('295 custom playlist memberships cannot cross physical folders',()=>{
 const s=options();A.deepEqual(tracks.filter(L.membershipPredicate(s,'custom:alex')).map(t=>t.rel),['Alex/first.wav']);
 A.throws(()=>L.toggleMembership(s,tracks,'custom:alex','root.wav'),{i18nKey:'FolderMoveFirst'});
 A.throws(()=>L.bulkAdd(s,tracks,'custom:alex',['root.wav']),{i18nKey:'FolderMoveFirst'});
 A.throws(()=>L.mergePlaylists(s,tracks,'all',F.scoped(fid,'all')),{i18nKey:'FolderMoveFirst'});
});
test('295 folder normalization rejects traversal, aliases, duplicate IDs and Windows special names',()=>{
 for(const dir of ['../escape','.vault','a/b','a\\b','CON','NUL.wav','A.','X:','x '])A.equal(F.safeDirectory(dir),false,dir);
 A.deepEqual(F.normalize([...folders,{...folders[0],dir:'other'},{id:'folder:'+'c'.repeat(32),dir:'alex'}]).map(f=>f.dir),['Alex','Sam']);
 const s=L.normalizeOrganization({...options(),customCategories:[{id:'custom:z',folderId:'folder:unknown',name:'x'}]});A.equal(s.customCategories[0].folderId,'');
});
test('295 no folder migration changes legacy categories or their keys',()=>{
 const s=L.normalizeOrganization({});A.equal(s.libraryFolders.length,0);A.ok(L.categories(tracks,s).every(c=>!c.key.startsWith('folder:')));
});
test('295 relocating references preserves memberships, ordering and video preference',()=>{
 const s=options();s.lastTrack='Alex/first.wav';s.coverAnimation={'alex/first.wav':false};s.trackOrders={'custom:alex':{manual:['alex/first.wav']}};
 const n=F.remap(s,[{from:'Alex/first.wav',to:'Sam/first.wav'}]);A.equal(n.lastTrack,'Sam/first.wav');A.equal(n.coverAnimation['sam/first.wav'],false);A.deepEqual(n.trackOrders['custom:alex'].manual,['sam/first.wav']);A.equal(s.lastTrack,'Alex/first.wav');
});
withMain('physical folder creation, collision-safe move, sidecars, IDs and organization persist',async h=>{
 const original=trackFile(h,'artist/song.wav','Artist',{title:'Keep title'}),bytes=fs.readFileSync(original);fs.writeFileSync(original+'.lrc','[00:00.00]Hello');
 h.api.saveSettings({favorites:['artist/song.wav'],lastTrack:'artist/song.wav',coverAnimation:{'artist/song.wav':false},customCategories:[{id:'custom:mix',name:'Mix',tracks:['artist/song.wav']}],trackOrders:{'custom:mix':{manual:['artist/song.wav']}}},{skipEffects:true});
 const before=(await h.api.scanLibrary(true))[0],created=await h.invoke('library:command',{type:'folder-save',style:{name:'Alex',icon:'folder',color:'#4677bb'}});
 A.equal(fs.statSync(path.join(h.api.paths.music,created.folder.dir)).isDirectory(),true);
 const moved=await h.invoke('library:command',{type:'folder-move',sourceKey:'custom:mix',targetFolder:created.folder.id,movePlaylist:true});
 A.equal(moved.count,1);A.equal(fs.existsSync(original),false);const target=path.join(h.api.paths.music,'Alex/artist/song.wav');A.deepEqual(fs.readFileSync(target),bytes);A.equal(fs.readFileSync(target+'.lrc','utf8'),'[00:00.00]Hello');
 const after=(await h.api.scanLibrary(true)).find(t=>t.rel==='Alex/artist/song.wav');A.equal(after.id,before.id);A.equal(after.title,'Keep title');A.equal(after.animateCover,false);A.equal(after.addedAt,before.addedAt);
 A.equal(h.api.getSettings().customCategories[0].folderId,created.folder.id);A.deepEqual(clone(h.api.getSettings().favorites),['alex/artist/song.wav']);
 A.equal(fs.existsSync(path.join(h.api.paths.data,'folder-operation.json')),false);
 await A.rejects(()=>h.invoke('library:command',{type:'folder-delete',id:created.folder.id}),{i18nKey:'FolderNotEmpty'});
});
withMain('moving All transfers custom tabs but does not overwrite existing destination audio',async h=>{
 const one=trackFile(h,'one.wav','A'),two=trackFile(h,'two.wav','B');fs.appendFileSync(two,'different recording');
 h.api.saveSettings({customCategories:[{id:'custom:mix',name:'Mix',tracks:['one.wav','two.wav']}]},{skipEffects:true});
 const folder=(await h.invoke('library:command',{type:'folder-save',style:{name:'Person'}})).folder;
 const occupied=trackFile(h,'Person/one.wav','Another',{title:'Do not replace'}),old=fs.readFileSync(occupied);
 const r=await h.invoke('library:command',{type:'folder-move',sourceKey:'all',targetFolder:folder.id,movePlaylist:true});
 A.equal(r.count,2);A.deepEqual(fs.readFileSync(occupied),old);A.equal(h.api.getSettings().customCategories[0].folderId,folder.id);
 const moved=(await h.api.scanLibrary(true)).filter(t=>F.ofTrack(t,h.api.getSettings())===folder.id);A.equal(moved.length,3);A.equal(new Set(moved.map(t=>t.rel.toLowerCase())).size,3);
 A.equal(fs.existsSync(one),false);A.equal(fs.existsSync(two),false);A.ok(r.moves.some(m=>m.to!=='Person/one.wav'&&m.from==='one.wav'));
});
withMain('folder display rename does not rename or corrupt its on-disk directory',async h=>{
 fs.mkdirSync(h.api.paths.music,{recursive:true});const r=await h.invoke('library:command',{type:'folder-save',style:{name:'A'}});const out=await h.invoke('library:command',{type:'folder-save',id:r.folder.id,style:{name:'B'}});
 A.equal(out.folder.dir,'A');A.equal(out.folder.name,'B');await h.invoke('library:command',{type:'folder-delete',id:r.folder.id});A.equal(h.api.getSettings().libraryFolders.length,0);
});
withMain('moving a custom private playlist keeps encryption keys and ciphertext unchanged',async h=>{
 trackFile(h,'one.wav');h.api.saveSettings({customCategories:[{id:'custom:private',name:'Secret',tracks:['one.wav']}]},{skipEffects:true});
 await h.api.vaultCommand({type:'protect',key:'custom:private',name:'Secret',password:'test strong pass'});
 const folder=(await h.invoke('library:command',{type:'folder-save',style:{name:'User'}})).folder;
 const before=clone(h.api.getSettings().protectedPlaylists);const v=h.api.getVault();const index=JSON.stringify(v.index);
 await h.invoke('library:command',{type:'folder-move',sourceKey:'custom:private',targetFolder:folder.id,movePlaylist:true});
 A.deepEqual(clone(h.api.getSettings().protectedPlaylists),before);A.equal(JSON.stringify(v.index),index);
 const unlocked=await h.api.vaultCommand({type:'unlock',key:'custom:private',password:'test strong pass'});A.equal(unlocked.tracks.length,1);A.equal(h.api.getSettings().customCategories[0].folderId,folder.id);
});
function recoveryFixture(){
 const d=temp(),music=path.join(d,'music');fs.mkdirSync(path.join(music,'User'),{recursive:true});let settings=L.normalizeOrganization({});const data=path.join(d,'data');fs.mkdirSync(data);
 const source='source.wav',target='User/source.wav',bytes=Buffer.from('immutable audio');fs.writeFileSync(path.join(music,source),bytes);fs.writeFileSync(path.join(music,target),bytes);
 const j={v:1,id:crypto.randomUUID(),files:[{source,target,hash:sha(bytes),cleanup:true}],after:{},directories:['User']};fs.writeFileSync(path.join(data,'folder-operation.json'),JSON.stringify(j));
 const store=new FolderStore({music,data,settings:()=>settings,commit:s=>settings=s,list:async()=>[],editor:{}});return {d,music,data,j,store,set:s=>settings=s};
}
test('295 interrupted folder move before settings commit rolls back destinations only',async()=>{
 const f=recoveryFixture();try{await f.store.recover();A.ok(fs.existsSync(path.join(f.music,'source.wav')));A.equal(fs.existsSync(path.join(f.music,'User/source.wav')),false);A.equal(fs.existsSync(f.store.journalFile),false);}finally{rm(f.d);}
});
test('295 interrupted folder move after settings commit finishes original cleanup',async()=>{
 const f=recoveryFixture();try{f.set({lastFolderTransaction:f.j.id});await f.store.recover();A.equal(fs.existsSync(path.join(f.music,'source.wav')),false);A.ok(fs.existsSync(path.join(f.music,'User/source.wav')));A.equal(fs.existsSync(f.store.journalFile),false);}finally{rm(f.d);}
});
test('295 external edit during folder recovery fails closed and preserves both files',async()=>{
 const f=recoveryFixture();try{f.set({lastFolderTransaction:f.j.id});fs.appendFileSync(path.join(f.music,'source.wav'),'external edit');await A.rejects(()=>f.store.recover(),{i18nKey:'FolderSourceChanged'});A.ok(fs.existsSync(path.join(f.music,'source.wav')));A.ok(fs.existsSync(path.join(f.music,'User/source.wav')));A.ok(fs.existsSync(f.store.journalFile));}finally{rm(f.d);}
});
test('295 invalid folder journals and symlink destinations never escape music',async()=>{
 const f=recoveryFixture();try{fs.writeFileSync(f.store.journalFile,JSON.stringify({...f.j,files:[{...f.j.files[0],target:'../outside.wav'}]}));await A.rejects(()=>f.store.recover());A.ok(fs.existsSync(path.join(f.music,'source.wav')));}finally{rm(f.d);}
});

const display={id:1,bounds:{x:0,y:0,width:1920,height:1080},workArea:{x:0,y:0,width:1920,height:1040}};
test('295 overlay saved over taskbar restores exactly without a 40-pixel jump',()=>{
 const bounds={x:0,y:992,width:1920,height:88};A.deepEqual(Geometry.restore({bounds},[display],display),bounds);
});
test('295 negative-coordinate secondary monitor survives restart',()=>{
 const second={id:2,bounds:{x:-2560,y:-300,width:2560,height:1440},workArea:{x:-2560,y:-300,width:2560,height:1400}};
 const bounds={x:-2440,y:1040,width:1850,height:100};A.deepEqual(Geometry.restore({bounds,displayId:1},[display,second],display),bounds);
});
test('295 disconnected monitor restores visibly; invalid bounds use a work-area default',()=>{
 A.deepEqual(Geometry.restore({bounds:{x:-2000,y:1000,width:2200,height:110}},[display],display),{x:0,y:970,width:1920,height:110});
 const normal=Geometry.restore({bounds:{x:NaN,y:0,width:0,height:-1}},[display],display);A.ok(normal.y+normal.height<=1040);A.throws(()=>Geometry.restore({},[],null));
});

test('295 menu-order merge retains hidden commands and survives serialization',()=>{
 const old=['favorite','source','edit','remove','add'];A.deepEqual(Menu.merge(old,['add','favorite','edit','remove']),['add','source','favorite','edit','remove']);
 const n=Menu.normalize(JSON.parse(JSON.stringify({'track':['a','a',null,'b'],'bad scope':[]})));A.deepEqual(n.track,['a','b']);A.equal(n['bad scope'],undefined);A.deepEqual(Menu.apply(['b','c','a'],['a','b']),['a','b','c']);
});

test('295 four gradients derive from actual red/black cover pixels; no arbitrary blue fallback',()=>{
 const p=Colors.palette(new Uint8ClampedArray([220,0,0,255,220,0,0,255,20,0,0,255]));A.equal(p.variants.length,4);
 A.equal(new Set(p.variants.map(v=>v.join(','))).size,4);for(const v of p.variants)for(const color of v){const [r,g,b]=Colors.rgb(color);A.ok(r>=g&&g===b,color);}
 A.equal(Colors.palette(new Uint8ClampedArray()).variants.length,0);
});
test('295 Cover mode requires artwork, Custom requires a separate validated background',()=>{
 A.ok(!Colors.modes(false).includes('cover'));A.ok(Colors.modes(false,true).includes('custom'));
 A.equal(Colors.scene(Lyrics.theme({mode:'custom'}),{hasCustom:false}).mode,'gradient');A.equal(Colors.scene(Lyrics.theme({mode:'custom'}),{hasCustom:true}).mode,'custom');
 A.equal(Lyrics.theme({customBackground:'../../outside.jpg'}).customBackground,undefined);
});
function installMediaInspection(h){h.api.getLyrics().inspectBackground=file=>Images.inspectFile(file,{}, {validateMedia:async()=>{}});}
withMain('lyrics custom GIF is independent of cover/audio, persists and checks stale revisions',async h=>{
 const audio=trackFile(h,'one.wav','A',{coverPath:path.join(h.temp,'cover.gif'),coverType:'image/gif'});fs.writeFileSync(path.join(h.temp,'cover.gif'),image);const source=path.join(h.temp,'background.webm');fs.writeFileSync(source,body);installMediaInspection(h);
 const store=h.api.getLyrics(),before=fs.readFileSync(audio),metadata=fs.readFileSync(audio+'.pulse.json');let r=await store.get('one.wav');
 r=await store.setBackground({rel:'one.wav',revision:r.revision,file:source});A.equal(r.theme.mode,'custom');A.equal(r.background.type,'video/webm');A.equal(r.backgroundAsset,undefined);A.deepEqual(fs.readFileSync(fileURLToPath(r.background.url)),body);
 A.deepEqual(fs.readFileSync(audio),before);A.deepEqual(fs.readFileSync(audio+'.pulse.json'),metadata);A.deepEqual(fs.readFileSync(source),body);
 const again=await store.get('one.wav');A.equal(again.theme.customBackground,r.theme.customBackground);A.equal(again.background.url,r.background.url);
 await A.rejects(()=>store.setBackground({rel:'one.wav',revision:null,file:source}),{i18nKey:'LyricsAnotherActionHasChangedTheAppearanceReopenThe'});
 const changed=await store.presentation({rel:'one.wav',revision:r.revision,theme:{...r.theme,mode:'solid'}});A.ok((await store.get('one.wav')).background);A.equal(changed.theme.mode,'solid');
});
withMain('public custom lyrics backdrop encrypts on protect, streams privately and revokes on lock',async h=>{
 const audio=trackFile(h,'one.wav');const source=path.join(h.temp,'bg.webm');fs.writeFileSync(source,body);installMediaInspection(h);
 const store=h.api.getLyrics();const open=await store.setBackground({rel:'one.wav',revision:null,file:source});const old=fileURLToPath(open.background.url);
 h.api.saveSettings({customCategories:[{id:'custom:private',name:'Private',tracks:['one.wav']}]},{skipEffects:true});
 await h.api.vaultCommand({type:'protect',key:'custom:private',name:'Private',password:'test strong pass'});A.equal(fs.existsSync(old),false);A.equal(fs.existsSync(audio),false);
 const entry=(await h.api.vaultCommand({type:'unlock',key:'custom:private',password:'test strong pass'})).tracks[0];
 const record=await store.get(entry.rel);A.equal(record.theme.mode,'custom');A.equal(record.backgroundAsset,undefined);A.ok(record.background.url.startsWith('http://127.0.0.1:'));A.ok(!JSON.stringify(record).includes('"key":'));
 const response=await fetch(record.background.url,{headers:{Range:'bytes=5-23'}});A.equal(response.status,206);A.equal(response.headers.get('content-type'),'video/webm');A.deepEqual(Buffer.from(await response.arrayBuffer()),body.subarray(5,24));
 await h.api.vaultCommand({type:'lock'});A.notEqual((await fetch(record.background.url)).status,200);A.deepEqual(fs.readFileSync(source),body);
});
withMain('private lyrics background chosen in an unlocked vault never writes a public asset',async h=>{
 trackFile(h,'one.wav');h.api.saveSettings({customCategories:[{id:'custom:private',name:'Private',tracks:['one.wav']}]},{skipEffects:true});await h.api.vaultCommand({type:'protect',key:'custom:private',name:'Private',password:'test strong pass'});
 const entry=(await h.api.vaultCommand({type:'unlock',key:'custom:private',password:'test strong pass'})).tracks[0],source=path.join(h.temp,'bg.gif');fs.writeFileSync(source,image);installMediaInspection(h);
 const r=await h.api.getLyrics().setBackground({rel:entry.rel,revision:null,file:source});A.equal(r.backgroundAsset,undefined);A.equal(r.background.type,'image/gif');A.deepEqual(Buffer.from(await (await fetch(r.background.url)).arrayBuffer()),image);
 A.equal(fs.existsSync(path.join(h.api.paths.data,'lyrics','backgrounds',r.recordingId)),false);
});
withMain('lyrics background-drop IPC rejects overlay and subframes',async h=>{
 await A.rejects(Promise.resolve().then(()=>h.rawHandlers.get('lyrics:background-drop')({sender:h.overlay.webContents},'/tmp/file','one.wav')));
 h.main.webContents.mainFrame={};await A.rejects(Promise.resolve().then(()=>h.rawHandlers.get('lyrics:background-drop')({sender:h.main.webContents,senderFrame:{}},'/tmp/file','one.wav')));
});
withMain('video animation toggles persist without a library-change broadcast; static art is rejected',async h=>{
 trackFile(h,'one.wav','A',{coverPath:path.join(h.temp,'art.webm'),coverType:'video/webm'});fs.writeFileSync(path.join(h.temp,'art.webm'),body);h.main.messages.length=0;
 const r=await h.invoke('library:command',{type:'cover-animation',rel:'one.wav',enabled:false});A.equal(r.enabled,false);A.equal(h.api.getSettings().coverAnimation['one.wav'],false);A.equal(h.main.messages.filter(m=>m.name==='library:changed').length,0);
 A.equal((await h.api.scanLibrary(true))[0].animateCover,false);trackFile(h,'still.wav','A');await A.rejects(()=>h.invoke('library:command',{type:'cover-animation',rel:'still.wav',enabled:false}));
});

test('295 preset schema captures selected sections only, never libraries, credentials or update trust',()=>{
 const c=Presets.capture({theme:'light',appIcon:'builtin:sky',favorites:['a'],password:'secret',privateKey:'secret',volume:.2,menuOrders:{track:['a']}},{repository:'evil',publicKey:'secret',automatic:false},['appearance','updates']);
 A.equal(c.settings.theme,'light');A.equal(c.settings.volume,undefined);A.equal(c.settings.favorites,undefined);A.equal(c.external.repository,undefined);A.equal(c.external.publicKey,undefined);A.equal(c.external.automatic,false);A.equal(Presets.normalize(null).presets.length,0);
 const all=Presets.capture({playerOverlay:{bounds:{x:0,y:1000,width:1920,height:80}},gameOverlay:{mode:'rtss'},customIconStyle:{shape:'circle'},hotkeys:{playPause:'Ctrl+Alt+P'}},{},Object.keys(Presets.SECTIONS));
 A.equal(all.settings.playerOverlay.bounds.y,1000);A.equal(all.settings.customIconStyle.shape,'circle');A.ok(all.settings.hotkeys);
});
function presetFixture(){
 const d=temp();let settings={theme:'dark',volume:.5,favorites:['never-remove'],appIcon:'builtin:sky'},external={automatic:true,prerelease:false,discoveryEnabled:true};let effects=0,fail=false;
 const spec={directory:d,read:()=>clone(settings),readExternal:()=>clone(external),write:async patch=>{settings={...settings,...patch};return clone(settings);},writeExternal:async patch=>{external={...external,...patch};},effects:async()=>{effects++;if(fail){fail=false;throw Error('effect failed');}return [];}};
 const store=new PresetStore(spec);return {d,store,spec,settings:()=>settings,external:()=>external,set:patch=>settings={...settings,...patch},failure:()=>fail=true,effects:()=>effects};
}
test('295 preset save/restart/selective one-click apply preserve unselected data',async()=>{
 const p=presetFixture();try{const [saved]=await p.store.save({name:'  Work  ',sections:['appearance']});A.equal(saved.name,'Work');p.set({theme:'light',volume:.8});
 const reopened=new PresetStore(p.spec);A.equal(reopened.list().length,1);await reopened.apply(saved.id);A.equal(p.settings().theme,'dark');A.equal(p.settings().volume,.8);A.deepEqual(p.settings().favorites,['never-remove']);
 reopened.rename({id:saved.id,name:'Desktop'});A.equal(reopened.list()[0].name,'Desktop');reopened.remove(saved.id);A.equal(new PresetStore(p.spec).list().length,0);
 }finally{rm(p.d);}
});
test('295 failed preset side effect rolls back selected values and optional fields',async()=>{
 const p=presetFixture();try{p.set({theme:'light',customIconStyle:{shape:'circle'}});const [saved]=await p.store.save({name:'Light',sections:['appearance']});p.set({theme:'dark',customIconStyle:undefined});p.failure();await A.rejects(()=>p.store.apply(saved.id));A.equal(p.settings().theme,'dark');A.equal(p.settings().customIconStyle,null);A.equal(fs.existsSync(p.store.journal),false);A.equal(p.effects(),2);}finally{rm(p.d);}
});
test('295 preset startup recovery restores only whitelisted saved values',async()=>{
 const p=presetFixture();try{const before=Presets.capture(p.settings(),p.external(),['appearance','updates']);before.settings.password='malicious journal field';p.set({theme:'light'});fs.writeFileSync(p.store.journal,JSON.stringify({schema:1,before}));await p.store.recover();A.equal(p.settings().theme,'dark');A.equal(p.settings().password,undefined);A.equal(fs.existsSync(p.store.journal),false);}finally{rm(p.d);}
});
test('295 preset apply is serialized and a missing preset never mutates state',async()=>{
 const p=presetFixture();try{await A.rejects(()=>p.store.apply(crypto.randomUUID()),{i18nKey:'PresetsMissing'});const [s]=await p.store.save({name:'x',sections:['appearance']});let done;const gate=new Promise(r=>done=r);p.store.validate=()=>gate;const pending=p.store.apply(s.id);await A.rejects(()=>p.store.apply(s.id),{i18nKey:'PresetsBusy'});done();await pending;A.equal(p.settings().theme,'dark');}finally{rm(p.d);}
});

test('295 actual first-ten-second loudness controls both sort directions, unknowns last',()=>{
 const data=[{rel:'unknown',loudnessIntro:null},{rel:'quiet',loudnessIntro:-34},{rel:'loud',loudnessIntro:-10},{rel:'mid',loudnessIntro:-20}];
 A.deepEqual(L.baseSort(data,'loudnessAsc').map(x=>x.rel),['quiet','mid','loud','unknown']);A.deepEqual(L.baseSort(data,'loudnessDesc').map(x=>x.rel),['loud','mid','quiet','unknown']);
 A.equal(parseSummary('I: 90 LUFS\nSummary:\n Integrated loudness:\n I: -18.2 LUFS\n'),-18.2);A.equal(parseSummary('Summary:\n Integrated loudness:\n I: -inf LUFS'),-120);A.equal(parseSummary('garbage'),null);
});
function tone(file,first,tail=first){
 const rate=16000,seconds=12,size=rate*seconds*2,b=Buffer.alloc(44+size);b.write('RIFF');b.writeUInt32LE(36+size,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(size,40);
 for(let i=0;i<rate*seconds;i++)b.writeInt16LE(Math.round(Math.sin(i/rate*2*Math.PI*440)*(i<rate*10?first:tail)*32000),44+i*2);fs.writeFileSync(file,b);
}
const ffmpeg=spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status===0?'ffmpeg':'';
test('295 real FFmpeg measures first 10 seconds, not loudness of the tail',{skip:!ffmpeg},async()=>{
 const d=temp();try{const quiet=path.join(d,'quiet.wav'),loud=path.join(d,'loud.wav'),tail=path.join(d,'tail.wav');tone(quiet,.02,.9);tone(loud,.2,.001);tone(tail,.02,.001);
 const [q,l,t]=await Promise.all([quiet,loud,tail].map(input=>measure(input,{ffmpeg})));A.ok(l-q>19&&l-q<21,[q,l]);A.ok(Math.abs(q-t)<.15,[q,t]);
 await A.rejects(()=>measure(quiet),{i18nKey:'LoudnessMissingComponent'});const c=new AbortController();c.abort();await A.rejects(()=>measure(quiet,{ffmpeg,signal:c.signal}),{i18nKey:'LoudnessCancelled'});
 }finally{rm(d);}
});
test('295 loudness cache persists and invalidates on changed file identity',{skip:!ffmpeg},async()=>{
 const d=temp();try{const file=path.join(d,'track.wav');tone(file,.1);const progress=[];const spec={file:path.join(d,'cache.json'),ffmpeg:()=>ffmpeg,resolve:async rel=>({file,track:{rel}}),onProgress:p=>progress.push(p)};let store=new LoudnessStore(spec);
 const first=await store.analyze(['track.wav'],'first');A.equal(first.results.length,1);A.equal(first.results[0].error,undefined);A.equal(progress.at(-1).finished,1);store=new LoudnessStore(spec);const st=fs.statSync(file);A.equal(store.peek({rel:'track.wav',size:st.size,modifiedAt:st.mtimeMs,changedAt:st.ctimeMs}),first.results[0].value);
 tone(file,.01);const newSt=fs.statSync(file);A.equal(store.peek({rel:'track.wav',size:newSt.size,modifiedAt:newSt.mtimeMs,changedAt:newSt.ctimeMs}),null);const second=await store.analyze(['track.wav']);A.ok(first.results[0].value-second.results[0].value>19);A.ok(!fs.readFileSync(spec.file,'utf8').includes('track.wav'));
 }finally{rm(d);}
});

test('295 pinned shortcut repair touches only this installation and preserves shortcut arguments',()=>{
 const d=temp();try{const appData=path.join(d,'appData'),desktop=path.join(d,'Desktop'),execPath=path.join(d,'PulseDeck.exe'),iconPath=path.join(d,'icon.ico'),pinned=path.join(appData,'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar');fs.mkdirSync(desktop,{recursive:true});fs.mkdirSync(pinned,{recursive:true});
 const mine=path.join(pinned,'mine.lnk'),other=path.join(pinned,'other.lnk');fs.writeFileSync(mine,'lnk');fs.writeFileSync(other,'lnk');fs.writeFileSync(path.join(desktop,'PulseDeck.lnk'),'lnk');const writes=[];
 const shell={readShortcutLink:p=>({target:p===other?path.join(d,'Other.exe'):execPath,args:'--existing'}),writeShortcutLink:(p,operation,value)=>{writes.push({p,operation,value});return true;}};
 require('../app/windows/shortcuts').repair({shell,appData,desktop,execPath,iconPath,appId:'com.pulsedeck.music',createStartMenu:true});A.equal(writes.length,3);A.ok(!writes.some(w=>w.p===other));A.equal(writes.find(w=>w.p===mine).value.args,'--existing');A.ok(writes.every(w=>w.value.appUserModelId==='com.pulsedeck.music'&&w.value.icon===iconPath));
 }finally{rm(d);}
});

withMain('moving a folder All back to shared root preserves IDs, playlists, favorites and covers',async h=>{
 const cover=path.join(h.temp,'original.gif');fs.writeFileSync(cover,image);trackFile(h,'one.wav','A',{coverPath:cover,coverType:'image/gif'});
 h.api.saveSettings({customCategories:[{id:'custom:mix',name:'Mix',tracks:['one.wav']}],favorites:['one.wav']},{skipEffects:true});
 const before=(await h.api.scanLibrary(true))[0];const folder=(await h.invoke('library:command',{type:'folder-save',style:{name:'Alex'}})).folder;
 await h.invoke('library:command',{type:'folder-move',sourceKey:'all',targetFolder:folder.id,movePlaylist:true});
 const back=await h.invoke('library:command',{type:'folder-move',sourceKey:F.scoped(folder.id,'all'),targetFolder:'',movePlaylist:true});
 A.equal(back.targetKey,'all');A.equal(back.count,1);A.equal(h.api.getSettings().customCategories[0].folderId,'');
 const after=(await h.api.scanLibrary(true))[0];A.equal(after.id,before.id);A.equal(after.rel,'one.wav');A.equal(after.coverUrl,before.coverUrl);A.equal(after.favorite,true);A.ok(fs.existsSync(cover));
});
withMain('private lyrics background exports intact when a track is explicitly made public',async h=>{
 trackFile(h,'one.wav');h.api.saveSettings({customCategories:[{id:'custom:private',name:'Private',tracks:['one.wav']},{id:'custom:public',name:'Public',tracks:[]}]},{skipEffects:true});
 await h.api.vaultCommand({type:'protect',key:'custom:private',name:'Private',password:'test strong pass'});
 const entry=(await h.api.vaultCommand({type:'unlock',key:'custom:private',password:'test strong pass'})).tracks[0];
 const source=path.join(h.temp,'background.webm');fs.writeFileSync(source,body);installMediaInspection(h);
 await h.api.getLyrics().setBackground({rel:entry.rel,revision:null,file:source});
 await h.api.vaultCommand({type:'transfer',source:'custom:private',rels:[entry.rel],target:'custom:public',password:'test strong pass'});
 const publicTrack=(await h.api.scanLibrary(true))[0],r=await h.api.getLyrics().get(publicTrack.rel);
 A.equal(r.theme.mode,'custom');A.equal(r.backgroundAsset,undefined);A.equal(r.background.type,'video/webm');A.deepEqual(fs.readFileSync(fileURLToPath(r.background.url)),body);A.deepEqual(fs.readFileSync(source),body);
});
withMain('preset IPC applies real selected settings and native window identity without modifying libraries',async h=>{
 h.main.setAppDetails=details=>h.main.identity=details;h.electron.app.getPath=()=>h.temp;
 h.api.saveSettings({theme:'ocean',appIcon:'builtin:blue-violet',volume:.42,customCategories:[{id:'custom:keep',name:'Keep',tracks:[]}]},{skipEffects:true});
 const saved=await h.invoke('presets:command',{type:'save',name:'Desktop',sections:['appearance','playback','library','language']});
 h.api.saveSettings({theme:'light',volume:.8,sort:'old'},{skipEffects:true});
 const r=await h.invoke('presets:command',{type:'apply',id:saved[0].id});
 A.equal(r.settings.theme,'ocean');A.equal(r.settings.volume,.42);A.equal(r.settings.sort,'recent');A.equal(r.settings.customCategories[0].name,'Keep');
 A.equal(h.main.identity.appId,'com.pulsedeck.music');A.ok(h.main.identity.appIconPath.endsWith('.ico'));A.ok(h.main.identity.relaunchCommand);A.ok(h.main.identity.relaunchDisplayName);
 await A.rejects(Promise.resolve().then(()=>h.rawHandlers.get('presets:command')({sender:h.overlay.webContents},{type:'apply',id:saved[0].id})),/InvalidSender/);
});

withMain('unprotecting a relocated custom playlist restores audio into its current physical folder',async h=>{
 const original=trackFile(h,'one.wav'),bytes=fs.readFileSync(original);h.api.saveSettings({customCategories:[{id:'custom:private',name:'Private',tracks:['one.wav']}]},{skipEffects:true});
 await h.api.vaultCommand({type:'protect',key:'custom:private',name:'Private',password:'test strong pass'});
 const folder=(await h.invoke('library:command',{type:'folder-save',style:{name:'Alex'}})).folder;
 await h.invoke('library:command',{type:'folder-move',sourceKey:'custom:private',targetFolder:folder.id,movePlaylist:true});
 await h.api.vaultCommand({type:'unprotect',key:'custom:private',password:'test strong pass'});
 const list=await h.api.scanLibrary(true);A.equal(list.length,1);A.equal(list[0].rel,'Alex/one.wav');A.deepEqual(fs.readFileSync(path.join(h.api.paths.music,list[0].rel)),bytes);
 A.equal(list.filter(L.membershipPredicate(h.api.getSettings(),'custom:private')).length,1);A.equal(fs.existsSync(original),false);
});
withMain('public export into a folder and later physical relocation keep protected reference playback valid',async h=>{
 const cover=path.join(h.temp,'cover.gif');fs.writeFileSync(cover,image);const original=trackFile(h,'one.wav','A',{coverPath:cover,coverType:'image/gif'}),bytes=fs.readFileSync(original);
 h.api.saveSettings({customCategories:[{id:'custom:private',name:'Private',tracks:['one.wav']}]},{skipEffects:true});
 await h.api.vaultCommand({type:'protect',key:'custom:private',name:'Private',password:'test strong pass'});
 const privateTrack=(await h.api.vaultCommand({type:'unlock',key:'custom:private',password:'test strong pass'})).tracks[0];
 const folder=(await h.invoke('library:command',{type:'folder-save',style:{name:'Alex'}})).folder;
 await h.api.vaultCommand({type:'transfer',source:'custom:private',rels:[privateTrack.rel],target:F.scoped(folder.id,'all'),password:'test strong pass'});
 const exported=(await h.api.scanLibrary(true))[0];A.equal(exported.rel,'Alex/one.wav');A.ok(exported.coverUrl);A.deepEqual(fs.readFileSync(fileURLToPath(exported.coverUrl)),image);
 await h.invoke('library:command',{type:'folder-move',sourceKey:F.scoped(folder.id,'all'),targetFolder:'',movePlaylist:false});
 const entryId=privateTrack.rel.split(':')[2],ref=h.api.getVault().index.publicRefs[entryId];A.equal(ref.rel,'one.wav');A.deepEqual(fs.readFileSync(path.join(h.api.paths.music,ref.rel)),bytes);
 const playback=await h.api.getVault().playback(privateTrack.rel);const response=await fetch(playback.audioUrl);A.equal(response.status,200);A.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
});
withMain('cross-folder public-copy conflict is rejected before any remaining private song is decrypted',async h=>{
 trackFile(h,'one.wav');trackFile(h,'two.wav');h.api.saveSettings({customCategories:[{id:'custom:private',name:'Private',tracks:['one.wav','two.wav']}]},{skipEffects:true});
 await h.api.vaultCommand({type:'protect',key:'custom:private',name:'Private',password:'test strong pass'});
 const entries=(await h.api.vaultCommand({type:'unlock',key:'custom:private',password:'test strong pass'})).tracks;
 await h.api.vaultCommand({type:'transfer',source:'custom:private',rels:[entries[0].rel],target:'all',password:'test strong pass'});
 const folder=(await h.invoke('library:command',{type:'folder-save',style:{name:'Alex'}})).folder;
 const index=JSON.stringify(h.api.getVault().index);
 await A.rejects(()=>h.api.vaultCommand({type:'transfer',source:'custom:private',rels:[entries[1].rel,entries[0].rel],target:F.scoped(folder.id,'all'),password:'test strong pass'}),{i18nKey:'FolderMoveFirst'});
 A.equal(JSON.stringify(h.api.getVault().index),index);A.equal((await h.api.scanLibrary(true)).length,1);A.deepEqual(fs.readdirSync(path.join(h.api.paths.music,folder.dir)),[]);
});
withMain('folder-scoped protected Favorites retain favorite state and prevent deletion of their parent',async h=>{
 trackFile(h,'one.wav');const folder=(await h.invoke('library:command',{type:'folder-save',style:{name:'Alex'}})).folder;
 await h.invoke('library:command',{type:'folder-move',sourceKey:'all',targetFolder:folder.id,movePlaylist:false});h.api.saveSettings({favorites:['alex/one.wav']},{skipEffects:true});
 const key=F.scoped(folder.id,'favorite');await h.api.vaultCommand({type:'protect',key,name:'Favorites',password:'test strong pass'});
 const view=await h.api.vaultCommand({type:'unlock',key,password:'test strong pass'});A.equal(view.tracks[0].favorite,true);
 await A.rejects(()=>h.invoke('library:command',{type:'folder-delete',id:folder.id}),{i18nKey:'FolderNotEmpty'});
 await h.api.vaultCommand({type:'bulk-categories',keys:[key],action:'delete',passwords:{[key]:'test strong pass'}});
 A.equal(h.api.getVault().index.vaults[key].deleted,undefined);A.ok(h.api.getSettings().protectedPlaylists[key]);
});
