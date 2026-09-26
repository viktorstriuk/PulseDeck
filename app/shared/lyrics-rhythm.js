'use strict';
// Acoustic draft, NOT speech recognition or lyrics/audio forced alignment.
// Onsets and mid-band activity guide a weighted draft; vocals are not guaranteed.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PulseLyricsRhythm=api;})(globalThis,()=>{
  const I18n = typeof module === 'object' && module.exports ? require('../i18n') : globalThis.PulseI18n;

  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function quantile(values,p){if(!values.length)return 0;const a=[...values].sort((x,y)=>x-y);return a[Math.floor((a.length-1)*p)];}
  function fft(real){const n=real.length,r=Float64Array.from(real),im=new Float64Array(n);
    for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j)[r[i],r[j]]=[r[j],r[i]];}
    for(let len=2;len<=n;len<<=1){const angle=-2*Math.PI/len;for(let i=0;i<n;i+=len)for(let j=0;j<len/2;j++){
      const c=Math.cos(j*angle),s=Math.sin(j*angle),k=i+j+len/2,a=r[k]*c-im[k]*s,b=r[k]*s+im[k]*c;
      r[k]=r[i+j]-a;im[k]=im[i+j]-b;r[i+j]+=a;im[i+j]+=b;
    }}return Array.from({length:n/2},(_,i)=>Math.hypot(r[i],im[i]));
  }
  class Extractor{
    constructor(){this.rate=16000;this.size=512;this.hop=320;this.tail=new Float32Array(0);this.frames=[];this.previous=null;this.samples=0;this.byteTail=Buffer.alloc(0);}
    feed(bytes){let b=this.byteTail.length?Buffer.concat([this.byteTail,Buffer.from(bytes)]):Buffer.from(bytes);const usable=b.length-b.length%4;this.byteTail=Buffer.from(b.subarray(usable));
      const values=new Float32Array(usable/4);for(let i=0;i<values.length;i++)values[i]=b.readFloatLE(i*4);
      const data=new Float32Array(this.tail.length+values.length);data.set(this.tail);data.set(values,this.tail.length);let i=0;
      for(;i+this.size<=data.length;i+=this.hop){if(this.frames.length>=90000)throw I18n.error("LyricsAnalysisSupportsRecordingsUpToMinutesLong");
        const window=new Float64Array(this.size);let rms=0;for(let j=0;j<this.size;j++){const v=Number.isFinite(data[i+j])?data[i+j]:0;rms+=v*v;window[j]=v*(.5-.5*Math.cos(2*Math.PI*j/(this.size-1)));}
        const spectrum=fft(window);let total=0,mid=0,flux=0,log=0,sum=0,n=0,peak=0;
        spectrum.forEach((v,k)=>{const hz=k*this.rate/this.size;total+=v*v;if(hz>=180&&hz<=3500){mid+=v*v;log+=Math.log(v+1e-9);sum+=v;n++;peak=Math.max(peak,v);}if(this.previous)flux+=Math.max(0,v-this.previous[k]);});
        const flatness=n?Math.exp(log/n)/(sum/n+1e-9):1;
        this.frames.push({timeMs:Math.round(this.samples/this.rate*1000),rms:Math.sqrt(rms/this.size),flux,mid:mid/(total+1e-9),tonal:clamp(1-flatness,0,1)});this.previous=spectrum;this.samples+=this.hop;
      }this.tail=data.slice(i);
    }
    finish(){return summarize(this.frames,Math.round((this.samples+this.tail.length)/this.rate*1000));}
  }
  function summarize(frames,durationMs){
    if(!frames.length)throw I18n.error("LyricsNotEnoughAudioToAnalyse");
    const loud=quantile(frames.map(f=>f.rms),.9),threshold=Math.max(.0005,loud*.055);
    if(loud<.0005)throw I18n.error("LyricsRecordingIsNearlySilentNoDraftTimingsWere");
    const peak=quantile(frames.map(f=>f.flux),.85),activity=[],onsets=[];
    let start=null,last=null;
    for(let i=0;i<frames.length;i++){
      const f=frames[i],audible=f.rms>threshold;
      // This score estimates sustained voice-band energy, not a recognized singer.
      const weight=audible?clamp(.2+.55*f.mid+.25*f.tonal,.2,1):0;
      activity.push(weight);
      if(audible){if(start===null)start=f.timeMs;last=f.timeMs+32;}
      if(start!==null&&(!audible&&f.timeMs-last>600||i===frames.length-1)){start=null;}
      if(f.flux>peak&&f.flux>(frames[i-1]?.flux||0)&&f.flux>=(frames[i+1]?.flux||0)&&f.rms>threshold&&f.timeMs-(onsets.at(-1)||-1000)>120)onsets.push(f.timeMs);
    }
    // Retain only broad silence gaps, avoiding tiny holes inside a syllable.
    const regions=[];start=null;last=null;
    for(let i=0;i<frames.length;i++){const f=frames[i];if(activity[i]){if(start===null)start=f.timeMs;last=Math.min(durationMs,f.timeMs+32);}if(start!==null&&((!activity[i]&&f.timeMs-last>600)||i===frames.length-1)){if(last-start>=180)regions.push([start,last]);start=null;}}
    const envelope=frames.map(f=>Math.max(0,f.flux-peak*.3));let best=0,bestLag=0;
    for(let lag=17;lag<=60;lag++){let score=0,norm=0;for(let i=lag;i<envelope.length;i++){score+=envelope[i]*envelope[i-lag];norm+=envelope[i]**2;}score=score/(norm||1);if(score>best){best=score;bestLag=lag;}}
    const tempo=best>.15?Math.round(60000/(bestLag*20)):null;
    const buckets=Math.min(1200,frames.length),wave=[];for(let i=0;i<buckets;i++){const a=Math.floor(i*frames.length/buckets),b=Math.max(a+1,Math.floor((i+1)*frames.length/buckets));let top=0;for(let j=a;j<b;j++)top=Math.max(top,frames[j].rms);wave.push(Math.round(clamp(top/loud,0,1)*1000)/1000);}
    return {durationMs,hopMs:20,activity:activity.map(x=>Math.round(x*100)/100),regions,onsets,tempo,beatConfidence:Math.round(best*100)/100,wave,method:'acoustic-draft-v1',warning:I18n.t("LyricsDraftBasedOnRhythmAndAudioActivityThis")};
  }
  function weight(text){return Math.max(1,(String(text).match(/[aeiouyаеёиоуыэюя]/gi)||[]).length);}
  function draft(doc,analysis,{startMs=0,endMs=analysis.durationMs,keepExisting=true}={}){
    const out=JSON.parse(JSON.stringify(doc));const offset=Number(out.offsetMs)||0;
    // Work on the media clock, not raw cue times. Keep the user's offset unchanged.
    for(const row of out.lines){for(const key of ['startMs','endMs'])if(row[key]!=null)row[key]+=offset;for(const part of row.segments||[])if(part.startMs!=null)part.startMs+=offset;}
    startMs=Math.max(0,offset,Math.round(startMs));endMs=Math.min(analysis.durationMs,Math.round(endMs));if(endMs-startMs<500)throw I18n.error("LyricsSelectALongerSectionOfTheSong");
    const rows=out.lines.map((r,i)=>({r,i})).filter(({r})=>(r.kind==='interlude'&&r.startMs!=null)||(r.kind!=='interlude'&&(r.text||r.segments?.map(s=>s.text).join('')||'').trim()));if(!rows.some(({r})=>r.kind!=='interlude'))throw I18n.error("LyricsAddLyricsFirst");
    const excluded=out.lines.filter(r=>r.kind==='interlude'&&r.startMs!=null).map(r=>[r.startMs,r.endMs??out.lines.find(n=>n.startMs>r.startMs)?.startMs??endMs]);
    const anchors=[{pos:-1,time:startMs}];for(let pos=0;pos<rows.length;pos++){const r=rows[pos].r;if(r.startMs!=null&&(keepExisting||r.kind==='interlude'))anchors.push({pos,time:r.startMs});}anchors.push({pos:rows.length,time:endMs});
    if(anchors.some((a,i)=>i&&a.time<anchors[i-1].time))throw I18n.error("LyricsExistingTimestampsAreOutOfOrderFixThem");
    let count=0;
    for(let k=0;k<anchors.length-1;k++){
      const a=anchors[k],b=anchors[k+1],targets=rows.slice(a.pos+1,b.pos).filter(({r})=>r.kind!=='interlude');if(!targets.length)continue;
      // Reserve space for the already timed preceding line when filling a hole.
      const lower=a.pos>=0?(rows[a.pos].r.kind==='interlude'?(excluded.find(([x])=>x===a.time)?.[1]??a.time):(rows[a.pos].r.endMs??Math.min(b.time,a.time+Math.min(1600,(b.time-a.time)/(targets.length+1))))):a.time;
      const samples=[];let mass=0;for(let n=Math.ceil(lower/analysis.hopMs);n<analysis.activity.length&&n*analysis.hopMs<b.time;n++){
        const t=n*analysis.hopMs;if(excluded.some(([x,y])=>t>=x&&t<y))continue;const value=analysis.activity[n];if(value>0){mass+=value;samples.push({time:t,mass});}}
      if(!samples.length||b.time-lower<targets.length*80)throw I18n.error("LyricsSelectedRangeContainsTooLittleAudioForAll");
      const weights=targets.map(({r})=>weight(r.text||r.segments?.map(s=>s.text).join(''))),total=weights.reduce((s,x)=>s+x,0);let used=0,lastTime=lower-1;
      for(let j=0;j<targets.length;j++){const target=mass*used/total;let lo=0,hi=samples.length-1;while(lo<hi){const m=(lo+hi)>>1;if(samples[m].mass<target)lo=m+1;else hi=m;}
        let t=samples[lo].time;const nearby=analysis.onsets.filter(x=>Math.abs(x-t)<=180&&x>=lower&&x>lastTime&&x<b.time&&!excluded.some(([a,z])=>x>=a&&x<z));if(nearby.length)t=nearby.reduce((x,y)=>Math.abs(y-t)<Math.abs(x-t)?y:x);
        t=Math.max(lastTime+1,t);if(t>=b.time)throw I18n.error("LyricsCouldNotPlaceAllLinesIncreaseTheRange");
        const row=targets[j].r;row.text=row.text||row.segments?.map(s=>s.text).join('')||'';delete row.segments;row.startMs=t;row.endMs=null;used+=weights[j];lastTime=t;count++;
      }
    }
    if(!count)throw I18n.error("LyricsAllLinesAlreadyHaveTimingsTurnOffKeep");
    for(const row of out.lines){for(const key of ['startMs','endMs'])if(row[key]!=null)row[key]-=offset;for(const part of row.segments||[])if(part.startMs!=null)part.startMs-=offset;}
    out.systemNotes=[...new Set([...(out.systemNotes||[]),'AcousticDraftNote'])];
    return {doc:out,count};
  }
  return {Extractor,summarize,draft};
});
