'use strict';
const crypto=require('node:crypto');
const M=require('../shared/online-search'),Fields=require('../shared/track-enrichment');
const {fail,abortError,sleep}=require('./http');
const I=require('../i18n');
const IMAGE_HOSTS=['ytimg.com','ggpht.com','sndcdn.com','bcbits.com','ngfiles.com','archive.org','coverartarchive.org'];
function imageURL(raw){try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')return '';return IMAGE_HOSTS.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.href:'';}catch{return '';}}
function artworkKey(raw){try{const u=new URL(raw);u.hash='';if(u.hostname.endsWith('ytimg.com'))u.pathname=u.pathname.replace(/\/(?:default|mqdefault|hqdefault|sddefault|maxresdefault)\.(jpg|webp)$/,'/cover.$1');if(u.hostname.endsWith('sndcdn.com'))u.pathname=u.pathname.replace(/-(?:large|t500x500|crop)\./,'-cover.');return u.href;}catch{return raw;}}
function createCovers({search,fetch,version='2.9.2',clock=Date.now}){
  const known=new Map(),cache=new Map(),requests=new Map();let nextMB=0,mbTail=Promise.resolve();
  const bound=(map,n)=>{while(map.size>n)map.delete(map.keys().next().value);};
  async function request(raw,{signal,json=false}={}){
    let url=new URL(raw),limit=json?3*1024*1024:16*1024*1024;const ctl=new AbortController(),abort=()=>ctl.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)ctl.abort();const timer=setTimeout(abort,12000);
    try{for(let hop=0;hop<5;hop++){
      if(json?!(url.protocol==='https:'&&(['musicbrainz.org','coverartarchive.org'].includes(url.hostname)||url.hostname==='archive.org'||url.hostname.endsWith('.archive.org'))&&!url.username&&!url.password&&!url.port):!imageURL(url.href))throw fail('SEARCH_BAD_URL');
      const response=await fetch(url.href,{signal:ctl.signal,redirect:'manual',credentials:'omit',headers:{Accept:json?'application/json':'image/png,image/jpeg,image/webp','User-Agent':`PulseDeck/${version} (https://github.com/viktorstriuk)`}});
      if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel?.();if(!location)throw fail('SEARCH_NETWORK');url=new URL(location,url);if(url.protocol==='http:'&&(url.hostname==='archive.org'||url.hostname.endsWith('.archive.org')||url.hostname==='coverartarchive.org'))url.protocol='https:';continue;}
      if(!response.ok){await response.body?.cancel?.();throw fail(response.status===429?'SEARCH_RATE_LIMIT':'SEARCH_NETWORK',{status:response.status});}
      if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel?.();throw fail('SEARCH_RESPONSE_LIMIT');}
      const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>limit){ctl.abort();throw fail('SEARCH_RESPONSE_LIMIT');}chunks.push(Buffer.from(chunk));}const body=Buffer.concat(chunks);
      return json?JSON.parse(body.toString('utf8')):body;
    }throw fail('SEARCH_NETWORK');}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  function register(items){const seen=new Set(),out=[];for(const item of items){const image=imageURL(item.image||item.thumbnail);if(!image||seen.has(artworkKey(image)))continue;seen.add(artworkKey(image));const id=crypto.randomBytes(16).toString('hex'),entry={id,image,title:M.text(item.title,300),artist:M.text(item.artist,160),source:item.source||item.provider||'',page:M.safeURL(item.page||item.url),until:clock()+30*60000};known.set(id,entry);out.push(entry);if(out.length>=72)break;}bound(known,1200);return out.map(({until,...item})=>item);}
  async function music(query,signal,requestId,prefs){
    const p=M.preferences(prefs),results=await Promise.all(p.order.filter(id=>p.enabled.includes(id)).map(provider=>search.command({type:'page',provider,query,requestId:`${requestId}:${provider}`})));
    if(signal.aborted)throw abortError();if(results.length&&results.every(r=>!r.ok))throw fail(results.find(r=>r.error?.code)?.error.code||'SEARCH_NETWORK');
    return M.rank(results.flatMap(r=>r.ok?r.items:[]),M.parseQuery(query),{...p,hideUnavailable:false}).filter(x=>imageURL(x.thumbnail));
  }
  async function catalog(query,signal){
    const escaped=Fields.clean(query).replace(/[+\-!(){}\[\]^"~*?:\\/|&]/g,' ').replace(/\s+/g,' ').trim();if(!escaped)return [];
    const wait=mbTail.then(async()=>{await sleep(Math.max(0,nextMB-clock()),signal);nextMB=clock()+1100;return request(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(escaped)}&fmt=json&limit=8`,{signal,json:true});});mbTail=wait.catch(()=>{});
    const data=await wait,out=[];let failure=null,answered=0;
    for(const release of (data.releases||[]).slice(0,6)){if(signal.aborted)throw abortError();if(!/^[a-f0-9-]{36}$/i.test(release.id))continue;
      try{const art=await request(`https://coverartarchive.org/release/${release.id}`,{signal,json:true});answered++;for(const image of (art.images||[]).filter(x=>x.front).slice(0,1))out.push({image:String(image.thumbnails?.['500']||image.thumbnails?.large||image.image||'').replace(/^http:/,'https:'),title:release.title,artist:(release['artist-credit']||[]).map(x=>x.name||x.artist?.name||'').join(', '),source:'MusicBrainz / Cover Art Archive',page:`https://musicbrainz.org/release/${release.id}`});}catch(e){if(signal.aborted)throw abortError();if(e.status!==404)failure=e;else answered++;if(e.code==='SEARCH_RATE_LIMIT')break;}
    }if(!out.length&&!answered&&failure)throw failure;return out;
  }
  function cancel(id){for(const [key,c] of requests)if(!id||key===id||key.startsWith(id+':')){c.abort();requests.delete(key);for(const provider of M.IDS)search.cancel(`${key}:${provider}`);}return {ok:true};}
  async function find({query,phase='music',requestId,prefs}){
    query=M.text(query);if(query.length<2)return {ok:true,items:[]};const id=M.text(requestId,100)||crypto.randomUUID(),ctl=new AbortController();cancel(id);requests.set(id,ctl);
    const key=JSON.stringify([query,phase,phase==='music'?M.preferences(prefs):null]);
    try{let items;if(cache.get(key)?.until>clock())items=cache.get(key).items;else {items=await (phase==='catalog'?catalog(query,ctl.signal):music(query,ctl.signal,id,prefs));if(ctl.signal.aborted)throw abortError();cache.set(key,{items,until:clock()+10*60000});bound(cache,30);}return {ok:true,items:register(items)};}
    catch(error){return {ok:false,error:M.classifyError(error),items:[]};}finally{if(requests.get(id)===ctl)requests.delete(id);}
  }
  async function download(id,{signal}={}){const item=known.get(id);if(!item||item.until<clock())throw I.error('CoverExpired');return request(item.image,{signal});}
  return {find,download,cancel,request,dispose:()=>{cancel();known.clear();cache.clear();}};
}
module.exports={createCovers,imageURL,artworkKey};
