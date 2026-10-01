'use strict';
(() => {
  const I=window.PulseI18n,M=window.PulseMedia;
  const icon=(name,size=18)=>window.Icon(name,size),uid=()=>M.uuid();
  const text=(tag,cls,value)=>{const n=document.createElement(tag);n.className=cls||'';n.textContent=value;return n;};
  const owned=(tag,cls,key,args)=>{const n=text(tag,cls,'');I.setText(n,()=>I.t(key,args));return n;};
  const label=key=>`<span data-i18n="${key}">${I.h(key)}</span>`;
  class MusicVideoUI {
    constructor(options){
      Object.assign(this,options);this.searchEpoch=0;this.trackEpoch=0;this.currentRel='';this.editor=null;
      this.searchDialog=this.dialog('musicVideoSearch','MediaFindVideo');this.editorDialog=this.dialog('musicVideoEditor','MediaTrimTitle');
      this.searchDialog.addEventListener('cancel',e=>{e.preventDefault();this.closeSearch();});this.editorDialog.addEventListener('cancel',e=>{e.preventDefault();this.closeEditor();});
      this.api.media?.onProgress?.(p=>{const e=this.editor;if(e&&e.requestId===p.requestId){I.setText(this.$('clipStatus'),()=>I.t('MediaPhase_'+p.phase));const meter=this.$('clipProgress');if(p.percent>0){meter.value=p.percent;meter.removeAttribute('data-indeterminate');}else{meter.removeAttribute('value');meter.dataset.indeterminate='';}}});
      this.api.lyrics?.onLock?.(()=>this.lock());
      this.transport.addEventListener('modechange',()=>this.renderMode());this.transport.addEventListener('clipchange',()=>this.renderButton());
      this.transport.addEventListener('switchstart',()=>{this.$('videoBtn').setAttribute('aria-busy','true');});
      this.transport.addEventListener('switchend',()=>{this.$('videoBtn').removeAttribute('aria-busy');});
      this.$('videoBtn').onclick=()=>this.toggle();
      document.addEventListener('keydown',e=>{
        if(this.editorDialog.open||this.searchDialog.open){
          if(e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.editorDialog.open?this.closeEditor():this.closeSearch();return;}
          if(e.code==='Space'&&!/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)){e.preventDefault();e.stopImmediatePropagation();if(this.editorDialog.open)this.preview();}
          return;
        }
        if(this.transport.videoMode&&e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.toggle();}
      },true);
      this.sound.addEventListener('change',()=>{const node=this.$('clipVolume');if(node&&document.activeElement!==node)node.value=this.sound.master*100;});
      this.transport.addEventListener('timeupdate',()=>this.syncLyricsBackground());
      this.transport.addEventListener('pause',()=>this.syncLyricsBackground());this.transport.addEventListener('play',()=>this.syncLyricsBackground());
      this.renderButton();
    }
    $(id){return document.getElementById(id);}
    dialog(id,title){const d=document.createElement('dialog');d.id=id;d.className='pd-media-dialog';I.setAttribute(d,'aria-label',()=>I.t(title));document.body.append(d);return d;}
    header(dialog,title,close){const h=document.createElement('header');h.className='pd-media-header';h.innerHTML=`<div><span class="eyebrow">PULSEDECK · ${label('MediaVideo')}</span><h2 data-i18n="${title}">${I.h(title)}</h2></div>`;const b=document.createElement('button');b.type='button';b.className='icon-button';b.innerHTML=icon('close');I.setAttribute(b,'aria-label',()=>I.t('UIClose'));b.dataset.mediaCancel='';b.onclick=close;h.append(b);dialog.append(h);return h;}
    cmd(c){if(!this.api.media?.command)return Promise.reject(I.error('MediaBridgeMissing'));return this.api.media.command(c);}
    error(e){this.notify('bad',I.t('MediaVideo'),I.errorMessage(e));}
    renderButton(){const b=this.$('videoBtn');b.disabled=!this.currentTrack();b.innerHTML=icon(this.transport.videoMode?'music':'video',18);b.setAttribute('aria-pressed',String(this.transport.videoMode));const key=this.transport.videoMode?'MediaBackToAudio':this.transport.clip?'MediaWatchVideo':'MediaFindVideo';I.setAttribute(b,'title',()=>I.t(key));I.setAttribute(b,'aria-label',()=>I.t(key));}
    renderMode(){
      const video=this.transport.videoMode;document.body.classList.toggle('music-video-mode',video);
      const stage=this.$('musicVideoStage');stage.hidden=!video;
      if(video){this.lyrics()?.immersive.stop();document.body.classList.remove('lyrics-idle','lyrics-focus');}
      else if(this.lyrics()?.opened)this.lyrics().startClock();
      this.renderButton();this.soundUI?.renderMeter();
    }
    async toggle(){
      if(!this.currentTrack())return;
      if(this.editorDialog.open||this.searchDialog.open)return;
      if(!this.transport.clip){this.openSearch(this.currentTrack());return;}
      try{const epoch=this.trackEpoch;await this.pairPreparation;if(epoch!==this.trackEpoch)return;await this.transport.toggle();}catch(e){if(e.name!=='AbortError')this.error(e);}
    }
    async trackChanged(track){
      const epoch=++this.trackEpoch;this.currentRel=track?.rel||'';this.renderButton();
      if(!track)return;
      try{const record=await this.cmd({action:'info',rel:track.rel});if(epoch!==this.trackEpoch||this.currentRel!==track.rel)return;this.record=record;this.transport.setVideo(record.musicVideo);if(record.musicVideo)this.pairPreparation=this.preparePair(track,epoch);this.renderButton();}
      catch(error){if(epoch===this.trackEpoch)this.record=null;}
    }
    async preparePair(track,epoch=this.trackEpoch){
      try{const profile=await this.soundUI.profile(track);if(epoch===this.trackEpoch&&track.rel===this.currentRel)this.sound.setProfile(this.transport.audio,profile,track.rel);}catch(error){if(epoch===this.trackEpoch)this.soundUI.failure(error);}
    }
    async acceptRecord(track,record){
      if(this.currentTrack()?.rel===track.rel){this.record=record;this.transport.setVideo(record.musicVideo);if(record.musicVideo)this.pairPreparation=this.preparePair(track);const view=this.lyrics();if(view?.opened)view.trackChanged(this.currentTrack(),true);}
      await this.changed?.();this.renderButton();
    }
    syncLyricsBackground(){
      const view=this.lyrics(),clip=this.record?.musicVideo;
      if(!view?.opened||view.track?.rel!==this.currentRel||!clip||this.record.theme?.customBackground!==clip.ref)return;
      const front=view.backdrop?.layers?.[view.backdrop.front]?.image;if(front?.tagName!=='VIDEO')return;
      front.loop=false;front.muted=true;front.dataset.coverEnabled='false';
      const time=M.videoTime(this.transport.audioTime,clip);
      if(this.transport.videoMode||this.transport.paused||time<0||time>=clip.duration){front.pause();if(time>=0&&time<clip.duration&&Math.abs(front.currentTime-time)>.12)try{front.currentTime=time;}catch{}return;}
      if(Math.abs(front.currentTime-time)>.12)try{front.currentTime=time;}catch{}
      front.playbackRate=this.transport.playbackRate*clip.rate;if(front.paused)front.play().catch(()=>{});
    }
    async openSearch(track,options={}){
      if(!track)return;this.stopOtherEditors?.();await this.closeSearch(false);const epoch=++this.searchEpoch;this.searchTrack=track;this.searchOptions=options;this.batch=null;
      const d=this.searchDialog;d.replaceChildren();this.header(d,'MediaFindVideo',()=>this.closeSearch());
      d.append(text('p','pd-track-subtitle',[track.artist,track.title].filter(Boolean).join(' — ')));
      const form=document.createElement('form');form.className='pd-media-search';form.innerHTML=`<input id="videoSearchQuery" type="search" maxlength="400" data-i18n-aria-label="MediaQuery" aria-label="${I.h('MediaQuery')}"><button class="button primary" type="submit">${icon('search')}${label('MediaFind')}</button>`;
      form.querySelector('input').value=[track.artist,track.title,'official music video'].filter(Boolean).join(' ');form.onsubmit=e=>{e.preventDefault();this.searchVideo();};
      d.append(form,owned('p','setting-help','MediaSearchConsent'));
      const status=text('p','pd-media-status','');status.id='videoSearchStatus';status.setAttribute('role','status');d.append(status);
      const results=document.createElement('div');results.className='pd-video-results';results.id='videoSearchResults';d.append(results);
      const more=document.createElement('button');more.id='videoSearchMore';more.className='button secondary';I.setText(more,()=>I.t('CoverMore'));more.hidden=true;more.onclick=()=>this.searchVideo(true);d.append(more);
      d.showModal();form.querySelector('input').focus();if(epoch===this.searchEpoch)await this.searchVideo();
    }
    async searchVideo(more=false){
      if(!this.searchDialog.open||this.batch)return;const track=this.searchTrack,query=this.$('videoSearchQuery').value.trim();if(!query)return;
      if(this.searchRequest)await this.cmd({action:'cancel',requestId:this.searchRequest}).catch(()=>{});
      const epoch=++this.searchEpoch,id=this.searchRequest=uid(),results=this.$('videoSearchResults'),status=this.$('videoSearchStatus');I.setText(status,()=>I.t('MediaSearching'));this.$('videoSearchMore').disabled=true;
      if(!more){results.replaceChildren();this.searchCursor=null;}
      try{
        const url=M.youtube(query);const data=url?{items:[{url,direct:true,title:I.t('MediaDirectVideo'),artist:'YouTube',duration:0}],cursor:null}:await this.cmd({action:'search',rel:track.rel,query,cursor:more?this.searchCursor:null,consent:true,requestId:id});
        if(epoch!==this.searchEpoch)return;
        for(const item of data.items||[])results.append(this.resultCard(track,item));this.searchCursor=data.cursor;
        I.setText(status,()=>I.t(results.children.length?'MediaChooseResult':'MediaNoResults'));this.$('videoSearchMore').hidden=!data.cursor;
      }catch(error){if(epoch===this.searchEpoch)I.setText(status,()=>I.errorMessage(error));}
      finally{if(epoch===this.searchEpoch){this.searchRequest=null;this.$('videoSearchMore').disabled=false;}}
    }
    resultCard(track,item){
      const b=document.createElement('button');b.type='button';b.className='pd-video-result';
      const thumb=document.createElement('span');thumb.className='pd-video-thumb';thumb.innerHTML=icon('video',34);
      if(item.thumbnail&&/^https:\/\//.test(item.thumbnail)){const image=document.createElement('img');image.src=item.thumbnail;image.alt='';image.loading='lazy';image.onerror=()=>image.remove();thumb.append(image);}
      const copy=document.createElement('span');copy.className='pd-video-copy';const hint=text('small','','');I.setText(hint,()=>`${item.duration?this.formatTime(item.duration)+' · ':''}${I.t('MediaTrimSelect')}`);const title=text('strong','',item.title);if(item.direct)I.setText(title,()=>I.t('MediaDirectVideo'));copy.append(title,text('span','',item.artist||'YouTube'),hint);b.append(thumb,copy);b.onclick=()=>this.openEditor(track,item.url,{fromSearch:true,...this.searchOptions});return b;
    }
    async openBatch(tracks,title=''){
      if(!tracks?.length)return;this.stopOtherEditors?.();await this.closeSearch(false);this.batch={tracks:[...tracks],title,results:[],cancelled:false};const batch=this.batch,d=this.searchDialog;d.replaceChildren();this.header(d,'MediaBatchTitle',()=>this.closeSearch());d.append(text('p','pd-track-subtitle',title),owned('p','setting-help','MediaBatchConsent',{count:tracks.length}));
      const start=owned('button','button primary','MediaBatchStart');start.type='button';const status=text('p','pd-media-status','');status.id='videoSearchStatus';status.setAttribute('role','status');const results=document.createElement('div');results.className='pd-video-batch';results.id='videoSearchResults';d.append(start,status,results);d.showModal();
      start.onclick=async()=>{
        start.disabled=true;let checked=0,skipped=0,failed=0;
        for(const track of batch.tracks){
          if(this.batch!==batch||batch.cancelled)break;
          I.setText(status,()=>I.t('MediaBatchProgress',{done:checked,total:batch.tracks.length,skipped,failed}));
          try{
            const existing=await this.cmd({action:'info',rel:track.rel});if(existing.musicVideo){skipped++;continue;}
            if(this.batch!==batch||batch.cancelled)break;this.searchRequest=uid();
            const found=await this.cmd({action:'search',rel:track.rel,consent:true,requestId:this.searchRequest});
            if(this.batch!==batch||batch.cancelled)break;
            const group=document.createElement('section');group.className='pd-batch-group';group.append(text('h3','',[track.artist,track.title].filter(Boolean).join(' — ')));
            for(const item of found.items.slice(0,3))group.append(this.resultCard(track,item));if(!found.items.length)group.append(owned('p','setting-help','MediaNoResults'));results.append(group);
          }catch(error){if(!batch.cancelled){failed++;const item=text('p','setting-help',track.title+' — '+I.errorMessage(error));results.append(item);}}
          finally{checked++;this.searchRequest=null;}
        }
        if(this.batch===batch)I.setText(status,()=>I.t('MediaBatchProgress',{done:checked,total:batch.tracks.length,skipped,failed}));
      };
    }
    async closeSearch(remove=true){
      this.searchEpoch++;if(this.batch)this.batch.cancelled=true;
      if(this.searchRequest)this.cmd({action:'cancel',requestId:this.searchRequest}).catch(()=>{});this.searchRequest=null;
      this.searchDialog.close();if(remove){this.searchDialog.replaceChildren();this.searchTrack=null;this.batch=null;}
    }
    async openForDownload(draft){
      if(!draft?.prepared||!M.youtube(draft.sourceUrl))return;
      return this.openEditor({title:draft.prepared.title,artist:draft.prepared.artist,rel:''},draft.sourceUrl,{audioDraft:structuredClone(draft)});
    }
    buildEditor(track){
      const d=this.editorDialog;d.replaceChildren();this.header(d,'MediaTrimTitle',()=>this.closeEditor());d.append(text('p','pd-track-subtitle',[track.artist,track.title].filter(Boolean).join(' — ')));
      const content=document.createElement('div');content.className='pd-clip-content';content.innerHTML=`
        <div class="pd-clip-preview"><video id="clipPreview" preload="metadata" playsinline disablepictureinpicture></video><div id="clipAudioVisual" hidden>${icon('music',42)}${label('MediaAudioPreview')}</div></div>
        <div class="pd-clip-transport"><button id="clipPlay" type="button" class="icon-button" data-i18n-aria-label="UIPlay2" aria-label="${I.h('UIPlay2')}">${icon('play')}</button><output id="clipClock">0:00</output><input id="clipSeek" type="range" min="0" max="1" step=".01" value="0" data-i18n-aria-label="UIPosition" aria-label="${I.h('UIPosition')}"><output id="clipLength">0:00</output><label class="pd-clip-volume">${icon('volume',15)}<input id="clipVolume" type="range" min="0" max="100" data-i18n-aria-label="UIVolume" aria-label="${I.h('UIVolume')}"></label></div>
        <div class="pd-clip-bounds"><label>${label('LyricsStart')}<input id="clipStart" type="number" min="0" step=".01" value="0"></label><label>${label('LyricsEnd')}<input id="clipEnd" type="number" min=".25" step=".01"></label><span id="clipCutDuration"></span></div>
        <div class="pd-clip-ranges"><input id="clipStartRange" type="range" min="0" step=".01" value="0" data-i18n-aria-label="LyricsStart" aria-label="${I.h('LyricsStart')}"><input id="clipEndRange" type="range" min=".25" step=".01" data-i18n-aria-label="LyricsEnd" aria-label="${I.h('LyricsEnd')}"></div>
        <section class="pd-sync-card"><div class="pd-section-heading"><div><h3 data-i18n="MediaSyncTitle">${I.h('MediaSyncTitle')}</h3><p data-i18n="MediaSyncHint">${I.h('MediaSyncHint')}</p></div><button class="button secondary" type="button" id="clipAutoSync">${icon('refresh')}${label('MediaAutoSync')}</button></div>
        <div class="pd-toolbar"><button class="button secondary active" type="button" id="clipHearVideo">${icon('video')}${label('MediaVideo')}</button><button class="button secondary" type="button" id="clipHearAudio">${icon('music')}${label('MediaAudio')}</button><button class="text-button" type="button" id="clipLinkPositions">${icon('link')}${label('MediaLinkPositions')}</button></div>
        <div class="pd-sync-fields"><label>${label('MediaOffset')}<input id="clipOffset" type="number" min="-1800" max="1800" step=".01" value="0"></label><label>${label('MediaRate')}<input id="clipRate" type="number" min="95" max="105" step=".001" value="100"></label><div class="pd-toolbar"><button type="button" class="button secondary" id="clipEarlier">${label('MediaEarlier')}</button><button type="button" class="button secondary" id="clipLater">${label('MediaLater')}</button></div></div>
        <p id="clipSyncStatus" class="setting-help" role="status"></p></section>
        <label class="pd-clip-background"><input id="clipAsBackground" type="checkbox">${label('MediaAsBackground')}</label>
        <p class="setting-help" data-i18n="MediaDownloadNotice">${I.h('MediaDownloadNotice')}</p>
        <audio id="clipReferenceAudio" preload="metadata"></audio>`;
      d.append(content);const footer=document.createElement('footer');footer.className='pd-media-footer';footer.innerHTML=`<div class="pd-media-progress"><p id="clipStatus" role="status" data-i18n="MediaPhase_working">${I.h('MediaPhase_working')}</p><progress id="clipProgress" max="100"></progress></div><div class="pd-toolbar"><button type="button" class="button secondary" id="clipCancel" data-media-cancel>${label('LyricsCancel')}</button><button type="button" class="button primary" id="clipSave">${icon('download')}${label('MediaAddVideo')}</button></div>`;d.append(footer);
      this.previewVideo=this.$('clipPreview');this.referenceAudio=this.$('clipReferenceAudio');this.previewVideo.disablePictureInPicture=true;this.previewVideo.controls=false;
      this.sound.register(this.previewVideo,'clip');this.sound.register(this.referenceAudio,'clip-reference');this.registerPreview(this.previewVideo,'clip');this.registerPreview(this.referenceAudio,'clip-reference');
      this.$('clipVolume').value=Math.round(this.sound.master*100);this.$('clipVolume').oninput=e=>this.setMaster(+e.target.value/100,true);
      this.$('clipPlay').onclick=()=>this.preview();this.previewVideo.onclick=()=>this.preview();this.$('clipCancel').onclick=()=>this.closeEditor();this.$('clipSave').onclick=()=>this.saveEditor();
      this.$('clipSeek').oninput=e=>{const active=this.editor?.listenAudio?this.referenceAudio:this.previewVideo;active.currentTime=+e.target.value;};
      for(const name of ['clipStart','clipEnd','clipStartRange','clipEndRange'])this.$(name).oninput=e=>this.boundChanged(name.includes('Start')?'start':'end',Number(e.target.value));
      this.$('clipOffset').oninput=()=>this.updateMapping();this.$('clipRate').oninput=()=>this.updateMapping();
      this.$('clipEarlier').onclick=()=>{this.$('clipOffset').value=Number(this.$('clipOffset').value)-.1;this.updateMapping();};
      this.$('clipLater').onclick=()=>{this.$('clipOffset').value=Number(this.$('clipOffset').value)+.1;this.updateMapping();};
      this.$('clipLinkPositions').onclick=()=>{this.$('clipOffset').value=(this.previewVideo.currentTime-(this.referenceAudio.currentTime-(this.editor?.referenceStart||0))*(+this.$('clipRate').value/100)).toFixed(4);this.updateMapping();I.setText(this.$('clipSyncStatus'),()=>I.t('MediaManualSync'));};
      this.$('clipHearVideo').onclick=()=>this.changePreview(false);this.$('clipHearAudio').onclick=()=>this.changePreview(true);this.$('clipAutoSync').onclick=()=>this.autoSync();
      for(const media of [this.previewVideo,this.referenceAudio])for(const event of ['timeupdate','play','pause','loadedmetadata','ended'])media.addEventListener(event,()=>this.updatePreview());
      return d;
    }
    async runEditor(e,command){const id=e.requestId=uid();try{return await this.cmd({...command,requestId:id});}finally{if(e.requestId===id)e.requestId=null;}}
    setEditorBusy(value){const e=this.editor;if(e)e.busy=value;for(const node of this.editorDialog.querySelectorAll('button,input'))if(!node.hasAttribute('data-media-cancel'))node.disabled=value;this.editorDialog.setAttribute('aria-busy',String(value));if(!value&&e){this.$('clipHearAudio').disabled=!this.referenceAudio.getAttribute('src');this.$('clipLinkPositions').disabled=!this.referenceAudio.getAttribute('src');}this.$('clipProgress').hidden=!value;}
    async openEditor(track,url,options={}){
      if(this.editor)return;const e=this.editor={track,url,...options,start:0,end:0,offset:0,rate:1,listenAudio:false,requestId:null,token:null,cancelled:false,busy:true};
      if(options.fromSearch){if(this.batch)this.batch.cancelled=true;if(this.searchRequest)this.cmd({action:'cancel',requestId:this.searchRequest}).catch(()=>{});this.searchDialog.close();}
      this.claimPreview('clip');const d=this.buildEditor(track);this.$('clipAsBackground').checked=!!options.asBackground;this.setEditorBusy(true);d.showModal();
      try{
        if(track.rel){e.record=await this.cmd({action:'info',rel:track.rel});if(this.editor!==e)return;}
        const p=await this.runEditor(e,{action:'prepare',url,rel:track.rel||undefined,consent:true});
        if(this.editor!==e){this.cmd({action:'release',token:p.token}).catch(()=>{});return;}
        e.token=p.token;e.prepared=p;e.end=p.duration;if(/^https?:/.test(p.url))this.previewVideo.crossOrigin='anonymous';else this.previewVideo.removeAttribute('crossorigin');this.previewVideo.src=p.url;this.previewVideo.load();this.sound.setProfile(this.previewVideo,p.profile,p.token);
        if(options.audioDraft){e.offset=options.audioDraft.start||0;this.referenceAudio.crossOrigin='anonymous';this.referenceAudio.src=options.audioDraft.prepared.previewUrl;this.referenceAudio.load();e.referenceStart=options.audioDraft.start||0;I.setText(this.$('clipSyncStatus'),()=>I.t('MediaSameSource'));}
        else if(track.rel){const resolved=await this.api.library.playback(track.rel);if(this.editor!==e)return;if(/^https?:/.test(resolved.audioUrl))this.referenceAudio.crossOrigin='anonymous';else this.referenceAudio.removeAttribute('crossorigin');this.referenceAudio.src=resolved.audioUrl;this.referenceAudio.load();this.soundUI.profile(track).then(p=>{if(this.editor===e)this.sound.setProfile(this.referenceAudio,p,track.rel);}).catch(()=>{});}
        if(this.editor!==e)return;
        for(const id of ['clipStartRange','clipEndRange','clipStart','clipEnd'])this.$(id).max=p.duration;
        this.$('clipEnd').value=p.duration.toFixed(2);this.$('clipEndRange').value=p.duration;this.$('clipOffset').value=e.offset;this.updateMapping();this.updateBounds();I.setText(this.$('clipStatus'),()=>I.t('MediaReady'));this.setEditorBusy(false);
      }catch(error){if(this.editor===e){I.setText(this.$('clipStatus'),()=>I.errorMessage(error));this.setEditorBusy(false);if(!e.prepared)this.$('clipSave').disabled=true;}}
    }
    boundChanged(which,value){const e=this.editor;if(!e?.prepared)return;if(which==='start')e.start=M.clamp(value||0,0,e.end-.25);else e.end=M.clamp(value||.25,e.start+.25,e.prepared.duration);this.updateBounds();if(!e.listenAudio)this.previewVideo.currentTime=which==='start'?e.start:Math.max(e.start,e.end-1);}
    updateBounds(){const e=this.editor;if(!e)return;for(const [key,value]of [['Start',e.start],['End',e.end]]){this.$('clip'+key).value=value.toFixed(2);this.$('clip'+key+'Range').value=value;}I.setText(this.$('clipCutDuration'),()=>I.t('MediaCutDuration',{duration:this.formatTime(e.end-e.start)}));}
    updateMapping(){const e=this.editor;if(!e)return;const mapping=M.sync({offset:+this.$('clipOffset').value,rate:+this.$('clipRate').value/100});e.offset=mapping.offset;e.rate=mapping.rate;}
    updatePreview(){
      const e=this.editor;if(!e?.prepared)return;const media=e.listenAudio?this.referenceAudio:this.previewVideo;
      if(!e.listenAudio&&!media.paused&&media.currentTime>=e.end-.025){media.pause();media.currentTime=e.start;}
      this.$('clipClock').textContent=this.formatTime(media.currentTime);this.$('clipLength').textContent=this.formatTime(media.duration||0);const seek=this.$('clipSeek');seek.max=Number.isFinite(media.duration)?media.duration:1;if(document.activeElement!==seek)seek.value=media.currentTime;this.$('clipPlay').innerHTML=icon(media.paused?'play':'pause');
    }
    async preview(){const e=this.editor;if(!e?.prepared||e.busy)return;const media=e.listenAudio?this.referenceAudio:this.previewVideo,owner=e.listenAudio?'clip-reference':'clip';if(!media.paused){media.pause();return;}if(!e.listenAudio&&(media.currentTime<e.start||media.currentTime>=e.end-.02))media.currentTime=e.start;try{await this.playPreview(owner,media);}catch(error){I.setText(this.$('clipStatus'),()=>I.errorMessage(error));}}
    async changePreview(audio){
      const e=this.editor;if(!e?.prepared||e.listenAudio===audio)return;const from=e.listenAudio?this.referenceAudio:this.previewVideo,to=audio?this.referenceAudio:this.previewVideo,playing=!from.paused;from.pause();
      const referenceStart=e.referenceStart||0;
      const desired=audio?M.audioTime(from.currentTime,e)+referenceStart:M.videoTime(from.currentTime-referenceStart,e);
      if(to.readyState>0)to.currentTime=M.clamp(desired,0,Number.isFinite(to.duration)?to.duration:Infinity);
      e.listenAudio=audio;this.$('clipAudioVisual').hidden=!audio;this.$('clipHearAudio').classList.toggle('active',audio);this.$('clipHearVideo').classList.toggle('active',!audio);this.updatePreview();if(playing)await this.preview();
    }
    async autoSync(){
      const e=this.editor;if(!e?.token||e.busy)return;
      this.previewVideo.pause();this.referenceAudio.pause();
      if(e.audioDraft){e.offset=e.audioDraft.start||0;e.rate=1;this.$('clipOffset').value=e.offset;this.$('clipRate').value=100;I.setText(this.$('clipSyncStatus'),()=>I.t('MediaSameSource'));return;}
      this.setEditorBusy(true);I.setText(this.$('clipSyncStatus'),()=>I.t('MediaSyncWorking'));
      try{
        const r=await this.runEditor(e,{action:'sync',token:e.token,rel:e.track.rel});if(this.editor!==e)return;
        if(!r.matched){I.setText(this.$('clipSyncStatus'),()=>I.t('MediaSyncNoMatch'));return;}
        e.offset=r.offset;e.rate=r.rate;this.$('clipOffset').value=r.offset;this.$('clipRate').value=(r.rate*100).toFixed(5);
        I.setText(this.$('clipSyncStatus'),()=>I.t('MediaSyncMatched',{confidence:Math.round(r.confidence*100),offset:r.offset.toFixed(3)}));
      }catch(error){if(this.editor===e)I.setText(this.$('clipSyncStatus'),()=>I.errorMessage(error));}
      finally{if(this.editor===e){this.setEditorBusy(false);I.setText(this.$('clipStatus'),()=>I.t('MediaReady'));}}
    }
    async saveEditor(){
      const e=this.editor;if(!e?.token||e.busy)return;this.previewVideo.pause();this.referenceAudio.pause();this.updateMapping();
      try{M.trim(e.start,e.end,e.prepared.duration);}catch{I.setText(this.$('clipStatus'),()=>I.t('MediaTrimInvalid'));return;}
      if(e.record?.musicVideo&&!e.replace){
        I.setText(this.$('clipStatus'),()=>I.t('MediaReplaceConfirm'));I.setText(this.$('clipSave'),()=>I.t('MediaReplace'));e.replace=true;return;
      }
      this.setEditorBusy(true);
      try{
        if(e.audioDraft&&!e.audioResult){
          I.setText(this.$('clipStatus'),()=>I.t('MediaSavingAudio'));const d=e.audioDraft;
          const result=await this.downloadAudio(d.sourceUrl,{start:d.start,end:d.end,prepared:d.prepared});
          if(!result?.ok)throw Error(result?.message||I.t('MediaAudioDownloadFailed'));e.audioResult=result;e.track={...e.track,rel:result.rel};
          if(this.editor!==e)return;e.record=await this.cmd({action:'info',rel:result.rel});
        }
        if(this.editor!==e)return;
        const r=await this.runEditor(e,{action:'save',token:e.token,rel:e.track.rel,start:e.start,end:e.end,offset:e.offset,rate:e.rate,revision:e.record?.revision||null,replace:!!e.replace,asBackground:this.$('clipAsBackground').checked});
        if(this.editor!==e)return;await this.acceptRecord(e.track,r);this.notify('good',I.t('MediaSaved'),e.track.title);if(e.audioDraft)this.finishAudioDownload?.();await this.closeEditor();
      }catch(error){if(this.editor===e){I.setText(this.$('clipStatus'),()=>(e.audioResult?I.t('MediaAudioKept')+' ':'')+I.errorMessage(error));this.setEditorBusy(false);}}
    }
    async closeEditor(){
      const e=this.editor;if(!e)return;this.editor=null;e.cancelled=true;
      if(e.requestId)this.cmd({action:'cancel',requestId:e.requestId}).catch(()=>{});
      for(const media of [this.previewVideo,this.referenceAudio]){media?.pause();media?.removeAttribute('src');media?.load();this.unregisterPreview?.(media);}
      this.editorDialog.close();this.editorDialog.replaceChildren();if(e.token)await this.cmd({action:'release',token:e.token}).catch(()=>{});
      if(e.fromSearch&&this.searchDialog.children.length)this.searchDialog.showModal();
    }
    lock(){this.trackEpoch++;this.closeEditor();this.closeSearch();this.record=null;if(this.currentTrack()?.vaultKey)this.transport.resetVideo();}
  }
  window.PulseMusicVideoUI=MusicVideoUI;
})();
