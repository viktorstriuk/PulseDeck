'use strict';
(() => {
  const I18n=window.PulseI18n, $=s=>document.querySelector(s);
  const resources=[
    {id:'icons',key:'CreditsIcons',items:[['CreditsSVGRepo','CreditsSVGRepoDescription','https://www.svgrepo.com/page/licensing/#PD','CreditsPublicDomain'],['CreditsFontAwesome','CreditsFontAwesomeDescription','https://fontawesome.com/license/free','CreditsCCBY'],['CreditsLegacyIcons','CreditsLegacyIconsDescription','https://fontawesome.com/v4/license/','CreditsOFL']]},
    {id:'runtime',key:'CreditsRuntime',items:[['CreditsElectron','CreditsElectronDescription','https://www.electronjs.org/','CreditsMIT'],['CreditsNode','CreditsNodeDescription','https://nodejs.org/','CreditsMIT'],['CreditsChromium','CreditsChromiumDescription','https://www.chromium.org/','CreditsChromiumLicense'],['CreditsGo','CreditsGoDescription','https://go.dev/','CreditsBSD']]},
    {id:'audio',key:'CreditsAudio',items:[['CreditsFFmpeg','CreditsFFmpegDescription','https://ffmpeg.org/legal.html','CreditsGPL'],['CreditsYtdlp','CreditsYtdlpDescription','https://github.com/yt-dlp/yt-dlp','CreditsYtdlpLicense'],['CreditsLRCLIB','CreditsLRCLIBDescription','https://lrclib.net/','CreditsExternalService'],['CreditsRTSS','CreditsRTSSDescription','https://www.guru3d.com/download/rtss-rivatuner-statistics-server-download/','CreditsSeparateInstall']]},
    {id:'development',key:'CreditsDevelopment',items:[['CreditsAcorn','CreditsAcornDescription','https://github.com/acornjs/acorn','CreditsMIT'],['CreditsPlaywright','CreditsPlaywrightDescription','https://playwright.dev/','CreditsApache']]},
  ];
  const socials=[['github','https://github.com/viktorstriuk','SocialGitHub'],['youtube','https://www.youtube.com/@mushep','SocialYouTube'],['telegram','https://t.me/mushepchannel','SocialTelegram'],['twitch','https://www.twitch.tv/themushep','SocialTwitch'],['tiktok','https://www.tiktok.com/@themushep','SocialTikTok']];
  const text=(node,key,args)=>{if(node)I18n.setText(node,()=>key?I18n.t(key,args):'');};
  function element(tag,cls,key){const n=document.createElement(tag);if(cls)n.className=cls;if(key){n.dataset.i18n=key;n.textContent=I18n.t(key);}return n;}
  function link(url,key,description,license){
    const a=element('a','credit-resource');a.href=url;a.target='_blank';a.rel='noopener noreferrer';
    const head=element('span','credit-resource-head');head.append(element('b','',key),element('i','resource-link-glyph'));a.append(head);
    if(description)a.append(element('span','credit-resource-description',description));if(license)a.append(element('small','credit-license',license));return a;
  }
  class ReleaseCenter {
    constructor({openPage,isBusy=()=>false,api=window.pulse}) {
      Object.assign(this,{openPage,isBusy,api});this.state=null;this.components=null;this.notified=new Set();this.actionBusy=false;this.uiError='';this.componentUiError='';
      this.buildCredits();this.renderAuthorCredit();this.bind();
      api.updates?.onChanged(s=>this.accept(s));api.components?.onChanged(s=>{this.components=s;this.renderComponents();});
      api.updates?.onPrepare(({token})=>{api.updates.prepared({token,safe:!this.isBusy()});});
      this.refresh();document.addEventListener('pulsedeck:language-changed',()=>{this.renderAuthorCredit();this.render();this.renderComponents();});
    }
    renderAuthorCredit(){
      const host=$('#authorExecution');if(!host)return;
      const model=document.createElement('span');model.className='author-model';
      const pro=document.createElement('span');pro.className='author-model-pro';pro.textContent=I18n.t('AboutExecutionPro');
      const rich=(node,key,slots)=>{node.replaceChildren();for(const part of I18n.t(key).split(/(\{[A-Za-z]+\})/g)){
        const slot=slots[part.slice(1,-1)];node.append(part.startsWith('{')&&slot?slot.cloneNode(true):document.createTextNode(part));
      }};
      rich(model,'AboutExecutionModel',{pro});
      const context=document.createElement('strong');context.textContent=I18n.t('AboutExecutionContext');
      rich(host,'AboutExecution',{model,context});
    }
    buildCredits(){
      const list=$('#creditsGroups');list.replaceChildren();
      for(const group of resources){
        const details=element('details','credits-group');details.dataset.creditGroup=group.id;
        const summary=element('summary','credits-summary'),left=element('span','credits-group-label');left.append(element('b','',group.key));const count=element('small','');text(count,'CreditsProjectCount',{count:group.items.length});left.append(count);
        summary.append(left,element('i','credits-chevron'));details.append(summary);const content=element('div','credits-content');for(const item of group.items)content.append(link(item[2],item[0],item[1],item[3]));details.append(content);list.append(details);
      }
      const social=$('#authorSocials');social.replaceChildren(...socials.map(([icon,url,key])=>{const a=element('a','author-social');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.dataset.social=icon;const mark=element('span','brand-glyph');mark.style.setProperty('--brand-icon',`url('../assets/credits/${icon}.svg')`);mark.setAttribute('aria-hidden','true');a.append(mark,element('span','',key));I18n.setAttribute(a,'aria-label',()=>I18n.t('SocialOpen',{name:I18n.t(key)}));return a;}));
      $('#aboutPanel').addEventListener('click',e=>{const a=e.target.closest('a[href]');if(!a)return;e.preventDefault();this.api.system.openExternal(a.href).catch(()=>text($('#creditsLinkStatus'),'CreditsLinkFailed'));});
    }
    async refresh(){try{if(this.api.updates)this.accept(await this.api.updates.status());if(this.api.components){this.components=await this.api.components.status();this.renderComponents();}}catch{this.uiError='UpdatesStatusFailed';this.render();}}
    bind(){
      $('#updatesCheck').addEventListener('click',()=>this.run(()=>this.api.updates.check()));
      $('#updatesDownloadNow').addEventListener('click',()=>this.run(()=>this.api.updates.download('restart')));
      $('#updatesDownloadLater').addEventListener('click',()=>this.run(()=>this.api.updates.download('next-launch')));
      $('#updatesCancel').addEventListener('click',()=>this.api.updates.cancel().catch(()=>{}));
      $('#updatesInstall').addEventListener('click',()=>this.run(()=>this.api.updates.install()));
      $('#updatesDefer').addEventListener('click',()=>this.run(()=>this.api.updates.defer('next-launch')));
      $('#updatesClearDeferred').addEventListener('click',()=>this.run(()=>this.api.updates.defer('ready')));
      for(const [id,key]of [['updatesAuto','automatic'],['updatesPrerelease','prerelease'],['updatesComponentsAuto','components']])$("#"+id).addEventListener('change',e=>this.run(()=>this.api.updates.configure({[key]:e.target.checked})));
      $('#componentList').addEventListener('click',e=>{const b=e.target.closest('[data-component-action]');if(!b)return;this.run(async()=>{const s=await this.api.components[b.dataset.componentAction](b.dataset.componentId);if(s){this.components=s;this.renderComponents();}},true);});
      $('#componentsCheck').addEventListener('click',()=>this.run(async()=>{this.components=await this.api.components.check();this.renderComponents();},true));
      $('#componentsCancel').addEventListener('click',()=>this.api.components.cancel().catch(()=>{}));
    }
    async run(action,component=false){
      if(this.actionBusy)return;this.actionBusy=true;this[component?'componentUiError':'uiError']='';
      try{const s=await action();if(s?.current)this.accept(s);}
      catch(e){this[component?'componentUiError':'uiError']=I18n.errorMessage(e);}
      finally{this.actionBusy=false;this.render();this.renderComponents();}
    }
    accept(s){
      this.state=s;this.render();
      if(s.phase==='available'&&s.available&&!this.notified.has(s.available)){this.notified.add(s.available);const b=element('button','toast info update-notice');b.type='button';b.append(element('span','update-notice-icon'));const copy=element('span','toast-copy');const title=element('strong','');text(title,'UpdatesNewVersion',{version:s.available});copy.append(title,element('span','','UpdatesOpenDetails'));b.append(copy);b.addEventListener('click',()=>{this.openPage('updates');b.remove();});$('#toastStack').prepend(b);setTimeout(()=>b.remove(),14000);}
    }
    render(){
      const s=this.state||{phase:'unconfigured',current:'',prefs:{automatic:true,components:true,prerelease:false}};
      const phases={unconfigured:'UpdatesNotConfigured',idle:'UpdatesReadyToCheck',checking:'UpdatesChecking',available:'UpdatesAvailable',current:'UpdatesCurrent',downloading:'UpdatesDownloading',ready:'UpdatesDownloaded',installing:'UpdatesInstalling',error:'UpdatesCheckFailed',unsupported:'UpdatesUnsupported'};
      $('#updatesStatusCard').dataset.phase=s.phase;text($('#updatesStatus'),phases[s.phase]||'UpdatesReadyToCheck',{version:s.available||s.current});
      text($('#updatesCurrentVersion'),'UpdatesInstalledVersion',{version:s.current||$('#appVersion')?.textContent||'-'});
      text($('#updatesExplanation'),s.phase==='unconfigured'?'UpdatesConfigureHint':s.phase==='ready'?(s.pendingMode==='next-launch'?'UpdatesNextLaunchHint':'UpdatesReadyHint'):s.phase==='available'?'UpdatesAvailableHint':s.phase==='error'?'UpdatesNetworkHint':'UpdatesPrivacyHint');
      text($('#updatesLastChecked'),s.lastCheck?'UpdatesLastChecked':'UpdatesNeverChecked',s.lastCheck?{date:new Intl.DateTimeFormat(I18n.locale,{dateStyle:'short',timeStyle:'short'}).format(s.lastCheck)}:{});
      const error=this.uiError||s.error;text($('#updatesError'),error||null);$('#updatesError').classList.toggle('hidden',!error);
      const busy=['checking','downloading','installing'].includes(s.phase);$('#updatesCheck').disabled=busy||!this.api.updates;
      $('#updatesAvailableActions').classList.toggle('hidden',s.phase!=='available');$('#updatesReadyActions').classList.toggle('hidden',s.phase!=='ready');
      $('#updatesProgressWrap').classList.toggle('hidden',!['downloading','installing'].includes(s.phase));
      const bar=$('#updatesProgress');bar.style.setProperty('--progress',`${Math.max(0,Math.min(100,s.progress||0))}%`);bar.setAttribute('aria-valuenow',String(s.progress||0));$('#updatesProgressValue').textContent=`${Math.round(s.progress||0)}%`;
      $('#updatesCancel').disabled=s.phase!=='downloading';$('#updatesClearDeferred').classList.toggle('hidden',s.pendingMode!=='next-launch'||s.phase!=='ready');
      const notes=s.notes?.[I18n.language]||s.notes?.en||'';$('#updatesNotes').textContent=notes;$('#updatesNotesWrap').classList.toggle('hidden',!notes);
      for(const [id,key]of [['updatesAuto','automatic'],['updatesPrerelease','prerelease'],['updatesComponentsAuto','components']]){const input=$('#'+id);input.checked=!!s.prefs?.[key];input.disabled=busy;}
    }
    renderComponents(){
      const s=this.components||{phase:'unconfigured',items:[]},list=$('#componentList'),focus=document.activeElement?.dataset;
      const items=s.items?.length?s.items:[{id:'ffmpeg'},{id:'ytdlp'}];list.replaceChildren(...items.map(item=>{
        const row=element('div','component-row');row.dataset.component=item.id;
        const icon=element('span','component-icon');icon.innerHTML=window.Icon(item.id==='ffmpeg'?'wave':'download',20);
        const copy=element('div','component-copy');copy.append(element('b','',item.id==='ffmpeg'?'CreditsFFmpeg':'CreditsYtdlp'));const status=element('small','');text(status,!item.installed?'ComponentsNotInstalled':item.version?'ComponentsVersion':item.legacy?'ComponentsLegacy':'ComponentsNotInstalled',{version:item.version});copy.append(status);
        const hint=element('span','component-hint');text(hint,item.available?'ComponentsAvailable':item.id==='ffmpeg'?'ComponentsFFmpegHint':'ComponentsYtdlpHint',{version:item.available});copy.append(hint);row.append(icon,copy);
        const actions=element('div','component-actions'),button=element('button','button secondary small',item.available?'ComponentsUpdate':item.installed?'ComponentsInstalled':'ComponentsInstall');button.type='button';button.dataset.componentAction='install';button.dataset.componentId=item.id;button.disabled=!!item.installed&&!item.available||['checking','downloading','verifying'].includes(s.phase);actions.append(button);
        if(item.rollback){const back=element('button','icon-button subtle');back.type='button';back.innerHTML=window.Icon('undo',16);I18n.setAttribute(back,'title',()=>I18n.t('ComponentsRollback'));I18n.setAttribute(back,'aria-label',()=>I18n.t('ComponentsRollback'));back.dataset.componentAction='rollback';back.dataset.componentId=item.id;back.disabled=['downloading','verifying'].includes(s.phase);actions.append(back);}row.append(actions);return row;
      }));
      if(focus?.componentAction)list.querySelector(`[data-component-action="${focus.componentAction}"][data-component-id="${focus.componentId}"]`)?.focus({preventScroll:true});
      $('#componentsProgressWrap').classList.toggle('hidden',!['downloading','verifying'].includes(s.phase));text($('#componentsProgressText'),s.phase==='verifying'?'ComponentsVerifying':'ComponentsDownloading',{percent:Math.round(s.progress||0)});$('#componentsProgress').style.setProperty('--progress',`${s.progress||0}%`);$('#componentsProgress').setAttribute('aria-valuenow',String(s.progress||0));
      const error=this.componentUiError||s.error;text($('#componentsError'),error||null);$('#componentsError').classList.toggle('hidden',!error);text($('#componentsHint'),s.phase==='checking'?'ComponentsChecking':s.source==='signed'?'ComponentsApprovedOnly':'ComponentsPublisherHint');$('#componentsCheck').disabled=!this.api.components?.check||['checking','downloading','verifying'].includes(s.phase);$('#componentsDirectory').textContent=s.directory||'';
    }
  }
  window.PulseReleaseCenter=ReleaseCenter;
})();
