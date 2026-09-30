/* Track metadata, artwork and confirmed import. No filesystem or network access
 * here: the isolated bridge owns paths, validation, tokens and write queues. */
(() => {
  'use strict';
  const I=window.PulseI18n,F=window.PulseTrackEnrichment;
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const uid=()=>crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
  const actionKeys={artists:'EnrichArtists',covers:'EnrichCovers',lyrics:'EnrichLyrics'};
  const actionIcons={artists:'edit',covers:'image',lyrics:'lyrics'};
  const titleKeys={artists:'EnrichArtistsTitle',covers:'EnrichCoversTitle',lyrics:'EnrichLyricsTitle'};
  class TrackTools {
    constructor(options){
      this.o=options;this.popup=null;this.capEpoch=0;this.currentJob=null;this.importState=null;
      this.o.api.library.onProgress?.(p=>this.progress(p));
      this.o.api.lyrics?.onLock?.(()=>{this.closePopup(false);this.menuClosed();if(this.importState?.private){if(this.currentJob)this.cmd({type:'job-cancel',id:this.currentJob}).catch(()=>{});this.currentJob=null;this.importState=null;this.dialog?.close();this.dialog?.replaceChildren();this.progressTitle=null;this.jobLogs=[];this.earlyProgress=null;}});
      document.addEventListener('pointerdown',e=>{if(this.popup&&!this.popup.root.contains(e.target)&&!this.popup.anchor?.contains?.(e.target))this.closePopup(false);},true);
      document.addEventListener('keydown',e=>{
        if(this.dialog?.open&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.cancelDialog();return;}
        if(this.popup&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.closePopup(true);return;}
        // Modal import owns keyboard shortcuts (not playback/playlist hotkeys).
        if(this.dialog?.open&&!/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)&&[' ','Enter'].includes(e.key))e.stopPropagation();
      },true);
      window.addEventListener('resize',()=>this.positionPopup());
      document.addEventListener('pulsedeck:language-changed',()=>this.closePopup(false));
      this.bindDrop();
    }
    t(key,args){return I.t(key,args);}
    localized(tag,cls,key,args){const n=node(tag,cls);I.setText(n,()=>this.t(key,args));return n;}
    cmd(c){return this.o.api.library.command(c);}
    error(error){return I.errorMessage(error)||this.t('EnrichFailed');}
    button(key,cls='button secondary',icon){const b=node('button',cls);b.type='button';if(icon)b.innerHTML=window.Icon(icon,16);b.append(this.localized('span','',key));return b;}
    iconButton(key,icon){const b=node('button','track-tools-icon');b.type='button';b.innerHTML=window.Icon(icon,17);I.setAttribute(b,'title',()=>this.t(key));I.setAttribute(b,'aria-label',()=>this.t(key));return b;}
    trackMenu(track){
      if(!this.o.api.library.command||!track?.rel)return '';
      return this.o.submenu('track-edit',this.t('TrackChange'),'edit',
        `<button class="context-item" data-track-edit="artist">${window.Icon('edit',15)}<span data-i18n="TrackArtist">${I.h('TrackArtist')}</span></button>`+
        `<button class="context-item" data-track-edit="title">${window.Icon('music',15)}<span data-i18n="TrackTitle">${I.h('TrackTitle')}</span></button>`+
        (window.PulseCoverMedia.isVideo(track.coverUrl,track.coverType)?`<button class="context-item" data-track-animate role="menuitemcheckbox" aria-checked="${this.o.animationEnabled(track)}">${window.Icon('play',15)}<span data-i18n="CoverAnimate">${I.h('CoverAnimate')}</span><span class="cover-animation-mark">${window.Icon(this.o.animationEnabled(track)?'check':'close',14)}</span></button>`:'')+
        `<button class="context-item" data-track-cover aria-haspopup="dialog">${window.Icon('image',15)}<span data-i18n="CoverChange">${I.h('CoverChange')}</span><span class="context-arrow">${window.Icon('chevronRight',13)}</span></button>`);
    }
    handleMenu(event,menu){
      const animation=event.target.closest('[data-track-animate]');
      if(animation){event.preventDefault();event.stopPropagation();this.o.toggleAnimation(menu.dataset.trackId,animation);return true;}
      const edit=event.target.closest('[data-track-edit]'),cover=event.target.closest('[data-track-cover]'),batch=event.target.closest('[data-enrich-action]');
      if(!edit&&!cover&&!batch)return false;event.preventDefault();event.stopPropagation();
      if(batch){const snapshot=this.categorySnapshot;if(snapshot)this.openBatch(snapshot,batch.dataset.enrichAction);return true;}
      const track=this.o.getTrackById(menu.dataset.trackId);if(!track)return true;
      if(edit)this.openRename(track,edit.dataset.trackEdit,edit);else this.openCover(track,cover);
      return true;
    }
    menuClosed(){this.capEpoch++;if(this.capId)this.cmd({type:'cancel-capabilities',requestId:this.capId}).catch(()=>{});this.capId=null;this.capProgress=null;this.categorySnapshot=null;}
    async attachCategoryMenu(menu,cat,tracks){
      this.menuClosed();if(!this.o.api.library.command||!tracks.length||tracks.length>2000)return;
      const epoch=this.capEpoch,requestId=this.capId='cap-'+uid(),rels=[...new Set(tracks.map(t=>t.rel))];
      const slot=node('div','enrich-menu-slot');menu.querySelector('.context-sep')?.before(slot);if(!slot.isConnected)menu.append(slot);
      const render=counts=>{
        if(epoch!==this.capEpoch||menu.classList.contains('hidden')||menu.dataset.menuKind!=='category'||!slot.isConnected)return;
        this.categorySnapshot={rels,counts:{...counts},title:cat.label,private:!!cat.protected};
        const actions=F.actions(counts);if(!actions.length){slot.replaceChildren();return;}
        if(!slot.firstChild)slot.innerHTML=this.o.submenu('enrich',this.t('EnrichMore'),'layers','');
        const list=slot.querySelector('.context-submenu');
        for(const action of F.ACTIONS){let button=list.querySelector(`[data-enrich-action="${action}"]`);
          if(!actions.includes(action)){button?.remove();continue;}
          if(!button){button=node('button','context-item');button.dataset.enrichAction=action;button.innerHTML=window.Icon(actionIcons[action],15);button.append(this.localized('span','',titleKeys[action]),node('small'));list.append(button);}
          button.querySelector('small').textContent=String(counts[action]);
        }
        this.o.arm(menu);requestAnimationFrame(()=>{const r=menu.getBoundingClientRect();if(r.bottom>innerHeight-12)menu.style.top=`${Math.max(12,innerHeight-r.height-12)}px`;});
      };
      this.capProgress={requestId,render};
      // The library already knows missing artwork and inferable names. Expose
      // them now; disk/lyrics checks only refine counts and add new actions.
      const local={artists:0,covers:0,lyrics:0};for(const track of tracks){const needs=F.needs(track);for(const key of ['artists','covers'])if(needs[key])local[key]++;}render(local);
      try{const result=await this.cmd({type:'capabilities',rels,requestId});render(result.counts||{});}
      catch{if(epoch===this.capEpoch&&!slot.firstChild)slot.remove();}
    }
    createPopup(kind,title,anchor,width=374){
      this.closePopup(false);this.o.closeSearch?.();
      const root=node('section','context-menu track-tools-popover '+kind);root.dataset.trackToolsPopover='';root.setAttribute('role','dialog');root.setAttribute('aria-label',this.t(title));root.setAttribute('popover','manual');
      const head=node('div','track-tools-heading'),heading=node('strong','',this.t(title)),close=this.iconButton('TrackClose','close');head.append(heading,close);root.append(head);document.body.append(root);
      close.addEventListener('click',()=>this.closePopup(true));this.popup={root,anchor,rect:anchor?.getBoundingClientRect?.(),width,requestId:'cover-'+uid(),epoch:0};
      root.showPopover?.();this.positionPopup();return this.popup;
    }
    positionPopup(){
      const p=this.popup;if(!p)return;const r=p.anchor?.isConnected&&p.anchor.getClientRects().length?p.anchor.getBoundingClientRect():p.rect||{left:innerWidth/2,right:innerWidth/2,top:innerHeight/3,bottom:innerHeight/3};
      const width=Math.min(p.width,innerWidth-24);p.root.style.width=width+'px';p.root.style.maxHeight=`${innerHeight-24}px`;
      let left=r.right+8;if(left+width>innerWidth-12)left=r.left-width-8;if(left<12)left=Math.max(12,Math.min(r.left,innerWidth-width-12));
      const height=p.root.getBoundingClientRect().height;Object.assign(p.root.style,{left:left+'px',top:Math.max(12,Math.min(r.top,innerHeight-height-12))+'px'});
    }
    closePopup(restore=false){const p=this.popup;if(!p)return;this.popup=null;clearTimeout(p.timer);p.epoch++;this.cmd({type:'cover-cancel',requestId:p.requestId}).catch(()=>{});p.root.remove();if(restore){const focus=p.anchor?.isConnected&&p.anchor.getClientRects().length?p.anchor:document.querySelector('[data-track-root][data-id="'+CSS.escape(p.track?.id||'')+'"]')||document.querySelector('#library');if(focus){if(!focus.hasAttribute('tabindex')&&!focus.matches('button,input'))focus.tabIndex=-1;focus.focus({preventScroll:true});}}}
    async openRename(track,field,anchor){
      if(!['artist','title'].includes(field))return;
      const p=this.createPopup('track-rename',field==='artist'?'TrackArtist':'TrackTitle',anchor,350),form=node('form','track-rename-form'),label=node('label','track-tools-field',this.t(field==='artist'?'TrackArtistName':'TrackTitleName')),input=node('input');
      p.track=track;input.type='text';input.maxLength=field==='artist'?160:300;input.value=track[field]||'';input.required=true;label.append(input);
      const status=node('p','track-tools-status'),save=this.button('TrackSave','button primary','check');save.type='submit';save.disabled=true;form.append(label,status,save);p.root.append(form);this.positionPopup();
      try{const result=await this.cmd({type:'metadata',rel:track.rel});if(this.popup!==p)return;p.revision=result.revision;input.value=result.track[field]||'';save.disabled=false;input.focus();input.select();}
      catch(error){if(this.popup===p)status.textContent=this.error(error);}
      form.addEventListener('submit',async e=>{e.preventDefault();if(save.disabled)return;const value=F.clean(input.value);if(!value){status.textContent=this.t('TrackBadEdit');input.focus();return;}save.disabled=true;status.textContent=this.t('TrackSaving');
        try{await this.cmd({type:'edit',rel:track.rel,patch:{[field]:value},revision:p.revision});await this.o.refresh();if(this.popup===p)this.closePopup(true);this.o.notify('good',this.t('TrackSaved'),' ',1500);}
        catch(error){if(this.popup===p){status.textContent=this.error(error);save.disabled=false;}}
      });
    }
    async openCover(track,anchor){
      const p=this.createPopup('track-cover-picker','CoverChange',anchor,384);p.track=track;p.items=[];p.seen=new Set();p.selection=track.coverUrl?'current':'';
      const row=node('form','cover-search-row modal-search'),searchIcon=node('span');searchIcon.innerHTML=window.Icon('search',17);
      p.input=node('input');p.input.type='search';p.input.maxLength=300;p.input.placeholder=this.t('CoverSearchPlaceholder');p.input.setAttribute('aria-label',this.t('CoverSearchPlaceholder'));
      const guessed=F.splitName(track);p.input.value=[guessed?.artist||(F.unknown(track.artist)?'':track.artist),guessed?.title||track.title].filter(Boolean).join(' ');
      const search=this.iconButton('CoverFind','search');search.type='submit';row.append(searchIcon,p.input,search);
      p.grid=node('div','cover-grid');p.grid.setAttribute('role','group');p.grid.setAttribute('aria-label',this.t('CoverResults'));
      p.status=node('div','track-tools-status');p.status.setAttribute('role','status');p.status.setAttribute('aria-live','polite');p.status.setAttribute('aria-atomic','true');
      const footer=node('div','cover-picker-footer'),upload=this.button('CoverUpload','button secondary','folder');p.upload=upload;p.more=this.button('CoverMore','button secondary');p.more.hidden=true;footer.append(upload,p.more);
      p.hint=this.localized('p','cover-drop-hint','CoverDropHint');p.root.append(row,p.grid,p.status,p.hint,footer);if(track.coverUrl)this.addCoverTile(p,{id:'current',image:track.coverUrl,coverType:track.coverType,title:this.t('CoverCurrent')});
      // Opening is an explicit search action; no browsing requests happen on hover.
      row.addEventListener('submit',e=>{e.preventDefault();this.findCovers(p);});
      p.input.addEventListener('compositionstart',()=>{p.composing=true;clearTimeout(p.timer);});p.input.addEventListener('compositionend',()=>{p.composing=false;p.timer=setTimeout(()=>this.findCovers(p),320);});
      p.input.addEventListener('input',()=>{clearTimeout(p.timer);if(!p.composing)p.timer=setTimeout(()=>this.findCovers(p),320);});
      upload.addEventListener('click',()=>this.chooseCover(p));p.more.addEventListener('click',()=>this.loadMoreCovers(p,true));
      p.grid.addEventListener('scroll',()=>{if(p.grid.scrollTop+p.grid.clientHeight>=p.grid.scrollHeight-120)this.loadMoreCovers(p);},{passive:true});
      p.grid.addEventListener('wheel',e=>{if(e.deltaY>0&&p.grid.scrollTop+p.grid.clientHeight>=p.grid.scrollHeight-120)this.loadMoreCovers(p);},{passive:true});
      p.grid.addEventListener('click',e=>{const b=e.target.closest('[data-cover-id]');if(b&&!b.disabled&&b.dataset.coverId!=='current')this.chooseCover(p,b.dataset.coverId);});
      p.grid.addEventListener('keydown',e=>{if(!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;const buttons=[...p.grid.querySelectorAll('button:not(:disabled)')],i=buttons.indexOf(e.target);if(i<0)return;e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?buttons.length-1:i+({ArrowRight:1,ArrowLeft:-1,ArrowUp:-4,ArrowDown:4}[e.key]||0);buttons[Math.max(0,Math.min(n,buttons.length-1))]?.focus();});
      this.positionPopup();p.input.focus();p.input.select();
      try{const info=await this.cmd({type:'metadata',rel:track.rel});if(this.popup!==p)return;p.revision=info.revision;p.ready=true;this.findCovers(p);}
      catch(error){if(this.popup===p)p.status.textContent=this.error(error);}
    }
    addCoverTile(p,item){
      const key=item.key||item.image;if(p.seen.has(key))return;p.seen.add(key);p.items.push(item);const tile=node('button','cover-tile');tile.type='button';tile.dataset.coverId=item.id;tile.setAttribute('aria-pressed',String(p.selection===item.id));tile.title=[item.title,item.artist,item.source].filter(Boolean).join(' · ');tile.setAttribute('aria-label',tile.title||this.t('CoverSelect'));
      const image=window.PulseCoverMedia.element(item.image,item.coverType,'cover-tile-media');const check=node('span','cover-selected-mark');check.setAttribute('aria-hidden','true');tile.append(image,check);tile.classList.toggle('selected',p.selection===item.id);p.grid.append(tile);
      image.addEventListener('error',()=>{tile.classList.add('cover-image-failed');tile.disabled=true;});
    }
    coverStatus(p,key,busy=false){
      p.status.textContent=key?this.t(key):'';p.status.classList.toggle('cover-searching',busy);
      p.root.setAttribute('aria-busy',String(busy));
    }
    async findCovers(p){
      if(this.popup!==p||!p.ready||p.saving)return;const query=F.clean(p.input.value);clearTimeout(p.timer);
      const epoch=++p.epoch;p.query=query;this.cmd({type:'cover-cancel',requestId:p.requestId}).catch(()=>{});
      p.pages={music:{},catalog:{}};p.loading=false;p.retryNeeded=false;p.more.hidden=true;
      p.requests={music:`${p.requestId}:${epoch}:music`,catalog:`${p.requestId}:${epoch}:catalog`};
      const retained=p.items.filter(item=>item.id===p.selection);p.items=[];p.seen.clear();p.grid.replaceChildren();p.grid.scrollTop=0;retained.forEach(item=>this.addCoverTile(p,item));
      if(query.length<2){this.coverStatus(p,'CoverTypeMore');this.positionPopup();return;}
      await this.loadMoreCovers(p,true);
    }
    async loadMoreCovers(p,explicit=false){
      if(this.popup!==p||!p.ready||p.saving||p.loading||!p.pages||p.query.length<2||p.retryNeeded&&!explicit)return;
      const phases=['music','catalog'].filter(phase=>!p.pages[phase].done);if(!phases.length)return;
      const epoch=p.epoch;p.loading=true;p.retryNeeded=false;p.more.disabled=true;
      try{for(const phase of phases){
        if(this.popup!==p||p.epoch!==epoch)return;
        const page=p.pages[phase];this.coverStatus(p,phase==='catalog'?'CoverCatalogSearching':'CoverSearching',true);
        const result=await this.cmd({type:'cover-search',rel:p.track.rel,query:p.query,phase,cursor:page.cursor,requestId:p.requests[phase],consent:true});
        if(this.popup!==p||p.epoch!==epoch)return;
        for(const item of result.items||[])this.addCoverTile(p,item);
        page.cursor=result.cursor||null;page.done=!!result.ok&&!page.cursor&&!result.partial;p.retryNeeded||=!result.ok||!!result.partial;
        this.positionPopup();
      }}catch(error){if(this.popup===p&&p.epoch===epoch){p.retryNeeded=true;p.status.textContent=this.error(error);}}
      finally{if(this.popup===p&&p.epoch===epoch){
        p.loading=false;p.more.disabled=false;p.more.hidden=!p.retryNeeded&&Object.values(p.pages).every(page=>page.done);
        p.more.textContent=this.t(p.retryNeeded?'CoverRetry':'CoverMore');
        this.coverStatus(p,p.retryNeeded?'CoverPartial':p.items.some(x=>x.id!=='current')?(p.more.hidden?'CoverEnd':'CoverScrollMore'):'CoverNothing');
        this.positionPopup();
      }}
    }
    async chooseCover(p,id,file){
      if(this.popup!==p||!p.ready||p.saving)return;p.saving=true;p.status.textContent=this.t('TrackSaving');p.upload.disabled=true;p.input.disabled=true;p.grid.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{const result=file?await this.o.api.library.setCoverFromDrop(file,p.track.rel,p.revision):await this.cmd({type:id?'cover-select':'cover-upload',rel:p.track.rel,id,revision:p.revision});if(result.cancelled)return;p.revision=result.revision;await this.o.refresh();if(this.popup!==p)return;
        const current=this.o.getTrack(p.track.rel);if(!id&&current?.coverUrl){p.grid.querySelector('[data-cover-id="current"]')?.remove();p.items=p.items.filter(x=>x.id!=='current');p.seen.delete(current.coverUrl);this.addCoverTile(p,{id:'current',image:current.coverUrl,coverType:current.coverType,title:this.t('CoverCurrent')});}
        p.selection=id||'current';p.grid.querySelectorAll('button').forEach(b=>{const selected=b.dataset.coverId===p.selection;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});p.status.textContent=this.t('CoverSaved');
      }catch(error){if(this.popup===p)p.status.textContent=this.error(error);}
      finally{p.saving=false;if(this.popup===p){p.upload.disabled=false;p.input.disabled=false;p.grid.querySelectorAll('button').forEach(b=>b.disabled=b.classList.contains('cover-image-failed'));this.positionPopup();}}
    }
    makeDialog(title){
      this.closePopup(false);this.o.hideMenu();this.o.closeSearch?.();if(!this.dialog){this.dialog=node('dialog','library-import-dialog');this.dialog.id='libraryImportDialog';document.body.append(this.dialog);this.dialog.addEventListener('cancel',e=>{e.preventDefault();this.cancelDialog();});}
      this.dialog.replaceChildren();const head=node('div','library-import-heading'),titleNode=this.localized('h2','',title),close=this.iconButton('TrackClose','close');head.append(titleNode,close);this.dialog.append(head);close.addEventListener('click',()=>this.cancelDialog());
      this.dialog.setAttribute('aria-labelledby','libraryImportTitle');titleNode.id='libraryImportTitle';if(!this.dialog.open)this.dialog.showModal();return this.dialog;
    }
    showScan(){const d=this.makeDialog('ImportTitle');this.importState={phase:'scan',requestId:'import-'+uid()};const row=node('div','import-scan');row.innerHTML=window.Icon('folder',30);this.scanStatus=this.localized('p','','ImportScanning');row.append(this.scanStatus);const cancel=this.button('TrackCancel');cancel.addEventListener('click',()=>this.cancelDialog());d.append(row,cancel);return this.importState;}
    async chooseFiles(folder=false){
      if(this.importState||this.currentJob){this.showBusy();return;}const state=this.showScan();
      try{const result=await this.cmd({type:'import-choose',folder,requestId:state.requestId});await this.acceptPlan(state,result);}
      catch(error){this.importError(state,error);}
    }
    async acceptDrop(files){
      if(this.importState||this.currentJob){this.showBusy();return;}const state=this.showScan();
      try{const result=await this.o.api.library.prepareDrop(files,state.requestId);await this.acceptPlan(state,result);}
      catch(error){this.importError(state,error);}
    }
    async acceptPlan(state,result){
      if(this.importState!==state){if(result?.token)this.cmd({type:'import-discard',token:result.token}).catch(()=>{});return;}
      if(result.cancelled){this.finishDialog();return;}this.importState={...state,phase:'confirm',...result};this.renderImport();
    }
    importError(state,error){if(this.importState!==state)return;this.importState.phase='error';const d=this.makeDialog('ImportTitle'),message=node('p','track-tools-status error');I.setText(message,()=>this.error(error));d.append(message);const close=this.button('TrackClose');close.addEventListener('click',()=>this.finishDialog());d.append(close);}
    renderOptions(parent,counts,selected=[]){
      const actions=F.actions(counts),box=node('div','import-options');if(!actions.length)return box;
      box.append(this.localized('p','import-options-label','ImportSuggestions'));const list=node('div','import-option-list');
      for(const action of actions){const label=node('label','import-option'),input=node('input');input.type='checkbox';input.value=action;input.name='enrichment';input.checked=selected.includes(action);const visual=node('span','import-option-icon');visual.innerHTML=window.Icon(actionIcons[action],16);const text=this.localized('span','',actionKeys[action]),badge=node('small','',String(counts[action]));label.append(input,visual,text,badge);list.append(label);}
      box.append(list);if(actions.some(a=>a!=='artists'))box.append(this.localized('p','import-consent','EnrichNetworkNotice'));parent.append(box);return box;
    }
    renderImport(){
      const state=this.importState,d=this.makeDialog('ImportTitle');d.append(this.localized('p','import-question',state.count?'ImportQuestion':'ImportNoTracks',{count:state.count,folder:state.target}));
      if(state.count){const names=node('div','import-file-summary');for(const name of state.names||[])names.append(node('span','',name));d.append(names);this.renderOptions(d,state.counts);}
      this.warningDetails(d,state.warnings,state.warningCount);if(state.skipped)d.append(this.localized('p','import-consent','ImportSkippedExisting',{count:state.skipped}));
      const buttons=node('div','import-actions'),folder=this.button('ImportFolder','button secondary','folder'),cancel=this.button('TrackCancel'),confirm=this.button('ImportConfirm','button primary','plus');folder.addEventListener('click',async()=>{await this.cancelDialog();this.chooseFiles(true);});cancel.addEventListener('click',()=>this.cancelDialog());confirm.disabled=!state.count;confirm.addEventListener('click',()=>this.startJob({token:state.token}));buttons.append(folder,cancel,confirm);d.append(buttons);confirm.focus();
    }
    warningDetails(parent,warnings=[],count=warnings.length){
      if(!count)return;const details=node('details','import-details'),summary=this.localized('summary','','ImportWarnings',{count});details.append(summary);for(const warning of warnings){const line=node('p');I.setText(line,()=>`${warning.name||''} — ${this.t(warning.code||'EnrichFailed')}`);details.append(line);}parent.append(details);
    }
    openBatch(snapshot,action){
      if(this.currentJob||this.importState){this.showBusy();return;}
      this.importState={phase:'confirm',rels:snapshot.rels,private:snapshot.private,title:snapshot.title};
      const d=this.makeDialog(titleKeys[action]),title=node('p','import-question',snapshot.title||'');d.append(title);this.renderOptions(d,{[action]:snapshot.counts[action]},[action]);
      d.append(this.localized('p','import-consent','EnrichPreserveNotice'));const footer=node('div','import-actions'),cancel=this.button('TrackCancel'),confirm=this.button('EnrichStart','button primary','check');cancel.addEventListener('click',()=>this.cancelDialog());confirm.addEventListener('click',()=>this.startJob({rels:snapshot.rels}));footer.append(cancel,confirm);d.append(footer);confirm.focus();
    }
    async startJob(command){
      const state=this.importState;if(!state||state.phase!=='confirm')return;const actions=[...this.dialog.querySelectorAll('input[name=enrichment]:checked')].map(i=>i.value);if(!command.token&&!actions.length)return;
      state.phase='starting';this.dialog.querySelectorAll('button,input').forEach(b=>b.disabled=true);
      try{const result=await this.cmd({type:'batch-start',...command,actions,consent:actions.some(k=>k!=='artists')});if(this.importState!==state){await this.cmd({type:'job-cancel',id:result.id}).catch(()=>{});return;}this.currentJob=result.id;state.phase='running';this.jobLogs=[];this.renderProgress();if(this.earlyProgress?.id===result.id){this.progress(this.earlyProgress);this.earlyProgress=null;}if(state.cancelRequested&&this.currentJob)await this.cancelDialog();const latest=await this.cmd({type:'job-status'});if(latest.job?.id===result.id)this.progress(latest.job);}
      catch(error){this.importError(state,error);}
    }
    renderProgress(){
      const d=this.makeDialog('EnrichWorking');this.progressTitle=this.localized('p','import-question','ImportPreparing');this.progressMeter=node('progress','import-progress');this.progressMeter.max=1;this.progressMeter.value=0;this.progressSummary=node('p','import-consent');this.logDetails=node('details','import-details');this.logDetails.append(this.localized('summary','','EnrichDetails'));
      this.cancelJob=this.button('EnrichStop','button secondary','close');this.cancelJob.addEventListener('click',()=>this.cancelDialog());d.append(this.progressTitle,this.progressMeter,this.progressSummary,this.logDetails,this.cancelJob);
    }
    progress(p){
      if(p.kind==='capabilities'&&p.requestId===this.capProgress?.requestId){this.capProgress.render(p.counts);return;}
      const popup=this.popup;if(p.kind==='covers'&&popup&&Object.values(popup.requests||{}).includes(p.requestId)){for(const item of p.items||[])this.addCoverTile(popup,item);this.positionPopup();return;}
      const state=this.importState;if(p.requestId&&p.requestId===state?.requestId&&state.phase==='scan'){if(this.scanStatus)I.setText(this.scanStatus,()=>p.phase==='inspect'?this.t('ImportInspecting',{done:p.done,total:p.total}):this.t('ImportScanFound',{count:p.found||0}));return;}
      if(!p.id)return;if(p.id!==this.currentJob){if(state?.phase==='starting')this.earlyProgress=p;return;}
      if(!this.progressTitle)return;I.setText(this.progressTitle,()=>p.title||(p.phase==='copy'?this.t('ImportCopying'):this.t('EnrichWorking')));this.progressMeter.max=Math.max(1,p.total||1);this.progressMeter.value=Math.min(p.done||0,this.progressMeter.max);
      I.setText(this.progressSummary,()=>this.t('EnrichSummary',{changed:p.changed||0,skipped:p.skipped||0,failed:p.failed||0,added:p.added||0}));
      if(p.title&&p.action){const log=node('p');I.setText(log,()=>`${p.title} · ${this.t(actionKeys[p.action])}: ${this.t(p.status==='changed'?'EnrichChanged':p.reason||'EnrichNoMatch')}`);this.logDetails.append(log);while(this.logDetails.children.length>201)this.logDetails.children[1].remove();
        if(p.action==='lyrics'&&p.status==='skipped'&&p.reason==='EnrichNoMatch')this.o.notify('info',this.t('EnrichLyricsNotFound'),p.title,2200);
      }
      if(p.phase==='complete'||p.phase==='error'){
        this.currentJob=null;if(state)state.phase='complete';I.setText(this.progressTitle,()=>this.t(p.phase==='error'?'EnrichFailed':p.cancelled?'EnrichStopped':'EnrichComplete'));this.progressMeter.value=this.progressMeter.max;this.cancelJob.disabled=false;this.cancelJob.replaceChildren(this.localized('span','','TrackClose'));this.cancelJob.onclick=null;
        if(p.error)this.logDetails.append(this.localized('p','',p.error));this.warningDetails(this.dialog,p.errors);this.o.refresh().catch(()=>{});
      }
    }
    async cancelDialog(){
      const state=this.importState;if(!state){this.finishDialog();return;}
      if(state.phase==='starting'){state.cancelRequested=true;return;}
      if(this.currentJob){this.cancelJob.disabled=true;I.setText(this.progressTitle,()=>this.t('EnrichStopping'));await this.cmd({type:'job-cancel',id:this.currentJob}).catch(()=>{});return;}
      if(state.phase==='scan')this.cmd({type:'import-cancel',requestId:state.requestId}).catch(()=>{});
      if(state.token)await this.cmd({type:'import-discard',token:state.token}).catch(()=>{});this.finishDialog();
    }
    finishDialog(){this.importState=null;this.dialog?.close();this.dialog?.replaceChildren();this.o.refresh().catch(()=>{});}
    showBusy(){if(this.dialog&&!this.dialog.open)this.dialog.showModal();this.o.notify('info',this.t('EnrichBusy'),'',2000);}
    async acceptCoverDrop(track,file){
      if(this.coverDropBusy)return;const p=this.popup;
      if(p?.track?.rel===track.rel&&p.grid)return this.chooseCover(p,null,file);
      this.coverDropBusy=true;
      try{const info=await this.cmd({type:'metadata',rel:track.rel});await this.o.api.library.setCoverFromDrop(file,track.rel,info.revision);await this.o.refresh();this.o.notify('good',this.t('CoverSaved'),'',1800);}
      catch(error){this.o.notify('bad',this.t('CoverChange'),this.error(error));}
      finally{this.coverDropBusy=false;}
    }
    bindDrop(){
      let depth=0,highlight=null;const overlay=node('div','library-drop-overlay');overlay.hidden=true;overlay.innerHTML=window.Icon('folder',44);overlay.append(this.localized('strong','','ImportDropTitle'),this.localized('span','','ImportDropHint'));document.body.append(overlay);
      const files=e=>Array.from(e.dataTransfer?.types||[]).includes('Files');
      const artwork=e=>Array.from(e.dataTransfer?.items||[]).some(x=>x.kind==='file'&&(!x.type||/^(image|video)\//.test(x.type)));
      const target=e=>{const popup=e.target.closest?.('.track-cover-picker');if(popup&&this.popup?.root===popup)return popup;return artwork(e)?e.target.closest?.('[data-track-root][data-id]'):null;};
      const reset=()=>{depth=0;overlay.hidden=true;highlight?.classList.remove('cover-drop-target');highlight=null;};
      const mark=e=>{const next=target(e);if(next!==highlight){highlight?.classList.remove('cover-drop-target');highlight=next;highlight?.classList.add('cover-drop-target');}overlay.hidden=!!next;};
      document.addEventListener('dragenter',e=>{if(e.target.closest?.('[data-lyrics-background-drop]')||!files(e))return;e.preventDefault();depth++;mark(e);},true);
      document.addEventListener('dragover',e=>{if(e.target.closest?.('[data-lyrics-background-drop]')||!files(e))return;e.preventDefault();mark(e);if(e.dataTransfer)e.dataTransfer.dropEffect='copy';},true);
      document.addEventListener('dragleave',e=>{if(e.target.closest?.('[data-lyrics-background-drop]')||!files(e))return;depth=Math.max(0,depth-1);if(!depth)reset();},true);
      document.addEventListener('drop',e=>{
        if(e.target.closest?.('[data-lyrics-background-drop]')||!files(e))return;e.preventDefault();e.stopImmediatePropagation();reset();const dropped=Array.from(e.dataTransfer.files||[]);if(!dropped.length)return;
        const popup=e.target.closest?.('.track-cover-picker'),row=e.target.closest?.('[data-track-root][data-id]');
        const media=dropped.some(f=>/^(image|video)\//.test(f.type)||window.PulseCoverTypes.typeOf(f.name,f.type));
        if(popup||row&&media){
          const track=popup&&this.popup?.root===popup?this.popup.track:this.o.getTrackById(row?.dataset.id);
          if(dropped.length!==1||!media||!track){this.o.notify('bad',this.t('CoverChange'),this.t('CoverDropOne'));return;}
          if(!this.o.api.library.setCoverFromDrop){this.o.notify('bad',this.t('CoverChange'),this.t('ImportUnavailable'));return;}
          this.acceptCoverDrop(track,dropped[0]);return;
        }
        if(this.o.api.library.prepareDrop)this.acceptDrop(dropped);else this.o.notify('bad',this.t('ImportUnavailable'),'');
      },true);
      window.addEventListener('blur',reset);
    }

  }
  window.PulseTrackTools=TrackTools;
})();
