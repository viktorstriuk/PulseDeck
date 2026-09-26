'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const Icon=require('../app/shared/app-icon');
const {harness}=require('./main-harness');
const root=path.resolve(__dirname,'..');
const hm=(name,fn)=>test(name,async()=>{const h=harness();try{await fn(h);}finally{h.close();}});
test('271 editor and standalone vector use the same recovered ORIGINAL music mark',()=>{
  const svg=fs.readFileSync(path.join(root,'app/assets/app-icons/monitor-mark.svg'),'utf8');
  assert.ok(svg.includes(`d="${Icon.markPath}"`));assert.ok(Icon.build().includes(`d="${Icon.markPath}"`));
  assert.ok(Icon.markSvg().includes(`d="${Icon.markPath}"`));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'design-source/monitor-mark-provenance.json'))).original_svg_found,false);
});
test('271 custom icon uses four background colours and one white glyph by default',()=>{
  const d=Icon.normalize();assert.equal(d.bg.length,4);assert.equal(d.fg.length,1);assert.equal(d.fg[0].color,'#ffffff');
});
test('271 gradient positions sort in SVG without mutating the user draft',()=>{
  const draft={bg:[{color:'#aabbcc',pos:75},{color:'#223344',pos:20}],fg:[{color:'#ffffff',pos:0}]};
  const before=JSON.stringify(draft),svg=Icon.build(draft);assert.ok(svg.indexOf('offset="20%"')<svg.indexOf('offset="75%"'));assert.equal(JSON.stringify(draft),before);
});
test('271 mark geometry never changes when recolouring it with 1–4 foreground colours',()=>{
  for(let count=1;count<=4;count++)assert.ok(Icon.build({bg:[{color:'#ffffff',pos:0},{color:'#aaaaaa',pos:100}],fg:Array.from({length:count},(_,i)=>({color:['#000000','#cceeaa','#aabbff','#ee0044'][i],pos:i*25}))}).includes(`d="${Icon.markPath}"`));
});
test('271 icon generator validates colour strings and finite positions before SVG interpolation',()=>{
  const d=Icon.normalize({bg:Array.from({length:20},()=>({color:'"/><script>alert(1)</script>',pos:Infinity})),fg:[]});
  assert.equal(d.bg.length,7);assert.equal(d.fg.length,1);assert.ok(d.bg.every(s=>s.color==='#ffffff'&&s.pos===0));assert.ok(!Icon.build(d).includes('<script>'));
});
test('271 new presets keep full 512px artwork; native ICO variants exist',()=>{
  for(const n of ['sky','coral','lime','noir']){
    const png=fs.readFileSync(path.join(root,`app/assets/app-icons/${n}-monitor.png`));assert.equal(png.readUInt32BE(16),512);assert.equal(png.readUInt32BE(20),512);
    const ico=fs.readFileSync(path.join(root,`app/assets/app-icons/${n}-monitor.ico`));assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),7);
  }
});
hm('271 changing panel style preserves library, gradients and hotkeys',async h=>{
  const before=h.api.getSettings();await h.invoke('settings:set',{surfaceStyle:'translucent',surfaceOpacity:0,surfaceBorderColor:'#112233',surfaceBorderThickness:6,surfaceBorderOpacity:100});
  const after=h.api.getSettings();for(const key of ['favorites','customCategories','trackOrders','hotkeys','appIcon','language'])assert.equal(JSON.stringify(after[key]),JSON.stringify(before[key]));
  assert.equal(after.surfaceOpacity,0);assert.equal(after.surfaceBorderThickness,6);
});
hm('271 migration marker is persisted and untrusted values are bounded',async h=>{
  await h.invoke('settings:set',{appIconMarkVersion:1});assert.equal(h.api.getSettings().appIconMarkVersion,1);
  assert.equal(h.api.normalizeSettings({appIconMarkVersion:Infinity}).appIconMarkVersion,0);assert.equal(h.api.normalizeSettings({appIconMarkVersion:-1}).appIconMarkVersion,0);
});
hm('271 surface snapshot flush persists the last slider position',async h=>{
  const event={};h.ipc.emit('settings:flush',event,{surfaceOpacity:37,surfaceBorderOpacity:83,surfaceBorderThickness:5.5});
  assert.equal(event.returnValue,true);assert.equal(h.api.getSettings().surfaceOpacity,37);assert.equal(h.api.getSettings().surfaceBorderThickness,5.5);
});
test('271 surface styles never use the customizable width for layout borders',()=>{
  const css=fs.readFileSync(path.join(root,'app/renderer/surfaces.css'),'utf8');assert.doesNotMatch(css,/border(?:-width)?:[^;{}]*var\(--surface-(?:border|effective)-width/);
  assert.match(css,/box-shadow:inset/);assert.match(css,/\.library\.list-view/);assert.match(css,/\.playlist-drag-from-sidebar/);
});
