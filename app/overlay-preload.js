'use strict';
const { contextBridge, ipcRenderer } = require('electron');
function on(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
contextBridge.exposeInMainWorld('pulseOverlay', {
  i18n: {
    bootstrap: () => ipcRenderer.sendSync('i18n:bootstrap'),
    reload: () => ipcRenderer.invoke('i18n:reload'),
    setLanguage: code => ipcRenderer.invoke('i18n:set-language', code),
    openFolder: () => ipcRenderer.invoke('i18n:open-folder'),
    onChanged: callback => on('i18n:changed', callback),
  },
  onState: (cb) => on('overlay:state', cb),
  onConfig: (cb) => on('overlay:config', cb),
  onAudioFrame: (cb) => on('overlay:audio-frame', cb),
  onPreviewMode: (cb) => on('overlay:preview-mode', cb),
  onInteraction: (cb) => on('overlay:interaction', cb),
  onHelp: (cb) => on('overlay:help', cb),
  onAnimate: (cb) => on('overlay:animate', cb),
  control: (action, value) => ipcRenderer.send('overlay:control', { action, value }),
  resizeBegin: (edge, screenX, screenY) => ipcRenderer.send('overlay:resize-begin', { edge, screenX, screenY }),
  resizeMove: (screenX, screenY) => ipcRenderer.send('overlay:resize-move', { screenX, screenY }),
  resizeEnd: () => ipcRenderer.send('overlay:resize-end'),
  toggleClickThrough: () => ipcRenderer.invoke('overlay:toggle-click-through'),
  pointerGesture: (active) => ipcRenderer.send('overlay:pointer-gesture', !!active),
  hitRegions: (regions) => ipcRenderer.send('overlay:hit-regions', regions),
  interactiveHover: (value) => ipcRenderer.send('overlay:pointer-hot', !!value),
});
