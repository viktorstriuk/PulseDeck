'use strict';
// Explicit selection is separate from the active playback/category state.
// Fast drag retains reordering; hold / Ctrl / Shift selects without a marquee.
window.PulsePlaylistSelection=class PulsePlaylistSelection{
  constructor({rails,zones=rails,onTakeGesture,onBlankPress=()=>{},onChange,onMenu,onFinish}){
    Object.assign(this,{rails,zones,onTakeGesture,onBlankPress,onChange,onMenu,onFinish});this.selected=new Set();this.pointer=null;this.anchor='';this.timer=0;this.frame=0;this.suppressUntil=0;
    for(const [index,rail] of rails.entries()){
      const zone=zones[index]||rail;
      zone.addEventListener('pointerdown',e=>this.down(e,rail),true);
      zone.addEventListener('pointermove',e=>this.move(e),true);
      zone.addEventListener('pointerup',e=>this.end(e,true),true);
      zone.addEventListener('pointercancel',e=>this.end(e,false),true);
      zone.addEventListener('lostpointercapture',e=>{if(this.pointer?.active)this.end(e,false);},true);
      zone.addEventListener('click',e=>{if(performance.now()<this.suppressUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
    }
    addEventListener('pointerup',e=>{if(this.pointer&&!this.pointer.active)this.end(e,true);});
    addEventListener('blur',()=>this.end(null,false));addEventListener('resize',()=>this.end(null,false));
    document.addEventListener('pointerdown',e=>{if(!e.target.closest('#contextMenu,.modal-layer,.ly-dialog')&&!this.withinZone(e))this.clear();});
    document.addEventListener('keydown',e=>{
      if(e.target.closest('input,textarea,select,[contenteditable="true"],.ly-dialog')||document.querySelector('.modal-layer:not(.hidden),.ly-dialog[open]')||document.body.classList.contains('lyrics-open'))return;
      if((e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10'))&&this.selected.size){e.preventDefault();e.stopImmediatePropagation();const node=rails.flatMap(r=>this.items(r)).find(n=>this.selected.has(n.dataset.category)&&n.getBoundingClientRect().height>0&&getComputedStyle(n).visibility==='visible');const rect=node?.getBoundingClientRect();this.onMenu([...this.selected],rect?.left||40,rect?.bottom||160);return;}
      if(e.key==='Escape'&&(this.selected.size||this.pointer)){e.preventDefault();e.stopImmediatePropagation();this.end(null,false);this.clear();}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'&&rails.some(r=>r.contains(document.activeElement))){e.preventDefault();e.stopImmediatePropagation();this.set(this.items(rails.find(r=>r.contains(document.activeElement))).map(n=>n.dataset.category));}
    },true);
  }
  withinZone(e){return this.zones.some(z=>{if(!z)return false;const r=z.getBoundingClientRect(),style=getComputedStyle(z);return style.visibility==='visible'&&style.display!=='none'&&r.width>0&&r.height>0&&e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;});}
  items(rail){return [...rail.querySelectorAll('[data-category]')];}
  set(keys){this.selected=new Set(keys);this.paint();}
  clear(){if(this.selected.size){this.selected.clear();this.paint();}}
  sync(keys){const allowed=new Set(keys);this.selected=new Set([...this.selected].filter(k=>allowed.has(k)));this.paint();}
  paint(){for(const r of this.rails)for(const n of this.items(r)){const selected=this.selected.has(n.dataset.category);n.classList.toggle('playlist-selected',selected);n.dataset.batchSelected=String(selected);}this.onChange([...this.selected]);}
  down(e,rail){
    if(e.button!==0||!e.isPrimary||this.pointer||e.target.closest('[data-category-drag],[data-add-category],[data-restore-category]'))return;
    const node=e.target.closest('[data-category]');if(!node&&e.target.closest('button,input,select,a,#hiddenCategories,.side-hidden-categories'))return;
    if(!node)this.onBlankPress();
    this.suppressUntil=0;const modified=e.ctrlKey||e.metaKey||e.shiftKey;
    this.pointer={id:e.pointerId,rail,node,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,lastX:e.clientX,lastY:e.clientY,
      mode:!node?'area':modified?'paint':'pending',additive:e.ctrlKey||e.metaKey,range:e.shiftKey,before:new Set(this.selected),active:false};
    if(node&&!modified)this.timer=setTimeout(()=>this.start(),340);
    else {e.preventDefault();e.stopImmediatePropagation();try{rail.setPointerCapture(e.pointerId);}catch{}}
  }
  start(){const p=this.pointer;if(!p||p.active)return;clearTimeout(this.timer);p.active=true;
    this.onTakeGesture();p.scrollX=p.rail.scrollLeft;p.scrollY=p.rail.scrollTop;
    const zone=this.zones[this.rails.indexOf(p.rail)]||p.rail,z=zone.getBoundingClientRect(),horizontal=getComputedStyle(p.rail).display==='flex';
    p.slots=this.items(p.rail).map(n=>{const r=n.getBoundingClientRect();return {key:n.dataset.category,rect:{left:horizontal?r.left:Math.min(r.left,z.left),right:horizontal?r.right:Math.max(r.right,z.right),top:horizontal?Math.min(r.top,z.top):r.top,bottom:horizontal?Math.max(r.bottom,z.bottom):r.bottom}};});
    this.selected=p.additive?new Set(p.before):new Set();
    if(p.node){this.selected.add(p.node.dataset.category);this.anchor=p.node.dataset.category;}
    if(p.mode==='pending')p.mode='paint';try{p.rail.setPointerCapture(p.id);}catch{}this.update();this.scroll();
  }
  move(e){const p=this.pointer;if(!p||p.id!==e.pointerId)return;p.x=e.clientX;p.y=e.clientY;
    if(!p.active&&Math.hypot(p.x-p.startX,p.y-p.startY)<6)return;
    if(!p.active&&p.mode==='pending'){clearTimeout(this.timer);this.pointer=null;return;}
    if(!p.active)this.start();e.preventDefault();e.stopImmediatePropagation();this.update();
  }
  update(){const p=this.pointer;if(!p?.active)return;const x=p.x+p.rail.scrollLeft-p.scrollX,y=p.y+p.rail.scrollTop-p.scrollY;
    if(p.mode==='area'){
      this.selected=p.additive?new Set(p.before):new Set();const r={left:Math.min(x,p.startX),right:Math.max(x,p.startX),top:Math.min(y,p.startY),bottom:Math.max(y,p.startY)};
      for(const it of p.slots)if(r.left<it.rect.right&&r.right>it.rect.left&&r.top<it.rect.bottom&&r.bottom>it.rect.top)this.selected.add(it.key);
    }else for(const it of p.slots)if(window.PulseTrackSelection.prototype.segmentHits(p.lastX,p.lastY,x,y,it.rect))this.selected.add(it.key);
    p.lastX=x;p.lastY=y;this.paint();
  }
  scroll(){const p=this.pointer;if(!p?.active)return;const r=p.rail.getBoundingClientRect(),horizontal=getComputedStyle(p.rail).display==='flex',n=horizontal?p.x:p.y,low=horizontal?r.left:r.top,high=horizontal?r.right:r.bottom;
    const speed=n<low+32?-Math.min(12,(low+32-n)/4):n>high-32?Math.min(12,(n-high+32)/4):0;
    if(speed){if(horizontal)p.rail.scrollLeft+=speed;else p.rail.scrollTop+=speed;this.update();}this.frame=requestAnimationFrame(()=>this.scroll());
  }
  end(e,commit){const p=this.pointer;if(!p||(e&&e.pointerId!==p.id))return;this.pointer=null;clearTimeout(this.timer);cancelAnimationFrame(this.frame);
    if(p.active){if(!commit)this.selected=p.before;this.suppressUntil=performance.now()+400;this.paint();if(e){e.preventDefault();e.stopImmediatePropagation();}
      try{if(p.rail.hasPointerCapture(p.id))p.rail.releasePointerCapture(p.id);}catch{}
      if(commit&&this.selected.size)this.onMenu([...this.selected],p.x,p.y);
    }else if(commit&&p.mode==='paint'&&p.node){const key=p.node.dataset.category;
      if(p.range&&this.anchor){const keys=this.items(p.rail).map(n=>n.dataset.category),a=keys.indexOf(this.anchor),b=keys.indexOf(key);this.set(a<0?[key]:keys.slice(Math.min(a,b),Math.max(a,b)+1));}
      else {this.selected=new Set(p.before);this.selected.has(key)?this.selected.delete(key):this.selected.add(key);this.anchor=key;this.paint();}
      this.suppressUntil=performance.now()+350;if(e){e.preventDefault();e.stopImmediatePropagation();}
    }else if(commit&&p.mode==='area')this.clear();try{if(p.rail.hasPointerCapture(p.id))p.rail.releasePointerCapture(p.id);}catch{}this.onFinish();
  }
};
