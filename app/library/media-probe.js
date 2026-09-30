"use strict";
const path=require('node:path'),{pathToFileURL}=require('node:url');
const I=require('../i18n');
/** nativeImage only guarantees PNG/JPEG. Use the same sandboxed Chromium
 * decoder as the actual cover UI for animated formats and video, not FFmpeg
 * found on PATH. No renderer-supplied JavaScript or network access is allowed. */
async function probeMedia(file,media,BrowserWindow){
  const win=new BrowserWindow({show:false,width:1,height:1,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  let timer;
  try{
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    await win.loadFile(path.join(__dirname,'cover-probe.html'));
    const url=JSON.stringify(pathToFileURL(file).href),tag=media.video?'video':'img';
    const decode=win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
      const media=document.createElement(${JSON.stringify(tag)});document.body.append(media);
      media.muted=true;media.preload='auto';
      media.onerror=()=>reject(new Error('decode'));
      const done=()=>{const width=media.naturalWidth||media.videoWidth,height=media.naturalHeight||media.videoHeight;
        width>0&&height>0?resolve({width,height}):reject(new Error('dimensions'));};
      ${media.video?"media.onloadeddata=done;":"media.onload=()=>media.decode().then(done,reject);"}
      media.src=${url};
    })`);
    return await Promise.race([decode,new Promise((_,reject)=>{timer=setTimeout(()=>reject(I.error('CoverInvalidImage')),120000);})]);
  }catch{throw I.error('CoverInvalidImage');}
  finally{clearTimeout(timer);if(!win.isDestroyed())win.destroy();}
}
module.exports={probeMedia};
