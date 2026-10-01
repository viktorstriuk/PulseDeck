'use strict';
/** Values shared by the privileged service and the renderer. No file/network I/O. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PulseMedia=api;})(typeof window==='object'?window:globalThis,()=>{
  const finite=(v,fallback)=>typeof v==='number'&&Number.isFinite(v)?v:fallback;
  const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
  function sound(value){
    const s=value&&typeof value==='object'?value:{};
    return {deviceId:typeof s.deviceId==='string'?s.deviceId.slice(0,512):'',enabled:s.enabled===true,
      reference:['first-played','playlist-first','fixed','manual'].includes(s.reference)?s.reference:'first-played',
      targetLUFS:clamp(finite(s.targetLUFS,-18),-30,-10),toleranceDB:clamp(finite(s.toleranceDB,0),0,6),
      maxBoostDB:clamp(finite(s.maxBoostDB,6),0,12),manualLUFS:Number.isFinite(s.manualLUFS)?clamp(s.manualLUFS,-60,-5):null,
      manualName:typeof s.manualName==='string'?s.manualName.slice(0,300):''};
  }
  function profile(v){return v&&Number.isFinite(v.lufs)&&v.lufs>-60&&v.lufs<0&&Number.isFinite(v.peakDB)?{lufs:v.lufs,peakDB:clamp(v.peakDB,-120,24)}:null;}
  function gainDB(p,target,s){
    p=profile(p);s=sound(s);if(!s.enabled||!p||!Number.isFinite(target))return 0;
    const difference=target-p.lufs;
    // A dead band avoids changing already similar recordings. Never amplify silence.
    const desired=difference<0?Math.min(0,difference+s.toleranceDB):Math.max(0,difference-s.toleranceDB);
    return clamp(Math.min(desired,-1-p.peakDB),-48,s.maxBoostDB);
  }
  function sync(v){return {offset:clamp(finite(v?.offset,0),-1800,1800),rate:clamp(finite(v?.rate,1),.95,1.05)};}
  const videoTime=(audioTime,v)=>finite(audioTime,0)*sync(v).rate+sync(v).offset;
  const audioTime=(time,v)=>(finite(time,0)-sync(v).offset)/sync(v).rate;
  function trim(start,end,duration){
    if(!Number.isFinite(duration)||duration<=0||duration>1800)throw Error('MediaDuration');
    start=finite(start,0);end=finite(end,duration);
    if(start<0||end>duration+.05||end-start<.25)throw Error('MediaTrimInvalid');
    return {start,end:Math.min(end,duration),duration:Math.min(end,duration)-start};
  }
  function youtube(value){
    try{const u=new URL(String(value));if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
      const host=u.hostname.toLowerCase();let id;
      if(host==='youtu.be')id=u.pathname.slice(1);
      else if(['youtube.com','www.youtube.com','music.youtube.com','m.youtube.com'].includes(host))id=u.pathname==='/watch'?u.searchParams.get('v'):/^\/(?:shorts|embed)\/([^/]+)$/.exec(u.pathname)?.[1];
      return /^[\w-]{11}$/.test(id||'')?'https://www.youtube.com/watch?v='+id:null;
    }catch{return null;}
  }
  function uuid(){
    if(typeof globalThis.crypto?.randomUUID==='function')return globalThis.crypto.randomUUID();
    const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  }
  return {sound,profile,gainDB,sync,videoTime,audioTime,trim,youtube,clamp,uuid};
});
