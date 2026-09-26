'use strict';
(() => {
const I18n = window.PulseI18n;
'use strict';
// Duration, not a clock-of-day: no timezone, no 24-hour wrapping. Each segment
// follows the WAI-ARIA spinbutton keyboard pattern and uses a real text input.
window.PulseTimeField=class PulseTimeField {
  constructor({value=null,label=I18n.t('TimeFieldLabel'),onChange=()=>{},automatic='',max=86400000}){
    Object.assign(this,{value,onChange,max});const labelValue=I18n.capture(label),autoValue=typeof automatic==='function'?automatic:I18n.capture(automatic);Object.defineProperty(this,'label',{get:()=>I18n.param(labelValue)});this.automatic=typeof autoValue==='function'?autoValue:()=>I18n.param(autoValue);this.precise=value!==null&&value%1000!==0;
    this.el=document.createElement('div');this.el.className='ly-time-field';this.el.setAttribute('role','group');I18n.setAttribute(this.el,'aria-label',()=>this.label);
    this.inputs=[];this.make();this.set(value);
  }
  make(){
    const inner=document.createElement('div');inner.className='ly-time-segments';this.el.append(inner);
    for(const [i,nameKey]of ['LyricsMinutes','LyricsSeconds','LyricsMilliseconds'].entries()){
      if(i){const sep=document.createElement('span');sep.className=i===2?'ly-time-fraction':'ly-time-colon';sep.textContent=i===2?'.':':';sep.setAttribute('aria-hidden','true');inner.append(sep);}
      const input=document.createElement('input');input.type='text';input.inputMode='numeric';input.autocomplete='off';input.spellcheck=false;
      input.className='ly-time-part'+(i===2?' ly-time-fraction':'');input.dataset.part=['minutes','seconds','milliseconds'][i];input.placeholder=i===2?'000':'00';input.maxLength=i===0?4:i===2?3:2;
      input.setAttribute('role','spinbutton');I18n.setAttribute(input,'aria-label',()=>I18n.t('TimeSegmentLabel',{label:this.label,unit:I18n.msg(nameKey)}));input.setAttribute('aria-valuemin','0');input.setAttribute('aria-valuemax',String(i===0?Math.floor(this.max/60000):i===1?59:999));
      input.addEventListener('focus',()=>{this.part=i;input.select();});input.addEventListener('pointerup',()=>input.select());
      input.addEventListener('input',()=>this.typed(i));input.addEventListener('blur',()=>this.refresh());
      input.addEventListener('keydown',e=>this.key(e,i));input.addEventListener('paste',e=>this.paste(e));
      inner.append(input);this.inputs.push(input);
    }
    const steps=document.createElement('span');steps.className='ly-time-steppers';
    for(const [sign,icon,nameKey]of [[1,'⌃','LyricsIncrease'],[-1,'⌄','LyricsDecrease']]){const b=document.createElement('button');b.type='button';b.tabIndex=-1;b.textContent=icon;I18n.setAttribute(b,'aria-label',()=>I18n.t('TimeStepLabel',{action:I18n.msg(nameKey),label:this.label}));b.onpointerdown=e=>e.preventDefault();b.onclick=()=>this.increment(this.part??1,sign);steps.append(b);}inner.append(steps);
    this.precision=document.createElement('button');this.precision.type='button';this.precision.className='ly-time-precision';I18n.setText(this.precision,()=>(I18n.t("LyricsMs")));I18n.setAttribute(this.precision,"title",()=>(I18n.t("LyricsShowHideMillisecondsPrecisionIsPreserved")));I18n.setAttribute(this.precision,'aria-label',()=>(I18n.t("LyricsMilliseconds2", {value1:(this.label)})));this.precision.onclick=()=>{this.precise=!this.precise;this.refresh();if(this.precise)this.focus(2);};
    this.clear=document.createElement('button');this.clear.type='button';this.clear.className='ly-time-clear';this.clear.textContent='×';I18n.setAttribute(this.clear,'aria-label',()=>(I18n.t("LyricsClearTime", {value1:(this.label)})));this.clear.onclick=()=>{this.commit(null);this.focus(0);};
    inner.append(this.precision,this.clear);this.hint=document.createElement('small');this.hint.className='ly-time-hint';this.el.append(this.hint);
  }
  focus(i){const n=this.inputs[i];n.focus();n.select();}
  set(value){this.value=value==null?null:Math.round(Math.max(0,Math.min(this.max,value)));if(value%1000)this.precise=true;this.refresh();}
  refresh(){
    const v=this.value??0,values=[Math.floor(v/60000),Math.floor(v/1000)%60,v%1000];this.el.classList.toggle('is-empty',this.value===null);this.el.classList.toggle('has-milliseconds',this.precise);this.el.dataset.value=this.value===null?'':String(v);
    this.inputs.forEach((input,i)=>{input.value=this.value===null?'':String(values[i]).padStart(i===2?3:2,'0');input.setAttribute('aria-valuenow',String(values[i]));I18n.setAttribute(input,'aria-valuetext',()=>(this.value===null?I18n.t("LyricsNotSet"):String(values[i])));input.setAttribute('aria-invalid','false');input.tabIndex=i===2&&!this.precise?-1:0;});
    this.precision.setAttribute('aria-pressed',String(this.precise));this.clear.disabled=this.value===null;
    I18n.setText(this.hint,()=>(this.value===null?(typeof this.automatic==='function'?this.automatic():this.automatic)||I18n.t("LyricsNotSet"):(!this.precise&&v%1000?I18n.t("LyricsMsSaved", {value1:(v%1000)}):'')));
  }
  commit(value){this.value=value;this.refresh();this.onChange(value);}
  typed(i){
    const input=this.inputs[i],raw=input.value.replace(/\D/g,'');input.value=raw;
    if(!raw){if(this.inputs.every(n=>!n.value)){this.commit(null);return;}return;}
    const v=this.value??0,parts=[Math.floor(v/60000),Math.floor(v/1000)%60,v%1000];parts[i]=Math.min(i===0?1440:i===1?59:999,Number(raw));
    this.value=Math.min(this.max,parts[0]*60000+parts[1]*1000+parts[2]);this.el.dataset.value=String(this.value);this.el.classList.remove('is-empty');
    this.inputs.forEach((n,j)=>{n.setAttribute('aria-valuenow',String(parts[j]));n.setAttribute('aria-valuetext',String(parts[j]));if(j!==i)n.value=String(parts[j]).padStart(j===2?3:2,'0');});this.hint.textContent='';this.clear.disabled=false;this.onChange(this.value);
    // Typing seconds advances to milliseconds when visible. Large minute values remain editable
    // via arrow keys/paste; explicit navigation never consumes text undo keys.
    if(raw.length===(i===2?3:i===0?4:2)&&i<(this.precise?2:1))this.focus(i+1);
  }
  increment(i,n){const factor=[60000,1000,1][i];this.commit(Math.max(0,Math.min(this.max,(this.value??0)+factor*n)));this.focus(i);}
  key(e,i){
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    if(['ArrowUp','ArrowDown','PageUp','PageDown'].includes(e.key)){e.preventDefault();this.increment(i,(e.key.endsWith('Up')?1:-1)*(e.key.startsWith('Page')?10:1));return;}
    if(e.key==='ArrowLeft'&&i>0){e.preventDefault();this.focus(i-1);return;}
    if((e.key==='ArrowRight'||e.key===':')&&i<(this.precise?2:1)){e.preventDefault();this.focus(i+1);return;}
    if(e.key==='.'||e.key===','){e.preventDefault();this.precise=true;this.refresh();this.focus(2);return;}
    if(e.key==='Home'||e.key==='End'){e.preventDefault();const parts=[60000,1000,1],v=this.value??0,current=i===0?Math.floor(v/60000):i===1?Math.floor(v/1000)%60:v%1000,newPart=e.key==='Home'?0:i===0?Math.floor(this.max/60000):i===1?59:999;this.commit(Math.min(this.max,v+(newPart-current)*parts[i]));this.focus(i);return;}
    if((e.key==='Backspace'||e.key==='Delete')&&this.inputs[i].selectionStart===0&&this.inputs[i].selectionEnd===this.inputs[i].value.length){e.preventDefault();if(this.value===null)return;this.commit(null);this.focus(i);}
  }
  paste(e){const t=e.clipboardData?.getData('text/plain').trim();if(!t?.includes(':'))return;e.preventDefault();try{const ms=window.PulseLyrics.time(t);if(ms>this.max)throw I18n.error("LyricsTimeIsOutOfRange");this.set(ms);this.onChange(this.value);}catch{const n=this.inputs[this.part??0];n.setAttribute('aria-invalid','true');I18n.setText(this.hint,()=>(I18n.t("LyricsFormatOr")));}}
};

})();
