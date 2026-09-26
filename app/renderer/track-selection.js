'use strict';

// Selection owns the pointer only after an explicit gesture: drag empty space,
// hold a track briefly, or use Ctrl/Shift. A quick drag on a track still reorders.
// No marquee is painted: the selected tracks themselves are the feedback.
window.PulseTrackSelection = class PulseTrackSelection {
  constructor({container,scroller,onTakeGesture,onStart,onFinish,onChange,onMenu}) {
    Object.assign(this,{container,scroller,onTakeGesture,onStart,onFinish,onChange,onMenu});
    this.selected = new Set(); this.pointer = null; this.anchor = null;
    this.frame = 0; this.timer = 0; this.suppressUntil = 0; this.context = '';
    scroller.addEventListener('pointerdown',e=>this.down(e),true);
    scroller.addEventListener('pointermove',e=>this.move(e),true);
    scroller.addEventListener('pointerup',e=>this.end(e,true),true);
    scroller.addEventListener('pointercancel',e=>this.end(e,false),true);
    scroller.addEventListener('lostpointercapture',e=>{if(this.pointer?.active)this.end(e,false);},true);
    scroller.addEventListener('click',e=>{
      const inSelectionSurface=this.container.contains(e.target)||e.target===this.scroller||e.target.closest('#dropHint');
      if(inSelectionSurface&&performance.now()<this.suppressUntil){e.preventDefault();e.stopImmediatePropagation();}
    },true);
    addEventListener('pointerup',e=>{if(this.pointer&&!this.pointer.active)this.end(e,true);});
    addEventListener('blur',()=>this.end(null,false));
    addEventListener('resize',()=>this.end(null,false));
    document.addEventListener('keydown',e=>{
      if (document.body.classList.contains('lyrics-open') || e.target.closest('input,textarea,select,[contenteditable="true"]') || document.querySelector('.ly-dialog[open],.modal-layer:not(.hidden)')) return;
      if (e.key==='Escape' && (this.pointer?.active || this.selected.size)) {
        e.preventDefault();e.stopImmediatePropagation();this.end(null,false);this.clear();
      } else if ((e.ctrlKey||e.metaKey) && !e.altKey && e.key.toLowerCase()==='a' && !document.activeElement?.closest('#categoryChips,#categorySidebar')) {
        e.preventDefault();this.set(this.items().map(n=>n.dataset.id));
      }
    },true);
    document.addEventListener('pointerdown',e=>{
      if (e.target.closest('#contextMenu,.modal-layer,#trackSelectionStatus')) return;
      if (!scroller.contains(e.target)) this.clear();
    });
  }
  items(){return [...this.container.querySelectorAll('[data-track-root]')];}
  get active(){return !!this.pointer?.active;}
  set(ids){this.selected=new Set(ids);this.paint();}
  clear(){this.set([]);}
  paint(){
    const nodes=this.items();
    for (const [i,n] of nodes.entries()) {
      const selected=this.selected.has(n.dataset.id);
      n.classList.toggle('selection-start',selected && !this.selected.has(nodes[i-1]?.dataset.id));
      n.classList.toggle('selection-end',selected && !this.selected.has(nodes[i+1]?.dataset.id));
      n.classList.toggle('track-selected',selected);n.setAttribute('aria-selected',String(selected));n.setAttribute('role','option');
    }
    this.onChange([...this.selected]);
  }
  sync(context){
    if(this.context!==context){this.selected.clear();this.anchor=null;this.context=context;}
    const visible=new Set(this.items().map(n=>n.dataset.id));
    this.selected=new Set([...this.selected].filter(id=>visible.has(id)));this.paint();
  }
  down(e){
    // A new press is deliberate, not the synthetic click following pointerup.
    // In particular never swallow view/sort buttons right after Ctrl+selection.
    if(e.button===0)this.suppressUntil=0;
    if(e.button!==0||!e.isPrimary||this.pointer||!this.items().length)return;
    if(e.target.closest('button,input,a,textarea,[contenteditable="true"],#categorySidebar'))return;
    const row=e.target.closest('[data-track-root]');
    if(!row && e.target!==this.scroller && !this.container.contains(e.target) && !e.target.closest('#dropHint'))return;
    const modified=e.ctrlKey||e.metaKey||e.shiftKey;
    this.pointer={id:e.pointerId,row,mode:row?(modified?'paint':'pending'):'area',
      x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,lastX:e.clientX,lastY:e.clientY,
      additive:e.ctrlKey||e.metaKey,range:e.shiftKey,before:new Set(this.selected),active:false};
    if(row&&!modified)this.timer=setTimeout(()=>{if(this.pointer?.mode==='pending')this.start('paint');},330);
    else { this.onStart(); e.stopImmediatePropagation(); }
  }
  start(mode){
    const p=this.pointer;if(!p||p.active)return;
    clearTimeout(this.timer);p.mode=mode;p.active=true;
    // Set active first: releasing a pending reorder may schedule a refresh.
    this.onTakeGesture();this.onStart();
    p.scrollTop=this.scroller.scrollTop;
    p.slots=this.items().map(n=>({id:n.dataset.id,rect:n.getBoundingClientRect()}));
    this.selected=p.additive?new Set(p.before):new Set();
    if(p.row){
      if(p.range&&this.anchor){
        const ids=p.slots.map(x=>x.id),a=ids.indexOf(this.anchor),b=ids.indexOf(p.row.dataset.id);
        for(const id of a>=0?ids.slice(Math.min(a,b),Math.max(a,b)+1):[p.row.dataset.id])this.selected.add(id);
      } else this.selected.add(p.row.dataset.id);
      this.anchor=p.row.dataset.id;
    }
    document.body.classList.add('track-selecting');
    try{this.scroller.setPointerCapture(p.id);}catch{}
    this.update();this.autoScroll();
  }
  move(e){
    const p=this.pointer;if(!p||p.id!==e.pointerId)return;
    p.x=e.clientX;p.y=e.clientY;
    const distance=Math.hypot(p.x-p.startX,p.y-p.startY);
    if(!p.active&&distance<6)return;
    if(p.mode==='pending'){
      // Quick motion delegates to PulseTrackReorder, without any selection.
      clearTimeout(this.timer);this.pointer=null;return;
    }
    if(!p.active)this.start(p.mode);
    e.preventDefault();e.stopImmediatePropagation();this.update();
  }
  segmentHits(x1,y1,x2,y2,r){
    // Liang–Barsky segment/rectangle intersection catches skipped rows even
    // when the mouse moves quickly and the browser coalesces pointer events.
    let low=0,high=1;const dx=x2-x1,dy=y2-y1;
    for(const [p,q] of [[-dx,x1-r.left],[dx,r.right-x1],[-dy,y1-r.top],[dy,r.bottom-y1]]){
      if(p===0){if(q<0)return false;continue;}
      const t=q/p;if(p<0)low=Math.max(low,t);else high=Math.min(high,t);if(low>high)return false;
    }
    return true;
  }
  update(){
    const p=this.pointer;if(!p?.active)return;
    const offset=this.scroller.scrollTop-p.scrollTop, x=p.x, y=p.y+offset;
    if(p.mode==='area'){
      const r={left:Math.min(p.startX,x),right:Math.max(p.startX,x),top:Math.min(p.startY,y),bottom:Math.max(p.startY,y)};
      this.selected=p.additive?new Set(p.before):new Set();
      for(const item of p.slots)if(r.left<item.rect.right&&r.right>item.rect.left&&r.top<item.rect.bottom&&r.bottom>item.rect.top)this.selected.add(item.id);
    }else{
      for(const item of p.slots)if(this.segmentHits(p.lastX,p.lastY,x,y,item.rect))this.selected.add(item.id);
    }
    p.lastX=x;p.lastY=y;this.paint();
  }
  autoScroll(){
    const p=this.pointer;if(!p?.active)return;
    const r=this.scroller.getBoundingClientRect(),margin=52;
    const speed=p.y<r.top+margin?-Math.min(16,(r.top+margin-p.y)/4):p.y>r.bottom-margin?Math.min(16,(p.y-r.bottom+margin)/4):0;
    if(speed){this.scroller.scrollTop+=speed;this.update();}
    this.frame=requestAnimationFrame(()=>this.autoScroll());
  }
  end(e,commit){
    const p=this.pointer;if(!p||(e&&e.pointerId!==p.id))return;
    this.pointer=null;clearTimeout(this.timer);cancelAnimationFrame(this.frame);
    if(p.active){
      if(!commit)this.selected=p.before;
      this.suppressUntil=performance.now()+400;document.body.classList.remove('track-selecting');
      this.paint();
      if(e){e.preventDefault();e.stopImmediatePropagation();}
      try{if(this.scroller.hasPointerCapture(p.id))this.scroller.releasePointerCapture(p.id);}catch{}
      if(commit&&this.selected.size)this.onMenu([...this.selected],p.x,p.y);
    } else if(commit && p.mode==='paint' && p.row){
      const id=p.row.dataset.id;
      if(p.range&&this.anchor){const ids=this.items().map(n=>n.dataset.id),a=ids.indexOf(this.anchor),b=ids.indexOf(id);this.selected=new Set(a>=0?ids.slice(Math.min(a,b),Math.max(a,b)+1):[id]);}
      else{this.selected=new Set(p.before);if(this.selected.has(id))this.selected.delete(id);else this.selected.add(id);this.anchor=id;}
      this.suppressUntil=performance.now()+300;this.paint();if(e){e.preventDefault();e.stopImmediatePropagation();}
    } else if(commit&&p.mode==='area')this.clear();
    this.onFinish();
  }
};
