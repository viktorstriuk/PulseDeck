// Test-only IPC substitute; all layout, rendering and gestures use the app itself.
(() => {
  const callbacks = new Map();
  const on = key => cb => {callbacks.set(key,cb);return()=>callbacks.delete(key);};
  const mock = window.__overlay = {calls:[],regions:[],enabled:true,
    emit(key,value){return callbacks.get(key)?.(value);},
    record(name,value){this.calls.push({name,value});},
  };

  function languageSnapshot(language = window.__mock?.settings?.language || window.__overlay?.language || 'ru') {
    const catalogs={};
    for(const code of ['ru','en']){
      const request=new XMLHttpRequest();request.open('GET',new URL('../languages/'+code+'.json',document.baseURI),false);request.send();
      catalogs[code]=JSON.parse(request.responseText);
    }
    return {language,catalogs,languages:Object.values(catalogs).map(c=>({...c.meta,iconUrl:new URL('../languages/icons/'+c.meta.icon,document.baseURI).href})),diagnostics:[],directory:'test/languages'};
  }
  window.pulseOverlay = {
    i18n:{bootstrap:()=>languageSnapshot(),reload:async()=>languageSnapshot(),openFolder:async()=>'',onChanged:on('i18n:changed'),
      setLanguage:async code=>{if(window.__mock?.failLanguageSave)throw Error('TEST_SAVE_FAILED');
        if(window.__mock)mergeSettings({language:code});else window.__overlay.language=code;
        const snapshot=languageSnapshot(code);mock.emit('i18n:changed',snapshot);return snapshot;}},
    onState:on('state'),onConfig:on('config'),onAudioFrame:on('audio'),onPreviewMode:on('preview'),
    onInteraction:on('interaction'),onHelp:on('help'),onAnimate:on('animate'),
    control:(action,value)=>mock.record('control',{action,value}),
    resizeBegin:(edge,screenX,screenY)=>mock.record('resizeBegin',{edge,screenX,screenY}),
    resizeMove:(screenX,screenY)=>mock.record('resizeMove',{screenX,screenY}),resizeEnd:()=>mock.record('resizeEnd'),
    pointerGesture:value=>mock.record('gesture',value),
    hitRegions:value=>{mock.regions=value;mock.record('regions',value);},
    interactiveHover:value=>mock.record('hover',value),
    toggleClickThrough:async()=>{mock.enabled=!mock.enabled;mock.record('toggle',mock.enabled);
      mock.emit('interaction',{clickThrough:mock.enabled,passThrough:mock.enabled});return {enabled:mock.enabled};},
  };
})();
