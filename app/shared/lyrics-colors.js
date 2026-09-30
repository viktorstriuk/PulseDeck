'use strict';
// Independent sRGB/WCAG implementation, not a copied dependency.
// References: W3C WCAG 2.2 relative luminance; TinyColor's mostReadable API design.
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.PulseLyricsColors=value;})(globalThis,()=>{
  const rgb=h=>/^#[a-f\d]{6}$/i.test(h||'')?[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)):[0,0,0];
  const hex=a=>'#'+a.map(n=>Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,'0')).join('');
  function luminance(value){const a=typeof value==='string'?rgb(value):value;const linear=a.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;}
  const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const mix=(a,b,t)=>a.map((v,i)=>v*(1-t)+b[i]*t);
  const modes=(hasCover,hasCustom=false)=>[... (hasCover?['gradient','cover','solid']:['gradient','solid']),...(hasCustom?['custom']:[])];
  const nextMode=(mode,cover,custom=false)=>{const allowed=modes(cover,custom);if(!allowed.includes(mode))mode='gradient';return allowed[(allowed.indexOf(mode)+1)%allowed.length];};
  function gradientSamples(colors){const samples=[];for(let i=0;i<colors.length-1;i++)for(let k=0;k<=32;k++)samples.push(mix(rgb(colors[i]),rgb(colors[i+1]),k/32));return samples.length?samples:[rgb(colors[0]||'#302036')];}
  function palette(pixels){
    const bins=new Map();let sum=[0,0,0],n=0;
    for(let i=0;i+3<pixels.length;i+=4){if(pixels[i+3]<80)continue;const c=[pixels[i],pixels[i+1],pixels[i+2]];sum=sum.map((v,j)=>v+c[j]);n++;const key=c.map(v=>Math.round(v/32)).join(',');const b=bins.get(key)||{sum:[0,0,0],n:0};b.sum=b.sum.map((v,j)=>v+c[j]);b.n++;bins.set(key,b);}
    const colors=[...bins.values()].sort((a,b)=>b.n-a.n).map(b=>b.sum.map(v=>v/b.n));
    const first=colors[0]||[48,32,54];let second=colors.find(c=>c.reduce((d,v,i)=>d+Math.abs(v-first[i]),0)>90)||mix(first,[0,0,0],.5);
    // Rich subdued default palette; don't recolor imported user themes.
    const darken=c=>hex(mix(c,[0,0,0],.35));
    const third=colors.find(c=>c.reduce((d,v,i)=>d+Math.abs(v-first[i]),0)>60&&c.reduce((d,v,i)=>d+Math.abs(v-second[i]),0)>60)||mix(first,second,.5);
    // Every cover suggestion stays within the cover's colour family, including
    // monochrome artwork: only its extracted colours and their shades are used.
    const variants=n?[[darken(first),darken(second)],[hex(second),darken(third)],
      [hex(mix(first,[255,255,255],.20)),darken(third)],[darken(second),hex(mix(first,[0,0,0],.65))]]:[];
    return {colors:[darken(first),darken(second)],variants,average:n?sum.map(v=>v/n):[48,32,54]};
  }
  function scene(theme,{hasCover=false,hasCustom=false,average=[48,32,54]}={}){
    const mode=(theme.mode==='cover'&&!hasCover)||(theme.mode==='custom'&&!hasCustom)?'gradient':theme.mode;
    const coverOpacity=.72;
    const samples=mode==='solid'?[rgb(theme.background)]:gradientSamples(theme.gradientColors);
    if(mode==='gradient'){for(let i=0;i<theme.gradientColors.length-1;i++){const a=rgb(theme.gradientColors[i]),b=rgb(theme.gradientColors[i+1]);samples.push(a.map((v,j)=>Math.min(v,b[j])),a.map((v,j)=>Math.max(v,b[j])));}}
    const candidates=[{active:'#ffffff',text:'#bfc0c9',tint:[0,0,0]},{active:'#000000',text:'#404044',tint:[255,255,255]}];
    let chosen;
    if(mode==='cover'||mode==='custom'){
      // Cover can contain arbitrarily small black/white details missed by a thumbnail.
      // Use average luminance for preference, BUT prove contrast against BOTH
      // extrema of every possible RGB pixel, not merely an average or sampled patch.
      chosen=candidates[luminance(average)>.46?1:0];
      const base=chosen.tint;
      const extrema=[[0,0,0],[255,255,255]].map(c=>mix(base,c,coverOpacity));
      let alpha=0;while(alpha<.9&&Math.min(...extrema.map(c=>ratio(chosen.text,mix(c,chosen.tint,alpha))))<4.5)alpha+=.01;
      alpha=Math.min(.9,Math.ceil(alpha*100)/100);
      return {mode,base:hex(base),tint:hex(chosen.tint),scrim:alpha,coverOpacity,text:chosen.text,active:chosen.active,
        minContrast:Math.min(...extrema.map(c=>ratio(chosen.text,mix(c,chosen.tint,alpha)))),corrected:false};
    }
    if(theme.autoContrast===false&&theme.text&&theme.activeText){
      return {mode,base:theme.background,tint:'#000000',scrim:0,text:theme.text,active:theme.activeText,
        minContrast:Math.min(...samples.flatMap(c=>[ratio(c,theme.text),ratio(c,theme.activeText)])),corrected:false};
    }
    const options=candidates.map(c=>{let a=0;while(a<.95&&Math.min(...samples.map(s=>ratio(c.text,mix(s,c.tint,a))))<4.5)a+=.01;
      return {...c,scrim:Math.ceil(a*100)/100};});
    chosen=options.sort((a,b)=>a.scrim-b.scrim)[0];
    return {mode,base:theme.background,tint:hex(chosen.tint),scrim:chosen.scrim,text:chosen.text,active:chosen.active,
      minContrast:Math.min(...samples.map(c=>ratio(chosen.text,mix(c,chosen.tint,chosen.scrim)))),corrected:chosen.scrim>0};
  }
  return {rgb,hex,luminance,ratio,mix,gradientSamples,palette,scene,modes,nextMode};
});
