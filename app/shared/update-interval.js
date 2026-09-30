/* One representation for the scheduler and the settings form. Intervals are whole
 * minutes; changing the display unit never changes the actual waiting period. */
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.PulseUpdateInterval=value;})(globalThis,()=>{
  'use strict';
  const UNITS=Object.freeze({minutes:1,hours:60,days:1440});
  const MIN=1,MAX=30*1440,DEFAULT=12*60,MAX_TIMEOUT=2147483647;
  function number(raw){if(typeof raw==='number')return raw;if(typeof raw!=='string'||!raw.trim())return NaN;const text=raw.trim().replace(',','.');return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)?Number(text):NaN;}
  function normalize(raw={},fallback=DEFAULT){
    const unit=Object.hasOwn(UNITS,raw?.intervalUnit)?raw.intervalUnit:'hours';
    let minutes=number(raw?.intervalMinutes);
    if(!Number.isFinite(minutes))minutes=Number.isFinite(fallback)?fallback:DEFAULT;
    return {intervalMinutes:Math.max(MIN,Math.min(MAX,Math.round(minutes))),intervalUnit:unit};
  }
  function fromInput(value,unit='hours',fallback=DEFAULT){
    unit=Object.hasOwn(UNITS,unit)?unit:'hours';const n=number(value);
    // Even enormous finite input is clamped before multiplication can overflow.
    const minutes=Number.isFinite(n)?Math.max(MIN,Math.min(MAX,n*UNITS[unit])):fallback;
    return normalize({intervalMinutes:minutes,intervalUnit:unit},fallback);
  }
  function display(raw){const p=normalize(raw);return String(Number((p.intervalMinutes/UNITS[p.intervalUnit]).toFixed(8)));}
  return {UNITS,MIN,MAX,DEFAULT,MAX_TIMEOUT,normalize,fromInput,display};
});
