'use strict';
(() => {
  const I=window.PulseI18n,M=window.PulseMedia;
  const icon=(name,size=18)=>window.Icon(name,size);
  const field=(id,label,min,max,step=1)=>`<label class="pd-sound-field" for="${id}"><span data-i18n="${label}">${I.h(label)}</span><span class="pd-range-line"><input id="${id}" type="range" min="${min}" max="${max}" step="${step}"><output for="${id}"></output></span></label>`;
  class SoundUI {
    constructor(options){
      Object.assign(this,options);this.cache=new Map();this.targets=new Map();this.generation=0;this.deviceGeneration=0;this.known=null;this.pending=new Map();this.previewCache=new Map();this.lastFailure='';this.cacheEpoch=0;this.settings=M.sound(this.getSettings().sound);
      this.element=document.querySelector('[data-settings-panel="sound"]');
      this.element.innerHTML=`<div class="settings-page-title"><h3 data-i18n="SoundTitle">${I.h('SoundTitle')}</h3><p data-i18n="SoundSubtitle">${I.h('SoundSubtitle')}</p></div>
        <section class="pd-sound-card"><div class="pd-section-heading"><span class="pd-feature-icon">${icon('volume',24)}</span><div><h4 data-i18n="SoundOutput">${I.h('SoundOutput')}</h4><p data-i18n="SoundOutputHint">${I.h('SoundOutputHint')}</p></div></div>
        <label class="pd-sound-field" for="soundDevice"><span data-i18n="SoundDevice">${I.h('SoundDevice')}</span><select id="soundDevice"></select></label>
        <div class="pd-toolbar"><button class="button secondary" type="button" id="soundTest">${icon('play')}<span data-i18n="SoundTest">${I.h('SoundTest')}</span></button><button class="text-button" type="button" id="soundRefresh">${icon('refresh')}<span data-i18n="SoundRefresh">${I.h('SoundRefresh')}</span></button></div><p id="soundDeviceStatus" class="setting-help" role="status"></p></section>
        <section class="pd-sound-card"><div class="pd-section-heading"><span class="pd-feature-icon">${icon('bars',24)}</span><div><h4 data-i18n="SoundNormalize">${I.h('SoundNormalize')}</h4><p data-i18n="SoundNormalizeHint">${I.h('SoundNormalizeHint')}</p></div><label class="pd-toggle"><input id="soundNormalize" type="checkbox"><span data-i18n="SoundEnabled">${I.h('SoundEnabled')}</span></label></div>
        <div class="pd-sound-grid"><label class="pd-sound-field" for="soundReference"><span data-i18n="SoundReference">${I.h('SoundReference')}</span><select id="soundReference">${['first-played','playlist-first','fixed','manual'].map((v,i)=>`<option value="${v}" data-i18n="SoundReference${i}">${I.h('SoundReference'+i)}</option>`).join('')}</select></label>
        <div class="pd-reference-meter"><span data-i18n="SoundReferenceLevel">${I.h('SoundReferenceLevel')}</span><strong id="soundTarget">−18 <small>LUFS</small></strong><span id="soundReferenceName"></span></div></div>
        ${field('soundTargetLUFS','SoundTargetLUFS',-30,-10)}${field('soundTolerance','SoundTolerance',0,6,.5)}
        <details class="pd-sound-details"><summary data-i18n="SoundAdvanced">${I.h('SoundAdvanced')}</summary>${field('soundBoost','SoundBoost',0,12)}<p class="setting-help" data-i18n="SoundPeakSafety">${I.h('SoundPeakSafety')}</p></details>
        <div class="pd-normalization-status" role="status"><span class="pd-status-dot"></span><span id="soundAnalysisState"></span><output id="soundAdjustment">0 dB</output></div>
        <p class="setting-help" data-i18n="SoundMasterHint">${I.h('SoundMasterHint')}</p></section>`;
      this.$('soundNormalize').onchange=e=>this.change({enabled:e.target.checked});
      this.$('soundReference').onchange=e=>this.change({reference:e.target.value});
      for(const [id,key]of [['soundTargetLUFS','targetLUFS'],['soundTolerance','toleranceDB'],['soundBoost','maxBoostDB']]){
        this.$(id).oninput=e=>{this.settings=M.sound({...this.settings,[key]:+e.target.value});this.sound.configure(this.settings);this.renderValues();};
        this.$(id).onchange=e=>this.change({[key]:+e.target.value});
      }
      this.$('soundDevice').onchange=e=>this.selectDevice(e.target.value);
      this.$('soundRefresh').onclick=()=>this.devices(false);
      this.$('soundTest').onclick=async()=>{const b=this.$('soundTest');b.disabled=true;try{await this.testSound();}catch(e){this.failure(e);}finally{b.disabled=false;}};
      this.sound.addEventListener('change',()=>this.renderMeter());
      this.sound.addEventListener('failure',e=>this.failure(e.detail));
      this.deviceListener=()=>{clearTimeout(this.deviceTimer);this.deviceTimer=setTimeout(()=>this.devices(true),450);};
      navigator.mediaDevices?.addEventListener('devicechange',this.deviceListener);
      this.configure(this.settings);this.devices(false);
    }
    $(id){return document.getElementById(id);}
    async configure(value){this.settings=M.sound(value);this.sound.configure(this.settings);this.renderValues();try{await this.sound.setDevice(this.settings.deviceId);}catch{try{await this.sound.setDevice('');}catch{}I.setText(this.$('soundDeviceStatus'),()=>I.t('SoundDeviceFallback'));}this.renderMeter();}
    async change(patch){
      const old=this.settings;this.settings=M.sound({...this.settings,...patch});
      if(this.settings.reference==='manual'&&!Number.isFinite(this.settings.manualLUFS)){this.settings={...old};I.setText(this.$('soundAnalysisState'),()=>I.t('SoundChooseManual'));this.renderValues();return;}
      this.sound.configure(this.settings);this.renderValues();
      try{await this.saveSettings(this.settings);const track=this.currentTrack();if(track)await this.prepareTrack(track,this.localElement);}
      catch(error){this.failure(error);}
    }
    renderValues(){
      const s=this.settings;
      this.$('soundNormalize').checked=s.enabled;this.$('soundReference').value=s.reference;
      for(const [id,key,unit]of [['soundTargetLUFS','targetLUFS','LUFS'],['soundTolerance','toleranceDB','dB'],['soundBoost','maxBoostDB','dB']]){
        const node=this.$(id);if(document.activeElement!==node)node.value=s[key];this.element.querySelector(`output[for="${id}"]`).textContent=s[key]+' '+unit;
      }
      this.$('soundTargetLUFS').disabled=s.reference!=='fixed';
      this.$('soundReferenceName').textContent=s.reference==='manual'?(s.manualName||I.t('SoundManualReference')):'';
      this.renderMeter();
    }
    renderMeter(){
      this.$('soundTarget').textContent=this.sound.target.toFixed(1)+' LUFS';
      const db=this.sound.gain(this.transport?.videoMode?this.transport.video:this.localElement),text=(db>0?'+':'')+db.toFixed(1)+' dB';this.$('soundAdjustment').textContent=text;
      const badge=this.$('volumeAdjustment');if(badge){badge.textContent=text;badge.hidden=!this.settings.enabled&&!(this.transport?.videoMode&&db);I.setAttribute(badge,'title',()=>I.t('SoundEffectiveHint'));}
      const effective=this.$('volumeEffective');if(effective){effective.hidden=!this.settings.enabled&&!(this.transport?.videoMode&&db);effective.style.setProperty('--effective',Math.min(100,this.sound.master*10**(db/20)*100)+'%');}
      if(!this.analyzing)I.setText(this.$('soundAnalysisState'),()=>I.t(this.settings.enabled?'SoundNormalizeActive':'SoundNormalizeOff'));
    }
    async selectDevice(id){
      const select=this.$('soundDevice');select.disabled=true;
      try{if(await this.sound.setDevice(id)){this.settings={...this.settings,deviceId:id};await this.saveSettings(this.settings);I.setText(this.$('soundDeviceStatus'),()=>I.t('SoundDeviceApplied'));}}
      catch(error){I.setText(this.$('soundDeviceStatus'),()=>I.t('SoundDeviceError')+' '+I.errorMessage(error));select.value=this.settings.deviceId;}
      finally{select.disabled=false;}
    }
    async devices(notify){
      const generation=++this.deviceGeneration;
      try{
        const list=(await navigator.mediaDevices?.enumerateDevices()||[]).filter(x=>x.kind==='audiooutput'&&x.deviceId&&x.deviceId!=='default');
        if(generation!==this.deviceGeneration)return;
        const select=this.$('soundDevice'),id=this.settings.deviceId,known=new Set(list.map(x=>x.deviceId));
        const option=(value,text)=>{const n=document.createElement('option');n.value=value;if(typeof text==='function')I.setText(n,text);else n.textContent=text;return n;};
        select.replaceChildren(option('',()=>I.t('SoundSystemDefault')),...list.map((x,i)=>option(x.deviceId,x.label||(()=>I.t('SoundUnnamedDevice',{number:i+1})))));
        if(id&&!known.has(id)){select.append(option(id,()=>I.t('SoundDisconnected')));if(this.sound.outputId!=='')await this.sound.setDevice('');I.setText(this.$('soundDeviceStatus'),()=>I.t('SoundDeviceFallback'));}
        else if(id&&this.sound.outputId!==id){await this.sound.setDevice(id);I.setText(this.$('soundDeviceStatus'),()=>I.t('SoundDeviceApplied'));}
        select.value=id;
        if(notify&&this.known){const fresh=list.filter(x=>!this.known.has(x.deviceId));if(fresh.length)this.deviceNotice(fresh[0]);}
        this.known=known;
      }catch(error){if(generation===this.deviceGeneration)I.setText(this.$('soundDeviceStatus'),()=>I.t('SoundDeviceError')+' '+I.errorMessage(error));}
    }
    deviceNotice(device){
      document.getElementById('soundDeviceNotice')?.remove();
      const notice=document.createElement('div');notice.id='soundDeviceNotice';notice.className='pd-device-notice';notice.setAttribute('role','status');
      const text=document.createElement('span');I.setText(text,()=>I.t('SoundNewDevice',{name:device.label||I.t('SoundDevice')}));
      const action=document.createElement('button');action.className='button primary';I.setText(action,()=>I.t('SoundUseDevice'));action.onclick=async()=>{action.disabled=true;await this.selectDevice(device.deviceId);notice.remove();};
      const close=document.createElement('button');close.className='icon-button';close.innerHTML=icon('close',16);I.setAttribute(close,'aria-label',()=>I.t('UIClose'));close.onclick=()=>notice.remove();notice.append(text,action,close);document.body.append(notice);
      clearTimeout(this.noticeTimer);this.noticeTimer=setTimeout(()=>notice.remove(),18000);
    }
    async profile(track){
      const epoch=this.cacheEpoch,key=track.rel+'|'+(track.mtimeMs||track.mtime||track.modifiedAt||'')+'|'+(track.size||'');
      if(this.cache.has(key))return this.cache.get(key);
      if(this.pending.has(key))return this.pending.get(key);
      const work=this.api.media?.command({action:'profile',rel:track.rel,requestId:M.uuid()})||Promise.resolve(null);this.pending.set(key,work);
      try{const p=await work;if(epoch!==this.cacheEpoch)return null;if(this.cache.size>128)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,p);return p;}finally{this.pending.delete(key);}
    }
    async prepareTrack(track,element){
      const generation=++this.generation,scope=this.scope(),s=this.settings;
      // Keep an already measured current source while refreshing preferences.
      // Clearing it during an async analysis would briefly remove attenuation.
      if(this.sound.entries.get(element)?.identity!==track.rel)this.sound.setProfile(element,null,track.rel);
      if(!s.enabled){this.analyzing=false;this.renderMeter();return;}
      this.analyzing=true;I.setText(this.$('soundAnalysisState'),()=>I.t('SoundAnalyzing'));
      try{
        const profile=await this.profile(track);if(generation!==this.generation)return;
        let target=s.targetLUFS;
        if(s.reference==='manual')target=s.manualLUFS??target;
        else if(s.reference==='first-played'){
          if(!this.targets.has(scope)&&profile)this.targets.set(scope,profile.lufs);
          target=this.targets.get(scope)??target;
        }else if(s.reference==='playlist-first'){
          const first=this.queue()[0];const p=first?.rel===track.rel?profile:first?await this.profile(first):null;target=p?.lufs??target;
        }
        if(generation!==this.generation)return;
        this.sound.setTarget(target);this.sound.setProfile(element,profile,track.rel);
        // Warm exactly one next profile; no whole-library scan or private cache on disk.
        const queue=this.queue(),index=queue.findIndex(t=>t.rel===track.rel),next=queue[index+1];if(next)setTimeout(()=>{if(generation===this.generation)this.profile(next).catch(()=>{});},1200);
      }catch(error){if(generation===this.generation)this.failure(error);}
      finally{if(generation===this.generation){this.analyzing=false;this.renderMeter();}}
    }
    async preparePreview(prepared,element){
      const id=prepared?.previewId;if(!id||!this.settings.enabled){this.sound.setProfile(element,null);return;}
      element.dataset.soundPreview=id;
      try{
        let p=this.previewCache.get(id);
        if(p===undefined){p=await this.api.media?.command({action:'preview-profile',previewId:id,requestId:M.uuid()});if(this.previewCache.size>30)this.previewCache.clear();this.previewCache.set(id,p||null);}
        if(element.dataset.soundPreview===id)this.sound.setProfile(element,p,id);
      }catch(error){if(element.dataset.soundPreview===id)this.failure(error);}
    }
    async useReference(track){
      if(!track)return;
      try{const p=await this.profile(track);if(!p)throw I.error('SoundSilentReference');await this.change({enabled:true,reference:'manual',manualLUFS:p.lufs,manualName:track.vaultKey?I.t('SoundPrivateReference'):[track.artist,track.title].filter(Boolean).join(' — ')});this.notify('ok',I.t('SoundReferenceSaved'),track.vaultKey?I.t('SoundPrivateReference'):track.title);}
      catch(error){this.failure(error);}
    }
    failure(error){const message=I.errorMessage(error);this.$('soundAnalysisState').textContent=message;if(message!==this.lastFailure){this.lastFailure=message;this.notify('bad',I.t('SoundTitle'),message);}}
    lock(){this.cacheEpoch++;this.generation++;this.cache.clear();this.pending.clear();this.targets.clear();this.sound.setProfile(this.localElement,null);this.sound.setProfile(this.transport.video,null);}
  }
  window.PulseSoundUI=SoundUI;
})();
