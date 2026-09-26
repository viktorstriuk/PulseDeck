/* One shared search workspace: anchored popover and expanded dialog share state,
 * DOM nodes, preview and download controls. Public queries never contain history. */
(() => {
  'use strict';
  const M=window.PulseOnlineSearch,I=window.PulseI18n;
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const $=(s,r=document)=>r.querySelector(s);
  const icon=(name,size=16)=>window.Icon(name,size);
  class OnlineSearchUI {
    constructor(options){
      this.o=options;this.prefs=M.preferences();this.filters={};this.sources=new Map();this.generation=0;this.query='';this.request='';this.mode='closed';this.rows=new Map();this.probed=new Set();this.probeQueue=[];this.probing=0;this.renderFrame=0;this.composing=false;
      this.workspace=$('#searchWorkspace');this.home=this.workspace.parentElement;this.modal=$('#onlineModal');this.results=$('#onlineResults');this.input=$('#onlineSearchInput');this.top=$('#searchInput');this.popover=$('#searchPopover');
      this.build();this.bind();this.renderSources();this.renderStatus();
      this.sentinelObserver=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&this.mode!=='closed'&&this.query)this.loadMore();},{root:this.scroll,rootMargin:'100px'});this.sentinelObserver.observe(this.sentinel);
      this.probeObserver=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){this.probeObserver.unobserve(e.target);this.enqueueProbe(e.target.dataset.onlineItem);}}, {root:this.scroll,rootMargin:'0px'});
      this.refreshDiscovery();
    }
    t(key,args){return I.t(key,args);}
    button(label,cls='button secondary'){const b=el('button',cls,this.t(label));b.type='button';return b;}
    iconButton(label,name){const b=this.button(label,'search-toolbar-button search-icon-button');b.innerHTML=icon(name,17);b.dataset.labelKey=label;b.title=this.t(label);b.setAttribute('aria-label',this.t(label));return b;}
    build(){
      this.workspace.classList.add('search-workspace');
      const toolbar=el('div','search-toolbar');
      const title=el('strong','search-heading',this.t('SearchEverywhere'));toolbar.append(title);
      this.autoLabel=el('label','search-auto');this.auto=el('input');this.auto.type='checkbox';this.auto.checked=true;this.autoLabel.append(this.auto,el('span','',this.t('SearchAuto')));toolbar.append(this.autoLabel);
      this.filterButton=this.iconButton('SearchFilters','sliders');this.filterButton.classList.add('search-filter-toggle');this.filterButton.setAttribute('aria-expanded','false');toolbar.append(this.filterButton);
      this.expandButton=this.iconButton('SearchExpand','maximize');this.expandButton.classList.add('search-expand');toolbar.append(this.expandButton);
      this.compactButton=this.iconButton('SearchCompact','restore');this.compactButton.classList.add('search-compact');toolbar.append(this.compactButton);
      this.closeButton=this.iconButton('UIClose','close');this.closeButton.classList.add('search-dismiss');toolbar.append(this.closeButton);
      this.workspace.prepend(toolbar);toolbar.after($('.online-search-row',this.workspace));
      this.chips=$('.source-tabs',this.workspace);this.chips.className='search-sources';this.chips.setAttribute('role','group');this.chips.setAttribute('aria-label',this.t('SearchSourcePriority'));
      this.filterPanel=el('div','search-filter-popover search-aux-popover hidden');this.filterPanel.id='searchFiltersPanel';this.filterPanel.setAttribute('popover','manual');this.filterPanel.setAttribute('role','dialog');this.filterPanel.setAttribute('aria-labelledby','searchFiltersTitle');
      this.filterButton.setAttribute('aria-controls',this.filterPanel.id);this.filterButton.setAttribute('aria-haspopup','dialog');
      const filterHead=el('div','search-aux-header'),filterTitle=el('strong','',this.t('SearchFilters'));filterTitle.id='searchFiltersTitle';this.filterClose=this.iconButton('UIClose','close');filterHead.append(filterTitle,this.filterClose);this.filterPanel.append(filterHead);
      this.filterGrid=el('div','search-filters');this.filterPanel.append(this.filterGrid);
      for(const [name,label] of [['artist','SearchArtist'],['track','SearchTrack'],['album','SearchAlbum']]){
        const wrap=el('label','search-filter');wrap.append(el('span','',this.t(label)));const input=el('input');input.type='search';input.autocomplete='off';input.spellcheck=false;input.maxLength=160;input.dataset.searchFilter=name;wrap.append(input);this.filterGrid.append(wrap);
      }
      for(const [name,label,choices] of [['duration','SearchDuration',['any','short','medium','long']],['version','SearchVersion',['any','original','live','remix','instrumental','cover']]]){
        const wrap=el('label','search-filter');wrap.append(el('span','',this.t(label)));const select=el('select');select.dataset.searchFilter=name;
        for(const value of choices){const option=el('option','',this.t(`SearchChoice_${value}`));option.value=value;select.append(option);}wrap.append(select);this.filterGrid.append(wrap);
      }
      const reset=this.button('SearchClearFilters');reset.dataset.clearFilters='true';this.filterPanel.append(reset);document.body.append(this.filterPanel);
      this.statusRow=el('div','search-status-row');this.status=el('div','search-status');this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');this.statusRow.append(this.status);this.chips.after(this.statusRow);
      this.errorButton=this.iconButton('SearchSourceDetails','more');this.errorButton.classList.add('search-error-toggle','hidden');this.errorButton.setAttribute('aria-expanded','false');this.errorButton.setAttribute('aria-controls','searchErrorsPanel');this.errorButton.setAttribute('aria-haspopup','dialog');this.statusRow.append(this.errorButton);
      this.errorPanel=el('div','search-error-popover search-aux-popover hidden');this.errorPanel.id='searchErrorsPanel';this.errorPanel.setAttribute('popover','manual');this.errorPanel.setAttribute('role','dialog');this.errorPanel.setAttribute('aria-labelledby','searchErrorsTitle');
      const errorHead=el('div','search-aux-header'),errorTitle=el('strong','',this.t('SearchSourceDetails'));errorTitle.id='searchErrorsTitle';this.errorClose=this.iconButton('UIClose','close');errorHead.append(errorTitle,this.errorClose);this.errors=el('div','search-source-errors');this.errorPanel.append(errorHead,this.errors);document.body.append(this.errorPanel);
      this.hideLabel=el('label','search-availability-toggle');this.hideToggle=el('input');this.hideToggle.type='checkbox';this.hideToggle.checked=true;this.hideText=el('span','',this.t('SearchHideUnavailable'));this.hideLabel.append(this.hideToggle,this.hideText);this.statusRow.after(this.hideLabel);
      this.scroll=el('div','search-scroll');this.results.before(this.scroll);this.scroll.append(this.results);this.results.setAttribute('role','list');
      this.localResults=el('div','search-local-results');this.results.before(this.localResults);
      this.sentinel=el('div','search-sentinel');this.moreButton=this.button('SearchMore');this.sentinel.append(this.moreButton);this.scroll.append(this.sentinel);
      this.empty=el('div','search-empty');this.scroll.prepend(this.empty);
      this.popover.setAttribute('role','dialog');this.popover.setAttribute('aria-label',this.t('SearchEverywhere'));
      this.top.setAttribute('aria-haspopup','dialog');this.top.setAttribute('aria-controls','searchPopover');this.top.setAttribute('aria-expanded','false');
      this.input.maxLength=2048;this.top.maxLength=2048;
      this.linkStatus=el('div','search-link-status hidden');this.statusRow.after(this.linkStatus);
      // Direct links remain available, but do not consume the compact results area.
      $('.divider',this.workspace)?.classList.add('search-direct-divider');$('.url-import',this.workspace)?.classList.add('search-direct-import');
      $('#onlineNotice').classList.add('search-notice');
    }
    bind(){
      this.top.addEventListener('focus',()=>{if(!document.querySelector('.modal-layer:not(.hidden)')){this.openFloating();this.setQuery(this.top.value);}});
      this.top.addEventListener('input',e=>{this.openFloating();this.setQuery(e.target.value);});
      for(const input of [this.top,this.input]){
        input.addEventListener('compositionstart',()=>{this.composing=true;clearTimeout(this.timer);});
        input.addEventListener('compositionend',()=>{this.composing=false;this.setQuery(input.value);});
        input.addEventListener('keydown',e=>{if(e.isComposing||this.composing)return;if(e.key==='Enter'){e.preventDefault();this.searchNow();}if(e.key==='ArrowDown'&&this.mode!=='closed'){e.preventDefault();this.results.querySelector('[data-online-item]')?.focus();}});
      }
      this.input.addEventListener('input',()=>this.setQuery(this.input.value));
      this.auto.addEventListener('change',()=>{this.prefs.autoSearch=this.auto.checked;this.save();if(this.auto.checked)this.searchNow();else clearTimeout(this.timer);});
      this.filterButton.addEventListener('click',()=>this.toggleAux('filters'));
      this.errorButton.addEventListener('click',()=>this.toggleAux('errors'));
      this.filterClose.addEventListener('click',()=>this.closeAux(true));this.errorClose.addEventListener('click',()=>this.closeAux(true));
      this.filterPanel.addEventListener('input',e=>{const name=e.target.dataset.searchFilter;if(!name)return;this.filters[name]=e.target.value;this.scroll.scrollTop=0;this.displayOrder=[];this.setQuery(this.query);});
      this.filterPanel.addEventListener('click',e=>{if(!e.target.closest('[data-clear-filters]'))return;this.filters={};for(const input of this.filterPanel.querySelectorAll('[data-search-filter]'))input.value=input.tagName==='SELECT'?'any':'';this.setQuery(this.query);});
      this.expandButton.addEventListener('click',()=>this.o.openExpanded());this.compactButton.addEventListener('click',()=>{this.o.closeExpanded(true);this.mode='closed';this.openFloating();this.top.focus();});this.closeButton.addEventListener('click',()=>this.close());
      this.hideToggle.addEventListener('change',()=>{this.prefs.hideUnavailable=this.hideToggle.checked;this.save();this.render();});
      this.moreButton.addEventListener('click',()=>this.loadMore());
      this.errors.addEventListener('click',e=>{const b=e.target.closest('[data-source-retry]');if(b)this.loadSource(b.dataset.sourceRetry,true);});
      this.chips.addEventListener('click',e=>{if(performance.now()<(this.suppressClickUntil||0))return;const b=e.target.closest('[data-source-toggle]');if(b)this.toggle(b.dataset.sourceToggle);});
      this.chips.addEventListener('keydown',e=>{const handle=e.target.closest('[data-source-drag]');if(!handle||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const id=handle.dataset.sourceDrag,index=this.prefs.order.indexOf(id),to=e.key==='Home'?0:e.key==='End'?this.prefs.order.length-1:index+(e.key==='ArrowLeft'?-1:1);this.reorder(id,to);this.chips.querySelector(`[data-source-drag="${id}"]`)?.focus();});
      this.chips.addEventListener('pointerdown',e=>this.startDrag(e));
      this.chips.addEventListener('wheel',e=>{if(this.chips.scrollWidth>this.chips.clientWidth&&Math.abs(e.deltaY)>Math.abs(e.deltaX)){e.preventDefault();this.chips.scrollLeft+=e.deltaY;}},{passive:false});
      this.scroll.addEventListener('keydown',e=>{
        if(e.key==='Escape')return;const row=e.target.closest('[data-online-item]');if(!row||e.target!==row)return;
        if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();const rows=[...this.results.querySelectorAll('[data-online-item]')],i=rows.indexOf(row),next=e.key==='Home'?0:e.key==='End'?rows.length-1:i+(e.key==='ArrowUp'?-1:1);rows[Math.max(0,Math.min(rows.length-1,next))]?.focus();}
      });
      this.scroll.addEventListener('click',e=>{
        const local=e.target.closest('[data-local-play]');if(local){e.stopPropagation();this.o.playLocal(local.dataset.localPlay);if(this.mode==='expanded')this.o.closeExpanded();this.close();}
        const a=e.target.closest('[data-discovery-search]');if(a){this.filters={artist:a.dataset.discoverySearch};this.filterPanel.querySelector('[data-search-filter="artist"]').value=a.dataset.discoverySearch;this.setQuery(a.dataset.discoverySearch,true);}
        if(e.target.closest('[data-discovery-enable]'))this.configureDiscovery(!this.discovery?.enabled);
        if(e.target.closest('[data-discovery-clear]'))this.clearDiscovery();
        const dismiss=e.target.closest('[data-discovery-dismiss]');if(dismiss)this.o.api.discovery?.command({type:'dismiss',rel:dismiss.dataset.discoveryDismiss}).then(()=>this.refreshDiscovery()).catch(()=>{});
      });
      document.addEventListener('pointerdown',e=>{
        if(this.aux){const panel=this.aux==='filters'?this.filterPanel:this.errorPanel,button=this.aux==='filters'?this.filterButton:this.errorButton;if(panel.contains(e.target)||button.contains(e.target))return;this.closeAux(false);}
        if(this.mode==='floating'&&!this.popover.contains(e.target)&&!this.top.parentElement.contains(e.target))this.close();
      },true);
      document.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.aux){e.preventDefault();e.stopImmediatePropagation();this.closeAux(true);return;}if(e.key==='Escape'&&this.mode==='floating'){e.preventDefault();e.stopImmediatePropagation();this.close();this.skipFocus=true;this.top.focus({preventScroll:true});queueMicrotask(()=>this.skipFocus=false);}},true);
      window.addEventListener('resize',()=>this.position());
      document.addEventListener('pulsedeck:language-changed',()=>this.localize());
    }
    toggleAux(kind){
      if(this.aux===kind){this.closeAux(true);return;}this.closeAux(false);this.aux=kind;
      const panel=kind==='filters'?this.filterPanel:this.errorPanel,button=kind==='filters'?this.filterButton:this.errorButton;
      panel.classList.remove('hidden');if(panel.showPopover)panel.showPopover();button.setAttribute('aria-expanded','true');this.positionAux();
      (kind==='filters'?panel.querySelector('input'):panel.querySelector('[data-source-retry]')||this.errorClose)?.focus({preventScroll:true});
    }
    closeAux(restore=false){
      if(!this.aux)return;const panel=this.aux==='filters'?this.filterPanel:this.errorPanel,button=this.aux==='filters'?this.filterButton:this.errorButton;
      this.aux=null;if(panel.hidePopover&&panel.matches(':popover-open'))panel.hidePopover();panel.classList.add('hidden');button.setAttribute('aria-expanded','false');if(restore)(button.classList.contains('hidden')?(this.mode==='expanded'?this.input:this.top):button).focus({preventScroll:true});
    }
    positionAux(){
      if(!this.aux)return;const panel=this.aux==='filters'?this.filterPanel:this.errorPanel,button=this.aux==='filters'?this.filterButton:this.errorButton,r=button.getBoundingClientRect();
      const width=Math.min(this.aux==='filters'?480:580,innerWidth-24);panel.style.width=`${width}px`;const height=Math.min(panel.scrollHeight,innerHeight-24),left=Math.max(12,Math.min(r.right-width,innerWidth-width-12)),below=r.bottom+8;
      Object.assign(panel.style,{width:`${width}px`,left:`${left}px`,top:`${Math.max(12,Math.min(below,innerHeight-height-12))}px`,maxHeight:`${innerHeight-24}px`});
    }
    configure(prefs){this.prefs=M.preferences(prefs);this.auto.checked=this.prefs.autoSearch;this.hideToggle.checked=this.prefs.hideUnavailable;this.renderSources();}
    save(){this.o.save(this.prefs);}
    isOpen(){return this.mode!=='closed';}
    openFloating(){
      if(this.skipFocus)return;if(this.mode==='expanded')return;
      this.mode='floating';this.popover.append(this.workspace);this.popover.classList.remove('hidden');this.workspace.dataset.mode='floating';this.top.setAttribute('aria-expanded','true');this.position();this.render();
    }
    openExpanded(){
      this.closeAux(false);this.mode='expanded';this.home.append(this.workspace);this.workspace.dataset.mode='expanded';this.popover.classList.add('hidden');this.top.setAttribute('aria-expanded','false');
      const q=this.top.value||this.query;this.setQuery(q);this.render();
    }
    close(){
      this.closeAux(false);this.dragController?.abort();this.dragController=null;this.chips.classList.remove('dragging','panning');clearTimeout(this.timer);this.probeQueue=[];this.probed.clear();this.popover.classList.add('hidden');this.top.setAttribute('aria-expanded','false');this.mode='closed';this.o.stopPreview?.();this.o.api.online.command?.({type:'cancel',requestId:`${this.request}:link`});if(this.link?.loading){this.link.loading=false;this.link.cancelled=true;}
      for(const id of M.IDS)this.o.api.online.command?.({type:'cancel',requestId:`${this.request}:${id}`});this.o.api.online.command?.({type:'cancel',requestId:`${this.request}:probe`});
      for(const s of this.sources.values())if(s.loading){s.sequence=(s.sequence||0)+1;s.loading=false;s.cancelled=true;}
    }
    position(){
      this.positionAux();if(this.mode!=='floating')return;const r=this.top.parentElement.getBoundingClientRect(),width=Math.min(Math.max(r.width,680),innerWidth-24),left=Math.max(12,Math.min(r.left,innerWidth-width-12)),top=r.bottom+8;
      Object.assign(this.popover.style,{left:`${left}px`,top:`${top}px`,width:`${width}px`,maxHeight:`${Math.max(220,innerHeight-top-18)}px`});
    }
    setQuery(raw,immediate=false){
      // Keep the editable buffer verbatim (especially trailing spaces and caret).
      // Normalization belongs to parseQuery, never to the active input element.
      this.query=typeof raw==='string'?raw.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,2048):'';this.o.onQuery?.(this.query);
      if(this.input.value!==this.query)this.input.value=this.query;if(this.top.value!==this.query)this.top.value=this.query;
      this.parsed=M.parseQuery(this.link?.url===this.query.trim()&&this.link.query?this.link.query:this.query,this.filters);clearTimeout(this.timer);
      this.renderLocal();
      if(!this.parsed.valid){this.resetRequest();this.render();this.refreshDiscovery();return;}
      if(immediate){this.searchNow();return;}
      if(this.prefs.autoSearch&&!this.composing)this.timer=setTimeout(()=>this.searchNow(),320);
      // Never display results belonging to a previous query while debounce is pending.
      if(this.link?.url!==this.query.trim()&&this.activeEffective!==this.parsed.effective){this.resetRequest();this.render();}else this.render();
    }
    resetRequest(){
      if(this.request)this.o.api.online.command?.({type:'cancel',requestId:`${this.request}:link`});this.link=null;
      if(this.request){for(const id of M.IDS)this.o.api.online.command?.({type:'cancel',requestId:`${this.request}:${id}`});this.o.api.online.command?.({type:'cancel',requestId:`${this.request}:probe`});}
      this.request=`query-${++this.generation}`;this.sources.clear();this.rows.clear();this.probed.clear();this.probeQueue=[];this.activeEffective='';this.displayOrder=[];this.scroll.scrollTop=0;
    }
    searchNow(){
      clearTimeout(this.timer);this.query=this.input.value;
      if(/^https?:\/\//i.test(this.query.trim())){
        if(this.link?.url!==this.query.trim()||this.link.cancelled){this.resetRequest();this.resolveLink(this.query.trim());return;}
        if(this.link.loading||!this.link.item){this.render();return;}this.parsed=M.parseQuery(this.link.query,this.filters);
      }else this.parsed=M.parseQuery(this.query,this.filters);
      if(!this.parsed.valid){this.render();return;}
      if(this.activeEffective!==this.parsed.effective){const linked=this.link;this.resetRequest();if(linked?.url===this.query.trim())this.link=linked;this.activeEffective=this.parsed.effective;}
      for(const id of this.prefs.order)if(this.prefs.enabled.includes(id)&&(!this.sources.has(id)||this.sources.get(id).cancelled))this.loadSource(id);
      this.render();
    }
    async resolveLink(url){
      const epoch=this.generation;this.link={url,loading:true};this.render();
      try{const result=await this.command({type:'resolve',url,requestId:`${this.request}:link`});if(epoch!==this.generation||this.mode==='closed')return;
        if(!result.ok){this.link.error=result.error?.code||'SEARCH_NETWORK';return;}
        this.link.item=result.item;this.link.query=result.query;this.parsed=M.parseQuery(result.query,this.filters);this.activeEffective=this.parsed.effective;
        for(const id of this.prefs.order)if(this.prefs.enabled.includes(id))this.loadSource(id);
      }catch{if(epoch===this.generation)this.link.error='SEARCH_NETWORK';}
      finally{if(epoch===this.generation&&this.link){this.link.loading=false;this.render();}}
    }
    rankedItems(){const ranked=M.rank(this.allItems(),this.parsed||M.parseQuery(''),this.prefs),direct=this.link?.item;if(direct&&(!this.prefs.hideUnavailable||direct.availability?.state!=='blocked'))return [direct,...ranked.filter(x=>x.key!==direct.key)];return ranked;}
    async command(c){
      if(this.o.api.online.command)return this.o.api.online.command(c);
      if(c.type!=='page')return {ok:true};
      // Compatibility with older test bridges / hosts; a packaged 2.9 host uses command.
      try{const a=await this.o.api.online.search(c.provider,c.query);return {ok:true,items:Array.isArray(a)?a:a?.items||[],cursor:null};}catch(e){return {ok:false,error:{code:'SEARCH_NETWORK'}};}
    }
    async loadSource(id,retry=false){
      if(!this.activeEffective||!this.prefs.enabled.includes(id))return;const previous=this.sources.get(id);
      if(previous?.loading)return;const epoch=this.generation,request=this.request,s=previous||{items:[],cursor:null,error:null};const sequence=s.sequence=(s.sequence||0)+1;s.loading=true;s.error=null;s.cancelled=false;this.sources.set(id,s);this.renderStatus();this.renderSources();
      try{
        const r=await this.command({type:'page',provider:id,query:this.activeEffective,cursor:s.cursor,requestId:`${request}:${id}`,retry});
        if(epoch!==this.generation||sequence!==s.sequence||this.mode==='closed'||!this.prefs.enabled.includes(id))return;
        if(r.ok){const byKey=new Map(s.items.map(x=>[x.key,x]));for(const raw of r.items||[]){const item=M.normalizeItem(raw,id,byKey.size);if(item)byKey.set(item.key,item);}s.items=[...byKey.values()];s.cursor=r.cursor;s.done=!r.cursor;s.via=r.via;s.error=null;}
        else if(r.error?.code!=='SEARCH_CANCELLED')s.error=r.error||{code:'SEARCH_NETWORK'};
      }catch{if(epoch===this.generation&&sequence===s.sequence)s.error={code:'SEARCH_NETWORK'};}
      finally{if(epoch===this.generation&&sequence===s.sequence){s.loading=false;this.render();}}
    }
    loadMore(){
      if(!this.activeEffective||this.mode==='closed')return;
      for(const id of this.prefs.order){const s=this.sources.get(id);if(this.prefs.enabled.includes(id)&&s?.cursor&&!s.loading&&!s.error)this.loadSource(id);}
    }
    toggle(id){
      if(this.prefs.enabled.includes(id)){this.prefs.enabled=this.prefs.enabled.filter(x=>x!==id);this.o.api.online.command?.({type:'cancel',requestId:`${this.request}:${id}`});const s=this.sources.get(id);if(s?.loading){s.sequence=(s.sequence||0)+1;s.loading=false;s.cancelled=true;}}
      else this.prefs.enabled.push(id);
      this.displayOrder=[];this.scroll.scrollTop=0;this.save();this.renderSources();this.render();if(this.prefs.enabled.includes(id)&&this.parsed?.valid){if(!this.activeEffective)this.searchNow();else if(!this.sources.has(id)||this.sources.get(id).cancelled)this.loadSource(id);}
    }
    enable(id){if(!this.prefs.enabled.includes(id))this.toggle(id);}
    reorder(id,to){
      const order=this.prefs.order,from=order.indexOf(id);to=Math.max(0,Math.min(order.length-1,to));if(from===to||from<0)return;
      this.displayOrder=[];this.scroll.scrollTop=0;const rects=new Map([...this.chips.children].map(n=>[n.dataset.source,n.getBoundingClientRect()]));order.splice(from,1);order.splice(to,0,id);this.save();this.renderSources();
      if(!this.dragController&&!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const node of this.chips.children){const a=rects.get(node.dataset.source),b=node.getBoundingClientRect();if(a)node.animate([{transform:`translateX(${a.left-b.left}px)`},{transform:'translateX(0)'}],{duration:170,easing:'ease-out'});}
      this.render();
    }
    startDrag(e){
      if(e.button!==0||this.dragController)return;
      const handle=e.target.closest('[data-source-drag]'),id=handle?.dataset.sourceDrag,start=e.clientX,scrollStart=this.chips.scrollLeft;let moved=false;
      if(handle)e.preventDefault();
      const controller=this.dragController=new AbortController();
      const move=ev=>{if(ev.pointerId!==e.pointerId)return;const dx=ev.clientX-start;if(!moved&&Math.abs(dx)<=6)return;moved=true;ev.preventDefault();
        this.chips.classList.add(handle?'dragging':'panning');
        if(!handle){this.chips.scrollLeft=scrollStart-dx;return;}
        const nodes=[...this.chips.children],target=nodes.findIndex(n=>ev.clientX<n.getBoundingClientRect().left+n.getBoundingClientRect().width/2);this.reorder(id,target<0?nodes.length-1:target);
        const r=this.chips.getBoundingClientRect();if(ev.clientX>r.right-28)this.chips.scrollLeft+=24;if(ev.clientX<r.left+28)this.chips.scrollLeft-=24;
      };
      const end=()=>{controller.abort();this.dragController=null;this.chips.classList.remove('dragging','panning');if(moved)this.suppressClickUntil=performance.now()+250;};
      window.addEventListener('pointermove',move,{signal:controller.signal,passive:false});window.addEventListener('pointerup',end,{once:true,signal:controller.signal});window.addEventListener('pointercancel',end,{once:true,signal:controller.signal});window.addEventListener('blur',end,{once:true,signal:controller.signal});
    }
    renderSources(){
      // Retain keyed nodes: replacing the rail on every state update interrupted
      // CSS transitions, keyboard focus and pointer gestures.
      const focused=document.activeElement,existing=new Map([...this.chips.children].map(n=>[n.dataset.source,n]));
      for(const [index,id] of this.prefs.order.entries()){
        const source=M.SOURCES.find(s=>s.id===id),enabled=this.prefs.enabled.includes(id),state=this.sources.get(id);let chip=existing.get(id);
        if(!chip){chip=el('div','search-source');chip.dataset.source=id;
          const drag=this.button('SearchReorder','search-source-handle');drag.dataset.sourceDrag=id;drag.innerHTML=icon('grip',10);
          const toggle=el('button','search-source-toggle');toggle.type='button';toggle.dataset.sourceToggle=id;
          const mark=el('span','search-source-icon');mark.innerHTML=icon(source.icon,15);mark.setAttribute('aria-hidden','true');
          const check=el('span','search-source-state');check.setAttribute('aria-hidden','true');check.innerHTML=icon('check',11);
          const spinner=el('span','search-source-spinner mini-spinner');spinner.setAttribute('aria-hidden','true');
          toggle.append(mark,el('span','search-source-name',source.name),check,spinner);chip.append(drag,toggle);
        }
        chip.classList.toggle('enabled',enabled);chip.classList.toggle('loading',!!state?.loading);chip.classList.remove('failed');
        const drag=chip.querySelector('[data-source-drag]'),toggle=chip.querySelector('[data-source-toggle]');drag.title=this.t('SearchReorderHint',{source:source.name});drag.setAttribute('aria-label',drag.title);toggle.setAttribute('aria-pressed',String(enabled));toggle.title=source.name;
        if(this.chips.children[index]!==chip)this.chips.insertBefore(chip,this.chips.children[index]||null);
      }
      if(focused?.isConnected&&this.chips.contains(focused)&&document.activeElement!==focused)focused.focus({preventScroll:true});
    }
    allItems(){return [...this.sources.values()].flatMap(s=>s.items);}
    renderStatus(){
      const enabled=this.prefs.enabled,states=enabled.map(id=>this.sources.get(id)),loading=states.filter(s=>s?.loading).length,failed=states.filter(s=>s?.error).length;
      const count=this.parsed?this.rankedItems().length:0;
      if(this.linkStatus){const link=this.link;this.linkStatus.classList.toggle('hidden',!link);this.linkStatus.replaceChildren();if(link){this.linkStatus.textContent=link.loading?this.t('SearchResolvingLink'):link.error?this.t(link.error):this.t('SearchLinkAndAlternatives');if(link.error){const retry=this.button('SearchRetry','search-retry');retry.addEventListener('click',()=>this.resolveLink(link.url));this.linkStatus.append(retry);}}}
      this.status.textContent=!enabled.length?this.t('SearchEnableSource'):loading?this.t('SearchSearching',{count,loading}):this.parsed?.valid?this.t('SearchResultCount',{count,sources:states.filter(s=>s&&!s.error).length}):this.t('SearchStartHint');
      const retryFocus=this.errors.contains(document.activeElement)?document.activeElement.dataset.sourceRetry:null;this.errors.replaceChildren();for(const id of this.prefs.order){const error=this.sources.get(id)?.error;if(!error||!enabled.includes(id))continue;const row=el('div','search-source-error');const code=error.code||'SEARCH_NETWORK';row.append(el('span','',`${M.SOURCES.find(s=>s.id===id).name} · ${this.t(code)}`));const retry=this.button('SearchRetry','search-retry');retry.dataset.sourceRetry=id;row.append(retry);this.errors.append(row);}
      if(retryFocus&&this.aux==='errors')this.errors.querySelector(`[data-source-retry="${retryFocus}"]`)?.focus({preventScroll:true});this.errorButton.classList.toggle('hidden',!failed);this.errorButton.dataset.count=String(failed);if(!failed&&this.aux==='errors')this.closeAux(true);if(this.aux==='errors')this.positionAux();
      const more=states.some(s=>s?.cursor&&!s.error);this.sentinel.classList.toggle('hidden',!more);this.moreButton.disabled=!!loading;this.moreButton.textContent=this.t(loading?'SearchLoadingMore':'SearchMore');
      const hidden=this.allItems().filter(x=>x.availability?.state==='blocked').length;this.hideText.textContent=hidden?this.t('SearchHiddenCount',{count:hidden}):this.t('SearchHideUnavailable');
    }
    makeRow(item){
      const row=el('article','online-item search-result');row.dataset.onlineItem=item.url;row.dataset.resultKey=item.key;row.dataset.provider=item.provider;row.setAttribute('role','listitem');row.tabIndex=0;
      const thumb=el('div','online-thumb-wrap placeholder');thumb.innerHTML=icon('music',24);
      if(item.thumbnail){const img=el('img','online-thumb');img.src=item.thumbnail;img.alt='';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>img.remove(),{once:true});thumb.append(img);}
      const preview=el('button','online-preview-btn');preview.type='button';preview.dataset.onlinePreview=item.url;preview.innerHTML=icon('play',15);preview.title=this.t('UIPreviewAudio');preview.setAttribute('aria-label',this.t('UIPreviewAudio'));thumb.append(preview);
      const copy=el('div','online-copy');copy.append(el('strong','',item.title),el('span','',`${item.artist||this.t('AppUnknownCreator')}${item.duration?' · '+this.o.formatTime(item.duration):''}`));
      const meta=el('div','search-result-meta');meta.append(el('span','search-provider-badge',M.SOURCES.find(s=>s.id===item.provider)?.name||item.provider),el('span','search-availability'));copy.append(meta);
      const download=el('button','online-download');download.type='button';download.dataset.onlineDownload=item.url;download.innerHTML=icon('download',17);download.title=this.t('UIDownload');download.setAttribute('aria-label',this.t('UIDownload'));
      row.append(thumb,copy,download);return row;
    }
    render(){
      if(!this.parsed)this.parsed=M.parseQuery(this.query,this.filters);
      this.renderStatus();this.renderSources();this.renderLocal();
      let items=this.rankedItems();const fragment=document.createDocumentFragment(),focused=document.activeElement;
      const viewTop=this.scroll.getBoundingClientRect().top,anchor=[...this.results.children].find(row=>row.getBoundingClientRect().bottom>viewTop),anchorTop=anchor?.getBoundingClientRect().top;
      if(this.scroll.scrollTop>32&&this.displayOrder?.length){const byKey=new Map(items.map(x=>[x.key,x])),prior=this.displayOrder.filter(k=>byKey.has(k)),priorSet=new Set(prior);items=[...prior.map(k=>byKey.get(k)),...items.filter(x=>!priorSet.has(x.key))];}
      this.displayOrder=items.map(x=>x.key);
      for(const item of items){let row=this.rows.get(item.key);if(!row||row.dataset.onlineItem!==item.url||row.dataset.provider!==item.provider){row=this.makeRow(item);this.rows.set(item.key,row);}
        const availability=item.availability||{state:'unknown'},status=$('.search-availability',row);status.dataset.state=availability.state;
        status.textContent=this.t(availability.state==='available'?'SearchStreamFound':availability.state==='blocked'?'SearchUnavailable':availability.state==='preview'?'SearchPreviewOnly':'SearchUnverified');row.classList.toggle('search-direct-result',item.key===this.link?.item?.key);status.title=availability.reason?this.t(availability.reason):this.t('SearchUnverifiedHint');row.classList.toggle('search-result-blocked',availability.state==='blocked');
        $('.online-download',row).disabled=availability.state==='blocked';$('.online-preview-btn',row).disabled=availability.state==='blocked';
        fragment.append(row);if(this.mode!=='closed')this.probeObserver?.observe(row);
      }
      this.results.replaceChildren(fragment);this.o.patchDownloads?.();
      for(const row of this.results.children)if(row.classList.contains('search-result-blocked'))row.querySelectorAll('[data-online-download],[data-online-preview]').forEach(b=>b.disabled=true);
      if(anchor?.isConnected&&this.scroll.scrollTop>32)this.scroll.scrollTop+=anchor.getBoundingClientRect().top-anchorTop;
      if(focused?.isConnected&&this.results.contains(focused))focused.focus({preventScroll:true});
      this.empty.classList.toggle('hidden',!!items.length||!this.parsed.valid||!!this.link?.loading||!!this.link?.error);this.empty.textContent=this.sources.size?this.t([...this.sources.values()].some(s=>s.loading)?'UIFindingTheBestMatches':'SearchNoMatches'):this.t(this.prefs.autoSearch?'SearchWaiting':'SearchPressEnter');
      this.hideLabel.classList.toggle('hidden',!this.parsed.valid);this.filterButton.classList.toggle('has-filters',Object.values(this.filters).some(v=>v&&v!=='any'));
      if(!this.parsed.valid)this.renderDiscovery();
    }
    renderLocal(){
      this.localResults.replaceChildren();if(!this.parsed?.valid)return;
      const q=this.parsed,tracks=(this.o.getTracks?.()||[]).filter(t=>!t.vaultKey&&!t.private&&!t.protected&&M.coverage(q.effective,`${t.title} ${t.artist}`)===1).slice(0,4);if(!tracks.length)return;
      this.localResults.append(el('div','search-section-label',this.t('SearchInLibrary')));
      for(const track of tracks){const b=el('button','search-local-row');b.dataset.localPlay=track.id;b.innerHTML=icon('play',14);b.append(el('strong','',track.title),el('span','',track.artist));this.localResults.append(b);}
    }
    enqueueProbe(url){
      if(!url||this.probed.has(url)||this.mode==='closed'||!this.o.api.online.command)return;this.probed.add(url);this.probeQueue.push({url,generation:this.generation,request:this.request});this.drainProbes();
    }
    drainProbes(){
      if(this.mode==='closed')return;
      while(this.probing<2&&this.probeQueue.length){const p=this.probeQueue.shift();if(p.generation!==this.generation)continue;this.probing++;
        this.command({type:'probe',url:p.url,requestId:`${p.request}:probe`}).then(r=>{if(p.generation!==this.generation||!r.ok||!r.availability)return;
          if(this.link?.item&&(this.link.item.key===r.key||this.link.item.url===p.url))this.link.item.availability=r.availability;for(const s of this.sources.values())for(const item of s.items)if(item.key===r.key||item.url===p.url)item.availability=r.availability;
          cancelAnimationFrame(this.renderFrame);this.renderFrame=requestAnimationFrame(()=>this.render());
        }).catch(()=>{}).finally(()=>{this.probing--;this.drainProbes();});
      }
    }
    async refreshDiscovery(){if(!this.o.api.discovery)return;const serial=this.discoveryRequest=(this.discoveryRequest||0)+1;try{const result=await this.o.api.discovery.command({type:'recommend'});if(serial!==this.discoveryRequest)return;this.discovery=result;if(!this.parsed?.valid)this.renderDiscovery();}catch{}}
    async configureDiscovery(enabled){if(!this.o.api.discovery)return;this.discoveryRequest=(this.discoveryRequest||0)+1;document.dispatchEvent(new Event('pulsedeck:discovery-reset'));try{await this.o.api.discovery.command({type:'configure',enabled});await this.refreshDiscovery();}catch{this.empty.textContent=this.t('DiscoverySaveError');this.empty.classList.remove('hidden');}}
    async clearDiscovery(){if(!this.o.api.discovery)return;this.discoveryRequest=(this.discoveryRequest||0)+1;document.dispatchEvent(new Event('pulsedeck:discovery-reset'));try{await this.o.api.discovery.command({type:'clear'});await this.refreshDiscovery();}catch{this.empty.textContent=this.t('DiscoverySaveError');this.empty.classList.remove('hidden');}}
    renderDiscovery(){
      if(this.parsed?.valid)return;this.empty.classList.add('hidden');this.localResults.replaceChildren();this.results.replaceChildren();this.sentinel.classList.add('hidden');
      const box=el('section','search-discovery'),head=el('div','search-discovery-header');head.append(el('strong','',this.t('DiscoveryTitle')));
      const toggle=this.button(this.discovery?.enabled?'DiscoveryPause':'DiscoveryEnable');toggle.dataset.discoveryEnable='true';head.append(toggle);if(this.discovery?.count){const clear=this.button('DiscoveryClear','search-toolbar-button');clear.dataset.discoveryClear='true';head.append(clear);}box.append(head,el('p','search-discovery-note',this.t(this.discovery?.enabled?'DiscoveryPrivacyEnabled':'DiscoveryPrivacyDisabled')));
      if(this.discovery?.enabled&&!this.discovery.items?.length)box.append(el('p','search-discovery-note',this.t('DiscoveryColdStart')));
      for(const rec of this.discovery?.items||[]){const track=rec.track,row=el('div','search-discovery-row');const play=el('button','search-discovery-play');play.dataset.localPlay=track.id;play.innerHTML=icon('play',15);play.setAttribute('aria-label',this.t('UIPausePlay'));
        const copy=el('div','search-discovery-copy');copy.append(el('strong','',track.title),el('span','',track.artist||''),el('small','',this.t(rec.reason,{value:rec.value})));row.append(play,copy);
        if(track.artist){const find=this.button('DiscoveryMoreArtist','search-toolbar-button');find.dataset.discoverySearch=track.artist;row.append(find);}const dismiss=this.button('DiscoveryDismiss','search-toolbar-button');dismiss.dataset.discoveryDismiss=track.rel;dismiss.innerHTML=icon('close',14);dismiss.title=this.t('DiscoveryDismiss');dismiss.setAttribute('aria-label',this.t('DiscoveryDismiss'));row.append(dismiss);box.append(row);
      }this.localResults.append(box);
    }
    localize(){
      // Nodes containing user content are not translated or replaced while playing.
      this.chips.setAttribute('aria-label',this.t('SearchSourcePriority'));this.popover.setAttribute('aria-label',this.t('SearchEverywhere'));
      for(const row of this.rows.values()){for(const [selector,key] of [['.online-preview-btn','UIPreviewAudio'],['.online-download','UIDownload']]){const b=row.querySelector(selector);b.title=this.t(key);b.setAttribute('aria-label',this.t(key));}}
      $('.search-heading',this.workspace).textContent=this.t('SearchEverywhere');this.autoLabel.querySelector('span').textContent=this.t('SearchAuto');for(const b of [this.filterButton,this.expandButton,this.compactButton,this.closeButton,this.errorButton,this.filterClose,this.errorClose]){b.title=this.t(b.dataset.labelKey);b.setAttribute('aria-label',b.title);}$('#searchFiltersTitle').textContent=this.t('SearchFilters');$('#searchErrorsTitle').textContent=this.t('SearchSourceDetails');
      for(const field of this.filterPanel.querySelectorAll('[data-search-filter]')){field.parentElement.querySelector('span').textContent=this.t({artist:'SearchArtist',track:'SearchTrack',album:'SearchAlbum',duration:'SearchDuration',version:'SearchVersion'}[field.dataset.searchFilter]);if(field.tagName==='SELECT')for(const o of field.options)o.textContent=this.t(`SearchChoice_${o.value}`);}
      this.filterPanel.querySelector('[data-clear-filters]').textContent=this.t('SearchClearFilters');this.render();
    }
  }
  window.PulseOnlineSearchUI=OnlineSearchUI;
})();
