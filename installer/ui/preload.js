'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('setup',{
 bootstrap:()=>ipcRenderer.invoke('setup:bootstrap'),inspect:target=>ipcRenderer.invoke('setup:inspect',target),folders:path=>ipcRenderer.invoke('setup:folders',path),execute:request=>ipcRenderer.invoke('setup:execute',request),minimize:()=>ipcRenderer.invoke('setup:minimize'),close:()=>ipcRenderer.invoke('setup:close'),launch:()=>ipcRenderer.invoke('setup:launch'),onProgress:callback=>{const handler=(_e,value)=>callback(value);ipcRenderer.on('setup:progress',handler);return()=>ipcRenderer.removeListener('setup:progress',handler);}
});
