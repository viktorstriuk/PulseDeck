'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const L=require('../app/shared/library-model');
const {harness,trackFile,tree}=require('./main-harness');
const clone=x=>JSON.parse(JSON.stringify(x));
const base=()=>L.normalizeOrganization({favorites:[],trackOrderSchema:2,customCategories:[{id:'custom:test',name:'Test',tracks:[]}],artistAliases:{},categoryStyles:{}});
const tracks=()=>['A','A','B','B','C','D','E'].map((artist,i)=>({id:String(i),rel:`${artist}-${i}.wav`,artist,title:`Song ${i}`,addedAt:i}));
const rels=ts=>ts.map(t=>t.rel);const count=(ts,s,name)=>L.view(ts,s,`artist:${name.toLowerCase()}`,'recent').length;
function withMain(name,fn){test(name,async()=>{const h=harness();try{await fn(h);}finally{h.close();}});}

test('New artist aliases route automatic tracks without permanently pinning them',()=>{
 const ts=tracks(),r=L.aliasArtist(base(),ts,'artist:a','artist:b');
 assert.equal(count(ts,r.settings,'B'),4);assert.equal(r.moved,2);
 assert.deepEqual(r.settings.playlistMembership['artist:b'].included,[]);
 assert.equal(r.settings.artistAliasHistory.length,1);
});
test('Splitting restores original artist tabs and future automatic membership',()=>{
 const ts=tracks();let s=L.aliasArtist(base(),ts,'artist:a','artist:b').settings;
 ts.push({id:'new',rel:'new.wav',artist:'A'});assert.equal(count(ts,s,'B'),5);
 s=L.splitArtistGroups(s,ts,['artist:b']).settings;
 assert.deepEqual(clone(s.artistAliases),{});assert.equal(count(ts,s,'A'),3);assert.equal(count(ts,s,'B'),2);
 assert.equal(s.categoryStyles['artist:a'].deleted,false);assert.equal(s.categoryStyles['artist:a'].hidden,false);
 ts.push({id:'future',rel:'future.wav',artist:'A'});assert.equal(count(ts,s,'A'),4);assert.equal(count(ts,s,'B'),2);
});
test('Legacy 2.6.2 aliases unpin only the transferred automatic songs',()=>{
 const ts=tracks();let s=base();s.artistAliases={a:'b'};s.categoryStyles['artist:a']={deleted:true,name:'Artist A'};
 s.playlistMembership['artist:b']={included:['a-0.wav','a-1.wav','c-4.wav'],excluded:[]};
 s=L.splitArtistGroups(s,ts,['artist:b']).settings;
 assert.equal(count(ts,s,'A'),2);assert.equal(count(ts,s,'B'),3);
 assert.deepEqual(s.playlistMembership['artist:b'].included,['c-4.wav']);assert.equal(s.categoryStyles['artist:a'].name,'Artist A');
});
test('Chain A→B→C splits all three and restores source manual memberships/orders',()=>{
 const ts=tracks();let s=base();s.playlistMembership['artist:a']={included:['d-5.wav'],excluded:['a-1.wav']};
 s.trackOrders['artist:a']={manual:['d-5.wav','a-0.wav']};
 s=L.aliasArtist(s,ts,'artist:a','artist:b').settings;s=L.aliasArtist(s,ts,'artist:b','artist:c').settings;
 assert.equal(L.artistGroups(s,ts)[0].members.length,3);assert.equal(count(ts,s,'C'),6);
 s=L.splitArtistGroups(s,ts,['artist:c']).settings;
 assert.equal(count(ts,s,'A'),2);assert.equal(count(ts,s,'B'),2);assert.equal(count(ts,s,'C'),1);
 assert.deepEqual(s.trackOrders['artist:a'].manual,['d-5.wav','a-0.wav']);
 assert.deepEqual(s.playlistMembership['artist:a'].included,['d-5.wav']);assert.equal(s.artistAliasHistory.length,0);
});
test('Destination manual memberships present before an alias are not removed on split',()=>{
 const ts=tracks();let s=base();s.playlistMembership['artist:a']={included:['d-5.wav'],excluded:[]};s.playlistMembership['artist:b']={included:['d-5.wav'],excluded:[]};
 s=L.aliasArtist(s,ts,'artist:a','artist:b').settings;s=L.splitArtistGroups(s,ts,['artist:b']).settings;
 assert.ok(s.playlistMembership['artist:a'].included.includes('d-5.wav'));assert.ok(s.playlistMembership['artist:b'].included.includes('d-5.wav'));
});
test('Splitting one selected group leaves unrelated group rules, favorites and custom playlists intact',()=>{
 const ts=tracks();let s=base();s.favorites=['a-0.wav'];s.customCategories[0].tracks=['a-0.wav','d-5.wav'];
 s=L.aliasArtist(s,ts,'artist:a','artist:b').settings;s=L.aliasArtist(s,ts,'artist:d','artist:e').settings;
 s=L.splitSelectedArtists(s,ts,['a-0.wav','b-2.wav']).settings;
 assert.equal(s.artistAliases.d,'e');assert.equal(s.artistAliases.a,undefined);assert.equal(s.artistAliasHistory.length,1);
 assert.deepEqual(s.favorites,['a-0.wav']);assert.deepEqual(s.customCategories[0].tracks,['a-0.wav','d-5.wav']);
});
test('Mixed selection offers both merge and split; one already merged group offers only split',()=>{
 const ts=tracks();const s=L.aliasArtist(base(),ts,'artist:a','artist:b').settings;
 const mixed=L.selectionArtists(s,ts,['a-0.wav','b-2.wav','c-4.wav']);assert.equal(mixed.canAlias,true);assert.equal(mixed.canSplit,true);
 const same=L.selectionArtists(s,ts,['a-0.wav','b-2.wav']);assert.equal(same.canAlias,false);assert.equal(same.canSplit,true);
 const none=L.selectionArtists(base(),ts,['a-0.wav','a-1.wav']);assert.equal(none.canAlias,false);assert.equal(none.canSplit,false);
});
test('A subset selection aliases entire artists and their existing groups, not just chosen songs',()=>{
 const ts=tracks();let s=L.aliasArtist(base(),ts,'artist:a','artist:b').settings;
 const result=L.aliasSelectedArtists(s,ts,['a-0.wav','c-4.wav'],'artist:c');s=result.settings;
 assert.equal(count(ts,s,'C'),5);assert.equal(s.artistAliases.a,'c');assert.equal(s.artistAliases.b,'c');
 assert.equal(result.sourceKeys.length,1);assert.equal(count(ts,s,'D'),1);
});
test('Selection can merge a previously deleted artist tab without losing original tags',()=>{
 const ts=tracks();let s=base();s.categoryStyles['artist:a']={deleted:true};
 s=L.aliasSelectedArtists(s,ts,['a-0.wav','b-2.wav'],'artist:b').settings;
 assert.equal(count(ts,s,'B'),4);assert.equal(ts[0].artist,'A');
});
test('Rules and split information survive normalization/settings round trips',()=>{
 const ts=tracks();let s=L.aliasArtist(base(),ts,'artist:a','artist:b').settings;
 s=L.normalizeOrganization(clone(s));assert.equal(L.artistGroups(s,ts).length,1);
 s=L.splitArtistGroups(s,ts,['artist:b']).settings;s=L.normalizeOrganization(clone(s));
 assert.equal(L.artistGroups(s,ts).length,0);assert.equal(count(ts,s,'A'),2);
});
test('Bulk add is idempotent and adds missing favorites without toggling existing ones off',()=>{
 const ts=tracks();let s=base();s.favorites=['a-0.wav'];let r=L.bulkAdd(s,ts,'favorite',['A-0.wav','a-1.wav','a-1.wav']);
 assert.equal(r.added,1);assert.deepEqual(r.settings.favorites,['a-0.wav','a-1.wav']);
 r=L.bulkAdd(r.settings,ts,'favorite',['a-0.wav','a-1.wav']);assert.equal(r.added,0);
});
for(const key of ['all','favorite','recent','downloads','artist:c','custom:test'])test(`Bulk add works for ${key}`,()=>{
 const ts=tracks();const r=L.bulkAdd(base(),ts,key,['a-0.wav','b-2.wav']);
 assert.ok(ts.filter(L.membershipPredicate(r.settings,key)).length>=2);assert.equal(r.count,2);
});
test('Stale selections and invalid destinations are rejected atomically without modifying inputs',()=>{
 const ts=tracks(),s=base(),before=clone(s);
 assert.throws(()=>L.bulkAdd(s,ts,'favorite',['a-0.wav','missing.wav']));
 assert.throws(()=>L.aliasSelectedArtists(s,ts,['a-0.wav','b-2.wav'],'artist:missing'));
 assert.throws(()=>L.splitArtistGroups(s,ts,['artist:a']));assert.deepEqual(clone(s),before);
});
test('Deleted songs are also removed from saved inverse memberships',()=>{
 const ts=tracks();let s=base();s.playlistMembership['artist:a']={included:['d-5.wav'],excluded:[]};
 s=L.aliasArtist(s,ts,'artist:a','artist:b').settings;s=L.removeTrack(s,'d-5.wav');
 s=L.splitArtistGroups(s,ts.filter(t=>t.rel!=='D-5.wav'),['artist:b']).settings;
 assert.equal(s.playlistMembership['artist:a'].included.length,0);
});
withMain('All bulk organization IPC operations preserve the actual filesystem',async h=>{
 for(const [i,artist] of ['A','B','C'].entries())trackFile(h,`${i}.wav`,artist);
 const before=tree(h.api.paths.music);
 await h.invoke('library:organize',{type:'bulk-add',key:'favorite',rels:['0.wav','1.wav']});
 await h.invoke('library:organize',{type:'alias-selected',target:'artist:c',rels:['0.wav','1.wav']});
 assert.equal(h.api.getSettings().artistAliases.a,'c');
 await h.invoke('library:organize',{type:'split-selected',rels:['0.wav','1.wav']});
 assert.deepEqual(clone(h.api.getSettings().artistAliases),{});assert.deepEqual(tree(h.api.paths.music),before);
});
withMain('Bulk deletion uses Trash, preserves failures and commits only successful cleanup',async h=>{
 const a=trackFile(h,'a.wav','A'),b=trackFile(h,'b.wav','B'),c=trackFile(h,'c.wav','C');
 h.api.saveSettings({favorites:['a.wav','b.wav','c.wav'],customCategories:[{id:'custom:p',name:'P',tracks:['a.wav','b.wav','c.wav']}],trackOrders:{all:{manual:['a.wav','b.wav','c.wav']}}},{skipEffects:true});
 h.trashFailures.add(b);
 const r=await h.invoke('library:deleteMany',['a.wav','b.wav']);
 assert.deepEqual(clone(r.removed),['a.wav']);assert.equal(r.failed.length,1);assert.equal(r.ok,false);
 assert.equal(fs.existsSync(a),false);assert.equal(fs.existsSync(b),true);assert.equal(fs.existsSync(c),true);
 assert.deepEqual(clone(r.settings.favorites),['b.wav','c.wav']);assert.deepEqual(clone(r.settings.customCategories[0].tracks),['b.wav','c.wav']);
 assert.deepEqual(clone(r.settings.trackOrders.all.manual),['b.wav','c.wav']);assert.ok(h.trashed.includes(a+'.pulse.json'));assert.equal(h.trashed.includes(b+'.pulse.json'),false);
});
withMain('Bulk deletion validates the complete request before any filesystem action',async h=>{
 trackFile(h,'a.wav');await assert.rejects(()=>h.invoke('library:deleteMany',['a.wav','../outside.wav']));assert.equal(h.trashed.length,0);
});
withMain('Stale typed resize rectangles are rejected by native hit testing',h=>{
 h.api.setConfig({clickThroughWhenMinimized:true});Object.assign(h.point,{x:102,y:150});
 h.send('overlay:hit-regions',[{x:0,y:0,width:16,height:250,kind:'resize'}]);h.api.updateOverlayInteractivity();
 assert.equal(h.overlay.ignore,true);assert.equal(h.overlay.resizable,false);assert.equal(h.overlay.movable,false);
});
withMain('Effective preview permits geometry until explicit click-through override is enabled',h=>{
 h.api.setConfig({clickThroughWhenMinimized:true});h.api.setPreview(true);h.api.updateOverlayInteractivity();
 assert.equal(h.overlay.resizable,true);assert.equal(h.overlay.movable,true);
 h.api.setPreview(true,true);h.api.updateOverlayInteractivity();assert.equal(h.overlay.resizable,false);
 h.api.setPreview(false);h.api.updateOverlayInteractivity();assert.equal(h.overlay.resizable,false);
});
withMain('Enabling click-through cancels an in-progress resize without disabling transport',h=>{
 h.api.setConfig({clickThroughWhenMinimized:false});assert.equal(h.api.beginOverlayResize({edge:'e',screenX:500,screenY:200}),true);
 h.api.setConfig({clickThroughWhenMinimized:true});h.api.updateOverlayInteractivity();const before=clone(h.overlay.bounds);
 assert.equal(h.api.updateOverlayResize({screenX:900,screenY:200}),false);assert.deepEqual(clone(h.overlay.bounds),before);
 h.send('overlay:control',{action:'playPause'});assert.equal(h.main.messages.at(-1).value.action,'playPause');
});
