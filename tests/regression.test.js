'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {harness,trackFile,tree}=require('./main-harness');
const L=require('../app/shared/library-model');
const {overlayPolicy,pointInRegions,sanitizeHitRegions}=require('../app/shared/overlay-policy');
const clone=x=>JSON.parse(JSON.stringify(x));
function withMain(name,fn){test(name,async()=>{const h=harness();try{await fn(h);}finally{h.close();}});}

test('Artist-folder organizer is removed from the shipped application',()=>{
  assert.equal(fs.existsSync(path.join(__dirname,'../app/library-storage.js')),false);
  for(const file of ['main.js','preload.js','renderer/app.js'])assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../app',file),'utf8'),/ArtistFolderOrganizer|folderOrganizer|library:relocated|library:storage-warning/);
});
withMain('Repeated scans leave a multi-track artist in music root without changing bytes or creating directories',async h=>{
  trackFile(h,'one.wav');trackFile(h,'two.wav');const before=tree(h.api.paths.music);
  for(let i=0;i<4;i++)assert.equal((await h.api.scanLibrary(i%2===0)).length,2);
  assert.deepEqual(tree(h.api.paths.music),before);
});
withMain('Existing artist folders and a singleton inside them remain readable and untouched',async h=>{
  trackFile(h,'Morgenstern/one.wav','Morgenstern');trackFile(h,'Slipknot/two.wav','Slipknot');fs.mkdirSync(path.join(h.api.paths.music,'Empty artist'));
  const before=tree(h.api.paths.music),tracks=await h.api.scanLibrary(true);
  assert.deepEqual(clone(tracks.map(t=>t.rel).sort()),['Morgenstern/one.wav','Slipknot/two.wav']);assert.deepEqual(tree(h.api.paths.music),before);
});
withMain('Alias merges only logical playlists and directs future tracks without moving files',async h=>{
  trackFile(h,'Slipknot/a.wav','Slipknot');trackFile(h,'m.wav','Morgenstern');const before=tree(h.api.paths.music);
  const result=await h.api.organizeLibrary({type:'alias',source:'artist:slipknot',target:'artist:morgenstern'});
  assert.equal(result.settings.artistAliases.slipknot,'morgenstern');assert.deepEqual(tree(h.api.paths.music),before);
  trackFile(h,'new.wav','Slipknot');const second=tree(h.api.paths.music),tracks=await h.api.scanLibrary(true);
  assert.equal(L.view(tracks,h.api.getSettings(),'artist:morgenstern','recent').length,3);
  assert.equal(L.categories(tracks,h.api.getSettings(),true).some(c=>c.key==='artist:slipknot'),false);
  assert.deepEqual(tree(h.api.paths.music),second);
});
withMain('Legacy stable identity, date, favorite and manual order survive refreshes',async h=>{
  trackFile(h,'Old/a.wav','Artist',{_pulseTrackId:'0123456789abcdef',_pulseAddedAt:123456});trackFile(h,'Old/b.wav','Artist');
  h.api.saveSettings({favorites:['Old/a.wav'],lastTrack:'Old/a.wav',sort:'manual',trackOrders:{all:{manual:['old/b.wav','old/a.wav']}},customCategories:[{id:'custom:p',name:'P',tracks:['Old/a.wav']}]},{skipEffects:true});
  const tracks=await h.api.scanLibrary(true),a=tracks.find(t=>t.rel==='Old/a.wav');assert.equal(a.id,'0123456789abcdef');assert.equal(a.addedAt,123456);assert.equal(a.favorite,true);
  assert.deepEqual(L.view(tracks,h.api.getSettings(),'all','manual').map(t=>t.rel),['Old/b.wav','Old/a.wav']);
  assert.equal(L.view(tracks,h.api.getSettings(),'custom:p','recent').length,1);
});
withMain('Playback notifications no longer schedule filesystem scans',async h=>{
  trackFile(h,'a.wav');h.timers.clear();await h.invoke('library:playback','a.wav');await h.invoke('library:playback','');assert.equal(h.timers.size,0);
});
withMain('Importer publishes new tracks at root and avoids same-name overwrites',async h=>{
  trackFile(h,'song.wav');const input=path.join(h.temp,'song.wav');fs.writeFileSync(input,'new audio');
  const dest=await h.api.publishMusicFile(input,{artist:'Artist'});assert.equal(path.basename(dest),'song (2).wav');
  assert.equal(path.dirname(dest),h.api.paths.music);assert.equal(fs.readFileSync(path.join(h.api.paths.music,'song.wav'),'utf8'),'RIFF0123456789WAVE data stable audio bytes');
});
withMain('A partially published import is invisible until its audio and sidecar are complete',async h=>{
  const file=trackFile(h,'writing.wav');h.api.protect(file);assert.equal((await h.api.scanLibrary()).length,0);
  h.api.unprotect(file);assert.equal((await h.api.scanLibrary()).length,1);
});
withMain('Concurrent and forced scans do not modify the music tree',async h=>{
  for(let i=0;i<10;i++)trackFile(h,`album/track-${i}.wav`);const before=tree(h.api.paths.music);
  const scans=await Promise.all([h.api.scanLibrary(),h.api.scanLibrary(true),h.api.scanLibrary(true)]);
  assert.ok(scans.every(tracks=>tracks.length===10));assert.deepEqual(tree(h.api.paths.music),before);
});
withMain('Old organizer journal is not resumed and does not trigger a migration move',async h=>{
  trackFile(h,'old/track.wav');fs.writeFileSync(path.join(h.api.paths.data,'artist-folder-journal.json'),JSON.stringify({version:1,moves:[{from:'old/track.wav',to:'track.wav'}]}));
  const before=tree(h.api.paths.music);await h.api.scanLibrary(true);assert.deepEqual(tree(h.api.paths.music),before);
});
withMain('Music path resolution rejects traversal outside music',h=>{
  assert.throws(()=>h.api.resolveMusicRelative('../private.txt'));assert.throws(()=>h.api.resolveMusicRelative('/etc/passwd'));
  assert.equal(h.api.resolveMusicRelative('Artist/song.wav'),path.join(h.api.paths.music,'Artist/song.wav'));
});
withMain('App information uses package version and never invents an update homepage',async h=>{
  const info=await h.invoke('system:app-info');assert.equal(info.version,require('../app/package.json').version);assert.equal(info.version,require('../app/package.json').version);
  assert.equal(info.tagline,'Твоя локальная музыкальная волна');assert.equal(info.homepage,require('../app/updates/security').repoURL(require('../app/updates/config.json')));
});

test('Hit regions include wide progress and several independent buttons',()=>{
  const regions=[{x:20,y:50,width:800,height:16},...Array.from({length:4},(_,i)=>({x:20+i*40,y:10,width:30,height:30}))];
  assert.equal(sanitizeHitRegions(regions).length,5);
});
test('Malformed IPC rectangles and pathological arrays are bounded',()=>{
  assert.deepEqual(sanitizeHitRegions([null,{x:NaN,y:0,width:1,height:2},{x:0,y:0,width:0,height:3},{x:0,y:0,width:20000,height:1}]),[]);
  assert.equal(sanitizeHitRegions(Array(200).fill({x:1,y:1,width:1,height:1})).length,64);
});
test('DIP hit test handles a negative-origin monitor and renderer zoom',()=>{
  assert.equal(pointInRegions({x:-875,y:125},{x:-1000,y:100},[{x:90,y:10,width:20,height:20}],1.25),true);
  assert.equal(pointInRegions({x:-800,y:125},{x:-1000,y:100},[{x:90,y:10,width:20,height:20}],1.25),false);
  assert.equal(pointInRegions({x:0,y:0},{x:0,y:0},[],0),false);
});
const regions=[{x:10,y:10,width:30,height:30},{x:50,y:10,width:30,height:30},{x:90,y:10,width:30,height:30},{x:130,y:10,width:30,height:30},{x:20,y:160,width:800,height:16},{x:0,y:50,width:12,height:100,kind:'resize'}];
for(const [i,name] of ['previous','play/pause','next','click-through toggle','wide progress'].entries()){
  withMain(`Click-through leaves ${name} interactive`,h=>{
    h.api.setConfig({clickThroughWhenMinimized:true});h.send('overlay:hit-regions',regions);
    const r=regions[i];Object.assign(h.point,{x:100+r.x+r.width/2,y:100+r.y+r.height/2});h.api.updateOverlayInteractivity();
    assert.equal(h.overlay.ignore,false);assert.equal(h.overlay.focusable,true);
  });
}
withMain('Background ignores clicks with mouse forwarding, even if the toggle is hidden',h=>{
  h.api.setConfig({clickThroughWhenMinimized:true,showClickThroughToggle:false});h.send('overlay:hit-regions',regions);Object.assign(h.point,{x:500,y:200});h.api.updateOverlayInteractivity();
  assert.equal(h.overlay.ignore,true);assert.equal(h.overlay.calls.at(-1).options.forward,true);assert.equal(h.api.polling(),true);
  Object.assign(h.point,{x:300,y:265});h.api.updateOverlayInteractivity();assert.equal(h.overlay.ignore,false);
});
withMain('Pointer capture keeps a scrub interactive outside all hit regions and releases afterwards',h=>{
  h.send('overlay:hit-regions',regions);h.send('overlay:pointer-gesture',true);Object.assign(h.point,{x:1900,y:1000});h.api.updateOverlayInteractivity();
  assert.equal(h.overlay.ignore,false);h.send('overlay:pointer-gesture',false);assert.equal(h.overlay.ignore,true);
});
withMain('Abandoned gesture expires rather than permanently intercepting desktop input',h=>{
  h.send('overlay:pointer-gesture',true);assert.equal(h.overlay.ignore,false);h.clock.now+=2100;h.api.updateOverlayInteractivity();assert.equal(h.overlay.ignore,true);
});
withMain('Renewed long gesture remains interactive until pointer-up',h=>{
  h.send('overlay:pointer-gesture',true);for(let i=0;i<20;i++){h.clock.now+=250;h.send('overlay:pointer-gesture',true);assert.equal(h.overlay.ignore,false);}
  h.send('overlay:pointer-gesture',false);assert.equal(h.overlay.ignore,true);
});
for(const action of ['playPause','previous','next','seekTo'])withMain(`IPC forwards ${action} while click-through is enabled`,h=>{
  h.send('overlay:control',{action,value:.6});assert.equal(h.main.messages.at(-1).name,'hotkey:action');assert.equal(h.main.messages.at(-1).value.action,action);
});
withMain('IPC sanitizes seek ratios and rejects unsupported control commands',h=>{
  h.send('overlay:control',{action:'seekTo',value:4});assert.equal(h.main.messages.at(-1).value.value,1);
  const n=h.main.messages.length;h.send('overlay:control',{action:'seekTo',value:NaN});h.send('overlay:control',{action:'deleteEverything'});assert.equal(h.main.messages.length,n);
});
withMain('Only the overlay renderer can register islands, control, resize or latch a gesture',h=>{
  const intruder={};h.send('overlay:control',{action:'next'},intruder);assert.equal(h.main.messages.length,0);
  h.send('overlay:hit-regions',regions,intruder);Object.assign(h.point,{x:115,y:115});h.api.updateOverlayInteractivity();assert.equal(h.overlay.ignore,true);
  h.send('overlay:pointer-gesture',true,intruder);h.api.updateOverlayInteractivity();assert.equal(h.overlay.ignore,true);
  h.send('overlay:resize-begin',{edge:'e',screenX:100,screenY:100},intruder);assert.equal(h.api.updateOverlayResize({screenX:110,screenY:100}),false);
});
withMain('Resize is blocked while click-through is enabled, allowed when disabled',h=>{
  h.api.setConfig({clickThroughWhenMinimized:true});const before=clone(h.overlay.bounds);
  assert.equal(h.api.beginOverlayResize({edge:'se',screenX:500,screenY:200}),false);
  assert.equal(h.api.updateOverlayResize({screenX:700,screenY:300}),false);assert.deepEqual(clone(h.overlay.bounds),before);
  h.api.setConfig({clickThroughWhenMinimized:false});
  assert.equal(h.api.beginOverlayResize({edge:'se',screenX:500,screenY:200}),true);
  assert.equal(h.api.updateOverlayResize({screenX:700,screenY:300}),true);assert.equal(h.overlay.bounds.width,before.width+200);
  h.api.endOverlayResize();
});
withMain('Hidden overlay cannot hold a gesture or consume control commands',h=>{
  h.overlay.visible=false;h.send('overlay:pointer-gesture',true);h.api.updateOverlayInteractivity();assert.equal(h.overlay.ignore,true);assert.equal(h.api.polling(),false);
  h.send('overlay:control',{action:'next'});assert.equal(h.main.messages.length,0);
});
test('Preview is limited to the player page of a visible, non-minimized main window',()=>{
  const config={mode:'off',clickThroughWhenMinimized:true};
  for(const context of [{previewRequested:false,mainVisible:true},{previewRequested:true,mainVisible:false},{previewRequested:true,mainVisible:true,mainMinimized:true}]){
    const p=overlayPolicy(config,context);assert.equal(p.preview,false);assert.equal(p.visible,false);assert.equal(p.clickThrough,true);
  }
  const p=overlayPolicy(config,{previewRequested:true,mainVisible:true,mainMinimized:false});assert.equal(p.preview,true);assert.equal(p.visible,true);assert.equal(p.clickThrough,false);
});
test('An explicit toggle overrides the temporary interactive settings preview',()=>{
  for(const value of [false,true])assert.equal(overlayPolicy({mode:'off',clickThroughWhenMinimized:!value},{previewRequested:true,mainVisible:true,previewOverride:value}).clickThrough,value);
});
withMain('Toggle persists both states and also works with the visual switch disabled',h=>{
  h.api.setConfig({showClickThroughToggle:false});assert.equal(h.api.toggleOverlayClickThrough().enabled,false);assert.equal(h.api.getSettings().playerOverlay.clickThroughWhenMinimized,false);
  assert.equal(h.api.toggleOverlayClickThrough().enabled,true);assert.equal(h.api.getSettings().playerOverlay.clickThroughWhenMinimized,true);
});

test('Independent manual order, automatic sorting, undo and redo remain available',()=>{
  const tracks=[{id:'a',rel:'a',title:'A',addedAt:1},{id:'b',rel:'b',title:'B',addedAt:2}];
  const settings=L.normalizeOrganization({sort:'manual',trackOrders:{all:{manual:['b','a']}}});
  assert.deepEqual(L.view(tracks,settings,'all','manual').map(t=>t.id),['b','a']);assert.deepEqual(L.view(tracks,settings,'all','title').map(t=>t.id),['a','b']);
  const history=new L.OrderHistory();history.push({category:'all',before:['a','b'],after:['b','a'],beforeSort:'title',afterSort:'manual'});
  assert.deepEqual(history.take().order,['a','b']);assert.deepEqual(history.take(true).order,['b','a']);
});
test('All system and more than a thousand user playlists remain accessible',()=>{
  const settings=L.normalizeOrganization({customCategories:Array.from({length:1100},(_,i)=>({id:`custom:${i}`,name:`P${i}`}))});
  const cats=L.categories([],settings,true);assert.equal(cats.length,1104);for(const key of ['all','favorite','downloads','recent'])assert.ok(cats.some(c=>c.key===key));
});
