'use strict';
// Shared by the setup main process and renderer. Matches UI languages, not region settings.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PulseLanguageChoice=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const normal=value=>String(value||'').trim().replace(/_/g,'-').toLowerCase();
  function choose(languages,preferred=[],explicit=''){
    const list=(Array.isArray(languages)?languages:[]).filter(l=>l&&typeof l.code==='string');
    const find=value=>list.find(l=>normal(l.code)===normal(value));
    if(explicit&&find(explicit))return find(explicit).code;
    for(const value of Array.isArray(preferred)?preferred:[]){
      const want=normal(value);if(!want)continue;
      const exact=find(want)||list.find(l=>normal(l.locale)===want);if(exact)return exact.code;
      const base=want.split('-')[0],generic=find(base);if(generic)return generic.code;
      const related=list.find(l=>normal(l.code).split('-')[0]===base||normal(l.locale).split('-')[0]===base);if(related)return related.code;
    }
    return find('en')?.code||list[0]?.code||'en';
  }
  return {choose};
});
