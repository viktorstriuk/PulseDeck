'use strict';
const crypto=require('node:crypto');
const M=require('../shared/online-search'),Fields=require('../shared/track-enrichment');
const {fail,abortError,sleep}=require('./http');
const I=require('../i18n');
const IMAGE_HOSTS=['ytimg.com','ggpht.com','sndcdn.com','bcbits.com','ngfiles.com','archive.org','coverartarchive.org'];
function imageURL(raw){try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')return '';return IMAGE_HOSTS.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.href:'';}catch{return '';}}
function artworkKey(raw){try{const u=new URL(raw);u.hash='';if(u.hostname.endsWith('ytimg.com'))u.pathname=u.pathname.replace(/\/(?:default|mqdefault|hqdefault|sddefault|maxresdefault)\.(jpg|webp)$/,'/cover.$1');if(u.hostname.endsWith('sndcdn.com'))u.pathname=u.pathname.replace(/-(?:large|t500x500|crop)\./,'-cover.');return u.href;}catch{return raw;}}
function createCovers({search,fetch,version='2.9.4',clock=Date.now,progress=()=>{}}){
  const known=new Map(),cursors=new Map(),requests=new Map();let nextMB=0,mbTail=Promise.resolve();
  const bound=(map,n)=>{for(const [k,v]of map)if(v.until<clock())map.delete(k);while(map.size>n)map.delete(map.keys().next().value);};
  async function request(raw,{signal,json=false}={}){
    let url=new URL(raw);const limit=json?3*1024*1024:Infinity,ctl=new AbortController(),abort=()=>ctl.abort();
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)ctl.abort();let timer;
    // Idle timeout, not a byte/resolution limit: large images can stream as long
    // as the source continues sending data. JSON still has a protocol budget.
    const touch=()=>{clearTimeout(timer);timer=setTimeout(abort,15000);};touch();
    try{for(let hop=0;hop<5;hop++){
      if(json?!(url.protocol==='https:'&&(['musicbrainz.org','coverartarchive.org'].includes(url.hostname)||url.hostname==='archive.org'||url.hostname.endsWith('.archive.org'))&&!url.username&&!url.password&&!url.port):!imageURL(url.href))throw fail('SEARCH_BAD_URL');
      const response=await fetch(url.href,{signal:ctl.signal,redirect:'manual',credentials:'omit',headers:{Accept:json?'application/json':'image/*','User-Agent':`PulseDeck/${version} (https://github.com/viktorstriuk/PulseDeck)`}});touch();
      if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel?.();if(!location)throw fail('SEARCH_NETWORK');url=new URL(location,url);if(url.protocol==='http:'&&(url.hostname==='archive.org'||url.hostname.endsWith('.archive.org')||url.hostname==='coverartarchive.org'))url.protocol='https:';continue;}
      if(!response.ok){await response.body?.cancel?.();throw fail(response.status===429?'SEARCH_RATE_LIMIT':'SEARCH_NETWORK',{status:response.status});}
      if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel?.();throw fail('SEARCH_RESPONSE_LIMIT');}
      const chunks=[];let size=0;for await(const chunk of response.body){if(ctl.signal.aborted)throw abortError();touch();size+=chunk.length;if(size>limit){ctl.abort();throw fail('SEARCH_RESPONSE_LIMIT');}chunks.push(Buffer.from(chunk));}
      const body=Buffer.concat(chunks);return json?JSON.parse(body.toString('utf8')):body;
    }throw fail('SEARCH_NETWORK');}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  function cancel(id){for(const [key,ctl]of requests)if(!id||key===id||key.startsWith(id+':')){ctl.abort();requests.delete(key);for(const provider of M.IDS)search.cancel(`${key}:${provider}`);}return {ok:true};}
  function register(item,state,items,requestId,phase,signal){
    if(signal.aborted)throw abortError();const image=imageURL(item.image||item.thumbnail),key=artworkKey(image);
    if(!image||state.seen.has(key))return;state.seen.add(key);
    const id=crypto.randomBytes(16).toString('hex'),entry={id,key,image,title:M.text(item.title,300),album:M.text(item.album,300),artist:M.text(item.artist,160),source:item.source||item.provider||'',page:M.safeURL(item.page||item.url)};
    known.set(id,{...entry,download:imageURL(item.fullImage)||image,until:clock()+30*60000});items.push(entry);
    progress({kind:'covers',requestId,phase,items:[entry]});
  }
  async function music(state,signal,id,emit){
    const errors=[];
    await Promise.all(Object.entries(state.providers).map(async([provider,cursor])=>{
      try{
        const result=await search.command({type:'page',provider,query:state.query,cursor,requestId:`${id}:${provider}`});
        if(signal.aborted)throw abortError();if(!result.ok)throw Object.assign(Error(result.error?.code||'SEARCH_NETWORK'),result.error);
        for(const item of result.items||[])emit(item);
        if(result.cursor&&result.cursor!==cursor)state.providers[provider]=result.cursor;else delete state.providers[provider];
      }catch(error){if(signal.aborted)throw abortError();errors.push(error);}
    }));
    return errors;
  }
  const credit=item=>(item?.['artist-credit']||[]).map(x=>x.name||x.artist?.name||'').filter(Boolean).join(', ');
  const lucene=s=>Fields.clean(s).replace(/[+\-!(){}\[\]^"~*?:\\/|&]/g,' ').replace(/\s+/g,' ').trim();
  async function mbPage(state,signal){
    const mode=state.mode,fields=state.identity,query=fields?(mode==='recording'?`recording:"${lucene(fields.title)}" AND artist:"${lucene(fields.artist)}"`:`artist:"${lucene(fields.artist)}"${fields.album?' AND release:"'+lucene(fields.album)+'"':''}`):lucene(state.query);
    const operation=mbTail.then(async()=>{await sleep(Math.max(0,nextMB-clock()),signal);nextMB=clock()+1100;return request(`https://musicbrainz.org/ws/2/${mode}/?query=${encodeURIComponent(query)}&fmt=json&limit=20&offset=${state.offset}`,{signal,json:true});});
    mbTail=operation.catch(()=>{});const data=await operation,records=data.recordings||data.releases||[],fallback=mode==='recording'&&!data.recordings&&Array.isArray(data.releases);
    for(const record of records){const releases=mode==='recording'&&!fallback?(record.releases||[]):[record];
      for(const release of releases){if(!/^[a-f0-9-]{36}$/i.test(release.id)||state.releases.has(release.id))continue;state.releases.add(release.id);state.queue.push({id:release.id,title:mode==='recording'&&!fallback?record.title:release.title,album:release.title,artist:credit(record)||credit(release)});}}
    state.offset+=records.length;const count=Number(data.count??data[mode+'-count']);
    if(!records.length||Number.isFinite(count)&&state.offset>=count||!Number.isFinite(count)&&records.length<20){
      if(mode==='recording'&&!fallback){state.mode='release';state.offset=0;}else state.catalogDone=true;
    }
  }
  async function catalog(state,signal,emit){
    const errors=[];if(!state.queue.length&&!state.catalogDone)await mbPage(state,signal);
    // An empty recording search can still yield the artist's album artwork.
    if(!state.queue.length&&!state.catalogDone&&state.mode==='release')await mbPage(state,signal);
    const queue=state.queue.splice(0,8);let index=0;
    await Promise.all([0,1].map(async()=>{while(index<queue.length){const release=queue[index++];if(signal.aborted)throw abortError();
      try{const art=await request(`https://coverartarchive.org/release/${release.id}`,{signal,json:true});
        for(const image of [...(art.images||[])].sort((a,b)=>Number(!!b.front)-Number(!!a.front))){
          emit({...release,image:String(image.thumbnails?.['500']||image.thumbnails?.large||image.image||'').replace(/^http:/,'https:'),fullImage:String(image.image||'').replace(/^http:/,'https:'),source:'MusicBrainz / Cover Art Archive',page:`https://musicbrainz.org/release/${release.id}`});}
      }catch(error){if(signal.aborted)throw abortError();if(error.status!==404){errors.push(error);state.queue.push(release);}}
    }}));return errors;
  }
  async function find({query,phase='music',requestId,prefs,cursor,track}){
    query=M.text(query);if(query.length<2)return {ok:true,items:[],cursor:null,exhausted:true};
    phase=phase==='catalog'?'catalog':'music';const id=M.text(requestId,70)||crypto.randomUUID(),ctl=new AbortController();cancel(id);requests.set(id,ctl);
    const policy=M.preferences(prefs),key=JSON.stringify([query,phase,phase==='music'?policy:null]);let state,acquired=false;
    const items=[];
    try{
      if(cursor){state=cursors.get(cursor);if(!state||state.until<clock()||state.key!==key)throw fail('SEARCH_BAD_QUERY');if(state.busy)throw fail('SEARCH_RATE_LIMIT');}
      else {
        const identity=require('../shared/lyrics-search').identity(track||{}),expected=[identity.artist,identity.title].filter(Boolean).join(' '),album=[identity.artist,track?.album].filter(Boolean).join(' ');
        state={key,query,seen:new Set(),providers:Object.fromEntries(policy.order.filter(p=>policy.enabled.includes(p)).map(p=>[p,null])),mode:'recording',offset:0,releases:new Set(),queue:[],catalogDone:false,identity:identity.artist&&!Fields.unknown(identity.artist)&&[expected,album].some(s=>s.toLowerCase()===query.toLowerCase())?{...identity,album:track?.album||''}:null};
      }
      state.busy=true;acquired=true;const emit=item=>register(item,state,items,id,phase,ctl.signal);
      const errors=phase==='music'?await music(state,ctl.signal,id,emit):await catalog(state,ctl.signal,emit);
      if(ctl.signal.aborted)throw abortError();const more=phase==='music'?Object.keys(state.providers).length>0:state.queue.length>0||!state.catalogDone;
      let next=null;if(more){next=cursor||crypto.randomBytes(18).toString('hex');state.until=clock()+30*60000;cursors.set(next,state);}else if(cursor)cursors.delete(cursor);
      bound(cursors,128);bound(known,20000);
      return {ok:!errors.length||items.length>0,items,cursor:next,exhausted:!more,partial:errors.length>0,...(errors.length?{error:M.classifyError(errors[0])}:{})};
    }catch(error){return {ok:false,error:M.classifyError(error),items,cursor:cursor||null};}
    finally{if(acquired)state.busy=false;if(requests.get(id)===ctl)requests.delete(id);}
  }
  async function download(id,{signal}={}){const item=known.get(id);if(!item||item.until<clock())throw I.error('CoverExpired');return request(item.download,{signal});}
  return {find,download,cancel,request,dispose:()=>{cancel();known.clear();cursors.clear();}};
}
module.exports={createCovers,imageURL,artworkKey};
