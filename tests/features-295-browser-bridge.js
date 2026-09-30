/* 2.9.5 deterministic IPC fixtures. Backend transactions, encryption and real
 * FFmpeg are tested in features-295.test.js, not substituted by these fixtures. */
(() => {
 const clone=x=>structuredClone(x),m=window.__mock;
 const old=pulse.library.command,lyrics=pulse.lyrics.command;
 m.settings.libraryFolders||=[];m.settings.menuOrders||={};m.presets=[];m.presetCalls=[];
 pulse.library.command=async c=>{
  const L=window.PulseLibrary,F=L.Folders;
  if(c.type==='cover-animation'){const track=m.tracks.find(t=>t.rel===c.rel);track.animateCover=c.enabled;m.settings.coverAnimation||={};m.settings.coverAnimation[L.token(c.rel)]=c.enabled;return {ok:true,enabled:c.enabled};}
  if(c.type==='loudness')return {results:c.rels.map((rel,i)=>({rel,value:-34+i*2}))};
  if(c.type==='loudness-cancel')return {ok:true};
  if(c.type==='folder-save'){
   const s=L.normalizeOrganization(m.settings);let f=s.libraryFolders.find(x=>x.id===c.id);
   if(!f){f={id:'folder:'+String(s.libraryFolders.length+1).padStart(32,'0'),dir:c.style.name};s.libraryFolders.push(f);}
   Object.assign(f,c.style);const result=L.normalizeOrganization(s);m.settings=result;return {ok:true,folder:f,settings:L.organizationPatch(result)};
  }
  if(c.type==='folder-move'){
   const f=m.settings.libraryFolders.find(f=>f.id===c.targetFolder),from=F.ofCategory(c.sourceKey,m.settings),source=m.settings.libraryFolders.find(f=>f.id===from);
   const selected=m.tracks.filter(L.membershipPredicate(m.settings,c.sourceKey)),moves=selected.map(t=>({from:t.rel,to:(f?f.dir+'/':'')+(source?t.rel.slice(source.dir.length+1):t.rel)}));
   m.settings=F.remap(m.settings,moves);for(const t of selected)t.rel=moves.find(v=>v.from===t.rel).to;
   if(c.movePlaylist)for(const cat of m.settings.customCategories)if(cat.id===c.sourceKey||(F.split(c.sourceKey).base==='all'&&(cat.folderId||'')===from))cat.folderId=c.targetFolder;
   return {ok:true,moves,count:moves.length,targetKey:c.movePlaylist?F.scoped(c.targetFolder,c.sourceKey):F.scoped(c.targetFolder,'all'),settings:L.organizationPatch(m.settings),coverAnimation:m.settings.coverAnimation,lastTrack:m.settings.lastTrack};
  }
  if(c.type==='folder-delete'){m.settings.libraryFolders=m.settings.libraryFolders.filter(f=>f.id!==c.id);return {ok:true,settings:L.organizationPatch(m.settings)};}
  return old(c);
 };
 function background(c){
  const prev=m.lyrics.records[c.rel];if((prev?.revision||null)!==(c.revision||null))throw Error('TEST_STALE_REVISION');
  const r={...(prev||{}),theme:PulseLyrics.theme({...prev?.theme,mode:'custom',customBackground:'custom-'+'a'.repeat(64)+'.webm'}),revision:'bg-'+Date.now(),background:{url:new URL('../../tests/fixtures/artwork-294.webm',document.baseURI).href,type:'video/webm'}};
  m.lyrics.records[c.rel]=r;return clone(r);
 }
 pulse.lyrics.command=async c=>c.type==='background-pick'?background(c):lyrics(c);
 pulse.lyrics.backgroundFromDrop=async(file,rel,revision)=>background({rel,revision});
 pulse.presets={command:async c=>{
  m.presetCalls.push(clone(c));const M=window.PulsePresets;
  if(c.type==='list')return clone(m.presets);
  if(c.type==='save'){
   const id=c.id||'00000000-0000-4000-8000-'+String(m.presets.length+1).padStart(12,'0');
   m.presets=m.presets.filter(p=>p.id!==id);m.presets.push({id,name:c.name,createdAt:Date.now(),updatedAt:Date.now(),...M.capture(m.settings,{},c.sections)});return clone(m.presets);
  }
  if(c.type==='rename'){m.presets.find(p=>p.id===c.id).name=c.name;return clone(m.presets);}
  if(c.type==='delete'){m.presets=m.presets.filter(p=>p.id!==c.id);return clone(m.presets);}
  if(c.type==='apply'){const p=m.presets.find(p=>p.id===c.id);await pulse.settings.set(p.settings);return {settings:clone(m.settings),warnings:[]};}
  throw Error('Unexpected preset command');
 }};
})();
