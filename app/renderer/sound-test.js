'use strict';
(() => {
  /** Four seconds of the user's current recording, or a quiet reference tone in
   * an empty library. It is an ordinary source in the shared sound engine, not
   * another output path. Ownership prevents late resumes after user interaction. */
  window.PulseSoundTest=class PulseSoundTest {
    constructor(options){Object.assign(this,options);this.element=new Audio();this.sound.register(this.element,'test');this.register(this.element);}
    tone(){
      if(this.toneURL)return this.toneURL;
      const rate=48000,n=rate,bytes=new ArrayBuffer(44+n*2),view=new DataView(bytes);
      const write=(at,s)=>[...s].forEach((ch,i)=>view.setUint8(at+i,ch.charCodeAt(0)));
      write(0,'RIFF');view.setUint32(4,36+n*2,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,n*2,true);
      for(let i=0;i<n;i++){const t=i/rate,envelope=Math.max(0,Math.min(1,t/.04,(1-t)/.15));view.setInt16(44+i*2,Math.round(Math.sin(2*Math.PI*440*t)*.08*envelope*32767),true);}
      return this.toneURL=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
    }
    async run(){
      const el=this.element,transport=this.transport,selected=this.currentTrack(),track=selected||this.firstTrack();
      const wasPlaying=selected&&!transport.paused,identity=transport.src,mode=transport.videoMode,time=transport.audioTime,token=this.claim();
      try{
        let src=this.tone(),profile=null;
        if(track){const info=await this.api.library.playback(track.rel);src=info.audioUrl;if(this.sound.settings.enabled)profile=await this.profile(track);}
        if(!this.isCurrent(token))return;
        if(/^https?:/.test(src))el.crossOrigin='anonymous';else el.removeAttribute('crossorigin');
        this.sound.setProfile(el,profile,track?.rel||'reference-tone');el.src=src;el.load();
        const start=performance.now();
        while(el.readyState<2){if(!this.isCurrent(token))return;if(el.error||performance.now()-start>12000)throw window.PulseI18n.error('MediaPlaybackFailed');await new Promise(r=>setTimeout(r,25));}
        el.currentTime=track?Math.max(0,Math.min(Number.isFinite(time)?time:0,(el.duration||4)-4)):0;
        if(!await this.play(token,el))return;
        const began=performance.now();
        while(this.isCurrent(token)&&!el.ended&&!el.paused&&performance.now()-began<4000)await new Promise(r=>setTimeout(r,40));
      }finally{
        el.pause();el.removeAttribute('src');el.load();this.sound.setProfile(el,null);
        if(this.isCurrent(token)){this.release();if(wasPlaying&&this.currentTrack()?.rel===selected.rel&&transport.src===identity&&transport.videoMode===mode)await this.resume();}
      }
    }
  };
})();
