'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

function on(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('pulse', {
  i18n: {
    bootstrap: () => ipcRenderer.sendSync('i18n:bootstrap'),
    reload: () => ipcRenderer.invoke('i18n:reload'),
    setLanguage: code => ipcRenderer.invoke('i18n:set-language', code),
    openFolder: () => ipcRenderer.invoke('i18n:open-folder'),
    onChanged: callback => on('i18n:changed', callback),
  },
  lyrics: {backgroundFromDrop:(file,rel,revision)=>ipcRenderer.invoke('lyrics:background-drop',webUtils.getPathForFile(file),rel,revision),onAnalysis:cb=>on('lyrics:analysis-progress',cb),command: command=>ipcRenderer.invoke('lyrics:command',command), onProgress:cb=>on('lyrics:progress',cb), onLock:cb=>on('lyrics:locked',cb)},
  vault: { command: (command) => ipcRenderer.invoke('vault:command', command) },
  library: {
    command: command => ipcRenderer.invoke('library:command', command),
    setCoverFromDrop: (file, rel, revision) => ipcRenderer.invoke('library:cover-drop', webUtils.getPathForFile(file), rel, revision),
    prepareDrop: (files, requestId) => ipcRenderer.invoke('library:prepare-drop', Array.from(files||[]).map(file=>webUtils.getPathForFile(file)).filter(Boolean), requestId),
    onLoudness: cb => on('library:loudness-progress',cb),
    onProgress: cb => on('library:progress',cb),
    list: () => ipcRenderer.invoke('library:list'),
    playback: (rel) => ipcRenderer.invoke('library:playback', rel),
    organize: (command) => ipcRenderer.invoke('library:organize', command),
    addFiles: () => ipcRenderer.invoke('library:addFiles'),
    openFolder: () => ipcRenderer.invoke('library:openFolder'),
    refresh: () => ipcRenderer.invoke('library:refresh'),
    reveal: (rel) => ipcRenderer.invoke('library:reveal', rel),
    remove: (rel) => ipcRenderer.invoke('library:delete', rel),
    removeMany: (rels) => ipcRenderer.invoke('library:deleteMany', rels),
    favorite: (rel) => ipcRenderer.invoke('library:favorite', rel),
    onChanged: (cb) => on('library:changed', cb),
  },
  discovery: { command: command => ipcRenderer.invoke('discovery:command', command) },
  online: {
    command: command => ipcRenderer.invoke('online:command', command),
    search: (provider, query) => ipcRenderer.invoke('online:search', provider, query),
    preview: (url) => ipcRenderer.invoke('online:preview', url),
    analyze: (previewId, duration) => ipcRenderer.invoke('online:analyze', previewId, duration),
    download: (url, options = {}) => ipcRenderer.invoke('online:download', url, options),
    onProgress: (cb) => on('download:progress', cb),
    onToolStatus: (cb) => on('tool:status', cb),
  },
  updates: {
    status:()=>ipcRenderer.invoke('updates:status'),check:()=>ipcRenderer.invoke('updates:check'),configure:patch=>ipcRenderer.invoke('updates:configure',patch),
    download:mode=>ipcRenderer.invoke('updates:download',mode),cancel:()=>ipcRenderer.invoke('updates:cancel'),install:()=>ipcRenderer.invoke('updates:install'),defer:mode=>ipcRenderer.invoke('updates:defer',mode),
    onChanged:cb=>on('updates:changed',cb),onPrepare:cb=>on('updates:prepare-install',cb),prepared:reply=>ipcRenderer.send('updates:prepared',reply),
  },
  components: {status:()=>ipcRenderer.invoke('components:status'),check:()=>ipcRenderer.invoke('components:check'),install:id=>ipcRenderer.invoke('components:install',id),rollback:id=>ipcRenderer.invoke('components:rollback',id),cancel:()=>ipcRenderer.invoke('components:cancel'),onChanged:cb=>on('components:changed',cb)},
  presets:{command:c=>ipcRenderer.invoke('presets:command',c)},
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    flush: (snapshot) => ipcRenderer.sendSync('settings:flush', snapshot),
  },
  hotkeys: {
    status: () => ipcRenderer.invoke('hotkeys:status'),
    suspend: (value) => ipcRenderer.invoke('hotkeys:suspend', !!value),
    onStatus: (cb) => on('hotkeys:status', cb),
    onAction: (cb) => on('hotkey:action', cb),
  },
  gameOverlay: {
    status: () => ipcRenderer.invoke('gameOverlay:status'),
    configure: (config) => ipcRenderer.invoke('gameOverlay:configure', config),
    visual: (payload) => ipcRenderer.send('gameOverlay:visual', payload),
    openGameBar: () => ipcRenderer.invoke('gameOverlay:openGameBar'),
    launchRtss: () => ipcRenderer.invoke('gameOverlay:launchRtss'),
    openRtssDownload: () => ipcRenderer.invoke('gameOverlay:openRtssDownload'),
    restartHost: () => ipcRenderer.invoke('gameOverlay:restartHost'),
    onStatus: (cb) => on('gameOverlay:status', cb),
  },
  overlay: {
    preview: (enabled) => ipcRenderer.invoke('overlay:preview', !!enabled),
    configure: (config) => ipcRenderer.invoke('overlay:configure', config),
    state: (payload) => ipcRenderer.invoke('overlay:state', payload),
    notify: (reason) => ipcRenderer.invoke('overlay:notify', reason),
    showHelp: () => ipcRenderer.invoke('overlay:showHelp'),
    audioFrame: (frame) => ipcRenderer.send('overlay:audio-frame', frame),
    onBounds: (cb) => on('overlay:bounds', cb),
    onSettingsChanged: (cb) => on('overlay:settings-changed', cb),
    onPreviewContext: (cb) => on('overlay:preview-context', cb),
  },
  appearance: {
    chooseBackground: () => ipcRenderer.invoke('appearance:chooseBackground'),
    chooseIcon: () => ipcRenderer.invoke('appearance:chooseIcon'),
    saveIconRaster: (ref, dataUrl) => ipcRenderer.invoke('appearance:saveIconRaster', ref, dataUrl),
    saveGeneratedIcon: (name, pngDataUrl) => ipcRenderer.invoke('appearance:saveGeneratedIcon', name, pngDataUrl),
    resolve: (ref) => ipcRenderer.invoke('appearance:resolve', ref),
    iconUrl: (ref) => ipcRenderer.invoke('appearance:iconUrl', ref),
  },
  system: {
    appInfo: () => ipcRenderer.invoke('system:app-info'),
    openExternal: (url) => ipcRenderer.invoke('system:openExternal', url),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximized: (cb) => on('window:maximized', cb),
  },
});
