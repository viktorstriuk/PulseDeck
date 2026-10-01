'use strict';
(() => {
  const M=window.PulseMedia,I=window.PulseI18n;
  const events=['play','playing','pause','ended','timeupdate','loadedmetadata','durationchange','seeking','seeked','ratechange','volumechange','error','emptied','waiting','canplay'];
  class MediaTransport extends EventTarget {
    constructor(audio,video,sound){
      super();this.audio=audio;this.video=video;this.sound=sound;this.active=audio;this.clip=null;this.epoch=0;this.switching=false;this.rate=1;
      sound.register(audio,'local');sound.register(video,'video');sound.gate(video,false,.001);
      video.controls=false;video.playsInline=true;video.disablePictureInPicture=true;video.disableRemotePlayback=true;video.preload='auto';
      for(const element of [audio,video])for(const name of events)element.addEventListener(name,()=>{if(element===this.active)this.dispatchEvent(new Event(name));});
    }
    get videoMode(){return this.active===this.video;}
    get audioTime(){return this.videoMode?M.audioTime(this.video.currentTime,this.clip):this.audio.currentTime;}
    get src(){return this.audio.src;}
    set src(value){this.resetVideo();this.audio.src=value;}
    get currentSrc(){return this.active.currentSrc;}
    get currentTime(){return this.active.currentTime;}
    set currentTime(value){this.cancelSwitch();const d=this.duration;this.active.currentTime=M.clamp(Number(value)||0,0,Number.isFinite(d)?d:Infinity);}
    get duration(){return this.active.duration;}
    get paused(){return this.active.paused;}
    get ended(){return this.active.ended;}
    get readyState(){return this.active.readyState;}
    get seeking(){return this.active.seeking;}
    get error(){return this.active.error;}
    get volume(){return this.sound.master;}
    set volume(value){this.sound.setMaster(value);}
    get muted(){return this.sound.muted;}
    set muted(value){this.sound.setMaster(this.volume,value);}
    get playbackRate(){return this.rate;}
    set playbackRate(value){this.rate=M.clamp(Number(value)||1,.25,4);this.audio.playbackRate=this.rate;this.video.playbackRate=this.rate*(this.clip?.rate||1);}
    get crossOrigin(){return this.audio.crossOrigin;}
    set crossOrigin(value){this.audio.crossOrigin=value;}
    getAttribute(name){return this.audio.getAttribute(name);}
    removeAttribute(name){if(name==='src')this.resetVideo();this.audio.removeAttribute(name);}
    load(){this.audio.load();}
    async play(){
      const epoch=this.epoch,target=this.active;
      await this.sound.resume();
      // Resuming an output route is asynchronous. A pause, seek or track change
      // in the meantime wins over this stale play command.
      if(epoch!==this.epoch||target!==this.active)throw new DOMException('Cancelled','AbortError');
      return target.play();
    }
    pause(){this.cancelSwitch();this.audio.pause();this.video.pause();}
    cancelSwitch(){this.epoch++;const wasSwitching=this.switching;this.switching=false;if(wasSwitching)this.dispatchEvent(new Event('switchend'));const inactive=this.videoMode?this.audio:this.video;inactive.pause();this.sound.gate(inactive,false,.001);this.sound.gate(this.active,true,.001);}
    resetVideo(){
      this.cancelSwitch();this.video.pause();this.active=this.audio;this.clip=null;
      this.video.removeAttribute('src');this.video.load();this.sound.gate(this.video,false,.001);this.sound.gate(this.audio,true,.001);
      this.dispatchEvent(new CustomEvent('modechange',{detail:{video:false}}));
    }
    setVideo(clip){
      if(!clip?.url){if(this.videoMode)this.resetVideo();else{this.clip=null;this.video.removeAttribute('src');this.video.load();}return;}
      this.clip={...clip,...M.sync(clip)};
      if(this.video.getAttribute('src')!==clip.url){if(/^https?:/.test(clip.url))this.video.crossOrigin='anonymous';else this.video.removeAttribute('crossorigin');this.video.src=clip.url;this.video.load();}
      this.video.playbackRate=this.rate*this.clip.rate;this.sound.setProfile(this.video,clip.profile,clip.ref);
      this.dispatchEvent(new Event('clipchange'));
    }
    waitReady(element,epoch){
      return new Promise((resolve,reject)=>{
        const began=performance.now();let timer;
        const check=()=>{
          if(epoch!==this.epoch){clearInterval(timer);reject(new DOMException('Cancelled','AbortError'));return;}
          if(element.error){clearInterval(timer);reject(I.error('MediaPlaybackFailed'));return;}
          if(element.readyState>=3&&!element.seeking){clearInterval(timer);resolve();return;}
          if(performance.now()-began>12000){clearInterval(timer);reject(I.error('MediaPlaybackFailed'));}
        };
        timer=setInterval(check,25);check();
      });
    }
    async toggle(){
      if(this.switching)return false;
      if(!this.clip)throw I.error('MediaMissing');
      const old=this.active,target=this.videoMode?this.audio:this.video,toVideo=target===this.video,playing=!old.paused,epoch=++this.epoch;
      let time=toVideo?M.videoTime(old.currentTime,this.clip):M.audioTime(old.currentTime,this.clip);
      const expected=toVideo?this.clip.duration:this.audio.duration;
      if(time<-.08||Number.isFinite(expected)&&time>expected+.08)throw I.error('MediaNoOverlap');
      this.switching=true;this.dispatchEvent(new Event('switchstart'));
      this.sound.gate(target,false,.001);
      try{
        if(target.readyState===0)await this.waitMetadata(target,epoch);
        time=M.clamp(time,0,Math.max(0,target.duration-.02));target.currentTime=time;
        await this.waitReady(target,epoch);
        if(playing){
          // The old transport remains audible while the target seeks/decodes.
          const now=toVideo?M.videoTime(old.currentTime,this.clip):M.audioTime(old.currentTime,this.clip);
          if(Math.abs(target.currentTime-now)>.06){target.currentTime=M.clamp(now,0,target.duration-.02);await this.waitReady(target,epoch);}
          await this.sound.resume();if(epoch!==this.epoch)throw new DOMException('Cancelled','AbortError');await target.play();
        }
        if(epoch!==this.epoch)throw new DOMException('Cancelled','AbortError');
        this.active=target;this.sound.gate(old,false);this.sound.gate(target,true);
        this.dispatchEvent(new CustomEvent('modechange',{detail:{video:toVideo}}));
        this.dispatchEvent(new Event('loadedmetadata'));this.dispatchEvent(new Event('timeupdate'));this.dispatchEvent(new Event(playing?'playing':'pause'));
        await new Promise(r=>setTimeout(r,45));
        if(epoch===this.epoch)old.pause();
        return true;
      }catch(error){if(epoch===this.epoch){target.pause();this.sound.gate(target,false,.001);this.active=old;this.sound.gate(old,true,.001);}throw error;}
      finally{if(epoch===this.epoch){this.switching=false;this.dispatchEvent(new Event('switchend'));}}
    }
    waitMetadata(element,epoch){
      return new Promise((resolve,reject)=>{let timer;const begin=performance.now();const tick=()=>{
        if(epoch!==this.epoch){clearInterval(timer);reject(new DOMException('Cancelled','AbortError'));}
        else if(element.readyState>0){clearInterval(timer);resolve();}
        else if(element.error||performance.now()-begin>12000){clearInterval(timer);reject(I.error('MediaPlaybackFailed'));}
      };timer=setInterval(tick,25);tick();});
    }
  }
  window.PulseMediaTransport=MediaTransport;
})();
