'use strict';
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.PulseLibraryFolders=value;})(globalThis,()=>{
  const record=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
  const token=x=>String(x||'').replaceAll('\\','/').toLowerCase();
  const validId=id=>/^folder:[a-f0-9]{32}$/.test(id||'');
  function safeDirectory(dir){return typeof dir==='string'&&dir.length>0&&dir.length<=120&&!/[<>:"/\\|?*\x00-\x1f]/.test(dir)&&!dir.startsWith('.')&&!/[. ]$/.test(dir)&&!(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(dir));}
  function normalize(raw){const ids=new Set(),dirs=new Set();return (Array.isArray(raw)?raw:[]).filter(f=>{
    if(!f||!validId(f.id)||!safeDirectory(f.dir)||ids.has(f.id)||dirs.has(token(f.dir)))return false;ids.add(f.id);dirs.add(token(f.dir));return true;
  }).slice(0,250).map(f=>({...f,name:String(f.name||f.dir).slice(0,40),icon:typeof f.icon==='string'?f.icon.slice(0,100):'folder',color:/^#[a-f0-9]{6}$/i.test(f.color||'')?f.color:'#7890b9',glow:!!f.glow,glowIntensity:Math.max(0,Math.min(100,Number(f.glowIntensity)||45)),gradient:(Array.isArray(f.gradient)?f.gradient:[]).filter(c=>/^#[a-f0-9]{6}$/i.test(c)).slice(0,4)}));}
  function split(key){const match=/^(folder:[a-f0-9]{32})\|(.+)$/.exec(String(key||''));return match?{folderId:match[1],base:match[2]}:{folderId:'',base:String(key||'')};}
  function scoped(folderId,key){return String(key).startsWith('custom:')?key:folderId?`${folderId}|${split(key).base}`:split(key).base;}
  function ofTrack(track,settings){const rel=token(track?.rel);if(rel.startsWith('vault:'))return ofCategory(track.vaultKey,settings);return (settings.libraryFolders||[]).find(f=>rel.startsWith(token(f.dir)+'/'))?.id||'';}
  function ofCategory(key,settings){return split(key).folderId||(settings.customCategories||[]).find(c=>c.id===key)?.folderId||'';}
  function aliases(settings,folderId){return folderId?record(settings.folderArtistAliases?.[folderId]):record(settings.artistAliases);}
  function names(settings,folderId){return folderId?record(settings.folderArtistNames?.[folderId]):record(settings.artistNames);}
  function aliasState(settings,folderId){
    if(!folderId)return {aliases:settings.artistAliases,names:settings.artistNames,history:settings.artistAliasHistory};
    settings.folderArtistAliases||={};settings.folderArtistNames||={};settings.folderArtistAliasHistory||={};
    return {aliases:settings.folderArtistAliases[folderId]||=(Object.create(null)),names:settings.folderArtistNames[folderId]||=(Object.create(null)),history:settings.folderArtistAliasHistory[folderId]||=[]};
  }
  // Public relative paths only. Never rewrite arbitrary strings (playlist names,
  // appearance paths, secrets, encrypted manifests and URLs are not track refs).
  function remap(settings,moves){
    const next=JSON.parse(JSON.stringify(settings)),map=new Map(moves.map(m=>[token(m.from),m.to]));
    const rel=x=>map.has(token(x))?map.get(token(x)):x;
    const list=a=>[...new Set((Array.isArray(a)?a:[]).map(rel).map(token))];
    next.favorites=list(next.favorites);next.lastTrack=rel(next.lastTrack||'');
    for(const c of next.customCategories||[])c.tracks=list(c.tracks);
    for(const p of Object.values(next.playlistMembership||{})){p.included=list(p.included);p.excluded=list(p.excluded);}
    for(const orders of Object.values(next.trackOrders||{}))for(const sort of Object.keys(orders))orders[sort]=list(orders[sort]);
    for(const history of [next.artistAliasHistory||[],...Object.values(next.folderArtistAliasHistory||{})])for(const h of history){h.added=list(h.added);h.membership={included:list(h.membership?.included),excluded:list(h.membership?.excluded)};for(const sort of Object.keys(h.orders||{}))h.orders[sort]=list(h.orders[sort]);}
    next.coverAnimation=Object.fromEntries(Object.entries(next.coverAnimation||{}).map(([r,v])=>[token(rel(r)),v]));
    return next;
  }
  return {normalize,safeDirectory,validId,split,scoped,ofTrack,ofCategory,aliases,names,aliasState,remap};
});
