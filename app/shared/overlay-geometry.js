'use strict';
// Electron screen/window coordinates are DIPs. Saved bounds use the entire
// monitor, including its taskbar; workArea is only a default-placement hint.
function finite(value, fallback) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function overlap(a,b) { return Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)); }
function restore(config={}, displays=[], primary=displays[0]) {
  displays=displays.map(d=>({...d,bounds:d.bounds||d.workArea}));
  primary=primary?{...primary,bounds:primary.bounds||primary.workArea}:displays[0];
  if(!primary?.bounds) throw new Error('No display available');
  const saved=config.bounds;
  const valid=saved && ['x','y','width','height'].every(k=>typeof saved[k]==='number'&&Number.isFinite(saved[k])) && saved.width>0 && saved.height>0;
  let display=primary;
  if(valid){
    // Prefer the display actually containing the window, not a stale ID after
    // docking. This also preserves negative coordinates on secondary monitors.
    const ranked=displays.map(d=>({d,area:overlap(saved,d.bounds)})).sort((a,b)=>b.area-a.area);
    if(ranked[0]?.area>0)display=ranked[0].d;
    else display=displays.find(d=>String(d.id)===String(config.displayId))||primary;
  }
  const area=valid?display.bounds:(display.workArea||display.bounds);
  const width=Math.round(Math.min(area.width,Math.max(180,finite(valid?saved.width:config.width,430))));
  const height=Math.round(Math.min(area.height,Math.max(38,finite(valid?saved.height:config.height,122))));
  const x=valid?saved.x:area.x+area.width-width-24;
  const y=valid?saved.y:area.y+area.height-height-24;
  return {x:Math.round(Math.max(area.x,Math.min(area.x+area.width-width,x))),y:Math.round(Math.max(area.y,Math.min(area.y+area.height-height,y))),width,height};
}
module.exports={restore,overlap};
