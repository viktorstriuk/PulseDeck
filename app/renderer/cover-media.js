/* Shared animated artwork lifecycle. Videos are decorative and always muted;
 * offscreen/hidden/reduced-motion artwork never competes with music playback. */
(() => {
  'use strict';
  const Types=window.PulseCoverTypes,tracked=new Set(),visible=new WeakMap(),preferences=new Map();
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const escape=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function sync(v){
    if(!v.isConnected||v.dataset.coverEnabled==='false'||preferences.get(v.dataset.coverTrack)===false||document.hidden||reduced.matches||visible.get(v)===false){v.pause();return;}
    v.muted=true;v.defaultMuted=true;v.play().catch(()=>{});
  }
  const observer=new IntersectionObserver(entries=>{for(const e of entries){visible.set(e.target,e.isIntersecting);sync(e.target);}});
  function register(v){if(tracked.has(v))return;tracked.add(v);v.muted=true;v.defaultMuted=true;v.loop=true;v.playsInline=true;observer.observe(v);sync(v);}
  const all=root=>[...(root.matches?.('video[data-cover-media]')?[root]:[]),...(root.querySelectorAll?.('video[data-cover-media]')||[])];
  new MutationObserver(records=>{
    for(const r of records)for(const n of r.addedNodes)for(const v of all(n))register(v);
    for(const v of tracked)if(!v.isConnected){v.pause();observer.unobserve(v);tracked.delete(v);}
  }).observe(document.documentElement,{childList:true,subtree:true});
  for(const v of all(document))register(v);
  document.addEventListener('visibilitychange',()=>{for(const v of tracked)sync(v);});
  reduced.addEventListener('change',()=>{for(const v of tracked)sync(v);});
  function markup(url,type,cls='cover-img',track='',enabled=true){
    return Types.isVideo(url,type)?`<video class="${escape(cls)}" data-cover-media data-cover-track="${escape(track)}" data-cover-enabled="${enabled!==false}" src="${escape(url)}" muted loop playsinline preload="metadata" aria-hidden="true" tabindex="-1" disablepictureinpicture></video>`:`<img class="${escape(cls)}" src="${escape(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  }
  function element(url,type,cls='cover-img',track='',enabled=true){const template=document.createElement('template');template.innerHTML=markup(url,type,cls,track,enabled);return template.content.firstElementChild;}
  function ready(media){
    if(media.tagName!=='VIDEO')return media.decode();
    if(media.readyState>=2)return Promise.resolve();media.preload='auto';
    return new Promise((resolve,reject)=>{
      const end=error=>{clearTimeout(timer);media.removeEventListener('loadeddata',good);media.removeEventListener('error',bad);error?reject(error):resolve();};
      const good=()=>end(),bad=()=>end(new Error('Artwork cannot be decoded'));
      const timer=setTimeout(bad,30000);media.addEventListener('loadeddata',good,{once:true});media.addEventListener('error',bad,{once:true});media.load();
    });
  }
  function preference(track,enabled){preferences.set(track,enabled);for(const v of document.querySelectorAll('video[data-lyrics-scene-media]'))if(v.dataset.coverTrack===track){v.dataset.coverEnabled=String(enabled);if(!enabled)v.pause();else if(v.closest('.ly-scene')?.style.opacity==='1'&&!document.hidden&&!reduced.matches)v.play().catch(()=>{});}for(const v of tracked)if(v.dataset.coverTrack===track){v.dataset.coverEnabled=String(enabled);sync(v);}}
  window.PulseCoverMedia={...Types,markup,element,ready,preference,sync};
})();
