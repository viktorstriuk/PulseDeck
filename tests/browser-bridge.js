// Test-only bridge. Production preloads and IPC are tested independently in Node.
(() => {
  const clone = x => JSON.parse(JSON.stringify(x));
  const base = new URL(document.baseURI).origin;
  const fixture = `${base}/tests/fixtures/silence.wav`;
  const defaults = {
    theme:'ocean',accent:'olive',sort:'recent',view:'grid',volume:.5,categoryLayout:'top',trackOrderSchema:2,
    appIcon:'builtin:blue-violet',favorites:[],categoryOrder:[],categoryStyles:{},
    customCategories:Array.from({length:90},(_,i)=>({id:`custom:${i}`,name:`Плейлист ${String(i+1).padStart(3,'0')}`,tracks:[]})),
    artistAliases:{},artistNames:{},playlistMembership:{},trackOrders:{},
    gameOverlay:{mode:'off'},playerOverlay:{mode:'off',visualizer:false,clickThroughWhenMinimized:true},
  };
  const callbacks = new Map();
  // Match Electron: each subscriber receives an event; unsubscribe only itself.
  const on = name => cb => {if(!callbacks.has(name))callbacks.set(name,new Set());callbacks.get(name).add(cb);return()=>callbacks.get(name)?.delete(cb);};
  const stored = localStorage.getItem('pd-test-settings');
  const mock=window.__mock = {
    calls:[],patches:[],iconDelays:{},listDelay:0,
    settings:stored?JSON.parse(stored):defaults,
    tracks:Array.from({length:12},(_,i)=>({id:`t${i}`,rel:`${i<4?'Old artist/':''}song-${i}.wav`,
      title:`${String(i+1).padStart(2,'0')} — Тестовый трек`,artist:i<6?'Morgenstern':'Slipknot',album:'Проверка',
      duration:10,addedAt:2000000000000-i*1000,modifiedAt:2000000000000-i*1000,size:160044,ext:'WAV',
      coverUrl:i===0?`${base}/app/assets/app-icons/sunset-monitor.png`:i===2?`${base}/tests/missing-cover.png`:'',
      audioUrl:fixture,sourceUrl:'',favorite:false,sourceProvider:'local'})),
    emit(name,value){let result;for(const cb of [...(callbacks.get(name)||[])])result=cb(value);return result;},
  };
  const record = (name,value) => {mock.calls.push({name,value});return true;};
  const mergeSettings = patch => {
    for (const [key,value] of Object.entries(patch)) {
      if (['playerOverlay','gameOverlay','hotkeys'].includes(key)) mock.settings[key]={...mock.settings[key],...value};
      else if(key==='trackOrders') {
        for(const [cat,orders] of Object.entries(value)) {
          mock.settings.trackOrders[cat]??={};
          for(const [sort,rels] of Object.entries(orders)) {
            if(rels===null) delete mock.settings.trackOrders[cat][sort];
            else mock.settings.trackOrders[cat][sort]=rels;
          }
        }
      } else mock.settings[key]=value;
    }
    localStorage.setItem('pd-test-settings',JSON.stringify(mock.settings));
    return clone(mock.settings);
  };

  function languageSnapshot(language = window.__mock?.settings?.language || window.__overlay?.language || 'ru') {
    const catalogs={};
    for(const code of ['ru','en']){
      const request=new XMLHttpRequest();request.open('GET',new URL('../languages/'+code+'.json',document.baseURI),false);request.send();
      catalogs[code]=JSON.parse(request.responseText);
    }
    return {language,catalogs,languages:Object.values(catalogs).map(c=>({...c.meta,iconUrl:new URL('../languages/icons/'+c.meta.icon,document.baseURI).href})),diagnostics:[],directory:'test/languages'};
  }
  window.pulse={
    i18n:{bootstrap:()=>languageSnapshot(),reload:async()=>languageSnapshot(),openFolder:async()=>'',onChanged:on('i18n:changed'),
      setLanguage:async code=>{if(window.__mock?.failLanguageSave)throw Error('TEST_SAVE_FAILED');
        if(window.__mock)mergeSettings({language:code});else window.__overlay.language=code;
        const snapshot=languageSnapshot(code);mock.emit('i18n:changed',snapshot);return snapshot;}},
    library:{
      list:async()=>{const snapshot=clone(mock.tracks).map(t=>({...t,favorite:(mock.settings.favorites||[]).includes(window.PulseLibrary.token(t.rel))}));if(mock.listDelay)await new Promise(r=>setTimeout(r,mock.listDelay));return snapshot;},
      refresh:async()=>clone(mock.tracks),addFiles:async()=>({added:0}),
      playback:async rel=>rel?{rel,audioUrl:mock.playbackUrl||fixture}:null,
      openFolder:async()=>record('folder'),reveal:async rel=>record('reveal',rel),remove:async()=>({ok:true}),
      removeMany:async rels=>{
        record('removeMany',rels);const L=window.PulseLibrary;L.requireTracks(mock.tracks,rels);
        const failed=rels.filter(rel=>(mock.failRemoval||[]).includes(rel)).map(rel=>({rel,message:'Файл занят'}));
        const removed=rels.filter(rel=>!failed.some(f=>f.rel===rel));
        mock.tracks=mock.tracks.filter(t=>!removed.includes(t.rel));
        let next=L.normalizeOrganization(mock.settings);for(const rel of removed)next=L.removeTrack(next,rel);
        mergeSettings(L.organizationPatch(next));return {ok:!failed.length,removed,failed,warnings:[],settings:L.organizationPatch(next)};
      },
      favorite:async rel=>{const t=mock.tracks.find(t=>t.rel===rel);t.favorite=!t.favorite;return {favorite:t.favorite};},
      organize:async command=>{record('organize',command);const L=window.PulseLibrary;let result;
        if(command.type==='bulk-remove')result=L.bulkRemove(mock.settings,mock.tracks,command.key,command.rels);
        else if(command.type==='bulk-categories')result=L.bulkCategories(mock.settings,mock.tracks,command.keys,command.action,command.target);
        else if(command.type==='alias-playlists')result=L.aliasSelectedPlaylists(mock.settings,mock.tracks,command.keys,command.target);
        else if(command.type==='merge')result=L.mergePlaylists(mock.settings,mock.tracks,command.source,command.target);
        else if(command.type==='alias')result=L.aliasArtist(mock.settings,mock.tracks,command.source,command.target);
        else if(command.type==='bulk-add')result=L.bulkAdd(mock.settings,mock.tracks,command.key,command.rels);
        else if(command.type==='alias-selected')result=L.aliasSelectedArtists(mock.settings,mock.tracks,command.rels,command.target);
        else if(command.type==='split-artists')result=L.splitArtistGroups(mock.settings,mock.tracks,command.keys);
        else if(command.type==='split-selected')result=L.splitSelectedArtists(mock.settings,mock.tracks,command.rels);
        else result=L.toggleMembership(mock.settings,mock.tracks,command.key,command.rel);
        mergeSettings(L.organizationPatch(result.settings));return result;},
      onChanged:on('library:changed')},
    updates:{status:async()=>({phase:'unconfigured',current:(await(await fetch(new URL('../package.json',document.baseURI))).json()).version,available:'',configured:false,prefs:{automatic:true,prerelease:false,components:true,...mock.updatePrefs},lastCheck:0}),check:async()=>{record('updates:check');return pulse.updates.status();},configure:async patch=>{record('updates:configure',patch);mock.updatePrefs={...mock.updatePrefs,...patch};return pulse.updates.status();},download:async mode=>record('updates:download',mode),cancel:async()=>record('updates:cancel'),install:async()=>record('updates:install'),defer:async mode=>record('updates:defer',mode),onChanged:on('updates:changed'),onPrepare:on('updates:prepare-install'),prepared:reply=>record('updates:prepared',reply)},
    components:{status:async()=>({phase:'unconfigured',items:[{id:'ffmpeg',installed:false},{id:'ytdlp',installed:false}]}),install:async id=>record('components:install',id),rollback:async id=>record('components:rollback',id),cancel:async()=>record('components:cancel'),onChanged:on('components:changed')},
    settings:{get:async()=>clone(mock.settings),set:async patch=>{mock.patches.push(clone(patch));return mergeSettings(patch);},flush:()=>true},
    online:{search:async()=>({ok:true,items:[]}),preview:async()=>({ok:false}),analyze:async()=>({ok:false}),download:async()=>({ok:false}),onProgress:on('progress'),onToolStatus:on('tool')},
    appearance:{resolve:async()=>'',iconUrl:async ref=>{if(mock.iconDelays[ref])await new Promise(r=>setTimeout(r,mock.iconDelays[ref]));return `${base}/app/assets/app-icons/${ref.replace('builtin:','')}-monitor.png`;},chooseBackground:async()=>null,chooseIcon:async()=>null,saveIconRaster:async()=>true},
    system:{appInfo:async()=>({name:'PulseDeck',version:(await(await fetch(new URL('../package.json',document.baseURI))).json()).version}),openExternal:async url=>record('openExternal',url)},
    hotkeys:{status:async()=>({}),suspend:async()=>true,onStatus:on('hotkeys:status'),onAction:on('hotkey:action')},
    overlay:{preview:async value=>record('preview',value),configure:async c=>c,state:async s=>{mock.overlayState=clone(s);return true;},notify:async()=>true,showHelp:async()=>true,audioFrame:()=>{},onBounds:on('bounds'),onSettingsChanged:on('overlay-settings'),onPreviewContext:on('preview-context')},
    gameOverlay:{status:async()=>({supported:false,mode:'off',rtss:{}}),configure:async c=>({settings:c}),visual:()=>{},onStatus:on('game-status'),openGameBar:async()=>true,launchRtss:async()=>({ok:false}),openRtssDownload:async()=>true,restartHost:async()=>true},
    window:{minimize:async()=>true,toggleMaximize:async()=>true,close:async()=>true,isMaximized:async()=>false,onMaximized:on('maximized')},
  };

  const lyricRecords=JSON.parse(localStorage.getItem('pd-lyrics-records')||'{}');
  mock.lyrics={records:lyricRecords,delays:{},results:[],imported:null};
  pulse.lyrics={onAnalysis:on('lyrics:analysis-progress'),onLock:on('lyrics:locked'),onProgress:on('lyrics:progress'),command:async c=>{
    record('lyrics', {...c,password:c.password?'[present]':undefined});
    const id=(mock.tracks.findIndex(t=>t.rel===c.rel)+1).toString(16).padStart(64,'0');
    if(c.type==='get'){const result=clone(lyricRecords[c.rel]||{doc:null,theme:null,revision:null});if(mock.lyrics.delays[c.rel])await new Promise(r=>setTimeout(r,mock.lyrics.delays[c.rel]));return {...result,recordingId:id};}
    if(c.type==='save'){const old=lyricRecords[c.rel];if((old?.revision||null)!==(c.revision||null))throw Error('Текст уже изменён');const parsed=c.doc?PulseLyrics.normalize(c.doc):null;const result={doc:parsed?.doc||null,theme:PulseLyrics.theme(c.theme||old?.theme),timing:PulseLyricsEditor.preferences(parsed?.doc||c.timing||old?.timing),revision:String(Date.now())+Math.random(),recordingId:id};if(result.doc)result.doc.theme=result.theme;lyricRecords[c.rel]=result;localStorage.setItem('pd-lyrics-records',JSON.stringify(lyricRecords));return clone(result);}
    if(c.type==='presentation'){const old=lyricRecords[c.rel];if(mock.lyrics.saveDelay)await new Promise(r=>setTimeout(r,mock.lyrics.saveDelay));if(mock.lyrics.saveError)throw Error(mock.lyrics.saveError);if((old?.revision||null)!==(c.revision||null))throw Error('Текст уже изменён');const result={...(old||{}),doc:old?.doc||null,theme:PulseLyrics.theme(c.theme),timing:PulseLyricsEditor.preferences(c.timing),revision:String(Date.now())+Math.random(),recordingId:id};if(result.doc){result.doc.theme=result.theme;Object.assign(result.doc,result.timing);}lyricRecords[c.rel]=result;localStorage.setItem('pd-lyrics-records',JSON.stringify(lyricRecords));return clone(result);}
    if(c.type==='remove'){const result={...(lyricRecords[c.rel]||{}),doc:null,suppressed:true,revision:String(Date.now())+Math.random(),recordingId:id};lyricRecords[c.rel]=result;return clone(result);}
    if(c.type==='cancel-analysis'||c.type==='cancel-search')return {ok:true};
    if(c.type==='analyze'){if(mock.lyrics.analysisDelay)await new Promise(r=>setTimeout(r,mock.lyrics.analysisDelay));if(mock.lyrics.analysisError)throw Error(mock.lyrics.analysisError);return mock.lyrics.analysis||{durationMs:64000,hopMs:20,activity:Array.from({length:3200},(_,i)=>i<150||i>3050?0:1),regions:[[3000,61000]],onsets:Array.from({length:100},(_,i)=>3000+i*550),tempo:109,wave:Array.from({length:100},(_,i)=>.15+(Math.sin(i)**2)*.8)};}
    if(c.type==='import')return mock.lyrics.imported||{canceled:true};
    if(c.type==='search'){if(mock.lyrics.searchDelay)await new Promise(r=>setTimeout(r,mock.lyrics.searchDelay));if(mock.lyrics.searchError)throw Error(mock.lyrics.searchError);return clone(mock.lyrics.results);}
    if(c.type==='cancel-export')return {ok:true};
    if(c.type.startsWith('export'))return {ok:true};
    throw Error('Unexpected lyric command');
  }};
})();
