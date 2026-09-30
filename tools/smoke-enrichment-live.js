#!/usr/bin/env node
'use strict';
/** Explicit live-service smoke test. Sends only these public sample artist/title
 * queries; never opens a user's music/profile, writes tags, or downloads tools.
 * Usage: node tools/smoke-enrichment-live.js --live
 * Exit 0: both lookups succeeded for all samples; 1: misses; 2: network/service
 * failure (not by itself evidence of an application regression).
 */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createSearchService}=require('../app/online/service'),{createCovers}=require('../app/online/covers');
const {LyricsStore}=require('../app/lyrics/store'),{createLyricsHTTP}=require('../app/lyrics/http');
const {bestLyrics,coverCandidates}=require('../app/library/enrichment'),Images=require('../app/library/images');
const version=require('../app/package.json').version;
if(!process.argv.includes('--live')){console.error('This opt-in test contacts music services. Run with --live to consent.');process.exit(2);}
if(typeof fetch!=='function'){console.error('Node.js 22 or newer is required.');process.exit(2);}
const samples=[{artist:'Slipknot',title:'Unsainted'},{artist:'Noize MC',title:'Ругань из-за стены'},{artist:'Егор Летов',title:'Государство'}];
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pulsedeck-live-')),calls=[];
 const transport=async(url,options)=>{const start=Date.now();try{const signal=options?.signal?AbortSignal.any([options.signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000);const r=await fetch(url,{...options,signal});calls.push({host:new URL(url).host,status:r.status,ms:Date.now()-start});return r;}catch(error){calls.push({host:new URL(url).host,error:error.cause?.code||error.code||error.message,ms:Date.now()-start});throw error;}};
 const search=createSearchService({fetch:transport}),covers=createCovers({search,fetch:transport,version});
 const tracks=samples.map((sample,index)=>({...sample,duration:0,rel:index+'.wav'}));
 for(const track of tracks)fs.writeFileSync(path.join(directory,track.rel),'Synthetic identity file, not audio');
 const lyrics=new LyricsStore({music:directory,data:path.join(directory,'data'),listPublic:async()=>tracks,getVault:()=>({sessions:new Map()}),fetchJson:createLyricsHTTP(transport,version)});
 const report={version,at:new Date().toISOString(),kind:'LIVE - no application/profile writes',results:[],requests:calls};
 try{
  for(const track of tracks){
   console.error(`Looking up ${track.artist} / ${track.title}`);const row={artist:track.artist,title:track.title,cover:null,lyrics:null,errors:[]};report.results.push(row);
   let cursor;
   // Covers: actual public music search, then paged MusicBrainz/CAA fallback.
   for(const phase of ['music','catalog']){
    cursor=undefined;
    for(let page=0;page<3;page++){
     const result=await covers.find({query:track.artist+' '+track.title,track,phase,cursor,prefs:{enabled:['ytmusic','youtube','soundcloud','archive','bandcamp','newgrounds']},requestId:'smoke-'+track.rel});
     if(!result.ok)row.errors.push({where:phase,error:result.error});
     for(const {item} of coverCandidates(result.items,track)){
      try{const bytes=await covers.download(item.id),media=Images.describe(bytes);row.cover={source:item.source,title:item.title,artist:item.artist,type:media.type,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};break;}
      catch(error){row.errors.push({where:'cover-download',error:error.i18nKey||error.code||error.message});}
     }
     cursor=result.cursor;if(row.cover||!cursor||result.partial)break;
    }
    if(row.cover)break;
   }
   try{const results=await lyrics.search({rel:track.rel,consent:true,background:true}),selected=bestLyrics(results,track);row.lyrics={candidates:results.length,selected:selected?{id:selected.id,title:selected.title,artist:selected.artist,duration:selected.duration,timedLines:selected.synced.split('\n').filter(line=>/^\[\d+:\d+/.test(line)).length}:null};}
   catch(error){row.errors.push({where:'lyrics',error:error.i18nKey||error.code||error.message});}
  }
  report.success=report.results.every(row=>row.cover&&row.lyrics?.selected);
  console.log(JSON.stringify(report,null,2));process.exitCode=report.success?0:calls.some(r=>r.error||r.status>=400)?2:1;
 }finally{lyrics.dispose();covers.dispose();search.dispose();fs.rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=2;});
