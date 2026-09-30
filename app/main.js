'use strict';
const I18n = require("./i18n");

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, nativeImage, globalShortcut, screen, net, session } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { extractMetadata, saveCover } = require('./metadata');
const { JsonSettingsStore, isPlainObject } = require('./settings-store');
const Library = require('./shared/library-model');
const SurfaceStyle = require('./shared/surface-style');
const SearchModel = require('./shared/online-search');
const {createSearchService} = require('./online/service');
const {createExtractor} = require('./online/extractor');
const {abortError} = require('./online/http');
const {DiscoveryStore} = require('./discovery/store');
let searchService=null, onlineExtractor=null, discoveryStore=null, discoveryLibrary=null;
async function publicDiscoveryTracks(){
  const tracks=discoveryLibrary||await scanLibrary();const favorites=new Set(getSettings().favorites.map(Library.token));
  return tracks.filter(t=>!getVault().hidden(t.rel)).map(t=>({...t,favorite:favorites.has(Library.token(t.rel))}));
}
function getExtractor(){
  if(!onlineExtractor)onlineExtractor=createExtractor({run:runProcess,resolve:()=>getComponents().resolve('yt-dlp.exe'),provision:ensureYtDlp,runtimePath:process.execPath,env:process.env,resolveProxy:url=>session?.defaultSession?.resolveProxy(url),parse:parseJsonFromOutput});
  return onlineExtractor;
}
function getSearchService(){
  if(!searchService)searchService=createSearchService({fetch:(url,options)=>net.fetch(url,options),extractInfo:(url,options)=>getExtractor().inspect(url,options),fallback:args=>getExtractor().fallback(args)});
  return searchService;
}
let trackEditor=null, coverSearch=null, libraryImporter=null, libraryEnrichment=null;
function emitLibraryProgress(payload){if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('library:progress',payload);}
function getTrackEditor(){if(!trackEditor){const {TrackEditor}=require('./library/editor');trackEditor=new TrackEditor({music:MUSIC_DIR,covers:COVER_DIR,list:()=>scanLibrary(),vault:getVault,notify:notifyLibraryChanged});}return trackEditor;}
function getCoverSearch(){if(!coverSearch)coverSearch=require('./online/covers').createCovers({search:getSearchService(),fetch:(url,options)=>net.fetch(url,options),version:APP_VERSION,progress:emitLibraryProgress});return coverSearch;}
async function normalizeCover(buffer){
  const media=require('./library/images').describe(buffer);if(media.video)throw I18n.error('CoverInvalidImage');
  await fsp.mkdir(COVER_DIR,{recursive:true});const temporary=path.join(COVER_DIR,'.validate-'+crypto.randomUUID()+'.'+media.ext);
  try{await fsp.writeFile(temporary,buffer,{flag:'wx',mode:0o600});await inspectCoverFile(temporary);return buffer;}
  finally{await fsp.unlink(temporary).catch(()=>{});}
}
async function importDuration(file,relative=false){
  const exe=getComponents().resolve('ffprobe.exe');if(!exe)return 0;
  if(relative){if(file.startsWith('vault:'))return 0;file=resolveMusicRelative(file);}
  const result=await runProcess(exe,['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file],{stallTimeoutMs:5000,totalTimeoutMs:7000});const duration=Number(result.stdout.trim());return Number.isFinite(duration)&&duration>0&&duration<7*86400?duration:0;
}
async function inspectCoverFile(file){
  return require('./library/images').inspectFile(file,nativeImage,{validateMedia:(source,media)=>require('./library/media-probe').probeMedia(source,media,BrowserWindow)});
}
async function storeImportedCover(file){return require('./library/images').storeFile(await inspectCoverFile(file),COVER_DIR);}
async function setCoverFromFile(rel,file,revision){await getTrackEditor().resolve(rel);const coverFile=await inspectCoverFile(file);return getTrackEditor().update(rel,{}, {coverFile,revision});}
function getImporter(){if(!libraryImporter){const {Importer}=require('./library/importer');libraryImporter=new Importer({music:MUSIC_DIR,staging:path.join(DATA_DIR,'import-staging'),storeCover:storeImportedCover,publish:publishMusicFile,duration:importDuration,notify:notifyLibraryChanged,progress:emitLibraryProgress});}return libraryImporter;}
function getEnrichment(){if(!libraryEnrichment){const {Enrichment}=require('./library/enrichment');libraryEnrichment=new Enrichment({editor:getTrackEditor(),lyrics:getLyrics,vault:getVault,covers:getCoverSearch(),importer:getImporter(),sanitize:normalizeCover,duration:importDuration,preferences:()=>getSettings().onlineSearch,notify:notifyLibraryChanged,progress:emitLibraryProgress});}return libraryEnrichment;}
async function libraryCommand(c={}){
  if(!c||typeof c!=='object'||Array.isArray(c))throw I18n.error('TrackBadEdit');
  switch(c.type){
    case 'metadata':return getTrackEditor().info(c.rel);
    case 'edit':return getTrackEditor().update(c.rel,c.patch,{revision:c.revision});
    case 'cover-search':{if(c.consent!==true)throw I18n.error('EnrichConsent');const {track}=await getTrackEditor().resolve(c.rel);return getCoverSearch().find({...c,track,prefs:getSettings().onlineSearch});}
    case 'cover-cancel':return getCoverSearch().cancel(c.requestId);
    case 'cover-select':{await getTrackEditor().resolve(c.rel);const bytes=await getCoverSearch().download(c.id);return getTrackEditor().update(c.rel,{}, {coverBuffer:await normalizeCover(bytes),revision:c.revision});}
    case 'cover-upload':{await getTrackEditor().resolve(c.rel);const choice=await dialog.showOpenDialog(mainWindow,{title:I18n.t('CoverUpload'),properties:['openFile'],filters:[{name:I18n.t('CoverImages'),extensions:Object.keys(require('./shared/cover-media').TYPES)}]});if(choice.canceled||!choice.filePaths?.length)return {ok:true,cancelled:true};return setCoverFromFile(c.rel,choice.filePaths[0],c.revision);}
    case 'capabilities':return getEnrichment().capabilities(c.rels,{requestId:c.requestId});
    case 'cancel-capabilities':return getEnrichment().cancelCapabilities(c.requestId);
    case 'batch-start':return getEnrichment().start(c);
    case 'job-cancel':return getEnrichment().cancel(c.id);
    case 'job-status':return {ok:true,job:libraryEnrichment?.active?.last||libraryEnrichment?.lastJob||null};
    case 'import-choose':{const choice=await dialog.showOpenDialog(mainWindow,{title:I18n.t('AppAddMusic'),properties:c.folder?['openDirectory','multiSelections']:['openFile','multiSelections'],filters:[{name:I18n.t('ImportMediaArchives'),extensions:[...MEDIA_EXTS].map(x=>x.slice(1)).concat(['zip','tar','gz','tgz'])},{name:I18n.t('AppAllFiles'),extensions:['*']}]});if(choice.canceled)return {ok:true,cancelled:true};return getImporter().prepare(choice.filePaths,{requestId:c.requestId});}
    case 'import-discard':return getImporter().discard(c.token);
    case 'import-cancel':return getImporter().cancel(c.requestId);
    default:throw I18n.error('TrackBadEdit');
  }
}
function getDiscovery(){if(!discoveryStore)discoveryStore=new DiscoveryStore(path.join(SETTINGS_DIR,'listening-history.json'));return discoveryStore;}
async function discoveryCommand(command={}){
  const store=getDiscovery();
  switch(command.type){
    case 'status':return store.status();
    case 'configure':return store.configure(command.enabled);
    case 'clear':return store.clear();
    case 'dismiss':return store.dismiss(command.rel);
    case 'recommend':return store.recommendations(await publicDiscoveryTracks());
    case 'record':{
      if(!store.data.enabled)return {ok:true,recorded:false};
      // Resolve only public library entries in main. No renderer-supplied tags or vault paths.
      const revision=store.revision;const tracks=await publicDiscoveryTracks();
      if(revision!==store.revision||getVault().hidden(command.rel))return {ok:true,recorded:false};
      const track=tracks.find(t=>t.rel===command.rel);
      return store.record(track,command);
    }
    default:return {ok:false};
  }
}
const { VaultStore } = require('./vault/store');
const { LyricsStore } = require('./lyrics/store');
let lyricsStore=null;
let vaultStore = null;
const { overlayPolicy, pointInRegions, sanitizeHitRegions } = require('./shared/overlay-policy');
const { OverlayHostTransport, createDiagnosticLog } = require('./game-overlay/transport');

const APP_ID = 'com.pulsedeck.music';
const APP_NAME = 'PulseDeck';
const APP_VERSION = require('./package.json').version;
const UpdateConfig = require('./updates/config.json');
const {UpdateManager} = require('./updates/manager');
const {ComponentManager} = require('./updates/components');
const {repoURL} = require('./updates/security');
const UpdateTransport = require('./updates/transport');
const systemTransport = net?.fetch ? UpdateTransport.forFetch((url,options)=>net.fetch(url,options)) : UpdateTransport;
const APP_HOMEPAGE = repoURL(UpdateConfig);
const ROOT_DIR = process.defaultApp ? path.resolve(__dirname, '..') : path.resolve(process.resourcesPath, '..');
const Storage = require('./storage-paths').resolveStorage({root:ROOT_DIR,platform:process.platform,env:process.env,home:process.env.USERPROFILE||os.homedir()});
const MUSIC_DIR = Storage.music;
const DATA_DIR = Storage.data;
const USER_DATA_DIR = Storage.userData;
const COVER_DIR = path.join(DATA_DIR, 'covers');
const APPEARANCE_DIR = path.join(DATA_DIR, 'appearance');
const BACKGROUND_DIR = path.join(APPEARANCE_DIR, 'backgrounds');
const CUSTOM_ICON_DIR = path.join(APPEARANCE_DIR, 'icons');
const TOOLS_DIR = Storage.legacyTools;
const LEGACY_SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SETTINGS_DIR = Storage.profile;
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');
const SETTINGS_BACKUP_FILE = path.join(SETTINGS_DIR, 'settings.backup.json');
const languageUpgrade = require('./i18n/stock-upgrade').upgradeStockOverrides(Storage.languages);
I18n.setOverrideDirectory?.(Storage.languages);
if(languageUpgrade.errors.length)console.warn(I18n.t('LanguageStockUpgradeFailed'),languageUpgrade.errors);
const CACHE_FILE = path.join(DATA_DIR, 'library-cache.json');
const CACHE_SCHEMA = 5;
const MEDIA_EXTS = new Set(['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wav', '.webm', '.mp4', '.m4b', '.mov', '.mkv']);
const BUILTIN_APP_ICON_NAMES = ['mint-violet','blue-violet','magenta-orange','ocean','forest','sunset','indigo','mono','sky','coral','lime','noir'];
const BUILTIN_APP_ICONS = new Set(BUILTIN_APP_ICON_NAMES);

for (const dir of [MUSIC_DIR, DATA_DIR, USER_DATA_DIR, COVER_DIR, APPEARANCE_DIR, BACKGROUND_DIR, CUSTOM_ICON_DIR, SETTINGS_DIR]) fs.mkdirSync(dir, { recursive: true });
app.setPath('userData', USER_DATA_DIR);
app.setAppUserModelId(APP_ID);

let mainWindow = null;
let overlayWindow = null;
let overlayHideTimer = null;
let overlayPreviewMode = false;
let overlayPreviewRequested = false;
let overlayPreviewOverride = null;
let overlayPopupUntil = 0;
let overlayHelpUntil = 0;
let overlayHitRegions = [];
let overlayHitTimer = null;
let overlayInteractionSignature = '';
let overlayPreviewSignature = null;
let overlayRuntimeConfig = null;
let overlayLastState = null;
let overlayProgrammaticBounds = 0;
let overlayLastSavedBounds = null;
let overlayResizeSession = null;
let overlayPointerInteractive = false;
let overlayGestureUntil = 0;
let gameOverlayController = null;
let gameOverlayLastVisual = null;
let gameOverlayStatus = { supported: process.platform === 'win32', running: false, active: false, renderer: 'none', reason: process.platform === 'win32' ? I18n.t("AppCheckingRTSSAndTheGameModule") : I18n.t("GameOverlayGameOverlayIsOnlySupportedOnWindows"), candidates: [], rtss: { running:false, hooked:false } };
let isQuitting = false;
let hotkeyStatus = {};
let watcher = null;
let watchTimer = null;
let currentScanPromise = null;
let forceNextScan = false;
// Files being published by import/download are invisible to the indexer until
// both audio and metadata are complete. Scanning never relocates music files.
const pendingLibraryWrites = new Set();
let previewServer = null;
let previewStarting = null;
let previewPort = 0;
const previewSources = new Map();
const preparedCache = new Map();
const activeDownloads = new Map();

let updateManager=null, componentManager=null, provisionPromise=null;
let maintenanceOperations=0,componentCheckTimer=null;
function scheduleComponentCheck(delay=12000){
  clearTimeout(componentCheckTimer);componentCheckTimer=setTimeout(async()=>{
    if(isQuitting)return;try{if(getUpdates().prefs.components&&!getComponents().busy)await getComponents().check();}catch{}
    if(!isQuitting)scheduleComponentCheck(12*60*60*1000);
  },delay);componentCheckTimer.unref?.();
}
const installPreparations=new Map(),toolProcesses=new Set();
function mediaBusy() {
  return !!libraryEnrichment?.active || !!libraryImporter?.requests?.size || !!libraryImporter?.committing || toolProcesses.size>0 || maintenanceOperations>0 || activeDownloads.size>0 || pendingLibraryWrites.size>0 || !!lyricsStore?.analyses?.size || !!lyricsStore?.exports?.size || !!lyricsStore?.exportReservation;
}
function getComponents() {
  if(componentManager)return componentManager;
  componentManager=new ComponentManager({transport:systemTransport,root:Storage.tools,legacy:TOOLS_DIR,config:UpdateConfig,current:APP_VERSION,platform:process.platform,isBusy:mediaBusy,
    probe:async file=>{await runProcess(file,[path.basename(file)==='yt-dlp.exe'?'--version':'-version'],{stallTimeoutMs:15000});}});
  componentManager.on('changed',snapshot=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('components:changed',snapshot);});
  return componentManager;
}
async function provisionTool(id) {
  // Serialize first-use provisioning without racing a second download/analysis.
  while(provisionPromise)await provisionPromise;
  if(getComponents().installed(id))return;
  const manager=getComponents(),pins=require('./updates/pins.json');
  provisionPromise=manager.install(id,pins[id]);
  try{await provisionPromise;}finally{provisionPromise=null;}
}
async function prepareInstallation({startup=false}={}) {
  if(mediaBusy()||componentManager?.busy)return ['busy'];
  if(startup)return [];
  if(!mainWindow||mainWindow.isDestroyed())return ['window'];
  const token=crypto.randomBytes(16).toString('hex');
  return new Promise(resolve=>{
    const timer=setTimeout(()=>{installPreparations.delete(token);resolve(['timeout']);},5000);
    installPreparations.set(token,{resolve:values=>{clearTimeout(timer);resolve(values);}});
    mainWindow.webContents.send('updates:prepare-install',{token});
  });
}
function getUpdates() {
  if(updateManager)return updateManager;
  updateManager=new UpdateManager({transport:systemTransport,config:UpdateConfig,current:APP_VERSION,profile:SETTINGS_DIR,cache:Storage.updates,platform:process.platform,arch:process.arch,guard:prepareInstallation,
    install:async file=>{
      if(mediaBusy()||componentManager?.busy)throw Object.assign(new Error('UPDATE_WORK_IN_PROGRESS'),{code:'UPDATE_WORK_IN_PROGRESS'});
      flushSettings();
      const backup=path.join(SETTINGS_DIR,'backups',`before-update-${APP_VERSION}-${Date.now()}.json`);
      await fsp.mkdir(path.dirname(backup),{recursive:true});if(fs.existsSync(SETTINGS_FILE))await fsp.copyFile(SETTINGS_FILE,backup);
      await new Promise((resolve,reject)=>{const child=spawn(file,['--apply','--target',ROOT_DIR,'--wait-pid',String(process.pid),'--restart'],{detached:true,stdio:'ignore',windowsHide:true});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
      app.quit();
    }});
  // Component checking has its own schedule and IPC; no application feed is required.
  updateManager.on('changed',snapshot=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('updates:changed',snapshot);});
  return updateManager;
}

const defaultSettings = {
  onlineSearch: SearchModel.preferences(),
  language: 'ru', i18nSchema: 1,
  theme: 'dark',
  accent: 'purple',
  customAccent: '#b038ae',
  view: 'grid',
  sort: 'recent',
  volume: 0.82,
  favorites: [],
  lastTrack: '',
  categoryLayout: 'top',
  categoryOrder: [],
  categoryStyles: {},
  customCategories: [],
  artistAliases: {},
  artistNames: {},
  playlistMembership: {},
  trackOrders: {},
  backgroundMode: 'off',
  customBackground: '',
  backgroundHistory: [],
  backgroundOpacity: 34,
  appIcon: 'builtin:blue-violet',
  surfaceStyle: 'glass',
  surfaceOpacity: 94,
  surfaceBorderColor: '#d9e5f0',
  surfaceBorderOpacity: 18,
  surfaceBorderThickness: 1,
  surfaceApplyAll: false,
  surfaceProfiles: {},
  hotkeys: {
    enabled: true,
    playPause: 'Alt+Shift+Space',
    next: 'Alt+Shift+Right',
    previous: 'Alt+Shift+Left',
    volumeUp: 'Alt+Shift+Up',
    volumeDown: 'Alt+Shift+Down',
    mute: 'Alt+Shift+M',
    nextPlaylist: 'Alt+Shift+PageDown',
    previousPlaylist: 'Alt+Shift+PageUp',
    showOverlay: 'Alt+Shift+O',
    showHelp: 'Alt+Shift+H',
    toggleClickThrough: 'Alt+Shift+P',
    toggleShuffle: 'Alt+Shift+S',
    cycleRepeat: 'Alt+Shift+R',
    favoriteCurrent: 'Alt+Shift+F',
    focusSearch: 'Alt+Shift+/',
    openImport: 'Alt+Shift+I',
    trimCurrentTrack: 'Alt+Shift+X',
  },
  gameOverlay: {
    mode: 'auto', onlyFullscreen: true, allowlistOnly: false, allowedGames: [], pollMs: 120,
    rtssVisualizer: true, rtssAnchor: 'top-left', rtssOffsetX: 24, rtssOffsetY: 24,
  },
  playerOverlay: {
    mode: 'off', duration: 3.2, notifyAutoNext: false,
    showCover: true, showTitle: true, showArtist: true, showProgress: true, showElapsed: true, showRemaining: true,
    showLabel: false, showControls: true, showPlaylist: false, showClickThroughToggle: true,
    label: '', opacity: 94, cornerRadius: 18,
    clickThroughWhenMinimized: true, fullscreenTopmost: true,
    visualizer: true, visualizerStyle: 'bars', visualizerPosition: 'background', visualizerHeight: 120,
    visualizerColor: '#b038ae', visualizerColor2: '#4665c2', visualizerColorMode: 'cover',
    visualizerOpacity: 100, visualizerDetail: 96, visualizerGap: 20, visualizerLineWidth: 7.0,
    visualizerRoundness: 100, visualizerRotation: 10, visualizerMirror: false, visualizerFill: true,
    sensitivity: 1.0, smoothing: 35,
    background: '#11151d', backgroundVisible: true, borderVisible: true, backgroundBlur: 18, width: 430, height: 122, bounds: null,
  },
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function normalizeAppIconRef(value) {
  const raw = String(value || 'builtin:blue-violet').trim();
  if (raw.startsWith('builtin:')) {
    const name = raw.slice('builtin:'.length);
    return BUILTIN_APP_ICONS.has(name) ? `builtin:${name}` : 'builtin:blue-violet';
  }
  if (/^custom-icons\/[a-f0-9]{24}\.png$/.test(raw)) return raw;
  return 'builtin:blue-violet';
}

function sanitizeHex(value, fallback = '#52d6b2') {
  const raw = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : fallback;
}

function syncNativeTheme(theme) {
  // CSS data-theme owns the app palette. Never override the OS media query: the
  // System swatch must keep tracking Windows even when PulseDeck is light/dark.
  nativeTheme.themeSource = 'system';
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

const VALID_THEMES = new Set(['dark','graphite','ocean','forest','midnight','plum','ember','nord','aurora','dawn','light','paper','sand','linen','system']);
const VALID_ACCENTS = new Set(['purple','blue','mint','olive','clay','teal','rose','gold','crimson','custom']);

function normalizeSettings(saved = {}) {
  const source = isPlainObject(saved) ? saved : {};
  const next = {
    ...defaultSettings,
    ...source,
    hotkeys: { ...defaultSettings.hotkeys, ...(isPlainObject(source.hotkeys) ? source.hotkeys : {}) },
    gameOverlay: { ...defaultSettings.gameOverlay, ...(isPlainObject(source.gameOverlay) ? source.gameOverlay : {}) },
    playerOverlay: { ...defaultSettings.playerOverlay, ...(isPlainObject(source.playerOverlay) ? source.playerOverlay : {}) },
  };

  next.onlineSearch = SearchModel.preferences(source.onlineSearch);
  next.language = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(String(next.language)) ? String(next.language) : 'ru';
  // Migrate the old built-in label once. Subsequent user-entered labels are never translated.
  if (!source.i18nSchema && source.playerOverlay?.label === I18n.catalogs.ru?.messages.PlayerDefaultLabel) next.playerOverlay.label = '';
  next.i18nSchema = 1;
  next.theme = VALID_THEMES.has(String(next.theme)) ? String(next.theme) : defaultSettings.theme;
  next.accent = VALID_ACCENTS.has(String(next.accent)) ? String(next.accent) : defaultSettings.accent;
  next.customAccent = sanitizeHex(next.customAccent, defaultSettings.customAccent);
  next.view = ['grid','list'].includes(next.view) ? next.view : defaultSettings.view;
  next.sort = Library.SORTS.includes(next.sort) ? next.sort : defaultSettings.sort;
  next.volume = Math.max(0, Math.min(1, finiteNumber(next.volume, defaultSettings.volume)));
  next.favorites = [...new Set((Array.isArray(next.favorites) ? next.favorites : []).map(String))];
  next.lastTrack = String(next.lastTrack || '');
  next.categoryLayout = next.categoryLayout === 'side' ? 'side' : 'top';
  next.categoryOrder = [...new Set((Array.isArray(next.categoryOrder) ? next.categoryOrder : []).map(String))];
  next.categoryStyles = isPlainObject(next.categoryStyles) ? next.categoryStyles : {};
  next.customCategories = (Array.isArray(next.customCategories) ? next.customCategories : []);
  next.backgroundMode = ['off','track','custom'].includes(next.backgroundMode) ? next.backgroundMode : 'off';
  next.customBackground = String(next.customBackground || '');
  next.backgroundHistory = [...new Set((Array.isArray(next.backgroundHistory) ? next.backgroundHistory : []).map(String))].slice(0, 5);
  next.backgroundOpacity = Math.max(1, Math.min(100, finiteNumber(next.backgroundOpacity, defaultSettings.backgroundOpacity)));
  next.appIcon = normalizeAppIconRef(next.appIcon);
  next.appIconMarkVersion = Math.max(0,Math.min(1,Math.floor(finiteNumber(next.appIconMarkVersion,0))));
  if (isPlainObject(next.customIconStyle)) {
    const cleanStops = (items, min, max, fallback) => {
      const safe = (Array.isArray(items) ? items : []).slice(0,max).map(item => ({color:sanitizeHex(item?.color, fallback),pos:Math.max(0,Math.min(100,finiteNumber(item?.pos,0)))}));
      return safe.length >= min ? safe : null;
    };
    const bg = cleanStops(next.customIconStyle.bg,2,7,'#5f79ff');
    const fg = cleanStops(next.customIconStyle.fg,1,4,'#ffffff');
    next.customIconStyle = bg && fg ? { bg, fg } : null;
  } else next.customIconStyle = null;
  Object.assign(next, SurfaceStyle.normalize(next));

  const rawHotkeys = isPlainObject(next.hotkeys) ? next.hotkeys : {};
  next.hotkeys = { ...defaultSettings.hotkeys, ...rawHotkeys, enabled: rawHotkeys.enabled !== false };
  for (const key of Object.keys(defaultSettings.hotkeys)) {
    if (key !== 'enabled') next.hotkeys[key] = String(next.hotkeys[key] || '').slice(0, 80);
  }

  const rawGameOverlay = isPlainObject(next.gameOverlay) ? next.gameOverlay : {};
  next.gameOverlay = { ...defaultSettings.gameOverlay, ...rawGameOverlay };
  {
    const legacyGameOverlayMode = String(next.gameOverlay.mode || '');
    next.gameOverlay.mode = legacyGameOverlayMode === 'native' ? 'auto' : (['off','auto','rtss','window'].includes(legacyGameOverlayMode) ? legacyGameOverlayMode : defaultSettings.gameOverlay.mode);
  }
  next.gameOverlay.onlyFullscreen = next.gameOverlay.onlyFullscreen !== false;
  next.gameOverlay.allowlistOnly = !!next.gameOverlay.allowlistOnly;
  next.gameOverlay.allowedGames = [...new Set((Array.isArray(next.gameOverlay.allowedGames) ? next.gameOverlay.allowedGames : []).map((v)=>path.basename(String(v||'')).toLowerCase()).filter(Boolean))].slice(0, 80);
  next.gameOverlay.pollMs = Math.max(60, Math.min(500, Math.round(finiteNumber(next.gameOverlay.pollMs, defaultSettings.gameOverlay.pollMs))));
  next.gameOverlay.rtssVisualizer = next.gameOverlay.rtssVisualizer !== false;
  next.gameOverlay.rtssAnchor = ['top-left','top-right','bottom-left','bottom-right'].includes(String(next.gameOverlay.rtssAnchor)) ? String(next.gameOverlay.rtssAnchor) : defaultSettings.gameOverlay.rtssAnchor;
  next.gameOverlay.rtssOffsetX = Math.max(0, Math.min(500, Math.round(finiteNumber(next.gameOverlay.rtssOffsetX, defaultSettings.gameOverlay.rtssOffsetX))));
  next.gameOverlay.rtssOffsetY = Math.max(0, Math.min(500, Math.round(finiteNumber(next.gameOverlay.rtssOffsetY, defaultSettings.gameOverlay.rtssOffsetY))));

  const rawOverlay = isPlainObject(next.playerOverlay) ? next.playerOverlay : {};
  next.playerOverlay = { ...defaultSettings.playerOverlay, ...rawOverlay };
  const overlay = next.playerOverlay;
  overlay.mode = ['off','popup','persistent'].includes(overlay.mode) ? overlay.mode : defaultSettings.playerOverlay.mode;
  overlay.duration = Math.max(0.8, Math.min(12, finiteNumber(overlay.duration, defaultSettings.playerOverlay.duration)));
  overlay.opacity = Math.max(0, Math.min(100, finiteNumber(overlay.opacity, defaultSettings.playerOverlay.opacity)));
  overlay.cornerRadius = Math.max(0, Math.min(38, finiteNumber(overlay.cornerRadius, defaultSettings.playerOverlay.cornerRadius)));
  overlay.visualizerHeight = Math.max(4, Math.min(120, finiteNumber(overlay.visualizerHeight, defaultSettings.playerOverlay.visualizerHeight)));
  overlay.sensitivity = Math.max(0.25, Math.min(3, finiteNumber(overlay.sensitivity, defaultSettings.playerOverlay.sensitivity)));
  overlay.smoothing = Math.max(0, Math.min(95, finiteNumber(overlay.smoothing, defaultSettings.playerOverlay.smoothing)));
  overlay.width = Math.max(180, Math.min(2400, finiteNumber(overlay.width, defaultSettings.playerOverlay.width)));
  overlay.height = Math.max(38, Math.min(1200, finiteNumber(overlay.height, defaultSettings.playerOverlay.height)));
  for (const c of ['visualizerColor','visualizerColor2','background']) overlay[c] = sanitizeHex(overlay[c], defaultSettings.playerOverlay[c]);
  for (const b of ['notifyAutoNext','showCover','showTitle','showArtist','showProgress','showElapsed','showRemaining','showLabel','showControls','showPlaylist','showClickThroughToggle','visualizer','backgroundVisible','borderVisible','clickThroughWhenMinimized','fullscreenTopmost','visualizerMirror','visualizerFill']) overlay[b] = !!overlay[b];
  overlay.backgroundBlur = Math.max(0, Math.min(32, finiteNumber(overlay.backgroundBlur, defaultSettings.playerOverlay.backgroundBlur)));
  overlay.visualizerStyle = ['bars','led','wave','area','mirror','radial','orb'].includes(overlay.visualizerStyle) ? overlay.visualizerStyle : defaultSettings.playerOverlay.visualizerStyle;
  overlay.visualizerPosition = ['bottom','top','center','background'].includes(overlay.visualizerPosition) ? overlay.visualizerPosition : defaultSettings.playerOverlay.visualizerPosition;
  if (['radial','orb'].includes(overlay.visualizerStyle)) overlay.visualizerPosition = 'background';
  overlay.visualizerColorMode = ['gradient','solid','rainbow','cover'].includes(overlay.visualizerColorMode) ? overlay.visualizerColorMode : defaultSettings.playerOverlay.visualizerColorMode;
  overlay.visualizerOpacity = Math.max(5, Math.min(100, finiteNumber(overlay.visualizerOpacity, defaultSettings.playerOverlay.visualizerOpacity)));
  overlay.visualizerDetail = Math.max(24, Math.min(96, Math.round(finiteNumber(overlay.visualizerDetail, defaultSettings.playerOverlay.visualizerDetail))));
  overlay.visualizerGap = Math.max(0, Math.min(78, finiteNumber(overlay.visualizerGap, defaultSettings.playerOverlay.visualizerGap)));
  overlay.visualizerLineWidth = Math.max(1, Math.min(7, finiteNumber(overlay.visualizerLineWidth, defaultSettings.playerOverlay.visualizerLineWidth)));
  overlay.visualizerRoundness = Math.max(0, Math.min(100, finiteNumber(overlay.visualizerRoundness, defaultSettings.playerOverlay.visualizerRoundness)));
  overlay.visualizerRotation = Math.max(-90, Math.min(90, finiteNumber(overlay.visualizerRotation, defaultSettings.playerOverlay.visualizerRotation)));
  overlay.label = String(overlay.label || defaultSettings.playerOverlay.label).slice(0, 50);
  if (isPlainObject(overlay.bounds)) {
    const b = overlay.bounds;
    overlay.bounds = {
      x: finiteNumber(b.x, 0), y: finiteNumber(b.y, 0),
      width: Math.max(180, finiteNumber(b.width, overlay.width)),
      height: Math.max(38, finiteNumber(b.height, overlay.height)),
    };
  } else overlay.bounds = null;
  return Library.normalizeOrganization(next);
}

const settingsStore = new JsonSettingsStore({
  file: SETTINGS_FILE,
  backupFile: SETTINGS_BACKUP_FILE,
  legacyFiles: [LEGACY_SETTINGS_FILE],
  normalize: normalizeSettings,
});

I18n.setLanguage(settingsStore.get().language);

function getSettings() {
  return settingsStore.get();
}

function mergeSettingsPatch(current, patch) {
  const allowed = new Set([
    'language', 'theme', 'accent', 'customAccent', 'view', 'sort', 'volume', 'favorites', 'lastTrack',
    'categoryLayout', 'categoryOrder', 'categoryStyles', 'customCategories',
    'artistAliases', 'artistNames', 'artistAliasHistory', 'playlistMembership', 'trackOrders', 'trackOrderSchema',
    'backgroundMode', 'customBackground', 'backgroundHistory', 'backgroundOpacity', 'appIcon',
    'hotkeys', 'playerOverlay', 'gameOverlay', 'lyricsDisplay',
    'surfaceStyle', 'surfaceOpacity', 'surfaceBorderColor', 'surfaceBorderOpacity', 'surfaceBorderThickness', 'surfaceApplyAll', 'surfaceProfiles', 'customIconStyle', 'appIconMarkVersion',
  ]);
  const next = { ...current };
  for (const [key, value] of Object.entries(patch || {})) {
    if (!allowed.has(key)) continue;
    if (key === 'trackOrders' && isPlainObject(value)) {
      next.trackOrders = { ...(current.trackOrders || {}) };
      for (const [category, orders] of Object.entries(value)) {
        if (orders === null) delete next.trackOrders[category];
        else if (isPlainObject(orders)) {
          next.trackOrders[category] = { ...(next.trackOrders[category] || {}) };
          for (const [sort, rels] of Object.entries(orders)) {
            if (rels === null) delete next.trackOrders[category][sort];
            else next.trackOrders[category][sort] = rels;
          }
        }
      }
    }
    else if (key === 'lyricsDisplay') next.lyricsDisplay={wordMode:value?.wordMode==='lines'?'lines':'words'};
    else if (key === 'hotkeys' && isPlainObject(value)) next.hotkeys = { ...(current.hotkeys || {}), ...value };
    else if (key === 'playerOverlay' && isPlainObject(value)) next.playerOverlay = { ...(current.playerOverlay || {}), ...value };
    else if (key === 'gameOverlay' && isPlainObject(value)) next.gameOverlay = { ...(current.gameOverlay || {}), ...value };
    else next[key] = value;
  }
  // Never let a stale renderer snapshot reintroduce private memberships or persist
  // session-only opaque private-track orders. Vault descriptors are main-owned.
  const privateRel = rel => String(rel||'').startsWith('vault:') || vaultStore?.isPrivateReference(rel);
  next.favorites=(next.favorites||[]).filter(rel=>!privateRel(rel));
  if(privateRel(next.lastTrack))next.lastTrack='';
  next.customCategories=(next.customCategories||[]).map(c=>({...c,tracks:(c.tracks||[]).filter(rel=>!privateRel(rel))}));
  for(const [key,value]of Object.entries(next.playlistMembership||{}))next.playlistMembership[key]={included:(value.included||[]).filter(r=>!privateRel(r)),excluded:(value.excluded||[]).filter(r=>!privateRel(r))};
  for(const [key,orders]of Object.entries(next.trackOrders||{})){
    if(next.protectedPlaylists?.[key])delete next.trackOrders[key];
    else for(const [sort,rels]of Object.entries(orders))if(Array.isArray(rels))orders[sort]=rels.filter(r=>!privateRel(r));
  }
  return next;
}

function saveSettings(patch, options = {}) {
  const old = getSettings();
  const next = settingsStore.set(mergeSettingsPatch(old, patch));
  if (next.language !== I18n.language) {
    I18n.setLanguage(next.language);
    broadcastLanguage();
  }
  if (!options.skipEffects) {
    if ('theme' in (patch || {})) syncNativeTheme(next.theme);
    if ('appIcon' in (patch || {})) applyWindowIcon(next).catch(() => {});
    if ('hotkeys' in (patch || {}) && app.isReady()) registerGlobalShortcuts(next);
    if ('playerOverlay' in (patch || {}) && app.isReady() && !options.skipOverlayApply) applyOverlayConfiguration(next.playerOverlay).catch(() => {});
    if ('gameOverlay' in (patch || {}) && app.isReady()) applyGameOverlayConfiguration(next.gameOverlay).catch(() => {});
  }
  return next;
}

function flushSettings(snapshot = null) {
  if (snapshot && isPlainObject(snapshot)) saveSettings(snapshot, { skipEffects:true, skipOverlayApply:true });
  return settingsStore.flush();
}

function commitOrganization(next) {
  const saved = settingsStore.set({ ...getSettings(), ...Library.organizationPatch(next) });
  return Library.organizationPatch(saved);
}

async function organizeLibrary(command = {}) {
  const tracks = await scanLibrary();
  const settings = getSettings();
  let result;
  const privateKeys=[command.key,command.source,command.target,...(command.keys||[])].filter(Boolean).filter(k=>settings.protectedPlaylists?.[k]);
  if(privateKeys.length && !['split-artists','split-selected'].includes(command.type))throw I18n.error("AppEnterAPasswordToPerformThisActionOn");
  if (command.type === 'bulk-remove') result = Library.bulkRemove(settings,tracks,String(command.key||''),command.rels);
  else if (command.type === 'bulk-categories') result = Library.bulkCategories(settings,tracks,command.keys,command.action,command.target);
  else if (command.type === 'alias-playlists') result = Library.aliasSelectedPlaylists(settings,tracks,command.keys,command.target);
  else if (command.type === 'membership') result = Library.toggleMembership(settings, tracks, String(command.key || ''), String(command.rel || ''));
  else if (command.type === 'merge') result = Library.mergePlaylists(settings, tracks, String(command.source || ''), String(command.target || ''));
  else if (command.type === 'alias') result = Library.aliasArtist(settings, tracks, String(command.source || ''), String(command.target || ''));
  else if (command.type === 'bulk-add') result = Library.bulkAdd(settings,tracks,String(command.key || ''),command.rels);
  else if (command.type === 'alias-selected') result = Library.aliasSelectedArtists(settings,tracks,command.rels,String(command.target || ''));
  else if (command.type === 'split-artists') result = Library.splitArtistGroups(settings,tracks,command.keys);
  else if (command.type === 'split-selected') result = Library.splitSelectedArtists(settings,tracks,command.rels);
  else throw I18n.error("AppUnknownPlaylistOperation");
  commitOrganization(result.settings);
  // Artist aliases only organize playlists. The filesystem is never changed.
  return { ...result, settings:Library.organizationPatch(getSettings()) };

}

function isInside(base, candidate) {
  const rel = path.relative(base, candidate);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function resolveMusicRelative(rel) {
  const full = path.resolve(MUSIC_DIR, String(rel || ''));
  if (full !== MUSIC_DIR && !isInside(MUSIC_DIR, full)) throw I18n.error("AppInvalidTrackPath");
  return full;
}

function stableTrackId(relativePath) {
  return crypto.createHash('sha1').update(relativePath.toLowerCase()).digest('hex').slice(0, 16);
}

async function walk(dir) {
  const out = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!fs.existsSync(path.join(full,'.pulsedeck-vault'))) out.push(...await walk(full)); }
    else if (entry.isFile() && !pendingLibraryWrites.has(Library.token(full)) && MEDIA_EXTS.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

function normalizeRel(fullPath) {
  return path.relative(MUSIC_DIR, fullPath).split(path.sep).join('/');
}

async function scanLibrary(force = false) {
  if (currentScanPromise) {
    if (!force) return currentScanPromise;
    forceNextScan = true;
    await currentScanPromise;
    return scanLibrary();
  }
  const forceMetadata = !!force || forceNextScan;
  forceNextScan = false;
  const task = (async () => {
    const cache = readJson(CACHE_FILE, {});
    const cacheCompatible = cache?.__schema === CACHE_SCHEMA;
    const nextCache = {};
    const settings = getSettings();
    const favoriteSet = new Set(settings.favorites.map((v) => String(v).toLowerCase()));
    const files = (await walk(MUSIC_DIR)).filter(file=>!getVault().hidden(normalizeRel(file)));
    const tracks = [];
    const ids = new Set();

    for (const filePath of files) {
      try {
        const stat = await fsp.stat(filePath);
        const rel = normalizeRel(filePath);
        if(getVault().hidden(rel))continue;
        const cacheKey = `${stat.size}:${Math.round(stat.mtimeMs)}`;
        let meta;
        const cached = cacheCompatible ? cache[rel] : null;
        const cachedCoverValid = !cached?.meta?.coverPath || fs.existsSync(cached.meta.coverPath);
        if (!forceMetadata && cached?.key === cacheKey && cachedCoverValid) meta = cached.meta;
        else meta = await extractMetadata(filePath, COVER_DIR, stat);
        if (meta.coverPath && !fs.existsSync(meta.coverPath)) meta.coverPath = '';
        // Missing artwork is deliberately re-checked on a real filesystem change or
        // manual refresh, so dropping cover.jpg/folder.jpg beside old files works.
        delete meta.embeddedLyrics; // Lyric text is loaded on demand, never duplicated into the library cache.
        nextCache[rel] = { key: cacheKey, meta };
        let trackId = /^[a-f0-9]{16,64}$/i.test(meta._pulseTrackId || '') ? meta._pulseTrackId : stableTrackId(rel);
        if (ids.has(trackId)) trackId = stableTrackId(rel);
        ids.add(trackId);
        tracks.push({
          id:trackId,
          editRevision:meta._pulseRevision||null,
          rel,
          title: meta.title || path.basename(filePath, path.extname(filePath)),
          artist: meta.artist || '',
          album: meta.album || '',
          genre: meta.genre || '',
          duration: Number(meta.duration) || 0,
          coverUrl: meta.coverPath ? pathToFileURL(meta.coverPath).href : '',
          coverType: require('./shared/cover-media').typeOf(meta.coverPath,meta.coverType),
          audioUrl: pathToFileURL(filePath).href,
          sourceUrl: meta.sourceUrl || '',
          sourceProvider: (() => {
            const ex = String(meta.extractor || meta.extractor_key || '').toLowerCase();
            const su = String(meta.sourceUrl || '').toLowerCase();
            if (ex.includes('youtube') || su.includes('youtube.com') || su.includes('youtu.be')) return 'youtube';
            if (ex.includes('soundcloud') || su.includes('soundcloud.com')) return 'soundcloud';
            if (ex.includes('bandcamp') || /\.bandcamp\.com\//.test(su)) return 'bandcamp';
            if (ex.includes('newgrounds') || /newgrounds\.com\/audio\/listen\//.test(su)) return 'newgrounds';
            if (ex.includes('archiveorg') || /archive\.org\/details\//.test(su)) return 'archive';
            return meta.downloaded ? 'online' : 'local';
          })(),
          downloaded: !!meta.downloaded,
          favorite: favoriteSet.has(rel.toLowerCase()),
          addedAt:Number(meta._pulseAddedAt) > 0 ? Number(meta._pulseAddedAt) : (stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.ctimeMs),
          modifiedAt: stat.mtimeMs,
          size: stat.size,
          ext: path.extname(filePath).slice(1).toUpperCase(),
        });
      } catch (error) {
        console.warn(I18n.t('IndexingFailed'), filePath, error.message);
      }
    }
    const updatedFavorites = new Set(getSettings().favorites.map(Library.token));
    for (const track of tracks) track.favorite = updatedFavorites.has(Library.token(track.rel));
    nextCache.__schema = CACHE_SCHEMA;
    try { writeJsonAtomic(CACHE_FILE, nextCache); } catch {}
    tracks.sort((a, b) => b.addedAt - a.addedAt || a.title.localeCompare(b.title, 'ru'));
    discoveryLibrary=tracks;return tracks;
  })();
  const running = task.finally(() => { if (currentScanPromise === running) currentScanPromise = null; });
  currentScanPromise = running;
  return running;
}

function notifyLibraryChanged() {
  discoveryLibrary=null;
  forceNextScan = true;
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('library:changed');
  }, 500);
}

function startWatcher() {
  try {
    watcher = fs.watch(MUSIC_DIR, { recursive: true }, notifyLibraryChanged);
    watcher.on('error', () => {});
  } catch {
    // Manual refresh remains available as a fallback.
  }
}

function uniqueDestination(sourcePath) {
  const ext = path.extname(sourcePath);
  const base = path.basename(sourcePath, ext);
  let out = path.join(MUSIC_DIR, `${base}${ext}`);
  let i = 2;
  while (fs.existsSync(out) || pendingLibraryWrites.has(Library.token(out)) || fs.existsSync(`${out}.pulse.json`) || fs.existsSync(`${out}.info.json`)) out = path.join(MUSIC_DIR, `${base} (${i++})${ext}`);
  return out;
}

async function publishMusicFile(sourcePath, sidecar = null) {
  const destination = uniqueDestination(sourcePath);
  const key = Library.token(destination);
  pendingLibraryWrites.add(key);
  let copied = false;
  try {
    await fsp.copyFile(sourcePath, destination, fs.constants.COPYFILE_EXCL);
    copied = true;
    if (sidecar) await fsp.writeFile(`${destination}.pulse.json`, JSON.stringify(sidecar, null, 2), { encoding:'utf8', flag:'wx' });
    return destination;
  } catch (error) {
    if (copied) await fsp.unlink(destination).catch(() => {});
    throw error;
  } finally { pendingLibraryWrites.delete(key); }
}

async function addFiles() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: I18n.t("AppAddMusic"),
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: I18n.t("AppMusicAndMedia"), extensions: [...MEDIA_EXTS].map((x) => x.slice(1)) },
      { name: I18n.t("AppAllFiles"), extensions: ['*'] },
    ],
  });
  if (result.canceled) return { added: 0 };
  let added = 0;
  for (const src of result.filePaths) {
    if (!MEDIA_EXTS.has(path.extname(src).toLowerCase())) continue;
    await publishMusicFile(src);
    added++;
  }
  notifyLibraryChanged();
  return { added };
}

function runProcess(exe, args, options = {}) {
  return new Promise((resolve, reject) => {
    if(options.signal?.aborted){reject(abortError());return;}
    const child=spawn(exe,args,{windowsHide:true,cwd:options.cwd||ROOT_DIR,shell:false,env:options.env||process.env});
    toolProcesses.add(child);
    let stdout='',stderr='',settled=false,watchdog=null,deadline=null;
    const cleanup=()=>{clearTimeout(watchdog);clearTimeout(deadline);options.signal?.removeEventListener('abort',abort);};
    const kill=()=>{try{child.kill();}catch{}if(process.platform==='win32'&&child.pid)try{spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,shell:false});}catch{}};
    const stop=error=>{if(settled)return;settled=true;cleanup();kill();reject(error);};
    const abort=()=>stop(abortError());
    const timeoutMs=Math.max(0,Number(options.stallTimeoutMs)||0);
    const kick=()=>{if(!timeoutMs)return;clearTimeout(watchdog);watchdog=setTimeout(()=>stop(Object.assign(I18n.error('AppDownloadReportedNoProgressForOverSecondsAnd',{value1:Math.round(timeoutMs/1000)}),{code:'SEARCH_TIMEOUT'})),timeoutMs);};
    const chunk=(value,isErr)=>{if(settled)return;kick();const text=value.toString('utf8');if(isErr)stderr=(stderr+text).slice(-12*1024*1024);else stdout=(stdout+text).slice(-32*1024*1024);options.onData?.(text,isErr);};
    child.stdout?.on('data',c=>chunk(c,false));child.stderr?.on('data',c=>chunk(c,true));
    options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
    if(!settled){kick();if(options.totalTimeoutMs)deadline=setTimeout(()=>stop(Object.assign(new Error('SEARCH_TIMEOUT'),{code:'SEARCH_TIMEOUT'})),options.totalTimeoutMs);}
    child.once('error',error=>{toolProcesses.delete(child);if(settled)return;settled=true;cleanup();reject(error);});
    child.once('close',code=>{toolProcesses.delete(child);if(settled)return;settled=true;cleanup();if(code===0)resolve({stdout,stderr});else reject(new Error((stderr||stdout||I18n.t('AppProcessExitedWithCode',{value1:code})).trim().slice(-5000)));});
  });
}

function runProcessBuffer(exe, args, options = {}) {
  const maxBytes = Number(options.maxBytes) || 64 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, cwd: options.cwd || ROOT_DIR, shell: false });
    toolProcesses.add(child);child.once('close',()=>toolProcesses.delete(child));child.once('error',()=>toolProcesses.delete(child));
    const chunks = [];
    let total = 0;
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        child.kill();
        reject(I18n.error("AppAudioAnalysisExceededTheSafeMemoryLimit"));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); if (stderr.length > 1024 * 1024) stderr = stderr.slice(-1024 * 1024); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error((stderr || I18n.t("AppFFmpegExitedWithCode", {value1:(code)})).trim().slice(-3000)));
    });
  });
}

async function ensureYtDlp() {
  let file=getComponents().resolve('yt-dlp.exe');if(file)return file;
  if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('tool:status',{text:I18n.t('AppPreparingTheOnlineDownloader')});
  await provisionTool('ytdlp');file=getComponents().resolve('yt-dlp.exe');
  if(!file)throw I18n.error('COMPONENT_MISSING_BINARY');return file;
}

async function ensureFfmpeg() {
  let ffmpeg=getComponents().resolve('ffmpeg.exe'),ffprobe=getComponents().resolve('ffprobe.exe');
  if(ffmpeg&&ffprobe)return {ffmpeg,ffprobe};
  if(process.platform!=='win32')throw I18n.error('AppFFmpegForTrimmingIsInstalledWithTheWindows');
  await provisionTool('ffmpeg');ffmpeg=getComponents().resolve('ffmpeg.exe');ffprobe=getComponents().resolve('ffprobe.exe');
  if(!ffmpeg||!ffprobe)throw I18n.error('COMPONENT_MISSING_BINARY');return {ffmpeg,ffprobe};
}

function parseJsonFromOutput(text) {
  const trimmed = String(text || '').trim();
  try { return JSON.parse(trimmed); } catch {}
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch {}
  }
  throw I18n.error("AppServiceReturnedAnUnexpectedResponse");
}

function validateHttpUrl(value) {
  let u;
  try { u = new URL(String(value || '').trim()); } catch { throw I18n.error("AppPasteAValidLink"); }
  if (!['http:', 'https:'].includes(u.protocol)) throw I18n.error("AppOnlyHTTPHTTPSLinksAreSupported");
  return u;
}

function isSpotifyHost(host) {
  const h = host.toLowerCase();
  return h === 'spotify.com' || h.endsWith('.spotify.com') || h === 'spotify.link';
}

function isYouTubeHost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be' || h.endsWith('.youtu.be') || h === 'youtube-nocookie.com' || h.endsWith('.youtube-nocookie.com');
}

function isSoundCloudHost(host) {
  const h = String(host || '').toLowerCase();
  return h === 'soundcloud.com' || h.endsWith('.soundcloud.com');
}

function detectOnlineProvider(meta, fallbackUrl = '') {
  const extractor = `${meta?.extractor_key || ''} ${meta?.extractor || ''}`.toLowerCase();
  if (extractor.includes('youtube')) return 'youtube';
  if (extractor.includes('soundcloud')) return 'soundcloud';
  if (extractor.includes('bandcamp')) return 'bandcamp';
  if (extractor.includes('newgrounds')) return 'newgrounds';
  if (extractor.includes('archiveorg')) return 'archive';

  for (const candidate of [meta?.webpage_url, meta?.original_url, fallbackUrl]) {
    try {
      const host = new URL(String(candidate || '')).hostname;
      if (isYouTubeHost(host)) return 'youtube';
      if (isSoundCloudHost(host)) return 'soundcloud';
      if (host.endsWith('.bandcamp.com')) return 'bandcamp';
      if (host==='newgrounds.com'||host==='www.newgrounds.com') return 'newgrounds';
      if (host==='archive.org'||host==='www.archive.org') return 'archive';
    } catch {}
  }
  return 'other';
}

function ytdlpSearchTarget(provider, query) {
  const q = String(query || '').trim();
  if (!q) throw I18n.error("AppEnterATrackTitleOrArtist");
  if (provider === 'soundcloud') return `scsearch12:${q}`;
  return `ytsearch12:${q}`;
}

function pickThumbnail(meta) {
  const all = [];
  if (/^https?:/i.test(String(meta?.thumbnail || ''))) all.push({ url: meta.thumbnail, width: 0, height: 0, preference: 0 });
  for (const t of Array.isArray(meta?.thumbnails) ? meta.thumbnails : []) {
    if (!/^https?:/i.test(String(t?.url || ''))) continue;
    if (/storyboard/i.test(String(t.id || ''))) continue;
    all.push(t);
  }
  all.sort((a, b) => ((Number(b.width) || 0) * (Number(b.height) || 0) + (Number(b.preference) || 0) * 1000) - ((Number(a.width) || 0) * (Number(a.height) || 0) + (Number(a.preference) || 0) * 1000));
  return all[0]?.url || '';
}

async function saveRemoteCover(url, seed) {
  if (!/^https?:\/\//i.test(String(url || ''))) return '';
  try {
    const response = await (net?.fetch ? net.fetch.bind(net) : fetch)(url, { credentials:'omit', redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 PulseDeck/2.3.4', 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' } });
    if (!response.ok) return '';
    const len = Number(response.headers.get('content-length') || 0);
    if (len > 16 * 1024 * 1024) return '';
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length < 32 || data.length > 16 * 1024 * 1024) return '';
    const mime = response.headers.get('content-type') || '';
    return await saveCover(COVER_DIR, seed, mime, data);
  } catch {
    return '';
  }
}

function friendlyYtError(error) {
  const msg = String(error?.message || error || I18n.t("AppDownloadError"));
  if (/Unsupported URL/i.test(msg)) return I18n.t("AppThisLinkIsNotSupportedYetTryA");
  if (/Sign in|cookies|bot|confirm you/i.test(msg)) return I18n.t("AppSiteRequiresSignInOrAdditionalVerificationTry");
  if (/403|forbidden/i.test(msg)) return I18n.t("AppSourceDeniedAccessToThisFileTryAnother");
  if (/ffmpeg.*not found|ffmpeg is not installed/i.test(msg)) return I18n.t("AppThisOperationRequiresFFmpegPulseDeckTriedToPrepare");
  const classified=SearchModel.classifyError(error);
  if(['SEARCH_NETWORK','SEARCH_TIMEOUT','SEARCH_TLS','SEARCH_TOOL','SEARCH_RATE_LIMIT','SEARCH_DRM','SEARCH_REMOVED'].includes(classified.code))return I18n.t(classified.code);
  return msg.slice(-1600);
}

async function searchOnline(provider, query) {
  const result=await getSearchService().command({type:'page',provider,query,requestId:'legacy'});
  if(!result.ok)throw I18n.error(result.error.code);
  return result.items;
}

function sanitizeForwardHeaders(headers) {
  const out = {};
  const allowed = new Set(['user-agent', 'referer', 'origin', 'accept-language']);
  for (const [key, value] of Object.entries(headers || {})) {
    if (allowed.has(key.toLowerCase()) && typeof value === 'string') out[key] = value;
  }
  if (!out['User-Agent'] && !out['user-agent']) out['User-Agent'] = 'Mozilla/5.0 PulseDeck/2.3.4';
  return out;
}

async function startPreviewServer() {
  if (previewServer && previewPort) return previewPort;
  if (previewStarting) return previewStarting;
  previewStarting = (async () => {
  previewServer = http.createServer(async (req, res) => {
    try {
      if((req.url||'').startsWith('/vault/')) {
        if(req.headers.host!==`127.0.0.1:${previewPort}`){res.writeHead(403);res.end();return;}
        await getVault().serve(req,res);return;
      }
      const token = decodeURIComponent((req.url || '').split('/').pop() || '');
      const source = previewSources.get(token);
      if (!source || source.expiresAt < Date.now()) {
        res.writeHead(404); res.end(I18n.t('PreviewExpired')); return;
      }
      const headers = { ...source.headers };
      if (req.headers.range) headers.Range = req.headers.range;
      const upstream = await (net?.fetch ? net.fetch.bind(net) : fetch)(source.url, { credentials:'omit', method: req.method === 'HEAD' ? 'HEAD' : 'GET', redirect: 'follow', headers });
      const pass = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'etag', 'last-modified'];
      const responseHeaders = { 'Access-Control-Allow-Origin': '*' };
      for (const key of pass) {
        const value = upstream.headers.get(key);
        if (value) responseHeaders[key] = value;
      }
      res.writeHead(upstream.status, responseHeaders);
      if (req.method === 'HEAD' || !upstream.body) { res.end(); return; }
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (error) {
      if (!res.headersSent) res.writeHead(502);
      try { res.end(I18n.t('PreviewUnavailable')); } catch {}
    }
  });
  await new Promise((resolve, reject) => {
    previewServer.once('error', reject);
    previewServer.listen(0, '127.0.0.1', () => { previewServer.off('error', reject); resolve(); });
  });
  previewPort = previewServer.address().port;
  return previewPort;
  })();
  try { return await previewStarting; }
  catch (error) { previewServer?.close(); previewServer = null; previewPort = 0; throw error; }
  finally { previewStarting = null; }
}

function previewSourceFromMeta(meta) {
  const candidates = [];
  if (meta?.url) candidates.push(meta);
  for (const item of Array.isArray(meta?.requested_downloads) ? meta.requested_downloads : []) if (item?.url) candidates.push(item);
  for (const item of Array.isArray(meta?.requested_formats) ? meta.requested_formats : []) if (item?.url) candidates.push(item);
  for (const item of Array.isArray(meta?.formats) ? meta.formats : []) if (item?.url && item.acodec && item.acodec !== 'none') candidates.push(item);
  candidates.sort((a, b) => (Number(b.abr || b.tbr) || 0) - (Number(a.abr || a.tbr) || 0));
  const chosen = candidates[0];
  if (!chosen?.url) throw I18n.error("AppSourceDidNotProvideAPreviewStream");
  return { url: chosen.url, headers: sanitizeForwardHeaders(chosen.http_headers || meta.http_headers || {}) };
}

function publicPrepared(prepared) {
  return {
    ok: true,
    previewId: prepared.previewId,
    previewUrl: prepared.previewUrl,
    title: prepared.title,
    artist: prepared.artist,
    album: prepared.album,
    duration: prepared.duration,
    coverUrl: prepared.coverPath ? pathToFileURL(prepared.coverPath).href : prepared.thumbnail,
    sourceUrl: prepared.sourceUrl,
    provider: prepared.provider,
    canTrim: prepared.provider === 'youtube',
  };
}

async function prepareOnline(rawUrl) {
  const parsed = validateHttpUrl(rawUrl);
  if (isSpotifyHost(parsed.hostname)) {
    return { ok: false, code: 'SPOTIFY_NO_DOWNLOAD', message: I18n.t("AppSpotifyDoesNotAllowThirdPartyAppsTo") };
  }
  const cached = preparedCache.get(parsed.href);
  if (cached && cached.expiresAt > Date.now() && previewSources.has(cached.previewId)) return publicPrepared(cached);

  const meta = getSearchService().cachedInfo(parsed.href) || await getExtractor().inspect(parsed.href);
  const availability=SearchModel.availabilityFromMetadata(meta);
  if(availability.state==='blocked')return {ok:false,code:availability.reason,message:I18n.t(availability.reason)};
  const provider = detectOnlineProvider(meta, parsed.href);
  const stream = previewSourceFromMeta(meta);
  const port = await startPreviewServer();
  const previewId = crypto.randomBytes(18).toString('hex');
  previewSources.set(previewId, { ...stream, provider, expiresAt: Date.now() + 20 * 60 * 1000 });
  const thumbnail = pickThumbnail(meta);
  const coverPath = await saveRemoteCover(thumbnail, `${parsed.href}:${meta.id || meta.title || 'cover'}`);
  const prepared = {
    previewId,
    previewUrl: `http://127.0.0.1:${port}/preview/${previewId}`,
    sourceUrl: meta.webpage_url || parsed.href,
    originalUrl: parsed.href,
    title: meta.track || meta.title || '',
    artist: meta.artist || meta.creator || meta.uploader || meta.channel || '',
    album: meta.album || '',
    duration: Number(meta.duration) || 0,
    provider,
    thumbnail,
    coverPath,
    meta,
    expiresAt: Date.now() + 15 * 60 * 1000,
  };
  preparedCache.set(parsed.href, prepared);
  return publicPrepared(prepared);
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function pcmFrames(buffer, absoluteStart, sampleRate = 8000) {
  const samples = new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 2));
  const frameSamples = sampleRate;
  const step = Math.floor(sampleRate / 2);
  const sub = Math.floor(sampleRate * 0.05);
  const frames = [];
  for (let start = 0; start + frameSamples <= samples.length; start += step) {
    let sum2 = 0, peak = 0, crossings = 0;
    let prev = samples[start] / 32768;
    const subDb = [];
    for (let i = 0; i < frameSamples; i++) {
      const x = samples[start + i] / 32768;
      sum2 += x * x;
      peak = Math.max(peak, Math.abs(x));
      if ((x >= 0) !== (prev >= 0)) crossings++;
      prev = x;
    }
    for (let off = 0; off < frameSamples; off += sub) {
      let e = 0, count = 0;
      for (let i = off; i < Math.min(frameSamples, off + sub); i++) { const x = samples[start + i] / 32768; e += x * x; count++; }
      const rms = Math.sqrt(e / Math.max(1, count));
      subDb.push(20 * Math.log10(rms + 1e-7));
    }
    const rms = Math.sqrt(sum2 / frameSamples);
    const rmsDb = 20 * Math.log10(rms + 1e-7);
    const activeRatio = subDb.filter((v) => v > -42).length / Math.max(1, subDb.length);
    const meanDb = subDb.reduce((a, b) => a + b, 0) / Math.max(1, subDb.length);
    const variance = subDb.reduce((a, b) => a + (b - meanDb) ** 2, 0) / Math.max(1, subDb.length);
    const dynamicStd = Math.sqrt(variance);
    const zcr = crossings / frameSamples;
    const crest = peak / (rms + 1e-6);

    // Lightweight periodicity estimate. It is deliberately conservative: the result is only a suggestion.
    const n = Math.min(frameSamples, 2400);
    let denom = 0;
    for (let i = 0; i < n; i += 4) { const x = samples[start + i] / 32768; denom += x * x; }
    let periodicity = 0;
    if (denom > 1e-6) {
      for (let lag = 20; lag <= 180; lag += 8) {
        let corr = 0, d2 = 0;
        for (let i = lag; i < n; i += 4) {
          const a = samples[start + i] / 32768;
          const b = samples[start + i - lag] / 32768;
          corr += a * b; d2 += b * b;
        }
        periodicity = Math.max(periodicity, corr / Math.sqrt((denom + 1e-9) * (d2 + 1e-9)));
      }
    }
    const loud = clamp((rmsDb + 44) / 26, 0, 1);
    const continuity = clamp(activeRatio, 0, 1);
    const stable = clamp(1 - dynamicStd / 18, 0, 1);
    const zcrFit = clamp(1 - Math.abs(zcr - 0.09) / 0.13, 0, 1);
    const crestFit = clamp(1 - Math.max(0, crest - 7) / 9, 0, 1);
    const musicScore = clamp(0.34 * loud + 0.28 * continuity + 0.16 * clamp(periodicity, 0, 1) + 0.10 * stable + 0.07 * zcrFit + 0.05 * crestFit, 0, 1);
    frames.push({ t: absoluteStart + start / sampleRate, score: musicScore, rmsDb, activeRatio });
  }
  return frames;
}

function smoothScores(frames) {
  return frames.map((frame, i) => {
    let total = 0, weight = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(frames.length - 1, i + 2); j++) {
      const w = 3 - Math.abs(j - i);
      total += frames[j].score * w; weight += w;
    }
    return { ...frame, smooth: total / weight };
  });
}

function findSuggestedStart(frames, maxStart) {
  const scored = smoothScores(frames);
  for (let i = 0; i < scored.length - 5; i++) {
    const window = scored.slice(i, i + 6);
    const good = window.filter((f) => f.smooth >= 0.58 && f.rmsDb > -39).length;
    if (good >= 5) return clamp(scored[i].t - 0.35, 0, maxStart);
  }
  return 0;
}

function findSuggestedEnd(frames, duration, minEnd) {
  const scored = smoothScores(frames);
  for (let i = scored.length - 1; i >= 5; i--) {
    const window = scored.slice(i - 5, i + 1);
    const good = window.filter((f) => f.smooth >= 0.58 && f.rmsDb > -39).length;
    if (good >= 5) return clamp(scored[i].t + 1.1, minEnd, duration);
  }
  return duration;
}

function profileFromFrames(frames, duration, points = 72) {
  if (!frames.length || !duration) return [];
  const out = [];
  for (let i = 0; i < points; i++) {
    const target = (i / Math.max(1, points - 1)) * duration;
    let best = null, distance = Infinity;
    for (const f of frames) {
      const d = Math.abs(f.t - target);
      if (d < distance) { distance = d; best = f; }
    }
    out.push(best && distance < Math.max(3, duration / points * 2.5) ? Math.round(clamp(best.score, 0.04, 1) * 100) : 12);
  }
  return out;
}

async function decodePcm(previewUrl, start, seconds) {
  const { ffmpeg } = await ensureFfmpeg();
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (start > 0.05) args.push('-ss', start.toFixed(3));
  args.push('-i', previewUrl, '-vn', '-ac', '1', '-ar', '8000', '-t', Math.max(1, seconds).toFixed(3), '-f', 's16le', 'pipe:1');
  return runProcessBuffer(ffmpeg, args, { maxBytes: 40 * 1024 * 1024 });
}

async function analyzeOnline(previewId, rawDuration) {
  const source = previewSources.get(String(previewId || ''));
  if (!source) throw I18n.error("AppPreviewHasExpiredOpenTheResultAgain");
  if (source.provider !== 'youtube') throw I18n.error("AppAutomaticTrimmingIsOnlyAvailableForYouTubeVideos");
  const duration = Math.max(0, Number(rawDuration) || 0);
  if (!duration || duration < 8) return { start: 0, end: duration, confidence: 0, profile: [], method: I18n.t("AppShortTrackKeepingItInFull") };

  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tool:status', { text: I18n.t("AppAnalysingMusicalActivityAtTheStartAndEnd") });
  const url = `http://127.0.0.1:${previewPort}/preview/${previewId}`;
  const edge = Math.min(180, duration);
  const frames = [];
  const first = await decodePcm(url, 0, edge);
  frames.push(...pcmFrames(first, 0));
  if (duration > edge + 5) {
    const tailStart = Math.max(0, duration - edge);
    const last = await decodePcm(url, tailStart, edge);
    frames.push(...pcmFrames(last, tailStart));
  }
  frames.sort((a, b) => a.t - b.t);
  let start = findSuggestedStart(frames.filter((f) => f.t <= Math.min(edge, duration * 0.48)), Math.min(duration * 0.45, 120));
  let end = findSuggestedEnd(frames.filter((f) => f.t >= Math.max(0, duration - edge)), duration, Math.max(duration * 0.55, start + 5));
  if (start < 1.4) start = 0;
  if (duration - end < 1.4) end = duration;
  if (end - start < Math.min(12, duration * 0.55)) { start = 0; end = duration; }

  const startTrim = start / duration;
  const endTrim = (duration - end) / duration;
  const confidence = clamp((Math.max(startTrim, endTrim) * 3.2) + 0.38, 0.42, 0.88);
  return {
    start: Number(start.toFixed(2)),
    end: Number(end.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    profile: profileFromFrames(frames, duration),
    method: I18n.t("AppHeuristicsLoudnessContinuityDynamicsAndPeriodicityThisIs"),
  };
}

async function downloadUrl(rawUrl, options = {}) {
  const key = validateHttpUrl(rawUrl).href;
  if (activeDownloads.has(key)) return activeDownloads.get(key);
  const job = performDownload(key, options);
  activeDownloads.set(key, job);
  try { return await job; } finally { if (activeDownloads.get(key) === job) activeDownloads.delete(key); }
}

async function performDownload(rawUrl, options = {}) {
  const parsed = validateHttpUrl(rawUrl);
  if (isSpotifyHost(parsed.hostname)) {
    return { ok: false, code: 'SPOTIFY_NO_DOWNLOAD', message: I18n.t("AppSpotifyDoesNotAllowThirdPartyAppsTo2") };
  }

  const jobId = /^[a-zA-Z0-9_-]{1,80}$/.test(String(options.jobId || '')) ? String(options.jobId) : crypto.randomUUID();
  const send = (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('download:progress', { jobId, url: parsed.href, ...payload });
  };
  let staging = '';
  try {
    send({ stage:'metadata', percent:0, text:I18n.t("AppCheckingDownloadTools") });
    const exe = await ensureYtDlp();
    const { ffmpeg, ffprobe } = await ensureFfmpeg();
    send({ stage:'metadata', percent:0, text:I18n.t("AppCheckingTheSourceAndMetadata") });
    const preparedResult = await prepareOnline(parsed.href);
    if (!preparedResult.ok) {
      send({ stage:'error', message:preparedResult.message || I18n.t("AppSourceUnavailable") });
      return { ...preparedResult, jobId };
    }
    const prepared = preparedCache.get(parsed.href);
    const meta = prepared?.meta || {};
    const duration = Number(prepared?.duration) || Number(meta.duration) || 0;
    const canTrim = prepared?.provider === 'youtube';
    let trimStart = canTrim ? clamp(Number(options.start) || 0, 0, Math.max(0, duration - 1)) : 0;
    let trimEnd = canTrim ? Number(options.end) : duration;
    if (!Number.isFinite(trimEnd) || trimEnd <= 0) trimEnd = duration || 0;
    if (duration) trimEnd = clamp(trimEnd, trimStart + 1, duration);
    const trimmed = duration > 0 && (trimStart > 0.2 || trimEnd < duration - 0.2);

    staging = await fsp.mkdtemp(path.join(app.getPath('temp'), `PulseDeck-Download-${jobId.slice(0,8)}-`));
    const outputTemplate = path.join(staging, '%(title).150B [%(id)s].%(ext)s');
    let pending = '';
    const parseProgress = (text) => {
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('__PULSE_POST__')) {
          const msg = line.slice('__PULSE_POST__'.length).trim();
          send({ stage:'postprocess', percent:100, text: msg || I18n.t("AppPreparingTheAudioFile") });
          continue;
        }
        const pm = line.match(/__PULSE_PROGRESS__([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)/);
        if (!pm) continue;
        const status = pm[1].trim();
        const percentText = String(pm[2]).replace(/[^0-9.,]/g,'').replace(',','.');
        const pct = percentText && Number.isFinite(Number(percentText)) ? Math.max(0, Math.min(100, Number(percentText))) : null;
        send({
          stage:'download', percent:pct, status,
          speed:pm[3].trim(), eta:pm[4].trim(), bytes:pm[5].trim(),
          text:I18n.t("AppDownloading", {value1:(prepared?.title || meta.title || I18n.msg("AppTrack"))}),
        });
      }
    };

    const extractorOptions=await getExtractor().environment(parsed.href);
    const args = [
      ...extractorOptions.args,
      '--no-playlist', '--windows-filenames', '--newline', '--no-warnings',
      '--socket-timeout', '20', '--retries', '10', '--fragment-retries', '10',
      '--retry-sleep', 'http:linear=1::4', '--retry-sleep', 'fragment:linear=1::4',
      '--ffmpeg-location', path.dirname(ffmpeg),
      '-f', 'bestaudio/best', '-x', '--audio-format', 'm4a', '--audio-quality', '0',
      '--progress-template', 'download:__PULSE_PROGRESS__%(progress.status)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._total_bytes_str)s',
      '--progress-template', 'postprocess:__PULSE_POST__%(progress.postprocessor)s %(progress.status)s',
      '-o', outputTemplate,
    ];
    if (trimmed) args.push('--download-sections', `*${trimStart.toFixed(3)}-${trimEnd.toFixed(3)}`, '--force-keyframes-at-cuts');
    args.push(parsed.href);

    send({ stage:'download', percent:0, text:I18n.t("AppStartingDownloadOf", {value1:(prepared?.title || meta.title || I18n.msg("AppTrack"))}) });
    await runProcess(exe, args, { env:extractorOptions.env, onData:(text) => parseProgress(text), stallTimeoutMs:60000 });
    if (pending) parseProgress(`${pending}
`);

    send({ stage:'verify', percent:100, text:I18n.t("AppCheckingTheDownloadedAudioFile") });
    const stagedFiles = (await fsp.readdir(staging, { withFileTypes:true }))
      .filter((e) => e.isFile())
      .map((e) => path.join(staging,e.name))
      .filter((f) => MEDIA_EXTS.has(path.extname(f).toLowerCase()));
    if (!stagedFiles.length) throw I18n.error("AppDownloaderFinishedWithoutProducingAnAudioFile");
    stagedFiles.sort((a,b) => fs.statSync(b).size - fs.statSync(a).size);
    const staged = stagedFiles[0];
    const stat = await fsp.stat(staged);
    if (stat.size < 16 * 1024) throw I18n.error("AppAudioFileIsTooSmallTheSourceMay");
    const probe = await runProcess(ffprobe, ['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',staged], { stallTimeoutMs:20000 });
    const verifiedDuration = Number(String(probe.stdout).trim());
    if (!Number.isFinite(verifiedDuration) || verifiedDuration <= 0.2) throw I18n.error("AppFFprobeCouldNotVerifyTheDownloadedAudio");

    let coverPath = prepared?.coverPath || '';
    if (!coverPath || !fs.existsSync(coverPath)) coverPath = await saveRemoteCover(pickThumbnail(meta), `${parsed.href}:${meta.id || meta.title}:download`);
    const sidecar = {
      title: prepared?.title || meta.track || meta.title || path.basename(staged, path.extname(staged)),
      artist: prepared?.artist || meta.artist || meta.creator || meta.uploader || meta.channel || '',
      album: prepared?.album || meta.album || '',
      duration: verifiedDuration,
      coverPath,
      sourceUrl: meta.webpage_url || parsed.href,
      downloaded: true,
      downloadedAt: Date.now(),
      extractor: meta.extractor_key || meta.extractor || prepared?.provider || '',
      trimStart: trimmed ? trimStart : 0,
      trimEnd: trimmed ? trimEnd : 0,
    };
    const finalFile = await publishMusicFile(staged, sidecar);
    forceNextScan = true;
    const library = await scanLibrary(true);
    const rel = normalizeRel(finalFile);
    if (!library.some((t) => t.rel === rel)) throw I18n.error("AppFileWasSavedButDidNotAppearIn");
    send({ stage:'done', percent:100, text:I18n.t("AppDoneTheTrackWasAddedToYourLibrary"), file:path.basename(finalFile) });
    notifyLibraryChanged();
    return { ok:true, title:sidecar.title, artist:sidecar.artist, rel, duration:verifiedDuration, jobId };
  } catch (error) {
    const message = friendlyYtError(error);
    send({ stage:'error', percent:0, text:I18n.t("AppDownloadStopped"), message });
    return { ok:false, code:'DOWNLOAD_FAILED', message, jobId };
  } finally {
    if (staging) await fsp.rm(staging,{recursive:true,force:true}).catch(()=>{});
  }
}

async function deleteTrack(rel) {
  await scanLibrary();
  rel = String(rel || '');
  const full = resolveMusicRelative(rel);
  if (!fs.existsSync(full)) return { ok: true };
  await shell.trashItem(full);
  for (const extra of [`${full}.pulse.json`, `${full}.info.json`]) {
    try { if (fs.existsSync(extra)) await shell.trashItem(extra); } catch {}
  }
  await getVault().retirePublicReferences([rel]);
  const updated = commitOrganization(Library.removeTrack(getSettings(), rel));
  notifyLibraryChanged();
  return { ok: true, settings: updated };
}

// One scan and one settings commit, with a per-file outcome. Never permanently
// delete audio; failures remain in the library and can be retried explicitly.
async function deleteTracks(rels) {
  const tracks = await scanLibrary();
  const selected = Library.requireTracks(tracks,rels);
  const targets = selected.map(t => ({rel:t.rel,full:resolveMusicRelative(t.rel)}));
  const removed = [], failed = [], warnings = [];
  for (const {rel,full} of targets) {
    try {
      if (fs.existsSync(full)) await shell.trashItem(full);
      removed.push(rel);
      for (const extra of [`${full}.pulse.json`,`${full}.info.json`]) {
        try { if (fs.existsSync(extra)) await shell.trashItem(extra); }
        catch (error) { warnings.push({rel,message:I18n.t("AppCouldNotRemoveMetadata", {value1:(error.message || error)})}); }
      }
    } catch (error) { failed.push({rel,message:String(error.message || error)}); }
  }
  await getVault().retirePublicReferences(removed);
  let next = getSettings();
  for (const rel of removed) next = Library.removeTrack(next,rel);
  const settings = removed.length ? commitOrganization(next) : Library.organizationPatch(next);
  if (removed.length) { forceNextScan = true; notifyLibraryChanged(); }
  return {ok:failed.length===0,removed,failed,warnings,settings};
}

function toggleFavorite(rel) {
  rel = String(rel || '');
  resolveMusicRelative(rel);
  const settings = getSettings();
  const key = String(rel).toLowerCase();
  const existing = settings.favorites.findIndex((x) => String(x).toLowerCase() === key);
  let favorite;
  if (existing >= 0) { settings.favorites.splice(existing, 1); favorite = false; }
  else { settings.favorites.push(rel); favorite = true; }
  saveSettings({ favorites: settings.favorites });
  return { favorite, favorites: settings.favorites };
}



function appearanceRefToPath(ref) {
  const raw = String(ref || '');
  if (!raw || raw.startsWith('builtin:')) return '';
  const full = path.resolve(APPEARANCE_DIR, raw.replace(/\\/g, '/'));
  if (full !== APPEARANCE_DIR && !isInside(APPEARANCE_DIR, full)) return '';
  return full;
}

function appearanceRefToUrl(ref) {
  const full = appearanceRefToPath(ref);
  return full && fs.existsSync(full) ? pathToFileURL(full).href : '';
}

function builtinIconPath(id, ext = 'png') {
  const clean = String(id || '').replace(/^builtin:/, '');
  if (!BUILTIN_APP_ICONS.has(clean)) return '';
  return path.join(__dirname, 'assets', 'app-icons', `${clean}-monitor.${ext}`);
}

function selectedIconPath(settings = getSettings()) {
  const ref = normalizeAppIconRef(settings.appIcon);
  const generated = appearanceRefToPath(ref);
  if (generated && /^custom-icons\/[a-f0-9]{24}\.png$/.test(ref) && fs.existsSync(`${generated}.ico`)) return `${generated}.ico`;
  return builtinIconPath(ref, 'ico') || path.join(__dirname, 'assets', 'icon.ico');
}

async function nativeImageToIco(image, destination) {
  try {
    if (!image || image.isEmpty()) return false;
    const png = image.resize({ width: 256, height: 256, quality: 'best' }).toPNG();
    const header = Buffer.alloc(22);
    header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
    header[6] = 0; header[7] = 0; header[8] = 0; header[9] = 0;
    header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
    header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
    await fsp.writeFile(destination, Buffer.concat([header, png]));
    return true;
  } catch { return false; }
}

async function imageFileToIco(source, destination) {
  try {
    let image = nativeImage.createFromPath(source);
    if (image.isEmpty() && path.extname(source).toLowerCase() === '.svg') {
      const data = await fsp.readFile(source);
      image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${data.toString('base64')}`);
    }
    return await nativeImageToIco(image, destination);
  } catch { return false; }
}

async function saveGeneratedIcon(_name, dataUrl) {
  // Only rasterized, size-limited PNG is accepted. Never write renderer-supplied SVG.
  const raw = String(dataUrl || '');
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(raw) || raw.length > 2 * 1024 * 1024) throw I18n.error("AppInvalidIconImage");
  const bytes = Buffer.from(raw.slice(raw.indexOf(',') + 1), 'base64');
  if (bytes.length < 24 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== 256 || bytes.readUInt32BE(20) !== 256) throw I18n.error("AppInvalidIconImage");
  const image = nativeImage.createFromDataURL(raw);
  if (image.isEmpty()) throw I18n.error("AppCouldNotConvertTheIcon");
  const png = image.toPNG();
  const name = crypto.createHash('sha256').update(png).digest('hex').slice(0,24);
  const ref = `custom-icons/${name}.png`;
  const source = appearanceRefToPath(ref);
  await fsp.mkdir(path.dirname(source), { recursive:true });
  await fsp.writeFile(source, png);
  if (!await nativeImageToIco(image, `${source}.ico`)) throw I18n.error("AppCouldNotCreateAWindowsIcon");
  return { ok:true, ref, url:appearanceRefToUrl(ref) };
}

async function saveIconRaster(ref, dataUrl) {
  const source = appearanceRefToPath(ref);
  if (!source || !isInside(CUSTOM_ICON_DIR, source)) throw I18n.error("AppInvalidCustomIconPath");
  const raw = String(dataUrl || '');
  if (!/^data:image\/png;base64,/i.test(raw) || raw.length > 12 * 1024 * 1024) throw I18n.error("AppInvalidIconImage");
  const image = nativeImage.createFromDataURL(raw);
  if (image.isEmpty()) throw I18n.error("AppCouldNotConvertTheIcon");
  const ok = await nativeImageToIco(image, `${source}.ico`);
  if (!ok) throw I18n.error("AppCouldNotCreateAWindowsIcon");
  return { ok:true };
}

async function updateDesktopShortcutIcon(iconPath) {
  if (process.platform !== 'win32') return;
  try {
    const shortcut = path.join(app.getPath('desktop'), `${APP_NAME}.lnk`);
    if (!fs.existsSync(shortcut)) return;
    const current = shell.readShortcutLink(shortcut);
    try { fs.unlinkSync(shortcut); } catch {}
    shell.writeShortcutLink(shortcut, 'create', { ...current, icon: iconPath, iconIndex: 0 });
  } catch {}
}

async function applyWindowIcon(settings = getSettings()) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const iconPath = selectedIconPath(settings);
  try {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) mainWindow.setIcon(image);
  } catch {}
  await updateDesktopShortcutIcon(iconPath);
}

async function chooseAppearanceAsset(kind) {
  const isIcon = kind === 'icon';
  const result = await dialog.showOpenDialog(mainWindow, {
    title: isIcon ? I18n.t("AppChooseAPulseDeckIcon") : I18n.t("AppChooseAPulseDeckBackground"),
    properties: ['openFile'],
    filters: isIcon
      ? [{ name: I18n.t("AppImagesAndSVG"), extensions: ['png','jpg','jpeg','webp','svg','ico'] }]
      : [{ name: I18n.t("AppImages"), extensions: ['png','jpg','jpeg','webp','bmp'] }],
  });
  if (result.canceled || !result.filePaths?.[0]) return null;
  const src = result.filePaths[0];
  const ext = path.extname(src).toLowerCase() || '.png';
  const data = await fsp.readFile(src);
  const hash = crypto.createHash('sha1').update(data).digest('hex').slice(0, 14);
  const folder = isIcon ? CUSTOM_ICON_DIR : BACKGROUND_DIR;
  const dest = path.join(folder, `${isIcon ? 'icon' : 'background'}-${hash}${ext}`);
  if (!fs.existsSync(dest)) await fsp.writeFile(dest, data);
  if (isIcon && ext !== '.ico') await imageFileToIco(dest, `${dest}.ico`);
  const ref = path.relative(APPEARANCE_DIR, dest).split(path.sep).join('/');
  const dataUrl = isIcon && ext === '.svg' ? `data:image/svg+xml;base64,${data.toString('base64')}` : '';
  return { ref, url: pathToFileURL(dest).href, name: path.basename(src), dataUrl };
}


const HOTKEY_ACTIONS = ['playPause','next','previous','volumeUp','volumeDown','mute','nextPlaylist','previousPlaylist','showOverlay','showHelp','toggleClickThrough','toggleShuffle','cycleRepeat','favoriteCurrent','focusSearch','openImport','trimCurrentTrack'];

function sendHotkeyStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('hotkeys:status', hotkeyStatus);
}

function registerGlobalShortcuts(settings = getSettings()) {
  try { globalShortcut.unregisterAll(); } catch {}
  hotkeyStatus = {};
  const cfg = settings.hotkeys || defaultSettings.hotkeys;
  if (cfg.enabled === false) {
    for (const action of HOTKEY_ACTIONS) hotkeyStatus[action] = { ok:false, disabled:true, accelerator:String(cfg[action]||'') };
    sendHotkeyStatus();
    return hotkeyStatus;
  }
  for (const action of HOTKEY_ACTIONS) {
    const accelerator = String(cfg[action] || '').trim();
    if (!accelerator) { hotkeyStatus[action] = { ok:false, disabled:true, accelerator:'' }; continue; }
    try {
      const ok = globalShortcut.register(accelerator, () => {
        if (action === 'showHelp') showOverlayHelp();
        if (action === 'toggleClickThrough') { toggleOverlayClickThrough(); return; }
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('hotkey:action', { action, accelerator, source:'global' });
      });
      hotkeyStatus[action] = { ok:!!ok, accelerator, message: ok ? '' : I18n.t("AppThisShortcutIsAlreadyUsedByTheSystem") };
    } catch (error) {
      hotkeyStatus[action] = { ok:false, accelerator, message:error.message || String(error) };
    }
  }
  sendHotkeyStatus();
  return hotkeyStatus;
}

function sameOverlayBounds(a, b, tolerance = 1) {
  if (!a || !b) return false;
  return ['x','y','width','height'].every((key) => Math.abs(Number(a[key]) - Number(b[key])) <= tolerance);
}


const GAME_OVERLAY_HOST_PATH = path.join(__dirname, 'assets', 'native', 'PulseDeck.GameOverlayHost.exe');

function windowHandleString(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return '0';
  try {
    const buf = win.getNativeWindowHandle();
    if (!buf || !buf.length) return '0';
    const value = buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
    return `0x${value.toString(16)}`;
  } catch { return '0'; }
}

function publishGameOverlayStatus(patch = {}) {
  if (patch.reasonKey) patch = {...patch, reason:I18n.t(patch.reasonKey,patch.reasonParams)};
  else if (patch.reason) {
    // Native helper/transport emits a stable key; never a source-language UI string.
    const key=I18n.keyForText(patch.reason);
    patch={...patch, reasonKey:key || '', reason:key ? I18n.t(key) : patch.reason};
  }
  gameOverlayStatus = { ...gameOverlayStatus, ...patch, supported: process.platform === 'win32', timestamp: Date.now() };
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('gameOverlay:status', gameOverlayStatus); } catch {}
  }
}

function getGameOverlayController() {
  if (!gameOverlayController) {
    gameOverlayController = new OverlayHostTransport({
      executable: GAME_OVERLAY_HOST_PATH,
      platform: process.platform,
      onStatus: publishGameOverlayStatus,
      onMessage: handleGameOverlayHostMessage,
      log: createDiagnosticLog(path.join(DATA_DIR, 'logs', 'game-overlay.jsonl')),
    });
  }
  return gameOverlayController;
}

function sendGameOverlayCommand(payload) {
  if (payload?.type === 'visual') gameOverlayLastVisual = { type:'visual', color1:payload.color1, color2:payload.color2 };
  return gameOverlayController?.send(payload) || false;
}

function bindGameOverlayWindows() {
  return sendGameOverlayCommand({
    type: 'bind',
    overlayHwnd: windowHandleString(overlayWindow),
    mainHwnd: windowHandleString(mainWindow),
  });
}

function handleGameOverlayHostMessage(message) {
  if (isQuitting || !['auto', 'rtss'].includes(getSettings().gameOverlay.mode)) return;
  if (message.type === 'hello') {
    publishGameOverlayStatus({ running: true, hostPid: message.pid || 0,
      hostVersion: message.version || '', backends: Array.isArray(message.backends) ? message.backends : [],
      restarting: false, lastError: '', reason: I18n.t("AppGameModuleReadyCheckingRTSS") });
    // Replay CURRENT state after every handshake, not the old crashed child's
    // audio queue or an outdated bind/config captured in a restart timer.
    bindGameOverlayWindows();
    const settings = getSettings();
    const c = settings.gameOverlay;
    const po = settings.playerOverlay;
    sendGameOverlayCommand({ type: 'config', enabled: true, ...c,
      color1: po.visualizerColor, color2: po.visualizerColor2 });
    if (overlayLastState) sendGameOverlayCommand({ type: 'state', state: overlayLastState });
    sendGameOverlayCommand(gameOverlayLastVisual || { type: 'visual', color1: po.visualizerColor, color2: po.visualizerColor2 });
  } else if (message.type === 'status') {
    publishGameOverlayStatus({ ...message, running: true, restarting: false });
  }
}

function stopGameOverlayHost() {
  gameOverlayController?.stop();
}

function startGameOverlayHost() {
  if (isQuitting) return false;
  return getGameOverlayController().start();
}

function findRTSSExecutable() {
  if (process.platform !== 'win32') return '';
  const candidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'RivaTuner Statistics Server', 'RTSS.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'RivaTuner Statistics Server', 'RTSS.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'RivaTuner Statistics Server', 'RTSS.exe'),
  ].filter(Boolean);
  return candidates.find((file)=>fs.existsSync(file)) || '';
}

function launchRTSS() {
  const exe = findRTSSExecutable();
  if (!exe) return { ok:false, reason:I18n.t("AppRTSSExeWasNotFoundInTheStandard") };
  return new Promise(resolve => {
    let settled = false;
    const done = result => { if (!settled) { settled = true; resolve(result); } };
    try {
      const child = spawn(exe, [], { detached:true, windowsHide:false, stdio:'ignore', shell:false });
      // spawn() failures may arrive later as an event (blocked executable,
      // missing permissions). A try/catch alone is not sufficient here either.
      child.on('error', error => {
        publishGameOverlayStatus({ lastError:String(error.code || 'RTSS_START_ERROR') });
        done({ ok:false, reason:error.message || String(error) });
      });
      child.once('spawn', () => { child.unref(); done({ ok:true, path:exe }); });
    } catch (error) { done({ ok:false, reason:error.message || String(error) }); }
  });
}

async function applyGameOverlayConfiguration(config = getSettings().gameOverlay) {
  if (!app.isReady()) return gameOverlayStatus;
  const normalized = normalizeSettings({ ...getSettings(), gameOverlay:config }).gameOverlay;
  if (process.platform !== 'win32') {
    publishGameOverlayStatus({ supported:false, running:false, active:false, reason:I18n.t("GameOverlayGameOverlayIsOnlySupportedOnWindows") });
    return gameOverlayStatus;
  }
  if (normalized.mode === 'off' || normalized.mode === 'window') {
    stopGameOverlayHost();
    publishGameOverlayStatus({ running:false, active:false, reason: normalized.mode === 'off' ? I18n.t("AppGameOverlayDisabled") : I18n.t("AppUsingARegularWindowsWindow") });
    return gameOverlayStatus;
  }
  startGameOverlayHost();
  const po = getSettings().playerOverlay;
  sendGameOverlayCommand({ type:'config', enabled:true, ...normalized, color1:po.visualizerColor, color2:po.visualizerColor2 });
  if (overlayLastState) sendGameOverlayCommand({ type:'state', state:overlayLastState });
  bindGameOverlayWindows();
  return gameOverlayStatus;
}

function setOverlayBoundsSafe(win, bounds) {
  if (!win || win.isDestroyed() || !bounds) return false;
  const current = win.getBounds();
  if (sameOverlayBounds(current, bounds, 0)) return false;
  overlayProgrammaticBounds += 1;
  try { win.setBounds(bounds, false); }
  finally { setTimeout(() => { overlayProgrammaticBounds = Math.max(0, overlayProgrammaticBounds - 1); }, 320); }
  return true;
}

function overlayBoundsFromConfig(config) {
  const primary = screen.getPrimaryDisplay().workArea;
  const saved = config?.bounds;
  const width = Math.max(180, Math.min(primary.width, Number(saved?.width || config?.width) || 430));
  const height = Math.max(38, Math.min(primary.height, Number(saved?.height || config?.height) || 122));
  let x = Number(saved?.x), y = Number(saved?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    x = primary.x + primary.width - width - 24;
    y = primary.y + primary.height - height - 24;
  }
  x = Math.max(primary.x, Math.min(primary.x + primary.width - width, x));
  y = Math.max(primary.y, Math.min(primary.y + primary.height - height, y));
  return { x:Math.round(x), y:Math.round(y), width:Math.round(width), height:Math.round(height) };
}


function destroyOverlayWindow() {
  clearTimeout(overlayHideTimer); clearInterval(overlayHitTimer);
  overlayHideTimer = null; overlayHitTimer = null;
  overlayPreviewMode = false; overlayPreviewRequested = false; overlayPreviewOverride = null;
  overlayPopupUntil = 0; overlayHelpUntil = 0;
  overlayResizeSession = null; overlayPointerInteractive = false; overlayGestureUntil = 0;
  overlayHitRegions = []; overlayInteractionSignature = ''; overlayPreviewSignature = null;
  if (overlayWindow && !overlayWindow.isDestroyed()) { try { overlayWindow.destroy(); } catch {} }
  overlayWindow = null;
}

function mainWindowIsBackgrounded() {
  return !mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || !mainWindow.isVisible();
}

function currentOverlayPolicy(config = getSettings().playerOverlay) {
  return overlayPolicy(config, {
    previewRequested: overlayPreviewRequested,
    previewOverride: overlayPreviewOverride,
    mainVisible: !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible(),
    mainMinimized: !mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized(),
    popupActive: Date.now() < overlayPopupUntil,
    helpActive: Date.now() < overlayHelpUntil,
  });
}

function overlayTopmostLevel(config = getSettings().playerOverlay) {
  return config.fullscreenTopmost === false ? 'pop-up-menu' : 'screen-saver';
}

function applyOverlayTopmost(config = getSettings().playerOverlay) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  try { overlayWindow.setAlwaysOnTop(true, overlayTopmostLevel(config)); } catch {}
}

function overlayControlIsUnderPointer() {
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return false;
  try {
    return pointInRegions(screen.getCursorScreenPoint(), overlayWindow.getContentBounds(), overlayHitRegions.filter(r => !currentOverlayPolicy().clickThrough || r.kind !== 'resize'), overlayWindow.webContents.getZoomFactor());
  } catch { return false; }
}

function updateOverlayInteractivity(config = overlayRuntimeConfig || getSettings().playerOverlay) {
  overlayRuntimeConfig = config;
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const policy = currentOverlayPolicy(config);
  overlayPreviewMode = policy.preview;
  // All visible controls are input islands, not just the click-through switch.
  // Hold input during a captured scrub/resize, including outside the window.
  const gestureActive = overlayWindow.isVisible() && Date.now() < overlayGestureUntil;
  overlayPointerInteractive = policy.clickThrough && (gestureActive || overlayControlIsUnderPointer());
  const ignore = policy.clickThrough && !overlayPointerInteractive;
  const payload = { clickThrough: policy.clickThrough, passThrough: ignore, preview: policy.preview,
    preference: !!config.clickThroughWhenMinimized, overridden: policy.preview && overlayPreviewOverride !== null };
  const signature = JSON.stringify(payload);
  if (signature !== overlayInteractionSignature) {
    overlayInteractionSignature = signature;
    try {
      // Native resize borders must be disabled as well as the HTML handles.
      if (policy.clickThrough && overlayResizeSession) endOverlayResize();
      overlayWindow.setResizable(!policy.clickThrough);
      overlayWindow.setMovable(!policy.clickThrough);
      overlayWindow.setFocusable(!ignore);
      overlayWindow.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
      overlayWindow.webContents.send('overlay:interaction', payload);
    } catch {}
  }
  if (policy.preview !== overlayPreviewSignature) {
    overlayPreviewSignature = policy.preview;
    overlayWindow.webContents.send('overlay:preview-mode', policy.preview);
  }
  // A main-process DIP hit test also works after dropped mouseleave / forwarded
  // mousemove events and across monitors with different Windows scaling.
  const needPoll = policy.clickThrough && overlayWindow.isVisible();
  if (needPoll && !overlayHitTimer) {
    overlayHitTimer = setInterval(() => updateOverlayInteractivity(), 16);
    overlayHitTimer.unref?.();
  } else if (!needPoll && overlayHitTimer) { clearInterval(overlayHitTimer); overlayHitTimer = null; }
}

function broadcastOverlaySettings(config = getSettings().playerOverlay) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('overlay:settings-changed', config);
}

function toggleOverlayClickThrough() {
  const next = !currentOverlayPolicy().clickThrough;
  if (currentOverlayPolicy().preview) overlayPreviewOverride = next;
  const saved = saveSettings({ playerOverlay: { clickThroughWhenMinimized: next } }).playerOverlay;
  broadcastOverlaySettings(saved);
  updateOverlayInteractivity(saved);
  return { enabled: next, config: saved };
}

function scheduleOverlayVisibility() {
  clearTimeout(overlayHideTimer);
  const deadlines = [overlayPopupUntil, overlayHelpUntil].filter(x => x > Date.now());
  if (deadlines.length) overlayHideTimer = setTimeout(() => applyOverlayConfiguration().catch(() => {}), Math.max(1, Math.min(...deadlines) - Date.now() + 1));
}

function reconcileOverlayContext() {
  applyOverlayConfiguration().catch(() => {});
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('overlay:preview-context', currentOverlayPolicy().preview);
}

function setOverlayPreviewRequested(enabled) {
  if (overlayPreviewRequested !== !!enabled) {
    overlayPreviewOverride = null;
    overlayPopupUntil = 0; overlayHelpUntil = 0;
  }
  overlayPreviewRequested = !!enabled;
  reconcileOverlayContext();
  return currentOverlayPolicy().preview;
}

function saveOverlayBoundsNow() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const b = overlayWindow.getBounds();
  overlayLastSavedBounds = { ...b };
  const settings = getSettings();
  saveSettings({ playerOverlay:{ ...settings.playerOverlay, width:b.width, height:b.height, bounds:b } }, { skipOverlayApply:true });
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('overlay:bounds', b);
}

function beginOverlayResize(payload = {}) {
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible() || currentOverlayPolicy().clickThrough) return false;
  const edge = String(payload.edge || '');
  if (!/^(n|s|e|w|ne|nw|se|sw)$/.test(edge)) return false;
  overlayResizeSession = {
    edge,
    startX: Number(payload.screenX) || 0,
    startY: Number(payload.screenY) || 0,
    bounds: overlayWindow.getBounds(),
  };
  return true;
}

function updateOverlayResize(payload = {}) {
  if (currentOverlayPolicy().clickThrough) { endOverlayResize(); return false; }
  if (!overlayResizeSession || !overlayWindow || overlayWindow.isDestroyed()) return false;
  const { edge, startX, startY, bounds } = overlayResizeSession;
  const dx = (Number(payload.screenX) || 0) - startX;
  const dy = (Number(payload.screenY) || 0) - startY;
  let { x, y, width, height } = bounds;
  const minW = 180, minH = 38;
  if (edge.includes('e')) width = Math.max(minW, bounds.width + dx);
  if (edge.includes('s')) height = Math.max(minH, bounds.height + dy);
  if (edge.includes('w')) { width = Math.max(minW, bounds.width - dx); x = bounds.x + (bounds.width - width); }
  if (edge.includes('n')) { height = Math.max(minH, bounds.height - dy); y = bounds.y + (bounds.height - height); }
  const display = screen.getDisplayMatching(bounds).workArea;
  width = Math.min(width, display.width); height = Math.min(height, display.height);
  x = Math.max(display.x, Math.min(display.x + display.width - width, x));
  y = Math.max(display.y, Math.min(display.y + display.height - height, y));
  overlayProgrammaticBounds += 1;
  try { overlayWindow.setBounds({ x:Math.round(x), y:Math.round(y), width:Math.round(width), height:Math.round(height) }, false); }
  finally { overlayProgrammaticBounds = Math.max(0, overlayProgrammaticBounds - 1); }
  return true;
}

function endOverlayResize() {
  if (!overlayResizeSession) return false;
  overlayResizeSession = null;
  saveOverlayBoundsNow();
  return true;
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  const config = getSettings().playerOverlay;
  const bounds = overlayBoundsFromConfig(config);
  overlayWindow = new BrowserWindow({
    ...bounds,
    minWidth:180, minHeight:38,
    show:false, frame:false, transparent:true, backgroundColor:'#00000000', useContentSize:true,
    alwaysOnTop:true, skipTaskbar:true, resizable:true, movable:true, focusable:true,
    hasShadow:false, title:I18n.t('PlayerWindowTitle'),
    icon:path.join(__dirname,'assets','icon.ico'),
    webPreferences:{ preload:path.join(__dirname,'overlay-preload.js'), nodeIntegration:false, contextIsolation:true, sandbox:true, webSecurity:true, backgroundThrottling:false },
  });
  applyOverlayTopmost(config);
  bindGameOverlayWindows();
  overlayWindow.webContents.setBackgroundThrottling(false);
  overlayWindow.loadFile(path.join(__dirname,'overlay','index.html'));
  overlayWindow.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  overlayWindow.webContents.on('did-finish-load', () => {
    if (overlayLastState) overlayWindow?.webContents.send('overlay:state', overlayLastState);
    overlayWindow?.webContents.send('overlay:config', getSettings().playerOverlay);
    overlayWindow?.webContents.send('overlay:preview-mode', overlayPreviewMode);
    applyOverlayTopmost(getSettings().playerOverlay);
    overlayInteractionSignature = ''; overlayPreviewSignature = null;
    updateOverlayInteractivity(getSettings().playerOverlay);
    bindGameOverlayWindows();
  });
  let boundsTimer = null;
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!overlayWindow || overlayWindow.isDestroyed()) return;
      if (overlayProgrammaticBounds > 0 || overlayResizeSession) return;
      if (!overlayPreviewMode && getSettings().playerOverlay.mode !== 'persistent') return;
      const b = overlayWindow.getBounds();
      if (sameOverlayBounds(b, overlayLastSavedBounds, 0)) return;
      overlayLastSavedBounds = { ...b };
      const settings = getSettings();
      saveSettings({ playerOverlay:{ ...settings.playerOverlay, width:b.width, height:b.height, bounds:b } }, { skipOverlayApply:true });
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('overlay:bounds', b);
    }, 180);
  };
  overlayWindow.on('will-resize', event => { if (currentOverlayPolicy().clickThrough) event.preventDefault(); });
  overlayWindow.on('will-move', event => { if (currentOverlayPolicy().clickThrough) event.preventDefault(); });
  overlayWindow.on('move', saveBounds); overlayWindow.on('resize', saveBounds);
  overlayWindow.on('show', () => updateOverlayInteractivity());
  overlayWindow.on('hide', () => { overlayGestureUntil = 0; overlayResizeSession = null; overlayPointerInteractive = false; updateOverlayInteractivity(); });
  overlayWindow.on('closed', () => { overlayGestureUntil = 0; clearInterval(overlayHitTimer); overlayHitTimer = null; overlayHitRegions = []; overlayInteractionSignature = ''; overlayPreviewSignature = null; overlayWindow = null; bindGameOverlayWindows(); overlayPreviewMode = false; overlayLastSavedBounds = null; overlayResizeSession = null; overlayPointerInteractive = false; overlayProgrammaticBounds = 0; clearTimeout(overlayHideTimer); });
  return overlayWindow;
}

async function applyOverlayConfiguration(config = getSettings().playerOverlay) {
  overlayRuntimeConfig = config;
  if (!app.isReady()) return;
  const policy = currentOverlayPolicy(config);
  overlayPreviewMode = policy.preview;
  if (policy.visible) {
    const win = createOverlayWindow();
    win.webContents.send('overlay:config', config);
    applyOverlayTopmost(config);
    if (!win.isVisible()) win.showInactive();
    updateOverlayInteractivity(config);
  } else if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('overlay:config', config);
    overlayWindow.hide();
    updateOverlayInteractivity(config);
  }
  scheduleOverlayVisibility();
}

function pushOverlayState(payload) {
  overlayLastState = payload || {};
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send('overlay:state', overlayLastState);
  sendGameOverlayCommand({ type:'state', state:overlayLastState });
}

function notifyOverlay(reason = 'manual') {
  const config = getSettings().playerOverlay;
  // A track change must NOT end a live settings preview or leave it stuck visible.
  if (!currentOverlayPolicy(config).preview) {
    if (config.mode === 'off' || (reason === 'auto' && !config.notifyAutoNext)) return false;
    if (config.mode === 'popup') overlayPopupUntil = Date.now() + Math.round(config.duration * 1000);
  }
  const win = createOverlayWindow();
  if (overlayLastState) win.webContents.send('overlay:state', overlayLastState);
  win.webContents.send('overlay:animate', { reason, kind: reason === 'hotkey' ? 'switch' : 'soft' });
  applyOverlayConfiguration(config).catch(() => {});
  return true;
}

function showOverlayHelp() {
  const settings = getSettings();
  const win = createOverlayWindow();
  overlayHelpUntil = Date.now() + 5200;
  win.webContents.send('overlay:help', settings.hotkeys);
  applyOverlayConfiguration(settings.playerOverlay).catch(() => {});
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 720,
    minHeight: 620,
    show: false,
    frame: false,
    title: APP_NAME,
    backgroundColor: '#0b0c10',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.setBackgroundThrottling(false);
  applyWindowIcon(getSettings()).catch(() => {});
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false));
  mainWindow.on('minimize', reconcileOverlayContext);
  mainWindow.on('restore', reconcileOverlayContext);
  mainWindow.on('show', reconcileOverlayContext);
  mainWindow.on('hide', reconcileOverlayContext);
  mainWindow.webContents.on('render-process-gone', () => setOverlayPreviewRequested(false));
  mainWindow.webContents.on('did-start-loading', () => setOverlayPreviewRequested(false));
  mainWindow.on('close', () => { if (!isQuitting) destroyOverlayWindow(); });
  mainWindow.on('closed', () => { mainWindow = null; destroyOverlayWindow(); });
}


function getLyrics(){
  if(!lyricsStore)lyricsStore=new LyricsStore({music:MUSIC_DIR,data:DATA_DIR,listPublic:()=>scanLibrary(),getVault,
    fetchJson:require('./lyrics/http').createLyricsHTTP((url,options)=>net.fetch(url,options),APP_VERSION),
    embedded:async track=>{const file=resolveMusicRelative(track.rel);return (await extractMetadata(file,COVER_DIR,await fsp.stat(file))).embeddedLyrics||'';},
    ffmpeg:()=>getComponents().resolve('ffmpeg.exe'),analysisProgress:payload=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('lyrics:analysis-progress',payload);},
    dialog,parent:()=>mainWindow,progress:payload=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('lyrics:progress',payload);}});
  return lyricsStore;
}
function getVault(){
  if(vaultStore)return vaultStore;
  vaultStore=new VaultStore({music:MUSIC_DIR,settings:getSettings,commit:next=>settingsStore.set(next),
    listPublic:()=>scanLibrary(true),port:startPreviewServer,trash:file=>shell.trashItem(file),notify:notifyLibraryChanged,
    lyricsBridge:{capture:(track,entry)=>getLyrics().sealForVault(track,entry),exportPublic:entry=>getLyrics().exportPublicLyrics(entry)},
    onLock:()=>{lyricsStore?.lockPrivate();if(libraryEnrichment?.active?.private)libraryEnrichment.cancel();if(libraryEnrichment)libraryEnrichment.lastJob=null;libraryEnrichment?.invalidate();coverSearch?.dispose();if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('lyrics:locked');},
    purge:async(rels,covers,entry)=>{
      if(entry?.lyricsMigrated)await getLyrics().retirePublic(rels,entry);
      if(currentScanPromise)await currentScanPromise;
      let next=getSettings();for(const rel of rels){next=Library.removeTrack(next,rel);if(Library.token(next.lastTrack)===Library.token(rel))next.lastTrack='';}
      settingsStore.set(next);
      // Remove the current cache, not just the current in-memory track list.
      const cache=readJson(CACHE_FILE,{});for(const k of Object.keys(cache))if(rels.some(r=>Library.token(r)===Library.token(k)))delete cache[k];
      writeJsonAtomic(CACHE_FILE,cache);
      for(const cover of covers)if(isInside(COVER_DIR,cover))await fsp.unlink(cover).catch(e=>{if(e.code!=='ENOENT')throw e;});
      // Legacy settings may otherwise disclose old relative filenames.
      if(fs.existsSync(LEGACY_SETTINGS_FILE))writeJsonAtomic(LEGACY_SETTINGS_FILE,next);
    }});
  vaultStore.syncSettings();return vaultStore;
}

async function vaultCommand(c={}){
  const v=getVault();let result;
  if(c.type==='enter')result=await v.enter(String(c.key||''));
  else if(c.type==='unlock')result=await v.unlock(c.key,c.password);
  else if(c.type==='lock'){v.lock();result={locked:true,tracks:[]};}
  else if(c.type==='protect')result=await v.protect(c.key,c.name,c.password);
  else if(c.type==='ingest')result=await v.ingest(c.key,Library.requireTracks(await scanLibrary(),c.rels),c.password);
  else if(c.type==='transfer')result=await v.addFromPrivate(c.source,c.rels,c.target,c.password,c.targetPassword);
  else if(c.type==='artist-selection'){
    if(c.discloseArtistNames!==true)throw I18n.error("AppConfirmSavingArtistNamesInPublicRules");
    const {entries}=await v.authorizedEntries(c.source,c.rels,c.password);
    const d=v.descriptor(c.source),tracks=[...await scanLibrary(),...entries.map(e=>({...e.meta,rel:`vault:${d.id}:${e.id}`,vaultKey:c.source}))];
    result=c.action==='split'?Library.splitSelectedArtists(getSettings(),tracks,c.rels):Library.aliasSelectedArtists(getSettings(),tracks,c.rels,c.target);
    // Only explicit artist naming rules leave the vault, never track paths/data.
    settingsStore.set(result.settings);
  }
  else if(c.type==='public-remove'){
    const {entries}=await v.authorizedEntries(c.source,c.rels,c.password);
    const rels=entries.map(e=>v.index.publicRefs[e.id]?.rel).filter(Boolean);
    result=rels.length?Library.bulkRemove(getSettings(),await scanLibrary(),c.key,rels):{removed:0};if(result.settings)settingsStore.set(result.settings);
  }
  else if(c.type==='remove')result=await v.remove(c.key,c.rels,c.password,{erase:!!c.erase});
  else if(c.type==='archives')result={archives:v.archives()};
  else if(c.type==='restore-archive')result=await v.restoreArchive(c.key,c.password);
  else if(c.type==='restore')result=await v.restoreRemoved(c.key,c.password);
  else if(c.type==='unprotect')result=await v.unprotect(c.key,c.password);
  else if(c.type==='link')result=await v.link(c.keys,c.passwords||{},c.password);
  else if(c.type==='order'){
    const s=await v.ready(c.key),ids=new Set(s.manifest.tracks.map(t=>t.id));
    if(c.order!==null && (!Array.isArray(c.order)||c.order.some(r=>!String(r).startsWith(`vault:${s.d.id}:`)||!ids.has(String(r).slice(`vault:${s.d.id}:`.length)))||new Set(c.order).size!==c.order.length))throw I18n.error("AppInvalidOrder");
    s.manifest.order=c.order===null?null:c.order;await v.saveManifest(s);result={ok:true};
  }
  else if(c.type==='bulk-categories'){
    const tracks=await scanLibrary(),cats=Library.categories(tracks,getSettings(),true),keys=[...new Set(c.keys||[])];
    if(!keys.length||keys.some(k=>!cats.some(cat=>cat.key===k)))throw I18n.error("AppRefreshYourPlaylistSelection");
    const protectedKeys=[...new Set([...keys,...((c.action==='merge'||c.action==='alias')&&c.target?[c.target]:[])])].filter(k=>getSettings().protectedPlaylists?.[k]);
    if(c.action==='hide')result=Library.bulkCategories(getSettings(),tracks,keys,'hide');
    else if(c.action==='delete'){
      result=Library.bulkCategories(getSettings(),tracks,keys,'delete');
      const privateDeletable=protectedKeys.filter(k=>!Library.SYSTEM_KEYS.has(k));if(privateDeletable.length)await v.deletePlaylists(privateDeletable,c.passwords||{});
      result.settings.protectedPlaylists=getSettings().protectedPlaylists;
    }else if(c.action==='merge'||c.action==='alias'){
      if(keys.length<2||!cats.some(cat=>cat.key===c.target)||(c.action==='merge'&&!keys.includes(c.target)))throw I18n.error("AppSelectAnExistingDestination");
      if(c.action==='alias'&&keys.some(k=>!cats.some(cat=>cat.key===k&&cat.kind==='artist')))throw I18n.error("AppSelectArtistPlaylistsOnly");
      // Validate every credential BEFORE the first mutation. Large file transfer
      // is sequential and journaled; it never launches unbounded crypto workers.
      for(const key of protectedKeys)await v.authenticate(key,c.passwords?.[key]);
      for(const key of keys){
        if(key===c.target)continue;
        const srcPrivate=!!getSettings().protectedPlaylists?.[key],dstPrivate=!!getSettings().protectedPlaylists?.[c.target];
        if(srcPrivate){
          const d=v.descriptor(key),auth=await v.authenticate(key,c.passwords[key]);
          const manifest=await v.readManifest(d,auth.keys[d.id]);
          const rels=manifest.tracks.filter(t=>!v.index.deleted[t.id]).map(t=>`vault:${d.id}:${t.id}`);
          if(rels.length)await v.addFromPrivate(key,rels,c.target,c.passwords[key],c.passwords[c.target]);
        }else if(dstPrivate){
          const members=(await scanLibrary()).filter(Library.membershipPredicate(getSettings(),key));
          const outcome=await v.ingest(c.target,members,c.passwords[c.target]);
          if(outcome.warnings?.length)throw Error(outcome.warnings.join(' '));
        }
        const before=getSettings(),live=await scanLibrary();
        if(c.action==='alias'){
          // Alias metadata is already public as playlist names; no song tags are written.
          const r=Library.aliasArtist(before,live,key,c.target);settingsStore.set(r.settings);
        }else if(!srcPrivate&&!dstPrivate)settingsStore.set(Library.mergePlaylists(before,live,key,c.target).settings);
        else settingsStore.set(Library.bulkCategories(before,live,[key],Library.SYSTEM_KEYS.has(key)?'hide':'delete').settings);
        if(srcPrivate){v.index.vaults[key].deleted=true;await v.persist();}
      }
      const resultSettings=getSettings(),targetCustom=resultSettings.customCategories.find(x=>x.id===c.target);if(targetCustom)targetCustom.hidden=false;else resultSettings.categoryStyles[c.target]={...(resultSettings.categoryStyles[c.target]||{}),hidden:false};settingsStore.set(resultSettings);
      v.lock();result={count:keys.length,targetKey:c.target};
    }else throw I18n.error("AppUnknownOperation");
    if(result.settings)settingsStore.set(result.settings);
  }
  else throw I18n.error("AppUnknownProtectedLibraryOperation");
  if(!['enter','unlock','lock','order','archives'].includes(c.type))notifyLibraryChanged();
  return {...result,settings:Library.organizationPatch(getSettings())};
}

function handleLocalized(channel, handler) {
  ipcMain.handle(channel, (...args) => {
    try {
      const result=handler(...args);
      return result && typeof result.then === 'function' ? result.catch(error=>{throw new Error(I18n.encodeError(error));}) : result;
    }
    catch (error) { throw new Error(I18n.encodeError(error)); }
  });
}
function isLanguageSender(event) {
  return !!event?.sender && (event.sender === mainWindow?.webContents || event.sender === overlayWindow?.webContents);
}
function broadcastLanguage() {
  const snapshot = I18n.snapshot();
  for (const win of [mainWindow, overlayWindow]) if (win && !win.isDestroyed()) {
    try { win.webContents.send('i18n:changed', snapshot); } catch {}
  }
  if (app.isReady()) {
    registerGlobalShortcuts(getSettings());
    // Also refresh main-owned overlay state labels and native status text.
    if (gameOverlayStatus.reasonKey) publishGameOverlayStatus({reasonKey:gameOverlayStatus.reasonKey,reasonParams:gameOverlayStatus.reasonParams});
  }
}
function registerIpc() {
  ipcMain.on('i18n:bootstrap', event => { event.returnValue = isLanguageSender(event) ? I18n.snapshot() : {}; });
  handleLocalized('i18n:reload', event => {
    if (!isLanguageSender(event)) throw I18n.error('InvalidSender');
    I18n.reload(); broadcastLanguage(); return I18n.snapshot();
  });
  handleLocalized('i18n:set-language', (event, code) => {
    if (event.sender !== mainWindow?.webContents) throw I18n.error('InvalidSender');
    if (typeof code !== 'string' || !Object.hasOwn(I18n.catalogs, code)) throw I18n.error('InvalidLanguage');
    saveSettings({language:code}); return I18n.snapshot();
  });
  handleLocalized('i18n:open-folder', event => {
    if (event.sender !== mainWindow?.webContents) throw I18n.error('InvalidSender');
    return shell.openPath(I18n.directory);
  });
  handleLocalized('library:list', () => scanLibrary());
  handleLocalized('library:playback', (_e, rel) => {
    if(String(rel||'').startsWith('vault:'))return getVault().playback(rel);
    const trackRel = String(rel || '');
    if(getVault().hidden(trackRel)||trackRel.split(/[\\/]/).some(part=>part.startsWith('.'))||getSettings().protectedPlaylists&&Object.values(getSettings().protectedPlaylists).some(d=>trackRel.replaceAll('\\','/').startsWith(d.folder+'/')))throw I18n.error("AppThisFileIsNotAvailableInThePublic");
    return trackRel ? { rel:trackRel, audioUrl:pathToFileURL(resolveMusicRelative(trackRel)).href } : null;
  });
  handleLocalized('lyrics:command', (event,command={}) => {
    if(event.sender!==mainWindow?.webContents)throw I18n.error("InvalidSender");
    const c=command&&typeof command==='object'?command:{},service=getLyrics();
    if(c.type==='get')return getVault().exclusive(()=>service.get(c.rel));
    if(c.type==='save')return getVault().exclusive(()=>service.save(c)).then(result=>{libraryEnrichment?.invalidate(c.rel);return result;});
    if(c.type==='presentation')return getVault().exclusive(()=>service.presentation(c));
    if(c.type==='remove')return getVault().exclusive(()=>service.remove(c)).then(result=>{libraryEnrichment?.invalidate(c.rel);return result;});
    if(c.type==='analyze')return service.analyze(c);
    if(c.type==='cancel-analysis'){service.cancelAnalysis();return {ok:true};}
    if(c.type==='cancel-search'){service.cancelSearches();return {ok:true};}
    if(c.type==='import')return service.importFile(c.rel);
    if(c.type==='search')return service.search(c);
    if(c.type==='export-package')return service.exportPackage(c);
    if(c.type==='export-text')return service.exportText(c);
    if(c.type==='cancel-export'){service.cancelExports();return {ok:true};}
    throw I18n.error("AppUnknownLyricsOperation");
  });
  handleLocalized('vault:command', (event,command) => {
    if(event.sender!==mainWindow?.webContents)throw I18n.error("InvalidSender");
    maintenanceOperations++;return getVault().exclusive(()=>vaultCommand(command)).finally(()=>{maintenanceOperations--;});
  });
  handleLocalized('library:organize', (_e, command) => organizeLibrary(command));
  handleLocalized('library:addFiles', () => addFiles());
  handleLocalized('library:openFolder', () => shell.openPath(MUSIC_DIR));
  handleLocalized('library:refresh', () => scanLibrary(true));
  handleLocalized('library:reveal', (_e, rel) => shell.showItemInFolder(resolveMusicRelative(rel)));
  handleLocalized('library:delete', (_e, rel) => getVault().exclusive(()=>deleteTrack(rel)));
  handleLocalized('library:deleteMany', (_e, rels) => getVault().exclusive(()=>deleteTracks(rels)));
  handleLocalized('library:favorite', (_e, rel) => toggleFavorite(rel));
  handleLocalized('online:search', (_e, provider, query) => searchOnline(provider, query));
  handleLocalized('online:preview', async (_e, url) => {
    try { return await prepareOnline(url); }
    catch (error) { return { ok: false, code: 'PREVIEW_FAILED', message: friendlyYtError(error) }; }
  });
  handleLocalized('online:analyze', async (_e, previewId, duration) => {
    maintenanceOperations++;
    try { return { ok: true, ...(await analyzeOnline(previewId, duration)) }; }
    catch (error) { return { ok: false, message: friendlyYtError(error) }; }
    finally{maintenanceOperations--;}
  });
  handleLocalized('online:download', (_e, url, options) => downloadUrl(url, options));
  handleLocalized('appearance:chooseBackground', () => chooseAppearanceAsset('background'));
  handleLocalized('appearance:chooseIcon', () => chooseAppearanceAsset('icon'));
  handleLocalized('appearance:saveIconRaster', (_e, ref, dataUrl) => saveIconRaster(ref, dataUrl));
  handleLocalized('appearance:saveGeneratedIcon', (_e, name, pngDataUrl) => saveGeneratedIcon(name, pngDataUrl));
  handleLocalized('appearance:resolve', (_e, ref) => appearanceRefToUrl(ref));
  handleLocalized('appearance:iconUrl', (_e, ref) => {
    const raw = String(ref || '');
    if (raw.startsWith('builtin:')) {
      const p = builtinIconPath(raw, 'png');
      return p && fs.existsSync(p) ? pathToFileURL(p).href : '';
    }
    return appearanceRefToUrl(raw);
  });
  handleLocalized('settings:get', () => getSettings());
  handleLocalized('settings:set', (_e, patch) => saveSettings(patch));
  ipcMain.on('settings:flush', (event, snapshot) => {
    try { flushSettings(snapshot); event.returnValue = true; }
    catch (error) { console.error(I18n.t('SettingsFlushFailed'), error); event.returnValue = false; }
  });
  handleLocalized('hotkeys:status', () => hotkeyStatus);
  handleLocalized('hotkeys:suspend', (_e, value) => { try { globalShortcut.setSuspended(!!value); return true; } catch { return false; } });
  handleLocalized('overlay:preview', (_e, enabled) => setOverlayPreviewRequested(enabled));
  handleLocalized('overlay:toggle-click-through', () => toggleOverlayClickThrough());
  handleLocalized('overlay:configure', (_e, config) => {
    if (Object.prototype.hasOwnProperty.call(config || {}, 'clickThroughWhenMinimized')) overlayPreviewOverride = null;
    const s = saveSettings({ playerOverlay: config });
    sendGameOverlayCommand({ type:'visual', color1:s.playerOverlay.visualizerColor, color2:s.playerOverlay.visualizerColor2 });
    return s.playerOverlay;
  });
  handleLocalized('overlay:state', (_e, payload) => { pushOverlayState(payload); return true; });
  handleLocalized('overlay:notify', (_e, reason) => notifyOverlay(String(reason||'manual')));
  handleLocalized('overlay:showHelp', () => { showOverlayHelp(); return true; });
  ipcMain.on('overlay:audio-frame', (_e, frame) => {
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) overlayWindow.webContents.send('overlay:audio-frame', frame);
    sendGameOverlayCommand({ type:'audio', freq:Array.isArray(frame?.freq)?frame.freq:[], wave:Array.isArray(frame?.wave)?frame.wave:[] });
  });
  ipcMain.on('overlay:control', (_e, payload) => {
    if (_e.sender !== overlayWindow?.webContents || !overlayWindow.isVisible()) return;
    const message = typeof payload === 'string' ? { action:payload } : (payload && typeof payload === 'object' ? payload : {});
    if (!['previous','playPause','next','seekTo'].includes(message.action)) return;
    if (message.action === 'seekTo') {
      if (!Number.isFinite(message.value)) return;
      message.value = Math.max(0, Math.min(1, message.value));
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('hotkey:action', { ...message, source:'overlay' });
  });
  ipcMain.on('overlay:pointer-hot', (_e) => { if (_e.sender === overlayWindow?.webContents) updateOverlayInteractivity(); });
  ipcMain.on('overlay:hit-regions', (_e, regions) => {
    if (_e.sender !== overlayWindow?.webContents) return;
    overlayHitRegions = sanitizeHitRegions(regions);
    updateOverlayInteractivity();
  });
  ipcMain.on('overlay:pointer-gesture', (_e, active) => {
    if (_e.sender !== overlayWindow?.webContents) return;
    overlayGestureUntil = active && overlayWindow.isVisible() ? Date.now() + 2000 : 0;
    updateOverlayInteractivity();
  });
  ipcMain.on('overlay:resize-begin', (_e, payload) => { if (_e.sender === overlayWindow?.webContents) beginOverlayResize(payload); });
  ipcMain.on('overlay:resize-move', (_e, payload) => { if (_e.sender === overlayWindow?.webContents) updateOverlayResize(payload); });
  ipcMain.on('overlay:resize-end', (_e) => { if (_e.sender === overlayWindow?.webContents) endOverlayResize(); });
  handleLocalized('gameOverlay:status', () => gameOverlayStatus);
  handleLocalized('gameOverlay:configure', (_e, config) => { const s=saveSettings({gameOverlay:config}); return { settings:s.gameOverlay, status:gameOverlayStatus }; });
  ipcMain.on('gameOverlay:visual', (_e, payload) => { const p=payload&&typeof payload==='object'?payload:{}; sendGameOverlayCommand({type:'visual',color1:String(p.color1||''),color2:String(p.color2||'')}); });
  handleLocalized('gameOverlay:openGameBar', async () => { try { await shell.openExternal('ms-gamebar:'); return true; } catch { return false; } });
  handleLocalized('gameOverlay:launchRtss', () => launchRTSS());
  handleLocalized('gameOverlay:openRtssDownload', async () => { try { await shell.openExternal('https://www.guru3d.com/download/rtss-rivatuner-statistics-server-download/'); return true; } catch { return false; } });
  handleLocalized('gameOverlay:restartHost', () => {
    if (isQuitting || !['auto', 'rtss'].includes(getSettings().gameOverlay.mode)) return false;
    return getGameOverlayController().restart();
  });
  const fromMain=event=>{
    if(event.sender!==mainWindow?.webContents || (event.senderFrame && event.sender.mainFrame && event.senderFrame!==event.sender.mainFrame))throw I18n.error('UPDATE_UNTRUSTED_WINDOW');
  };
  handleLocalized('library:cover-drop',(event,file,rel,revision)=>{fromMain(event);return setCoverFromFile(rel,file,revision);});
  handleLocalized('library:prepare-drop',(event,paths,requestId)=>{fromMain(event);return getImporter().prepare(paths,{requestId});});
  handleLocalized('library:command',(event,command)=>{fromMain(event);return libraryCommand(command);});
  handleLocalized('online:command',(event,command)=>{fromMain(event);return getSearchService().command(command);});
  handleLocalized('discovery:command',(event,command)=>{fromMain(event);return discoveryCommand(command);});
  handleLocalized('updates:status',event=>{fromMain(event);return getUpdates().snapshot();});
  handleLocalized('updates:check',async event=>{fromMain(event);return getUpdates().check(true);});
  handleLocalized('updates:configure',(event,patch)=>{fromMain(event);return getUpdates().configure(patch);});
  handleLocalized('updates:download',(event,mode)=>{fromMain(event);return getUpdates().download(mode);});
  handleLocalized('updates:cancel',event=>{fromMain(event);getUpdates().cancel();return true;});
  handleLocalized('updates:install',event=>{fromMain(event);return getUpdates().apply();});
  handleLocalized('updates:defer',(event,mode)=>{fromMain(event);return getUpdates().defer(mode);});
  ipcMain.on('updates:prepared',(event,reply)=>{if(event.sender!==mainWindow?.webContents||(event.senderFrame&&event.senderFrame!==mainWindow.webContents.mainFrame))return;const pending=installPreparations.get(reply?.token);if(!pending)return;installPreparations.delete(reply.token);pending.resolve(reply.safe===true?[]:['editor']);});
  handleLocalized('components:status',event=>{fromMain(event);return getComponents().snapshot();});
  handleLocalized('components:check',event=>{fromMain(event);return getComponents().check();});
  handleLocalized('components:install',async(event,id)=>{fromMain(event);if(!['ffmpeg','ytdlp'].includes(id))throw I18n.error('COMPONENT_NOT_AVAILABLE');if(getComponents().catalog[id])return getComponents().install(id);if(!getComponents().installed(id)){await provisionTool(id);return getComponents().snapshot();}throw I18n.error('COMPONENT_NOT_AVAILABLE');});
  handleLocalized('components:rollback',(event,id)=>{fromMain(event);return getComponents().rollback(id);});
  handleLocalized('components:cancel',event=>{fromMain(event);getComponents().cancel();return true;});
  handleLocalized('system:storage',event=>{fromMain(event);return {music:MUSIC_DIR,data:DATA_DIR,languages:Storage.languages};});
  handleLocalized('system:app-info', () => ({ name:APP_NAME, version:APP_VERSION, tagline:I18n.t("AppTagline"), homepage:APP_HOMEPAGE }));
  handleLocalized('system:openExternal', (_e, url) => shell.openExternal(validateHttpUrl(url).href));
  handleLocalized('window:minimize', () => mainWindow?.minimize());
  handleLocalized('window:toggleMaximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  handleLocalized('window:close', () => mainWindow?.close());
  handleLocalized('window:isMaximized', () => !!mainWindow?.isMaximized());
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    syncNativeTheme(getSettings().theme);
    registerIpc();
    await getUpdates().onStartup({failed:process.argv.includes('--update-failed')});
    if(getUpdates().state.phase==='installing')return;
    I18n.watch(broadcastLanguage);
    createWindow();
    if(process.platform==='win32')scheduleComponentCheck();
    registerGlobalShortcuts(getSettings());
    applyOverlayConfiguration(getSettings().playerOverlay).catch(() => {});
    applyGameOverlayConfiguration(getSettings().gameOverlay).catch(() => {});
    startWatcher();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  I18n.close();
  clearTimeout(componentCheckTimer);updateManager?.close();componentManager?.cancel();searchService?.dispose();libraryEnrichment?.dispose();coverSearch?.dispose();libraryImporter?.dispose();
  try { flushSettings(); } catch (error) { console.error(I18n.t('FinalSettingsFlushFailed'), error); }
  destroyOverlayWindow();
  stopGameOverlayHost();
  try { watcher?.close(); } catch {}
  try { lyricsStore?.dispose(); vaultStore?.lock(); previewServer?.close(); } catch {}
  try { globalShortcut.unregisterAll(); } catch {}
  clearTimeout(overlayHideTimer);
});
