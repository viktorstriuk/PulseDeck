'use strict';
const {classifyError}=require('../shared/online-search');
const ALLOWED=new Set(['www.youtube.com','youtube.com','music.youtube.com','soundcloud.com','www.soundcloud.com','api-v2.soundcloud.com','bandcamp.com','www.bandcamp.com','www.newgrounds.com','newgrounds.com','archive.org','www.archive.org']);
function fail(code,extra={}){return Object.assign(new Error(code),{code,...extra});}
function allowedURL(raw){
  let u;try{u=new URL(raw);}catch{throw fail('SEARCH_BAD_URL');}
  if(u.protocol!=='https:'||u.port&&u.port!=='443'||u.username||u.password)throw fail('SEARCH_BAD_URL');
  if(!ALLOWED.has(u.hostname)&&!/^a-v2\.sndcdn\.com$/.test(u.hostname))throw fail('SEARCH_BAD_URL');
  return u;
}
function abortError(){return Object.assign(new Error('SEARCH_CANCELLED'),{name:'AbortError',code:'SEARCH_CANCELLED'});}
function sleep(ms,signal){return new Promise((resolve,reject)=>{if(signal?.aborted)return reject(abortError());const abort=()=>{clearTimeout(timer);reject(abortError());};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});});}
/** Public metadata requests only. Electron's fetch honors system proxy/PAC.
 * No renderer-supplied hosts, cookies, executable scripts or credential forwarding.
 */
function createHTTP(fetchImpl){
  if(typeof fetchImpl!=='function')throw new TypeError('fetch implementation required');
  async function once(raw,{signal,method='GET',body,headers={},maxBytes=8*1024*1024,timeout=12000}={}) {
    const controller=new AbortController();let expired=false;
    const abort=()=>controller.abort();if(signal?.aborted)throw abortError();signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{expired=true;controller.abort();},timeout);
    let response;
    try {
      let url=allowedURL(raw).href;
      for(let hop=0;hop<=4;hop++){
        response=await fetchImpl(url,{method,body,headers:{Accept:'application/json,text/html;q=0.9,*/*;q=0.5','Accept-Language':'en-US,en;q=0.8',...headers},signal:controller.signal,credentials:'omit',redirect:'manual'});
        if([301,302,303,307,308].includes(response.status)) {
          const next=response.headers.get('location');await response.body?.cancel?.().catch(()=>{});
          if(!next)throw fail('SEARCH_NETWORK',{status:response.status});
          if(/consent\.(?:youtube|google)\.com/.test(next))throw fail('SEARCH_SIGN_IN');
          url=allowedURL(new URL(next,url).href).href;if(hop===4)throw fail('SEARCH_NETWORK');
          if(response.status===303){method='GET';body=undefined;}continue;
        }
        break;
      }
      if(!response.ok){
        const status=response.status,retry=response.headers.get('retry-after');await response.body?.cancel?.().catch(()=>{});
        const retryAfter=Number(retry)||Math.max(0,(Date.parse(retry)-Date.now())/1000)||60;
        throw fail(status===429?'SEARCH_RATE_LIMIT':status===403?'SEARCH_ACCESS':status===401?'SEARCH_SIGN_IN':'SEARCH_NETWORK',{status,retryAfter:Math.min(3600,Math.max(10,retryAfter))});
      }
      if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel?.();throw fail('SEARCH_RESPONSE_LIMIT');}
      let size=0;const chunks=[];
      if(response.body?.getReader){const reader=response.body.getReader();try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw fail('SEARCH_RESPONSE_LIMIT');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}}
      else {const b=Buffer.from(await response.arrayBuffer());if(b.length>maxBytes)throw fail('SEARCH_RESPONSE_LIMIT');chunks.push(b);}
      return Buffer.concat(chunks).toString('utf8');
    } catch(e) {if(signal?.aborted)throw abortError();if(expired)throw fail('SEARCH_TIMEOUT');if(e.code?.startsWith('SEARCH_'))throw e;throw fail(classifyError(e).code);}
    finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function text(url,opts={}){
    for(let attempt=0;;attempt++)try{return await once(url,opts);}catch(e){
      // No retry storms for 403/429, consent gates, parse errors or cancellation.
      if(attempt>=1||!['SEARCH_NETWORK','SEARCH_TIMEOUT'].includes(e.code)||e.status&&e.status<500)throw e;
      await sleep(350,opts.signal);
    }
  }
  async function json(url,opts={}){const raw=await text(url,opts);try{const data=JSON.parse(raw);if(data?.error)throw fail('SEARCH_ADAPTER',{status:Number(data.error?.code)||0});return data;}catch(e){if(e.code)throw e;throw fail('SEARCH_ADAPTER');}}
  return {text,json};
}
module.exports={createHTTP,allowedURL,fail,abortError,sleep};
