'use strict';
/* Inactivity belongs to the reader, never to the audio/word clock. No polling
   frames; at most one timeout, canceled on close/blur/backgrounding. */
window.PulseLyricsImmersive=class PulseLyricsImmersive {
  constructor(reader){
    this.reader=reader;this.delay=3500;this.timer=0;this.idle=false;this.blurred=false;this.pressed=false;
    this.controls=[document.querySelector('.titlebar'),reader.view.querySelector('.ly-header'),document.getElementById('player'),reader.$('lyricsResync'),reader.$('toastStack')].filter(Boolean);
    this.saved=new Map();this.last=0;
    document.addEventListener('pointermove',e=>{if(this.point?.x===e.clientX&&this.point?.y===e.clientY)return;this.point={x:e.clientX,y:e.clientY};this.activity();},{passive:true,capture:true});
    document.addEventListener('pointerdown',()=>{this.pressed=true;this.activity();},{passive:true,capture:true});
    document.addEventListener('pointerup',()=>{this.pressed=false;this.activity();},{passive:true,capture:true});
    document.addEventListener('pointercancel',()=>{this.pressed=false;this.activity();},{passive:true,capture:true});
    document.addEventListener('wheel',()=>this.activity(),{passive:true,capture:true});
    document.addEventListener('keydown',()=>this.activity(),true);
    document.addEventListener('close',()=>this.activity(),true);
    document.addEventListener('visibilitychange',()=>{document.hidden?this.stop():this.activity();});
    window.addEventListener('blur',()=>{this.blurred=true;this.pressed=false;this.stop();});
    window.addEventListener('focus',()=>{this.blurred=false;this.activity();});
  }
  open(){this.blurred=false;this.activity();}
  stop(){clearTimeout(this.timer);this.timer=0;this.show();}
  activity(){
    if(!this.reader.opened)return;
    this.last=performance.now();this.show();
    if(!this.timer&&!document.hidden&&!this.blurred)this.timer=setTimeout(()=>this.check(),this.delay);
  }
  blocked(){
    if(this.pressed||!this.reader.doc||!this.reader.nodes.length||this.reader.loading)return true;
    if(document.documentElement.dataset.inputModality==='keyboard'&&this.controls.some(n=>n.contains(document.activeElement)))return true;
    return [...document.querySelectorAll('dialog[open],.modal-layer:not(.hidden),.context-menu:not(.hidden),.select-popover:not(.hidden)')].some(n=>n.getClientRects().length>0);
  }
  check(){
    this.timer=0;if(!this.reader.opened||document.hidden||this.blurred)return;
    const remaining=this.delay-(performance.now()-this.last);
    if(remaining>0){this.timer=setTimeout(()=>this.check(),remaining);return;}
    if(this.blocked()){this.timer=setTimeout(()=>this.check(),this.delay);return;}
    this.hide();
  }
  hide(){
    if(this.idle)return;
    this.idle=true;
    if(this.controls.some(n=>n.contains(document.activeElement)))this.reader.scroller.focus({preventScroll:true});
    for(const n of this.controls){this.saved.set(n,{inert:n.inert,aria:n.getAttribute('aria-hidden')});n.inert=true;n.setAttribute('aria-hidden','true');}
    document.body.classList.add('lyrics-idle');
    if(this.reader.follow)this.reader.align(true);
  }
  show(){
    if(!this.idle)return;
    this.idle=false;document.body.classList.remove('lyrics-idle');
    for(const [n,s]of this.saved){n.inert=s.inert;if(s.aria===null)n.removeAttribute('aria-hidden');else n.setAttribute('aria-hidden',s.aria);}
    this.saved.clear();
    if(this.reader.opened&&this.reader.follow)this.reader.align(true);
  }
};
