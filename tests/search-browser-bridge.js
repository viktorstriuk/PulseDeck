// Deterministic six-source fixtures. No live provider requests, accounts or media.
(() => {
 const clone=x=>JSON.parse(JSON.stringify(x)),base=new URL(document.baseURI).origin;
 const s=window.__searchMock={calls:[],delay:65,fail:{newgrounds:'SEARCH_ACCESS'},pageSize:12,maxPage:3,history:{enabled:false,count:0,items:[]},activeProbes:0,maxProbes:0};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const urls=(provider,i)=>({ytmusic:`https://music.youtube.com/watch?v=fixture${String(i).padStart(4,'0')}`,youtube:`https://www.youtube.com/watch?v=fixture${String(i).padStart(4,'0')}`,soundcloud:`https://soundcloud.com/fixture/track-${i}`,bandcamp:`https://fixture.bandcamp.com/track/song-${i}`,newgrounds:`https://www.newgrounds.com/audio/listen/${10000+i}`,archive:`https://archive.org/details/fixture/song-${i}.mp3`}[provider]);
 s.item=(provider,i,query)=>({url:urls(provider,provider==='youtube'&&i>=3?i+100:i),title:i===0?query:i===1?`${query} (Live)`:i===2?`${query} (Remix)`:`${query} - ${String(i).padStart(2,'0')}`,artist:i%3?'Маяк':'Другой исполнитель',album:'Тестовый альбом',duration:i===1?420:170+i,thumbnail:new URL(`../assets/app-icons/${['sky','coral','lime'][i%3]}-monitor.png`,document.baseURI).href,availability:['ytmusic','youtube'].includes(provider)&&i===2?{state:'blocked',reason:'SEARCH_DRM'}:{state:'unknown',reason:''}});
 pulse.online.command=async c=>{
  s.calls.push(clone(c));if(c.type==='cancel')return {ok:true};
  if(c.type==='probe'){s.activeProbes++;s.maxProbes=Math.max(s.maxProbes,s.activeProbes);await wait(18);s.activeProbes--;return {ok:true,key:PulseOnlineSearch.canonicalURL(c.url),availability:c.url.includes('0000')?{state:'unknown',reason:'SEARCH_ACCESS'}:{state:'available',reason:'SEARCH_STREAM_FOUND'}};}
  if(c.type!=='page')return {ok:false};
  await wait(c.query==='старый запрос'?500:s.delay);
  if(s.fail[c.provider])return {ok:false,error:{code:s.fail[c.provider],retryable:true}};
  const n=Number(c.cursor)||1,items=Array.from({length:s.pageSize},(_,i)=>s.item(c.provider,(n-1)*s.pageSize+i,c.query));
  if(n>1)items.unshift(s.item(c.provider,0,c.query)); // Deliberate repeated row.
  return {ok:true,provider:c.provider,items,cursor:n<s.maxPage?String(n+1):null};
 };
 pulse.online.preview=async url=>{s.calls.push({type:'preview',url});return {ok:true,title:'Тихий свет',artist:'Маяк',duration:10,sourceUrl:url,previewUrl:base+'/tests/fixtures/silence.wav',provider:'youtube'};};
 pulse.online.analyze=async()=>({ok:false,message:'Fixture: no automatic trim'});
 pulse.discovery={command:async c=>{s.calls.push(clone(c));if(c.type==='configure')s.history.enabled=c.enabled===true;if(c.type==='clear'){s.history.count=0;s.history.items=[];}if(c.type==='dismiss')s.history.items=s.history.items.filter(x=>x.track.rel!==c.rel);return clone({ok:true,...s.history,items:s.history.enabled?s.history.items:[]});}};
 const old=__mock.tracks[0];Object.assign(old,{title:'Тихий свет',artist:'Маяк',genre:'Electronic'});
 __mock.settings.onlineSearch={enabled:['ytmusic','youtube','soundcloud','bandcamp','newgrounds','archive'],order:['ytmusic','youtube','soundcloud','bandcamp','newgrounds','archive'],autoSearch:true,hideUnavailable:true};
})();
