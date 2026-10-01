'use strict';
(() => {
  const P=window.PulseLyricsView.prototype,I=window.PulseI18n;
  const old={};for(const k of ['initStudio','openSettings','renderSettings','renderSettingsColors','paintTheme','flushPresentation','clearData'])old[k]=P[k];
  const clone=a=>structuredClone(a),valid=a=>Array.isArray(a)&&a.length>=2&&a.length<=4&&a.every(c=>/^#[a-f\d]{6}$/i.test(c));
  Object.assign(P,{
    initStudio(){
      old.initStudio.call(this);
      const preview=this.$('lyricsThemePreview');preview.dataset.lyricsBackgroundDrop='';
      const group=document.createElement('section');group.className='ly-custom-background';group.dataset.lyricsBackgroundDrop='';group.id='lyricsBackgroundUpload';
      group.innerHTML=`<button type="button" id="lyricsBackgroundChoose" class="button secondary">${this.icon('folder',17)}<span data-i18n="LyricsBackgroundChoose">${I.h('LyricsBackgroundChoose')}</span></button><span class="ly-help" data-i18n="LyricsBackgroundDropHint">${I.h('LyricsBackgroundDropHint')}</span>`;
      const find=document.createElement('button');find.id='lyricsBackgroundFind';find.type='button';find.className='button secondary';find.innerHTML=`${this.icon('search',17)}<span data-i18n="MediaFind">${I.h('MediaFind')}</span>`;
      const video=document.createElement('button');video.id='lyricsBackgroundVideo';video.type='button';video.className='button secondary';video.innerHTML=`${this.icon('video',17)}<span data-i18n="MediaFindVideo">${I.h('MediaFindVideo')}</span>`;
      group.querySelector('.ly-help').before(find,video);find.onclick=()=>Promise.resolve(this.findBackground?.()).catch(e=>this.error(e));video.onclick=()=>Promise.resolve(this.findVideo?.()).catch(e=>this.error(e));
      preview.after(group);
      this.$('lyricsBackgroundChoose').onclick=()=>this.chooseBackground();
      this.$('lyricsSettings').addEventListener('close',()=>this.$('lyricsThemePreview')?.querySelector('video')?.pause());
      for(const zone of [group,preview]){
        for(const name of ['dragenter','dragover'])zone.addEventListener(name,e=>{if(!Array.from(e.dataTransfer?.types||[]).includes('Files'))return;e.preventDefault();e.stopPropagation();zone.classList.add('ly-background-drop');e.dataTransfer.dropEffect='copy';});
        zone.addEventListener('dragleave',e=>{if(!zone.contains(e.relatedTarget))zone.classList.remove('ly-background-drop');});
        zone.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();zone.classList.remove('ly-background-drop');const files=[...(e.dataTransfer?.files||[])];if(files.length!==1){this.error(I.error('CoverDropOne'));return;}this.chooseBackground(files[0]);});
      }
      this.api.settings.get().then(s=>{this.lastGradient=valid(s.lyricsLastGradient)?clone(s.lyricsLastGradient):null;}).catch(()=>{});
    },
    openSettings(){
      this.previousGradient=this.lastGradient?clone(this.lastGradient):null;
      old.openSettings.call(this);
      this.api.settings.get().then(s=>{if(!this.$('lyricsSettings').open)return;this.previousGradient=valid(s.lyricsLastGradient)?clone(s.lyricsLastGradient):null;this.renderGradientSuggestions();}).catch(()=>{});
    },
    renderSettings(){old.renderSettings.call(this);this.renderGradientSuggestions();},
    renderGradientSuggestions(){
      const box=this.$('lyricsGradientPresets');if(!box)return;box.replaceChildren();
      const fixed=[['LyricsSunset',['#794332','#362144']],['LyricsTide',['#17545b','#172341']],['LyricsDawn',['#f2d8ad','#ceb2c8']]];
      const values=Array.from({length:4},(_,i)=>({label:I.t('LyricsCoverGradient',{number:i+1}),colors:this.coverReady?this.coverVariants?.[i]:null,kind:'cover'}));
      values.push(...fixed.map(([key,colors])=>({label:I.t(key),colors,kind:'fixed'})),{label:I.t('LyricsPreviousGradient'),colors:this.previousGradient,kind:'previous'});
      for(const item of values){
        const b=document.createElement('button');b.type='button';b.className='ly-preset';b.dataset.gradientSource=item.kind;
        b.title=item.label+(!item.colors?' — '+I.t(item.kind==='cover'?'LyricsGradientNoCover':'LyricsGradientNoPrevious'):'');b.setAttribute('aria-label',b.title);
        b.disabled=!valid(item.colors);
        if(item.colors)b.style.background=`linear-gradient(135deg in srgb,${item.colors.join(',')})`;
        if(item.kind==='previous')b.innerHTML=this.icon('clock',15);
        b.onclick=()=>{this.theme.gradientColors=clone(item.colors);this.theme.background=item.colors[0];this.theme.paletteSource='manual';this.renderSettings();this.paintTheme();this.queuePresentation();};box.append(b);
      }
    },
    renderSettingsColors(){
      old.renderSettingsColors.call(this);
      const list=this.$('lyricsGradientColors'),stops=[...list.children];
      const b=document.createElement('button');b.id='lyricsSwitchColors';b.type='button';b.className='ly-color-switch';b.title=I.t('LyricsSwitchColors');b.setAttribute('aria-label',b.title);
      b.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4"/></svg>';
      b.onclick=()=>{this.theme.gradientColors.reverse();this.theme.background=this.theme.gradientColors[0];this.theme.paletteSource='manual';this.$('lyricsPrimaryColor').value=this.theme.background;this.renderSettingsColors();this.paintTheme();this.queuePresentation();};
      if(stops[1])list.insertBefore(b,stops[1]);
      list.dataset.stopCount=String(stops.length);
    },
    paintTheme(){
      const result=old.paintTheme.call(this),preview=this.$('lyricsThemePreview');
      const custom=this.scene?.mode==='custom'&&this.customBackground,art=this.scene?.mode==='cover'&&this.coverReady;
      const media=custom?this.customBackground:art?{url:this.coverSource,type:this.coverType}:null;
      if(preview&&this.$('lyricsSettings').open){
        let element=preview.querySelector('.ly-background-preview-media');
        if(media){
          const video=window.PulseCoverMedia.isVideo(media.url,media.type);
          if(!element||video!==(element.tagName==='VIDEO')){element?.pause?.();element?.remove();element=document.createElement(video?'video':'img');element.className='ly-background-preview-media';element.alt='';element.draggable=false;preview.prepend(element);}
          if(element.getAttribute('src')!==media.url)element.src=media.url;
          if(video){element.muted=true;element.loop=true;element.playsInline=true;element.preload='metadata';if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.hidden&&(custom||this.track?.animateCover!==false))element.play().catch(()=>{});else element.pause();}
          element.style.opacity=String(this.scene.coverOpacity||.72);
          preview.style.backgroundImage='none';preview.style.backgroundColor=this.scene.base;
        }else {element?.pause?.();element?.remove();}
      }
      if(this.$('lyricsSettings').open)this.renderGradientSuggestions();
      return result;
    },
    async chooseBackground(file=null){
      if(!this.track||this.backgroundBusy)return;
      const rel=this.track.rel,epoch=this.epoch,button=this.$('lyricsBackgroundChoose');
      this.backgroundBusy=true;const controls=[...this.$('lyricsSettings').querySelectorAll('input,select,button')].filter(n=>n!==this.$('lyricsSettingsClose'));const disabled=controls.map(n=>n.disabled);for(const n of controls)n.disabled=true;this.$('lyricsSettings').setAttribute('aria-busy','true');
      // While the picker/import is pending, do not let a newer local theme write
      // race past the imported revision. The existing autosave queue is drained.
      try{
        await this.flushPresentation();if(epoch!==this.epoch)return;
        const revision=this.revisions.get(rel)??this.revision;
        const r=file?await this.api.lyrics.backgroundFromDrop(file,rel,revision):await this.command({type:'background-pick',rel,revision});
        if(epoch!==this.epoch||r.canceled)return;
        this.revision=r.revision;this.revisions.set(rel,r.revision);this.customBackground=r.background||null;
        this.theme=this.L.theme(r.theme);this.doc=r.doc||this.doc;if(this.doc)this.doc.theme=this.theme;
        this.renderSettings();await this.paintTheme();
      }catch(e){if(epoch===this.epoch){this.$('lyricsSettingsError').textContent=I.errorMessage(e);this.error(e);}}
      finally{this.backgroundBusy=false;controls.forEach((n,i)=>{if(n.isConnected)n.disabled=disabled[i];});button.disabled=false;this.$('lyricsSettings').removeAttribute('aria-busy');}
    },
    flushPresentation(){
      const snapshot=this.pendingPresentation;
      const task=old.flushPresentation.call(this);
      // Private artwork palettes must not leak into global/public settings.
      if(snapshot&&!snapshot.rel.startsWith('vault:')&&snapshot.theme.mode==='gradient'&&snapshot.theme.paletteSource==='manual'&&valid(snapshot.theme.gradientColors)){
        return task.then(async()=>{const colors=clone(snapshot.theme.gradientColors);await this.api.settings.set({lyricsLastGradient:colors});this.lastGradient=colors;});
      }
      return task;
    },
    clearData(...args){this.$('lyricsThemePreview')?.querySelector('.ly-background-preview-media')?.remove();return old.clearData.apply(this,args);},
  });
})();
