'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {harness}=require('./main-harness');
const withMain=(name,fn)=>test(name,async()=>{const h=harness();try{await fn(h);}finally{h.close();}});
withMain('270 appearance fields persist through settings IPC',async h=>{
 const patch={surfaceStyle:'outline',surfaceOpacity:0,surfaceBorderColor:'#abc123',surfaceBorderOpacity:36,surfaceBorderThickness:2.5};
 await h.invoke('settings:set',patch);const saved=await h.invoke('settings:get');for(const [k,v]of Object.entries(patch))assert.equal(saved[k],v,k);
});
withMain('270 appearance input validation clamps finite values and rejects invalid styles',async h=>{
 const s=h.api.normalizeSettings({surfaceStyle:'<bad>',surfaceOpacity:200,surfaceBorderOpacity:-4,surfaceBorderThickness:Infinity,surfaceBorderColor:'url(evil)'});
 assert.equal(s.surfaceStyle,'glass');assert.equal(s.surfaceOpacity,100);assert.equal(s.surfaceBorderOpacity,0);assert.equal(s.surfaceBorderThickness,1);assert.equal(s.surfaceBorderColor,'#d9e5f0');
});
withMain('270 custom icon draft persists with bounded safe colour stops',async h=>{
 const draft={bg:[{color:'#ff0011',pos:0},{color:'#0022ff',pos:100}],fg:[{color:'#ffffff',pos:0}]};
 await h.invoke('settings:set',{customIconStyle:draft});assert.equal(JSON.stringify(h.api.getSettings().customIconStyle),JSON.stringify(draft));
 const invalid=h.api.normalizeSettings({customIconStyle:{bg:[{color:'<svg>',pos:NaN}],fg:[]}});assert.equal(invalid.customIconStyle,null);
});
withMain('270 generated icon accepts PNG raster, writes native ICO and safely resolves path',async h=>{
 const png=fs.readFileSync(path.join(__dirname,'fixtures/custom-icon-256.png'));
 const image={isEmpty:()=>false,toPNG:()=>png,resize(){return this;}};h.electron.nativeImage.createFromDataURL=()=>image;
 const r=await h.invoke('appearance:saveGeneratedIcon','../../evil','data:image/png;base64,'+png.toString('base64'));
 assert.match(r.ref,/^custom-icons\/[a-f0-9]{24}\.png$/);assert.equal(r.ok,true);
 const full=path.join(h.api.paths.data,'appearance',r.ref);assert.ok(fs.existsSync(full));assert.ok(fs.existsSync(full+'.ico'));
 await h.invoke('settings:set',{appIcon:r.ref});assert.equal(h.api.getSettings().appIcon,r.ref);
 assert.ok((await h.invoke('appearance:iconUrl',r.ref)).endsWith(r.ref));
});
withMain('270 generated icon rejects SVG, huge image and path traversal references',async h=>{
 await assert.rejects(h.invoke('appearance:saveGeneratedIcon','x','<svg onload="evil()"/>'));
 await assert.rejects(h.invoke('appearance:saveGeneratedIcon','x','data:image/png;base64,'+'a'.repeat(3*1024*1024)));
 assert.equal(h.api.normalizeSettings({appIcon:'custom-icons/../../../secret.png'}).appIcon,'builtin:blue-violet');
});
withMain('270 new shortcut defaults and overrides survive normalization',async h=>{
 for(const name of ['toggleShuffle','cycleRepeat','favoriteCurrent','focusSearch','openImport','trimCurrentTrack'])assert.ok(h.api.getSettings().hotkeys[name],name);
 await h.invoke('settings:set',{hotkeys:{openImport:'Ctrl+Alt+I',trimCurrentTrack:''}});
 assert.equal(h.api.getSettings().hotkeys.openImport,'Ctrl+Alt+I');assert.equal(h.api.getSettings().hotkeys.trimCurrentTrack,'');assert.equal(h.api.getSettings().hotkeys.toggleClickThrough,'Alt+Shift+P');
});
test('270 each builtin icon has both PNG and ICO under the names used by main',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../app/main.js'),'utf8');const list=s.match(/const BUILTIN_APP_ICON_NAMES = \[(.*?)\]/)[1].match(/'([^']+)'/g).map(s=>s.slice(1,-1));
 for(const name of list)for(const ext of ['png','ico'])assert.ok(fs.existsSync(path.join(__dirname,`../app/assets/app-icons/${name}-monitor.${ext}`)));
});
