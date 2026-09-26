'use strict';
const crypto=require('node:crypto');
const M=require('../shared/online-search');
const {createHTTP,fail,abortError}=require('./http');
const {createProviders}=require('./providers');
/** Bounded, abortable queue. A superseded query releases both queued and active work. */
class Gate {
  constructor(limit){this.limit=limit;this.active=0;this.queue=[];}
  async run(fn,signal){
    if(signal?.aborted)throw abortError();
    await new Promise((resolve,reject)=>{
      const job={start:()=>{signal?.removeEventListener('abort',job.abort);this.active++;resolve();},abort:()=>{const i=this.queue.indexOf(job);if(i>=0)this.queue.splice(i,1);reject(abortError());}};
      if(this.active<this.limit)job.start();else {if(this.queue.length>=40)return reject(fail('SEARCH_BUSY'));this.queue.push(job);signal?.addEventListener('abort',job.abort,{once:true});}
    });
    try{if(signal?.aborted)throw abortError();return await fn();}finally{this.active--;this.queue.shift()?.start();}
  }
}
function bound(map,max){while(map.size>max)map.delete(map.keys().next().value);}
function createSearchService({fetch,providers,extractInfo,fallback,clock=Date.now}={}){
  const adapters=providers||createProviders(createHTTP(fetch));
  const requests=new Map(),cursors=new Map(),pages=new Map(),known=new Map(),checks=new Map(),info=new Map(),cooldowns=new Map();
  const searchGate=new Gate(3),probeGate=new Gate(2);let serial=0;
  function prune(){for(const map of [cursors,pages,known,checks,info])for(const [k,v] of map)if(v.until<clock())map.delete(k);}
  function cancel(group){for(const [id,r] of requests)if(!group||r.group===group){r.controller.abort();requests.delete(id);}return {ok:true};}
  async function withRequest(group,fn){if(requests.size>=64)throw fail('SEARCH_BUSY');const id=++serial,controller=new AbortController();requests.set(id,{group,controller});try{return await fn(controller.signal);}finally{requests.delete(id);}}
  async function page(c){
    const provider=String(c.provider||''),query=M.text(c.query),group=M.text(c.requestId,80);
    if(!M.IDS.includes(provider)||!M.parseQuery(query).valid)throw fail('SEARCH_BAD_QUERY');
    if(c.cursor&&(typeof c.cursor!=='string'||!/^\w{36}$/.test(c.cursor)))throw fail('SEARCH_BAD_CURSOR');
    prune();const key=JSON.stringify([provider,query,c.cursor||'']);
    if(c.retry!==true){const cached=pages.get(key);if(cached?.until>clock())return {...cached.result,cached:true};}
    if((cooldowns.get(provider)||0)>clock())throw fail('SEARCH_RATE_LIMIT',{retryAfter:Math.ceil((cooldowns.get(provider)-clock())/1000)});
    const continuation=c.cursor?cursors.get(String(c.cursor)):null;
    if(c.cursor&&(!continuation||continuation.provider!==provider||continuation.query!==query))throw fail('SEARCH_BAD_CURSOR');
    return withRequest(group,signal=>searchGate.run(async()=>{
      let data,via='public';
      try{if(continuation?.state?.extractorPage&&fallback){data=await fallback({provider,query,cursor:continuation.state,signal});via='extractor';if(!data)throw fail('SEARCH_TOOL');}else data=await adapters[provider]({query,cursor:continuation?.state||null,signal});}
      catch(error){
        const e=M.classifyError(error);if(e.code==='SEARCH_RATE_LIMIT')cooldowns.set(provider,clock()+Math.max(30,e.retryAfter||60)*1000);
        // No executable provisioning just to search. Never retry access gates with another client.
        if(fallback&&['SEARCH_ADAPTER'].includes(e.code)&&['ytmusic','youtube','soundcloud'].includes(provider)){
          data=await fallback({provider,query,cursor:continuation?.state,signal});if(!data)throw error;via='extractor';
        }else throw error;
      }
      if(signal.aborted)throw abortError();
      const prior=continuation?.seen||[],seen=new Set(prior),items=[];
      for(const [index,raw] of (Array.isArray(data?.items)?data.items:[]).slice(0,100).entries()){
        const item=M.normalizeItem(raw,provider,prior.length+index);if(!item||seen.has(item.key))continue;seen.add(item.key);items.push(item);
        known.set(item.key,{url:item.url,item,until:clock()+30*60000});
      }
      // Stop sources that repeat the same continuation or return only duplicate hits.
      const advances=data?.cursor&&JSON.stringify(data.cursor)!==JSON.stringify(continuation?.state);
      let next=null;if(advances&&(items.length||!prior.length)){
        next=crypto.randomBytes(18).toString('hex');cursors.set(next,{provider,query,state:data.cursor,seen:[...seen].slice(-10000),until:clock()+15*60000});
      }
      const result={ok:true,provider,items,cursor:next,exhausted:!next,via,cached:false};
      pages.set(key,{result,until:clock()+5*60000});bound(pages,90);bound(cursors,200);bound(known,4000);return result;
    },signal));
  }
  async function resolveLink(c){
    const url=M.safeURL(M.text(c.url,4096));
    let provider=M.IDS.find(id=>M.providerURL(url,id));if(!provider)throw fail('SEARCH_BAD_URL');
    const parsed=new URL(url);if(provider==='ytmusic'&&parsed.hostname!=='music.youtube.com')provider='youtube';if(provider==='soundcloud'&&/\/(?:sets|likes|reposts|albums)(?:\/|$)/.test(parsed.pathname))throw fail('SEARCH_BAD_URL');
    return withRequest(M.text(c.requestId,80),signal=>searchGate.run(async()=>{
      const metadata=info.get(M.canonicalURL(url));let meta=metadata?.until>clock()?metadata.value:await extractInfo?.(url,{signal,probe:true});
      if(signal.aborted)throw abortError();if(!meta)throw fail('SEARCH_TOOL');
      if(Array.isArray(meta.entries))throw fail('SEARCH_BAD_URL');
      const item=M.normalizeItem({...meta,url,title:meta.track||meta.title,thumbnail:meta.thumbnail||meta.thumbnails?.at(-1)?.url,availability:M.availabilityFromMetadata(meta)},provider,0);if(!item)throw fail('SEARCH_ADAPTER');
      known.set(item.key,{url,item,until:clock()+30*60000});bound(known,4000);info.set(item.key,{value:meta,until:clock()+60000});bound(info,24);
      const identity=require('../shared/lyrics-search').identity(item),query=[identity.artist,identity.title].filter(Boolean).join(' ').slice(0,300);
      return {ok:true,item,query};
    },signal));
  }
  async function probe(c){
    const key=M.canonicalURL(c.url),entry=known.get(key);if(!entry||entry.until<clock())throw fail('SEARCH_BAD_URL');
    const cached=checks.get(key);if(cached?.until>clock())return {ok:true,key,availability:cached.value};
    if(entry.item.availability.state==='blocked')return {ok:true,key,availability:entry.item.availability};
    return withRequest(M.text(c.requestId,80),signal=>probeGate.run(async()=>{
      let availability;
      try{
        const meta=await extractInfo?.(entry.url,{signal,probe:true});
        if(!meta)availability={state:'unknown',reason:'SEARCH_TOOL'};
        else {availability=M.availabilityFromMetadata(meta);info.set(key,{value:meta,until:clock()+60000});bound(info,24);}
      }catch(error){const e=M.classifyError(error);if(e.code==='SEARCH_CANCELLED')throw error;availability={state:['SEARCH_DRM','SEARCH_REMOVED'].includes(e.code)?'blocked':'unknown',reason:e.code};}
      availability.checkedAt=clock();checks.set(key,{value:availability,until:clock()+(availability.state==='unknown'?30000:180000)});bound(checks,1000);
      return {ok:true,key,availability};
    },signal));
  }
  async function command(c){
    if(!c||typeof c!=='object')return {ok:false,error:{code:'SEARCH_BAD_QUERY',retryable:false}};
    try{switch(c.type){case 'page':return await page(c);case 'resolve':return await resolveLink(c);case 'probe':return await probe(c);case 'cancel':return cancel(M.text(c.requestId,80));default:throw fail('SEARCH_BAD_QUERY');}}
    catch(error){return {ok:false,provider:M.IDS.includes(c.provider)?c.provider:undefined,error:M.classifyError(error)};}
  }
  return {command,cancel,cachedInfo:url=>{const v=info.get(M.canonicalURL(url));return v?.until>clock()?v.value:null;},stats:()=>({requests:requests.size,cursors:cursors.size,pages:pages.size,known:known.size,checks:checks.size,metadata:info.size,active:searchGate.active,probing:probeGate.active}),dispose:()=>{cancel();for(const m of [cursors,pages,known,checks,info,cooldowns])m.clear();}};
}
module.exports={createSearchService,Gate};
