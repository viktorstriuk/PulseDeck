/* Move existing menu nodes, never rebuild them during a gesture. Each menu and
 * submenu has its own durable order and undo stack. Native text undo is untouched. */
(() => {
  'use strict';
  const M=window.PulseMenuOrder,I=window.PulseI18n;
  class MenuReorder {
    constructor({menu,getOrders,save,notify}){
      Object.assign(this,{menu,getOrders,save,notify});this.undo=[];this.redo=[];this.tail=Promise.resolve();this.busy=false;
      menu.addEventListener('contextmenu',e=>{
        const button=e.target.closest('.context-item');if(!button)return;
        e.preventDefault();e.stopImmediatePropagation();this.enable(button.closest('.context-submenu')||menu);
      },true);
      menu.addEventListener('pointerdown',e=>this.start(e),true);
      menu.addEventListener('click',e=>{if(e.target.closest('.menu-move-handle')||performance.now()<(this.suppressUntil||0)){e.preventDefault();e.stopImmediatePropagation();}},true);
      document.addEventListener('pointermove',e=>this.move(e),true);
      document.addEventListener('pointerup',e=>this.end(e),true);
      document.addEventListener('pointercancel',()=>this.cancel(),true);
      document.addEventListener('keydown',e=>this.key(e),true);
      window.addEventListener('blur',()=>this.cancel());
      new MutationObserver(()=>{if(menu.classList.contains('hidden'))this.cancel();}).observe(menu,{attributes:true,attributeFilter:['class']});
    }
    items(scope){return [...scope.children].filter(n=>n.matches('.context-item,.context-submenu-wrap')&&n.dataset.orderId);}
    identify(scope,key){
      scope.dataset.orderScope=key;
      for(const child of scope.children){
        const b=child.matches('.context-item')?child:child.matches('.context-submenu-wrap')?child.querySelector(':scope > .context-item'):null;
        if(!b)continue;
        const attr=[...b.attributes].find(a=>a.name.startsWith('data-')&&!a.name.startsWith('data-i18n')&&a.name!=='data-order-id');
        if(!attr)continue;child.dataset.orderId=attr.name+':'+attr.value;
        const sub=child.querySelector(':scope > .context-submenu');if(sub)this.identify(sub,key+'.'+(b.dataset.submenuTrigger||attr.value||attr.name).replace(/[^\w:|.-]/g,'').slice(0,60));
      }
      this.place(scope,M.apply(this.items(scope).map(n=>n.dataset.orderId),this.getOrders()[key]));
    }
    prepare(){this.cancel();this.disable();this.menu.classList.remove('menu-reordering');this.active=null;this.identify(this.menu,this.menu.dataset.menuKind||'track');}
    place(scope,order,animate=false){
      const items=this.items(scope),map=new Map(items.map(n=>[n.dataset.orderId,n]));
      const rects=animate?new Map(items.map(n=>[n,n.getBoundingClientRect()])):null;
      // Separators keep their semantic slots; only command nodes are moved.
      const slots=[...scope.childNodes].map(n=>map.has(n.dataset?.orderId)?null:n);const sorted=order.map(k=>map.get(k)).filter(Boolean);let i=0;
      for(const n of slots){const next=n||sorted[i++];if(next)scope.append(next);}
      if(animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const node of items){if(node===this.drag?.node)continue;const dy=rects.get(node).top-node.getBoundingClientRect().top;if(dy)node.animate([{transform:`translateY(${dy}px)`},{transform:'none'}],{duration:160,easing:'ease-out'});}
    }
    enable(scope){
      if(!scope.dataset.orderScope)this.identify(this.menu,this.menu.dataset.menuKind||'track');
      if(this.active&&this.active!==scope)this.disable();this.active=scope;scope.classList.add('menu-reordering');
      for(const item of this.items(scope)){
        const b=item.matches('button')?item:item.querySelector(':scope > button');if(b.querySelector(':scope > .menu-move-handle'))continue;
        const h=document.createElement('span');h.className='menu-move-handle';h.tabIndex=0;h.setAttribute('role','button');h.innerHTML='<svg width="12" height="20" viewBox="0 0 12 20" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="1.5"/><circle cx="6" cy="10" r="1.5"/><circle cx="6" cy="16" r="1.5"/></svg>';
        I.setAttribute(h,'aria-label',()=>I.t('MenuMoveHint'));I.setAttribute(h,'title',()=>I.t('MenuMoveHint'));b.prepend(h);
      }
      // Editing a parent must not accidentally open its submenus while dragging.
      for(const wrap of scope.querySelectorAll(':scope > .context-submenu-wrap.open'))wrap.classList.remove('open');
    }
    disable(){if(!this.active)return;this.active.classList.remove('menu-reordering');for(const item of this.items(this.active))item.querySelector(':scope > .menu-move-handle,:scope > button > .menu-move-handle')?.remove();this.active=null;}
    start(e){
      const h=e.target.closest('.menu-move-handle');if(!h||e.button!==0||this.busy)return;
      e.preventDefault();e.stopImmediatePropagation();const scope=h.closest('.context-submenu')||this.menu;
      const node=this.items(scope).find(n=>n.contains(h));if(!node)return;
      this.drag={node,scope,before:this.items(scope).map(n=>n.dataset.orderId),pointer:e.pointerId,startY:e.clientY};
      node.classList.add('menu-moving');h.focus({preventScroll:true});
    }
    move(e){if(!this.drag||e.pointerId!==this.drag.pointer)return;e.preventDefault();const {scope,node}=this.drag;const items=this.items(scope),from=items.indexOf(node);let to=0;for(const n of items)if(n!==node&&e.clientY>n.getBoundingClientRect().top+n.offsetHeight/2)to++;
      if(to!==from){const ids=items.map(n=>n.dataset.orderId);ids.splice(from,1);ids.splice(to,0,node.dataset.orderId);this.place(scope,ids,true);}const r=scope.getBoundingClientRect();if(e.clientY<r.top+25)scope.scrollTop-=12;else if(e.clientY>r.bottom-25)scope.scrollTop+=12;
    }
    end(e){if(!this.drag||e.pointerId!==this.drag.pointer)return;const d=this.drag;this.drag=null;d.node.classList.remove('menu-moving');this.suppressUntil=performance.now()+220;e.preventDefault();e.stopImmediatePropagation();this.commit(d.scope,d.before,this.items(d.scope).map(n=>n.dataset.orderId));}
    cancel(){if(!this.drag)return;const d=this.drag;this.drag=null;d.node.classList.remove('menu-moving');this.place(d.scope,d.before);}
    async commit(scope,before,after,history=true){
      if(JSON.stringify(before)===JSON.stringify(after))return;
      const key=scope.dataset.orderScope,old=[...(this.getOrders()[key]||before)],next=M.merge(old,after);this.busy=true;
      try{await this.save(key,next);if(history){this.undo.push({key,before:old,after:next});this.undo=this.undo.slice(-100);this.redo=[];}}
      catch(e){if(scope.isConnected)this.place(scope,before,true);this.notify(e);}
      finally{this.busy=false;}
    }
    async restore(redo){if(this.busy)return;const from=redo?this.redo:this.undo,to=redo?this.undo:this.redo,entry=from.at(-1);if(!entry)return;this.busy=true;try{const order=redo?entry.after:entry.before;await this.save(entry.key,order);from.pop();to.push(entry);const scope=[this.menu,...this.menu.querySelectorAll('[data-order-scope]')].find(n=>n.dataset.orderScope===entry.key);if(scope)this.place(scope,M.apply(this.items(scope).map(n=>n.dataset.orderId),order),true);}catch(e){this.notify(e);}finally{this.busy=false;}}
    key(e){
      if(this.menu.classList.contains('hidden')||!this.active||e.target.closest('input,textarea,select,[contenteditable=true]'))return;
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.cancel();this.disable();return;}
      if((e.ctrlKey||e.metaKey)&&!e.altKey&&['KeyZ','KeyY'].includes(e.code)){e.preventDefault();e.stopImmediatePropagation();this.cancel();this.restore(e.code==='KeyY'||e.shiftKey);return;}
      const handle=e.target.closest('.menu-move-handle');if(!handle||!['ArrowUp','ArrowDown'].includes(e.key)||this.busy)return;e.preventDefault();e.stopImmediatePropagation();const scope=this.active,items=this.items(scope),node=items.find(n=>n.contains(handle)),i=items.indexOf(node),to=Math.max(0,Math.min(items.length-1,i+(e.key==='ArrowUp'?-1:1)));const before=items.map(n=>n.dataset.orderId),after=[...before];after.splice(i,1);after.splice(to,0,before[i]);this.place(scope,after,true);handle.focus();this.commit(scope,before,after);
    }
  }
  window.PulseMenuReorder=MenuReorder;
})();
