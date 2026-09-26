/* Count real playback, not seek distance, preview audio or protected tracks. */
(() => {
  'use strict';
  class ListeningTracker {
    constructor({audio,getTrack,isEnabled,command,clock=()=>performance.now()}){
      this.audio=audio;this.getTrack=getTrack;this.isEnabled=isEnabled;this.command=command;this.clock=clock;this.record=null;this.last=null;
      audio.addEventListener('timeupdate',()=>this.tick(),true);
      audio.addEventListener('seeking',()=>{this.last=null;},true);
      audio.addEventListener('seeked',()=>{this.last=null;},true);
      audio.addEventListener('pause',()=>{this.flush();this.last=null;},true);
      audio.addEventListener('ended',()=>{this.flush(true);this.record=null;this.last=null;},true);
      audio.addEventListener('emptied',()=>{this.flush(false,true);this.record=null;this.last=null;},true);
      window.addEventListener('pagehide',()=>this.flush());
      document.addEventListener('pulsedeck:discovery-reset',()=>{this.record=null;this.last=null;});
    }
    flush(completed=false,changed=false){
      const r=this.record;if(!r||r.pending<1)return;
      if(this.isEnabled())this.command({type:'record',rel:r.rel,seconds:Math.min(30,r.pending),completed:completed&&r.total>=Math.min(30,r.duration*.5),skipped:changed&&r.total<Math.min(30,r.duration*.3)}).catch(()=>{});
      r.pending=0;
    }
    tick(){
      const t=this.getTrack(),now=this.clock(),position=this.audio.currentTime;
      if(!this.isEnabled()||!t||t.vaultKey||t.vaultId||t.private||t.protected||this.audio.paused||this.audio.seeking){this.last=null;return;}
      if(this.record?.rel!==t.rel){this.flush(false,true);this.record={rel:t.rel,total:0,pending:0,duration:Number(t.duration)||180};this.last=null;}
      if(this.last){const wall=(now-this.last.at)/1000,media=position-this.last.position;
        if(wall>0&&wall<10&&media>0&&media<=wall*2+1){const seconds=Math.min(wall,media);this.record.pending+=seconds;this.record.total+=seconds;if(this.record.pending>=15)this.flush();}
      }
      this.last={at:now,position};
    }
  }
  window.PulseListeningTracker=ListeningTracker;
})();
