'use strict';
const I18n=require('../i18n');
const MAX_BYTES=16*1024*1024,MAX_PIXELS=24*1024*1024;
/** Read dimensions before asking Chromium to decode. No SVG/HTML, animation or paths. */
function dimensions(b){
  if(!Buffer.isBuffer(b)||b.length<24||b.length>MAX_BYTES)throw I18n.error('CoverInvalidImage');let width=0,height=0;
  if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){width=b.readUInt32BE(16);height=b.readUInt32BE(20);}
  else if(b[0]===0xff&&b[1]===0xd8){let p=2;while(p+4<=b.length){if(b[p++]!==0xff)continue;while(b[p]===0xff)p++;const marker=b[p++];if(marker===0xda||marker===0xd9)break;if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;const size=b.readUInt16BE(p);if(size<2||p+size>b.length)break;if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&size>=7){height=b.readUInt16BE(p+3);width=b.readUInt16BE(p+5);break;}p+=size;}}
  else if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'){
    const type=b.toString('ascii',12,16);if(type==='VP8X'&&b.length>=30){width=1+b.readUIntLE(24,3);height=1+b.readUIntLE(27,3);}
    else if(type==='VP8 '&&b.length>=30&&b[23]===0x9d&&b[24]===1&&b[25]===0x2a){width=b.readUInt16LE(26)&0x3fff;height=b.readUInt16LE(28)&0x3fff;}
    else if(type==='VP8L'&&b.length>=25&&b[20]===0x2f){const bits=b.readUInt32LE(21);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;}
  }
  if(!width||!height||width>12000||height>12000||width*height>MAX_PIXELS)throw I18n.error('CoverInvalidImage');return {width,height};
}
function sanitizeImage(buffer,nativeImage){const size=dimensions(buffer);let image=nativeImage.createFromBuffer(buffer);if(image.isEmpty())throw I18n.error('CoverInvalidImage');const actual=image.getSize();if(actual.width!==size.width||actual.height!==size.height)throw I18n.error('CoverInvalidImage');
  if(Math.max(size.width,size.height)>1200)image=image.resize(size.width>=size.height?{width:1200,quality:'best'}:{height:1200,quality:'best'});return image.toPNG();}
module.exports={dimensions,sanitizeImage,MAX_BYTES};
