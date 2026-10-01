'use strict';
(() => {
  const M=window.PulseMedia;
  /** All audible sources use one output route. Normalization is a separate gain
   * stage; the user's master volume is never rewritten by an analysis callback. */
  class SoundEngine extends EventTarget {
    constructor(){super();this.master=.82;this.muted=false;this.settings=M.sound();this.target=-18;this.entries=new Map();this.context=null;this.routeTail=Promise.resolve();this.routeEpoch=0;this.outputId='';}
    ensure(){
      if(this.context)return this.context;
      const Context=window.AudioContext||window.webkitAudioContext;
      if(!Context)throw window.PulseI18n.error('SoundUnavailable');
      const context=new Context({latencyHint:'playback'});this.context=context;
      this.analyser=context.createAnalyser();this.analyser.fftSize=256;
      this.limiter=context.createDynamicsCompressor();this.limiter.threshold.value=-.5;this.limiter.knee.value=0;this.limiter.ratio.value=20;this.limiter.attack.value=.003;this.limiter.release.value=.12;
      this.analyser.connect(this.limiter);
      if(typeof context.setSinkId==='function')this.limiter.connect(context.destination);
      else {
        // Older runtimes can route the very same mixed stream through a sink-
        // selectable HTML element. Never also connect to context.destination.
        this.destination=context.createMediaStreamDestination();this.limiter.connect(this.destination);
        this.output=new Audio();this.output.srcObject=this.destination.stream;this.output.autoplay=false;
      }
      return context;
    }
    register(element,role='preview'){
      if(this.entries.has(element))return this.entries.get(element);
      const context=this.ensure(),source=context.createMediaElementSource(element),normal=context.createGain(),gate=context.createGain();
      source.connect(normal);normal.connect(gate);gate.connect(this.analyser);
      const entry={element,role,source,normal,gate,profile:null,db:0,audible:true,identity:''};this.entries.set(element,entry);
      element.volume=this.master;element.muted=this.muted;
      element.addEventListener('play',()=>{this.resume().catch(error=>this.dispatchEvent(new CustomEvent('failure',{detail:error})));});
      this.update(entry,true);return entry;
    }
    unregister(element){const e=this.entries.get(element);if(!e)return;element.pause();e.source.disconnect();e.normal.disconnect();e.gate.disconnect();this.entries.delete(element);}
    async resume(){const c=this.ensure();if(c.state==='suspended')await c.resume();if(this.output?.paused)await this.output.play();}
    setMaster(value,muted=this.muted){
      this.master=M.clamp(Number(value)||0,0,1);this.muted=!!muted;
      for(const {element}of this.entries.values()){if(element.volume!==this.master)element.volume=this.master;if(element.muted!==this.muted)element.muted=this.muted;}
      this.changed();
    }
    configure(value){const previous=this.settings;this.settings=M.sound(value);if(this.settings.reference==='manual')this.target=this.settings.manualLUFS??this.settings.targetLUFS;else if(this.settings.reference==='fixed'||previous.reference!==this.settings.reference)this.target=this.settings.targetLUFS;for(const e of this.entries.values())this.update(e);this.changed();}
    setTarget(value){this.target=Number.isFinite(value)?value:this.settings.targetLUFS;for(const e of this.entries.values())this.update(e);this.changed();}
    setProfile(element,profile,identity=''){const entry=this.entries.get(element)||this.register(element);entry.profile=M.profile(profile);entry.identity=identity;this.update(entry,element.paused);if(entry.role==='local')for(const other of this.entries.values())if(other.role==='video')this.update(other,other.element.paused);this.changed();}
    update(entry,immediate=false){
      let settings=this.settings,target=this.target;
      if(entry.role==='video'&&!settings.enabled){
        const original=[...this.entries.values()].find(e=>e.role==='local')?.profile;
        if(original){settings={...settings,enabled:true,toleranceDB:0};target=original.lufs;}
      }
      const db=M.gainDB(entry.profile,target,settings);entry.db=db;
      const p=entry.normal.gain,t=this.context.currentTime;
      p.cancelScheduledValues(t);p.setTargetAtTime(10**(db/20),t,immediate?.001:db<0?.025:.25);
    }
    gate(element,enabled,seconds=.035){
      const e=this.entries.get(element)||this.register(element);e.audible=!!enabled;
      const p=e.gate.gain,t=this.context.currentTime;p.cancelScheduledValues(t);p.setValueAtTime(p.value,t);p.linearRampToValueAtTime(enabled?1:0,t+Math.max(.001,seconds));
    }
    gain(element){return this.entries.get(element)?.db||0;}
    changed(){this.dispatchEvent(new CustomEvent('change',{detail:{master:this.master,target:this.target,enabled:this.settings.enabled}}));}
    async setDevice(deviceId=''){
      const epoch=++this.routeEpoch,id=String(deviceId||'');
      const task=this.routeTail.catch(()=>{}).then(async()=>{
        const c=this.ensure();
        if(epoch!==this.routeEpoch)return false;
        if(typeof c.setSinkId==='function')await c.setSinkId(id);
        else if(typeof this.output?.setSinkId==='function')await this.output.setSinkId(id);
        else if(id)throw window.PulseI18n.error('SoundDeviceUnavailable');
        if(epoch!==this.routeEpoch)return false;
        this.outputId=id;this.dispatchEvent(new CustomEvent('device',{detail:id}));return true;
      });this.routeTail=task;return task;
    }
  }
  window.PulseSoundEngine=SoundEngine;
})();
