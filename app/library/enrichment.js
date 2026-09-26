'use strict';
const crypto=require('node:crypto');
const F=require('../shared/track-enrichment'),L=require('../shared/lyrics'),Search=require('../shared/lyrics-search');
const {sleep}=require('../online/http');const I=require('../i18n');
const fail=code=>I.error(code);
function textOf(doc){return (doc?.lines||[]).map(l=>l.text||(l.segments||[]).map(s=>s.text).join('')).join(' ').replace(/[^\p{L}\p{N}]+/gu,' ').toLowerCase().trim();}
function bestLyrics(items,track){const q=Search.identity(track);if(!(track.duration>0)||F.unknown(q.artist))return null;
  return (items||[]).filter(x=>x.synced&&!x.instrumental&&!x.variantMismatch&&x.matchScore>=92&&x.delta!==null&&x.delta<=Math.max(2,Math.min(4,track.duration*.01))&&Search.similarity(x.title,q.title)>=.9&&Search.similarity(x.artist,q.artist)>=.86).sort((a,b)=>a.delta-b.delta||b.matchScore-a.matchScore)[0]||null;
}
function bestCover(items,track){const q=Search.identity(track);if(F.unknown(q.artist))return null;return (items||[]).map(item=>{const other=Search.identity(item),title=Search.similarity(other.title,q.title),artist=Search.similarity(other.artist,q.artist),album=track.album?Search.similarity(item.title,track.album):0;return {item,score:Math.max(title,album)*.7+artist*.3,title:Math.max(title,album),artist};}).filter(x=>x.title>=.9&&x.artist>=.84).sort((a,b)=>b.score-a.score)[0]?.item||null;}
class Enrichment{
  constructor(options){Object.assign(this,options);this.active=null;this.capCache=new Map();this.capRequests=new Map();}
  invalidate(rel){if(rel)this.capCache.delete(rel);else this.capCache.clear();}
  async tracks(rels){if(!Array.isArray(rels)||!rels.length||rels.length>2000||rels.some(x=>typeof x!=='string'||x.length>4000))throw fail('TrackUnavailable');const result=[];for(const rel of [...new Set(rels)])try{result.push((await this.editor.resolve(rel)).track);}catch{}return result;}
  async capabilities(rels,options={}){return this.editor.withSnapshot?this.editor.withSnapshot(()=>this.capabilitiesInner(rels,options)):this.capabilitiesInner(rels,options);}
  async capabilitiesInner(rels,{requestId=''}={}){
    const ctl=new AbortController();if(requestId){this.capRequests.get(requestId)?.abort();this.capRequests.set(requestId,ctl);}const counts={artists:0,covers:0,lyrics:0};let total=0;
    try{for(const track of await this.tracks(rels)){if(ctl.signal.aborted)break;const identity=JSON.stringify([track.size,track.modifiedAt,track.editRevision,track.title,track.artist,track.coverUrl]),cached=this.capCache.get(track.rel);let data=cached?.key===identity&&Date.now()-cached.at<10000?cached.value:null;
        if(!data){try{const lyrics=await this.lyrics().get(track.rel);data=F.needs(track,lyrics);}catch{data={artists:!!F.splitName(track),covers:!track.coverUrl,lyrics:false};}this.capCache.set(track.rel,{key:identity,value:data,at:Date.now()});if(this.capCache.size>2000)this.capCache.delete(this.capCache.keys().next().value);}
        for(const action of F.ACTIONS||['artists','covers','lyrics'])if(data[action])counts[action]++;total++;}
      return {ok:true,total,counts,actions:F.actions(counts)};
    }finally{if(this.capRequests.get(requestId)===ctl)this.capRequests.delete(requestId);}
  }
  cancelCapabilities(id){this.capRequests.get(id)?.abort();return {ok:true};}
  cancel(id){if(this.active&&(!id||id===this.active.id))this.active.controller.abort();return {ok:true};}
  emit(job,extra={}){const payload={id:job.id,phase:job.phase,done:job.done,total:job.total,changed:job.changed,skipped:job.skipped,failed:job.failed,...extra};job.last=payload;this.lastJob=payload;this.progress(payload);}
  start(command){
    if(this.active)throw fail('EnrichBusy');const actions=F.actions(Object.fromEntries((Array.isArray(command.actions)?command.actions:[]).filter(k=>F.ACTIONS.includes(k)).map(k=>[k,1])));
    if(actions.some(k=>k!=='artists')&&command.consent!==true)throw fail('EnrichConsent');
    if(!command.token&&(!Array.isArray(command.rels)||!command.rels.length||command.rels.length>2000))throw fail('TrackUnavailable');
    const job={id:crypto.randomUUID(),controller:new AbortController(),phase:'prepare',done:0,total:0,changed:0,skipped:0,failed:0,private:(command.rels||[]).some(r=>String(r).startsWith('vault:'))};this.active=job;job.controller.signal.addEventListener('abort',()=>this.covers.cancel(`batch-${job.id}`),{once:true});
    job.promise=(this.editor.withSnapshot?this.editor.withSnapshot(()=>this.run(job,command,actions)):this.run(job,command,actions)).catch(error=>{job.failed++;this.emit(job,{phase:'error',error:error.i18nKey||'EnrichFailed'});}).finally(()=>{if(this.active===job)this.active=null;this.invalidate();this.notify();});return {ok:true,id:job.id};
  }
  async run(job,command,actions){
    let rels=command.rels||[],importResult=null;const signal=job.controller.signal;
    if(command.token){importResult=await this.importer.commit(command.token,{signal,onProgress:p=>this.emit(job,p)});rels=importResult.rels;job.failed+=importResult.failed;}
    const tracks=signal.aborted?[]:await this.tracks(rels);job.total=tracks.length*actions.length;job.phase='enrich';this.emit(job,{added:importResult?.added||0});
    for(const snapshot of tracks){for(const action of actions){if(signal.aborted)break;let status='skipped',reason='EnrichNoMatch';
        try{const r=await this.editor.resolve(snapshot.rel),track=r.track;if(signal.aborted)break;
          if(action==='artists'){const patch=F.splitName(track);if(patch){const result=await this.editor.update(track.rel,patch,{revision:r.revision,automatic:true});status=result.skipped?'skipped':'changed';}else reason='EnrichAlreadyComplete';}
          else if(action==='covers'){
            if(track.coverUrl||r.entry?.cover)reason='EnrichAlreadyComplete';else{
              const identity=Search.identity(track),query=[identity.artist,identity.title].filter(Boolean).join(' ');let result=await this.covers.find({query,phase:'music',requestId:`batch-${job.id}`,prefs:this.preferences()});
              let chosen=bestCover(result.items,track);if(!chosen&&!signal.aborted){result=await this.covers.find({query:[identity.artist,track.album||identity.title].join(' '),phase:'catalog',requestId:`batch-${job.id}`,prefs:this.preferences()});chosen=bestCover(result.items,track);}
              if(signal.aborted)break;if(chosen){const buffer=await this.covers.download(chosen.id,{signal});if(signal.aborted)break;const saved=await this.editor.update(track.rel,{}, {coverBuffer:this.sanitize(buffer),revision:r.revision,onlyMissingCover:true});status=saved.skipped?'skipped':'changed';}
              else if(!result.ok)throw fail('EnrichSourceFailed');
            }
          }else if(action==='lyrics'){
            const current=await this.lyrics().get(track.rel);if(F.hasSynced(current.doc)||current.suppressed)reason='EnrichAlreadyComplete';else{
              if(!track.duration&&this.duration)track.duration=await this.duration(track.rel,true).catch(()=>0);
              const items=await this.lyrics().search({rel:track.rel,consent:true,duration:track.duration,background:true,signal}),chosen=bestLyrics(items,track);if(signal.aborted)break;
              if(chosen){const doc=L.parse(chosen.synced,{kind:'lrc',durationMs:track.duration*1000}).doc;
                if(current.doc&&textOf(current.doc)!==textOf(doc))reason='EnrichPreservedText';else if(F.hasSynced(doc)){
                  const latest=await this.lyrics().get(track.rel);if(latest.revision!==current.revision||F.hasSynced(latest.doc)||latest.suppressed||textOf(latest.doc)!==textOf(current.doc))reason='EnrichAlreadyComplete';else {await this.vault().exclusive(async()=>{const fresh=await this.editor.resolve(track.rel);if(fresh.revision!==r.revision||fresh.track.title!==track.title||fresh.track.artist!==track.artist)throw fail('TrackChanged');return this.lyrics().save({rel:track.rel,doc,revision:current.revision,theme:current.theme,timing:current.timing});});status='changed';}
                }
              }
            }
          }
        }catch(error){if(signal.aborted)break;status='failed';reason=error.i18nKey||'EnrichSourceFailed';}
        job.done++;job[status]++;this.invalidate(snapshot.rel);this.emit(job,{action,status,reason,title:snapshot.title,added:importResult?.added||0});
        if(action!=='artists')await sleep(250,signal).catch(()=>{});
      }if(signal.aborted)break;}
    this.covers.cancel(`batch-${job.id}`);this.emit(job,{phase:'complete',cancelled:signal.aborted,added:importResult?.added||0,errors:importResult?.errors||[]});
  }
  dispose(){this.cancel();for(const ctl of this.capRequests.values())ctl.abort();this.capCache.clear();}
}
module.exports={Enrichment,bestLyrics,bestCover,textOf};
