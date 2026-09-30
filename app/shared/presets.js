/* Presets are appearance/behaviour profiles, not user libraries or credentials.
 * The same explicit schema drives the renderer and the trusted main process. */
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.PulsePresets=value;})(globalThis,()=>{
  'use strict';
  const SECTIONS=Object.freeze({
    appearance:['theme','accent','customAccent','backgroundMode','customBackground','backgroundHistory','backgroundOpacity','appIcon','customIconStyle','appIconMarkVersion','surfaceStyle','surfaceOpacity','surfaceBorderColor','surfaceBorderOpacity','surfaceBorderThickness','surfaceApplyAll','surfaceProfiles'],
    player:['playerOverlay'],games:['gameOverlay'],hotkeys:['hotkeys'],
    library:['view','sort','categoryLayout','menuOrders'],language:['language'],
    playback:['volume','lyricsDisplay','lyricsLastGradient'],search:['onlineSearch'],updates:[],
  });
  const EXTERNAL=Object.freeze({search:['discoveryEnabled'],updates:['automatic','prerelease','components','intervalMinutes','intervalUnit']});
  const clone=x=>JSON.parse(JSON.stringify(x)),plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
  const selection=value=>Array.isArray(value)?[...new Set(value.filter(k=>Object.hasOwn(SECTIONS,k)))]:[];
  function capture(settings,external,sections){
    const selected=selection(sections),data={},extras={};
    for(const section of selected){for(const k of SECTIONS[section])data[k]=settings[k]===undefined?null:clone(settings[k]);for(const k of EXTERNAL[section]||[])if(Object.hasOwn(external,k))extras[k]=clone(external[k]);}
    return {sections:selected,settings:data,external:extras};
  }
  function cleanPreset(p){
    if(!plain(p)||typeof p.id!=='string'||!/^[a-f0-9-]{36}$/.test(p.id))return null;
    const name=typeof p.name==='string'?p.name.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,60):'';
    const safe=capture(plain(p.settings)?p.settings:{},plain(p.external)?p.external:{},p.sections);
    if(!name||!safe.sections.length||JSON.stringify(safe).length>2*1024*1024)return null;
    return {id:p.id,name,createdAt:Number(p.createdAt)||0,updatedAt:Number(p.updatedAt)||0,...safe};
  }
  function normalize(raw={}){const list=Array.isArray(raw?.presets)?raw.presets:[],ids=new Set();return {schema:1,presets:list.map(cleanPreset).filter(p=>p&&!ids.has(p.id)&&ids.add(p.id)).slice(0,100)};}
  return {SECTIONS,EXTERNAL,selection,capture,cleanPreset,normalize};
});
