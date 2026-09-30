'use strict';
(() => {
  const I=window.PulseI18n,M=window.PulsePresets;
  const labels={appearance:'UIAppearance',player:'UIPlayer',games:'UIGameOverlay',hotkeys:'UIKeyboardShortcuts2',library:'UILibrary',language:'LanguageSettingsTitle',playback:'PresetsPlayback',search:'PresetsSearch',updates:'UpdatesTitle'};
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  window.PulsePresetsUI=class {
    constructor({api,prepare,applied,confirm,notify}){
      Object.assign(this,{api,prepare,applied,confirm,notify});this.items=[];this.busy=false;
      this.panel=document.querySelector('[data-settings-panel="presets"]');this.list=this.panel.querySelector('#presetList');this.status=this.panel.querySelector('#presetStatus');
      this.panel.querySelector('#presetCreate').onclick=()=>this.edit();
      this.dialog=el('dialog','ly-dialog preset-editor');this.dialog.id='presetEditor';
      this.dialog.innerHTML=`<form method="dialog"><header><div><span class="eyebrow" data-i18n="PresetsTitle">${I.h('PresetsTitle')}</span><h2 id="presetEditorTitle"></h2></div><button type="button" class="icon-button" data-preset-cancel data-i18n-aria-label="UIClose" aria-label="${I.h('UIClose')}">${window.Icon('close',18)}</button></header><label class="preset-name"><span data-i18n="PresetsName">${I.h('PresetsName')}</span><input id="presetName" maxlength="60" required autocomplete="off"></label><fieldset id="presetSections"><legend data-i18n="PresetsSections">${I.h('PresetsSections')}</legend><div class="preset-section-options"></div></fieldset><p class="setting-help" data-i18n="PresetsSafeScope">${I.h('PresetsSafeScope')}</p><p id="presetEditorError" class="form-error" role="alert"></p><div class="ly-dialog-actions"><button type="button" class="button secondary" data-preset-cancel data-i18n="UICancel">${I.h('UICancel')}</button><button id="presetSave" type="submit" class="button primary" data-i18n="UISave">${I.h('UISave')}</button></div></form>`;
      document.body.append(this.dialog);I.translate?.(this.dialog);
      this.dialog.querySelectorAll('[data-preset-cancel]').forEach(b=>b.onclick=()=>{if(!this.busy)this.dialog.close();});
      this.dialog.addEventListener('cancel',e=>{if(this.busy)e.preventDefault();});
      this.dialog.querySelector('form').onsubmit=e=>{e.preventDefault();this.save();};
      this.dialog.addEventListener('keydown',e=>e.stopPropagation());
      document.addEventListener('pulsedeck:language-changed',()=>{this.render();});
    }
    command(c){if(!this.api.presets?.command)return Promise.reject(I.error('PresetsUnavailable'));return this.api.presets.command(c);}
    async load(){try{this.items=await this.command({type:'list'});this.render();this.status.textContent='';}catch(e){this.failure(e);}}
    failure(e){this.status.textContent=I.errorMessage(e);this.notify('bad',I.t('PresetsTitle'),I.errorMessage(e));}
    render(){
      this.list.replaceChildren();
      if(!this.items.length){const empty=el('div','preset-empty');empty.innerHTML=window.Icon('palette',34);empty.append(el('h3','',I.t('PresetsEmpty')),el('p','setting-help',I.t('PresetsEmptyHint')));this.list.append(empty);return;}
      for(const p of [...this.items].sort((a,b)=>a.createdAt-b.createdAt)){
        const card=el('article','preset-card');card.dataset.presetId=p.id;
        const main=el('button','preset-apply');main.type='button';main.title=I.t('PresetsApply');main.disabled=this.busy;main.onclick=()=>this.apply(p);
        const preview=el('span','preset-visual');const colors={purple:'#8b72ff',blue:'#4665c2',green:'#729b46',red:'#da5363',orange:'#e89546',pink:'#d57fab'};
        const color=p.settings.customAccent||colors[p.settings.accent]||'#8b72ff';if(/^#[a-f\d]{6}$/i.test(color))preview.style.setProperty('--preset-accent',color);
        preview.innerHTML=window.Icon('palette',25);const ref=p.settings.appIcon;
        if(ref&&this.api.appearance?.iconUrl)this.api.appearance.iconUrl(ref).then(url=>{if(url&&preview.isConnected){const image=el('img');image.src=url;image.alt='';preview.replaceChildren(image);}}).catch(()=>{});
        const text=el('span','preset-copy');text.append(el('strong','',p.name),el('span','',p.sections.map(s=>I.t(labels[s])).join(' · ')));
        main.append(preview,text,el('span','preset-apply-glyph','→'));card.append(main);
        const actions=el('div','preset-card-actions');
        for(const [label,action] of [['PresetsRename',()=>this.edit(p,true)],['PresetsReplace',()=>this.edit(p,false)],['UIDelete',()=>this.confirm({title:I.t('PresetsDeleteTitle'),text:I.t('PresetsDeleteHint',{name:p.name}),actionText:I.t('UIDelete'),danger:true,icon:'trash',onConfirm:async()=>{this.items=await this.command({type:'delete',id:p.id});this.render();}})]]){
          const b=el('button','text-button',I.t(label));b.type='button';b.disabled=this.busy;b.onclick=action;actions.append(b);
        }
        card.append(actions);this.list.append(card);
      }
    }
    edit(p=null,rename=false){
      if(this.busy)return;this.editing=p;this.renaming=rename;
      this.dialog.querySelector('#presetEditorTitle').textContent=I.t(rename?'PresetsRename':p?'PresetsReplace':'PresetsCreate');
      this.dialog.querySelector('#presetName').value=p?.name||'';this.dialog.querySelector('#presetEditorError').textContent='';
      const group=this.dialog.querySelector('#presetSections');group.hidden=rename;const options=group.querySelector('.preset-section-options');options.replaceChildren();
      for(const s of Object.keys(M.SECTIONS)){
        const label=el('label','preset-section-choice'),check=el('input');check.type='checkbox';check.value=s;check.checked=p?p.sections.includes(s):true;label.append(check,el('span','',I.t(labels[s])));options.append(label);
      }
      this.dialog.showModal();this.dialog.querySelector('#presetName').focus();this.dialog.querySelector('#presetName').select();
    }
    async save(){
      if(this.busy)return;const name=this.dialog.querySelector('#presetName').value.trim(),sections=[...this.dialog.querySelectorAll('#presetSections input:checked')].map(n=>n.value);
      if(!name||(!this.renaming&&!sections.length)){this.dialog.querySelector('#presetEditorError').textContent=I.t('PresetsInvalid');return;}
      this.busy=true;this.dialog.querySelector('#presetSave').disabled=true;
      try{if(!this.renaming)await this.prepare();this.items=await this.command({type:this.renaming?'rename':'save',id:this.editing?.id,name,sections});this.dialog.close();this.status.textContent=I.t('PresetsSaved');}
      catch(e){this.dialog.querySelector('#presetEditorError').textContent=I.errorMessage(e);}
      finally{this.busy=false;this.dialog.querySelector('#presetSave').disabled=false;this.render();}
    }
    async apply(p){
      if(this.busy)return;this.busy=true;this.render();this.status.textContent=I.t('PresetsApplying');
      try{await this.prepare();const result=await this.command({type:'apply',id:p.id});await this.applied(result.settings);this.status.textContent=I.t('PresetsApplied',{name:p.name});if(result.warnings?.length)this.notify('warn',I.t('PresetsTitle'),result.warnings.join('\n'));}
      catch(e){this.failure(e);}
      finally{this.busy=false;this.render();}
    }
  };
})();
