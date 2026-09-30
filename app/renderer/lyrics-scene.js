'use strict';
/* Decode a complete scene before committing it. set() resolves when that scene
 * is ready; opening lyrics can therefore reveal only the saved background. */
window.PulseLyricsScene=class PulseLyricsScene {
  constructor(host){
    this.host=host;this.layers=[0,1].map(()=>{
      const layer=document.createElement('div');layer.className='ly-scene';
      const image=document.createElement('img');image.alt='';image.draggable=false;
      const scrim=document.createElement('div');scrim.className='ly-scene-scrim';
      layer.append(image,scrim);host.append(layer);return {layer,image,scrim};
    });
    this.front=-1;this.epoch=0;this.busy=false;this.key='';this.pending=null;
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const sync=()=>{if(this.reduced.matches)this.animation?.finish();for(const [i,{image}]of this.layers.entries())if(image.tagName==='VIDEO'){if(i===this.front&&!this.reduced.matches&&!document.hidden)image.play().catch(()=>{});else image.pause();}};this.reduced.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);
  }
  set(snapshot){
    return new Promise(resolve=>{
      this.pending?.resolve(false);
      this.pending={...snapshot,key:JSON.stringify(snapshot),resolve};
      if(!this.busy)this.drain();
    });
  }
  async drain(){
    if(this.busy||!this.pending)return;
    const request=this.pending;this.pending=null;
    if(request.key===this.key){request.resolve(true);return;}
    this.active=request;this.busy=true;const epoch=this.epoch,index=this.front===0?1:0;
    const slot=this.layers[index],{layer,scrim}=slot;
    const wantsVideo=window.PulseCoverMedia?.isVideo(request.cover,request.coverType);
    if((slot.image.tagName==='VIDEO')!==!!wantsVideo){
      slot.image.pause?.();const image=document.createElement(wantsVideo?'video':'img');image.alt='';image.draggable=false;
      if(wantsVideo){image.muted=true;image.defaultMuted=true;image.loop=true;image.playsInline=true;image.preload='auto';}
      slot.image.replaceWith(image);slot.image=image;
    }
    const image=slot.image;
    layer.style.backgroundColor=request.base;layer.style.backgroundImage=request.background.startsWith('linear-gradient(')?request.background:'none';
    if(!request.background.startsWith('linear-gradient('))layer.style.backgroundColor=request.background;
    layer.style.opacity='0';layer.style.zIndex='2';scrim.style.background=request.tint;scrim.style.opacity=String(request.scrim);image.style.opacity=String(request.coverOpacity||0);
    if(request.cover){
      image.src=request.cover;
      try{if(wantsVideo)await window.PulseCoverMedia.ready(image);else await image.decode();}
      catch{if(epoch===this.epoch)image.style.opacity='0';}
    }else {image.pause?.();image.removeAttribute('src');}
    if(epoch!==this.epoch){request.resolve(false);return;}
    if(this.pending&&this.pending.key!==request.key){this.busy=false;this.active=null;request.resolve(false);this.drain();return;}
    if(this.front>=0&&!this.reduced.matches&&!document.hidden){
      this.layers[this.front].layer.style.zIndex='1';this.host.classList.add('ly-transitioning');
      this.animation=layer.animate([{opacity:0},{opacity:1}],{duration:320,easing:'ease-in-out',fill:'forwards'});
      try{await this.animation.finished;}catch{}
      if(epoch!==this.epoch){request.resolve(false);return;}
    }
    layer.style.opacity='1';this.animation?.cancel();this.animation=null;
    if(wantsVideo&&!this.reduced.matches&&!document.hidden)image.play().catch(()=>{});
    if(this.front>=0){const previous=this.layers[this.front];previous.layer.style.opacity='0';previous.image.pause?.();previous.image.removeAttribute('src');}
    this.front=index;this.key=request.key;this.busy=false;this.active=null;this.host.classList.remove('ly-transitioning');request.resolve(true);this.drain();
  }
  clear(){
    this.epoch++;this.animation?.cancel();this.animation=null;this.busy=false;this.active?.resolve(false);this.pending?.resolve(false);this.active=null;
    this.pending=null;this.key='';this.front=-1;this.host.classList.remove('ly-transitioning');
    for(const {layer,image,scrim}of this.layers){layer.style.opacity='0';layer.style.backgroundImage='none';layer.style.backgroundColor='transparent';image.pause?.();image.removeAttribute('src');scrim.style.opacity='0';}
  }
};
