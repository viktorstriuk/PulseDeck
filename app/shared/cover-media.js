/* Media types are stored explicitly: private cover URLs intentionally have no
 * filename extension. No executable/HTML/SVG content is accepted as artwork. */
(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.PulseCoverTypes=value;})(globalThis,()=>{
  'use strict';
  const TYPES=Object.freeze({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',bmp:'image/bmp',avif:'image/avif',mp4:'video/mp4',m4v:'video/mp4',webm:'video/webm',ogv:'video/ogg',mov:'video/quicktime'});
  function typeOf(url,type=''){if(Object.values(TYPES).includes(type))return type;try{const p=new URL(String(url),'file:///').pathname;return TYPES[p.split('.').pop().toLowerCase()]||'';}catch{return '';}}
  function extension(type){return Object.keys(TYPES).find(k=>TYPES[k]===type)||'png';}
  function isVideo(url,type){return typeOf(url,type).startsWith('video/');}
  return {TYPES,typeOf,extension,isVideo};
});
