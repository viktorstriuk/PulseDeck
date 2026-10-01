/* UI-only deterministic IPC. Real FFmpeg, storage, cryptography and token
 * lifecycle are exercised in media-296.test.js; these are not network tests. */
(() => {
 const m=__mock,copy=x=>structuredClone(x),clipURL=new URL('../../test-results/2.9.6/session.webm',document.baseURI).href;
 m.mediaCalls=[];m.mediaProfile={lufs:-18,peakDB:-4};m.clipURL=clipURL;m.mediaFailSave=false;
 const record=rel=>copy(m.lyrics.records[rel]||{doc:null,theme:null,revision:null,musicVideo:null});
 pulse.media={onProgress:()=>()=>{},command:async c=>{
  m.mediaCalls.push(copy(c));
  if(c.action==='info')return record(c.rel);
  if(c.action==='profile'){if(m.profileDelay)await new Promise(r=>setTimeout(r,m.profileDelay));return copy(m.mediaProfile);}
  if(c.action==='preview-profile')return {lufs:-13,peakDB:-2};
  if(c.action==='search')return {items:[{url:'https://www.youtube.com/watch?v=abcdefghijk',title:'Signal Drift · Studio Session',artist:'PulseDeck test recording',duration:18,thumbnail:''},{url:'https://www.youtube.com/watch?v=lmnopqrstuv',title:'Signal Drift · Alternative edit',artist:'PulseDeck test recording',duration:20,thumbnail:''}],cursor:null};
  if(c.action==='prepare')return {token:'test-token',url:clipURL,sourceUrl:c.url,duration:18,title:'Signal Drift',profile:{lufs:-12,peakDB:-2}};
  if(c.action==='sync')return m.syncResult||{matched:true,offset:2,rate:1,confidence:.98,anchors:3,uncertainty:.05};
  if(['cancel','release'].includes(c.action))return true;
  if(c.action==='save'){
   if(m.mediaFailSave){m.mediaFailSave=false;throw Error('TEST_WRITE_FAILURE');}
   const old=record(c.rel);if((old.revision||null)!==(c.revision||null))throw Error('TEST_STALE_REVISION');
   const r={...old,revision:PulseMedia.uuid(),musicVideo:{ref:'custom-'+'b'.repeat(64)+'.webm',url:clipURL,type:'video/webm',duration:c.end-c.start,offset:c.offset-c.start,rate:c.rate,profile:{lufs:-12,peakDB:-2}}};
   if(c.asBackground){r.theme=PulseLyrics.theme({...r.theme,mode:'custom',customBackground:r.musicVideo.ref});r.background={url:clipURL,type:'video/webm'};}
   m.lyrics.records[c.rel]=r;return copy(r);
  }
  if(c.action==='background-select'){
   const old=record(c.rel),r={...old,revision:PulseMedia.uuid(),theme:PulseLyrics.theme({...old.theme,mode:'custom',customBackground:'custom-'+'c'.repeat(64)+'.png'}),background:{url:new URL('../assets/app-icons/forest-monitor.png',document.baseURI).href,type:'image/png'}};m.lyrics.records[c.rel]=r;return copy(r);
  }
  throw Error('Unhandled media fixture: '+c.action);
 }};
 // Virtual audio-output devices test the UI and routing contract; there is no
 // physical Windows headset in headless Chromium.
 m.devices=[{kind:'audiooutput',deviceId:'default',label:'Default'},{kind:'audiooutput',deviceId:'speakers',label:'Studio speakers'}];m.sinks=[];
 const devices=new EventTarget();devices.enumerateDevices=async()=>copy(m.devices);Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:devices});
 AudioContext.prototype.setSinkId=async function(id){m.sinks.push(id);if(m.sinkFailure)throw new DOMException('Device unavailable','NotFoundError');};
 const library=pulse.library.command;
 pulse.library.command=async c=>{
  if(c.type==='cover-search')return {ok:true,items:c.phase==='music'?[{id:'background-result',image:new URL('../assets/app-icons/forest-monitor.png',document.baseURI).href,title:'Forest light',source:'Test fixture'}]:[],cursor:null};
  return library(c);
 };
 m.playbackUrl=new URL('../../test-results/2.9.6/session.wav',document.baseURI).href;
 pulse.online.preview=async url=>({ok:true,provider:'youtube',canTrim:true,previewId:'p'.repeat(36),previewUrl:m.playbackUrl,duration:64,title:'Signal Drift',artist:'PulseDeck test recording',sourceUrl:url});
 pulse.online.analyze=async()=>({ok:true,start:3,end:60,method:'fixture',wave:[]});
 m.downloadCount=0;pulse.online.download=async(url,options)=>{m.downloadCount++;m.lastAudioDownload={url,options};const t={...m.tracks[0],id:'download-'+m.downloadCount,rel:'new-download-'+m.downloadCount+'.wav',title:'Downloaded Signal Drift'};m.tracks.push(t);return {ok:true,rel:t.rel,track:t};};
})();
