(function(root,factory){const model=factory();if(typeof module==='object'&&module.exports)module.exports=model;else root.PulseMenuOrder=model;})(globalThis,()=>{
  'use strict';
  const unique=items=>[...new Set((Array.isArray(items)?items:[]).filter(x=>typeof x==='string'&&x.length>0&&x.length<512))].slice(0,500);
  function normalize(raw){const out=Object.create(null);for(const [key,order]of Object.entries(raw&&typeof raw==='object'?raw:{}))if(/^[\w:|.-]{1,120}$/.test(key)&&Array.isArray(order))out[key]=unique(order);return out;}
  function apply(items,saved){const rank=new Map(unique(saved).map((key,i)=>[key,i]));return [...items].sort((a,b)=>(rank.get(a)??1e6)-(rank.get(b)??1e6));}
  // Retain currently unavailable commands (source/trim/remove), replacing only
  // visible slots. Switching tracks must not erase a customised menu order.
  function merge(saved,visible){const current=unique(visible),known=unique(saved),set=new Set(current);let i=0;const result=known.map(key=>set.has(key)?current[i++]:key);return unique([...result,...current.slice(i)]);}
  return {normalize,apply,merge};
});
