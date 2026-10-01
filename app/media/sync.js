'use strict';
/** Deterministic, local spectral matching. It estimates a linear timeline only;
 * edited/live/ambiguous recordings are explicitly rejected instead of guessing.
 * PCM is 8 kHz mono. Each frame is a gain-invariant log-frequency fingerprint. */
const RATE=8000,N=1024,HOP=400,BANDS=16;
function fft(re,im){
  for(let i=1,j=0;i<N;i++){let bit=N>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];}}
  for(let len=2;len<=N;len<<=1){const a=-2*Math.PI/len,cr=Math.cos(a),ci=Math.sin(a);
    for(let i=0;i<N;i+=len){let wr=1,wi=0;for(let j=0;j<len/2;j++){const u=i+j,v=u+len/2,tr=wr*re[v]-wi*im[v],ti=wr*im[v]+wi*re[v];re[v]=re[u]-tr;im[v]=im[u]-ti;re[u]+=tr;im[u]+=ti;const nw=wr*cr-wi*ci;wi=wr*ci+wi*cr;wr=nw;}}
  }
}
function fingerprint(pcm){
  const frames=Math.max(0,Math.floor((pcm.length-N)/HOP)+1),out=new Float32Array(frames*BANDS),active=new Uint8Array(frames);
  const window=Float64Array.from({length:N},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(N-1))),bins=Int32Array.from({length:BANDS+1},(_,i)=>Math.round(80*Math.pow(3500/80,i/BANDS)*N/RATE));
  const re=new Float64Array(N),im=new Float64Array(N);
  for(let f=0;f<frames;f++){
    let energy=0;for(let i=0;i<N;i++){const x=pcm[f*HOP+i];re[i]=x*window[i];im[i]=0;energy+=x*x;}
    if(energy/N<1e-7)continue;fft(re,im);let mean=0;
    for(let k=0;k<BANDS;k++){let sum=0;for(let j=bins[k];j<bins[k+1];j++)sum+=re[j]*re[j]+im[j]*im[j];const v=Math.log(1e-9+sum/(bins[k+1]-bins[k]));out[f*BANDS+k]=v;mean+=v/BANDS;}
    let norm=0;for(let k=0;k<BANDS;k++){out[f*BANDS+k]-=mean;norm+=out[f*BANDS+k]**2;}norm=Math.sqrt(norm);
    if(norm<.01)continue;for(let k=0;k<BANDS;k++)out[f*BANDS+k]/=norm;active[f]=1;
  }
  return {data:out,active,frames};
}
function score(a,b,at,bt,length,stride=4){
  let sum=0,n=0;
  for(let t=0;t<length;t+=stride){const ai=at+t,bi=bt+t;if(!a.active[ai]||!b.active[bi])continue;let dot=0;for(let k=0;k<BANDS;k++)dot+=a.data[ai*BANDS+k]*b.data[bi*BANDS+k];sum+=dot;n++;}
  return n<length/stride*.6?-1:sum/n;
}
function anchor(a,b,start,length){
  let best=-1,at=0;const scores=[];
  for(let j=0;j<=b.frames-length;j+=5){const s=score(a,b,start,j,length,4);scores.push([j,s]);if(s>best){best=s;at=j;}}
  let runner=-1;for(const [j,s]of scores)if(Math.abs(j-at)>40)runner=Math.max(runner,s);
  for(let j=Math.max(0,at-5),end=Math.min(b.frames-length,at+5);j<=end;j++){const s=score(a,b,start,j,length,2);if(s>best){best=s;at=j;}}
  return {a:(start+length/2)*HOP/RATE,b:(at+length/2)*HOP/RATE,score:best,margin:best-runner};
}
function fine(a,b,at,bt){
  // Waveform correlation refines spectral frame quantisation. Only use a clear
  // match; lossy encoders/different masters can legitimately prevent refinement.
  const start=Math.round((at-.75)*RATE),base=Math.round((bt-.75)*RATE),length=12000;
  if(start<0||base-800<0||start+length>=a.length||base+length+800>=b.length)return bt;
  let best=0,bestShift=0;
  const corr=shift=>{let ab=0,aa=0,bb=0;for(let i=0;i<length;i+=4){const x=a[start+i],y=b[base+i+shift];ab+=x*y;aa+=x*x;bb+=y*y;}return Math.abs(ab/Math.sqrt(aa*bb+1e-30));};
  for(let shift=-600;shift<=600;shift+=8){const s=corr(shift);if(s>best){best=s;bestShift=shift;}}
  if(best<.6)return bt;
  const from=bestShift-8,to=bestShift+8;for(let shift=from;shift<=to;shift++){const s=corr(shift);if(s>best){best=s;bestShift=shift;}}
  return bt+bestShift/RATE;
}
function synchronize(aPCM,bPCM){
  const a=fingerprint(aPCM),b=fingerprint(bPCM),length=Math.min(300,Math.floor(Math.min(a.frames,b.frames)*.3));
  if(length<80)return {matched:false,reason:'short',confidence:0};
  const hits=[.12,.45,.78].map(x=>anchor(a,b,Math.min(a.frames-length,Math.floor(a.frames*x)),length));
  const usable=hits.filter(h=>h.score>.80&&h.margin>.008);
  if(usable.length<2)return {matched:false,reason:'ambiguous',confidence:Math.max(0,...hits.map(h=>h.score))};
  for(const h of usable)h.b=fine(aPCM,bPCM,h.a,h.b);
  let pairs=[];for(let i=0;i<usable.length;i++)for(let j=i+1;j<usable.length;j++){
    const p=usable[i],q=usable[j],rate=(q.b-p.b)/(q.a-p.a),offset=p.b-rate*p.a;
    if(rate>=.95&&rate<=1.05){const inliers=usable.filter(h=>Math.abs(h.b-(rate*h.a+offset))<.13);pairs.push({rate,offset,inliers});}
  }
  pairs.sort((x,y)=>y.inliers.length-x.inliers.length);const chosen=pairs[0];
  if(!chosen||chosen.inliers.length<2||usable.some(h=>!chosen.inliers.includes(h)))return {matched:false,reason:'different-edit',confidence:0};
  const meanA=chosen.inliers.reduce((s,h)=>s+h.a,0)/chosen.inliers.length,meanB=chosen.inliers.reduce((s,h)=>s+h.b,0)/chosen.inliers.length;
  let xy=0,xx=0;for(const h of chosen.inliers){xy+=(h.a-meanA)*(h.b-meanB);xx+=(h.a-meanA)**2;}
  let rate=xy/xx; // Avoid inventing speed drift out of frame quantisation noise.
  if(Math.abs(rate-1)<.0001)rate=1;
  const offset=meanB-rate*meanA,confidence=Math.min(...chosen.inliers.map(h=>h.score));
  return {matched:true,offset:Math.round(offset*10000)/10000,rate:Math.round(rate*1e7)/1e7,confidence,anchors:chosen.inliers.length,uncertainty:.05};
}
module.exports={synchronize,fingerprint,score};
