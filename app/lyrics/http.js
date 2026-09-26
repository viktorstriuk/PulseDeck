'use strict';
const I=require('../i18n');
/** Chromium transport keeps system proxy settings, without sharing cookies or
 * following a lyric service redirect to an arbitrary host. */
function createLyricsHTTP(fetch,version='2.9.2'){
  return async function request(raw,{signal,timeout=12000}={}){
    const url=new URL(raw);if(url.protocol!=='https:'||url.hostname!=='lrclib.net'||url.username||url.password||url.port||!url.pathname.startsWith('/api/'))throw I.error('LyricsCouldNotConnectToLRCLIBYouCanStill');
    const ctl=new AbortController(),abort=()=>ctl.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(abort,Math.min(25000,Math.max(500,timeout)));
    try{
      const response=await fetch(url.href,{signal:ctl.signal,credentials:'omit',redirect:'error',headers:{Accept:'application/json','User-Agent':`PulseDeck/${version} (https://github.com/viktorstriuk)`}});
      if(!response.ok){await response.body?.cancel?.();throw I.error(response.status===429?'LyricsLRCLIBHasRequestedADelayTrySearchingAgain':'LyricsServiceUnavailableHttp',{value1:response.status});}
      const limit=2*1024*1024;if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel?.();throw I.error('LyricsServiceResponseIsTooLarge');}
      let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>limit){ctl.abort();throw I.error('LyricsServiceResponseIsTooLarge');}chunks.push(Buffer.from(chunk));}
      try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw I.error('LyricsServiceReturnedAnInvalidResponse');}
    }catch(error){if(error.i18nKey)throw error;if(ctl.signal.aborted)throw I.error('LyricsSearchWasCancelledOrTimedOut');throw I.error('LyricsCouldNotConnectToLRCLIBYouCanStill');}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  };
}
module.exports={createLyricsHTTP};
