// Deterministic UI fixtures, never used by the packaged application.
(() => {
  const root=new URL(document.baseURI),s=window.__toolsMock={calls:[],cap:null,last:null,cancel:false,delay:35,revision:0};
  const art=i=>new URL('../assets/app-icons/'+['sunset','sky','coral','lime','forest','ocean','mint-violet','blue-violet'][i%8]+'-monitor.png',root).href;
  Object.assign(__mock.tracks[0],{title:'Маяк — Тихий свет',artist:'Неизвестный исполнитель',coverUrl:''});
  __mock.settings.customCategories=__mock.settings.customCategories.slice(0,3);__mock.settings.customCategories[0].name='Вечерняя коллекция';__mock.settings.customCategories[0].tracks=__mock.tracks.slice(0,4).map(t=>t.rel);
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  pulse.library.onProgress=cb=>{s.progress=cb;return()=>s.progress=null;};
  const emit=p=>{s.last=p;s.progress?.(p);};
  const plan=()=>({ok:true,token:'prepared-fixture',count:3,target:'music',bytes:12345,counts:{artists:2,covers:2,lyrics:3},names:['Маяк — Тихий свет','Полюс — Неон','Рассвет'],warnings:[],warningCount:0,skipped:0});
  pulse.library.prepareDrop=async(files,requestId)=>{s.calls.push({type:'prepare-drop',names:files.map(x=>x.name),requestId});await wait(30);return plan();};
  pulse.library.command=async c=>{
    s.calls.push(structuredClone(c));if((c.type.endsWith('cancel')&&c.type!=='job-cancel')||c.type==='cancel-capabilities'||c.type==='import-discard')return {ok:true};
    if(c.type==='metadata'){const t=__mock.tracks.find(t=>t.rel===c.rel);return {ok:true,track:structuredClone(t),revision:t.editRevision||null};}
    if(c.type==='edit'){const t=__mock.tracks.find(t=>t.rel===c.rel);if(c.revision!==(t.editRevision||null))throw Error('Changed');Object.assign(t,c.patch,{editRevision:'rev'+(++s.revision)});return {ok:true,revision:t.editRevision};}
    if(c.type==='cover-search'){await wait(c.query==='slow old query'?300:s.delay);return {ok:true,items:Array.from({length:c.phase==='music'?8:4},(_,i)=>({id:c.phase+'-'+i,image:art(i+(c.phase==='music'?0:4)),title:'Тихий свет '+(i+1),artist:'Маяк',source:c.phase==='music'?'YouTube Music':'Cover Art Archive'}))};}
    if(c.type==='cover-select'||c.type==='cover-upload'){const t=__mock.tracks.find(t=>t.rel===c.rel);t.coverUrl=art(c.id?Number(c.id.split('-')[1]):7);t.editRevision='rev'+(++s.revision);return {ok:true,revision:t.editRevision};}
    if(c.type==='capabilities'){await wait(s.delay);const counts=s.cap||{artists:1,covers:3,lyrics:4};return {ok:true,counts,total:c.rels.length,actions:PulseTrackEnrichment.actions(counts)};}
    if(c.type==='import-choose'){await wait(30);return plan();}
    if(c.type==='batch-start'){
      s.cancel=false;const id='job-'+(++s.revision);s.last=null;
      setTimeout(()=>emit({id,phase:'copy',done:1,total:3,added:c.token?1:0,changed:0,skipped:0,failed:0}),30);
      setTimeout(()=>emit({id,phase:'enrich',done:1,total:4,added:c.token?3:0,changed:1,skipped:0,failed:0,title:'Маяк — Тихий свет',action:'artists',status:'changed'}),80);
      setTimeout(()=>emit({id,phase:'complete',done:4,total:4,added:c.token?3:0,changed:s.cancel?1:3,skipped:1,failed:0,cancelled:s.cancel}),s.jobDelay||180);
      return {ok:true,id};
    }
    if(c.type==='job-cancel'){s.cancel=true;return {ok:true};}if(c.type==='job-status')return {ok:true,job:s.last};
    return {ok:true};
  };
  const old=pulse.online.command;
  pulse.online.command=async c=>{
    if(c.type!=='resolve')return old(c);__searchMock.calls.push(structuredClone(c));await wait(c.url.includes('slowlink')?350:40);
    return {ok:true,item:PulseOnlineSearch.normalizeItem({url:c.url,title:'Тихий свет',artist:'Маяк',duration:180,thumbnail:art(0),availability:{state:'available',reason:'SEARCH_STREAM_FOUND'}},'youtube'),query:'Маяк Тихий свет'};
  };
})();
