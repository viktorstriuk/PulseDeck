'use strict';
const fs=require('node:fs');const path=require('node:path');const M=require('../shared/online-search');
const DAY=86400000,MAX=2000;
const key=t=>String(t?.rel||t?.relativePath||t?.id||'');
const artist=t=>M.fold(t.artist||t.creator||'');
function recommend(tracks,records,now=Date.now(),dismissed=[]){
  const allowed=tracks.filter(t=>!t.private&&!t.vaultId&&!t.vaultKey&&!t.protected),byKey=new Map(allowed.map(t=>[key(t),t])),artists=new Map(),genres=new Map(),albums=new Map();
  for(const [id,s] of Object.entries(records)){
    const t=byKey.get(id);if(!t)continue;const age=(now-Number(s.last||0))/DAY;if(age>180)continue;
    const weight=Math.log1p(Number(s.seconds||0)/60)*Math.exp(-Math.max(0,age)/14)/(1+Number(s.skips||0)*.18);
    if(artist(t))artists.set(artist(t),(artists.get(artist(t))||0)+weight);
    if(M.fold(t.genre))genres.set(M.fold(t.genre),(genres.get(M.fold(t.genre))||0)+weight*.6);
    if(M.fold(t.album))albums.set(M.fold(t.album),(albums.get(M.fold(t.album))||0)+weight*.35);
  }
  const candidates=allowed.filter(t=>!dismissed.includes(key(t))).map(t=>{
    const s=records[key(t)]||{},a=artists.get(artist(t))||0,g=genres.get(M.fold(t.genre))||0,b=albums.get(M.fold(t.album))||0;
    let score=a+g+b+(t.favorite?1.2:0);if(s.last)score/=1+3*Math.exp(-(now-s.last)/(2*DAY));score/=1+(s.skips||0)*.12;
    return {track:t,score,reason:a?'DiscoveryBecauseArtist':g?'DiscoveryBecauseGenre':b?'DiscoveryBecauseAlbum':'DiscoveryFromLibrary',value:a?t.artist:g?t.genre:b?t.album:'',heard:!!s.last};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||key(a.track).localeCompare(key(b.track)));
  const result=[],counts=new Map();for(const c of candidates){const a=artist(c.track)||key(c.track);if((counts.get(a)||0)>=2)continue;counts.set(a,(counts.get(a)||0)+1);result.push(c);if(result.length>=12)break;}return result;
}
class DiscoveryStore {
  constructor(file,{clock=Date.now}={}){this.file=file;this.clock=clock;this.revision=0;this.data={schema:1,enabled:false,records:{},dismissed:[]};this.buckets=new Map();try{const s=fs.statSync(file);if(s.size<2*1024*1024){const d=JSON.parse(fs.readFileSync(file,'utf8'));if(d.schema===1&&d.records&&typeof d.records==='object'&&!Array.isArray(d.records))this.data={schema:1,enabled:d.enabled===true,records:d.records,dismissed:Array.isArray(d.dismissed)?d.dismissed.slice(0,200):[]};}}catch{}this.prune();}
  prune(){const list=Object.entries(this.data.records).filter(([k,s])=>k&&s&&Number.isFinite(s.last)&&s.last>this.clock()-180*DAY).sort((a,b)=>b[1].last-a[1].last).slice(0,MAX);this.data.records=Object.fromEntries(list);}
  save(){this.prune();fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.data),{mode:0o600});fs.renameSync(temp,this.file);}
  status(){return {ok:true,enabled:this.data.enabled,count:Object.keys(this.data.records).length,retentionDays:180};}
  configure(enabled){this.revision++;this.data.enabled=enabled===true;this.buckets.clear();this.save();return this.status();}
  clear(){this.revision++;this.data.records={};this.data.dismissed=[];this.buckets.clear();this.save();return this.status();}
  dismiss(id){this.data.dismissed=[...new Set([...this.data.dismissed,String(id)])].slice(-200);this.save();return this.status();}
  record(track,command){
    if(!this.data.enabled||!track||track.private||track.vaultId||track.vaultKey||track.protected)return {ok:true,recorded:false};
    const id=key(track);if(!id)return {ok:true,recorded:false};const now=this.clock(),old=this.buckets.get(id);
    // Main-process token bucket limits spoofed/duplicate renderer heartbeats to wall time.
    const budget=Math.min(35,(old?Math.max(0,(now-old.at)/1000):30)+(old?.remaining||0));
    const seconds=Math.min(budget,30,Math.max(0,Number(command.seconds)||0));this.buckets.set(id,{at:now,remaining:budget-seconds});if(this.buckets.size>40)this.buckets.delete(this.buckets.keys().next().value);
    if(seconds<1)return {ok:true,recorded:false};const s=this.data.records[id]||{seconds:0,plays:0,skips:0,last:now};
    s.seconds=Math.min(1e8,s.seconds+seconds);s.last=now;if(command.completed)s.plays=Math.min(1e5,s.plays+1);if(command.skipped)s.skips=Math.min(1e5,s.skips+1);this.data.records[id]=s;this.save();return {ok:true,recorded:true};
  }
  recommendations(tracks){return { ...this.status(),items:this.data.enabled?recommend(tracks,this.data.records,this.clock(),this.data.dismissed):[]};}
}
module.exports={DiscoveryStore,recommend,key};
