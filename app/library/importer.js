'use strict';
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const Archives=require('./archives'),Fields=require('../shared/track-enrichment'),Lyrics=require('../shared/lyrics');
const {extractMetadata}=require('../metadata'),{regular}=require('./editor');const I=require('../i18n');
const fail=key=>I.error(key),inside=(base,file)=>{const rel=path.relative(base,file);return !rel||!rel.startsWith('..')&&!path.isAbsolute(rel);};
const copyFields=meta=>Object.fromEntries(['title','artist','album','genre','duration','sourceUrl','downloaded','extractor'].filter(k=>typeof meta[k]==='string'||typeof meta[k]==='number'||typeof meta[k]==='boolean').map(k=>[k,meta[k]]));
const extensions=/\.(?:zip|tar|tar\.gz|tgz)$/i,unsupported=/\.(?:rar|7z|bz2|xz)$/i;
async function localLyrics(file,duration,embedded=''){
  const stem=file.slice(0,-path.extname(file).length),candidates=[file+'.lyrics.json',stem+'.lyrics.json',file+'.lrc',stem+'.lrc',stem+'.txt'];
  for(const candidate of candidates)try{await regular(candidate,2*1024*1024);const parsed=Lyrics.parse(await fsp.readFile(candidate,'utf8'),{kind:path.extname(candidate).slice(1),durationMs:duration*1000});if(parsed.doc)return parsed.doc;}catch{}
  if(embedded)try{return Lyrics.parse(embedded,{durationMs:duration*1000}).doc;}catch{}return null;
}
class Importer{
  constructor(options){Object.assign(this,options);this.plans=new Map();this.requests=new Map();this.committing=false;}
  cancel(requestId){this.requests.get(requestId)?.abort();return {ok:true};}
  async discard(token){const p=this.plans.get(token);if(!p||p.committing)return {ok:false};this.plans.delete(token);await fsp.rm(p.directory,{recursive:true,force:true});return {ok:true};}
  async prepare(paths,{requestId=crypto.randomUUID()}={}){
    if(this.requests.size||this.committing)throw fail('ImportBusy');if(!Array.isArray(paths)||!paths.length||paths.length>2000||paths.some(p=>typeof p!=='string'||!path.isAbsolute(p)))throw fail('ImportInvalidFiles');
    // Only tokens created in this process can be committed. Older abandoned
    // staging directories are data, never executable or imported automatically.
    await fsp.mkdir(this.staging,{recursive:true});for(const e of await fsp.readdir(this.staging,{withFileTypes:true})){if(!e.isDirectory()||!/^import-[a-f0-9]{32}$/.test(e.name))continue;const d=path.join(this.staging,e.name),s=await fsp.lstat(d);if(Date.now()-s.mtimeMs>86400000)await fsp.rm(d,{recursive:true,force:true});}
    for(const [token,p]of this.plans)if(Date.now()-p.at>30*60000)await this.discard(token);
    if(this.plans.size>=3)throw fail('ImportBusy');
    const ctl=new AbortController(),token=crypto.randomBytes(16).toString('hex'),directory=path.join(this.staging,'import-'+token),tracks=[],warnings=[],seen=new Set();this.requests.set(requestId,ctl);await fsp.mkdir(directory,{recursive:true,mode:0o700});
    let visited=0,total=0,pack=0,skipped=0;const sourceFiles=[];
    const progress=()=>this.progress({phase:'scan',requestId,found:sourceFiles.length,visited});
    const check=()=>{if(ctl.signal.aborted)throw fail('ImportCancelled');if(++visited>20000)throw fail('ImportArchiveLimit');};
    const walk=async(file,depth=0,root=path.dirname(file),archive=false)=>{check();if(depth>32)throw fail('ImportArchiveLimit');
      const st=await fsp.lstat(file);if(st.isSymbolicLink()){warnings.push({name:path.basename(file),code:'ImportSkippedLink'});return;}
      if(st.isDirectory()){if(fs.existsSync(path.join(file,'.pulsedeck-vault'))){warnings.push({name:path.basename(file),code:'ImportSkippedPrivate'});return;}for(const e of await fsp.readdir(file,{withFileTypes:true})){if(e.name.startsWith('.')||e.name==='__MACOSX')continue;await walk(path.join(file,e.name),depth+1,root,archive);}return;}
      if(!st.isFile())return;const real=await fsp.realpath(file);if(seen.has(real))return;seen.add(real);
      if(Archives.MEDIA.has(path.extname(file).toLowerCase())){if(inside(this.music,real)){skipped++;return;}if(!st.size)return;if(st.size>Archives.LIMITS.file||(total+=st.size)>Archives.LIMITS.total||sourceFiles.length>=2000)throw fail('ImportArchiveLimit');sourceFiles.push({file,root,size:st.size,mtime:st.mtimeMs,ctime:st.ctimeMs});if(sourceFiles.length%20===0)progress();return;}
      if(!archive&&extensions.test(file)){if(st.size>Archives.LIMITS.archive)throw fail('ImportArchiveLimit');const target=path.join(directory,'archive-'+(++pack)),checkpoint=sourceFiles.length,beforeTotal=total;await fsp.mkdir(target);try{await Archives.extract(file,target,{signal:ctl.signal});await walk(target,depth+1,target,true);}catch(e){if(ctl.signal.aborted)throw e;sourceFiles.splice(checkpoint);total=beforeTotal;await fsp.rm(target,{recursive:true,force:true});warnings.push({name:path.basename(file),code:e.i18nKey||'ImportBadArchive'});}return;}
      if(unsupported.test(file))warnings.push({name:path.basename(file),code:'ImportArchiveUnsupported'});
    };
    try{
      for(const p of paths){const st=await fsp.lstat(p);await walk(p,0,st.isDirectory()?p:path.dirname(p));}progress();
      const counts={artists:0,covers:0,lyrics:0};
      for(const source of sourceFiles){check();const meta=await extractMetadata(source.file,path.join(directory,'covers'),await fsp.stat(source.file));
        // Ignore absolute external cover paths supplied by imported sidecar JSON.
        if(meta.coverPath){const real=await fsp.realpath(meta.coverPath).catch(()=>null);if(!real||!inside(source.root,real)&&!inside(directory,real))meta.coverPath='';}
        if(!meta.duration&&this.duration)meta.duration=await this.duration(source.file).catch(()=>0);
        const doc=await localLyrics(source.file,Number(meta.duration)||0,meta.embeddedLyrics),track={...copyFields(meta),rel:path.basename(source.file),coverUrl:meta.coverPath||''};
        const needs=Fields.needs(track,{doc});for(const key of Fields.actions(Object.fromEntries(Object.entries(needs).map(([k,v])=>[k,v?1:0]))))counts[key]++;
        const inspected=await fsp.stat(source.file);if(inspected.size!==source.size||inspected.mtimeMs!==source.mtime||inspected.ctimeMs!==source.ctime)throw fail('ImportSourceChanged');
        tracks.push({...source,meta:copyFields(meta),cover:meta.coverPath||'',doc});
        this.progress({phase:'inspect',requestId,done:tracks.length,total:sourceFiles.length});
      }
      const plan={token,directory,tracks,counts,warnings,skipped,at:Date.now()};this.plans.set(token,plan);
      return {ok:true,token,count:tracks.length,bytes:total,counts,warnings:warnings.slice(0,30),warningCount:warnings.length,skipped,target:path.basename(this.music),names:tracks.slice(0,5).map(t=>t.meta.title||path.basename(t.file))};
    }catch(error){await fsp.rm(directory,{recursive:true,force:true});throw error;}
    finally{this.requests.delete(requestId);}
  }
  async commit(token,{signal,onProgress=()=>{}}={}){
    const p=this.plans.get(token);if(!p||Date.now()-p.at>30*60000)throw fail('ImportExpired');if(p.committing||this.committing)throw fail('ImportBusy');p.committing=this.committing=true;
    const rels=[],errors=[];
    try{
      for(const [index,item]of p.tracks.entries()){
        if(signal?.aborted)break;let published;
        try{
          const st=await regular(item.file,Archives.LIMITS.file);if(st.size!==item.size||st.mtimeMs!==item.mtime||st.ctimeMs!==item.ctime)throw fail('ImportSourceChanged');
          const meta={...item.meta};if(item.cover)try{meta.coverPath=await this.storeCover(item.cover);}catch{/* Invalid artwork does not discard playable audio. */}
          published=await this.publish(item.file,meta);const rel=path.relative(this.music,published).split(path.sep).join('/');rels.push(rel);
          if(item.doc)try{await fsp.writeFile(published+'.lyrics.json',JSON.stringify(item.doc,null,2),{flag:'wx'});}catch(e){errors.push({name:path.basename(item.file),code:'ImportLyricsCopyFailed'});}
        }catch(e){errors.push({name:path.basename(item.file),code:e.i18nKey||'ImportCopyFailed'});}
        onProgress({phase:'copy',done:index+1,total:p.tracks.length,added:rels.length,failed:errors.length,title:item.meta.title||path.basename(item.file)});
      }
      this.notify();return {ok:true,rels,added:rels.length,failed:errors.length,errors,cancelled:!!signal?.aborted};
    }finally{p.committing=false;this.committing=false;await this.discard(token);}
  }
  async dispose(){for(const ctl of this.requests.values())ctl.abort();for(const [id]of this.plans)await this.discard(id);}
}
module.exports={Importer,localLyrics,inside,copyFields};
