'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../app/shared/surface-style');
const {harness}=require('./main-harness');
const legacy={surfaceStyle:'gradient',surfaceOpacity:59,surfaceBorderColor:'#AABBCC',surfaceBorderOpacity:28,surfaceBorderThickness:.5};
test('282 missing profile settings migrate to independent mode without visual changes',()=>{
 const s=S.normalize(legacy);assert.equal(s.surfaceApplyAll,false);assert.deepEqual(s.surfaceProfiles,{});
 for(const group of S.groups)assert.deepEqual(S.current(s,group),S.profile(legacy));
});
for(const group of S.groups)test(`282 ${group} edits are isolated and seed a full snapshot`,()=>{
 const s=S.normalize(legacy),result=S.update(s,group,{surfaceOpacity:25});
 assert.equal(result.surfaceOpacity,59);assert.equal(result.surfaceProfiles[group].surfaceOpacity,25);assert.equal(result.surfaceProfiles[group].surfaceStyle,'gradient');
 for(const other of S.groups)if(other!==group)assert.deepEqual(S.current(result,other),S.profile(legacy));
 assert.deepEqual(s.surfaceProfiles,{});assert.equal(S.current(result,group).surfaceBorderColor,'#aabbcc');
});
test('282 common mode is temporary and preserves independent customizations',()=>{
 let s=S.update(S.normalize(legacy),'blocks',{surfaceOpacity:25});s.surfaceApplyAll=true;s=S.update(s,'blocks',{surfaceOpacity:83});
 for(const g of S.groups)assert.equal(S.current(s,g).surfaceOpacity,83);
 s.surfaceApplyAll=false;assert.equal(S.current(s,'blocks').surfaceOpacity,25);assert.equal(S.current(s,'menus').surfaceOpacity,83);
});
test('282 restore common deletes one override, factory reset uses a new snapshot',()=>{
 let s=S.update(S.normalize(legacy),'blocks',{surfaceOpacity:25});s=S.update(s,'contextMenus',{surfaceStyle:'outline'});
 s=S.resetToCommon(s,'blocks');assert.equal(S.current(s,'blocks').surfaceOpacity,59);assert.equal(S.current(s,'contextMenus').surfaceStyle,'outline');
 s=S.update(s,'blocks',S.defaults);assert.deepEqual(S.current(s,'blocks'),S.defaults);assert.equal(s.surfaceOpacity,59);
});
for(const value of [null,[],false,0,'unsafe',undefined])test(`282 malformed root ${String(value)} safely uses defaults`,()=>{
 assert.deepEqual(S.normalize(value),{...S.defaults,surfaceApplyAll:false,surfaceProfiles:{}});
});
for(const value of [null,[],false,'unsafe',42])test(`282 malformed profile ${String(value)} safely inherits common`,()=>{
 const s=S.normalize({...legacy,surfaceProfiles:{blocks:value,unknown:{surfaceOpacity:99}}});assert.deepEqual(S.current(s,'blocks'),S.profile(legacy));assert.deepEqual(s.surfaceProfiles,{});
});
test('282 nested numeric, mode and colour values are sanitized before CSS',()=>{
 const s=S.normalize({...legacy,surfaceApplyAll:'true',surfaceProfiles:{blocks:{surfaceStyle:'url(unsafe)',surfaceOpacity:999,surfaceBorderOpacity:-7,surfaceBorderThickness:Infinity,surfaceBorderColor:'red);url(unsafe)'},menus:{surfaceOpacity:null,surfaceBorderThickness:99}}});
 assert.equal(s.surfaceApplyAll,false);assert.equal(s.surfaceProfiles.blocks.surfaceOpacity,100);assert.equal(s.surfaceProfiles.blocks.surfaceBorderOpacity,0);assert.equal(s.surfaceProfiles.blocks.surfaceBorderThickness,.5);assert.equal(s.surfaceProfiles.blocks.surfaceStyle,'gradient');
 assert.equal(s.surfaceProfiles.blocks.surfaceBorderColor,'#aabbcc');assert.equal(s.surfaceProfiles.menus.surfaceOpacity,59);assert.equal(s.surfaceProfiles.menus.surfaceBorderThickness,6);assert.ok(!JSON.stringify(S.tokens(s.surfaceProfiles.blocks)).includes('unsafe'));
});
test('282 unknown and prototype profile names cannot escape group allowlist',()=>{
 const s=S.normalize(JSON.parse('{"surfaceProfiles":{"__proto__":{"polluted":true},"constructor":{},"windows":{"surfaceOpacity":42}}}'));
 assert.deepEqual(Object.keys(s.surfaceProfiles),['windows']);assert.equal({}.polluted,undefined);
});
test('282 zero-opacity glass has no blur; outline and invisible have no fill',()=>{
 assert.equal(S.tokens({...S.defaults,surfaceOpacity:0})['panel-filter'],'none');
 for(const style of ['outline','invisible']){const t=S.tokens({...S.defaults,surfaceStyle:style});assert.equal(t['panel-bg'],'transparent');assert.equal(t['panel-filter'],'none');assert.equal(t['panel-gradient'],'none');}
 assert.equal(S.tokens({...S.defaults,surfaceStyle:'invisible'})['surface-effective-width'],'0px');
});
test('282 scope stylesheet is bounded and reuses group tokens, not per-node watchers',()=>{
 const css=S.scopeCSS();for(const g of S.groups){assert.ok(css.includes(`--pd-${g}-panel-bg`));assert.ok(S.selectors[g]);}
 assert.equal(css.split('{').length-1,7);assert.ok(css.length<10000);
});
test('282 settings IPC and synchronous flush retain all groups, with unrelated data intact',async()=>{
 const h=harness();try{
 const before=h.api.getSettings();let patch=S.normalize(legacy);
 for(const [i,g]of S.groups.entries())patch=S.update(patch,g,{surfaceOpacity:10+i});
 await h.invoke('settings:set',patch);let saved=h.api.getSettings();
 for(const [i,g]of S.groups.entries())assert.equal(saved.surfaceProfiles[g].surfaceOpacity,10+i);
 for(const key of ['favorites','customCategories','trackOrders','hotkeys','appIcon','language'])assert.equal(JSON.stringify(saved[key]),JSON.stringify(before[key]));
 const event={};patch=S.update(patch,'contextMenus',{surfaceBorderThickness:5.5});h.ipc.emit('settings:flush',event,patch);
 assert.equal(event.returnValue,true);assert.equal(h.api.getSettings().surfaceProfiles.contextMenus.surfaceBorderThickness,5.5);
 }finally{h.close();}
});
test('282 main-process normalization validates profile payloads',()=>{const h=harness();try{
 const s=h.api.normalizeSettings({...legacy,surfaceProfiles:{windows:{surfaceOpacity:-100},blocks:{surfaceBorderThickness:500},invented:{surfaceStyle:'invisible'}}});
 assert.equal(s.surfaceProfiles.windows.surfaceOpacity,0);assert.equal(s.surfaceProfiles.blocks.surfaceBorderThickness,6);assert.equal(s.surfaceProfiles.invented,undefined);
 }finally{h.close();}});
test('282 app theme changes leave Electron OS theme observation in system mode',async()=>{const h=harness();try{
 for(const theme of ['sand','forest','system','ocean']){await h.invoke('settings:set',{theme});assert.equal(h.electron.nativeTheme.themeSource,'system');assert.equal(h.api.getSettings().theme,theme);}
 }finally{h.close();}});
