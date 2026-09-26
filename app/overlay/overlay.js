'use strict';
(() => {
const I18n = window.PulseI18n;
'use strict';
(() => {
  const api = window.pulseOverlay;
  const $ = (s) => document.querySelector(s);
  const card=$('#card'), cover=$('#cover'), orbCover=$('#orbCover'), orbCoverShell=$('#orbCoverShell'), title=$('#title'), artist=$('#artist'), label=$('#label'), playlist=$('#playlist');
  const progress=$('#progress'), progressThumb=$('#progressThumb'), progressWrap=$('#progressWrap'), elapsedTime=$('#elapsedTime'), remainingTime=$('#remainingTime');
  const fg=$('#vizForeground'), bg=$('#vizBackground'), previewBadge=$('#previewBadge'), normalView=$('#normalView'), helpView=$('#helpView'), helpGrid=$('#helpGrid'), playButton=$('#playButton');
  const clickThroughToggle = $('#clickThroughToggle');
  const defaultCover = new URL('../assets/app-icons/blue-violet-monitor.png', document.baseURI).href;
  const interactiveSelector = '#clickThroughToggle, [data-action], #progressWrap, [data-resize]';
  const failedCovers = new Set();
  let hitRegionFrame = 0, hitRegionSignature = '', switchBusy = false;
  let gesturePointer = null, gestureTimer = 0, lastRegionRefresh = 0;
  let config={}, state={}, preview=false, clickThrough=false, passThrough=false, helpTimer=0, syntheticPhase=0, lastNow=performance.now(), rotation=0;
  let coverPalette=['#b038ae','#4665c2'], paletteEpoch=0, switchAnimTimer=0, lastHotZone=false;
  let targetFreq=new Float32Array(64), displayFreq=new Float32Array(64), targetWave=new Float32Array(128).fill(128), displayWave=new Float32Array(128).fill(128);
  let scrubbing=false, lastSeekSent=0, resizeEdge='', stateReceivedAt=performance.now(), stateBaseCurrent=0;

  document.querySelectorAll('[data-icon]').forEach((el)=>{ el.innerHTML=window.Icon(el.dataset.icon,14); });
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
  const cls=(name,on)=>card.classList.toggle(name,!!on);
  const formatTime=(seconds)=>{ const s=Math.max(0,Math.floor(Number(seconds)||0)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; };

  function applyConfig(next={}){
    config={...config,...next};
    document.documentElement.style.setProperty('--bg',config.background||'#11151d');
    document.documentElement.style.setProperty('--accent',config.visualizerColor||'#b038ae');
    document.documentElement.style.setProperty('--accent2',config.visualizerColor2||'#4665c2');
    document.documentElement.style.setProperty('--radius',`${clamp(config.cornerRadius,0,38)}px`);
    const rawOpacity=Number(config.opacity); const opacity=clamp(Number.isFinite(rawOpacity)?rawOpacity:94,0,100)/100;
    document.documentElement.style.setProperty('--opacity',String(opacity));
    document.documentElement.style.setProperty('--opacity-pct',`${Math.round(opacity*100)}%`);
    document.documentElement.style.setProperty('--viz-h',`${clamp(config.visualizerHeight||18,4,120)}px`);
    document.documentElement.style.setProperty('--viz-opacity',String(clamp(config.visualizerOpacity??88,5,100)/100));
    document.documentElement.style.setProperty('--blur',`${clamp(config.backgroundBlur,0,32)}px`);
    cls('no-cover',config.showCover===false); cls('no-title',config.showTitle===false); cls('no-artist',config.showArtist===false);
    cls('no-progress',config.showProgress===false); cls('no-elapsed',config.showElapsed===false); cls('no-remaining',config.showRemaining===false);
    cls('no-label',!config.showLabel); cls('no-controls',config.showControls===false); cls('no-playlist',!config.showPlaylist);
    cls('viz-off',config.visualizer===false); cls('no-surface',config.backgroundVisible===false); cls('no-border',config.borderVisible===false);
    card.classList.remove('viz-bottom','viz-top','viz-center','viz-background-mode');
    const style=config.visualizerStyle||'bars';
    const forcedBackground=['radial','orb'].includes(style);
    const pos=forcedBackground?'background':(['bottom','top','center','background'].includes(config.visualizerPosition)?config.visualizerPosition:'bottom');
    card.classList.add(pos==='background'?'viz-background-mode':`viz-${pos}`);
    card.dataset.vizStyle=style;
    cls('orb-mode',(config.visualizerStyle||'bars')==='orb');
    I18n.setText(label,()=>(config.label||I18n.t("PlayerDefaultLabel")));
    clickThroughToggle.classList.toggle('hidden',config.showClickThroughToggle===false);
    cls('has-click-toggle',config.showClickThroughToggle!==false);
    updateClickThroughToggle();
    scheduleHitRegions();
    draw(performance.now());
  }

  function updateClickThroughToggle() {
    clickThroughToggle.setAttribute('aria-pressed', String(clickThrough));
    clickThroughToggle.classList.toggle('enabled', clickThrough);
    const text = clickThrough ? I18n.t("PlayerOverlayClickThroughIsOnBackgroundClicksPassThrough") : I18n.t("PlayerOverlayClickThroughIsOffClickToPassClicks");
    clickThroughToggle.title = text;
    clickThroughToggle.setAttribute('aria-label', text);
  }

  function visibleInteractiveElements() {
    return [...document.querySelectorAll(interactiveSelector)].filter(el => {
      const css = getComputedStyle(el);
      return !(clickThrough && el.matches('[data-resize]')) && el.getClientRects().length && css.visibility !== 'hidden' && css.pointerEvents !== 'none' && !el.disabled;
    });
  }

  function publishHitRegions() {
    const regions = visibleInteractiveElements().map(el => {
      const r = el.getBoundingClientRect();
      const x = Math.max(0, r.x), y = Math.max(0, r.y);
      return { x, y, width:Math.max(0, Math.min(innerWidth, r.right)-x), height:Math.max(0, Math.min(innerHeight, r.bottom)-y), ...(el.matches('[data-resize]') ? {kind:'resize'} : {}) };
    }).filter(r => r.width > 0 && r.height > 0);
    const signature = JSON.stringify(regions);
    if (signature !== hitRegionSignature) { hitRegionSignature = signature; api.hitRegions(regions); }
  }

  function scheduleHitRegions() {
    if (hitRegionFrame) return;
    hitRegionFrame = requestAnimationFrame(() => { hitRegionFrame = 0; publishHitRegions(); });
  }

  // Capture keeps a seek/resize alive outside its original hit rectangle.
  // Renew the main-process latch so a renderer crash cannot leave input stuck.
  function finishGesture(event) {
    if (gesturePointer === null || (event?.pointerId != null && event.pointerId !== gesturePointer)) return;
    gesturePointer = null; clearInterval(gestureTimer); gestureTimer = 0;
    api.pointerGesture(false);
  }
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    const target = event.target.closest(interactiveSelector);
    if (!target || target.disabled || (clickThrough && target.matches('[data-resize]'))) return;
    gesturePointer = event.pointerId;
    api.pointerGesture(true);
    clearInterval(gestureTimer);
    gestureTimer = setInterval(() => api.pointerGesture(true), 250);
    try { target.setPointerCapture(event.pointerId); } catch {}
  }, true);
  document.addEventListener('pointerup', finishGesture, true);
  document.addEventListener('pointercancel', finishGesture, true);
  document.addEventListener('lostpointercapture', finishGesture, true);
  addEventListener('blur', () => { if (gesturePointer !== null) finishGesture(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) finishGesture(); });

  clickThroughToggle.addEventListener('pointerdown', event => { event.stopPropagation(); api.interactiveHover(true); });
  clickThroughToggle.addEventListener('click', async event => {
    event.stopPropagation();
    if (switchBusy) return;
    switchBusy = true;
    try {
      const result = await api.toggleClickThrough();
      clickThrough = !!result.enabled;
      if (result.config) config = { ...config, ...result.config };
      updateClickThroughToggle();
    } catch (error) { I18n.setAttribute(clickThroughToggle,"title",()=>(I18n.t("PlayerOverlayCouldNotSwitchTryAgain"))); console.error(error); }
    finally { switchBusy = false; }
  });
  new ResizeObserver(scheduleHitRegions).observe(card);

  function transportCurrent(now=performance.now()){
    const d=Math.max(0,Number(state.duration)||0);
    let c=Number(stateBaseCurrent)||Number(state.currentTime)||0;
    if(state.playing&&!scrubbing)c+=(now-stateReceivedAt)/1000;
    return clamp(c,0,d||Number.MAX_SAFE_INTEGER);
  }

  function updateTransport(now=performance.now()){
    const d=Math.max(0,Number(state.duration)||0), c=transportCurrent(now), ratio=d?clamp(c/d,0,1):0;
    progress.style.width=`${ratio*100}%`; progressThumb.style.left=`${ratio*100}%`;
    progressWrap.setAttribute('aria-valuenow',String(Math.round(ratio*100)));
    I18n.setAttribute(progressWrap,'aria-valuetext',()=>(I18n.t("PlayerOverlayOf", {value1:(formatTime(c)),value2:(formatTime(d))})));
    elapsedTime.textContent=formatTime(c); remainingTime.textContent=`−${formatTime(Math.max(0,d-c))}`;
  }

  function rgbToHex(r,g,b){
    const f=(v)=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0');
    return `#${f(r)}${f(g)}${f(b)}`;
  }

  function extractCoverPalette(src){
    const epoch=++paletteEpoch;
    if(!src){coverPalette=['#b038ae','#4665c2'];return;}
    const img=new Image();
    img.decoding='async';
    img.onload=()=>{
      if(epoch!==paletteEpoch)return;
      try{
        const size=32,cv=document.createElement('canvas');cv.width=size;cv.height=size;
        const cx=cv.getContext('2d',{willReadFrequently:true});cx.drawImage(img,0,0,size,size);
        const px=cx.getImageData(0,0,size,size).data,bins=new Map();
        for(let i=0;i<px.length;i+=4){
          if(px[i+3]<180)continue;
          const r=px[i],g=px[i+1],b=px[i+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b),lum=(mx+mn)/2,sat=mx===mn?0:(mx-mn)/(255-Math.abs(mx+mn-255));
          if(lum<18||lum>242||sat<.08)continue;
          const qr=Math.round(r/24)*24,qg=Math.round(g/24)*24,qb=Math.round(b/24)*24,key=`${qr},${qg},${qb}`;
          const weight=.45+sat*1.35+(1-Math.abs(lum-132)/132)*.35;
          bins.set(key,(bins.get(key)||0)+weight);
        }
        const ranked=[...bins.entries()].sort((a,b)=>b[1]-a[1]).map(([k,score])=>({rgb:k.split(',').map(Number),score}));
        if(!ranked.length)return;
        const first=ranked[0].rgb;
        let second=ranked.find((c,idx)=>idx>0&&Math.hypot(c.rgb[0]-first[0],c.rgb[1]-first[1],c.rgb[2]-first[2])>92)?.rgb;
        if(!second) second=ranked[1]?.rgb || first.map((v,i)=>Math.max(0,Math.min(255,v+(i===1?38:-26))));
        coverPalette=[rgbToHex(...first),rgbToHex(...second)];
      }catch{}
    };
    img.onerror=()=>{};
    img.src=src;
  }

  function applyCover() {
    const fallback = String(state.fallbackCover || defaultCover);
    const requested = String(state.cover || '');
    const source = [requested, fallback, defaultCover].find(url => url && !failedCovers.has(url)) || defaultCover;
    for (const img of [cover, orbCover]) {
      if (img.getAttribute('src') !== source) img.src = source;
      img.classList.toggle('is-placeholder', !requested || source !== requested);
    }
  }
  for (const img of [cover, orbCover]) img.addEventListener('error', () => {
    const source = img.getAttribute('src');
    if (!source || failedCovers.has(source)) return;
    failedCovers.add(source); applyCover();
  });

  function applyState(next={}){
    state={...state,...next};
    stateBaseCurrent=Number(state.currentTime)||0; stateReceivedAt=performance.now();
    I18n.setText(title,()=>state.title||I18n.t('AppName')); I18n.setText(artist,()=>(state.artist||I18n.t("AppTagline"))); playlist.textContent=state.playlist||'';
    const src=String(state.cover||'');
    if(src && src!==String(card.dataset.paletteSource||'')){card.dataset.paletteSource=src;extractCoverPalette(src);} else if(!src){card.dataset.paletteSource='';extractCoverPalette('');}
    applyCover();
    scheduleHitRegions();
    updateTransport();
    playButton.innerHTML=window.Icon(state.playing?'pause':'play',14);
    I18n.setAttribute(playButton,'aria-label',()=>(state.playing?I18n.t("PlayerOverlayPause"):I18n.t("PlayerOverlayResume"))); I18n.setAttribute(playButton,"title",()=>(state.playing?I18n.t("PlayerOverlayPause"):I18n.t("PlayerOverlayResume")));
  }

  function resizeCanvas(canvas){
    const r=canvas.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1),w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
    return{w,h,dpr};
  }

  function createPaint(ctx,w,h,now){
    const a=config.visualizerColor||'#b038ae', b=config.visualizerColor2||'#4665c2', mode=config.visualizerColorMode||'gradient';
    if(mode==='solid') return a;
    const paletteA=mode==='cover'?(coverPalette[0]||a):a, paletteB=mode==='cover'?(coverPalette[1]||b):b;
    const grad=ctx.createLinearGradient(0,0,w,h*.18);
    if(mode==='rainbow'){
      const shift=(now*.018)%360;
      for(let i=0;i<=6;i++) grad.addColorStop(i/6,`hsl(${(shift+i*60)%360} 86% 62%)`);
    }else{grad.addColorStop(0,paletteA);grad.addColorStop(.52,paletteB);grad.addColorStop(1,paletteA)}
    return grad;
  }

  function resample(src,count){
    count=Math.max(8,Math.min(Number(count)||48,src.length||48));
    const out=new Float32Array(count); if(!src.length)return out;
    for(let i=0;i<count;i++){
      const from=i*src.length/count, to=(i+1)*src.length/count; let sum=0,n=0;
      for(let j=Math.floor(from);j<Math.ceil(to)&&j<src.length;j++){sum+=src[j];n++}
      out[i]=n?sum/n:0;
    }
    return out;
  }

  function resampleLog(src,count){
    count=Math.max(8,Math.min(Number(count)||48,src.length||48));
    const out=new Float32Array(count); if(!src.length)return out;
    const max=Math.max(1,src.length-1), logMax=Math.log(max+1);
    for(let i=0;i<count;i++){
      const a=(Math.exp(logMax*(i/count))-1), b=(Math.exp(logMax*((i+1)/count))-1);
      let sum=0,n=0;
      for(let j=Math.floor(a);j<=Math.ceil(b)&&j<src.length;j++){sum+=src[Math.max(0,j)];n++}
      out[i]=n?sum/n:0;
    }
    return out;
  }

  function smoothPath(ctx,points){
    if(points.length<2)return;
    ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);
    for(let i=1;i<points.length-1;i++){
      const mx=(points[i][0]+points[i+1][0])/2,my=(points[i][1]+points[i+1][1])/2;
      ctx.quadraticCurveTo(points[i][0],points[i][1],mx,my);
    }
    const last=points[points.length-1];ctx.lineTo(last[0],last[1]);
  }

  function drawBars(ctx,vals,w,h,dpr,paint,mirror=false){
    const gapRatio=clamp(config.visualizerGap??34,0,78)/100;
    const slot=w/vals.length,bw=Math.max(1,slot*(1-gapRatio)),radius=Math.min(bw/2,(clamp(config.visualizerRoundness??72,0,100)/100)*5*dpr);
    ctx.fillStyle=paint;
    for(let i=0;i<vals.length;i++){
      const p=clamp(vals[i]/255*(Number(config.sensitivity)||1),0,1),bh=Math.max(1,p*(mirror?h*.46:h*.92)),x=i*slot+(slot-bw)/2;
      ctx.globalAlpha=.22+p*.78;
      if(mirror){ctx.beginPath();ctx.roundRect(x,h/2-bh,bw,bh*2,radius);ctx.fill()}
      else{ctx.beginPath();ctx.roundRect(x,h-bh,bw,bh,radius);ctx.fill()}
    }
    ctx.globalAlpha=1;
  }

  function drawLed(ctx,vals,w,h,dpr,paint){
    const gapRatio=clamp(config.visualizerGap??34,0,78)/100,slot=w/vals.length,bw=Math.max(1.5*dpr,slot*(1-gapRatio));
    const segments=Math.max(5,Math.min(18,Math.round(h/(5*dpr)))),segGap=Math.max(1*dpr,h*.018),segH=Math.max(1*dpr,(h-(segments-1)*segGap)/segments);
    ctx.fillStyle=paint;
    for(let i=0;i<vals.length;i++){
      const p=clamp(vals[i]/255*(Number(config.sensitivity)||1),0,1),active=Math.max(1,Math.round(p*segments)),x=i*slot+(slot-bw)/2;
      for(let j=0;j<segments;j++){
        const y=h-(j+1)*segH-j*segGap,on=j<active;
        ctx.globalAlpha=on?(0.32+0.68*(1-j/segments)*.7+p*.3):.055;
        ctx.beginPath();ctx.roundRect(x,y,bw,segH,Math.min(segH*.45,bw*.35));ctx.fill();
      }
    }
    ctx.globalAlpha=1;
  }

  function drawWave(ctx,wave,w,h,dpr,paint,fill=false){
    const detail=Math.max(24,Math.min(160,Number(config.visualizerDetail)||64));
    const samples=resample(wave,detail), sens=clamp(config.sensitivity||1,.25,3), points=[];
    for(let i=0;i<samples.length;i++){
      const x=i/(samples.length-1)*w, centered=(samples[i]-128)/128, y=h/2-centered*h*.44*sens; points.push([x,y]);
    }
    ctx.strokeStyle=paint;ctx.fillStyle=paint;ctx.lineWidth=clamp(config.visualizerLineWidth||2.2,1,7)*dpr;ctx.lineCap='round';ctx.lineJoin='round';
    smoothPath(ctx,points);
    if(fill){ctx.lineTo(w,h/2);ctx.lineTo(0,h/2);ctx.closePath();ctx.globalAlpha=.24;ctx.fill();ctx.globalAlpha=1;smoothPath(ctx,points)}
    ctx.stroke();
  }

  function drawArea(ctx,vals,w,h,dpr,paint){
    const detail=Math.max(24,Math.min(120,Number(config.visualizerDetail)||56)),data=resample(vals,detail),sens=clamp(config.sensitivity||1,.25,3),points=[];
    for(let i=0;i<data.length;i++){const x=i/(data.length-1)*w,y=h-clamp(data[i]/255*sens,0,1)*h*.92;points.push([x,y])}
    ctx.fillStyle=paint;ctx.strokeStyle=paint;ctx.lineWidth=clamp(config.visualizerLineWidth||2.2,1,7)*dpr;
    smoothPath(ctx,points);ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();ctx.globalAlpha=config.visualizerFill===false?.12:.31;ctx.fill();ctx.globalAlpha=1;smoothPath(ctx,points);ctx.stroke();
  }

  function drawRadial(ctx,vals,w,h,dpr,paint,orb=false,now=0){
    const data=resample(vals,Math.max(28,Math.min(96,Number(config.visualizerDetail)||56))),cx=w/2,cy=h/2,min=Math.min(w,h),sens=clamp(config.sensitivity||1,.25,3);
    const base=min*(orb?.22:.27),maxLen=min*(orb?.19:.22),rot=rotation*Math.PI/180;
    ctx.strokeStyle=paint;ctx.fillStyle=paint;ctx.lineCap='round';ctx.lineWidth=Math.max(1.2*dpr,clamp(config.visualizerLineWidth||2.2,1,7)*dpr*.75);
    for(let i=0;i<data.length;i++){
      const p=clamp(data[i]/255*sens,0,1),a=i/data.length*Math.PI*2-Math.PI/2+rot,len=2*dpr+p*maxLen;
      const x1=cx+Math.cos(a)*base,y1=cy+Math.sin(a)*base,x2=cx+Math.cos(a)*(base+len),y2=cy+Math.sin(a)*(base+len);
      ctx.globalAlpha=.25+p*.75;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
    }
    ctx.globalAlpha=1;
    if(orb){
      const bass=[...data.slice(0,Math.max(2,Math.floor(data.length*.16)))].reduce((a,b)=>a+b,0)/Math.max(1,data.length*.16)/255;
      ctx.globalAlpha=.12+bass*.18;ctx.beginPath();ctx.arc(cx,cy,base*(.72+bass*.14),0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
    }
  }

  function drawCanvas(canvas,now){
    if(!canvas||getComputedStyle(canvas).display==='none')return;
    const {w,h,dpr}=resizeCanvas(canvas),ctx=canvas.getContext('2d',{alpha:true});ctx.clearRect(0,0,w,h);
    const paint=createPaint(ctx,w,h,now),style=config.visualizerStyle||'bars';
    const detail=Math.max(24,Math.min(96,Number(config.visualizerDetail)||56)),freq=resampleLog(displayFreq,detail);
    ctx.save();ctx.globalAlpha=clamp(config.visualizerOpacity??88,5,100)/100;
    if(style==='bars')drawBars(ctx,freq,w,h,dpr,paint,!!config.visualizerMirror);
    else if(style==='led')drawLed(ctx,freq,w,h,dpr,paint);
    else if(style==='mirror')drawBars(ctx,freq,w,h,dpr,paint,true);
    else if(style==='wave')drawWave(ctx,displayWave,w,h,dpr,paint,!!config.visualizerFill);
    else if(style==='area')drawArea(ctx,freq,w,h,dpr,paint);
    else if(style==='radial')drawRadial(ctx,freq,w,h,dpr,paint,false,now);
    else if(style==='orb')drawRadial(ctx,freq,w,h,dpr,paint,true,now);
    ctx.restore();
  }

  function syntheticFrame(now){
    syntheticPhase+=Math.min(.12,(now-lastNow)/1000*.9);
    for(let i=0;i<targetFreq.length;i++) targetFreq[i]=32+120*(.5+.5*Math.sin(syntheticPhase*1.7+i*.42))*Math.exp(-i/95)+38*(.5+.5*Math.sin(syntheticPhase*.61+i*.13));
    for(let i=0;i<targetWave.length;i++) targetWave[i]=128+Math.sin(syntheticPhase*2.2+i*.17)*28+Math.sin(syntheticPhase*.7+i*.052)*12;
  }

  function draw(now){
    const dt=Math.min(.08,Math.max(.001,(now-lastNow)/1000));lastNow=now;rotation=(rotation+(Number(config.visualizerRotation)||0)*dt)%360;
    if(preview&&(!state.playing||!targetFreq.some(v=>v>3)))syntheticFrame(now);
    const smooth=clamp(config.smoothing??78,0,95)/100, alpha=Math.max(.08,1-Math.pow(smooth,Math.max(1,dt*60)));
    for(let i=0;i<displayFreq.length;i++)displayFreq[i]+=((targetFreq[i]||0)-displayFreq[i])*alpha;
    for(let i=0;i<displayWave.length;i++)displayWave[i]+=((targetWave[i]??128)-displayWave[i])*Math.max(.18,alpha);
    if(state.duration&&!scrubbing)updateTransport(now);drawCanvas(fg,now);drawCanvas(bg,now);
  }

  function loop(now){
    draw(now);
    // Covers layout shifts and animated controls without flooding IPC with
    // unchanged rectangles. Forwarded mousemove is the fast path for input.
    if (now-lastRegionRefresh > 32) { lastRegionRefresh=now; publishHitRegions(); }
    requestAnimationFrame(loop);
  }

  function acceptAudioFrame(payload){
    if(Array.isArray(payload)) payload={freq:payload};
    if(!payload||typeof payload!=='object')return;
    const f=Array.isArray(payload.freq)?payload.freq:[], w=Array.isArray(payload.wave)?payload.wave:[];
    if(f.length){targetFreq=new Float32Array(Math.max(64,f.length));for(let i=0;i<targetFreq.length;i++)targetFreq[i]=clamp(f[i]??0,0,255)}
    if(w.length){targetWave=new Float32Array(Math.max(128,w.length));for(let i=0;i<targetWave.length;i++)targetWave[i]=clamp(w[i]??128,0,255)}
  }

  function seekFromPointer(e,final=false){
    const r=progressWrap.getBoundingClientRect(),ratio=clamp((e.clientX-r.left)/Math.max(1,r.width),0,1),d=Number(state.duration)||0;
    if(d){state.currentTime=ratio*d;stateBaseCurrent=state.currentTime;stateReceivedAt=performance.now();updateTransport()}
    const now=performance.now();if(final||now-lastSeekSent>45){lastSeekSent=now;api.control('seekTo',ratio)}
  }
  progressWrap.addEventListener('pointerdown',(e)=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();scrubbing=true;progressWrap.classList.add('scrubbing');progressWrap.setPointerCapture?.(e.pointerId);seekFromPointer(e)});
  progressWrap.addEventListener('pointermove',(e)=>{if(scrubbing)seekFromPointer(e)});
  const endScrub=(e)=>{if(!scrubbing)return;scrubbing=false;progressWrap.classList.remove('scrubbing');seekFromPointer(e,true);try{progressWrap.releasePointerCapture?.(e.pointerId)}catch{}};
  progressWrap.addEventListener('pointerup',endScrub);progressWrap.addEventListener('pointercancel',()=>{scrubbing=false;progressWrap.classList.remove('scrubbing')});
  progressWrap.addEventListener('keydown',(e)=>{const d=Number(state.duration)||0;if(!d)return;let t=Number(state.currentTime)||0;if(e.key==='ArrowRight')t+=5;else if(e.key==='ArrowLeft')t-=5;else if(e.key==='Home')t=0;else if(e.key==='End')t=d;else return;e.preventDefault();t=clamp(t,0,d);state.currentTime=t;stateBaseCurrent=t;stateReceivedAt=performance.now();updateTransport();api.control('seekTo',t/d)});

  document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();api.control(b.dataset.action)}));
  document.querySelectorAll('[data-resize]').forEach((handle)=>{
    handle.addEventListener('pointerdown',(e)=>{if(e.button!==0||clickThrough)return;e.preventDefault();e.stopPropagation();resizeEdge=handle.dataset.resize;handle.setPointerCapture?.(e.pointerId);api.resizeBegin(resizeEdge,e.screenX,e.screenY)});
    handle.addEventListener('pointermove',(e)=>{if(resizeEdge)api.resizeMove(e.screenX,e.screenY)});
    const stop=(e)=>{if(!resizeEdge)return;resizeEdge='';try{handle.releasePointerCapture?.(e.pointerId)}catch{}api.resizeEnd()};
    handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);
  });

  function animateOverlay(payload={}){
    clearTimeout(switchAnimTimer);
    const kind=payload?.kind==='switch'?'track-switch':'soft-pulse';
    card.classList.remove('track-switch','soft-pulse');
    void card.offsetWidth;
    card.classList.add(kind);
    switchAnimTimer=setTimeout(()=>card.classList.remove(kind),kind==='track-switch'?460:300);
  }

  function setInteractiveHotZone(value){
    const next=!!value;
    if(next===lastHotZone)return;
    lastHotZone=next;
    api.interactiveHover(next);
  }

  document.addEventListener('mousemove',(e)=>{
    if(!clickThrough){setInteractiveHotZone(false);return;}
    const el=document.elementFromPoint(e.clientX,e.clientY);
    const hot=!!el?.closest?.(interactiveSelector);
    setInteractiveHotZone(hot);
  },{passive:true});
  document.addEventListener('mouseleave',()=>setInteractiveHotZone(false));

  let lastHelpHotkeys={};
  function showHelp(hotkeys={}){
    lastHelpHotkeys=hotkeys;
    clearTimeout(helpTimer);normalView.classList.add('hidden');helpView.classList.remove('hidden');
    const labels={playPause:I18n.t("PlayerOverlayPauseResume"),next:I18n.t("PlayerOverlayNextTrack"),previous:I18n.t("PlayerOverlayPreviousTrack"),volumeUp:I18n.t("PlayerOverlayVolumeUp"),volumeDown:I18n.t("PlayerOverlayVolumeDown"),mute:I18n.t("PlayerOverlayMute"),nextPlaylist:I18n.t("PlayerOverlayNextPlaylist"),previousPlaylist:I18n.t("PlayerOverlayPreviousPlaylist"),showOverlay:I18n.t("PlayerOverlayShowPlayer"),showHelp:I18n.t("PlayerOverlayThisHelpPanel"),toggleClickThrough:I18n.t("PlayerOverlayClickThrough")};
    helpGrid.innerHTML=Object.entries(labels).map(([k,v])=>{const parts=String(hotkeys[k]||'-').split('+').filter(Boolean);return `<div class="help-row"><span>${I18n.h(I18n.keyForText(v))}</span><span class="keys">${parts.map(x=>`<kbd class="key">${x.replace('CommandOrControl','Ctrl')}</kbd>`).join('<i>+</i>')}</span></div>`}).join('');
    scheduleHitRegions();
    helpTimer=setTimeout(()=>{helpView.classList.add('hidden');normalView.classList.remove('hidden');scheduleHitRegions()},4800);
  }

  document.addEventListener('pulsedeck:language-changed',()=>{
    applyConfig(config);updateClickThroughToggle();updatePreviewBadge();
    if(!helpView.classList.contains('hidden'))showHelp(lastHelpHotkeys);
    I18n.refreshBindings();
  });
  api.onConfig(applyConfig);api.onState(applyState);api.onAudioFrame(acceptAudioFrame);
  function updatePreviewBadge(){
    I18n.setText(previewBadge,()=>(clickThrough?I18n.t("PlayerOverlayPreviewClickThroughIsOn"):I18n.t("PlayerOverlayPreviewDragAndResizeThisWindow")));
    I18n.setAttribute(previewBadge,"title",()=>(clickThrough?I18n.t("PlayerOverlayWindowBoundariesAreShownForSetupMovingAnd"):I18n.t("PlayerOverlayPreviewDragAndResizeThisWindow")));
  }
  api.onPreviewMode(v=>{preview=!!v;updatePreviewBadge();previewBadge.classList.toggle('hidden',!preview);card.classList.toggle('preview-mode',preview);scheduleHitRegions()});
  api.onInteraction(v=>{clickThrough=!!v?.clickThrough;passThrough=!!v?.passThrough;if(clickThrough&&resizeEdge){resizeEdge='';api.resizeEnd();finishGesture();}card.classList.toggle('click-through',clickThrough);card.classList.toggle('pass-through',passThrough);if(!clickThrough)setInteractiveHotZone(false);updateClickThroughToggle();updatePreviewBadge();scheduleHitRegions()});
  api.onAnimate(animateOverlay);
  api.onHelp(showHelp);
  addEventListener('resize',()=>{draw(performance.now());scheduleHitRegions()});applyCover();scheduleHitRegions();requestAnimationFrame(loop);
})();

})();
