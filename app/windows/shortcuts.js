'use strict';
const fs=require('node:fs'),path=require('node:path');
/** Repair only links that target THIS installation. Never pin, unpin, reorder,
 * or replace another app/installation's shortcut. Explorer can retain an old
 * cached icon until the user re-pins it; no destructive icon-cache reset. */
function repair({shell,execPath,iconPath,desktop,appData,appId,name='PulseDeck',createStartMenu=false}) {
  const equal=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
  const programs=path.join(appData,'Microsoft','Windows','Start Menu','Programs');
  const start=path.join(programs,name+'.lnk');
  const pinned=path.join(appData,'Microsoft','Internet Explorer','Quick Launch','User Pinned','TaskBar');
  const candidates=[path.join(desktop,name+'.lnk'),start];
  try { for(const entry of fs.readdirSync(pinned,{withFileTypes:true}))if(entry.isFile()&&/\.lnk$/i.test(entry.name))candidates.push(path.join(pinned,entry.name)); } catch {}
  const updated=[];
  for(const file of candidates) {
    try {
      if(!fs.existsSync(file))continue;
      const current=shell.readShortcutLink(file);
      if(!current?.target||!equal(current.target,execPath))continue;
      if(shell.writeShortcutLink(file,'update',{...current,description:name,appUserModelId:appId,icon:iconPath,iconIndex:0}))updated.push(file);
    } catch {} // A locked/corrupt link must not stop the application from opening.
  }
  if(createStartMenu&&!fs.existsSync(start)) {
    try {
      fs.mkdirSync(programs,{recursive:true});
      if(shell.writeShortcutLink(start,'create',{target:execPath,cwd:path.dirname(execPath),description:name,appUserModelId:appId,icon:iconPath,iconIndex:0}))updated.push(start);
    } catch {}
  }
  return updated;
}
module.exports={repair};
