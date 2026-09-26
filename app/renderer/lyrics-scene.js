'use strict';
/* Two opaque scene layers, one compositor opacity animation, and one latest
   pending request. Cover decoding finishes before a layer becomes visible. */
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
    this.reduced.addEventListener('change',()=>{if(this.reduced.matches)this.animation?.finish();});
  }
  set(snapshot){
    const request={...snapshot,key:JSON.stringify(snapshot)};this.pending=request;
    if(!this.busy)this.drain();
  }
  async drain(){
    if(this.busy||!this.pending)return;
    const request=this.pending;this.pending=null;
    if(request.key===this.key)return;
    this.busy=true;const epoch=this.epoch,index=this.front===0?1:0;
    const {layer,image,scrim}=this.layers[index];
    layer.style.backgroundColor=request.base;layer.style.backgroundImage=request.background.startsWith('linear-gradient(')?request.background:'none';
    if(!request.background.startsWith('linear-gradient('))layer.style.backgroundColor=request.background;
    layer.style.opacity='0';layer.style.zIndex='2';
    scrim.style.background=request.tint;scrim.style.opacity=String(request.scrim);
    image.style.opacity=String(request.coverOpacity||0);
    if(request.cover){
      image.src=request.cover;
      try {await image.decode();}catch{if(epoch===this.epoch)image.style.opacity='0';}
    }else image.removeAttribute('src');
    if(epoch!==this.epoch)return;
    // Superseded during image decoding: skip the obsolete scene entirely.
    if(this.pending&&this.pending.key!==request.key){this.busy=false;this.drain();return;}
    if(this.front>=0&&!this.reduced.matches&&!document.hidden){
      this.layers[this.front].layer.style.zIndex='1';
      this.host.classList.add('ly-transitioning');
      this.animation=layer.animate([{opacity:0},{opacity:1}],{duration:320,easing:'ease-in-out',fill:'forwards'});
      try {await this.animation.finished;}catch{}
      if(epoch!==this.epoch)return;
    }
    layer.style.opacity='1';
    this.animation?.cancel();this.animation=null;
    if(this.front>=0){const previous=this.layers[this.front];previous.layer.style.opacity='0';previous.image.removeAttribute('src');}
    this.front=index;this.key=request.key;this.busy=false;
    this.host.classList.remove('ly-transitioning');this.drain();
  }
  clear(){
    this.epoch++;this.animation?.cancel();this.animation=null;this.busy=false;
    this.pending=null;this.key='';this.front=-1;this.host.classList.remove('ly-transitioning');
    for(const {layer,image,scrim}of this.layers){layer.style.opacity='0';layer.style.backgroundImage='none';layer.style.backgroundColor='transparent';image.removeAttribute('src');scrim.style.opacity='0';}
  }
};
