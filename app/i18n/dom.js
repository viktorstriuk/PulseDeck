'use strict';
(() => {
  const bridge = window.pulse?.i18n || window.pulseOverlay?.i18n;
  let snapshot = {};
  try { snapshot=bridge?.bootstrap() || {}; } catch {}
  const engine = window.PulseI18n = new window.PulseI18nCore.Engine(snapshot);
  const bindings = new WeakMap();
  const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
  function translate(root = document) {
    const nodes = [...(root.matches?.('[data-i18n],[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder],[data-i18n-alt],[data-i18n-data-tooltip]')?[root]:[]),
      ...root.querySelectorAll('[data-i18n],[data-i18n-title],[data-i18n-aria-label],[data-i18n-placeholder],[data-i18n-alt],[data-i18n-data-tooltip]')];
    for (const node of nodes) {
      const previous = bindings.get(node) || {};
      for (const attr of ['text','title','aria-label','placeholder','alt','data-tooltip']) {
        const marker=attr==='text'?'data-i18n':'data-i18n-'+attr;
        if (!node.hasAttribute(marker)) continue;
        const current=attr==='text'?node.textContent:node.getAttribute(attr);
        // Dynamic/user-owned content supersedes an initial static placeholder.
        if (Object.hasOwn(previous,attr) && current!==previous[attr]) {node.removeAttribute(marker);delete previous[attr];continue;}
        const key=node.getAttribute(marker), args=parse(node.getAttribute(attr==='text'?'data-i18n-args':marker+'-args'));
        const value=engine.t(key,args);
        if (current!==value) {if(attr==='text')node.textContent=value;else node.setAttribute(attr,value);}
        previous[attr]=value;
      }
      bindings.set(node,previous);
    }
    document.documentElement.lang=engine.language;
    document.documentElement.dir=engine.catalogs[engine.language]?.meta?.direction || 'ltr';
  }
  const live = new WeakMap(), refs = new Set();
  const currentValue=(node,attr)=>attr==='text'?node.textContent:node.getAttribute(attr);
  function bind(node, attr, resolver) {
    if (!node) return '';
    const fn=typeof resolver==='function'?resolver:()=>String(resolver ?? '');
    let map=live.get(node);if(!map){map={};live.set(node,map);refs.add(new WeakRef(node));}
    const value=String(fn() ?? '');map[attr]={fn,last:value};
    // Live resolver supersedes the original static placeholder.
    node.removeAttribute?.(attr==='text'?'data-i18n':'data-i18n-'+attr);
    if(attr==='text')node.textContent=value;else node.setAttribute(attr,value);
    return value;
  }
  engine.setText=(node,fn)=>bind(node,'text',fn);
  engine.setAttribute=(node,attr,fn)=>bind(node,attr,fn);
  engine.setOwnedText=(node,value)=>{
    const p=engine.recentTranslations?.get(String(value));
    return bind(node,'text',p ? ()=>engine.t(p.key,p.params) : ()=>value);
  };
  engine.refreshBindings=()=>{
    for(const ref of refs){const node=ref.deref();if(!node){refs.delete(ref);continue;}
      const map=live.get(node);if(!map)continue;
      for(const [attr,binding] of Object.entries(map)){
        if(currentValue(node,attr)!==binding.last){delete map[attr];continue;}
        try {const next=String(binding.fn() ?? '');if(attr==='text')node.textContent=next;else node.setAttribute(attr,next);binding.last=next;} catch {}
      }
    }
  };
  engine.translateDOM=translate;
  engine.applySnapshot = next => {engine.install(next);translate();engine.refreshBindings();document.dispatchEvent(new CustomEvent('pulsedeck:language-changed',{detail:{language:engine.language}}));};
  bridge?.onChanged?.(next=>engine.applySnapshot(next));
  const observer = new MutationObserver(records=>{
    for(const record of records) for(const node of record.addedNodes) if(node.nodeType===1)translate(node);
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  translate();
})();
