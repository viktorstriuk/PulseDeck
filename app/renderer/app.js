'use strict';
(() => {
const I18n = window.PulseI18n;
'use strict';

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const api = window.pulse;
  // Do not blur controls on click: native activation, text input and keyboard
  // navigation remain intact. Only the focus indicator follows input modality.
  document.documentElement.dataset.inputModality='pointer';
  document.addEventListener('pointerdown',()=>{document.documentElement.dataset.inputModality='pointer';},true);
  document.addEventListener('keydown',e=>{if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&['Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key))document.documentElement.dataset.inputModality='keyboard';},true);
  const Library = window.PulseLibrary;
  const Surface = window.PulseSurfaceStyle;
  const surfaceScopes = document.createElement('style');
  surfaceScopes.id='surfaceScopeStyles'; surfaceScopes.textContent=Surface.scopeCSS(); document.head.append(surfaceScopes);
  let surfaceTarget='blocks';
  const selectedSurface=()=>Surface.current(state.settings,surfaceTarget);
  const updateSurface=patch=>Object.assign(state.settings,Surface.update(state.settings,surfaceTarget,patch));
  const orderHistory = new Library.OrderHistory(100);
  let menuReorder=null,presetsUI=null;
  let trackReorder = null, trackSelection = null, lyricsView = null, searchUI = null, trackTools = null;
  let bulkBusy = false;
  let playlistSelection=null, playlistReorders=[], vaultEpoch=0, vaultPromptResolve=null;
  let reorderContext = null;
  let deferredLibraryRender = false, deferredCategoryRender = false, pendingLibrarySnapshot = null;
  let libraryLoadEpoch = 0, appIconEpoch = 0, finishReorderFrame = 0;
  const defaultAppIconUrl = new URL('../assets/app-icons/blue-violet-monitor.png', document.baseURI).href;
  const audio = $('#audio');
  const onlinePreviewAudio = $('#onlinePreviewAudio');
  const trimPreviewAudio = $('#trimPreviewAudio');

  const sortLabels = () => ({ manual:I18n.t("UICustomOrder"), recent:I18n.t("UINewestFirst"), old:I18n.t("UIOldestFirst"), title:I18n.t("UITitleAZ"), titleDesc:I18n.t("UITitleZA"), artist:I18n.t("UIByArtist"), album:I18n.t("UIByAlbum"), durationAsc:I18n.t("UIShortestFirst"), durationDesc:I18n.t("UILongestFirst"), source:I18n.t("UIBySource"), sizeDesc:I18n.t("UIByFileSize"), loudnessAsc:I18n.t("LoudnessAscending"), loudnessDesc:I18n.t("LoudnessDescending") });
  const accentValues = {
    purple: '#b038ae', blue: '#4665c2', mint: '#27ab7b', olive: '#5c6929', clay: '#bd6e44', teal: '#2b97a1', rose: '#d4608a', gold: '#c79a31', crimson: '#b93e56',
  };
  const categoryPresetColors = ['#b038ae','#4665c2','#27ab7b','#5c6929','#bd6e44','#f2be43','#38a7d8'];
  const playlistIcons = window.PulsePlaylistIcons;
  const categoryIconNames = playlistIcons.names.map(name => `pi:${name}`);
  const builtinAppIcons = ['mint-violet','blue-violet','magenta-orange','ocean','forest','sunset','indigo','mono','sky','coral','lime','noir'];
  const hotkeyDefaults = { enabled:true, playPause:'Alt+Shift+Space', next:'Alt+Shift+Right', previous:'Alt+Shift+Left', volumeUp:'Alt+Shift+Up', volumeDown:'Alt+Shift+Down', mute:'Alt+Shift+M', nextPlaylist:'Alt+Shift+PageDown', previousPlaylist:'Alt+Shift+PageUp', showOverlay:'Alt+Shift+O', showHelp:'Alt+Shift+H', toggleClickThrough:'Alt+Shift+P', toggleShuffle:'Alt+Shift+S', cycleRepeat:'Alt+Shift+R', favoriteCurrent:'Alt+Shift+F', focusSearch:'Alt+Shift+/', openImport:'Alt+Shift+I', trimCurrentTrack:'Alt+Shift+X' };
  const appearanceDefaults = { theme:'dark', accent:'purple', customAccent:'#b038ae', backgroundMode:'off', backgroundOpacity:34, appIcon:'builtin:blue-violet', surfaceStyle:'glass', surfaceOpacity:94, surfaceBorderColor:'#d9e5f0', surfaceBorderOpacity:18, surfaceBorderThickness:1, surfaceApplyAll:false, surfaceProfiles:{} };
  const libraryDefaults = { view:'grid', sort:'recent' };
  const gameOverlayDefaults = { mode:'auto', onlyFullscreen:true, allowlistOnly:false, allowedGames:[], pollMs:120, rtssVisualizer:true, rtssAnchor:'top-left', rtssOffsetX:24, rtssOffsetY:24 };
  const playerOverlayDefaults = {
    mode:'off', duration:3.2, notifyAutoNext:false, showCover:true, showTitle:true, showArtist:true, showProgress:true, showElapsed:true, showRemaining:true,
    showLabel:false, showControls:true, showPlaylist:false, showClickThroughToggle:true, label:'', opacity:94, cornerRadius:18, clickThroughWhenMinimized:true, fullscreenTopmost:true,
    visualizer:true, visualizerStyle:'bars', visualizerPosition:'background', visualizerHeight:120, visualizerColor:'#b038ae', visualizerColor2:'#4665c2', visualizerColorMode:'cover',
    visualizerOpacity:100, visualizerDetail:96, visualizerGap:20, visualizerLineWidth:7.0, visualizerRoundness:100, visualizerRotation:10, visualizerMirror:false, visualizerFill:true,
    sensitivity:1, smoothing:35, background:'#11151d', backgroundVisible:true, borderVisible:true, backgroundBlur:18, width:430, height:122, bounds:null,
  };
  const hotkeyMeta = () => [
    ['playPause',I18n.t("PlayerOverlayPauseResume"),I18n.t("UIMainPlaybackControl"),'play'],
    ['next',I18n.t("PlayerOverlayNextTrack"),I18n.t("UIChangeTheMusicWithoutLeavingYourGame"),'skipForward'],
    ['previous',I18n.t("PlayerOverlayPreviousTrack"),I18n.t("UIGoBackToThePreviousTrack"),'skipBack'],
    ['volumeUp',I18n.t("PlayerOverlayVolumeUp"),I18n.t("UIIncreasePulseDeckVolume"),'volume'],
    ['volumeDown',I18n.t("PlayerOverlayVolumeDown"),I18n.t("UIDecreasePulseDeckVolume"),'volume'],
    ['mute',I18n.t("UIToggleMute"),I18n.t("UIInstantlyMutePulseDeck"),'volumeX'],
    ['nextPlaylist',I18n.t("PlayerOverlayNextPlaylist"),I18n.t("UISwitchTheQueueAndPlayTheFirstTrack"),'list'],
    ['previousPlaylist',I18n.t("PlayerOverlayPreviousPlaylist"),I18n.t("UISwitchToThePreviousQueue"),'list'],
    ['showOverlay',I18n.t("UIShowThePlayer"),I18n.t("UIShowThePopupWindowOnDemand"),'eye'],
    ['toggleClickThrough',I18n.t("UIPlayerClickThrough"),I18n.t("UIToggleEvenWhenTheButtonIsHidden"),'mousePointer'],
    ['showHelp',I18n.t("UIKeyboardShortcuts"),I18n.t("UIShowShortcutsInTheCornerOfTheScreen"),'info'],
    ['toggleShuffle',I18n.t("UIToggleShuffle"),I18n.t("UITurnShuffleOnOrOff"),'shuffle'],
    ['cycleRepeat',I18n.t("UICycleRepeatMode"),I18n.t("UICycleRepeatOffAllAndOne"),'repeat'],
    ['favoriteCurrent',I18n.t("UIFavouriteCurrentTrack"),I18n.t("UIAddOrRemoveTheCurrentTrackFromFavourites"),'heart'],
    ['focusSearch',I18n.t("UIFocusSearch"),I18n.t("UIOpenTheLibrarySearchAndHighlightTheInput"),'search'],
    ['openImport',I18n.t("UIOpenImportHotkey"),I18n.t("UIOpenTheOnlineImportWindowFromAnywhere"),'cloudDownload'],
    ['trimCurrentTrack',I18n.t("UITrimCurrentTrack"),I18n.t("UIOpenTheTrimEditorForTheCurrentYouTubeTrack"),'paint'],
  ];

  const state = {
    tracks: [],
    privateTracks: [], privateNowPlaying:null, vaultUnlocked:false, vaultArchived:0,
    filtered: [],
    settings: {
      theme: 'dark', accent: 'purple', customAccent: '#b038ae', view: 'grid', sort: 'recent', volume: .82, lastTrack: '',
      categoryLayout: 'top', categoryOrder: [], categoryStyles: {}, customCategories: [],
      artistAliases: {}, artistNames: {}, playlistMembership: {}, trackOrders: {}, favorites: [],
      backgroundMode: 'off', customBackground: '', backgroundHistory: [], backgroundOpacity: 34, appIcon: 'builtin:blue-violet', surfaceStyle: 'glass', surfaceOpacity: 94, surfaceBorderColor: '#d9e5f0', surfaceBorderOpacity: 18, surfaceBorderThickness: 1, surfaceApplyAll: false, surfaceProfiles: {},
      hotkeys: { enabled:true, playPause:'Alt+Shift+Space', next:'Alt+Shift+Right', previous:'Alt+Shift+Left', volumeUp:'Alt+Shift+Up', volumeDown:'Alt+Shift+Down', mute:'Alt+Shift+M', nextPlaylist:'Alt+Shift+PageDown', previousPlaylist:'Alt+Shift+PageUp', showOverlay:'Alt+Shift+O', showHelp:'Alt+Shift+H', toggleClickThrough:'Alt+Shift+P', toggleShuffle:'Alt+Shift+S', cycleRepeat:'Alt+Shift+R', favoriteCurrent:'Alt+Shift+F', focusSearch:'Alt+Shift+/', openImport:'Alt+Shift+I', trimCurrentTrack:'Alt+Shift+X' },
      gameOverlay: { mode:'auto', onlyFullscreen:true, allowlistOnly:false, allowedGames:[], pollMs:120, rtssVisualizer:true, rtssAnchor:'top-left', rtssOffsetX:24, rtssOffsetY:24 },
      playerOverlay: { mode:'off', duration:3.2, notifyAutoNext:false, showCover:true, showTitle:true, showArtist:true, showProgress:true, showElapsed:true, showRemaining:true, showLabel:false, showControls:true, showPlaylist:false, showClickThroughToggle:true, label:'', opacity:94, cornerRadius:18, clickThroughWhenMinimized:true, fullscreenTopmost:true, backgroundVisible:true, borderVisible:true, backgroundBlur:18, visualizer:true, visualizerStyle:'bars', visualizerPosition:'background', visualizerHeight:120, visualizerColor:'#b038ae', visualizerColor2:'#4665c2', visualizerColorMode:'cover', visualizerOpacity:100, visualizerDetail:96, visualizerGap:20, visualizerLineWidth:7.0, visualizerRoundness:100, visualizerRotation:10, visualizerMirror:false, visualizerFill:true, sensitivity:1, smoothing:35, background:'#11151d', width:430, height:122, bounds:null },
    },
    downloadJobs: new Map(),
    downloadJobUrls: new Map(),
    prepareEpoch: 0,
    mergeDraft: null,
    overlayLastSaved: {},
    query: '',
    category: 'all',
    currentId: null,
    shuffle: false,
    repeat: 'off',
    onlineProvider: 'youtube',
    loading: true,
    probing: false,
    pendingDelete: null,
    pendingConfirm: null,
    lastVolume: .82,
    categorySignature: '',
    librarySignature: '',
    onlinePreview: null,
    trim: null,
    playbackOwner: 'none',
    playbackEpoch: 0,
    rgbDraft: { r: 176, g: 56, b: 174 },
    colorDraft: { h: 301, s: 68, v: 69, model: 'rgb' },
    colorTarget: { type: 'accent' },
    customIconDraft: null,
    categoryEditMode: false,
    categoryContextKey: '',
    categoryDraft: null,
    categoryDraftKey: '',
    categoryDrag: null,
    appearanceUrls: new Map(),
    appIconUrl: defaultAppIconUrl,
    categoryGestureActive: false,
    backgroundRenderEpoch: 0,
    modalZ: 1000,
    submenuHideTimer: 0,
    settingsPage: 'appearance',
    hotkeyRecording: null,
    hotkeyStatus: {},
    overlayPreviewOpen: false,
    gameOverlayStatus: { supported:true, running:false, active:false, renderer:'none', reason:I18n.t("AppCheckingRTSSAndTheGameModule"), candidates:[], rtss:{running:false,hooked:false} },
    overlayStateTimer: 0,
    analyser: null,
    audioContext: null,
    mediaSource: null,
    vizRaf: 0,
    vizTimer: 0,
    lastVizFrameAt: 0,
    gamePaletteSource: '',
    gamePaletteEpoch: 0,
  };

  const playbackElements = {
    local: audio,
    online: onlinePreviewAudio,
    trim: trimPreviewAudio,
  };

  function pauseQuietly(element) {
    if (!element) return;
    try { if (!element.paused) element.pause(); } catch {}
  }

  function claimPlayback(owner) {
    state.playbackEpoch += 1;
    state.playbackOwner = owner;
    for (const [name, element] of Object.entries(playbackElements)) {
      if (name !== owner) pauseQuietly(element);
    }
    return state.playbackEpoch;
  }

  function releasePlayback(owner) {
    if (state.playbackOwner !== owner) return;
    state.playbackEpoch += 1;
    state.playbackOwner = 'none';
  }

  function playbackClaimIsCurrent(owner, token) {
    return state.playbackOwner === owner && state.playbackEpoch === token;
  }

  function guardPlayback(owner) {
    const element = playbackElements[owner];
    if (!element) return false;
    // A stale async .play() is never allowed to steal audio focus from a newer user action.
    if (state.playbackOwner !== owner) {
      pauseQuietly(element);
      return false;
    }
    for (const [name, other] of Object.entries(playbackElements)) {
      if (name !== owner) pauseQuietly(other);
    }
    return true;
  }

  async function playClaimed(owner, token, element) {
    if (!playbackClaimIsCurrent(owner, token)) return false;
    try {
      await element.play();
    } catch (error) {
      if (!playbackClaimIsCurrent(owner, token) || error?.name === 'AbortError') return false;
      throw error;
    }
    if (!playbackClaimIsCurrent(owner, token)) {
      pauseQuietly(element);
      return false;
    }
    return true;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  }

  function safeUrl(value, allowed = ['file:', 'https:', 'http:']) {
    try {
      const u = new URL(String(value || ''));
      return allowed.includes(u.protocol) ? u.href : '';
    } catch { return ''; }
  }

  function formatTime(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return '0:00';
    const whole = Math.floor(n);
    const s = Math.floor(whole % 60).toString().padStart(2, '0');
    const m = Math.floor(whole / 60);
    if (m < 60) return `${m}:${s}`;
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, '0')}:${s}`;
  }

  function formatTotal(seconds) {
    if (!seconds) return '';
    const mins = Math.round(seconds / 60);
    if (mins < 60) return I18n.t("UIMin", {value1:(mins)});
    const hours = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? I18n.t("UIHMin", {value1:(hours),value2:(rem)}) : I18n.t("UIH", {value1:(hours)});
  }

  function formatDate(ms) {
    try {
      return new Intl.DateTimeFormat(I18n.locale, {
        day:'numeric', month:'short', year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
      }).format(new Date(ms));
    } catch { return ''; }
  }

  function decl(n, one, few, many) {
    const form = new Intl.PluralRules(I18n.locale).select(Number(n));
    return form === 'one' ? one : form === 'few' ? few : many;
  }

  function applyIcons(root = document) {
    $$('[data-icon]', root).forEach((el) => {
      const name = el.dataset.icon;
      const size = Number(el.dataset.size || 18);
      el.innerHTML = window.Icon(name, size);
    });
  }

  function categoryIconMarkup(icon, size = 16) {
    const raw = String(icon || 'pi:music-note');
    if (raw.startsWith('pi:')) {
      const name = playlistIcons.resolve(raw);
      return `<span class="playlist-archive-icon" style="--playlist-icon:url('../assets/playlist-icons/${name}.svg');width:${size}px;height:${size}px" aria-hidden="true"></span>`;
    }
    return window.Icon(raw || 'music', size);
  }

  function playlistLabel(cat) { return cat?.label || cat?.name || I18n.t("UIPlaylist"); }

  function setRangeFill(el, percent) {
    el.style.setProperty('--value', `${Math.max(0, Math.min(100, percent))}%`);
  }

  function hexToRgb(hex) {
    const m = String(hex || '').match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return { r:82, g:214, b:178 };
    return { r:parseInt(m[1],16), g:parseInt(m[2],16), b:parseInt(m[3],16) };
  }

  function rgbToHex(r, g, b) {
    return `#${[r,g,b].map((v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0))).toString(16).padStart(2,'0')).join('')}`;
  }

  function shadeHex(hex, factor = .82) {
    const { r,g,b } = hexToRgb(hex);
    return rgbToHex(r * factor, g * factor, b * factor);
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }

  function rgbToHsv(r, g, b) {
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
    let h=0;
    if (d) {
      if (max===r) h=((g-b)/d)%6;
      else if (max===g) h=(b-r)/d+2;
      else h=(r-g)/d+4;
      h*=60; if (h<0) h+=360;
    }
    return { h, s:max ? d/max*100 : 0, v:max*100 };
  }

  function hsvToRgb(h, s, v) {
    h=((Number(h)||0)%360+360)%360; s=clamp(s,0,100)/100; v=clamp(v,0,100)/100;
    const c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c;
    let rp=0,gp=0,bp=0;
    if (h<60) [rp,gp,bp]=[c,x,0]; else if (h<120) [rp,gp,bp]=[x,c,0]; else if (h<180) [rp,gp,bp]=[0,c,x];
    else if (h<240) [rp,gp,bp]=[0,x,c]; else if (h<300) [rp,gp,bp]=[x,0,c]; else [rp,gp,bp]=[c,0,x];
    return { r:Math.round((rp+m)*255), g:Math.round((gp+m)*255), b:Math.round((bp+m)*255) };
  }

  function rgbToHsl(r,g,b) {
    r/=255;g/=255;b/=255; const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
    let h=0; const l=(max+min)/2; let s=0;
    if (d) { s=d/(1-Math.abs(2*l-1)); if(max===r)h=60*(((g-b)/d)%6); else if(max===g)h=60*((b-r)/d+2); else h=60*((r-g)/d+4); if(h<0)h+=360; }
    return {h,s:s*100,l:l*100};
  }

  function hslToRgb(h,s,l) {
    h=((Number(h)||0)%360+360)%360; s=clamp(s,0,100)/100; l=clamp(l,0,100)/100;
    const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
    let rp=0,gp=0,bp=0;
    if(h<60)[rp,gp,bp]=[c,x,0]; else if(h<120)[rp,gp,bp]=[x,c,0]; else if(h<180)[rp,gp,bp]=[0,c,x]; else if(h<240)[rp,gp,bp]=[0,x,c]; else if(h<300)[rp,gp,bp]=[x,0,c]; else [rp,gp,bp]=[c,0,x];
    return {r:Math.round((rp+m)*255),g:Math.round((gp+m)*255),b:Math.round((bp+m)*255)};
  }

  function categoryStyleFor(key) {
    return state.settings.categoryStyles?.[key] || {};
  }

  function customCategoryByKey(key) {
    return (state.settings.customCategories || []).find((c) => c.id === key) || null;
  }

  function categoryByKey(key) {
    return Library.categories(state.tracks,state.settings,true).find((c) => c.key === key) || null;
  }

  function categoryCssVars(cat) {
    const color = /^#[0-9a-f]{6}$/i.test(cat.color || '') ? cat.color : 'var(--accent)';
    const gradient = Array.isArray(cat.gradient) && cat.gradient.length ? cat.gradient : [cat.color || state.settings.customAccent || '#b038ae'];
    const stops = gradient.slice(0,4).map((c) => /^#[0-9a-f]{6}$/i.test(c) ? c : '#b038ae');
    const grad = stops.length > 1 ? `linear-gradient(90deg,${stops.join(',')})` : stops[0];
    const intensity = clamp(cat.glowIntensity ?? 45,0,100);
    const glowHeight = Math.round(6 + intensity * .24);
    const glowOpacity = (.08 + intensity * .0062).toFixed(3);
    return `--cat-color:${color};--cat-gradient:${grad};--cat-glow-height:${glowHeight}px;--cat-glow-opacity:${glowOpacity};`;
  }

  async function persistCategorySettings() {
    await api.settings.set({
      categoryOrder: state.settings.categoryOrder,
      categoryStyles: state.settings.categoryStyles,
      customCategories: state.settings.customCategories,
      categoryLayout: state.settings.categoryLayout,
    }).catch((error) => { toast('bad', I18n.t("UICouldNotSavePlaylists"), I18n.errorMessage(error) || String(error), 6500); throw error; });
  }

  function updateSystemThemeSwatch() {
    const swatch = document.querySelector('.theme-swatch.system');
    if (!swatch) return;
    const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    swatch.style.setProperty('--sw-bg', dark ? '#0a0b0f' : '#f4f5f8');
    swatch.style.setProperty('--sw-surface', dark ? '#181b24' : '#ffffff');
    swatch.style.setProperty('--sw-accent', dark ? '#8b72ff' : '#4665c2');
    swatch.dataset.systemScheme=dark?'dark':'light';
  }

  async function updateCustomIconButtonPreview() {
    const host = $('#customIconBtn .custom-icon-placeholder');
    if (!host) return;
    const ref = String(state.settings.appIcon || '');
    if (ref.startsWith('custom-icons/')) {
      const url = await api.appearance.iconUrl(ref).catch(() => '');
      if (url) {
        host.innerHTML = `<img src="${esc(url)}" alt="" />`;
        return;
      }
    }
    host.innerHTML = '<span class="original-monitor-mark" aria-hidden="true"></span>';
  }

  function applyAppearance() {
    const root = document.documentElement;
    root.dataset.theme = state.settings.theme || 'dark';
    root.dataset.accent = state.settings.accent || 'purple';
    Surface.paint(root,state.settings);
    const surface=selectedSurface();
    $('#surfaceApplyAll').checked=state.settings.surfaceApplyAll===true;
    $('#surfaceTargetOptions').classList.toggle('hidden',state.settings.surfaceApplyAll===true);
    $('#surfaceCommonResetBtn').classList.toggle('hidden',state.settings.surfaceApplyAll===true);
    $$('#surfaceTargetOptions [data-surface-target]').forEach(b=>{const active=b.dataset.surfaceTarget===surfaceTarget;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    I18n.setText($('#surfaceScopeNote'),()=>I18n.t(state.settings.surfaceApplyAll?'SurfaceCommonHelp':'SurfaceIndividualHelp'));
    const hex = state.settings.accent === 'custom'
      ? (/^#[0-9a-f]{6}$/i.test(state.settings.customAccent || '') ? state.settings.customAccent : '#b038ae')
      : (accentValues[state.settings.accent] || '#b038ae');
    const rgb = hexToRgb(hex);
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-2', shadeHex(hex));
    root.style.setProperty('--accent-rgb', `${rgb.r},${rgb.g},${rgb.b}`);
    const opacity = clamp(state.settings.backgroundOpacity ?? 34,1,100);
    root.style.setProperty('--library-bg-opacity', (opacity / 100).toFixed(2));
    root.style.setProperty('--library-bg-overlay', Math.max(.02, .89 - opacity / 100 * .87).toFixed(2));
    root.style.setProperty('--library-bg-brightness', (.74 + opacity / 100 * .26).toFixed(2));
    const surfaceOpacity = clamp(Number(surface.surfaceOpacity ?? 94), 0, 100);
    const surfaceBorderOpacity = clamp(Number(surface.surfaceBorderOpacity ?? 18), 0, 100);
    const surfaceBorderThickness = clamp(Number(surface.surfaceBorderThickness ?? 1), 0, 6);
    const surfaceBorderColor = /^#[0-9a-f]{6}$/i.test(surface.surfaceBorderColor || '') ? surface.surfaceBorderColor : '#d9e5f0';
    const surfaceRgb = hexToRgb(surfaceBorderColor);
    root.style.setProperty('--surface-opacity', (surfaceOpacity / 100).toFixed(2));
    root.style.setProperty('--surface-border-rgb', `${surfaceRgb.r},${surfaceRgb.g},${surfaceRgb.b}`);
    root.style.setProperty('--surface-border-alpha', (surfaceBorderOpacity / 100).toFixed(2));
    root.style.setProperty('--surface-border-width', `${surfaceBorderThickness}px`);
    const custom = $('#customAccentBtn');
    if (custom) custom.style.setProperty('--custom-color', state.settings.customAccent || '#b038ae');
    $$('.theme-option').forEach((b) => b.classList.toggle('active', b.dataset.theme === state.settings.theme));
    $$('#accentOptions button[data-accent]').forEach((b) => b.classList.toggle('active', b.dataset.accent === state.settings.accent));
    $$('#appIconOptions [data-app-icon]').forEach((b) => {
      const active = b.id === 'customIconBtn' ? String(state.settings.appIcon || '').startsWith('custom-icons/') : b.dataset.appIcon === state.settings.appIcon;
      b.classList.toggle('active', active);
    });
    $$('#backgroundMode [data-background-mode]').forEach((b) => b.classList.toggle('active', b.dataset.backgroundMode === state.settings.backgroundMode));
    $$('#playlistLayoutControl [data-category-layout]').forEach((b) => b.classList.toggle('active', b.dataset.categoryLayout === state.settings.categoryLayout));
    $$('#surfaceStyleOptions [data-surface-style]').forEach((b) => {const active=b.dataset.surfaceStyle===surface.surfaceStyle;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    const opacityInput = $('#backgroundOpacity');
    if (opacityInput) {
      opacityInput.value = opacity;
      setRangeFill(opacityInput, opacity);
      $('#backgroundOpacityValue').textContent = `${Math.round(opacity)}%`;
    }
    const surfaceOpacityInput = $('#surfaceOpacity');
    if (surfaceOpacityInput) {
      surfaceOpacityInput.value = surfaceOpacity; setRangeFill(surfaceOpacityInput, surfaceOpacity); $('#surfaceOpacityValue').textContent = `${Math.round(surfaceOpacity)}%`;
    }
    const surfaceBorderOpacityInput = $('#surfaceBorderOpacity');
    if (surfaceBorderOpacityInput) {
      surfaceBorderOpacityInput.value = surfaceBorderOpacity; setRangeFill(surfaceBorderOpacityInput, surfaceBorderOpacity); $('#surfaceBorderOpacityValue').textContent = `${Math.round(surfaceBorderOpacity)}%`;
    }
    const surfaceBorderThicknessInput = $('#surfaceBorderThickness');
    if (surfaceBorderThicknessInput) {
      surfaceBorderThicknessInput.value = surfaceBorderThickness; setRangeFill(surfaceBorderThicknessInput, surfaceBorderThickness / 6 * 100); $('#surfaceBorderThicknessValue').textContent = I18n.t('SurfaceBorderPx',{value1:surfaceBorderThickness});
    }
    const borderButton = $('#surfaceBorderColorBtn');
    if (borderButton) { borderButton.style.setProperty('--overlay-color',surfaceBorderColor); $('#surfaceBorderHex').textContent=surfaceBorderColor.toUpperCase(); }

    const invisible = surface.surfaceStyle === 'invisible';
    const noFill = invisible || surface.surfaceStyle === 'outline';
    $('#surfaceOpacity').disabled = noFill;
    $('#surfaceOpacity').closest('.player-control-field').classList.toggle('control-disabled',noFill);
    for(const control of [$('#surfaceBorderThickness'),$('#surfaceBorderOpacity'),borderButton]){
      control.disabled=invisible;
      control.closest('.player-control-field').classList.toggle('control-disabled',invisible);
    }
    I18n.setText($('#surfaceModeNote'),()=>I18n.t(invisible?'SurfaceInvisibleHelp':noFill?'SurfaceOutlineHelp':'SurfaceLiveHelp'));
    document.documentElement.dataset.categoryLayout = state.settings.categoryLayout === 'side' ? 'side' : 'top';
    updateSystemThemeSwatch();
    updateCustomIconButtonPreview();
    applyLibraryBackground();
  }

  function toast(type, title, message = '', duration = 3400, id = '') {
    let node = id ? document.querySelector(`.toast[data-toast-id="${CSS.escape(id)}"]`) : null;
    if (!node) {
      node = document.createElement('div');
      node.className = `toast ${type}`;
      if (id) node.dataset.toastId = id;
      $('#toastStack').prepend(node);
    } else node.className = `toast ${type}`;
    const icon = type === 'good' ? 'check' : type === 'bad' ? 'alert' : 'info';
    node.innerHTML = `<span class="toast-icon">${window.Icon(icon,18)}</span><div class="toast-copy"><strong>${esc(title)}</strong>${message ? `<span>${esc(message)}</span>` : ''}</div>`;
    I18n.setOwnedText(node.querySelector('.toast-copy strong'), title);
    if(message)I18n.setOwnedText(node.querySelector('.toast-copy span'), message);
    if (duration > 0) {
      clearTimeout(node._timer);
      node._timer = setTimeout(() => node.remove(), duration);
    }
    return node;
  }

  const downloadStageLabels = () => ({ preparing:I18n.t("UIPreparing"), metadata:I18n.t("UICheckingTheSource"), trim:I18n.t("UISelectASegment"),
    download:I18n.t("UIDownloading"), postprocess:I18n.t("UIProcessingAudio"), verify:I18n.t("UICheckingTheFile"), done:I18n.t("UIDownloaded"), error:I18n.t("UIRetryDownload") });
  const activeDownloadStages = new Set(['preparing','metadata','download','postprocess','verify']);
  function downloadKey(url) { try { return new URL(url).href; } catch { return String(url || ''); } }

  function createDownloadJob(url, stage = 'preparing') {
    const key = downloadKey(url), jobId = Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
    const job = { jobId, url:key, stage, percent:null, message:'' };
    state.downloadJobs.set(key, job); state.downloadJobUrls.set(jobId, key);
    patchDownloadRows(key);
    return job;
  }

  function patchDownloadRows(url = '') {
    const key = url && downloadKey(url);
    for (const row of $$('#onlineResults [data-online-item]')) {
      const rowKey = downloadKey(row.dataset.onlineItem);
      if (key && rowKey !== key) continue;
      const job = state.downloadJobs.get(rowKey), stage = job?.stage || '';
      const busy = activeDownloadStages.has(stage), waiting = stage === 'trim', done = stage === 'done';
      const button = row.querySelector('[data-online-download]');
      if (!button) continue;
      row.classList.toggle('download-active', busy); row.classList.toggle('download-complete', done); row.classList.toggle('download-failed', stage === 'error');
      row.setAttribute('aria-busy', String(busy));
      button.disabled = busy || done || row.classList.contains('search-result-blocked');
      button.classList.toggle('downloading', busy);
      button.classList.toggle('downloaded', done);
      I18n.setAttribute(button,"title",()=>(stage === 'error' ? I18n.t("UIClickToRetry", {value1:(job.message || I18n.msg("UICouldNotDownload"))})
        : busy || waiting || done ? downloadStageLabels()[stage] : state.onlineProvider === 'youtube' ? I18n.t("UIPrepareTheDownloadAndOptionallyTrimIt") : I18n.t("UIDownload")));
      I18n.setAttribute(button,'aria-label',()=>button.title);
      button.innerHTML = busy ? '<span class="download-button-spinner" aria-hidden="true"></span>' : window.Icon(done ? 'check' : stage === 'error' ? 'refresh' : 'download',16);
      let status = row.querySelector('.online-download-status');
      if (!status) { status = document.createElement('small'); status.className = 'online-download-status'; row.querySelector('.online-copy')?.append(status); }
      const measured = stage === 'download' && Number.isFinite(job?.percent);
      if (status) { status.textContent = stage ? `${downloadStageLabels()[stage] || ''}${measured ? ` ${Math.round(job.percent)}%` : ''}${stage === 'download' && job.speed ? ` · ${job.speed}` : ''}` : ''; status.title = job?.message || ''; }
      let bar = row.querySelector('.online-download-progress');
      if (!bar) { bar = document.createElement('div'); bar.className = 'online-download-progress'; bar.innerHTML = '<i></i>'; bar.setAttribute('role','progressbar'); I18n.setAttribute(bar,'aria-label',()=>(I18n.t("UITrackDownload"))); row.append(bar); }
      bar.classList.toggle('hidden', !busy && !done);
      bar.classList.toggle('indeterminate', busy && !measured);
      bar.setAttribute('aria-valuemin','0'); bar.setAttribute('aria-valuemax','100');
      if (measured || done) bar.setAttribute('aria-valuenow', String(done ? 100 : Math.round(job.percent)));
      else bar.removeAttribute('aria-valuenow');
      bar.setAttribute('aria-valuetext', downloadStageLabels()[stage] || '');
      bar.firstElementChild.style.width = measured ? `${clamp(job.percent,0,100)}%` : done ? '100%' : '36%';
    }
    const directJob = state.downloadJobs.get(downloadKey($('#urlInput')?.value?.trim() || ''));
    const directButton = $('#urlDownloadBtn');
    if (directButton) {
      const busy = activeDownloadStages.has(directJob?.stage), done = directJob?.stage === 'done', failed = directJob?.stage === 'error';
      directButton.disabled = busy || done; directButton.setAttribute('aria-busy', String(busy));
      directButton.innerHTML = `${busy ? '<span class="download-button-spinner" aria-hidden="true"></span>' : window.Icon(done ? 'check' : failed ? 'refresh' : 'download', 16)}<span>${busy ? I18n.h("UIDownloading2") : done ? I18n.h("UIDownloaded") : failed ? I18n.h("UIRetry") : I18n.h("UIDownload")}</span>`;
      I18n.setAttribute(directButton,"title",()=>(failed ? (directJob.message || I18n.t("UIRetryDownload")) : busy ? (downloadStageLabels()[directJob.stage] || I18n.t("UIDownload2")) : done ? I18n.t("UIThisTrackHasAlreadyBeenDownloadedInThis") : I18n.t("UIDownloadFromLink")));
    }
  }

  function acceptDownloadProgress(payload = {}) {
    const key = state.downloadJobUrls.get(payload.jobId) || downloadKey(payload.url);
    if (key) {
      let job = state.downloadJobs.get(key);
      // Late events from an earlier failed attempt must not overwrite a retry.
      if (job && job.jobId !== payload.jobId) return;
      if (!job) { job = { url:key, jobId:payload.jobId }; state.downloadJobs.set(key, job); }
      Object.assign(job, payload);
      state.downloadJobUrls.set(payload.jobId,key);
      patchDownloadRows(key);
    }
    downloadToast(payload);
  }

  function downloadToast(payload = {}) {
    const toastId = `download-${payload.jobId || 'active'}`;
    let node = document.querySelector(`.toast[data-toast-id="${CSS.escape(toastId)}"]`);
    if (!node) {
      node = document.createElement('div');
      node.className = 'toast info download-toast';
      node.dataset.toastId = toastId;
      $('#toastStack').prepend(node);
    }
    const stage = String(payload.stage || 'metadata');
    const percent = clamp(Number(payload.percent) || 0,0,100);
    const stageText = {
      metadata:I18n.t("UICheckingTheSourceAndMetadata"), download:I18n.t("UIDownloadingAudio"), postprocess:I18n.t("UIProcessingTheAudioFile"),
      verify:I18n.t("UICheckingTheFileAndAddingItToYour"), done:I18n.t("UIDone"), error:I18n.t("AppDownloadStopped"),
    }[stage] || I18n.t("UIDownload2");
    const detail = stage === 'download'
      ? [payload.speed || '', payload.eta ? I18n.t("UIRemaining", {value1:(payload.eta)}) : '', payload.bytes || ''].filter(Boolean).join(' · ')
      : stage === 'postprocess' ? I18n.t("UIFFmpegIsFinalisingTheContainerAndMetadata")
      : stage === 'verify' ? I18n.t("UICheckingFileSizeDurationAndPresenceInYour")
      : stage === 'done' ? (payload.file ? I18n.t("UISaved", {value1:(payload.file)}) : I18n.t("UIFileVerifiedAndAddedToYourLibrary"))
      : stage === 'error' ? (payload.message || I18n.t("UISourceOrNetworkInterruptedTheDownload"))
      : I18n.t("UIThisMayTakeAFewSeconds");
    const icon = stage === 'done' ? 'check' : stage === 'error' ? 'alert' : stage === 'verify' ? 'search' : 'download';
    const barValue = stage === 'metadata' ? 5 : stage === 'postprocess' ? 94 : stage === 'verify' ? 98 : stage === 'done' ? 100 : percent;
    node.className = `toast ${stage === 'done' ? 'good' : stage === 'error' ? 'bad' : 'info'} download-toast`;
    node.innerHTML = `<span class="toast-icon">${window.Icon(icon,18)}</span><div class="toast-copy"><strong>${esc(payload.text || stageText)}</strong><span>${esc(detail)}</span></div><b class="toast-percent">${stage === 'download' ? `${Math.round(percent)}%` : ''}</b><div class="toast-progress ${['metadata','postprocess','verify'].includes(stage)?'indeterminate':''}"><i style="width:${barValue}%"></i></div>`;
    clearTimeout(node._timer);
    if (stage === 'done') node._timer=setTimeout(()=>node.remove(),4200);
    if (stage === 'error') node._timer=setTimeout(()=>node.remove(),9000);
  }

  function renderSkeleton() {
    const lib = $('#library');
    lib.className = 'library grid-view';
    lib.innerHTML = Array.from({ length: 9 }, () => '<div class="skeleton-card"><i></i><div><b></b><span></span><span></span></div></div>').join('');
  }

  function categoryData(includeHidden = false) {
    return Library.categories(state.tracks, state.settings, includeHidden).filter(c=>(c.folderId||'')===(state.folderId||''));
  }

  function libraryFolderLabel(id){return state.settings.libraryFolders?.find(f=>f.id===id)?.name||I18n.t('FolderShared');}
  function folderRailMarkup(side=false){
    const folders=state.settings.libraryFolders||[];
    const add=state.categoryEditMode?`<button class="category-add library-folder-add" data-add-folder title="${I18n.h('FolderCreate')}" aria-label="${I18n.h('FolderCreate')}">${window.Icon('plus',16)}</button>`:'';
    if(!folders.length)return add;
    if(state.folderOverview){
      return add+[{id:'',name:I18n.t('FolderShared'),icon:'folder',color:'#7890b9'},...folders].map(folder=>{
        const count=state.tracks.filter(t=>Library.Folders.ofTrack(t,state.settings)===folder.id).length;
        return `<button class="library-folder-tab ${folder.glow?'has-glow':''}" data-folder-open="${esc(folder.id)}" style="${categoryCssVars(folder)}" title="${esc(folder.name)}"><span class="folder-tab-icon">${categoryIconMarkup(folder.icon||'folder',19)}</span><span class="folder-tab-name">${esc(folder.name)}</span><small>${count}</small></button>`;
      }).join('');
    }
    const folder=folders.find(f=>f.id===state.folderId)||{name:I18n.t('FolderShared'),icon:'folder',color:'#7890b9'};
    return add+`<button class="library-folder-crumb" data-folder-back data-folder-id="${esc(state.folderId||'')}" style="${categoryCssVars(folder)}" aria-label="${I18n.h('FolderBack',{name:folder.name})}" title="${I18n.h('FolderBack',{name:folder.name})}">${categoryIconMarkup(folder.icon||'folder',19)}</button>`;
  }
  async function enterLibraryFolder(id,origin=null){
    if(id&&!state.settings.libraryFolders?.some(f=>f.id===id))return;
    const old=origin?.getBoundingClientRect();state.folderId=id;state.folderOverview=false;state.categorySignature='';trackSelection?.clear();playlistSelection?.clear();
    await navigateCategory(Library.Folders.scoped(id,'all'),{force:true});
    const crumb=$('#categoryChips [data-folder-back]');if(crumb&&old&&!matchMedia('(prefers-reduced-motion: reduce)').matches){const r=crumb.getBoundingClientRect();crumb.animate([{transform:`translateX(${old.left-r.left}px)`},{transform:'none'}],{duration:240,easing:'cubic-bezier(.2,.8,.2,1)'});}
  }
  function openFolderEditor(folder=null){
    openCategoryEditor(folder?{...folder,key:folder.id,label:folder.name,kind:'folder',canRename:true}:null,true);
    state.categoryDraftFolder=folder?.id||'new';state.categoryDraft.icon=folder?.icon||'folder';state.categoryDraft.name=folder?.name||I18n.t('FolderNew');
    $('#categoryProtectedToggle').checked=false;$('#categoryProtectedToggle').closest('.vault-editor-security').classList.add('hidden');
    I18n.setText($('#categoryStyleTitle'),()=>folder?I18n.t('FolderEdit'):I18n.t('FolderCreate'));renderCategoryEditor();
  }
  async function saveFolderEditor(){
    const button=$('#categoryStyleSave');if(button.disabled)return;button.disabled=true;
    try{const style={...state.categoryDraft,name:$('#categoryNameInput').value.trim()};const result=await api.library.command({type:'folder-save',id:state.categoryDraftFolder==='new'?'':state.categoryDraftFolder,style});
      Object.assign(state.settings,result.settings);state.categoryDraftFolder=null;closeModal('categoryStyleModal');state.categorySignature='';
      await enterLibraryFolder(result.folder.id);state.categoryEditMode=true;renderCategories(true);
    }catch(e){toast('bad',I18n.t('FoldersTitle'),I18n.errorMessage(e));}finally{button.disabled=false;}
  }
  function openFolderContext(id,x,y){
    const folder=state.settings.libraryFolders?.find(f=>f.id===id);if(id&&!folder)return;
    const menu=$('#contextMenu');hideContextMenu();menu.dataset.menuKind='folder';menu.dataset.folderId=id;
    const sources=Library.categories(state.tracks,state.settings,true).filter(c=>!c.protected&&Library.Folders.ofCategory(c.key,state.settings)!==id);
    menu.innerHTML=`<div class="context-selection-title">${esc(folder?.name||I18n.t('FolderShared'))}</div>
      <button class="context-item" data-folder-command="open">${window.Icon('folder',15)}<span>${I18n.h('FolderOpen')}</span></button>
      ${folder?`<button class="context-item" data-folder-command="edit">${window.Icon('palette',15)}<span>${I18n.h('FolderEdit')}</span></button>`:''}
      ${playlistSubmenu('folder-import',I18n.t('FolderMoveFrom'),'folder',sources.map(c=>`<button class="context-item" data-folder-source="${esc(c.key)}">${categoryIconMarkup(c.icon,15)}<span>${esc(libraryFolderLabel(c.folderId||'')+' / '+c.label)}</span></button>`).join(''))}
      ${folder?`<div class="context-sep"></div><button class="context-item danger" data-folder-command="delete">${window.Icon('trash',15)}<span>${I18n.h('FolderDeleteEmpty')}</span></button>`:''}
      <div class="folder-context-note">${I18n.h('FolderPrivacyNote')}</div>`;
    menuReorder?.prepare();menu.classList.remove('hidden');requestAnimationFrame(()=>{const r=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(innerWidth-r.width-8,x))+'px';menu.style.top=Math.max(58,Math.min(innerHeight-r.height-8,y))+'px';armTrackSubmenu(menu);});
  }
  function askFolderMove(sourceKey,targetFolder,movePlaylist){
    const category=categoryByKey(sourceKey);if(!category)return;
    const moving=state.tracks.filter(Library.membershipPredicate(state.settings,sourceKey));
    openConfirmation({title:I18n.t('FolderMoveTitle',{name:libraryFolderLabel(targetFolder)}),text:I18n.t('FolderMoveConfirm',{name:category.label,count:moving.length}),actionText:I18n.t('UIMove'),icon:'folder',onConfirm:async()=>{
      const playing=currentTrack(),affected=playing&&moving.some(t=>t.id===playing.id),at=audio.currentTime,autoplay=!audio.paused;
      if(affected){audio.pause();audio.removeAttribute('src');audio.load();state.currentId='';}
      try{const result=await api.library.command({type:'folder-move',sourceKey,targetFolder,movePlaylist});Object.assign(state.settings,result.settings);
        if(result.coverAnimation)state.settings.coverAnimation=result.coverAnimation;state.settings.lastTrack=result.lastTrack??state.settings.lastTrack;
        state.folderId=targetFolder;state.folderOverview=false;state.category=result.targetKey||Library.Folders.scoped(targetFolder,'all');state.categorySignature='';state.librarySignature='';
        closeModal('confirmModal');await loadLibrary({quiet:true});
        if(result.warning)toast('bad',I18n.t('FoldersTitle'),result.warning,10000);else toast('good',I18n.t('FolderMoved'),I18n.t('FolderMovedCount',{count:result.count}),3500);
      }finally{if(affected){await loadLibrary({quiet:true});if((!state.currentId||state.currentId===playing.id)&&findTrack(playing.id)){await selectTrack(playing.id,false);const restore=()=>{if(state.currentId!==playing.id)return;try{audio.currentTime=Math.min(at,Number.isFinite(audio.duration)?audio.duration:at);}catch{}if(autoplay&&audio.paused)togglePlay();};if(audio.readyState)restore();else audio.addEventListener('loadedmetadata',restore,{once:true});}}}
    }});
  }
  async function handleFolderMenu(e,menu){
    const source=e.target.closest('[data-folder-source]'),move=e.target.closest('[data-folder-move-playlist]');
    if(source){askFolderMove(source.dataset.folderSource,menu.dataset.folderId||'',false);return true;}
    if(move){askFolderMove(state.categoryContextKey,move.dataset.folderMovePlaylist,true);return true;}
    const command=e.target.closest('[data-folder-command]');if(!command)return false;
    const id=menu.dataset.folderId||'',folder=state.settings.libraryFolders?.find(f=>f.id===id);hideContextMenu();
    if(command.dataset.folderCommand==='open')await enterLibraryFolder(id);
    if(command.dataset.folderCommand==='edit')openFolderEditor(folder);
    if(command.dataset.folderCommand==='delete')openConfirmation({title:I18n.t('FolderDeleteEmpty'),text:I18n.t('FolderDeleteConfirm',{name:folder?.name||''}),actionText:I18n.t('UIDelete'),icon:'trash',onConfirm:async()=>{const result=await api.library.command({type:'folder-delete',id});Object.assign(state.settings,result.settings);if(state.folderId===id)state.folderId='';state.folderOverview=true;closeModal('confirmModal');state.categorySignature='';renderLibrary();}});
    return true;
  }

  function patchPlaylistSelection() {
    document.querySelectorAll('[data-category]').forEach((node) => {
      const active = node.dataset.category === state.category;
      node.classList.toggle('active', active);
      node.setAttribute('aria-selected', String(active));
    });
  }

  function isReordering() { return !!trackReorder?.drag || !!trackSelection?.pointer || !!playlistSelection?.pointer || state.categoryGestureActive; }

  function finishReordering() {
    cancelAnimationFrame(finishReorderFrame);
    // Let the pointerup/click pair finish before replacing a rail or a track.
    finishReorderFrame = requestAnimationFrame(() => {
      if (isReordering()) return;
      if (pendingLibrarySnapshot !== null) {
        state.tracks = pendingLibrarySnapshot; pendingLibrarySnapshot = null;
        state.loading = false;
        deferredLibraryRender = true; deferredCategoryRender = true;
      }
      const library = deferredLibraryRender, categories = deferredCategoryRender;
      deferredLibraryRender = false; deferredCategoryRender = false;
      if (categories) renderCategories(true);
      if (library) { renderLibraryBody(); updatePlayerUI(); probeDurations(); }
    });
  }

  function renderCategories(force = false) {
    if (isReordering()) { deferredCategoryRender = true; return; }
    const folders=state.settings.libraryFolders||[];if(state.folderId&&!folders.some(f=>f.id===state.folderId))state.folderId='';
    if(state.folderOverview===undefined)state.folderOverview=folders.length>0;if(!folders.length)state.folderOverview=false;
    const allCats = categoryData(true);
    const visible = allCats.filter((c) => !c.hidden);
    const hiddenCats = allCats.filter((c) => c.hidden);
    if (!visible.some((c) => c.key === state.category)) state.category = visible[0]?.key || 'all';
    const signature = `${state.folderId||''}|${state.folderOverview}|${JSON.stringify(folders)}|${state.tracks.map(t=>t.rel).join(';')}|${state.categoryEditMode}|${state.settings.categoryLayout}|${allCats.map((c) => `${c.key}:${c.label}:${c.icon}:${c.color}:${c.hidden}:${c.protected}:${c.glow}:${c.glowIntensity}:${(c.gradient||[]).join(',')}`).join('|')}`;
    if (!force && signature === state.categorySignature) { patchPlaylistSelection(); return; }
    state.categorySignature = signature;
    const tabMarkup = (cat, side = false) => `<button class="chip category-tab ${cat.key === state.category ? 'active' : ''} ${cat.glow ? 'has-glow' : ''}" data-category="${esc(cat.key)}" role="tab" aria-selected="${cat.key === state.category}" style="${categoryCssVars(cat)}" title="${esc(cat.label)}">
      ${state.categoryEditMode ? `<span class="category-drag-handle" data-category-drag="${esc(cat.key)}" title="${I18n.h("UIDrag")}" data-i18n-title="UIDrag">${window.Icon('grip',13)}</span>` : ''}
      <span class="category-visual"><span class="category-icon">${categoryIconMarkup(cat.icon || 'music', side ? 17 : 15)}</span><span class="category-label">${esc(cat.label)}</span>${cat.protected?'<span class="playlist-lock-icon">'+window.Icon('lock',12)+'</span>':''}</span>
    </button>`;
    const plus = state.categoryEditMode ? `<button class="category-add" data-add-category title="${I18n.h("UINewPlaylist")}" data-i18n-title="UINewPlaylist">${window.Icon('plus',16)}</button>` : '';
    const rails = [$('#categoryChips'), $('#categorySidebar'), $('#hiddenCategories')];
    const positions = rails.map(node => [node.scrollLeft, node.scrollTop]);
    $('#categoryChips').classList.toggle('folder-overview',!!state.folderOverview);
    $('#categoryChips').innerHTML = folderRailMarkup()+(state.folderOverview?'':visible.map((c) => tabMarkup(c)).join('') + plus);
    const sidebar = $('#categorySidebar');
    sidebar.innerHTML = `<div class="category-side-title" data-i18n="UIPlaylists">${I18n.h("UIPlaylists")}</div>${state.categoryEditMode && hiddenCats.length ? `<div class="side-hidden-categories"><span data-i18n="UIHidden">${I18n.h("UIHidden")}</span>${hiddenCats.map((c)=>`<button draggable="true" data-restore-category="${esc(c.key)}" title="${I18n.h("UIRestore", {value1:(c.label)})}" data-i18n-title="UIRestore" data-i18n-title-args="${I18n.attrArgs({value1:(c.label)})}" style="${categoryCssVars(c)}">${categoryIconMarkup(c.icon || 'eyeOff',13)}<b>${esc(c.label)}</b></button>`).join('')}</div>` : ''}${folderRailMarkup(true)}${state.folderOverview?'':visible.map((c) => tabMarkup(c,true)).join('')}${state.categoryEditMode&&!state.folderOverview ? `<button class="category-side-add" data-add-category>${window.Icon('plus',14)}<span data-i18n="UINewPlaylist">${I18n.h("UINewPlaylist")}</span></button>` : ''}`;
    sidebar.classList.toggle('hidden', state.settings.categoryLayout !== 'side');
    document.querySelector('.content')?.classList.toggle('categories-side', state.settings.categoryLayout === 'side');
    const hiddenBox = $('#hiddenCategories');
    hiddenBox.classList.toggle('hidden', !state.categoryEditMode || !hiddenCats.length);
    hiddenBox.innerHTML = state.categoryEditMode && hiddenCats.length
      ? `<span class="hidden-label" data-i18n="UIHidden2">${I18n.h("UIHidden2")}</span>${hiddenCats.map((c) => `<button class="hidden-category" draggable="true" data-restore-category="${esc(c.key)}" style="${categoryCssVars(c)}">${categoryIconMarkup(c.icon || 'eyeOff',13)}<span>${esc(c.label)}</span></button>`).join('')}`
      : '';
    rails.forEach((node, i) => { node.scrollLeft = positions[i][0]; node.scrollTop = positions[i][1]; });
    playlistSelection?.sync(allCats.map(c=>c.key));
  }

  function filterAndSort() {
    state.filtered = Library.view(isProtected()?state.privateTracks:state.tracks, state.settings, state.category, state.settings.sort, state.query);
  }

  function applyOrganizationSettings(settings) {
    Object.assign(state.settings, settings || {});
    const favorites = new Set((state.settings.favorites || []).map(Library.token));
    for (const track of state.tracks) track.favorite = favorites.has(Library.token(track.rel));
    state.categorySignature = ''; state.librarySignature = '';
    renderLibrary(); updatePlayerUI();
  }

  async function persistTrackOrder(category, sort, order, selectedSort = null) {
    state.settings.trackOrders ||= {};
    state.settings.trackOrders[category] ||= {};
    if (order === null) delete state.settings.trackOrders[category][sort];
    else state.settings.trackOrders[category][sort] = [...order];
    if(isProtected(category)){try{await runVaultCommand({type:'order',key:category,order});if(selectedSort)await api.settings.set({sort:selectedSort});}catch(e){toast('bad',I18n.t("UIOrderNotSaved"),I18n.errorMessage(e)||String(e));}return;}
    try { await api.settings.set({ trackOrders: { [category]: { [sort]: order } }, ...(selectedSort ? { sort:selectedSort } : {}) }); }
    catch (error) { toast('bad', I18n.t("UIOrderHasNotBeenWrittenToDiskYet"), I18n.errorMessage(error) || String(error), 7000); }
  }

  async function commitTrackMove(beforeIds, afterIds) {
    const context = reorderContext;
    reorderContext = null;
    if (!context || context.category !== state.category || context.sort !== state.settings.sort) { renderLibraryBody(); return; }
    const afterRels = afterIds.map(id => findTrack(id)?.rel).filter(Boolean);
    const after = Library.mergeVisibleOrder(context.fullOrder, afterRels);
    const entry = { category: context.category, sort:'manual', beforeSort:context.sort, afterSort:'manual', label:context.label,
      before:context.savedOrder, after };
    if (!orderHistory.push(entry)) return;
    state.settings.sort = 'manual';
    const save = persistTrackOrder(entry.category, 'manual', after, 'manual');
    state.librarySignature = ''; renderLibraryBody(); updateSortControl();
    const status = $('#reorderStatus'); if (status) I18n.setText(status,()=>(I18n.t("UIOrderChangedCtrlZToUndoCtrlShift")));
    toast('info', I18n.t("UIOrderSaved"), I18n.t("UICtrlZToUndo", {value1:(entry.label)}), 2000, 'track-order');
    await save;
  }

  async function undoTrackMove(redo = false) {
    trackSelection?.end(null,false); trackSelection?.clear();
    trackReorder?.cancel();
    const entry = orderHistory.take(redo);
    if (!entry) { toast('info', redo ? I18n.t("UINothingToRedo") : I18n.t("UINothingToUndo"), '', 1300, 'track-order'); return; }
    if (!categoryData(true).some(c => c.key === entry.category)) { orderHistory.discard(entry.category); return; }
    const selectedSort = state.category === entry.category ? (redo ? entry.afterSort : entry.beforeSort) || 'manual' : null;
    if (selectedSort) state.settings.sort = selectedSort;
    const save = persistTrackOrder(entry.category, 'manual', entry.order, selectedSort);
    if (state.category === entry.category) { state.librarySignature = ''; renderLibraryBody(); }
    updateSortControl();
    toast('info', redo ? I18n.t("UIMoveRedone") : I18n.t("UIMoveUndone"), `${entry.label} · ${sortLabels()[entry.sort]}`, 2000, 'track-order');
    await save;
  }

  function bindPlaylistScrolling() {
    for (const rail of [$('#categoryChips'), $('#categorySidebar'), $('#hiddenCategories')]) {
      rail.addEventListener('wheel', event => {
        if (event.ctrlKey || event.defaultPrevented) return;
        const horizontal = rail.id !== 'categorySidebar' || getComputedStyle(rail).display === 'flex';
        const extent = horizontal ? rail.scrollWidth - rail.clientWidth : rail.scrollHeight - rail.clientHeight;
        if (extent <= 1) return;
        const amount = horizontal ? (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) : event.deltaY;
        const unit = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? (horizontal ? rail.clientWidth : rail.clientHeight) : 1;
        if (!amount) return;
        event.preventDefault(); event.stopPropagation();
        // Direct scrollLeft/Top preserves high-resolution trackpad deltas and
        // avoids restarting smooth-scroll animations on every wheel tick.
        if (horizontal) rail.scrollLeft += amount * unit;
        else rail.scrollTop += amount * unit;
      }, { passive:false });
    }
  }

  function syncTrackSelection() {
    trackSelection?.sync(`${state.category}${state.query}`);
  }

  function bindTrackSelection() {
    trackSelection = new window.PulseTrackSelection({
      container:$('#library'),scroller:$('.content'),
      onTakeGesture:()=>trackReorder?.cancel(), onStart:hideContextMenu,
      onFinish:finishReordering,
      onChange:ids=>{
        const status=$('#trackSelectionStatus');
        status.classList.toggle('hidden',!ids.length);
        I18n.setText($('#trackSelectionCount'),()=>(I18n.t("UISelected", {value1:(ids.length)})));
        if (!ids.length && $('#contextMenu').dataset.menuKind==='tracks') hideContextMenu();
      },
      onMenu:openBulkContextMenu,
    });
    $('#trackSelectionClear').addEventListener('click',()=>{trackSelection.clear();hideContextMenu();});
    $('#trackSelectionActions').addEventListener('click',e=>{
      const r=e.currentTarget.getBoundingClientRect();openBulkContextMenu([...trackSelection.selected],r.left,r.top);
    });
  }

  function bindTrackReordering() {
    trackReorder = new window.PulseTrackReorder({
      container: $('#library'), scroller: $('.content'), isGrid: () => state.settings.view !== 'list',
      onStart: (drag) => {
        startTrackDrop(drag);
        hideContextMenu();
        reorderContext = { category: state.category, sort: state.settings.sort, label: categoryByKey(state.category)?.label || I18n.t("UIPlaylist"),
          fullOrder: Library.view(isProtected()?state.privateTracks:state.tracks, state.settings, state.category, state.settings.sort).map(t => t.rel),
          savedOrder: state.settings.trackOrders?.[state.category]?.manual?.slice() ?? null };
      },
      onCommit: commitTrackMove, onHover:hoverTrackDrop, onDrop:dropTrackOnPlaylist, constrainGhost:constrainTrackGhost,
      onFinish: finishTrackDrop,
    });
  }

  function updateMeta() {
    const tracks=(state.settings.libraryFolders?.length&&!state.folderOverview)?state.tracks.filter(t=>Library.Folders.ofTrack(t,state.settings)===(state.folderId||'')):state.tracks;
    const duration = tracks.reduce((sum,t) => sum + (Number(t.duration) || 0), 0);
    const suffix = duration ? ` · ${formatTotal(duration)}` : '';
    I18n.setText($('#libraryMeta'),()=>(`${tracks.length} ${decl(tracks.length, I18n.t("AppTrack"), I18n.t("UITracks"), I18n.t("UITracks2"))}${suffix}`));
  }

  function coverFallbackMarkup(cls = 'cover-fallback') {
    return `<span class="${cls}" aria-hidden="true"><img class="app-cover-fallback" src="${esc(state.appIconUrl)}" alt="" draggable="false" decoding="async"></span>`;
  }

  function coverMarkup(track, cls = 'card-cover') {
    const cover = safeUrl(track.coverUrl);
    return `<div class="cover ${cls} ${cover ? '' : 'placeholder'}">${coverFallbackMarkup()}${cover ? window.PulseCoverMedia.markup(cover,track.coverType,'cover-img',track.rel,animationEnabled(track)) : ''}</div>`;
  }

  function renderGrid() {
    return state.filtered.map((t) => {
      const active = t.id === state.currentId;
      return `<article class="track-card ${active ? 'active' : ''} ${active && !audio.paused ? 'playing' : ''}" data-track-root data-id="${esc(t.id)}" role="button" tabindex="0" aria-label="${I18n.h("UIPlay", {value1:(Library.trackTitle(t)),value2:(Library.trackArtist(t))})}" data-i18n-aria-label="UIPlay" data-i18n-aria-label-args="${I18n.attrArgs({value1:(Library.trackTitle(t)),value2:(Library.trackArtist(t))})}">
        ${coverMarkup(t, 'card-cover')}
        <div class="track-copy">
          <span class="track-title" title="${esc(Library.trackTitle(t))}">${esc(Library.trackTitle(t))}</span>
          <span class="track-artist" title="${esc(Library.trackArtist(t))}">${esc(Library.trackArtist(t))}</span>
          <span class="track-meta"><span>${esc(t.ext || 'AUDIO')}</span>${t.album ? `<i class="dot"></i><span title="${esc(t.album)}">${esc(t.album)}</span>` : ''}</span>
        </div>
        <div class="track-actions">
          <span class="track-duration" data-duration-for="${esc(t.id)}">${t.duration ? formatTime(t.duration) : '--:--'}</span>
          <button class="icon-button subtle favorite-button ${t.favorite ? 'active' : ''}" data-action="favorite" data-id="${esc(t.id)}" title="${t.favorite ? I18n.h("UIRemoveFromFavourites") : I18n.h("UIAddToFavourites")}">${window.Icon(t.favorite ? 'heartFill' : 'heart',16)}</button>
          <button class="icon-button subtle" data-action="menu" data-id="${esc(t.id)}" title="${I18n.h("UIMore")}" data-i18n-title="UIMore">${window.Icon('more',18)}</button>
        </div>
      </article>`;
    }).join('');
  }

  function renderList() {
    const rows = state.filtered.map((t, i) => {
      const active = t.id === state.currentId;
      return `<div class="list-row ${active ? 'active' : ''} ${active && !audio.paused ? 'playing' : ''}" data-track-root data-id="${esc(t.id)}" role="button" tabindex="0" aria-label="${I18n.h("UIPlay", {value1:(Library.trackTitle(t)),value2:(Library.trackArtist(t))})}" data-i18n-aria-label="UIPlay" data-i18n-aria-label-args="${I18n.attrArgs({value1:(Library.trackTitle(t)),value2:(Library.trackArtist(t))})}">
        <div class="list-index"><span class="list-index-number">${i + 1}</span><button class="list-play" data-action="play" data-id="${esc(t.id)}" title="${I18n.h("UIPlay2")}" data-i18n-title="UIPlay2">${window.Icon(active && !audio.paused ? 'pause' : 'play',14)}</button></div>
        <div class="list-title-cell">${coverMarkup(t,'list-cover')}<div class="list-title-copy"><span class="track-title">${esc(Library.trackTitle(t))}</span><span class="track-artist">${esc(Library.trackArtist(t))}</span></div></div>
        <div class="list-secondary" title="${esc(t.album || Library.trackArtist(t))}">${esc(t.album || Library.trackArtist(t))}</div>
        <div class="list-date">${formatDate(t.addedAt)}</div>
        <div class="track-duration" data-duration-for="${esc(t.id)}">${t.duration ? formatTime(t.duration) : '--:--'}</div>
        <div class="list-actions"><button class="icon-button subtle" data-action="menu" data-id="${esc(t.id)}" title="${I18n.h("UIMore")}" data-i18n-title="UIMore">${window.Icon('more',18)}</button></div>
      </div>`;
    }).join('');
    return `<div class="list-head"><span>#</span><span data-i18n="UITitle">${I18n.h("UITitle")}</span><span data-i18n="UIAlbumArtist">${I18n.h("UIAlbumArtist")}</span><span data-i18n="UIAdded">${I18n.h("UIAdded")}</span><span>${window.Icon('clock',14)}</span><span></span></div>${rows}`;
  }

  function updateViewButtons() {
    const view = state.settings.view === 'list' ? 'list' : 'grid';
    $('#gridViewBtn').classList.toggle('active', view === 'grid');
    $('#listViewBtn').classList.toggle('active', view === 'list');
  }

  function renderLibraryBody() {
    if (isReordering()) { deferredLibraryRender = true; return; }
    updateSortControl();
    refreshVaultBanner();
    if(isProtected()&&!state.vaultUnlocked){renderVaultLocked();return;}
    if (state.loading) { state.librarySignature = 'loading'; renderSkeleton(); return; }
    filterAndSort();
    if (!state.filtered.length) trackSelection?.clear();
    updateMeta();
    const empty = (isProtected()?state.privateTracks:state.tracks).length === 0;
    $('#emptyState').classList.toggle('hidden', !empty);
    $('#dropHint').classList.toggle('hidden', empty || state.tracks.length > 8);
    const lib = $('#library');
    const view = state.settings.view === 'list' ? 'list' : 'grid';
    lib.className = `library ${view}-view`;
    updateViewButtons();
    const signature = empty ? `${state.category}|${view}|empty` : !state.filtered.length ? `${view}|none|${state.query}|${state.category}` : `${state.category}|${view}|${state.filtered.map((t) => [t.id,t.title,t.artist,t.album,t.ext,t.coverUrl,t.coverType,Math.round(Number(t.addedAt)||0)].join('\u001f')).join('\u001e')}`;
    if (signature === state.librarySignature) {
      patchTrackVisuals();
      for (const track of state.filtered) { patchFavorite(track); patchDuration(track); }
      syncTrackSelection();
      return;
    }
    state.librarySignature = signature;
    if (empty) { lib.replaceChildren(); syncTrackSelection(); return; }
    if (!state.filtered.length) {
      if(state.settings.libraryFolders?.length&&!state.folderOverview&&!state.query.trim()&&!state.tracks.some(t=>Library.Folders.ofTrack(t,state.settings)===(state.folderId||''))){
        lib.innerHTML=`<div class="no-results"><div class="no-results-icon">${window.Icon('folder',26)}</div><strong>${I18n.h('FolderEmpty',{name:libraryFolderLabel(state.folderId)})}</strong><span>${I18n.h('FolderEmptyHelp')}</span><button class="button secondary" data-folder-return>${window.Icon('folder',16)}<span>${I18n.h('FolderAll')}</span></button></div>`;
        lib.querySelector('[data-folder-return]').addEventListener('click',()=>{state.folderOverview=true;state.categorySignature='';renderLibrary();});
        return;
      }
      const query = state.query.trim();
      lib.innerHTML = `<div class="no-results"><div class="no-results-icon">${window.Icon('search',26)}</div><strong data-i18n="UINoResults">${I18n.h("UINoResults")}</strong><span>${query ? I18n.h("UIIsNotInYourLocalLibrary", {value1:(query)}) : I18n.h("UITryAnotherPlaylist")}</span>${query ? `<div class="online-fallback"><button class="button secondary" data-search-online="all">${window.Icon('search',15)}<span data-i18n="SearchFindOptions">${I18n.h("SearchFindOptions")}</span></button></div>` : ''}</div>`;
      return;
    }
    lib.innerHTML = view === 'grid' ? renderGrid() : renderList();
    syncTrackSelection();
  }

  let loudnessEpoch=0,loudnessSignature='',loudnessRequest='';
  async function ensureLoudness(){
    const active=['loudnessAsc','loudnessDesc'].includes(state.settings.sort);
    if(!active){if(loudnessRequest){loudnessEpoch++;loudnessRequest='';api.library.command?.({type:'loudness-cancel'}).catch(()=>{});}$('#loudnessStatus')?.remove();loudnessSignature='';return;}
    if(state.loading||!api.library.command)return;
    const tracks=(isProtected()?state.privateTracks:state.tracks).filter(Library.membershipPredicate(state.settings,state.category));
    const signature=JSON.stringify([state.category,tracks.map(t=>[t.rel,t.size,t.modifiedAt,t.changedAt])]);
    if(signature===loudnessSignature)return;loudnessSignature=signature;
    const missing=tracks.filter(t=>typeof t.loudnessIntro!=='number'||!Number.isFinite(t.loudnessIntro));if(!missing.length){if(loudnessRequest){loudnessEpoch++;loudnessRequest='';api.library.command({type:'loudness-cancel'}).catch(()=>{});}$('#loudnessStatus')?.remove();return;}
    const epoch=++loudnessEpoch;const requestId='loudness-'+epoch;loudnessRequest=requestId;
    let status=$('#loudnessStatus');if(!status){status=document.createElement('span');status.id='loudnessStatus';status.className='loudness-status';status.setAttribute('role','status');$('#sortTrigger').parentElement.append(status);}
    I18n.setText(status,()=>I18n.t('LoudnessAnalyzing',{done:0,total:missing.length}));
    try{const result=await api.library.command({type:'loudness',rels:missing.map(t=>t.rel),requestId});if(epoch!==loudnessEpoch||result.cancelled)return;
      const byRel=new Map((result.results||[]).map(r=>[r.rel,r]));for(const t of allKnownTracks()){const r=byRel.get(t.rel);if(r)t.loudnessIntro=r.value;}
      state.librarySignature='';renderLibraryBody();
      const failed=(result.results||[]).filter(r=>r.value===null);I18n.setText(status,()=>failed.length?I18n.t('LoudnessIncomplete',{count:failed.length}):I18n.t('LoudnessReady'));
      if(failed.length)status.title=failed[0].error||'';
    }catch(error){if(epoch===loudnessEpoch){I18n.setText(status,()=>I18n.errorMessage(error));status.classList.add('failed');}}
    finally{if(epoch===loudnessEpoch)loudnessRequest='';}
  }
  function renderLibrary({ categories = true } = {}) {
    updateSortControl();
    if (categories) renderCategories();
    renderLibraryBody();
    ensureLoudness();
  }

  function patchTrackVisuals(ids = null) {
    const allowed = ids ? new Set(ids.filter(Boolean)) : null;
    $$('[data-track-root]').forEach((row) => {
      const id = row.dataset.id;
      if (allowed && !allowed.has(id)) return;
      const active = id === state.currentId;
      const playing = active && !audio.paused;
      row.classList.toggle('active', active);
      row.classList.toggle('playing', playing);
      const play = row.querySelector('[data-action="play"]');
      if (play) {
        play.innerHTML = window.Icon(playing ? 'pause' : 'play',14);
        I18n.setAttribute(play,"title",()=>(playing ? I18n.t("PlayerOverlayPause") : I18n.t("UIPlay2")));
      }
    });
  }

  function patchFavorite(track) {
    if (!track) return;
    $$(`[data-action="favorite"][data-id="${CSS.escape(track.id)}"]`).forEach((button) => {
      button.classList.toggle('active', !!track.favorite);
      button.innerHTML = window.Icon(track.favorite ? 'heartFill' : 'heart',16);
      I18n.setAttribute(button,"title",()=>(track.favorite ? I18n.t("UIRemoveFromFavourites") : I18n.t("UIAddToFavourites")));
    });
  }

  function patchDuration(track) {
    if (!track) return;
    $$(`[data-duration-for="${CSS.escape(track.id)}"]`).forEach((node) => { node.textContent = track.duration ? formatTime(track.duration) : '--:--'; });
  }

  async function loadLibrary({ quiet = false } = {}) {
    const epoch = ++libraryLoadEpoch;
    if (!quiet && !isReordering()) { state.loading = true; renderLibrary(); }
    try {
      const tracks = await api.library.list();
      if (epoch !== libraryLoadEpoch) return;
      const snapshot = Array.isArray(tracks) ? tracks : [];
      if (isReordering()) { pendingLibrarySnapshot = snapshot; return; }
      pendingLibrarySnapshot = null;
      state.tracks = snapshot;
      state.loading = false;
      renderLibrary(); updatePlayerUI(); probeDurations();
    } catch (error) {
      if (epoch !== libraryLoadEpoch) return;
      state.loading = false;
      renderLibrary();
      toast('bad', I18n.t("UICouldNotReadTheLibrary"), I18n.errorMessage(error) || String(error));
    }
  }

  async function addFiles() {
    if(trackTools&&api.library.command)return trackTools.chooseFiles();
    try {
      const result = await api.library.addFiles();
      if (result?.added) {
        toast('good', I18n.t("UIMusicAdded"), `${result.added} ${decl(result.added,I18n.t("UIFile"),I18n.t("UIFiles"),I18n.t("UIFiles2"))}`);
        await loadLibrary({ quiet:true });
      }
    } catch (error) { toast('bad',I18n.t("UICouldNotAddFiles"), I18n.errorMessage(error) || String(error)); }
  }

  function findTrack(id) { return allKnownTracks().find((t) => t.id === id); }
  function animationEnabled(track){return track?.animateCover!==false && state.settings.coverAnimation?.[Library.token(track?.rel)]!==false;}
  async function toggleAnimation(id,button){
    const track=findTrack(id);if(!track||button.getAttribute('aria-busy')==='true')return;
    const enabled=!animationEnabled(track);button.setAttribute('aria-busy','true');
    try{
      const result=await api.library.command({type:'cover-animation',rel:track.rel,enabled});
      if(!result.ok)return;
      track.animateCover=enabled;
      if(!track.vaultKey){state.settings.coverAnimation||={};state.settings.coverAnimation[Library.token(track.rel)]=enabled;}
      window.PulseCoverMedia.preference(track.rel,enabled);
      button.setAttribute('aria-checked',String(enabled));button.querySelector('.cover-animation-mark').innerHTML=window.Icon(enabled?'check':'close',14);
      // Neither menu, track cards nor the player cover is replaced here.
      syncOverlayState(true);
    }catch(error){toast('bad',I18n.t('CoverAnimate'),I18n.errorMessage(error));}
    finally{button.removeAttribute('aria-busy');}
  }
  function currentTrack() { return findTrack(state.currentId); }

  async function selectTrack(id, autoplay = true, toggleIfCurrent = false) {
    const track = findTrack(id);
    if (!track) return;
    const playbackToken = autoplay ? claimPlayback('local') : null;
    if (state.onlinePreview) stopOnlinePreview();
    if (state.currentId === id) {
      if (!autoplay) return;
      if (toggleIfCurrent && !audio.paused) {
        audio.pause();
        releasePlayback('local');
      }
      else if (audio.paused) {
        try { await playClaimed('local', playbackToken, audio); } catch (error) { toast('bad',I18n.t("UICouldNotPlay"), I18n.errorMessage(error) || String(error)); }
      }
      return;
    }
    if (api.library.playback) {
      const resolved = await api.library.playback(track.rel);
      if (autoplay && playbackToken !== state.playbackEpoch) return;
      if (resolved) Object.assign(track, resolved);
    }
    const previousId = state.currentId;
    state.currentId = id;
    if(track.vaultKey)audio.crossOrigin='anonymous';else audio.removeAttribute('crossorigin');
    audio.src = track.audioUrl;
    audio.load();
    updatePlayerUI();
    patchTrackVisuals([previousId, id]);
    state.settings.lastTrack = track.vaultKey?'':track.rel;
    if(track.vaultKey)state.privateNowPlaying=track;
    api.settings.set({ lastTrack: state.settings.lastTrack }).catch(() => {});
    updateMediaSession();
    if (autoplay) {
      try { await playClaimed('local', playbackToken, audio); } catch (error) { toast('bad',I18n.t("UICouldNotPlay"), I18n.errorMessage(error) || String(error)); }
    }
  }

  async function togglePlay() {
    if (!$('#trimModal').classList.contains('hidden')) return;
    if (!state.currentId) {
      const first = state.filtered[0] || state.tracks[0];
      if (first) await selectTrack(first.id, true);
      return;
    }
    if (audio.paused) {
      const token = claimPlayback('local');
      if (state.onlinePreview) stopOnlinePreview();
      try { await playClaimed('local', token, audio); } catch (e) { toast('bad',I18n.t("UICouldNotPlay"), I18n.errorMessage(e) || String(e)); }
    } else {
      audio.pause();
      releasePlayback('local');
    }
  }

  function queueIds() {
    const source = state.filtered.length ? state.filtered : state.tracks;
    return source.map((t) => t.id);
  }

  async function nextTrack(fromEnded = false) {
    const ids = queueIds();
    if (!ids.length) { releasePlayback('local'); return; }
    if (state.repeat === 'one' && fromEnded && state.currentId) {
      audio.currentTime = 0;
      const token = claimPlayback('local');
      try { await playClaimed('local', token, audio); } catch (error) { toast('bad',I18n.t("UICouldNotPlay"), I18n.errorMessage(error) || String(error)); }
      return;
    }
    let next;
    if (state.shuffle && ids.length > 1) {
      const pool = ids.filter((id) => id !== state.currentId);
      next = pool[Math.floor(Math.random() * pool.length)];
    } else {
      const idx = Math.max(0, ids.indexOf(state.currentId));
      if (idx === ids.length - 1 && state.repeat === 'off' && fromEnded) { audio.pause(); releasePlayback('local'); return; }
      next = ids[(idx + 1) % ids.length];
    }
    await selectTrack(next, true);
    if (fromEnded) { await syncOverlayState(true); await api.overlay.notify('auto').catch(() => {}); }
  }

  async function prevTrack() {
    if (audio.currentTime > 4) { audio.currentTime = 0; return; }
    const ids = queueIds();
    if (!ids.length) return;
    const idx = Math.max(0, ids.indexOf(state.currentId));
    await selectTrack(ids[(idx - 1 + ids.length) % ids.length], true);
  }

  function updatePlayerCover(track) {
    const pc = $('#playerCover');
    const url = track?.coverUrl ? safeUrl(track.coverUrl) : '';
    if (pc.dataset.coverUrl === url && pc.querySelector('.app-cover-fallback')) {const v=pc.querySelector('video');if(v){v.dataset.coverTrack=track?.rel||'';v.dataset.coverEnabled=String(animationEnabled(track));window.PulseCoverMedia.sync(v);}return;}
    pc.dataset.coverUrl = url;
    pc.classList.toggle('placeholder', !url);
    pc.innerHTML = `${coverFallbackMarkup()}${url ? window.PulseCoverMedia.markup(url,track.coverType,'cover-img',track.rel,animationEnabled(track)) : ''}`;
  }

  function updatePlayerUI() {
    lyricsView?.trackChanged(currentTrack());
    const t = currentTrack();
    $('#player').classList.toggle('disabled', !t);
    I18n.setText($('#playerTitle'),()=>(t?.title || I18n.t("UISelectATrack")));
    I18n.setText($('#playerArtist'),()=>t ? Library.trackArtist(t) : I18n.t('AppName'));
    updatePlayerCover(t);
    $('#playerFavorite').disabled = !t;
    $('#playerFavorite').innerHTML = window.Icon(t?.favorite ? 'heartFill' : 'heart', 17);
    $('#playerFavorite').classList.toggle('active', !!t?.favorite);
    $('#playBtn').innerHTML = window.Icon(t && !audio.paused ? 'pause' : 'play', 17);
    $('#shuffleBtn').classList.toggle('active', state.shuffle);
    $('#repeatBtn').classList.toggle('active', state.repeat !== 'off');
    I18n.setAttribute($('#repeatBtn'),"title",()=>(state.repeat === 'one' ? I18n.t("UIRepeatOneTrack") : state.repeat === 'all' ? I18n.t("UIRepeatQueue") : I18n.t("UIRepeatOff")));
    if (state.repeat === 'one') $('#repeatBtn').dataset.badge = '1'; else delete $('#repeatBtn').dataset.badge;
    if (t?.duration && !audio.duration) $('#totalTime').textContent = formatTime(t.duration);
    applyLibraryBackground();
    syncOverlayState();
  }

  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const t = currentTrack();
    if (!t) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title:Library.trackTitle(t), artist:Library.trackArtist(t), album:t.album || I18n.t('AppName') });
      navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
    } catch {}
  }

  async function toggleFavorite(track) {
    if (!track) return;
    const favoriteKey=Library.Folders.scoped(Library.Folders.ofTrack(track,state.settings),'favorite');
    if(track.vaultKey||isProtected(favoriteKey)){try{if(track.favorite)await removeChosenTracks([track],favoriteKey);else await addChosenTracks([track],favoriteKey);}catch(e){toast('bad',I18n.t("UICouldNotUpdateFavourites"),I18n.errorMessage(e)||String(e));}return;}
    try {
      const result = await api.library.favorite(track.rel);
      track.favorite = !!result.favorite;
      if (result.favorites) state.settings.favorites = result.favorites;
      patchFavorite(track);
      if (Library.Folders.split(state.category).base === 'favorite' && !track.favorite) renderLibraryBody();
      updatePlayerUI();
      toast('info', result.favorite ? I18n.t("UIAddedToFavourites") : I18n.t("UIRemovedFromFavourites"), track.title, 1800);
    } catch (e) { toast('bad',I18n.t("UICouldNotUpdateFavourites"),I18n.errorMessage(e)||String(e)); }
  }


  async function resolveAppearanceRef(ref, icon = false) {
    const key = `${icon ? 'icon:' : 'asset:'}${ref || ''}`;
    if (state.appearanceUrls.has(key)) return state.appearanceUrls.get(key);
    let url = '';
    try { url = icon ? await api.appearance.iconUrl(ref) : await api.appearance.resolve(ref); } catch {}
    state.appearanceUrls.set(key, url || '');
    return url || '';
  }

  async function applyAppIconPreview() {
    const epoch = ++appIconEpoch;
    const ref = state.settings.appIcon || 'builtin:blue-violet';
    const url = safeUrl(await resolveAppearanceRef(ref, true)) || defaultAppIconUrl;
    if (epoch !== appIconEpoch) return;
    state.appIconUrl = url;
    for (const img of $$('.brand-icon, .settings-about-icon, .about-app-icon, .app-cover-fallback')) {
      if (img.getAttribute('src') !== url) img.src = url;
    }
    updatePlayerCover(currentTrack());
    syncOverlayState(true);
  }

  async function loadAppInfo() {
    try {
      const info = await api.system.appInfo();
      $('#appVersion').textContent = info.version || '';
      $('#aboutVersion').textContent = info.version || '';
      I18n.setAttribute($('#settingsAbout'),"title",()=>(I18n.t('AboutTitle')));
      I18n.setAttribute($('#settingsAbout'),'aria-label',()=>$('#settingsAbout').title);
    } catch (error) { console.warn(I18n.t("UICouldNotGetThePulseDeckVersion"), error); }
  }

  async function applyLibraryBackground() {
    const epoch = ++state.backgroundRenderEpoch;
    const root = document.documentElement;
    const mode = state.settings.backgroundMode || 'off';
    root.dataset.backgroundMode = mode;
    let url = '';
    if (mode === 'track') url = safeUrl(currentTrack()?.coverUrl || '');
    if (mode === 'custom' && state.settings.customBackground) url = await resolveAppearanceRef(state.settings.customBackground);
    if (epoch !== state.backgroundRenderEpoch) return;
    const video=mode==='track'&&window.PulseCoverMedia.isVideo(url,currentTrack()?.coverType);
    let backdrop=$('#libraryVideoBackground');
    if(video&&url){if(!backdrop||backdrop.getAttribute('src')!==url){backdrop?.remove();backdrop=window.PulseCoverMedia.element(url,currentTrack()?.coverType,'library-video-background',currentTrack()?.rel,animationEnabled(currentTrack()));backdrop.id='libraryVideoBackground';$('.content').prepend(backdrop);}}
    else backdrop?.remove();
    root.style.setProperty('--library-bg-image', !video&&url ? `url("${url.replace(/["\\]/g, '\\$&')}")` : 'none');
    root.classList.toggle('has-library-background', !!url && mode !== 'off');
  }

  async function renderBackgroundHistory() {
    const box = $('#backgroundHistory');
    if (!box) return;
    const refs = (state.settings.backgroundHistory || []).slice(0,5);
    if (!refs.length) {
      box.innerHTML = `<span class="background-empty" data-i18n="UIRecentlyUploadedBackgroundsWillAppearHere">${I18n.h("UIRecentlyUploadedBackgroundsWillAppearHere")}</span>`;
      return;
    }
    const entries = await Promise.all(refs.map(async (ref) => ({ ref, url:await resolveAppearanceRef(ref) })));
    const valid = entries.filter((x) => x.url);
    box.innerHTML = valid.map(({ref,url}) => `<button class="background-thumb ${state.settings.customBackground === ref ? 'active' : ''}" data-background-ref="${esc(ref)}" title="${I18n.h("UISelectThisBackground")}" data-i18n-title="UISelectThisBackground"><img src="${esc(url)}" alt=""><span data-remove-background="${esc(ref)}" title="${I18n.h("UIRemoveFromHistory")}" data-i18n-title="UIRemoveFromHistory">${window.Icon('close',11)}</span></button>`).join('');
    if (!valid.length) box.innerHTML = `<span class="background-empty" data-i18n="UISavedBackgroundsCouldNoLongerBeFound">${I18n.h("UISavedBackgroundsCouldNoLongerBeFound")}</span>`;
  }

  async function chooseBackground() {
    const picked = await api.appearance.chooseBackground();
    if (!picked?.ref) return;
    state.appearanceUrls.set(`asset:${picked.ref}`, picked.url || '');
    const history = [picked.ref, ...(state.settings.backgroundHistory || []).filter((x) => x !== picked.ref)].slice(0,5);
    state.settings.backgroundHistory = history;
    state.settings.customBackground = picked.ref;
    state.settings.backgroundMode = 'custom';
    applyAppearance();
    await api.settings.set({ backgroundHistory:history, customBackground:picked.ref, backgroundMode:'custom' });
    await renderBackgroundHistory();
  }

  function categoryPatch(key, patch) {
    const custom = customCategoryByKey(key);
    if (custom) {
      Object.assign(custom, patch);
      return;
    }
    state.settings.categoryStyles ||= {};
    state.settings.categoryStyles[key] = { ...(state.settings.categoryStyles[key] || {}), ...patch };
  }

  async function restoreCategory(key) {
    categoryPatch(key, { hidden:false });
    const order = [key, ...(state.settings.categoryOrder || []).filter((x) => x !== key)];
    state.settings.categoryOrder = order;
    state.categorySignature = '';
    renderCategories(true);
    await persistCategorySettings();
  }

  async function hideCategory(key) {
    if(isProtected(key)){await performPlaylistBatch([key],'hide');return;}
    categoryPatch(key, { hidden:true });
    if (state.category === key) state.category = Library.Folders.scoped(state.folderId||'','all');
    state.categoryEditMode = true;
    state.categorySignature = '';
    renderLibrary();
    await persistCategorySettings();
  }

  async function deleteCategory(key) {
    if(isProtected(key)){askPlaylistBatch([key],'delete');return;}
    const cat = categoryByKey(key);
    if (!cat || !cat.canDelete) return;
    orderHistory.discard(key);
    if (cat.kind === 'custom') state.settings.customCategories = (state.settings.customCategories || []).filter((c) => c.id !== key);
    else categoryPatch(key, { deleted:true });
    state.settings.categoryOrder = (state.settings.categoryOrder || []).filter((x) => x !== key);
    if (state.category === key) state.category = Library.Folders.scoped(state.folderId||'','all');
    state.categorySignature = ''; state.librarySignature = '';
    renderLibrary();
    await persistCategorySettings();
  }

  function normalizedCategoryOrder() {
    const keys = categoryData(true).map((c) => c.key);
    return [...(state.settings.categoryOrder || []), ...keys.filter((k) => !(state.settings.categoryOrder || []).includes(k))];
  }

  async function moveCategory(key, beforeKey = '') {
    const order = normalizedCategoryOrder().filter((x) => x !== key);
    const at = beforeKey ? order.indexOf(beforeKey) : -1;
    if (at >= 0) order.splice(at,0,key); else order.push(key);
    state.settings.categoryOrder = order;
    state.categorySignature = '';
    renderCategories(true);
    await persistCategorySettings();
  }

  function playlistSubmenu(command, label, icon, entries) {
    return `<div class="context-submenu-wrap"><button class="context-item" data-submenu-trigger="${command}" aria-haspopup="menu" aria-expanded="false">${window.Icon(icon,15)}<span>${esc(label)}</span><span class="context-arrow">${window.Icon('chevronRight',13)}</span></button><div class="context-submenu" role="menu">${entries}</div></div>`;
  }

  function mergeChoices(first, second) {
    return [[first, second], [second, first]].map(([remove, keep], index) => {
      const count=state.tracks.filter(Library.membershipPredicate(state.settings,remove.key)).length;
      return `<label class="merge-choice"><input type="radio" name="mergeSource" value="${esc(remove.key)}"><span class="merge-choice-icon">${categoryIconMarkup(remove.icon,22)}</span><span><strong data-i18n="UIKeep" data-i18n-args="${I18n.attrArgs({value1:(keep.label)})}">${I18n.h("UIKeep", {value1:(keep.label)})}</strong><small data-i18n="UIFrom" data-i18n-args="${I18n.attrArgs({value1:(count),value2:(decl(count,I18n.t("AppTrack"),I18n.t("UITracks"),I18n.t("UITracks2"))),value3:(remove.label),value4:(keep.label),value5:(remove.system?I18n.msg("UISystemSectionWillBeHiddenItsAutomaticRules"):I18n.msg("UISourcePlaylistWillBeDeletedAudioFilesWill"))})}">${I18n.h("UIFrom", {value1:(count),value2:(decl(count,I18n.t("AppTrack"),I18n.t("UITracks"),I18n.t("UITracks2"))),value3:(remove.label),value4:(keep.label),value5:(remove.system?I18n.msg("UISystemSectionWillBeHiddenItsAutomaticRules"):I18n.msg("UISourcePlaylistWillBeDeletedAudioFilesWill"))})}</small></span></label>`;
    }).join('');
  }

  function openMergeDialog(firstKey, secondKey) {
    if(isProtected(firstKey)||isProtected(secondKey)){askPlaylistBatch([firstKey,secondKey],'merge');return;}
    const first = categoryByKey(firstKey), second = categoryByKey(secondKey);
    if (!first || !second || firstKey === secondKey) return;
    state.mergeDraft = { first: firstKey, second: secondKey };
    I18n.setText($('#mergePlaylistNames'),()=>(I18n.t("UIFirstSecond", {value1:(first.label),value2:(second.label)})));
    $('#mergeChoices').innerHTML = mergeChoices(first, second);
    // No destructive option is preselected: the destination must be chosen explicitly.
    $('#mergeConfirm').disabled = true;
    $('#mergeError').textContent = '';
    openModal('mergeModal');
  }

  async function confirmMerge() {
    const draft = state.mergeDraft, choice = $('#mergeChoices input:checked');
    if (!draft || !choice || $('#mergeConfirm').disabled) return;
    const source = choice.value, target = source === draft.first ? draft.second : draft.first;
    $('#mergeConfirm').disabled = true; $('#mergeCancel').disabled = true;
    try {
      const result = await api.library.organize({ type: 'merge', source, target });
      orderHistory.discard(source);
      state.category = target;
      state.mergeDraft = null;
      closeModal('mergeModal');
      applyOrganizationSettings(result.settings);
      toast('good', I18n.t("UIPlaylistsMerged"), I18n.t("UITransferredDuplicateTracksAreNotAddedTwice", {value1:(result.moved)}), 3600);
    } catch (error) { I18n.setText($('#mergeError'),()=>(I18n.errorMessage(error) || String(error))); $('#mergeConfirm').disabled = false; }
    finally { $('#mergeCancel').disabled = false; }
  }

  function askArtistAlias(sourceKey, targetKey) {
    if(isProtected(sourceKey)||isProtected(targetKey)){askPlaylistBatch([sourceKey,targetKey],'alias',targetKey);return;}
    const source = categoryByKey(sourceKey), target = categoryByKey(targetKey);
    if (!source || !target) return;
    openConfirmation({
      title: I18n.t("UITreatAs", {value1:(source.label),value2:(target.label)}),
      text: I18n.t("UIExistingTracksWillMoveToNewTracksBy", {value1:(target.label),value2:(source.sourceArtistNormalized)}),
      actionText: I18n.t("UISaveRule"), icon: 'link',
      onConfirm: async () => {
        const result = await api.library.organize({ type: 'alias', source: sourceKey, target: targetKey });
        orderHistory.discard(sourceKey);
        state.category = targetKey;
        closeModal('confirmModal');
        applyOrganizationSettings(result.settings);
        toast('good', I18n.t("UIArtistRuleSaved"), `${source.label} → ${target.label}`, 3500);
      },
    });
  }

  function openCategoryContextMenu(cat, x, y) {
    if (!cat) return;
    state.categoryContextKey = cat.key;
    state.categoryEditMode = true;
    state.categorySignature = '';
    renderCategories(true);
    const menu = $('#contextMenu');
    menu.dataset.menuKind = 'category';
    delete menu.dataset.trackId;
    const others = categoryData(true).filter(c => c.key !== cat.key);
    const mergeMenu = others.length ? playlistSubmenu('merge', I18n.t("UIMerge"), 'layers', others.map(c => `<button class="context-item" data-merge-target="${esc(c.key)}" >${categoryIconMarkup(c.icon,15)}<span>${esc(c.label)}</span>${c.hidden ? `<small data-i18n="UIHidden3">${I18n.h("UIHidden3")}</small>` : ''}</button>`).join('')) : '';
    const artists = others.filter(c => c.kind === 'artist');
    const aliasMenu = cat.kind === 'artist' && artists.length ? playlistSubmenu('alias', I18n.t("UITreatThisArtistAs"), 'link', artists.map(c => `<button class="context-item" data-alias-target="${esc(c.key)}">${categoryIconMarkup(c.icon,15)}<span>${esc(c.label)}</span></button>`).join('')) : '';
    menu.innerHTML = `
      <button class="context-item" data-category-command="move">${window.Icon('move',15)}<span data-i18n="UIMove">${I18n.h("UIMove")}</span></button>
      <button class="context-item" data-category-command="rename" ${cat.canRename ? '' : 'disabled'}>${window.Icon('edit',15)}<span data-i18n="UIRename">${I18n.h("UIRename")}</span></button>
      <button class="context-item" data-category-command="style">${window.Icon('palette',15)}<span data-i18n="UIChangeAppearance">${I18n.h("UIChangeAppearance")}</span></button>
      ${cat.protected&&others.some(c=>c.protected)?playlistSubmenu('access-link',I18n.h("UIMergeAccess"),'lock',others.filter(c=>c.protected).map(c=>`<button class="context-item" data-link-access="${esc(c.key)}">${categoryIconMarkup(c.icon,15)}<span>${esc(c.label)}</span></button>`).join('')):''}
      ${cat.protected?'<button class="context-item" data-category-command="restore-private">'+window.Icon('undo',15)+`<span data-i18n="UIRestoreRemovedTracks">${I18n.h("UIRestoreRemovedTracks")}</span></button>`:''}
      ${state.settings.libraryFolders?.length?playlistSubmenu('move-folder',I18n.t('FolderMovePlaylist'),'folder',[{id:'',name:I18n.t('FolderShared')},...state.settings.libraryFolders].filter(f=>f.id!==(cat.folderId||'')).map(f=>`<button class="context-item" data-folder-move-playlist="${esc(f.id)}">${window.Icon('folder',15)}<span>${esc(f.name)}</span></button>`).join('')):''}
      ${mergeMenu}${aliasMenu}${cat.kind === 'artist' && Library.artistGroups(state.settings,state.tracks).some(g=>g.key===cat.key) ? `<button class="context-item" data-category-command="split">${window.Icon('unlink',15)}<span data-i18n="UISeparateArtists">${I18n.h("UISeparateArtists")}</span></button>` : ''}
      <div class="context-sep"></div>
      <button class="context-item danger" data-category-command="delete" ${cat.canDelete ? '' : 'disabled'}>${window.Icon('trash',15)}<span data-i18n="UIDelete">${I18n.h("UIDelete")}</span></button>
      <button class="context-item" data-category-command="hide">${window.Icon('eyeOff',15)}<span data-i18n="UIHide">${I18n.h("UIHide")}</span></button>`;
    menuReorder?.prepare();
    menu.classList.remove('hidden');
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(innerWidth-r.width-8, x))}px`;
      menu.style.top = `${Math.max(58, Math.min(innerHeight-r.height-104, y))}px`;
      armTrackSubmenu(menu);
    });
    const members=cat.protected?state.privateTracks.filter(t=>t.vaultKey===cat.key):state.tracks.filter(Library.membershipPredicate(state.settings,cat.key));
    trackTools?.attachCategoryMenu(menu,cat,members);
  }

  function categoryDraftFrom(cat) {
    const baseColor = cat?.color && /^#[0-9a-f]{6}$/i.test(cat.color) ? cat.color : '#b038ae';
    return {
      name:cat?.label || I18n.t("UINewPlaylist"), icon:cat?.icon?.startsWith('pi:') ? `pi:${playlistIcons.resolve(cat.icon)}` : (cat?.icon || 'pi:star'), color:baseColor,
      canRename: cat ? cat.canRename !== false : true,
      glow:!!cat?.glow, glowIntensity:clamp(cat?.glowIntensity ?? 45,0,100),
      gradient:Array.isArray(cat?.gradient) && cat.gradient.length ? cat.gradient.slice(0,4) : [baseColor],
    };
  }

  function renderCategoryEditor() {
    const d = state.categoryDraft; if (!d) return;
    $('#categoryNameInput').value = d.name;
    $('#categoryNameInput').disabled = d.canRename === false;
    I18n.setAttribute($('#categoryNameInput'),"title",()=>(d.canRename === false ? I18n.t("UISystemPlaylistNameIsProtected") : ''));
    $('#categoryIconGrid').innerHTML = categoryIconNames.map((name) => `<button class="${d.icon===name?'active':''}" data-category-icon="${name}" title="${esc(playlistIcons.labels[name.slice(3)] || name.slice(3).replaceAll('-',' '))}" aria-label="${esc(playlistIcons.labels[name.slice(3)] || name.slice(3).replaceAll('-',' '))}" aria-pressed="${d.icon===name}">${categoryIconMarkup(name,20)}</button>`).join('');
    $('#categoryColorOptions').innerHTML = categoryPresetColors.map((c) => `<button class="category-color-dot ${d.color.toLowerCase()===c?'active':''}" style="--dot:${c}" data-category-color="${c}" title="${c}"></button>`).join('') + `<button class="category-color-custom" data-category-color-custom title="${I18n.h("UICustomColour")}" data-i18n-title="UICustomColour">${window.Icon('palette',16)}</button>`;
    $('#categoryGlowToggle').checked = !!d.glow;
    $('#categoryGlowSettings').classList.toggle('hidden', !d.glow);
    $('#categoryGlowIntensity').value = d.glowIntensity;
    $('#categoryGlowIntensityValue').textContent = `${Math.round(d.glowIntensity)}%`;
    setRangeFill($('#categoryGlowIntensity'), d.glowIntensity);
    $('#gradientCount').textContent = `${d.gradient.length}/4`;
    $('#categoryGradientList').innerHTML = d.gradient.map((c,i) => `<div class="gradient-color-row" draggable="true" data-gradient-index="${i}"><span class="gradient-grip">${window.Icon('grip',14)}</span><button class="gradient-swatch" style="--dot:${esc(c)}" data-gradient-color="${i}"></button><code>${esc(c.toUpperCase())}</code>${d.gradient.length>1?`<button class="gradient-remove" data-gradient-remove="${i}">${window.Icon('trash',14)}</button>`:''}</div>`).join('');
    $('#addGradientColorBtn').disabled = d.gradient.length >= 4;
    const cat = {color:d.color,gradient:d.gradient,glow:d.glow,glowIntensity:d.glowIntensity};
    $('#categoryPreview').innerHTML = `<span data-i18n="UIPreview">${I18n.h("UIPreview")}</span><button class="category-tab active ${d.glow?'has-glow':''}" style="${categoryCssVars(cat)}"><span class="category-visual"><span class="category-icon">${categoryIconMarkup(d.icon,18)}</span><b class="category-label">${esc(d.name || I18n.t("UIPlaylist"))}</b></span></button>`;
  }

  function updateCategoryPreviewOnly() {
    const d = state.categoryDraft; if (!d) return;
    const preview = $('#categoryPreview'); if (!preview) return;
    const cat = {color:d.color,gradient:d.gradient,glow:d.glow,glowIntensity:d.glowIntensity};
    preview.innerHTML = `<span data-i18n="UIPreview">${I18n.h("UIPreview")}</span><button class="category-tab active ${d.glow?'has-glow':''}" style="${categoryCssVars(cat)}"><span class="category-visual"><span class="category-icon">${categoryIconMarkup(d.icon,18)}</span><b class="category-label">${esc(d.name || I18n.t("UIPlaylist"))}</b></span></button>`;
  }

  function openCategoryEditor(cat = null, focusName = false) {
    state.categoryDraftFolder=null;$('#categoryProtectedToggle').closest('.vault-editor-security').classList.remove('hidden');
    state.categoryDraftKey = cat?.key || '';
    state.categoryDraft = categoryDraftFrom(cat);
    $('#categoryProtectedToggle').checked=!!cat?.protected;$('#categoryPasswordInput').value='';$('#categoryPasswordConfirm').value='';renderProtectionFields();
    I18n.setText($('#categoryStyleTitle'),()=>(cat ? (focusName ? I18n.t("UIRenamePlaylist") : I18n.t("UIChangePlaylistAppearance")) : (state.dropPlaylistTitle||I18n.t("UINewPlaylist"))));
    state.dropPlaylistTitle='';
    renderCategoryEditor();
    openModal('categoryStyleModal');
    if (focusName) requestAnimationFrame(() => { $('#categoryNameInput').focus(); $('#categoryNameInput').select(); });
  }

  async function saveCategoryEditor() {
    if(state.categoryDraftFolder)return saveFolderEditor();
    const d=state.categoryDraft;if(!d)return;const button=$('#categoryStyleSave');if(button.disabled)return;
    const enabled=$('#categoryProtectedToggle').checked,wasProtected=isProtected(state.categoryDraftKey);
    let password=$('#categoryPasswordInput').value;
    if(enabled&&!wasProtected&&([...password].length<3||[...password].length>48||password!==$('#categoryPasswordConfirm').value)){toast('bad',I18n.t("UICheckThePassword"),I18n.t("UIUseToCharactersBothEntriesMustMatch"));return;}
    const pending=state.pendingNewTracks||allKnownTracks().filter(t=>(state.pendingTracksForNewCategory||(state.pendingTrackForNewCategory?[state.pendingTrackForNewCategory]:[])).includes(t.rel));
    let key=state.categoryDraftKey;const creating=!key;
    if(d.canRename!==false)d.name=$('#categoryNameInput').value.trim().slice(0,40)||I18n.t("UINewPlaylist");
    const style={name:d.name,icon:d.icon,color:d.color,glow:d.glow,glowIntensity:d.glowIntensity,gradient:d.gradient.slice(0,4)};
    button.disabled=true;I18n.setText(button,()=>(I18n.t("UISaving")));
    try{
      if(key){const cat=categoryByKey(key);if(cat?.kind==='custom')Object.assign(customCategoryByKey(key),style);else {if(cat?.canRename===false)delete style.name;categoryPatch(key,style);}}
      else {key=`custom:${Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('')}`;state.settings.customCategories||=[];state.settings.customCategories.push({id:key,...style,folderId:state.folderId||'',hidden:false,tracks:[]});state.settings.categoryOrder.push(key);state.categoryDraftKey=key;}
      await persistCategorySettings();
      if(enabled&&!wasProtected){
        stopPrivatePlayback(true);const result=await runVaultCommand({type:'protect',key,name:d.name,password});
        Object.assign(state.settings,result.settings);for(const message of result.warnings||[])toast('bad',I18n.t("UIProtectionNeedsAttention"),message,11000);
      }else if(!enabled&&wasProtected){
        const values=await requestPasswords({title:I18n.t("UIDisableProtection"),text:I18n.t("UIAllSongsInThisPlaylistIncludingThoseRemoved"),fields:[{key:'source',label:I18n.t("UIPasswordFor", {value1:(d.name)})}]});
        if(!values)return;stopPrivatePlayback();const result=await runVaultCommand({type:'unprotect',key,password:values.source});Object.assign(state.settings,result.settings);
      }
      closeModal('categoryStyleModal');state.pendingNewTracks=null;
      // New protected playlist: use the just-entered password; do not persist it.
      if(creating&&pending.length){
        if(enabled&&!pending.some(t=>t.vaultKey)){
          const result=await runVaultCommand({type:'ingest',key,rels:pending.map(t=>t.rel),password});await refreshAfterVault(result);
        }else await addChosenTracks(pending,key);
      }
      await loadLibrary({quiet:true});if(creating)await navigateCategory(key,{force:true});else renderLibrary();
    }catch(error){toast('bad',I18n.t("UICouldNotFinishSaving"),I18n.errorMessage(error)||String(error),8500);}
    finally{password='';$('#categoryPasswordInput').value='';$('#categoryPasswordConfirm').value='';button.disabled=false;I18n.setText(button,()=>(I18n.t("UISave")));}
  }

  async function toggleTrackCategory(track, key) {
    if(!track)return;
    if(track.vaultKey||isProtected(key)){try{await addChosenTracks([track],key);}catch(e){toast('bad',I18n.t("UICouldNotAddTheSong"),I18n.errorMessage(e)||String(e));}return;}
    if(Library.Folders.split(key).base==='all')return;
    try {
      const result = await api.library.organize({ type: 'membership', key, rel: track.rel });
      applyOrganizationSettings(result.settings);
      toast('info', result.added ? I18n.t("UIAddedToPlaylist") : I18n.t("UIRemovedFromPlaylist"), categoryByKey(key)?.label || I18n.t("UIPlaylist"), 1600);
    } catch (error) { toast('bad', I18n.t("UICouldNotUpdateThePlaylist"), I18n.errorMessage(error) || String(error)); }
  }

  function openContextMenu(track, anchor) {
    if (!track) return;
    const menu = $('#contextMenu');
    trackTools?.menuClosed();trackTools?.closePopup(false);
    const source = safeUrl(track.sourceUrl, ['https:','http:']);
    const customCats = categoryData(true);
    menu.dataset.menuKind = 'track';
    menu.dataset.trackId = track.id;
    menu.innerHTML = `
      <button class="context-item" data-menu="favorite">${window.Icon(track.favorite ? 'heartFill':'heart',15)}${track.favorite ? I18n.h("UIRemoveFromFavourites"):I18n.h("UIAddToFavourites2")}</button>
      ${trackTools?.trackMenu(track)||''}
      ${Library.Folders.split(state.category).base!=='all'||isProtected()?`<button class="context-item" data-menu="remove-current">${window.Icon('minus',15)}<span data-i18n="UIRemoveFrom" data-i18n-args="${I18n.attrArgs({value1:(categoryByKey(state.category)?.label||I18n.msg("UIPlaylist"))})}">${I18n.h("UIRemoveFrom", {value1:(categoryByKey(state.category)?.label||I18n.msg("UIPlaylist"))})}</span></button>`:''}
      <div class="context-sep"></div>
      ${!track.vaultKey?`<button class="context-item" data-menu="reveal">${window.Icon('folder',15)}<span data-i18n="UIShowInFolder">${I18n.h("UIShowInFolder")}</span></button>`:''}
      <div class="context-submenu-wrap">
        <button class="context-item" data-menu="addTo" data-submenu-trigger="addTo" aria-haspopup="menu" aria-expanded="false">${window.Icon('folder',15)}<span data-i18n="UIAddTo">${I18n.h("UIAddTo")}</span><span class="context-arrow">${window.Icon('chevronRight',13)}</span></button>
        <div class="context-submenu">
          ${customCats.length ? customCats.map((c) => {
            const has = Library.containsTrack(state.settings, state.tracks, c.key, track);
            return `<button class="context-item ${has?'checked':''}" data-add-category="${esc(c.key)}" ${Library.Folders.split(c.key).base === 'all' && !isProtected(c.key) && !track.vaultKey ? `disabled title="${I18n.h("UITrackIsAlreadyInTheMainLibrary")}" data-i18n-title="UITrackIsAlreadyInTheMainLibrary"` : ''}>${categoryIconMarkup(c.icon||'music',15)}<span>${esc(c.label)}${c.hidden ? I18n.h("UIHidden4") : ''}</span>${has?window.Icon('check',13):''}</button>`;
          }).join('') : `<span class="context-empty" data-i18n="UINoCustomPlaylistsYet">${I18n.h("UINoCustomPlaylistsYet")}</span>`}
          <button class="context-item new-playlist-item" data-new-category-for-track>${window.Icon('plus',15)}<span data-i18n="UINewPlaylist">${I18n.h("UINewPlaylist")}</span></button>
        </div>
      </div>
      ${source ? `<button class="context-item" data-menu="source">${window.Icon('external',15)}<span data-i18n="UIOpenSource">${I18n.h("UIOpenSource")}</span></button>` : ''}
      ${canTrimTrack(track) ? `<button class="context-item" data-menu="trim">${window.Icon('scissors',15)}<span data-i18n="UITrimTrack">${I18n.h("UITrimTrack")}</span></button>` : ''}
      <div class="context-sep"></div>
      <button class="context-item danger" data-menu="delete">${window.Icon('trash',15)}<span data-i18n="UIDeleteFile">${I18n.h("UIDeleteFile")}</span></button>`;
    menuReorder?.prepare();
    menu.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    requestAnimationFrame(() => {
      const mr = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(innerWidth - mr.width - 8, r.right - mr.width))}px`;
      menu.style.top = `${Math.max(58, Math.min(innerHeight - mr.height - 104, r.bottom + 6))}px`;
      armTrackSubmenu(menu);
    });
  }

  function selectedSnapshot(ids) {
    const wanted=new Set(ids);
    return state.filtered.filter(t=>wanted.has(t.id));
  }

  function openBulkContextMenu(ids,x,y) {
    const tracks=selectedSnapshot(ids);if(!tracks.length)return;
    const menu=$('#contextMenu'), rels=tracks.map(t=>t.rel);
    const info=Library.selectionArtists(state.settings,allKnownTracks(),rels);
    const cats=categoryData(true), artists=Library.categories(allKnownTracks(),state.settings,true).filter(c=>c.kind==='artist');
    const urls=[...new Set(tracks.map(t=>safeUrl(t.sourceUrl,['https:','http:'])).filter(Boolean))];
    const allFavorite=tracks.every(t=>t.favorite);
    menu.dataset.menuKind='tracks';menu.dataset.trackIds=JSON.stringify(tracks.map(t=>t.id));delete menu.dataset.trackId;
    menu.innerHTML=`<div class="context-selection-title" data-i18n="UISelected2" data-i18n-args="${I18n.attrArgs({value1:(tracks.length),value2:(decl(tracks.length,I18n.t("AppTrack"),I18n.t("UITracks"),I18n.t("UITracks2")))})}">${I18n.h("UISelected2", {value1:(tracks.length),value2:(decl(tracks.length,I18n.t("AppTrack"),I18n.t("UITracks"),I18n.t("UITracks2")))})}</div>
      <button class="context-item" data-bulk-action="${allFavorite?'unfavorite':'favorite'}">${window.Icon(allFavorite?'heartFill':'heart',15)}<span>${allFavorite?I18n.h("UIRemoveTheseFromFavourites"):I18n.h("UIAddTheseToFavourites")}</span></button>
      ${Library.Folders.split(state.category).base!=='all'||isProtected()?`<button class="context-item" data-bulk-action="remove-current">${window.Icon('minus',15)}<span data-i18n="UIRemoveFrom" data-i18n-args="${I18n.attrArgs({value1:(categoryByKey(state.category)?.label||I18n.msg("UIPlaylist"))})}">${I18n.h("UIRemoveFrom", {value1:(categoryByKey(state.category)?.label||I18n.msg("UIPlaylist"))})}</span></button>`:''}
      ${playlistSubmenu('bulk-add',I18n.h("UIAddTheseTo"),'folder',cats.map(c=>{
        const has=!isProtected(c.key)&&!tracks.some(t=>t.vaultKey)&&tracks.every(Library.membershipPredicate(state.settings,c.key));
        return `<button class="context-item" data-bulk-add="${esc(c.key)}" ${(Library.Folders.split(c.key).base==='all'&&!isProtected(c.key)&&!tracks.some(t=>t.vaultKey))||has?'disabled':''}>${categoryIconMarkup(c.icon,15)}<span>${esc(c.label)}${c.hidden?I18n.h("UIHidden4"):''}</span>${has?window.Icon('check',13):''}</button>`;
      }).join('')+`<button class="context-item new-playlist-item" data-bulk-action="new-playlist">${window.Icon('plus',15)}<span data-i18n="UINewPlaylist">${I18n.h("UINewPlaylist")}</span></button>`)}
      <button class="context-item" data-bulk-action="sources" ${urls.length?'':'disabled'}>${window.Icon('external',15)}<span data-i18n="UIOpenSources">${I18n.h("UIOpenSources")}</span><small>${urls.length||''}</small></button>
      ${info.canAlias&&artists.length?playlistSubmenu('bulk-alias',I18n.h("UITreatTheArtistsOfTheseTracksAs"),'link',artists.map(c=>`<button class="context-item" data-bulk-alias="${esc(c.key)}">${categoryIconMarkup(c.icon,15)}<span>${esc(c.label)}</span></button>`).join('')):''}
      ${info.canSplit?`<button class="context-item" data-bulk-action="split">${window.Icon('unlink',15)}<span data-i18n="UISeparateArtists">${I18n.h("UISeparateArtists")}</span></button>`:''}
      <div class="context-sep"></div><button class="context-item danger" data-bulk-action="delete">${window.Icon('trash',15)}<span data-i18n="UIDeleteAll">${I18n.h("UIDeleteAll")}</span></button>`;
    menuReorder?.prepare();
    menu.classList.remove('hidden');
    requestAnimationFrame(()=>{
      const r=menu.getBoundingClientRect();
      menu.style.left=`${Math.max(8,Math.min(innerWidth-r.width-8,x))}px`;
      menu.style.top=`${Math.max(8,Math.min(innerHeight-r.height-8,y))}px`;
      armTrackSubmenu(menu);
    });
  }

  function askArtistSplit(keys,rels=null) {
    const groups=rels?Library.selectionArtists(state.settings,allKnownTracks(),rels).groups:
      Library.artistGroups(state.settings,state.tracks).filter(g=>keys.includes(g.key));
    if(!groups.length)return;
    const labels=groups.map(g=>g.members.map(m=>m.label).join(', ')).join('; ');
    openConfirmation({title:I18n.t("UISeparateArtists2"),
      text:I18n.t("UITheseWillBecomeSeparateArtistsAgainRulesAre", {value1:(labels)}),
      actionText:I18n.t("UISeparateArtists"),icon:'unlink',onConfirm:async()=>{
        const result=await api.library.organize(rels?{type:'split-selected',rels}:{type:'split-artists',keys});
        for(const name of result.artists)orderHistory.discard(`artist:${name}`);
        closeModal('confirmModal');applyOrganizationSettings(result.settings);
        toast('good',I18n.t("UIArtistsSeparated"),I18n.t("UIArtistsRestored", {value1:(result.count)}),3200);
      }});
  }

  function askSelectedArtistAlias(tracks,targetKey) {
    const target=categoryByKey(targetKey);if(!target)return;
    const rels=tracks.map(t=>t.rel),info=Library.selectionArtists(state.settings,allKnownTracks(),rels);
    if(!info.canAlias)return;
    const labels=info.canonical.map(n=>categoryByKey(`artist:${n}`)?.label||n).join(', ');
    openConfirmation({title:I18n.t("UITreatTheArtistsAs", {value1:(target.label)}),
      text:I18n.t("UIArtistsAllTheirCurrentAndFutureTracksWill", {value1:(labels),value2:(target.label)}),
      actionText:I18n.t("UISaveRules"),icon:'link',onConfirm:async()=>{
        const result=await api.library.organize({type:'alias-selected',rels,target:targetKey});
        for(const key of result.sourceKeys)orderHistory.discard(key);
        closeModal('confirmModal');state.category=targetKey;applyOrganizationSettings(result.settings);
        toast('good',I18n.t("UIArtistRulesSaved"),I18n.t("UIAllTracks", {value1:(target.label)}),3200);
      }});
  }

  function askDeleteSelected(tracks) {
    if(tracks.some(t=>t.vaultKey)){removeChosenTracks(tracks,tracks[0].vaultKey,{erase:true}).catch(e=>toast('bad',I18n.t("UICouldNotDelete"),I18n.errorMessage(e)||String(e)));return;}
    const snapshot=tracks.map(t=>({id:t.id,rel:t.rel}));
    openConfirmation({title:I18n.t("UIDeleteAllSelectedTracks", {value1:(snapshot.length)}),
      text:I18n.t("UIWillBeMovedToTheWindowsRecycleBin", {value1:(snapshot.length),value2:(decl(snapshot.length,I18n.t("UIAudioFile"),I18n.t("UIAudioFiles"),I18n.t("UIAudioFiles2")))}),
      actionText:I18n.t("UIDeleteAll"),icon:'trash',danger:true,onConfirm:async()=>{
        closeModal('confirmModal');
        if(snapshot.some(t=>t.id===state.currentId)){
          audio.pause();releasePlayback('local');audio.removeAttribute('src');audio.load();state.currentId=null;updatePlayerUI();
        }
        const result=await api.library.removeMany(snapshot.map(t=>t.rel));
        if(result.settings)Object.assign(state.settings,result.settings);
        await loadLibrary({quiet:true});
        trackSelection.clear();
        if(result.failed?.length){
          const failed=new Set(result.failed.map(f=>Library.token(f.rel)));
          trackSelection.set(state.filtered.filter(t=>failed.has(Library.token(t.rel))).map(t=>t.id));
          toast('bad',I18n.t("UIDeletedFailed", {value1:(result.removed.length),value2:(result.failed.length)}),result.failed.map(f=>`${f.rel}: ${f.message}`).join(' · '),8500);
        }else toast('good',I18n.t("UISelectedFilesMovedToTheRecycleBin"),I18n.t("UIDeleted", {value1:(result.removed.length)}),3200);
        if(result.warnings?.length)toast('info',I18n.t("UISomeMetadataFilesCouldNotBeRemoved"),result.warnings.map(w=>w.rel).join(', '),5500);
      }});
  }

  async function handleBulkMenu(e,menu) {
    if(bulkBusy)return;
    const tracks=selectedSnapshot(JSON.parse(menu.dataset.trackIds||'[]'));if(!tracks.length){hideContextMenu();return;}
    const rels=tracks.map(t=>t.rel),add=e.target.closest('[data-bulk-add]'),alias=e.target.closest('[data-bulk-alias]');
    const action=e.target.closest('[data-bulk-action]')?.dataset.bulkAction;
    if(alias){if(tracks[0].vaultKey)askPrivateArtistAction(tracks,'alias',alias.dataset.bulkAlias);else askSelectedArtistAlias(tracks,alias.dataset.bulkAlias);return;}
    if(action==='unfavorite'||action==='remove-current'){try{await removeChosenTracks(tracks,action==='unfavorite'?Library.Folders.scoped(state.folderId||'','favorite'):state.category);}catch(e){toast('bad',I18n.t("UICouldNotRemoveSongs"),I18n.errorMessage(e)||String(e));}return;}
    if(action==='split'){if(tracks[0].vaultKey)askPrivateArtistAction(tracks,'split');else askArtistSplit([],rels);return;}
    if(action==='delete'){askDeleteSelected(tracks);return;}
    if(action==='new-playlist'){
      state.pendingTrackForNewCategory='';state.pendingTracksForNewCategory=rels;state.pendingNewTracks=tracks.slice();
      hideContextMenu();openCategoryEditor();return;
    }
    if(action==='sources'){
      const urls=[...new Set(tracks.map(t=>safeUrl(t.sourceUrl,['https:','http:'])).filter(Boolean))];
      const run=async()=>{closeModal('confirmModal');for(const url of urls)await api.system.openExternal(url);};
      hideContextMenu();
      if(urls.length>8)openConfirmation({title:I18n.t("UIOpenSources2", {value1:(urls.length)}),text:I18n.t("UITheyWillOpenInYourExternalBrowserDuplicate"),actionText:I18n.t("UIOpenSources"),icon:'external',onConfirm:run});
      else try{await run();}catch(error){toast('bad',I18n.t("UICouldNotOpenAllSources"),I18n.errorMessage(error)||String(error));}
      return;
    }
    if(!add&&action!=='favorite')return;
    bulkBusy=true;
    const key=add?add.dataset.bulkAdd:Library.Folders.scoped(state.folderId||'','favorite');
    hideContextMenu();
    try{
      await addChosenTracks(tracks,key);
    }catch(error){toast('bad',I18n.t("UICouldNotAddTracks"),I18n.errorMessage(error)||String(error));}
    finally{bulkBusy=false;}
  }

  let vaultOperations=0;
  async function runVaultCommand(command){
    const busy=!['enter','unlock','lock','order','archives'].includes(command.type);
    if(busy){vaultOperations++;let el=$('#vaultOperationStatus');if(!el){el=document.createElement('div');el.id='vaultOperationStatus';el.setAttribute('role','status');el.innerHTML=`<span class="vault-working-dot"></span><span data-i18n="UIWorkingWithTheProtectedLibraryDoNotClose">${I18n.h("UIWorkingWithTheProtectedLibraryDoNotClose")}</span>`;document.body.append(el);}el.classList.remove('hidden');}
    try{return await api.vault.command(command);}finally{if(busy&&!--vaultOperations)$('#vaultOperationStatus')?.classList.add('hidden');}
  }
  function allKnownTracks(){return [...state.tracks,...state.privateTracks,...(state.privateNowPlaying&&!state.privateTracks.some(t=>t.id===state.privateNowPlaying.id)?[state.privateNowPlaying]:[])];}
  function isProtected(key=state.category){return !!state.settings.protectedPlaylists?.[key];}
  function stopPrivatePlayback(force=false){
    if(force||currentTrack()?.vaultKey){audio.pause();releasePlayback('local');audio.removeAttribute('src');audio.load();state.currentId=null;state.privateNowPlaying=null;
      if('mediaSession'in navigator)navigator.mediaSession.metadata=null;updatePlayerUI();}
  }
  function clearPrivateView(){
    for(const key of Object.keys(state.settings.protectedPlaylists||{}))delete state.settings.trackOrders?.[key];
    state.privateTracks=[];state.vaultUnlocked=false;state.vaultArchived=0;state.librarySignature='';trackSelection?.clear();
    hideContextMenu();$('#contextMenu').replaceChildren();state.pendingNewTracks=null;state.pendingTracksForNewCategory=null;state.pendingTrackForNewCategory='';
  }
  async function navigateCategory(key,{force=false}={}){
    state.folderId=Library.Folders.ofCategory(key,state.settings);if(state.settings.libraryFolders?.length)state.folderOverview=false;
    if(key===state.category&&!force)return;
    const previous=state.category,oldGroup=state.settings.protectedPlaylists?.[previous]?.group,newGroup=state.settings.protectedPlaylists?.[key]?.group;
    const keep=oldGroup&&oldGroup===newGroup;
    if(!keep)stopPrivatePlayback();
    else if(currentTrack()?.vaultKey)state.privateNowPlaying=currentTrack();
    const epoch=++vaultEpoch;clearPrivateView();state.category=key;state.categoryEditMode=false;hideContextMenu();
    state.categorySignature='';renderCategories(true);renderLibraryBody();
    if(!api.vault)return;
    try{
      const result=await runVaultCommand({type:'enter',key});
      if(epoch!==vaultEpoch||key!==state.category)return;
      if(result.settings)Object.assign(state.settings,result.settings);acceptPrivateView(result,key);renderLibrary();updatePlayerUI();
    }catch(e){if(epoch===vaultEpoch)toast('bad',I18n.t("UICouldNotOpenThePlaylist"),I18n.errorMessage(e)||String(e));}
  }
  function acceptPrivateView(result,key){
    state.privateTracks=result.tracks||[];state.vaultUnlocked=!result.locked&&isProtected(key);state.vaultArchived=result.archived||0;
    if(result.order){state.settings.trackOrders[key]||={};state.settings.trackOrders[key].manual=result.order;}
    state.librarySignature='';
  }
  async function unlockCurrentVault(form){
    const key=state.category,epoch=vaultEpoch,field=form.querySelector('input'),button=form.querySelector('button');
    let password=field.value;field.value='';button.disabled=true;I18n.setText(button,()=>(I18n.t("UIChecking")));const error=$('#vaultUnlockError');error.textContent='';
    try{
      const result=await runVaultCommand({type:'unlock',key,password});password='';
      if(epoch!==vaultEpoch||key!==state.category)return;
      if(result.settings)Object.assign(state.settings,result.settings);acceptPrivateView(result,key);renderLibraryBody();
      for(const message of result.warnings||[])toast('bad',I18n.t("UIProtectionNeedsAttention"),message,11000);
    }catch(e){if(epoch===vaultEpoch){I18n.setText(error,()=>(I18n.errorMessage(e)||String(e)));button.disabled=false;I18n.setText(button,()=>(I18n.t("UIOpen")));field.focus();}}
    finally{password='';}
  }
  function renderVaultLocked(){
    const lib=$('#library'),cat=categoryByKey(state.category);state.filtered=[];trackSelection?.clear();
    $('#emptyState').classList.add('hidden');$('#dropHint').classList.add('hidden');updateViewButtons();updateMeta();lib.className='library';
    lib.innerHTML=`<section class="vault-lock-panel">${window.Icon('lock',36)}<h3>${esc(cat?.label||I18n.t("UIProtectedPlaylist"))}</h3><p data-i18n="UISongListCoversAndPrivateAudioFilesAre" data-i18n-args="${I18n.attrArgs({value1:(state.settings.protectedPlaylists?.[state.category]?.group?I18n.msg("UIAndItsLinkedPlaylists"):'')})}">${I18n.h("UISongListCoversAndPrivateAudioFilesAre", {value1:(state.settings.protectedPlaylists?.[state.category]?.group?I18n.msg("UIAndItsLinkedPlaylists"):'')})}</p><form class="vault-inline-form" id="vaultUnlockForm" autocomplete="off"><input type="password" aria-label="${I18n.h("UIPlaylistPassword")}" data-i18n-aria-label="UIPlaylistPassword" placeholder="${I18n.h("UIPlaylistPassword")}" data-i18n-placeholder="UIPlaylistPassword" autocomplete="off" spellcheck="false" required><button class="button primary" type="submit" data-i18n="UIOpen">${I18n.h("UIOpen")}</button></form><p id="vaultUnlockError" class="vault-error" role="alert"></p></section>`;
    $('#vaultUnlockForm').addEventListener('submit',e=>{e.preventDefault();unlockCurrentVault(e.currentTarget);});
  }
  function refreshVaultBanner(){
    $('#vaultInfoBanner')?.remove();
    if(!isProtected()||!state.vaultUnlocked)return;
    const banner=document.createElement('div');banner.id='vaultInfoBanner';banner.className='vault-info-banner';
    banner.innerHTML=`${window.Icon('lock',15)}<span data-i18n="UIAccessGranted" data-i18n-args="${I18n.attrArgs({value1:(state.privateTracks.some(t=>t.publicCopy)?I18n.msg("UISomeSongsHaveUnprotectedCopies"):'')})}">${I18n.h("UIAccessGranted", {value1:(state.privateTracks.some(t=>t.publicCopy)?I18n.msg("UISomeSongsHaveUnprotectedCopies"):'')})}</span><button class="button secondary" id="lockVaultNow" data-i18n="UILock">${I18n.h("UILock")}</button>`;
    $('#library').before(banner);$('#lockVaultNow').addEventListener('click',async()=>{stopPrivatePlayback();await runVaultCommand({type:'lock'});clearPrivateView();renderLibraryBody();});
  }
  function requestPasswords({title=I18n.t('AccessConfirmationTitle'),text='',fields=[],newPassword=false}){
    hideContextMenu();return new Promise(resolve=>{
      vaultPromptResolve=resolve;I18n.setOwnedText($('#vaultPasswordTitle'),title);I18n.setOwnedText($('#vaultPasswordText'),text);
      $('#vaultPasswordError').textContent='';$('#vaultPasswordSubmit').disabled=false;
      $('#vaultPasswordFields').innerHTML=fields.map(f=>`<label class="vault-password-field">${esc(f.label)}<input type="password" data-secret-field="${esc(f.key)}" autocomplete="off" spellcheck="false" required></label>`).join('')+
        (newPassword?`<label class="vault-password-field"><span data-i18n="UISharedPasswordCharacters">${I18n.h("UISharedPasswordCharacters")}</span><input type="password" data-secret-field="new" autocomplete="new-password" required></label><label class="vault-password-field"><span data-i18n="UIRepeatTheSharedPassword">${I18n.h("UIRepeatTheSharedPassword")}</span><input type="password" data-secret-field="confirm" autocomplete="new-password" required></label>`:'');
      openModal('vaultPasswordModal');requestAnimationFrame(()=>$('#vaultPasswordFields input')?.focus());
    });
  }
  function bindVaultUi(){
    $('#vaultPasswordForm').addEventListener('submit',e=>{
      e.preventDefault();const values=Object.fromEntries($$('[data-secret-field]',$('#vaultPasswordFields')).map(input=>[input.dataset.secretField,input.value]));
      if(values.new!==undefined&&([...values.new].length<3||[...values.new].length>48||values.new!==values.confirm)){I18n.setText($('#vaultPasswordError'),()=>(I18n.t("UISharedPasswordMustContainToCharactersAndMatch")));return;}
      const resolve=vaultPromptResolve;vaultPromptResolve=null;closeModal('vaultPasswordModal');resolve?.(values);
    });
    $('#categoryProtectedToggle').addEventListener('change',()=>renderProtectionFields());
    const libraryPage=$('[data-settings-panel="library"]')||$('#settingsLibrary');
    if(libraryPage){const button=document.createElement('button');button.className='button secondary';button.id='restoreVaultArchive';I18n.setText(button,()=>(I18n.t("UIRestoreAProtectedPlaylistFromAnArchive")));button.addEventListener('click',restoreVaultArchive);libraryPage.append(button);}
  }
  async function restoreVaultArchive(){
    try{
      const result=await runVaultCommand({type:'archives'});
      if(!result.archives.length){toast('info',I18n.t("UINoArchivedProtectedPlaylists"),I18n.t("UIDeletedProtectedPlaylistsWillAppearHere"));return;}
      openConfirmation({title:I18n.t("UIRestoreAProtectedPlaylist"),text:I18n.t("UISelectASavedArchiveRestoringRequiresThisPlaylist"),actionText:I18n.t("PlayerOverlayResume"),icon:'lock',onConfirm:async()=>{
        const key=$('#vaultArchiveChoice').value;closeModal('confirmModal');const values=await requestPasswords({title:I18n.t("UIArchivedPlaylistPassword"),fields:[{key:'source',label:I18n.t("UIPersonalPlaylistPassword")}]});
        if(!values)return;const r=await runVaultCommand({type:'restore-archive',key,password:values.source});await refreshAfterVault(r);await navigateCategory(key,{force:true});
      }});
      const select=document.createElement('select');select.id='vaultArchiveChoice';select.className='batch-target';select.innerHTML=result.archives.map(a=>`<option value="${esc(a.key)}">${esc(a.name)}</option>`).join('');$('#confirmText').append(select);
    }catch(e){toast('bad',I18n.t("UICouldNotReadArchives"),I18n.errorMessage(e)||String(e));}
  }
  function renderProtectionFields(){
    const existing=isProtected(state.categoryDraftKey),enabled=$('#categoryProtectedToggle').checked;
    $('#categoryPasswordFields').classList.toggle('hidden',existing||!enabled);$('#categoryProtectionNote').classList.toggle('hidden',!existing);
  }
  async function refreshAfterVault(result){
    if(result?.settings)Object.assign(state.settings,result.settings);
    for(const message of result?.warnings||[])toast('bad',I18n.t("UIProtectionNeedsAttention"),message,11000);
    await loadLibrary({quiet:true});
    if(isProtected()){
      const next=await runVaultCommand({type:'enter',key:state.category});acceptPrivateView(next,state.category);
    }else clearPrivateView();
    renderLibrary();updatePlayerUI();
  }
  async function askPrivateArtistAction(tracks,action,target=''){
    try{
      const values=await requestPasswords({title:action==='split'?I18n.t("UISeparateArtists2"):I18n.t("UISaveTheArtistRule"),text:I18n.t("UIRuleAppliesToAllCurrentAndFutureTracks"),fields:[{key:'source',label:I18n.t("UIProtectedPlaylistPassword")}]});
      if(!values)return;const result=await runVaultCommand({type:'artist-selection',source:tracks[0].vaultKey,rels:tracks.map(t=>t.rel),action,target,password:values.source,discloseArtistNames:true});await refreshAfterVault(result);toast('good',I18n.t("UIArtistRulesSaved"),I18n.t("UISongsRemainProtected"));
    }catch(e){toast('bad',I18n.t("UICouldNotUpdateArtists"),I18n.errorMessage(e)||String(e));}
  }
  async function addChosenTracks(tracks,key){
    if(!tracks.length)return;
    if(tracks.some(t=>t.vaultKey)){
      const source=tracks[0].vaultKey;if(tracks.some(t=>t.vaultKey!==source))throw I18n.error("UISelectPrivateTracksWithinASinglePlaylist");
      if(source===key)return;
      const targetProtected=isProtected(key),fields=[{key:'source',label:I18n.t("UIPasswordFor", {value1:(categoryByKey(source)?.label||I18n.msg("UISource"))})}];
      if(targetProtected)fields.push({key:'target',label:I18n.t("UIPasswordFor", {value1:(categoryByKey(key)?.label||I18n.msg("UIDestination"))})});
      const secrets=await requestPasswords({title:targetProtected?I18n.t("UIAddProtectedSongs"):I18n.t("UIMakeTheSelectedSongsPublic"),
        text:targetProtected?I18n.t("UIAccessWillBeAddedToTheSameEncrypted"):
          I18n.t("UITheseSongsWillBeDecryptedIntoMusicAnd"),fields});
      if(!secrets)return;stopPrivatePlayback(tracks.some(t=>t.id===state.currentId));
      const result=await runVaultCommand({type:'transfer',source,target:key,rels:tracks.map(t=>t.rel),password:secrets.source,targetPassword:secrets.target});
      await refreshAfterVault(result);toast('good',I18n.t("UISongsAdded"),categoryByKey(key)?.label||I18n.t("UIPlaylist"));return result;
    }
    if(isProtected(key)){
      const secrets=await requestPasswords({title:I18n.t("UIProtectTheseSongs"),text:I18n.t("UISelectedFilesWillBeEncryptedAndRemovedFrom"),fields:[{key:'target',label:I18n.t("UIPasswordFor", {value1:(categoryByKey(key)?.label||I18n.msg("UIPlaylist"))})}]});
      if(!secrets)return;stopPrivatePlayback(tracks.some(t=>t.id===state.currentId));
      const result=await runVaultCommand({type:'ingest',key,rels:tracks.map(t=>t.rel),password:secrets.target});await refreshAfterVault(result);
      toast(result.warnings?.length?'info':'good',result.warnings?.length?I18n.t("UIOperationNeedsAttention"):I18n.t("UISongsProtected"),I18n.t("UIAdded2", {value1:(result.added)}));return result;
    }
    const result=await api.library.organize({type:'bulk-add',key,rels:tracks.map(t=>t.rel)});applyOrganizationSettings(result.settings);
    toast('good',I18n.t("UISongsAdded"),I18n.t("UINew", {value1:(categoryByKey(key)?.label||I18n.msg("UIPlaylist")),value2:(result.added)}),2200);return result;
  }
  async function removeChosenTracks(tracks,key=state.category,{erase=false}={}){
    if(!tracks.length)return;hideContextMenu();
    if(tracks[0].vaultKey&&!isProtected(key)){
      const values=await requestPasswords({title:I18n.t("UIConfirmChangesToThePublicCopy"),fields:[{key:'source',label:I18n.t("UISourceProtectedPlaylistPassword")}]});if(!values)return;
      const result=await runVaultCommand({type:'public-remove',source:tracks[0].vaultKey,key,rels:tracks.map(t=>t.rel),password:values.source});await refreshAfterVault(result);return;
    }
    if(isProtected(key)){
      const secrets=await requestPasswords({title:erase?I18n.t("UIDeleteTheEncryptedFiles"):I18n.t("UIRemoveSongsFromThisPlaylist"),text:erase?
        I18n.t("UIEncryptedAudioFilesWillBeMovedToThe"):
        I18n.t("UISongsWillDisappearFromThisListButRemain"),fields:[{key:'source',label:I18n.t("UIPasswordFor", {value1:(categoryByKey(key)?.label||I18n.msg("UIPlaylist"))})}]});
      if(!secrets)return;stopPrivatePlayback(tracks.some(t=>t.id===state.currentId));
      const result=await runVaultCommand({type:'remove',key,rels:tracks.map(t=>t.rel),password:secrets.source,erase});
      trackSelection?.clear();await refreshAfterVault(result);if(result.failed?.length)toast('bad',I18n.t("UISomeFilesWereNotDeleted"),I18n.t("UIRemaining2", {value1:(result.failed.length)}),6500);return;
    }
    const result=await api.library.organize({type:'bulk-remove',key,rels:tracks.map(t=>t.rel)});applyOrganizationSettings(result.settings);
    toast('info',Library.Folders.split(key).base==='favorite'?I18n.t("UIRemovedFromFavourites"):I18n.t("UIRemovedFromPlaylist"),I18n.t("UIFilesKept", {value1:(result.removed),value2:(decl(result.removed,I18n.t("AppTrack"),I18n.t("UITracks"),I18n.t("UITracks2")))}),2400);
  }
  function startTrackDrop(d){
    const ids=trackSelection?.selected.has(d.node.dataset.id)?[...trackSelection.selected]:[d.node.dataset.id];
    state.draggedTracks=selectedSnapshot(ids);if(!state.draggedTracks.length)state.draggedTracks=[findTrack(d.node.dataset.id)].filter(Boolean);
    state.trackDropTarget=null;
    if(!trackSelection?.selected.has(d.node.dataset.id))trackSelection?.clear();
    for(const rail of [$('#categoryChips'),$('#categorySidebar')])if(!rail.querySelector('[data-add-category]')){
      const plus=document.createElement('button');plus.className=rail.id==='categorySidebar'?'category-side-add':'category-add';plus.dataset.addCategory='';plus.dataset.trackDropPlus='';I18n.setAttribute(plus,"title",()=>(I18n.t("UICreateAPlaylistWithTheseSongs")));plus.innerHTML=window.Icon('plus',16);rail.append(plus);
    }
    requestAnimationFrame(()=>{if(d.ghost&&state.draggedTracks.length>1){const badge=document.createElement('b');badge.className='drag-track-count';I18n.setText(badge,()=>(`${state.draggedTracks.length} ${decl(state.draggedTracks.length,I18n.t("UISong"),I18n.t("UISongs"),I18n.t("UISongs2"))}`));d.ghost.append(badge);}});
  }
  function constrainTrackGhost(position){
    const gap=12,p={...position};let minX=6,minY=6;
    for(const rail of [$('#categoryChips'),$('#categorySidebar')]){
      if(!rail?.getClientRects().length)continue;
      const style=getComputedStyle(rail);if(style.visibility!=='visible'||style.display==='none')continue;
      const r=rail.getBoundingClientRect();if(r.width<1||r.height<1||r.bottom<0||r.top>=innerHeight)continue;
      if(style.display==='flex')minY=Math.max(minY,r.bottom+gap);
      else minX=Math.max(minX,r.right+gap);
    }
    // Rail exclusion wins even in a viewport smaller than the clone; never cover a drop target.
    p.x=Math.max(minX,Math.min(p.x,innerWidth-p.width-6));p.y=Math.max(minY,Math.min(p.y,innerHeight-p.height-6));
    return p;
  }
  function detectTrackDrop(d,scroll=true){
    const element=document.elementFromPoint(d.x,d.y),rail=element?.closest('#categoryChips,#categorySidebar');
    const target=rail?element.closest('[data-category],[data-add-category]'):null;
    $$('.track-drop-target').forEach(n=>{if(n!==target){n.classList.remove('track-drop-target');n.querySelector('.drop-target-badge')?.remove();}});
    state.trackDropTarget=null;
    if(target){target.classList.add('track-drop-target');state.trackDropTarget=target.hasAttribute('data-add-category')?'__new':target.dataset.category;
      if(!target.hasAttribute('data-add-category')&&!target.querySelector('.drop-target-badge')){const badge=document.createElement('span');badge.className='drop-target-badge';badge.setAttribute('aria-hidden','true');badge.textContent='+';target.append(badge);}}
    if(!rail)return false;
    if(scroll){const r=rail.getBoundingClientRect(),horizontal=getComputedStyle(rail).display==='flex',coord=horizontal?d.x:d.y,low=horizontal?r.left:r.top,high=horizontal?r.right:r.bottom;
      const speed=coord<low+34?-9:coord>high-34?9:0;if(horizontal)rail.scrollLeft+=speed;else rail.scrollTop+=speed;}
    return true;
  }
  function hoverTrackDrop(d){return detectTrackDrop(d,true);}
  function dropTrackOnPlaylist(d){
    detectTrackDrop(d,false); // Hit-test the actual release, not the last rendered hover.
    const key=state.trackDropTarget,tracks=(state.draggedTracks||[]).slice();if(!key||!tracks.length)return false;
    if(key==='__new'){
      state.pendingTracksForNewCategory=tracks.map(t=>t.rel);state.pendingTrackForNewCategory='';state.pendingNewTracks=tracks;
      state.dropPlaylistTitle=I18n.t("UINewPlaylistAndAdd", {value1:(tracks.length===1?'«'+tracks[0].title+'»':`${tracks.length} ${decl(tracks.length,I18n.t("UISelectedSong"),I18n.t("UISelectedSongs"),I18n.t("UISelectedSongs2"))}`)});
      setTimeout(()=>openCategoryEditor(),0);
    }else setTimeout(()=>addChosenTracks(tracks,key).catch(e=>toast('bad',I18n.t("UICouldNotAddSongs"),I18n.errorMessage(e)||String(e))),0);
    return true;
  }
  function finishTrackDrop(){
    $$('[data-track-drop-plus]').forEach(n=>n.remove());$$('.track-drop-target').forEach(n=>n.classList.remove('track-drop-target'));$$('.drop-target-badge').forEach(n=>n.remove());state.trackDropTarget=null;state.draggedTracks=[];finishReordering();
  }
  function placeBatchMenu(menu,x,y){menu.classList.remove('hidden');requestAnimationFrame(()=>{const r=menu.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(innerWidth-r.width-8,x))}px`;menu.style.top=`${Math.max(8,Math.min(innerHeight-r.height-8,y))}px`;armTrackSubmenu(menu);});}
  function batchActionLabel(cats,action,full,partial){const n=Library.playlistBatchEligibility(cats,action).length;return n<cats.length?I18n.t("UIOf", {value1:(partial),value2:(n),value3:(cats.length)}):full;}
  function openPlaylistBatchMenu(keys,x,y){
    const cats=categoryData(true).filter(c=>keys.includes(c.key));if(!cats.length)return;const menu=$('#contextMenu');
    menu.dataset.menuKind='playlists';menu.dataset.playlistKeys=JSON.stringify(cats.map(c=>c.key));delete menu.dataset.trackIds;delete menu.dataset.trackId;
    const artists=Library.playlistBatchEligibility(cats,'alias'),targets=categoryData(true).filter(c=>c.kind==='artist'),protectedCats=Library.playlistBatchEligibility(cats,'link'),deletable=Library.playlistBatchEligibility(cats,'delete');
    menu.innerHTML=`<div class="context-selection-title" data-i18n="UIPlaylistsSelected" data-i18n-args="${I18n.attrArgs({value1:(cats.length)})}">${I18n.h("UIPlaylistsSelected", {value1:(cats.length)})}</div>
      <button class="context-item" data-batch-playlist="hide">${window.Icon('eyeOff',15)}<span data-i18n="UIHideThese">${I18n.h("UIHideThese")}</span></button>
      <button class="context-item" data-batch-playlist="merge" ${cats.length<2?'disabled':''}>${window.Icon('layers',15)}<span data-i18n="UIMergeThese">${I18n.h("UIMergeThese")}</span></button>
      ${artists.length>1?playlistSubmenu('batch-artist',batchActionLabel(cats,'alias',I18n.h("UITreatArtistsAs"),I18n.h("UITreatArtistsAs")),'link',targets.map(c=>`<button class="context-item" data-batch-alias="${esc(c.key)}">${categoryIconMarkup(c.icon,15)}<span>${esc(c.label)}</span></button>`).join('')):''}
      ${protectedCats.length>1?`<button class="context-item" data-batch-playlist="link">${window.Icon('lock',15)}<span>${batchActionLabel(cats,'link',I18n.h("UIMergeAccess"),I18n.h("UIMergeAccess"))}</span></button>`:''}
      <div class="context-sep"></div><button class="context-item danger" data-batch-playlist="delete" ${deletable.length?'':'disabled'} title="${deletable.length<cats.length?I18n.h("UICustomPlaylistsAndArtistSectionsWillBeDeleted"):I18n.h("UIMusicFilesWillNotBeDeleted")}">${window.Icon('trash',15)}<span>${batchActionLabel(cats,'delete',I18n.h("UIDeleteThese"),I18n.h("UIDeleteEligiblePlaylists"))}</span></button>`;
    placeBatchMenu(menu,x,y);
  }
  async function performPlaylistBatch(originalKeys,action,target=''){
    const all=categoryData(true).filter(c=>originalKeys.includes(c.key)),cats=Library.playlistBatchEligibility(all,action),keys=cats.map(c=>c.key),skipped=all.filter(c=>!keys.includes(c.key));
    if(!keys.length)return;
    const protectedCats=categoryData(true).filter(c=>c.protected&&(keys.includes(c.key)||((action==='alias'||action==='merge')&&c.key===target)));let passwords={};
    if(action==='link'){
      const values=await requestPasswords({title:I18n.t("UIMergeAccess"),text:I18n.t("UIAccessToProtectedPlaylistsWillBeMergedOther", {value1:(protectedCats.length)}),fields:protectedCats.map(c=>({key:c.key,label:I18n.t("UICurrentPasswordFor", {value1:(c.label)})})),newPassword:true});if(!values)return;
      const result=await runVaultCommand({type:'link',keys:protectedCats.map(c=>c.key),passwords:values,password:values.new});await refreshAfterVault(result);playlistSelection.set(skipped.map(c=>c.key));toast('good',I18n.t("UIAccessMerged"),I18n.t("UIPlaylists2", {value1:(result.count)}));return;
    }
    if(protectedCats.length&&action!=='hide'){
      const values=await requestPasswords({title:I18n.t("UIConfirmAccessToPlaylists"),text:action==='delete'?I18n.t("UIOnlyEligiblePlaylistsWillBeRemovedFromThe"):(isProtected(target)?I18n.t("UIContentsWillBeMovedToTheProtectedDestination"):I18n.t("UIDestinationIsNotProtectedSongsFromLockedPlaylists")),fields:protectedCats.map(c=>({key:c.key,label:I18n.t("UIPasswordFor", {value1:(c.label)})}))});if(!values)return;passwords=values;stopPrivatePlayback();
    }
    let result;
    if(protectedCats.length)result=await runVaultCommand({type:'bulk-categories',keys,action,target,passwords});
    else result=await api.library.organize(action==='alias'?{type:'alias-playlists',keys,target}:{type:'bulk-categories',keys,action,target});
    if(result.settings)Object.assign(state.settings,result.settings);
    const next=action==='merge'||action==='alias'?target:keys.includes(state.category)?Library.Folders.scoped(state.folderId||'','all'):state.category;
    await loadLibrary({quiet:true});await navigateCategory(next,{force:true});playlistSelection.set(skipped.map(c=>c.key));
    toast('good',action==='merge'?I18n.t("UIPlaylistsMerged"):action==='alias'?I18n.t("UIArtistRulesSaved"):action==='hide'?I18n.t("UIPlaylistsHidden"):I18n.t("UIPlaylistsDeleted"),I18n.t("UIProcessedOfMusicFilesWereNotDeleted", {value1:(cats.length),value2:(all.length),value3:(skipped.length?I18n.msg("UIOthersWereNotChanged"):'')}),3500);
  }
  function askPlaylistBatch(keys,action,target=''){
    const all=categoryData(true).filter(c=>keys.includes(c.key)),cats=Library.playlistBatchEligibility(all,action);if(!cats.length)return;
    if(action==='link'){performPlaylistBatch(keys,action).catch(e=>toast('bad',I18n.t("UICouldNotMergeAccess"),I18n.errorMessage(e)||String(e)));return;}
    const names=cats.map(c=>'«'+c.label+'»').join(', '),partial=cats.length<all.length?I18n.t("UIActionOfOtherPlaylistsWillNotChange", {value1:(cats.length),value2:(all.length)}):'';
    openConfirmation({title:action==='merge'?I18n.t("UIMergeSelectedPlaylists"):action==='alias'?I18n.t("UISaveArtistRules"):action==='hide'?I18n.t("UIHideSelectedPlaylists"):I18n.t("UIDeleteEligiblePlaylists2"),
      text:(action==='merge'?I18n.t("UISelectAnyDestinationPlaylistItsContentsWillBe", {value1:(names)}):action==='alias'?I18n.t("UIRulesApplyToAllCurrentAndFutureTracks", {value1:(names)}):action==='hide'?I18n.t("UIRestoreThemInPlaylistEditingMode", {value1:(names)}):I18n.t("UIAudioFilesWillNotBeDeletedEncryptedFolders", {value1:(names)}))+partial,
      actionText:action==='merge'?I18n.t("UIMerge"):action==='alias'?I18n.t("UISaveRules"):action==='hide'?I18n.t("UIHide"):I18n.t("UIDelete2", {value1:(cats.length)}),icon:action==='hide'?'eyeOff':action==='delete'?'trash':'layers',danger:action==='delete',onConfirm:async()=>{
        const destination=action==='merge'?$('#batchMergeTarget').value:target;closeModal('confirmModal');await performPlaylistBatch(keys,action,destination);
      }});
    if(action==='merge'){
      const select=document.createElement('select');select.id='batchMergeTarget';select.className='batch-target';I18n.setAttribute(select,'aria-label',()=>(I18n.t("UIWhichPlaylistToKeep")));
      select.innerHTML=cats.map(c=>`<option value="${esc(c.key)}" data-i18n="UIKeep2" data-i18n-args="${I18n.attrArgs({value1:(c.label),value2:(c.protected?I18n.msg("UIProtected"):'')})}">${I18n.h("UIKeep2", {value1:(c.label),value2:(c.protected?I18n.msg("UIProtected"):'')})}</option>`).join('');
      $('#confirmText').append(select);const hint=document.createElement('small');hint.className='batch-merge-hint';I18n.setText(hint,()=>(I18n.t("UICurrentPlaylistContentsWillBeTransferredFutureDownloads")));$('#confirmText').append(hint);$('#confirmDelete').disabled=cats.length<2;
    }
  }
  function bindPlaylistSelection(){
    playlistSelection=new window.PulsePlaylistSelection({rails:[$('#categoryChips'),$('#categorySidebar')],zones:[$('.category-zone'),$('#categorySidebar')],
      onTakeGesture:()=>{for(const r of playlistReorders)r.end(null,false);trackSelection?.clear();hideContextMenu();},
      onBlankPress:hideContextMenu,onChange:()=>{},onMenu:openPlaylistBatchMenu,onFinish:finishReordering});
    I18n.setAttribute($('#categoryChips'),'aria-label',()=>(I18n.t("UIPlaylistsHoldCtrlOrShiftToSelectRight")));
  }

  function positionTrackSubmenu(wrap) {
    const submenu = wrap?.querySelector('.context-submenu');
    const trigger = wrap?.querySelector('[data-submenu-trigger]');
    if (!submenu || !trigger) return;
    for (const other of wrap.parentElement.querySelectorAll('.context-submenu-wrap')) if (other !== wrap) { other.classList.remove('open'); other.dataset.sticky = '0'; other.querySelector('[data-submenu-trigger]')?.setAttribute('aria-expanded', 'false'); }
    wrap.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    submenu.style.visibility = 'hidden';
    submenu.style.left = '0px';
    submenu.style.top = '0px';
    requestAnimationFrame(() => {
      const sr = submenu.getBoundingClientRect();
      const tr = trigger.getBoundingClientRect();
      const gap = 7;
      let left = tr.right + gap;
      if (left + sr.width > innerWidth - 8) left = tr.left - sr.width - gap;
      left = Math.max(8, Math.min(innerWidth - sr.width - 8, left));
      let top = tr.top - 6;
      top = Math.max(8, Math.min(innerHeight - sr.height - 8, top));
      submenu.style.left = `${left}px`;
      submenu.style.top = `${top}px`;
      submenu.style.visibility = 'visible';
    });
  }

  function armTrackSubmenu(menu) {
    menu?.querySelectorAll('.context-submenu-wrap').forEach(wrap => {
      if(wrap.dataset.armed==='1')return;wrap.dataset.armed='1';
      let hideTimer;
      const cancelClose = () => clearTimeout(hideTimer);
      const open = () => { cancelClose(); if(wrap.parentElement.classList.contains('menu-reordering'))return;positionTrackSubmenu(wrap); };
      const closeLater = () => {
        cancelClose();
        if (wrap.dataset.sticky === '1') return;
        hideTimer = setTimeout(() => {
          if (!wrap.matches(':hover') && !wrap.querySelector('.context-submenu')?.matches(':hover')) {
            wrap.classList.remove('open'); wrap.querySelector('[data-submenu-trigger]')?.setAttribute('aria-expanded','false');
          }
        }, 280);
      };
      wrap.addEventListener('pointerenter', open);
      wrap.addEventListener('pointerleave', closeLater);
      wrap.querySelector('.context-submenu')?.addEventListener('pointerenter', cancelClose);
      wrap.querySelector('.context-submenu')?.addEventListener('pointerleave', closeLater);
      wrap.querySelector('[data-submenu-trigger]')?.addEventListener('keydown', event => {
        if (event.key === 'ArrowRight') { event.preventDefault(); open(); requestAnimationFrame(() => wrap.querySelector('.context-submenu button:not(:disabled)')?.focus()); }
      });
    });
  }

  function hideContextMenu() {
    trackTools?.menuClosed();
    const menu = $('#contextMenu');
    menu.classList.add('hidden');
    delete menu.dataset.menuKind;
    delete menu.dataset.trackId;
    delete menu.dataset.trackIds;
  }

  function openConfirmation({ title=I18n.t('ConfirmationTitle'), text='', actionText=I18n.t('ConfirmButton'), icon='undo', danger=false, onConfirm=null } = {}) {
    state.pendingConfirm = typeof onConfirm === 'function' ? onConfirm : null;
    $('#confirmDelete').disabled=false;
    I18n.setOwnedText($('#confirmTitle'),title);
    I18n.setOwnedText($('#confirmText'),text);
    const iconHost = $('#confirmIcon');
    if (iconHost) iconHost.innerHTML = window.Icon(icon, 24);
    const action = $('#confirmDelete');
    I18n.setOwnedText(action,actionText);
    action.classList.toggle('danger', !!danger);
    action.classList.toggle('primary', !danger);
    openModal('confirmModal');
  }

  function cancelConfirmation() {
    state.pendingConfirm = null;
    state.pendingDelete = null;
    closeModal('confirmModal');
  }

  async function runPendingConfirmation() {
    const action = state.pendingConfirm;
    state.pendingConfirm = null;
    if (!action) { closeModal('confirmModal'); return; }
    try { await action(); }
    catch (e) { closeModal('confirmModal'); toast('bad',I18n.t("UICouldNotCompleteTheAction"),I18n.errorMessage(e)||String(e)); }
  }

  function askDelete(track) {
    if(track?.vaultKey){removeChosenTracks([track],track.vaultKey,{erase:true}).catch(e=>toast('bad',I18n.t("UICouldNotDelete"),I18n.errorMessage(e)||String(e)));return;}
    state.pendingDelete = track;
    openConfirmation({
      title:I18n.t("UIDeleteThisTrack"),
      text:I18n.t("UIWillBeMovedToTheWindowsRecycleBin2", {value1:(track.title)}),
      actionText:I18n.t("UIDelete"), icon:'trash', danger:true, onConfirm:deletePending,
    });
  }

  async function deletePending() {
    const t = state.pendingDelete;
    if (!t) { closeModal('confirmModal'); return; }
    closeModal('confirmModal');
    if (state.currentId === t.id) {
      audio.pause();
      releasePlayback('local');
      audio.removeAttribute('src'); audio.load(); state.currentId = null; updatePlayerUI();
    }
    try {
      const removed = await api.library.remove(t.rel);
      if (removed?.settings) Object.assign(state.settings, removed.settings);
      toast('good',I18n.t("UIFileMovedToTheRecycleBin"), t.title);
      await loadLibrary({ quiet:true });
    } catch (e) { toast('bad',I18n.t("UICouldNotDeleteTheFile"), I18n.errorMessage(e)||String(e)); }
    state.pendingDelete = null;
  }

  function openModal(id) {
    hideContextMenu();
    if(id==='onlineModal')searchUI?.openExpanded();
    else if(searchUI?.mode==='floating')searchUI.close();
    const layer = document.getElementById(id);
    if (!layer) return;
    state.modalZ = Math.max(1000, state.modalZ + 10);
    layer.style.zIndex = String(state.modalZ);
    layer.classList.remove('hidden');
    layer.setAttribute('aria-hidden','false');
  }

  function closeModal(id, preserveSearch = false) {
    if(id==='vaultPasswordModal'){$$('[data-secret-field]').forEach(input=>input.value='');$('#vaultPasswordFields').replaceChildren();const resolve=vaultPromptResolve;vaultPromptResolve=null;resolve?.(null);}
    if(id==='categoryStyleModal'){$('#categoryPasswordInput').value='';$('#categoryPasswordConfirm').value='';state.pendingNewTracks=null;}
    if(id==='categoryStyleModal'){state.pendingTrackForNewCategory='';state.pendingTracksForNewCategory=null;}
    const layer = document.getElementById(id);
    if (!layer) return;
    if (id === 'mergeModal' && $('#mergeCancel').disabled && state.mergeDraft) return;
    if (id === 'onlineModal' && !preserveSearch) {stopOnlinePreview();searchUI?.close();}
    if (id === 'mergeModal') state.mergeDraft = null;
    if (id === 'trimModal') {
      const pendingJob = state.trim && state.downloadJobs.get(state.trim.sourceUrl);
      if (pendingJob?.stage === 'trim') { state.downloadJobs.delete(state.trim.sourceUrl); patchDownloadRows(state.trim.sourceUrl); }
      trimPreviewAudio.pause();
      releasePlayback('trim');
      trimPreviewAudio.removeAttribute('src');
      trimPreviewAudio.load();
      state.trim = null;
    }
    if (id === 'categoryStyleModal') { state.categoryDraft = null; state.categoryDraftKey = ''; state.pendingTrackForNewCategory = ''; }
    if (id === 'settingsModal') {
      state.overlayPreviewOpen = false;
      api.overlay.preview(false).catch(() => {});
      if (state.hotkeyRecording) { state.hotkeyRecording = null; api.hotkeys.suspend(false).catch(() => {}); }
    }
    layer.classList.add('hidden');
    layer.setAttribute('aria-hidden','true');
  }

  function closeTopOverlay() {
    if (!$('#confirmModal').classList.contains('hidden')) return cancelConfirmation();
    if (!$('#mergeModal').classList.contains('hidden')) { if (!$('#mergeCancel').disabled) closeModal('mergeModal'); return; }
    if (!$('#colorModal').classList.contains('hidden')) return closeModal('colorModal');
    if (!$('#customIconModal').classList.contains('hidden')) return closeModal('customIconModal');
    if (!$('#categoryStyleModal').classList.contains('hidden')) return closeModal('categoryStyleModal');
    if (!$('#trimModal').classList.contains('hidden')) return closeModal('trimModal');
    if (!$('#settingsModal').classList.contains('hidden')) return closeModal('settingsModal');
    if (!$('#onlineModal').classList.contains('hidden')) return closeModal('onlineModal');
    closeSortPopover();
    hideContextMenu();
    if (state.categoryEditMode) { state.categoryEditMode = false; state.categorySignature = ''; renderCategories(true); }
  }

  function renderOnlineNotice(kind = 'info', text = '') {
    const n = $('#onlineNotice');
    n.className = `notice search-notice ${kind === 'info' ? '' : kind}`;
    const defaultText = state.onlineProvider === 'youtube'
      ? I18n.t("UIYouCanPreviewTheResultFirstOnlyYouTube")
      : state.onlineProvider === 'soundcloud'
        ? I18n.t("UIYouCanPreviewTheResultFirstSoundCloudDownloads")
        : I18n.t("UIYouCanPreviewTheResultBeforeDownloading");
    n.innerHTML = `${window.Icon(kind === 'error' ? 'alert' : 'info',16)}<span></span>`;
    I18n.setOwnedText(n.querySelector('span'),text || defaultText);
  }

  function setProvider(provider) {
    state.onlineProvider = provider || 'ytmusic';
    searchUI?.enable(provider);
    renderOnlineNotice();
  }

  async function doOnlineSearch() {
    searchUI?.setQuery($('#onlineSearchInput').value, true);
  }

  function setOnlinePreviewButton(url, playing, loading = false) {
    $$('[data-online-preview]').forEach((button) => {
      if (button.dataset.onlinePreview !== url) {
        button.classList.remove('playing','loading');
        button.innerHTML = window.Icon('play',15);
        return;
      }
      button.classList.toggle('playing', playing);
      button.classList.toggle('loading', loading);
      button.innerHTML = loading ? '<span class="mini-spinner"></span>' : window.Icon(playing ? 'pause' : 'play',15);
    });
  }

  function updatePreviewMuteButton(){
    const b=$('#onlinePreviewMute');if(!b)return;const muted=audio.muted||audio.volume===0;
    if(b.dataset.muted===String(muted))return;b.dataset.muted=String(muted);b.innerHTML=window.Icon(muted?'volumeX':'volume',17);b.setAttribute('aria-pressed',String(muted));
    I18n.setAttribute(b,'title',()=>I18n.t(muted?'SearchUnmute':'SearchMute'));I18n.setAttribute(b,'aria-label',()=>I18n.t(muted?'SearchUnmute':'SearchMute'));
  }

  function updateOnlinePreviewBar() {
    updatePreviewMuteButton();const p = state.onlinePreview;
    $('#onlinePreviewBar').classList.toggle('hidden', !p);
    if (!p) return;
    I18n.setText($('#onlinePreviewTitle'),()=>(p.title || I18n.t("UIAudioPreview")));
    I18n.setText($('#onlinePreviewArtist'),()=>Library.trackCreator(p));
    $('#onlinePreviewCurrent').textContent = formatTime(onlinePreviewAudio.currentTime || 0);
    $('#onlinePreviewDuration').textContent = formatTime(onlinePreviewAudio.duration || p.duration || 0);
    $('#onlinePreviewToggle').innerHTML = window.Icon(onlinePreviewAudio.paused ? 'play' : 'pause',15);
  }

  function stopOnlinePreview() {
    const old = state.onlinePreview?.sourceUrl;
    onlinePreviewAudio.pause();
    releasePlayback('online');
    onlinePreviewAudio.removeAttribute('src');
    onlinePreviewAudio.load();
    state.onlinePreview = null;
    if (old) setOnlinePreviewButton(old, false);
    $('#onlinePreviewBar').classList.add('hidden');
  }

  async function previewOnline(url) {
    if (!url) return;
    const token = claimPlayback('online');
    if (state.onlinePreview?.sourceUrl === url && onlinePreviewAudio.src) {
      if (onlinePreviewAudio.paused) {
        try { await playClaimed('online', token, onlinePreviewAudio); } catch {}
      } else {
        onlinePreviewAudio.pause();
        releasePlayback('online');
      }
      return;
    }
    const previous = state.onlinePreview?.sourceUrl;
    if (previous) setOnlinePreviewButton(previous, false);
    onlinePreviewAudio.pause();
    setOnlinePreviewButton(url, false, true);
    try {
      const result = await api.online.preview(url);
      if (!playbackClaimIsCurrent('online', token)) {
        setOnlinePreviewButton(url, false);
        return;
      }
      if (!result?.ok) {
        if (result?.code === 'SPOTIFY_NO_DOWNLOAD') renderOnlineNotice('warning', result.message);
        else toast('bad',I18n.t("UICouldNotOpenTheAudioPreview"), result?.message || I18n.t("AppSourceUnavailable"));
        setOnlinePreviewButton(url, false);
        releasePlayback('online');
        return;
      }
      state.onlinePreview = { ...result, sourceUrl:url };
      onlinePreviewAudio.src = result.previewUrl;
      onlinePreviewAudio.load();
      updateOnlinePreviewBar();
      try { await playClaimed('online', token, onlinePreviewAudio); }
      catch (e) { toast('bad',I18n.t("UIAudioPreviewDidNotStart"), I18n.errorMessage(e) || String(e)); }
    } catch (e) {
      setOnlinePreviewButton(url, false);
      releasePlayback('online');
      toast('bad',I18n.t("UICouldNotOpenTheAudioPreview"), I18n.errorMessage(e) || String(e));
    }
  }

  function renderTrimWave(profile = []) {
    const box = $('#trimWave');
    const values = profile.length ? profile : Array.from({ length:72 }, (_, i) => 18 + ((i * 17) % 34));
    box.innerHTML = values.map((v) => `<i style="--h:${Math.max(8, Math.min(100, Number(v) || 12))}%"></i>`).join('');
  }

  function syncTrimUI(source = '') {
    const trim = state.trim;
    if (!trim) return;
    const duration = trim.duration || 0;
    const minGap = Math.min(1, duration / 3 || 0);
    trim.start = Math.max(0, Math.min(Number(trim.start) || 0, Math.max(0, trim.end - minGap)));
    trim.end = Math.max(trim.start + minGap, Math.min(Number(trim.end) || duration, duration));
    $('#trimStart').value = trim.start;
    $('#trimEnd').value = trim.end;
    $('#trimStartValue').textContent = formatTime(trim.start);
    $('#trimEndValue').textContent = formatTime(trim.end);
    setRangeFill($('#trimStart'), duration ? trim.start / duration * 100 : 0);
    setRangeFill($('#trimEnd'), duration ? trim.end / duration * 100 : 100);
    const left = duration ? trim.start / duration * 100 : 0;
    const right = duration ? trim.end / duration * 100 : 100;
    $('#trimWave').style.setProperty('--trim-start', `${left}%`);
    $('#trimWave').style.setProperty('--trim-end', `${right}%`);
    $('#trimSeek').max = duration || 100;
    $('#trimPreviewTotal').textContent = formatTime(duration);
    const cutStart = trim.start > .2;
    const cutEnd = duration && trim.end < duration - .2;
    const selected = Math.max(0, trim.end - trim.start);
    I18n.setText($('#trimSummary'),()=>(cutStart || cutEnd
      ? I18n.t("UIResultRemoveAtTheStart", {value1:(formatTime(selected)),value2:(formatTime(trim.start)),value3:(cutEnd ? I18n.msg("UIAndAtTheEnd", {value1:(formatTime(duration - trim.end))}) : '')})
      : I18n.t("UIEntireTrackWillBeDownloaded")));
    if (source === 'start' && trimPreviewAudio.src) trimPreviewAudio.currentTime = trim.start;
    if (source === 'end' && trimPreviewAudio.src && trim.end > 1) trimPreviewAudio.currentTime = Math.max(trim.start, trim.end - 1);
    syncTrimTransport();
  }

  function syncTrimTransport() {
    const duration = state.trim?.duration || Number(trimPreviewAudio.duration) || 0;
    const current = Math.max(0, Math.min(Number(trimPreviewAudio.currentTime) || 0, duration || Infinity));
    const seek = $('#trimSeek');
    if (seek) {
      seek.max = duration || 100;
      seek.value = Math.min(current, Number(seek.max) || 100);
      setRangeFill(seek, duration ? current / duration * 100 : 0);
    }
    $('#trimTimeline')?.style.setProperty('--playhead', `${duration ? current / duration * 100 : 0}%`);
    if ($('#trimPreviewCurrent')) $('#trimPreviewCurrent').textContent = formatTime(current);
    if ($('#trimPreviewTotal')) $('#trimPreviewTotal').textContent = formatTime(duration);
    const button = $('#trimPreviewToggle');
    if (button) {
      button.innerHTML = window.Icon(trimPreviewAudio.paused ? 'play' : 'pause',16);
      I18n.setAttribute(button,"title",()=>(trimPreviewAudio.paused ? I18n.t("UIPlay2") : I18n.t("PlayerOverlayPause")));
      I18n.setAttribute(button,'aria-label',()=>button.title);
    }
  }

  function applyAutoTrim() {
    if (!state.trim?.suggestion) return;
    state.trim.start = state.trim.suggestion.start;
    state.trim.end = state.trim.suggestion.end;
    syncTrimUI();
    $('#autoTrimCard').classList.add('applied');
    setTimeout(() => $('#autoTrimCard').classList.remove('applied'), 420);
  }

  async function prepareDownload(url, options = {}) {
    if (!url) return;
    url = downloadKey(url);
    const existing = state.downloadJobs.get(url);
    if (activeDownloadStages.has(existing?.stage)) return;
    if (existing?.stage === 'done' && !options.forceTrimModal) return;
    if (existing?.stage === 'done' && options.forceTrimModal) state.downloadJobs.delete(url);
    if (existing?.stage === 'trim' && state.trim?.sourceUrl === url) { openModal('trimModal'); return; }
    const job = createDownloadJob(url);
    const epoch = ++state.prepareEpoch;
    const prepareToastId = `prepare-${job.jobId}`;
    stopOnlinePreview();
    toast('info',I18n.t("UIPreparingTheTrack"),I18n.t("UIGettingTheStreamCoverAndDuration"),0,prepareToastId);
    try {
      const prepared = await api.online.preview(url);
      document.querySelector(`.toast[data-toast-id="${CSS.escape(prepareToastId)}"]`)?.remove();
      if (!prepared?.ok) {
        Object.assign(job, { stage:'error', message:prepared?.message || I18n.t("AppSourceUnavailable") }); patchDownloadRows(url);
        if (prepared?.code === 'SPOTIFY_NO_DOWNLOAD') {
          renderOnlineNotice('warning', prepared.message);
          toast('info',I18n.t("UISpotifyOfficialAccess"), I18n.t("UIDirectAudioExtractionIsDisabled"), 3600);
        } else toast('bad',I18n.t("UICouldNotPrepare"), prepared?.message || I18n.t("AppSourceUnavailable"));
        return;
      }
      if (!prepared.canTrim || prepared.provider !== 'youtube') {
        await downloadOnline(url);
        return;
      }
      if (!options.forceTrimModal && (epoch !== state.prepareEpoch || (!searchUI?.isOpen() && $('#onlineModal').classList.contains('hidden')))) { state.downloadJobs.delete(url); patchDownloadRows(url); await downloadOnline(url); return; }
      if (state.trim) closeModal('trimModal');
      Object.assign(job, { stage:'trim', percent:null }); patchDownloadRows(url);
      const duration = Math.max(0, Number(prepared.duration) || 0);
      state.trim = { sourceUrl:url, prepared, duration, start:0, end:duration, suggestion:null, analyzing:true };
      I18n.setText($('#trimTrackTitle'),()=>(prepared.title || I18n.t("AppUntitled")));
      I18n.setText($('#trimTrackArtist'),()=>(prepared.artist || I18n.t("AppUnknownCreator")));
      I18n.setText($('#trimTrackDuration'),()=>(duration ? formatTime(duration) : I18n.t("UIDurationUnknown")));
      const cover = safeUrl(prepared.coverUrl);
      $('#trimCover').classList.toggle('placeholder', !cover);
      $('#trimCover').innerHTML = `${coverFallbackMarkup()}${cover ? window.PulseCoverMedia.markup(cover,prepared.coverType) : ''}`;
      $('#trimStart').max = duration || 100;
      $('#trimEnd').max = duration || 100;
      $('#trimStart').disabled = !duration;
      $('#trimEnd').disabled = !duration;
      $('#applyAutoTrim').disabled = true;
      I18n.setText($('#autoTrimText'),()=>(duration ? I18n.t("UIAnalysingMusicalActivityAtTheEdges") : I18n.t("UIDurationIsUnknownDownloadManuallyWithoutTrimming")));
      I18n.setText($('#autoTrimMethod'),()=>(I18n.t("UIDoubleClickToApplyTheSuggestedBoundaries")));
      renderTrimWave([]);
      syncTrimUI();
      trimPreviewAudio.src = prepared.previewUrl;
      trimPreviewAudio.load();
      claimPlayback('trim');
      openModal('trimModal');
      if (duration >= 8) {
        const result = await api.online.analyze(prepared.previewId, duration);
        if (!state.trim || state.trim.sourceUrl !== url) return;
        state.trim.analyzing = false;
        if (result?.ok) {
          state.trim.suggestion = { start:Number(result.start)||0, end:Number(result.end)||duration };
          const startCut = state.trim.suggestion.start;
          const endCut = Math.max(0, duration - state.trim.suggestion.end);
          I18n.setText($('#autoTrimText'),()=>(startCut > .2 || endCut > .2
            ? I18n.t("UISuggestedTrimAtTheStart", {value1:(formatTime(startCut)),value2:(endCut > .2 ? I18n.msg("UIAndAtTheEnd", {value1:(formatTime(endCut))}) : '')})
            : I18n.t("UINoClearIntroOrEndingDetectedTheEntire")));
          I18n.setText($('#autoTrimMethod'),()=>(I18n.t("UIDoubleClickToApply", {value1:(result.method || I18n.msg("UIConservativeSuggestion"))})));
          $('#applyAutoTrim').disabled = false;
          renderTrimWave(result.profile || []);
          syncTrimUI();
        } else {
          I18n.setText($('#autoTrimText'),()=>(I18n.t("UIAutomaticAnalysisFailedManualTrimmingIsFullyAvailable")));
          I18n.setText($('#autoTrimMethod'),()=>(result?.message || I18n.t("UIYouCanSetTheBoundariesYourself")));
        }
      }
    } catch (e) {
      document.querySelector(`.toast[data-toast-id="${CSS.escape(prepareToastId)}"]`)?.remove();
      Object.assign(job, { stage:'error', message:I18n.errorMessage(e) || String(e) }); patchDownloadRows(url);
      toast('bad',I18n.t("UICouldNotPrepareTheTrack"), I18n.errorMessage(e) || String(e), 5200);
    }
  }

  async function downloadOnline(url, options = {}) {
    if (!url) return;
    url = downloadKey(url);
    let job = state.downloadJobs.get(url);
    if (job && ['metadata','download','postprocess','verify','done'].includes(job.stage)) return;
    if (!job || job.stage === 'error') job = createDownloadJob(url, 'metadata');
    Object.assign(job, { stage:'metadata', percent:null }); patchDownloadRows(url);
    try {
      const result = await api.online.download(url, { ...options, jobId:job.jobId });
      if (result?.ok) {
        acceptDownloadProgress({ jobId:job.jobId, url, stage:'done', percent:100, text:I18n.t("AppDoneTheTrackWasAddedToYourLibrary"), file:result.rel });
        await loadLibrary({ quiet:true });
        const downloadedTrack = state.tracks.find((track) => track.rel === result.rel) || state.tracks.find((track) => downloadKey(track.sourceUrl || '') === url);
        if (downloadedTrack && !options.start && !options.end) openClickableTrimToast(downloadedTrack);
      } else {
        acceptDownloadProgress({ jobId:job.jobId, url, stage:'error', percent:null, message:result?.message || I18n.t("UIDownloaderDidNotConfirmACompletedFile") });
      }
    } catch (error) {
      acceptDownloadProgress({ jobId:job.jobId, url, stage:'error', percent:null, message:I18n.errorMessage(error) || String(error) });
    }
  }

  async function probeDurations() {
    if (state.probing) return;
    const queue = state.tracks.filter((t) => !t.duration).slice(0, 120);
    if (!queue.length) return;
    state.probing = true;
    const probe = new Audio();
    probe.preload = 'metadata';
    let changed = 0;
    for (const t of queue) {
      try {
        const d = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(0), 3500);
          const done = (value) => { clearTimeout(timer); probe.onloadedmetadata = null; probe.onerror = null; resolve(value); };
          probe.onloadedmetadata = () => done(Number.isFinite(probe.duration) ? probe.duration : 0);
          probe.onerror = () => done(0);
          probe.src = t.audioUrl;
          probe.load();
        });
        if (d > 0) { t.duration = d; changed++; patchDuration(t); }
      } catch {}
    }
    probe.removeAttribute('src');
    state.probing = false;
    if (changed) updateMeta();
  }

  function updateSortControl() {
    const manuallyOrdered = state.settings.sort === 'manual';
    $('#sortTrigger').classList.toggle('has-manual-order', manuallyOrdered);
    I18n.setAttribute($('#sortTrigger'),"title",()=>(manuallyOrdered ? I18n.t("UICustomOrderForThisPlaylistDragTracksCtrl") : I18n.t("UISortingDragTracksCtrlZUndoesTheMove")));
    I18n.setText($('#sortLabel'),()=>(sortLabels()[state.settings.sort] || sortLabels().recent));
    $$('#sortPopover [data-sort]').forEach((button) => {
      const active = button.dataset.sort === state.settings.sort;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
  }

  function openSortPopover() {
    $('#sortPopover').classList.remove('hidden');
    $('#sortTrigger').setAttribute('aria-expanded','true');
  }

  function closeSortPopover() {
    $('#sortPopover').classList.add('hidden');
    $('#sortTrigger').setAttribute('aria-expanded','false');
  }

  function toggleSortPopover() {
    if ($('#sortPopover').classList.contains('hidden')) openSortPopover(); else closeSortPopover();
  }

  async function setSort(sort) {
    if (!sortLabels()[sort]) return;
    trackReorder?.cancel();
    if (sort === 'manual' && !state.settings.trackOrders?.[state.category]?.manual?.length) {
      const initial = Library.view(state.tracks, state.settings, state.category, state.settings.sort).map(t => t.rel);
      await persistTrackOrder(state.category, 'manual', initial);
    }
    state.settings.sort = sort;
    updateSortControl();
    closeSortPopover();
    renderLibraryBody();
    await api.settings.set({ sort }).catch(() => {});
    ensureLoudness();
  }

  async function setView(view) {
    if (state.settings.view === view) return;
    state.settings.view = view;
    renderLibraryBody();
    await api.settings.set({ view }).catch(() => {});
  }

  let volumeTimer;
  function setVolume(value, persist = false) {
    const v = Math.max(0, Math.min(1, value));
    audio.volume = v;
    onlinePreviewAudio.volume = v;onlinePreviewAudio.muted=audio.muted;updatePreviewMuteButton();
    if (v > 0) state.lastVolume = v;
    $('#volume').value = Math.round(v * 100);
    setRangeFill($('#volume'), v * 100);
    $('#muteBtn').innerHTML = window.Icon(v === 0 ? 'volumeX' : 'volume',17);
    if (persist) {
      state.settings.volume = v;
      clearTimeout(volumeTimer);
      volumeTimer = setTimeout(() => api.settings.set({ volume:v }).catch(() => {}),250);
    }
  }

  function toggleMute() {
    if(audio.muted){audio.muted=false;setVolume(audio.volume||state.lastVolume||.82,true);return;}
    if (audio.volume > 0) { state.lastVolume = audio.volume; setVolume(0,true); }
    else setVolume(state.lastVolume || .82,true);
  }

  function updateMaxIcon(maximized) { $('#maxBtn').innerHTML = window.Icon(maximized ? 'restore' : 'maximize',16); }

  function toggleShuffleMode() { state.shuffle = !state.shuffle; updatePlayerUI(); }

  function cycleRepeatMode() {
    state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
    updatePlayerUI();
  }

  function focusSearchInput() {
    if (lyricsView?.opened) lyricsView.close();
    const input = $('#searchInput');
    if (!input) return;
    input.focus();
    input.select?.();
  }

  function openOnlineImportModal() {
    closeModal('settingsModal');
    openModal('onlineModal');
    setTimeout(() => $('#onlineSearchInput')?.focus(), 40);
  }

  function canTrimTrack(track) {
    const provider = String(track?.sourceProvider || '').toLowerCase();
    const url = String(track?.sourceUrl || '');
    return provider === 'youtube' && /youtu(?:\.be|be\.com)/i.test(url);
  }

  function openClickableTrimToast(track) {
    if (!canTrimTrack(track)) return;
    const node = toast('good', I18n.t('UIDownloaded'), I18n.t('UIClickTheNotificationToOpenTheTrimEditor'), 7200);
    node.classList.add('clickable-toast');
    node.addEventListener('click', () => { openTrimForTrack(track); try { node.remove(); } catch {} }, { once:true });
  }

  async function openTrimForTrack(track) {
    if (!canTrimTrack(track)) {
      toast('bad', I18n.t('UITrimIsAvailableForYouTubeTracks'), I18n.t('UIThisTrackDoesNotHaveASavedYouTubeSource'), 4200);
      return;
    }
    await prepareDownload(track.sourceUrl, { forceTrimModal:true });
  }

  function getDefaultCustomIconDraft() {
    return {
      bg:[{ color:'#38d6b3', pos:0 }, { color:'#42b5e4', pos:33 }, { color:'#5f79ff', pos:67 }, { color:'#ab68ed', pos:100 }],
      fg:[{ color:'#ffffff', pos:0 }],
    };
  }

  function buildGradientString(stops) {
    return (Array.isArray(stops) ? stops : []).map((stop) => `${stop.color} ${clamp(Number(stop.pos), 0, 100)}%`).join(', ');
  }

  function buildCustomIconSvg(draft = getDefaultCustomIconDraft()) {
    return window.PulseAppIcon.build(draft);
  }

  function renderCustomIconPreview() {
    const preview = $('#customIconPreview');
    if (!preview || !state.customIconDraft) return;
    preview.innerHTML = buildCustomIconSvg(state.customIconDraft);
  }

  function renderCustomIconStops(kind) {
    const list = $(kind === 'bg' ? '#customBgStops' : '#customFgStops');
    const stops = state.customIconDraft?.[kind] || [];
    if (!list) return;
    list.innerHTML = stops.map((stop, index) => `
      <div class="custom-stop-row" data-custom-stop-row="${kind}:${index}">
        <input data-custom-stop-color="${kind}:${index}" type="color" value="${esc(stop.color)}" aria-label="${esc(I18n.t('UIColour'))}">
        <input data-custom-stop-pos="${kind}:${index}" type="range" min="0" max="100" step="1" value="${clamp(Number(stop.pos),0,100)}" style="--value:${clamp(Number(stop.pos),0,100)}%" aria-label="${I18n.h('CustomIconStopPosition',{value1:index+1})}">
        <output>${Math.round(clamp(Number(stop.pos),0,100))}%</output>
        <button class="icon-button" data-custom-stop-remove="${kind}:${index}" ${stops.length <= (kind === 'bg' ? 2 : 1) ? 'disabled' : ''} title="${esc(I18n.t('UIRemove'))}">${window.Icon('trash', 16)}</button>
      </div>
    `).join('');
  }

  function renderCustomIconEditor() {
    renderCustomIconStops('bg');
    renderCustomIconStops('fg');
    renderCustomIconPreview();
    $('#addBgStopBtn').disabled = (state.customIconDraft?.bg?.length || 0) >= 7;
    $('#addFgStopBtn').disabled = (state.customIconDraft?.fg?.length || 0) >= 4;
  }

  function openCustomIconDesigner() {
    state.customIconDraft = JSON.parse(JSON.stringify(state.settings.customIconStyle || getDefaultCustomIconDraft()));
    renderCustomIconEditor();
    openModal('customIconModal');
  }

  async function rasterizeCustomIcon(draft) {
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildCustomIconSvg(draft))}`;
    await image.decode();
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
    canvas.getContext('2d').drawImage(image,0,0,256,256);
    return api.appearance.saveGeneratedIcon('custom-gradient',canvas.toDataURL('image/png'));
  }

  async function migrateCustomIconMark() {
    if(!String(state.settings.appIcon).startsWith('custom-icons/')||!state.settings.customIconStyle||state.settings.appIconMarkVersion>=window.PulseAppIcon.version)return;
    try {
      const saved=await rasterizeCustomIcon(state.settings.customIconStyle);
      const patch={appIcon:saved.ref,appIconMarkVersion:window.PulseAppIcon.version};
      await api.settings.set(patch);Object.assign(state.settings,patch);
    } catch(error) { toast('bad',I18n.t('CustomIconMigrationFailed'),I18n.errorMessage(error)); }
  }

  async function saveCustomIcon() {
    if (!state.customIconDraft || $('#customIconSave').disabled) return;
    $('#customIconSave').disabled = true;
    try {
      const draft = JSON.parse(JSON.stringify(state.customIconDraft));
      const saved = await rasterizeCustomIcon(draft);
      await api.settings.set({ appIcon:saved.ref, customIconStyle:draft, appIconMarkVersion:window.PulseAppIcon.version });
      state.settings.appIconMarkVersion=window.PulseAppIcon.version;
      state.settings.appIcon = saved.ref;
      state.settings.customIconStyle = draft;
      applyAppearance();
      await applyAppIconPreview();
      closeModal('customIconModal');
      toast('good', I18n.t('UIApplicationIconUpdated'), I18n.t('UICustomIconSavedAndApplied'), 3200);
    } catch (error) {
      toast('bad', I18n.t('AppCouldNotCreateAWindowsIcon'), I18n.errorMessage(error));
    } finally { $('#customIconSave').disabled = false; }
  }

  async function persistSurfaceSettings() {
    await api.settings.set({
      ...Surface.normalize(state.settings),
    }).catch(error=>toast('bad',I18n.t('SurfaceSaveFailed'),I18n.errorMessage(error)));
  }

  function setupMediaSessionActions() {
    if (!('mediaSession' in navigator)) return;
    const actions = {
      play: () => { if (audio.paused) togglePlay(); },
      pause: () => { audio.pause(); releasePlayback('local'); },
      previoustrack: prevTrack, nexttrack: () => nextTrack(false),
      seekto: (details) => { if (typeof details.seekTime === 'number') audio.currentTime = details.seekTime; },
      seekbackward: (details) => { audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10)); },
      seekforward: (details) => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (details.seekOffset || 10)); },
    };
    for (const [name, handler] of Object.entries(actions)) { try { navigator.mediaSession.setActionHandler(name, handler); } catch {} }
  }

  function openRgbModal(initialHex = '', target = { type:'accent' }) {
    const hex = /^#[0-9a-f]{6}$/i.test(initialHex) ? initialHex : (state.settings.customAccent || accentValues[state.settings.accent] || '#b038ae');
    const rgb = hexToRgb(hex);
    const hsv = rgbToHsv(rgb.r,rgb.g,rgb.b);
    state.rgbDraft = { ...rgb };
    state.colorDraft = { ...hsv, model:'rgb' };
    state.colorTarget = target || { type:'accent' };
    syncRgbControls();
    openModal('colorModal');
  }

  function syncRgbControls() {
    const rgb = hsvToRgb(state.colorDraft.h, state.colorDraft.s, state.colorDraft.v);
    state.rgbDraft = rgb;
    const hex = rgbToHex(rgb.r,rgb.g,rgb.b);
    $('#colorHexInput').value = hex.toUpperCase();
    $('#colorHue').value = Math.round(state.colorDraft.h);
    $('#colorPlane').style.setProperty('--hue-color', `hsl(${state.colorDraft.h} 100% 50%)`);
    $('#colorPlaneCursor').style.left = `${state.colorDraft.s}%`;
    $('#colorPlaneCursor').style.top = `${100-state.colorDraft.v}%`;
    $('#colorPlaneCursor').style.setProperty('--cursor-color', hex);
    $('#colorSwatch').style.setProperty('--swatch', hex);
    $('#rgbRNumber').value = rgb.r; $('#rgbGNumber').value = rgb.g; $('#rgbBNumber').value = rgb.b;
    const hsl = rgbToHsl(rgb.r,rgb.g,rgb.b);
    $('#hslHNumber').value = Math.round(hsl.h); $('#hslSNumber').value = Math.round(hsl.s); $('#hslLNumber').value = Math.round(hsl.l);
    $$('.color-tabs [data-color-model]').forEach((b) => b.classList.toggle('active', b.dataset.colorModel === state.colorDraft.model));
    $('#rgbFields').classList.toggle('hidden', state.colorDraft.model !== 'rgb');
    $('#hslFields').classList.toggle('hidden', state.colorDraft.model !== 'hsl');
  }

  function updateRgb(channel, value) {
    const rgb = { ...state.rgbDraft, [channel.toLowerCase()]:clamp(value,0,255) };
    const hsv = rgbToHsv(rgb.r,rgb.g,rgb.b);
    state.colorDraft = { ...state.colorDraft, ...hsv };
    syncRgbControls();
  }

  function updateHsl(channel, value) {
    const current = rgbToHsl(state.rgbDraft.r,state.rgbDraft.g,state.rgbDraft.b);
    current[channel.toLowerCase()] = channel === 'H' ? clamp(value,0,360) : clamp(value,0,100);
    const rgb = hslToRgb(current.h,current.s,current.l);
    const hsv = rgbToHsv(rgb.r,rgb.g,rgb.b);
    state.colorDraft = { ...state.colorDraft, ...hsv };
    syncRgbControls();
  }

  function updateColorFromHex(raw) {
    const value = String(raw || '').trim();
    const hex = value.startsWith('#') ? value : `#${value}`;
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return false;
    const rgb = hexToRgb(hex); const hsv = rgbToHsv(rgb.r,rgb.g,rgb.b);
    state.colorDraft = { ...state.colorDraft, ...hsv };
    syncRgbControls();
    return true;
  }

  function updateColorPlaneFromPointer(e) {
    const box = $('#colorPlane').getBoundingClientRect();
    state.colorDraft.s = clamp((e.clientX-box.left)/box.width*100,0,100);
    state.colorDraft.v = clamp(100-(e.clientY-box.top)/box.height*100,0,100);
    syncRgbControls();
  }

  async function applyColorPicker() {
    const hex = rgbToHex(state.rgbDraft.r,state.rgbDraft.g,state.rgbDraft.b);
    const target = state.colorTarget || { type:'accent' };
    if (target.type === 'accent') {
      state.settings.customAccent = hex; state.settings.accent = 'custom';
      applyAppearance();
      await api.settings.set({ accent:'custom', customAccent:hex });
    } else if (target.type === 'surface-border') {
      Object.assign(state.settings,Surface.update(state.settings,target.surfaceGroup||surfaceTarget,{surfaceBorderColor:hex}));applyAppearance();await persistSurfaceSettings();
    } else if (target.type === 'category' && state.categoryDraft) {
      state.categoryDraft.color = hex;
      if (!state.categoryDraft.gradient?.length) state.categoryDraft.gradient = [hex];
      else if (state.categoryDraft.gradient.length === 1) state.categoryDraft.gradient[0] = hex;
      renderCategoryEditor();
    } else if (target.type === 'gradient' && state.categoryDraft) {
      const i = clamp(target.index,0,Math.max(0,state.categoryDraft.gradient.length-1));
      state.categoryDraft.gradient[i] = hex;
      renderCategoryEditor();
    } else if (target.type === 'gradient-add' && state.categoryDraft && state.categoryDraft.gradient.length < 4) {
      state.categoryDraft.gradient.push(hex); renderCategoryEditor();
    } else if (target.type === 'overlay' && target.key) {
      state.settings.playerOverlay[target.key] = hex;
      renderOverlaySettings();
      await persistOverlaySettings(true);
    }
    closeModal('colorModal');
  }

  function setSettingsPage(page = 'appearance') {
    const valid = ['presets','appearance','player','games','hotkeys','library','language','about','updates'];
    if (page === 'language') refreshLanguages().catch(()=>{});
    if (page === 'presets')presetsUI?.load();
    state.settingsPage = valid.includes(page) ? page : 'appearance';
    $$('.settings-nav-item, #settingsAbout').forEach((b) => b.classList.toggle('active', b.dataset.settingsPage === state.settingsPage));
    $$('.settings-page').forEach((panel) => panel.classList.toggle('active', panel.dataset.settingsPanel === state.settingsPage));
    const shouldPreview = state.settingsPage === 'player' && !$('#settingsModal').classList.contains('hidden');
    state.overlayPreviewOpen = shouldPreview;
    api.overlay.preview(shouldPreview).catch(() => {});
    if (shouldPreview) {
      syncOverlayState(true);
      ensureAudioAnalyser();
    }
    if (state.settingsPage === 'games') {
      renderGameOverlaySettings();
      api.gameOverlay.status().then((status)=>{ state.gameOverlayStatus = status || state.gameOverlayStatus; renderGameOverlaySettings(); }).catch(()=>{});
    }
  }

  function gameOverlayStatusTone(status = state.gameOverlayStatus || {}) {
    if (status.supported === false) return 'bad';
    if (status.active) return 'active';
    if (status.running) return 'warn';
    return '';
  }

  function renderGameOverlaySettings() {
    const c = { ...gameOverlayDefaults, ...(state.settings.gameOverlay || {}) };
    if (c.mode === 'native') c.mode = 'auto';
    state.settings.gameOverlay = c;
    $$('#gameOverlayMode [data-game-overlay-mode]').forEach((b)=>b.classList.toggle('active', b.dataset.gameOverlayMode === c.mode));
    if ($('#gameOverlayOnlyFullscreen')) $('#gameOverlayOnlyFullscreen').checked = c.onlyFullscreen !== false;
    if ($('#gameOverlayAllowlistOnly')) $('#gameOverlayAllowlistOnly').checked = !!c.allowlistOnly;
    if ($('#gameOverlayRtssVisualizer')) $('#gameOverlayRtssVisualizer').checked = c.rtssVisualizer !== false;
    $$('#gameOverlayRtssAnchor [data-rtss-anchor]').forEach((b)=>b.classList.toggle('active', b.dataset.rtssAnchor === c.rtssAnchor));
    if ($('#gameOverlayRtssOffsetX')) $('#gameOverlayRtssOffsetX').value = String(c.rtssOffsetX ?? 24);
    if ($('#gameOverlayRtssOffsetY')) $('#gameOverlayRtssOffsetY').value = String(c.rtssOffsetY ?? 24);

    const st = state.gameOverlayStatus || {};
    const rtss = st.rtss || {};
    const tone = gameOverlayStatusTone(st);
    const pill = $('#gameOverlayHeaderStatus');
    if (pill) {
      pill.classList.remove('active','warn','bad'); if (tone) pill.classList.add(tone);
      const text = pill.querySelector('span');
      if (text) I18n.setText(text,()=>(st.active && st.renderer === 'rtss' ? I18n.t("UIRTSSInGame") : st.active ? I18n.t("UIFallbackActive") : rtss.running ? I18n.t("UIRTSSReady") : st.running ? I18n.t("UIModuleReady") : st.supported === false ? I18n.t("UIUnavailable") : I18n.t("UIStopped")));
    }
    const liveDot = $('#gameOverlayLiveDot'); if (liveDot) { liveDot.classList.remove('active','warn','bad'); if (tone) liveDot.classList.add(tone); }
    const fg = st.foreground || null;
    let liveTitle = I18n.t("UIGameLayerInactive");
    if (st.active && st.renderer === 'rtss') liveTitle = I18n.t("UIRTSSIsRenderingPulseDeckInsideTheGame");
    else if (st.active && st.renderer === 'window-fallback') liveTitle = I18n.t("UIWindowFallbackActive");
    else if (st.active && st.renderer === 'window') liveTitle = I18n.t("UIRegularPlayerActive");
    else if (rtss.running) liveTitle = rtss.hooked ? I18n.t("UIRTSSIsConnectedToTheGameProcess") : I18n.t("UIRTSSIsRunningWaitingForTheGameHook");
    else if (st.running) liveTitle = I18n.t("UIGameModuleRunning");
    if ($('#gameOverlayLiveTitle')) $('#gameOverlayLiveTitle').textContent = liveTitle;
    if ($('#gameOverlayLiveReason')) I18n.setText($('#gameOverlayLiveReason'),()=>(st.reason || I18n.t("UIWaitingForStatus")));
    if ($('#gameOverlayProcess')) $('#gameOverlayProcess').textContent = fg?.process || '-';
    if ($('#gameOverlayWindowTitle')) $('#gameOverlayWindowTitle').textContent = fg?.title || '-';
    if ($('#gameOverlayFullscreenState')) I18n.setText($('#gameOverlayFullscreenState'),()=>(fg ? (fg.fullscreen ? I18n.t("UIFullScreen") : I18n.t("UIWindow")) : '-'));

    const rendererLabel = { rtss:I18n.t('RTSSRendererName'), 'window-fallback':I18n.t("UIWindowFallback"), window:I18n.t("UIWindowsWindow"), none:'-' }[st.renderer] || st.renderer || '-';
    if ($('#gameOverlayRenderer')) $('#gameOverlayRenderer').textContent = rendererLabel;
    if ($('#gameOverlayRtssStatus')) I18n.setText($('#gameOverlayRtssStatus'),()=>(!rtss.running ? I18n.t("UINotFound") : rtss.hooked ? I18n.t("UIConnectedV", {value1:(rtss.version || '?')}) : I18n.t("UIRunningV", {value1:(rtss.version || '?')})));
    if ($('#gameOverlayRtssApi')) $('#gameOverlayRtssApi').textContent = rtss.api || '-';
    const renderRes = rtss.renderWidth && rtss.renderHeight ? `${rtss.renderWidth}×${rtss.renderHeight}` : '';
    const outputRes = rtss.outputWidth && rtss.outputHeight ? `${rtss.outputWidth}×${rtss.outputHeight}` : '';
    if ($('#gameOverlayRtssResolution')) $('#gameOverlayRtssResolution').textContent = renderRes && outputRes ? `${renderRes} → ${outputRes}` : renderRes || outputRes || '-';
    const stretch = $('#gameOverlayStretchState');
    if (stretch) {
      const visible = !!rtss.stretched;
      stretch.classList.toggle('hidden', !visible);
      I18n.setText(stretch,()=>(visible ? I18n.t("UIFrameStretchingDetectedXPulseDeckDoesNotStretch", {value1:(renderRes || I18n.msg('RenderSurface')),value2:(outputRes || I18n.msg('MonitorSurface')),value3:(Number(rtss.aspectScaleX || 1).toFixed(3))}) : ''));
    }

    const allowed = new Set((Array.isArray(c.allowedGames) ? c.allowedGames : []).map((x)=>String(x).toLowerCase()));
    const list = $('#gameOverlayDetectedList');
    const candidates = Array.isArray(st.candidates) ? st.candidates : [];
    if (list) {
      list.innerHTML = candidates.length ? candidates.map((item)=>{
        const proc = String(item.process || '').toLowerCase();
        const isAllowed = allowed.has(proc);
        return `<div class="game-overlay-detected-item" data-game-process="${esc(proc)}"><div class="game-overlay-detected-icon">${window.Icon('gamepad',15)}</div><div class="game-overlay-detected-copy"><b>${esc(item.title || item.process || I18n.t("UIApplication"))}</b><small>${esc(item.process || I18n.t('UnknownProcess'))}</small><div class="game-overlay-detected-tags">${item.foreground?`<i data-i18n="UIFocused">${I18n.h("UIFocused")}</i>`:''}${item.fullscreen?`<i data-i18n="UIFullScreen2">${I18n.h("UIFullScreen2")}</i>`:`<i data-i18n="UIWindow">${I18n.h("UIWindow")}</i>`}${rtss.hooked && fg?.pid===item.pid?`<i data-i18n="UIRTSSConnected">${I18n.h("UIRTSSConnected")}</i>`:''}</div></div><button class="button secondary small" data-game-allow="${esc(proc)}">${isAllowed?I18n.h("UIRemove"):I18n.h("UIAllow")}</button></div>`;
      }).join('') : `<div class="game-overlay-empty" data-i18n="UINothingDetectedYetOpenAGameOrFull">${I18n.h("UINothingDetectedYetOpenAGameOrFull")}</div>`;
    }
    const allow = $('#gameOverlayAllowlist');
    if (allow) allow.innerHTML = allowed.size ? [...allowed].map((proc)=>`<span class="game-overlay-allow-chip"><span>${esc(proc)}</span><button data-game-remove="${esc(proc)}" title="${I18n.h("UIRemove")}" data-i18n-title="UIRemove">${window.Icon('close',10)}</button></span>`).join('') : `<span class="game-overlay-empty-inline" data-i18n="UIListIsEmpty">${I18n.h("UIListIsEmpty")}</span>`;
  }

  let gameOverlayPersistTimer = 0;
  async function persistGameOverlaySettings(immediate = true) {
    clearTimeout(gameOverlayPersistTimer);
    const run = async () => {
      try {
        const result = await api.gameOverlay.configure({ ...gameOverlayDefaults, ...(state.settings.gameOverlay || {}) });
        if (result?.settings) state.settings.gameOverlay = { ...gameOverlayDefaults, ...result.settings };
        if (result?.status) state.gameOverlayStatus = { ...state.gameOverlayStatus, ...result.status };
        renderGameOverlaySettings();
      } catch (e) { toast('bad',I18n.t("UICouldNotSaveGameOverlaySettings"),I18n.errorMessage(e)||String(e)); }
    };
    if (immediate) await run(); else gameOverlayPersistTimer = setTimeout(run, 100);
  }

  function renderOverlaySettings() {
    const c = state.settings.playerOverlay || {};
    $$('#overlayMode [data-overlay-mode]').forEach((b)=>b.classList.toggle('active',b.dataset.overlayMode===c.mode));
    $('#overlayDuration').value = c.duration ?? 3.2; I18n.setText($('#overlayDurationValue'),()=>(I18n.t("UIS", {value1:(Number(c.duration ?? 3.2).toFixed(1))}))); setRangeFill($('#overlayDuration'), ((Number(c.duration ?? 3.2)-1)/11)*100);
    $('#overlayNotifyAutoNext').checked = !!c.notifyAutoNext;
    $('#overlayClickThroughMinimized').checked = !!c.clickThroughWhenMinimized;
    $('#overlayFullscreenTopmost').checked = c.fullscreenTopmost !== false;
    $('#overlayBackgroundVisible').checked = c.backgroundVisible !== false;
    $('#overlayBorderVisible').checked = c.borderVisible !== false;
    $('#overlayOpacity').value = c.opacity ?? 94; $('#overlayOpacityValue').textContent = `${Math.round(c.opacity ?? 94)}%`; setRangeFill($('#overlayOpacity'), c.opacity ?? 94);
    $('#overlayCornerRadius').value = c.cornerRadius ?? 18; $('#overlayCornerRadiusValue').textContent = `${Math.round(c.cornerRadius ?? 18)} px`; setRangeFill($('#overlayCornerRadius'), (Number(c.cornerRadius ?? 18)/38)*100);
    $('#overlayBackgroundBlur').value = c.backgroundBlur ?? 18; $('#overlayBackgroundBlurValue').textContent = `${Math.round(c.backgroundBlur ?? 18)} px`; setRangeFill($('#overlayBackgroundBlur'), (Number(c.backgroundBlur ?? 18)/32)*100);
    const surfaceOff = c.backgroundVisible === false;
    $('#overlayOpacity').disabled = surfaceOff;
    $('#overlayBackgroundBlur').disabled = surfaceOff;
    $('#overlayOpacity').closest('.player-control-field')?.classList.toggle('control-disabled', surfaceOff);
    $('#overlayBackgroundBlur').closest('.player-control-field')?.classList.toggle('control-disabled', surfaceOff);
    const elementKeys=['showCover','showTitle','showArtist','showProgress','showElapsed','showRemaining','showLabel','showControls','showPlaylist','showClickThroughToggle'];
    elementKeys.forEach((key)=>{ const shown=(key==='showLabel'||key==='showPlaylist')?!!c[key]:c[key]!==false; $(`[data-overlay-element="${key}"]`)?.classList.toggle('active',shown); });
    $('#overlayLabelInput').value = c.label || '';
    I18n.setAttribute($('#overlayLabelInput'),'placeholder',()=>I18n.t('PlayerDefaultLabel'));
    $('#overlayLabelField').classList.toggle('hidden', !c.showLabel);
    $('#overlayVisualizerToggle').checked = c.visualizer !== false;
    $('#overlayVisualizerBody').classList.toggle('section-disabled', c.visualizer === false);
    const radialMode = ['radial','orb'].includes(c.visualizerStyle||'bars');
    if (radialMode && c.visualizerPosition !== 'background') c.visualizerPosition = 'background';
    $$('#overlayVisualizerStyle [data-viz-style]').forEach((b)=>b.classList.toggle('active',b.dataset.vizStyle===(c.visualizerStyle||'bars')));
    const posRow = $('#overlayVisualizerPosition');
    posRow?.classList.toggle('forced-background', radialMode);
    $('#overlayPositionHint')?.classList.toggle('hidden', !radialMode);
    $$('#overlayVisualizerPosition [data-viz-position]').forEach((b)=>{
      b.classList.toggle('active',b.dataset.vizPosition===(c.visualizerPosition||'bottom'));
      b.disabled = radialMode && b.dataset.vizPosition !== 'background';
    });
    $$('#overlayVisualizerColorMode [data-viz-color-mode]').forEach((b)=>b.classList.toggle('active',b.dataset.vizColorMode===(c.visualizerColorMode||'gradient')));
    $('.overlay-color-row.visualizer-colors')?.classList.toggle('cover-driven', c.visualizerColorMode === 'cover');
    const range = (id, value, label, pct) => { const el=$(id); if(!el)return; el.value=value; $(id+'Value').textContent=label; setRangeFill(el,pct); };
    range('#overlayVizHeight', c.visualizerHeight??18, `${Math.round(c.visualizerHeight??18)} px`, ((Number(c.visualizerHeight??18)-4)/116)*100);
    range('#overlaySensitivity', Math.round((c.sensitivity??1)*100), `${Number(c.sensitivity??1).toFixed(1)}×`, ((Number(c.sensitivity??1)*100-25)/275)*100);
    range('#overlaySmoothing', c.smoothing??78, `${Math.round(c.smoothing??78)}%`, Number(c.smoothing??78)/.95);
    range('#overlayVizOpacity', c.visualizerOpacity??88, `${Math.round(c.visualizerOpacity??88)}%`, c.visualizerOpacity??88);
    range('#overlayVizDetail', c.visualizerDetail??56, `${Math.round(c.visualizerDetail??56)}`, ((Number(c.visualizerDetail??56)-24)/72)*100);
    range('#overlayVizGap', c.visualizerGap??34, `${Math.round(c.visualizerGap??34)}%`, Number(c.visualizerGap??34)/.78);
    range('#overlayVizLineWidth', Math.round((c.visualizerLineWidth??2.2)*10), `${Number(c.visualizerLineWidth??2.2).toFixed(1)} px`, ((Number(c.visualizerLineWidth??2.2)-1)/6)*100);
    range('#overlayVizRoundness', c.visualizerRoundness??72, `${Math.round(c.visualizerRoundness??72)}%`, c.visualizerRoundness??72);
    range('#overlayVizRotation', c.visualizerRotation??0, I18n.t("UIS2", {value1:(Math.round(c.visualizerRotation??0))}), ((Number(c.visualizerRotation??0)+90)/180)*100);
    $('#overlayVizMirror').checked=!!c.visualizerMirror;
    $('#overlayVizFill').checked=c.visualizerFill!==false;
    $$('[data-overlay-color-key]').forEach((b)=>{ const key=b.dataset.overlayColorKey; b.style.setProperty('--overlay-color', c[key] || '#b038ae'); });
  }

  let overlayPersistTimer = 0;
  let overlaySaveChain = Promise.resolve();
  async function persistOverlaySettings(immediate = false) {
    clearTimeout(overlayPersistTimer);
    const run = () => {
      const patch = Object.fromEntries(Object.entries(state.settings.playerOverlay).filter(([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(state.overlayLastSaved[key])));
      if (!Object.keys(patch).length) return Promise.resolve();
      const sent = structuredClone(patch);
      Object.assign(state.overlayLastSaved, structuredClone(patch));
      overlaySaveChain = overlaySaveChain.then(async () => {
        try {
          const saved = await api.overlay.configure(sent);
          for (const key of Object.keys(sent)) {
            if (JSON.stringify(state.settings.playerOverlay[key]) === JSON.stringify(sent[key])) state.settings.playerOverlay[key] = saved[key];
            if (JSON.stringify(state.overlayLastSaved[key]) === JSON.stringify(sent[key])) state.overlayLastSaved[key] = saved[key];
          }
          syncOverlayState(true);
        } catch (error) {
          for (const key of Object.keys(sent)) delete state.overlayLastSaved[key];
          toast('bad', I18n.t("UICouldNotSavePlayerSettings"), I18n.errorMessage(error) || String(error));
        }
      });
      return overlaySaveChain;
    };
    if (immediate) await run(); else overlayPersistTimer = setTimeout(run, 90);
  }

  async function resetSettingsSection(section) {
    closeModal('confirmModal');
    if (section === 'appearance') {
      Object.assign(state.settings, appearanceDefaults);
      await api.settings.set({...appearanceDefaults});
      applyAppearance();
      await renderBackgroundHistory();
      await applyAppIconPreview();
      toast('good',I18n.t("UIAppearanceReset"),I18n.t("UIThemeAccentBackgroundAndIconRestoredToDefaults"));
      return;
    }
    if (section === 'player') {
      clearTimeout(overlayPersistTimer);
      state.settings.playerOverlay = {...playerOverlayDefaults};
      const saved = await api.overlay.configure({...state.settings.playerOverlay});
      if (saved) state.settings.playerOverlay = {...state.settings.playerOverlay,...saved};
      state.overlayLastSaved = structuredClone(state.settings.playerOverlay);
      renderOverlaySettings();
      syncOverlayState(true);
      ensureAudioAnalyser();
      if (state.settingsPage === 'player' && !$('#settingsModal').classList.contains('hidden')) {
        await api.overlay.preview(true).catch(()=>{});
        state.overlayPreviewOpen = true;
      }
      toast('good',I18n.t("UIPlayerReset"),I18n.t("UIWindowAndVisualiserRestoredToDefaultSettings"));
      return;
    }
    if (section === 'games') {
      clearTimeout(gameOverlayPersistTimer);
      state.settings.gameOverlay = { ...gameOverlayDefaults, allowedGames:[] };
      await persistGameOverlaySettings(true);
      toast('good',I18n.t("UIGameOverlayReset"),I18n.t("UIRestoredAutomaticSafeModeAndClearedTheGame"));
      return;
    }
    if (section === 'hotkeys') {
      state.settings.hotkeys = {...hotkeyDefaults};
      const saved = await api.settings.set({hotkeys:{...hotkeyDefaults}}).catch(()=>null);
      if (saved?.hotkeys) state.settings.hotkeys = {...hotkeyDefaults,...saved.hotkeys};
      state.hotkeyStatus = await api.hotkeys.status().catch(()=>({}));
      renderHotkeys();
      toast('good',I18n.t("UIKeyboardShortcutsReset"),I18n.t("UIDefaultGlobalShortcutsRestored"));
      return;
    }
    if (section === 'library') {
      Object.assign(state.settings, libraryDefaults);
      await api.settings.set({...libraryDefaults});
      state.librarySignature = '';
      updateSortControl();
      renderLibraryBody();
      toast('good',I18n.t("UILibraryViewReset"),I18n.t("UICardsAndNewestFirstSortingRestored"));
    }
  }

  function requestSettingsReset(section) {
    const copy = {
      appearance: { title:I18n.t("UIResetAppearance"), text:I18n.t("UIRestoreTheDefaultThemeAccentBackgroundModeOpacity"), action:I18n.t("UIResetAppearance2") },
      player: { title:I18n.t("UIResetPlayer"), text:I18n.t("UIRestoreDefaultWindowContentAndMusicVisualiserSettings"), action:I18n.t("UIResetPlayer2") },
      games: { title:I18n.t("UIResetGameOverlay"), text:I18n.t("UIRestoreAutomaticModeFullScreenOnlyConnectionsAnd"), action:I18n.t("UIResetGameOverlay2") },
      hotkeys: { title:I18n.t("UIResetKeyboardShortcuts"), text:I18n.t("UIAllCustomShortcutsWillBeReplacedWithDefaults"), action:I18n.t("UIResetShortcuts") },
      library: { title:I18n.t("UIResetLibraryView"), text:I18n.t("UIRestoreCardsAndNewestFirstSortingMusicFavourites"), action:I18n.t("UIResetLibrary") },
    }[section];
    if (!copy) return;
    openConfirmation({ title:copy.title, text:copy.text, actionText:copy.action, icon:'undo', onConfirm:()=>resetSettingsSection(section) });
  }

  function currentPlaylistName() {
    return playlistLabel(categoryByKey(state.category));
  }

  function overlaySnapshot() {
    const t=currentTrack();
    return { title:t ? Library.trackTitle(t) : I18n.t('AppName'), artist:t ? Library.trackArtist(t) : I18n.t('AppTagline'), cover:t?.coverUrl ? safeUrl(t.coverUrl) : '', coverType:t?.coverType||'', animateCover:animationEnabled(t), fallbackCover:state.appIconUrl, playlist:currentPlaylistName(), currentTime:Number(audio.currentTime)||0, duration:Number(audio.duration)||Number(t?.duration)||0, playing:!!t && !audio.paused };
  }

  function syncGameOverlayPalette(src='') {
    const player=state.settings.playerOverlay||{};
    if (player.visualizerColorMode!=='cover' || !src) {
      api.gameOverlay?.visual?.({color1:player.visualizerColor||'#b038ae',color2:player.visualizerColor2||'#4665c2'});
      state.gamePaletteSource='';
      return;
    }
    if (src===state.gamePaletteSource) return;
    state.gamePaletteSource=src;
    const epoch=++state.gamePaletteEpoch;
    const img=new Image(); img.decoding='async';
    img.onload=()=>{
      if(epoch!==state.gamePaletteEpoch)return;
      try{
        const size=28,cv=document.createElement('canvas');cv.width=size;cv.height=size;
        const cx=cv.getContext('2d',{willReadFrequently:true});cx.drawImage(img,0,0,size,size);
        const px=cx.getImageData(0,0,size,size).data,bins=new Map();
        for(let i=0;i<px.length;i+=4){if(px[i+3]<180)continue;const r=px[i],g=px[i+1],b=px[i+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b),lum=(mx+mn)/2,sat=mx===mn?0:(mx-mn)/(255-Math.abs(mx+mn-255));if(lum<18||lum>242||sat<.08)continue;const qr=Math.round(r/24)*24,qg=Math.round(g/24)*24,qb=Math.round(b/24)*24,key=`${qr},${qg},${qb}`;bins.set(key,(bins.get(key)||0)+.45+sat*1.35+(1-Math.abs(lum-132)/132)*.35);}
        const ranked=[...bins.entries()].sort((a,b)=>b[1]-a[1]).map(([k])=>k.split(',').map(Number)); if(!ranked.length)return; const first=ranked[0]; let second=ranked.find((c,idx)=>idx>0&&Math.hypot(c[0]-first[0],c[1]-first[1],c[2]-first[2])>92)||ranked[1]||first; const hex=(rgb)=>'#'+rgb.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join(''); api.gameOverlay?.visual?.({color1:hex(first),color2:hex(second)});
      }catch{}
    };
    img.onerror=()=>{}; img.src=src;
  }

  function syncOverlayState(force=false) {
    if (!api.overlay) return Promise.resolve(false);
    clearTimeout(state.overlayStateTimer);
    const snap=overlaySnapshot(); syncGameOverlayPalette(snap.cover);
    const send=()=>api.overlay.state(snap).catch(()=>false);
    if (force) return send();
    state.overlayStateTimer=setTimeout(send,80);
    return Promise.resolve(true);
  }

  async function ensureAudioAnalyser() {
    const c=state.settings.playerOverlay||{};
    const gameMode=state.settings.gameOverlay?.mode||'auto';
    const wantsGameViz=gameMode==='auto'||gameMode==='rtss';
    if (!c.visualizer || ((c.mode==='off' && !state.overlayPreviewOpen) && !wantsGameViz)) return null;
    if (state.analyser) { state.analyser.smoothingTimeConstant=clamp((c.smoothing??78)/100,0,.95); startVisualizerPump(); return state.analyser; }
    try {
      state.audioContext ||= new (window.AudioContext||window.webkitAudioContext)();
      state.mediaSource ||= state.audioContext.createMediaElementSource(audio);
      state.analyser=state.audioContext.createAnalyser();
      // 256 gives enough frequency resolution for radial/orb modes without making the renderer expensive.
      state.analyser.fftSize=256;
      state.analyser.smoothingTimeConstant=clamp((c.smoothing??78)/100,0,.95);
      state.mediaSource.connect(state.analyser); state.analyser.connect(state.audioContext.destination);
      if (state.audioContext.state==='suspended') await state.audioContext.resume().catch(()=>{});
      startVisualizerPump();
    } catch (error) { console.warn(I18n.t('VisualizerUnavailable'),error); state.analyser=null; }
    return state.analyser;
  }

  function startVisualizerPump() {
    if (state.vizTimer) return;
    // Do not use requestAnimationFrame here: browsers intentionally throttle it for hidden/minimized pages.
    // This renderer has Electron backgroundThrottling disabled, so a modest timer keeps the always-on-top
    // visualizer supplied with analyser frames even while the main PulseDeck window is minimized.
    state.vizTimer=setInterval(()=>{
      const c=state.settings.playerOverlay||{};
      const gameMode=state.settings.gameOverlay?.mode||'auto';
      const wantsGameViz=gameMode==='auto'||gameMode==='rtss';
      if (!state.analyser || !c.visualizer || ((c.mode==='off'&&!state.overlayPreviewOpen)&&!wantsGameViz) || audio.paused) return;
      if (state.audioContext?.state === 'suspended') state.audioContext.resume().catch(()=>{});
      state.analyser.smoothingTimeConstant=clamp((c.smoothing??78)/100,0,.95);
      const freq=new Uint8Array(state.analyser.frequencyBinCount);
      const wave=new Uint8Array(state.analyser.fftSize);
      state.analyser.getByteFrequencyData(freq);
      state.analyser.getByteTimeDomainData(wave);
      // Keep IPC light: the overlay interpolates between these frames at its own render rate.
      api.overlay.audioFrame({freq:Array.from(freq.slice(0,96)),wave:Array.from(wave.slice(0,160)),t:performance.now()});
    },33);
  }

  function formatAcceleratorKeys(accel='') {
    return String(accel||'').split('+').filter(Boolean).map((x)=>x==='CommandOrControl'?'Ctrl':x);
  }

  function renderHotkeys() {
    const cfg={...hotkeyDefaults,...(state.settings.hotkeys||{})};
    $('#hotkeysEnabled').checked=cfg.enabled!==false;
    const status=state.hotkeyStatus||{};
    $('#hotkeyList').innerHTML=hotkeyMeta().map(([key,labelText,desc,icon])=>{
      const keys=formatAcceleratorKeys(cfg[key]); const st=status[key]; const recording=state.hotkeyRecording===key;
      const statusText=st && st.ok===false && !st.disabled ? `<span class="hotkey-error">${esc(st.message||I18n.t("UICouldNotRegister"))}</span>` : st?.ok ? `<span class="hotkey-ok" data-i18n="UIGloballyActive">${I18n.h("UIGloballyActive")}</span>` : '';
      return `<div class="hotkey-row ${recording?'recording':''}" data-hotkey-row="${key}"><div class="hotkey-about"><span class="hotkey-row-icon">${window.Icon(icon,16)}</span><span><b>${esc(labelText)}</b><small>${esc(desc)}</small>${statusText}</span></div><button class="hotkey-combo" data-record-hotkey="${key}">${recording?`<em data-i18n="UIPressUpToKeys">${I18n.h("UIPressUpToKeys")}</em>`:(keys.length?keys.map(k=>`<kbd>${esc(k)}</kbd>`).join('<i>+</i>'):`<em data-i18n="UINotAssigned">${I18n.h("UINotAssigned")}</em>`)}</button><button class="icon-button subtle" data-reset-hotkey="${key}" title="${I18n.h("UIReset")}" data-i18n-title="UIReset">${window.Icon('undo',14)}</button><button class="icon-button subtle" data-clear-hotkey="${key}" title="${I18n.h("UIClear")}" data-i18n-title="UIClear">${window.Icon('trash',14)}</button></div>`;
    }).join('');
  }

  function normalizeRecordedKey(e) {
    const mods=[]; if(e.ctrlKey)mods.push('Ctrl'); if(e.altKey)mods.push('Alt'); if(e.shiftKey)mods.push('Shift'); if(e.metaKey)mods.push('Super');
    const modifierCodes=new Set(['ControlLeft','ControlRight','AltLeft','AltRight','ShiftLeft','ShiftRight','MetaLeft','MetaRight']);
    if(modifierCodes.has(e.code)) return {mods,key:'',count:mods.length};
    let key='';
    if(e.code==='Space')key='Space'; else if(e.code.startsWith('Arrow'))key=e.code.slice(5); else if(['PageUp','PageDown','Home','End','Insert','Delete','Backspace','Tab','Enter','Escape'].includes(e.code))key=e.code; else if(/^Key[A-Z]$/.test(e.code))key=e.code.slice(3); else if(/^Digit\d$/.test(e.code))key=e.code.slice(5); else if(/^F\d{1,2}$/.test(e.code))key=e.code; else if(e.key?.length===1)key=e.key.toUpperCase(); else key=e.key||e.code;
    return {mods,key,count:mods.length+(key?1:0)};
  }

  async function finishHotkeyRecording(action, accelerator=null) {
    if (!state.hotkeyRecording) return;
    state.hotkeyRecording=null;
    await api.hotkeys.suspend(false).catch(()=>{});
    if (accelerator!==null) {
      state.settings.hotkeys={...hotkeyDefaults,...state.settings.hotkeys,[action]:accelerator};
      const saved=await api.settings.set({hotkeys:state.settings.hotkeys}).catch(()=>null); if(saved?.hotkeys)state.settings.hotkeys=saved.hotkeys;
      setTimeout(async()=>{state.hotkeyStatus=await api.hotkeys.status().catch(()=>({}));renderHotkeys();},80);
    } else renderHotkeys();
  }

  async function startHotkeyRecording(action) {
    if (state.hotkeyRecording) await finishHotkeyRecording(state.hotkeyRecording,null);
    state.hotkeyRecording=action; await api.hotkeys.suspend(true).catch(()=>{}); renderHotkeys();
  }

  function handleHotkeyRecordingKey(e) {
    if (!state.hotkeyRecording) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const action=state.hotkeyRecording;
    if(e.code==='Escape'){finishHotkeyRecording(action,null);return}
    if(e.code==='Backspace'||e.code==='Delete'){finishHotkeyRecording(action,'');return}
    const rec=normalizeRecordedKey(e);
    if(rec.count>3){toast('bad',I18n.t("UIMaximumKeys"),I18n.t("UIForExampleAltShiftN"),1800);return}
    if(!rec.key)return;
    const accelerator=[...rec.mods,rec.key].join('+');
    finishHotkeyRecording(action,accelerator);
  }

  async function switchPlaylist(delta=1, autoplay=true) {
    const cats=categoryData(false); if(!cats.length)return;
    let idx=cats.findIndex(c=>c.key===state.category); if(idx<0)idx=0;
    await navigateCategory(cats[(idx+delta+cats.length)%cats.length].key,{force:true});
    if(autoplay && state.filtered[0]) await selectTrack(state.filtered[0].id,true,false);
    syncOverlayState(true);
  }

  async function handleGlobalAction(payload={}) {
    const action=payload.action;
    let shouldNotify=false;
    const notifyReason = payload.source === 'global' ? 'hotkey' : 'manual';
    if(action==='playPause'){await togglePlay();shouldNotify=true;}
    else if(action==='next'){await nextTrack(false);shouldNotify=true;}
    else if(action==='previous'){await prevTrack();shouldNotify=true;}
    else if(action==='volumeUp')setVolume(Math.min(1,audio.volume+.07),true);
    else if(action==='volumeDown')setVolume(Math.max(0,audio.volume-.07),true);
    else if(action==='mute')toggleMute();
    else if(action==='nextPlaylist'){await switchPlaylist(1,true);shouldNotify=true;}
    else if(action==='previousPlaylist'){await switchPlaylist(-1,true);shouldNotify=true;}
    else if(action==='toggleShuffle')toggleShuffleMode();
    else if(action==='cycleRepeat')cycleRepeatMode();
    else if(action==='favoriteCurrent' && currentTrack())await toggleFavorite(currentTrack());
    else if(action==='focusSearch')focusSearchInput();
    else if(action==='openImport')openOnlineImportModal();
    else if(action==='trimCurrentTrack' && currentTrack())await openTrimForTrack(currentTrack());
    else if(action==='seekTo'){const d=Number(audio.duration)||Number(currentTrack()?.duration)||0;const ratio=clamp(payload.value,0,1);if(d>0){audio.currentTime=ratio*d;syncOverlayState(true);}return;}
    else if(action==='showOverlay')shouldNotify=true;
    if(shouldNotify){await syncOverlayState(true);await api.overlay.notify(notifyReason).catch(()=>{});}
  }

  function bindEvents() {
    $('#addBtn').addEventListener('click', addFiles);
    $('#emptyAddBtn').addEventListener('click', addFiles);
    $('#onlineBtn').addEventListener('click', openOnlineImportModal);
    $('#emptyOnlineBtn').addEventListener('click', openOnlineImportModal);
    $('#settingsBtn').addEventListener('click', async () => { openModal('settingsModal'); setSettingsPage(state.settingsPage || 'appearance'); await renderBackgroundHistory(); applyAppIconPreview(); renderOverlaySettings(); renderGameOverlaySettings(); renderHotkeys(); });
    $('#settingsAbout').addEventListener('click', () => setSettingsPage('about'));
    $('#folderBtn').addEventListener('click', () => api.library.openFolder());
    $('#settingsFolderBtn').addEventListener('click', () => api.library.openFolder());
    $('#settingsOnlineBtn').addEventListener('click', openOnlineImportModal);

    $$('.settings-nav-item').forEach((b)=>b.addEventListener('click',()=>setSettingsPage(b.dataset.settingsPage)));
    $$('[data-reset-settings]').forEach((b)=>b.addEventListener('click',()=>requestSettingsReset(b.dataset.resetSettings)));
    $('#gameOverlayMode')?.addEventListener('click',async(e)=>{const b=e.target.closest('[data-game-overlay-mode]');if(!b)return;state.settings.gameOverlay={...gameOverlayDefaults,...state.settings.gameOverlay,mode:b.dataset.gameOverlayMode};renderGameOverlaySettings();await persistGameOverlaySettings(true);});
    $('#gameOverlayOnlyFullscreen')?.addEventListener('change',async(e)=>{state.settings.gameOverlay={...gameOverlayDefaults,...state.settings.gameOverlay,onlyFullscreen:e.target.checked};await persistGameOverlaySettings(true);});
    $('#gameOverlayAllowlistOnly')?.addEventListener('change',async(e)=>{state.settings.gameOverlay={...gameOverlayDefaults,...state.settings.gameOverlay,allowlistOnly:e.target.checked};await persistGameOverlaySettings(true);});
    $('#gameOverlayRtssVisualizer')?.addEventListener('change',async(e)=>{state.settings.gameOverlay={...gameOverlayDefaults,...state.settings.gameOverlay,rtssVisualizer:e.target.checked};await persistGameOverlaySettings(true);ensureAudioAnalyser();});
    $('#gameOverlayRtssAnchor')?.addEventListener('click',async(e)=>{const b=e.target.closest('[data-rtss-anchor]');if(!b)return;state.settings.gameOverlay={...gameOverlayDefaults,...state.settings.gameOverlay,rtssAnchor:b.dataset.rtssAnchor};renderGameOverlaySettings();await persistGameOverlaySettings(true);});
    const saveRtssOffset=async()=>{state.settings.gameOverlay={...gameOverlayDefaults,...state.settings.gameOverlay,rtssOffsetX:clamp(Number($('#gameOverlayRtssOffsetX')?.value)||0,0,500),rtssOffsetY:clamp(Number($('#gameOverlayRtssOffsetY')?.value)||0,0,500)};await persistGameOverlaySettings(true);};
    $('#gameOverlayRtssOffsetX')?.addEventListener('change',saveRtssOffset); $('#gameOverlayRtssOffsetY')?.addEventListener('change',saveRtssOffset);
    $('#gameOverlayLaunchRtssBtn')?.addEventListener('click',async()=>{const result=await api.gameOverlay.launchRtss().catch((e)=>({ok:false,reason:I18n.errorMessage(e)}));if(result?.ok)toast('good',I18n.t("UIRTSSStarted"),I18n.t("UIWaitAFewSecondsPulseDeckWillDetectShared"),1800);else toast('bad',I18n.t("UIRTSSNotFound"),result?.reason||I18n.t("UIInstallRTSSAndTryAgain"));});
    $('#gameOverlayRtssDownloadBtn')?.addEventListener('click',async()=>{const ok=await api.gameOverlay.openRtssDownload().catch(()=>false);if(!ok)toast('bad',I18n.t("UICouldNotOpenTheRTSSPage"),I18n.t("UIOpenTheRTSSDownloadPageManually"));});
    $('#gameOverlayRestartBtn')?.addEventListener('click',async()=>{
      const b=$('#gameOverlayRestartBtn');b.disabled=true;
      try {
        const accepted=await api.gameOverlay.restartHost();
        if(accepted)toast('good',I18n.t("UIRestartingTheGameModule"),I18n.t("UIConnectionStatusWillAppearBelow"),1600);
        else toast('bad',I18n.t("UIModuleNotRunning"),I18n.t("UICheckTheSelectedModeAndGameOverlayStatus"));
      } catch { toast('bad',I18n.t("UICouldNotRequestARestart"),I18n.t("UICheckTheGameOverlayStatus")); }
      finally { setTimeout(()=>{b.disabled=false},700); }
    });
    $('#gameOverlayGameBarBtn')?.addEventListener('click',async()=>{const ok=await api.gameOverlay.openGameBar().catch(()=>false);if(!ok)toast('bad',I18n.t("UIXboxGameBarDidNotOpen"),I18n.t("UIMakeSureXboxGameBarIsInstalledAnd"));});
    $('#gameOverlayDetectedList')?.addEventListener('click',async(e)=>{const b=e.target.closest('[data-game-allow]');if(!b)return;const proc=String(b.dataset.gameAllow||'').toLowerCase();if(!proc)return;const set=new Set((state.settings.gameOverlay?.allowedGames||[]).map((x)=>String(x).toLowerCase()));if(set.has(proc))set.delete(proc);else set.add(proc);state.settings.gameOverlay={...gameOverlayDefaults,...state.settings.gameOverlay,allowedGames:[...set]};renderGameOverlaySettings();await persistGameOverlaySettings(true);});
    $('#gameOverlayAllowlist')?.addEventListener('click',async(e)=>{const b=e.target.closest('[data-game-remove]');if(!b)return;const proc=String(b.dataset.gameRemove||'').toLowerCase();const set=new Set((state.settings.gameOverlay?.allowedGames||[]).map((x)=>String(x).toLowerCase()));set.delete(proc);state.settings.gameOverlay={...gameOverlayDefaults,...state.settings.gameOverlay,allowedGames:[...set]};renderGameOverlaySettings();await persistGameOverlaySettings(true);});
    $('#overlayDemoBtn').addEventListener('click',()=>{syncOverlayState(true);api.overlay.preview(true).catch(()=>{});state.overlayPreviewOpen=true;});
    $('#overlayMode').addEventListener('click',async(e)=>{const b=e.target.closest('[data-overlay-mode]');if(!b)return;state.settings.playerOverlay.mode=b.dataset.overlayMode;renderOverlaySettings();await persistOverlaySettings(true);if(state.settingsPage==='player' && !$('#settingsModal').classList.contains('hidden'))api.overlay.preview(true).catch(()=>{});});
    $('#overlayDuration').addEventListener('input',(e)=>{state.settings.playerOverlay.duration=clamp(e.target.value,1,12);renderOverlaySettings();persistOverlaySettings();});
    $('#overlayNotifyAutoNext').addEventListener('change',(e)=>{state.settings.playerOverlay.notifyAutoNext=e.target.checked;persistOverlaySettings(true);});
    $('#overlayClickThroughMinimized').addEventListener('change',(e)=>{state.settings.playerOverlay.clickThroughWhenMinimized=e.target.checked;persistOverlaySettings(true);});
    $('#overlayFullscreenTopmost').addEventListener('change',(e)=>{state.settings.playerOverlay.fullscreenTopmost=e.target.checked;persistOverlaySettings(true);});
    $('#overlayBackgroundVisible').addEventListener('change',(e)=>{state.settings.playerOverlay.backgroundVisible=e.target.checked;renderOverlaySettings();persistOverlaySettings();});
    $('#overlayBorderVisible').addEventListener('change',(e)=>{state.settings.playerOverlay.borderVisible=e.target.checked;renderOverlaySettings();persistOverlaySettings();});
    $('#overlayOpacity').addEventListener('input',(e)=>{state.settings.playerOverlay.opacity=clamp(e.target.value,0,100);renderOverlaySettings();persistOverlaySettings();});
    $('#overlayCornerRadius').addEventListener('input',(e)=>{state.settings.playerOverlay.cornerRadius=clamp(e.target.value,0,38);renderOverlaySettings();persistOverlaySettings();});
    $('#overlayBackgroundBlur').addEventListener('input',(e)=>{state.settings.playerOverlay.backgroundBlur=clamp(e.target.value,0,32);renderOverlaySettings();persistOverlaySettings();});
    $('#overlayElementToggles').addEventListener('click',(e)=>{const b=e.target.closest('[data-overlay-element]');if(!b)return;const k=b.dataset.overlayElement;state.settings.playerOverlay[k]=!state.settings.playerOverlay[k];renderOverlaySettings();persistOverlaySettings();});
    $('#overlayLabelInput').addEventListener('input',(e)=>{state.settings.playerOverlay.label=e.target.value.slice(0,48);persistOverlaySettings();});
    $('#overlayVisualizerToggle').addEventListener('change',(e)=>{state.settings.playerOverlay.visualizer=e.target.checked;renderOverlaySettings();persistOverlaySettings();ensureAudioAnalyser();});
    $('#overlayVisualizerStyle').addEventListener('click',(e)=>{const b=e.target.closest('[data-viz-style]');if(!b)return;state.settings.playerOverlay.visualizerStyle=b.dataset.vizStyle;if(['radial','orb'].includes(b.dataset.vizStyle))state.settings.playerOverlay.visualizerPosition='background';renderOverlaySettings();persistOverlaySettings();});
    $('#overlayVisualizerPosition').addEventListener('click',(e)=>{const b=e.target.closest('[data-viz-position]');if(!b)return;if(['radial','orb'].includes(state.settings.playerOverlay.visualizerStyle||'')){state.settings.playerOverlay.visualizerPosition='background';renderOverlaySettings();return;}state.settings.playerOverlay.visualizerPosition=b.dataset.vizPosition;renderOverlaySettings();persistOverlaySettings();});
    $('#overlayVisualizerColorMode').addEventListener('click',(e)=>{const b=e.target.closest('[data-viz-color-mode]');if(!b)return;state.settings.playerOverlay.visualizerColorMode=b.dataset.vizColorMode;renderOverlaySettings();persistOverlaySettings();});
    $('#overlayVizHeight').addEventListener('input',(e)=>{state.settings.playerOverlay.visualizerHeight=clamp(e.target.value,4,120);renderOverlaySettings();persistOverlaySettings();});
    $('#overlaySensitivity').addEventListener('input',(e)=>{state.settings.playerOverlay.sensitivity=clamp(e.target.value,25,300)/100;renderOverlaySettings();persistOverlaySettings();});
    $('#overlaySmoothing').addEventListener('input',(e)=>{state.settings.playerOverlay.smoothing=clamp(e.target.value,0,95);renderOverlaySettings();persistOverlaySettings();});
    $('#overlayVizOpacity').addEventListener('input',(e)=>{state.settings.playerOverlay.visualizerOpacity=clamp(e.target.value,5,100);renderOverlaySettings();persistOverlaySettings();});
    $('#overlayVizDetail').addEventListener('input',(e)=>{state.settings.playerOverlay.visualizerDetail=clamp(e.target.value,24,96);renderOverlaySettings();persistOverlaySettings();});
    $('#overlayVizGap').addEventListener('input',(e)=>{state.settings.playerOverlay.visualizerGap=clamp(e.target.value,0,78);renderOverlaySettings();persistOverlaySettings();});
    $('#overlayVizLineWidth').addEventListener('input',(e)=>{state.settings.playerOverlay.visualizerLineWidth=clamp(e.target.value,10,70)/10;renderOverlaySettings();persistOverlaySettings();});
    $('#overlayVizRoundness').addEventListener('input',(e)=>{state.settings.playerOverlay.visualizerRoundness=clamp(e.target.value,0,100);renderOverlaySettings();persistOverlaySettings();});
    $('#overlayVizRotation').addEventListener('input',(e)=>{state.settings.playerOverlay.visualizerRotation=clamp(e.target.value,-90,90);renderOverlaySettings();persistOverlaySettings();});
    $('#overlayVizMirror').addEventListener('change',(e)=>{state.settings.playerOverlay.visualizerMirror=e.target.checked;persistOverlaySettings();});
    $('#overlayVizFill').addEventListener('change',(e)=>{state.settings.playerOverlay.visualizerFill=e.target.checked;persistOverlaySettings();});
    $('[data-settings-panel="player"]').addEventListener('click',(e)=>{const b=e.target.closest('[data-overlay-color-key]');if(!b)return;const key=b.dataset.overlayColorKey;openRgbModal(state.settings.playerOverlay[key]||'#b038ae',{type:'overlay',key});});
    $('[data-settings-panel="player"]').addEventListener('change',(e)=>{ if(e.target.matches('input[type="range"]') || e.target.id==='overlayLabelInput') persistOverlaySettings(true); });
    $('#hotkeysEnabled').addEventListener('change',async(e)=>{state.settings.hotkeys={...hotkeyDefaults,...state.settings.hotkeys,enabled:e.target.checked};const saved=await api.settings.set({hotkeys:state.settings.hotkeys}).catch(()=>null);if(saved?.hotkeys)state.settings.hotkeys=saved.hotkeys;setTimeout(async()=>{state.hotkeyStatus=await api.hotkeys.status().catch(()=>({}));renderHotkeys();},80);});
    $('#hotkeyList').addEventListener('click',async(e)=>{const rec=e.target.closest('[data-record-hotkey]');if(rec){startHotkeyRecording(rec.dataset.recordHotkey);return;}const reset=e.target.closest('[data-reset-hotkey]');if(reset){state.settings.hotkeys={...hotkeyDefaults,...state.settings.hotkeys,[reset.dataset.resetHotkey]:hotkeyDefaults[reset.dataset.resetHotkey]};await api.settings.set({hotkeys:state.settings.hotkeys});setTimeout(async()=>{state.hotkeyStatus=await api.hotkeys.status().catch(()=>({}));renderHotkeys();},80);return;}const clear=e.target.closest('[data-clear-hotkey]');if(clear){state.settings.hotkeys={...hotkeyDefaults,...state.settings.hotkeys,[clear.dataset.clearHotkey]:''};await api.settings.set({hotkeys:state.settings.hotkeys});setTimeout(async()=>{state.hotkeyStatus=await api.hotkeys.status().catch(()=>({}));renderHotkeys();},80);}});
    document.addEventListener('keydown',handleHotkeyRecordingKey,true);
    api.hotkeys.onStatus((status)=>{state.hotkeyStatus=status||{};if(!$('#settingsModal').classList.contains('hidden'))renderHotkeys();});
    api.hotkeys.onAction(handleGlobalAction);
    api.gameOverlay.onStatus((status)=>{state.gameOverlayStatus=status||state.gameOverlayStatus;if(!$('#settingsModal').classList.contains('hidden')&&state.settingsPage==='games')renderGameOverlaySettings();});
    api.overlay.onSettingsChanged((config) => {
      // A click on the player or a global hotkey owns this preference, even while a slider save is pending.
      state.settings.playerOverlay.clickThroughWhenMinimized = !!config.clickThroughWhenMinimized;
      state.overlayLastSaved.clickThroughWhenMinimized = !!config.clickThroughWhenMinimized;
      renderOverlaySettings();
    });
    api.overlay.onPreviewContext((active) => { state.overlayPreviewOpen = !!active; });
    api.overlay.onBounds((bounds)=>{state.settings.playerOverlay.bounds=bounds;state.settings.playerOverlay.width=bounds?.width||state.settings.playerOverlay.width;state.settings.playerOverlay.height=bounds?.height||state.settings.playerOverlay.height;Object.assign(state.overlayLastSaved,{bounds,width:state.settings.playerOverlay.width,height:state.settings.playerOverlay.height});});
    $('#refreshBtn').addEventListener('click', async () => {
      const b = $('#refreshBtn'); b.classList.add('spinning'); b.disabled = true;
      try { state.tracks = await api.library.refresh(); state.loading = false; state.categorySignature=''; renderLibrary(); probeDurations(); }
      catch (e) { toast('bad',I18n.t("UICouldNotRefresh"),I18n.errorMessage(e)||String(e)); }
      finally { setTimeout(() => { b.classList.remove('spinning'); b.disabled = false; },250); }
    });

    let searchFrame = 0;
    $('#searchInput').addEventListener('input', (e) => {
      state.query = e.target.value;
      cancelAnimationFrame(searchFrame);
      searchFrame = requestAnimationFrame(() => renderLibraryBody());
    });
    $('#sortTrigger').addEventListener('click', toggleSortPopover);
    $('#sortPopover').addEventListener('click', (e) => { const b = e.target.closest('[data-sort]'); if (b) setSort(b.dataset.sort); });
    $('#gridViewBtn').addEventListener('click', () => setView('grid'));
    $('#listViewBtn').addEventListener('click', () => setView('list'));
    const categoryClick = (e) => {
      if(e.target.closest('[data-add-folder]')){openFolderEditor();return;}
      const folder=e.target.closest('[data-folder-open]');if(folder){enterLibraryFolder(folder.dataset.folderOpen,folder);return;}
      if(e.target.closest('[data-folder-back]')){state.folderOverview=true;state.categorySignature='';renderCategories(true);return;}

      if ((state.suppressCategoryClickUntil || 0) > performance.now()) return;
      const add = e.target.closest('[data-add-category]');
      if (add) { state.categoryEditMode = true; openCategoryEditor(); return; }
      const restore = e.target.closest('[data-restore-category]');
      if (restore) { restoreCategory(restore.dataset.restoreCategory); return; }
      const b = e.target.closest('[data-category]');
      if (!b || e.target.closest('[data-category-drag]')) return;
      if(b.dataset.category!==state.category){navigateCategory(b.dataset.category);return;}
      const wasEditing = state.categoryEditMode;
      if (wasEditing) state.categoryEditMode = false;
      const changed = b.dataset.category !== state.category;
      if (changed) state.category = b.dataset.category;
      if (wasEditing) { state.categorySignature = ''; renderCategories(true); }
      else renderCategories(false);
      if (changed || wasEditing) renderLibraryBody();
    };
    $('#categoryChips').addEventListener('click', categoryClick);
    $('#categorySidebar').addEventListener('click', categoryClick);
    $('#hiddenCategories').addEventListener('click', categoryClick);

    const categoryContext = (e) => {
      const folder=e.target.closest('[data-folder-open],[data-folder-back]');if(folder){e.preventDefault();e.stopPropagation();openFolderContext(folder.dataset.folderOpen??folder.dataset.folderId??'',e.clientX,e.clientY);return;}
      const b = e.target.closest('[data-category]'); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      if(playlistSelection?.selected.has(b.dataset.category))openPlaylistBatchMenu([...playlistSelection.selected],e.clientX,e.clientY);
      else{playlistSelection?.clear();openCategoryContextMenu(categoryByKey(b.dataset.category), e.clientX, e.clientY);}
    };
    $('#categoryChips').addEventListener('contextmenu', categoryContext);
    $('#categorySidebar').addEventListener('contextmenu', categoryContext);

    let hiddenDragKey = '';
    const hiddenDragStart = (e) => {
      const b=e.target.closest('[data-restore-category]'); if(!b)return;
      hiddenDragKey=b.dataset.restoreCategory; e.dataTransfer.effectAllowed='move';
    };
    $('#hiddenCategories').addEventListener('dragstart', hiddenDragStart);
    $('#categorySidebar').addEventListener('dragstart', hiddenDragStart);
    const allowHiddenDrop = (e) => { if(hiddenDragKey){e.preventDefault();e.dataTransfer.dropEffect='move';} };
    $('#categoryChips').addEventListener('dragover', allowHiddenDrop);
    $('#categorySidebar').addEventListener('dragover', allowHiddenDrop);
    const dropHidden = async (e, container, axis = 'x') => {
      if(!hiddenDragKey)return; e.preventDefault();
      const key=hiddenDragKey; hiddenDragKey=''; categoryPatch(key,{hidden:false});
      const visible=[...container.querySelectorAll('[data-category]')];
      const target=visible.find((x)=>{
        const r=x.getBoundingClientRect();
        return axis === 'y' ? e.clientY < r.top+r.height/2 : e.clientX < r.left+r.width/2;
      });
      const order=normalizedCategoryOrder().filter((x)=>x!==key); const idx=target?order.indexOf(target.dataset.category):-1;
      if(idx>=0)order.splice(idx,0,key);else order.push(key);
      state.settings.categoryOrder=order; state.categorySignature=''; renderCategories(true); await persistCategorySettings();
    };
    $('#categoryChips').addEventListener('drop', (e) => dropHidden(e, $('#categoryChips'), 'x'));
    $('#categorySidebar').addEventListener('drop', (e) => dropHidden(e, $('#categorySidebar'), innerWidth <= 900 ? 'x' : 'y'));

    for (const container of [$('#categoryChips'), $('#categorySidebar')]) {
      playlistReorders.push(new window.PulsePlaylistReorder({
        container,
        axis: () => container.id === 'categorySidebar' && getComputedStyle(container).display !== 'flex' ? 'y' : 'x',
        onPress: () => { state.categoryGestureActive = true; },
        onStart: key => { state.categoryEditMode = true; state.categoryDrag = key; },
        onCommit: async visibleOrder => {
          const rest = [...new Set([...(state.settings.categoryOrder||[]),...Library.categories(state.tracks,state.settings,true).map(c=>c.key)])].filter(key => !visibleOrder.includes(key));
          state.settings.categoryOrder = [...visibleOrder, ...rest];
          state.categorySignature = '';
          try { await persistCategorySettings(); }
          catch (error) { toast('bad',I18n.t("UICouldNotSavePlaylistOrder"),I18n.errorMessage(error) || String(error)); }
        },
        onFinish: active => {
          state.categoryGestureActive = false; state.categoryDrag = null;
          if (active) { state.suppressCategoryClickUntil = performance.now()+360; deferredCategoryRender = true; }
          finishReordering();
        },
      }));
    }

    $('#library').addEventListener('click', (e) => {
      const onlineSearch = e.target.closest('[data-search-online]');
      if (onlineSearch) {
        const query = state.query.trim();
        if(onlineSearch.dataset.searchOnline!=='all')setProvider(onlineSearch.dataset.searchOnline);
        openModal('onlineModal');
        $('#onlineSearchInput').value = query;
        requestAnimationFrame(() => doOnlineSearch());
        return;
      }
      const action = e.target.closest('[data-action]');
      if (action) {
        const track = findTrack(action.dataset.id || action.closest('[data-id]')?.dataset.id);
        if (!track) return;
        e.stopPropagation();
        if (action.dataset.action === 'play') selectTrack(track.id,true,true);
        else if (action.dataset.action === 'favorite') toggleFavorite(track);
        else if (action.dataset.action === 'menu') {
          if (trackSelection?.selected.has(track.id)) { const r=action.getBoundingClientRect(); openBulkContextMenu([...trackSelection.selected],r.right,r.bottom); }
          else { trackSelection?.clear(); openContextMenu(track,action); }
        }
        return;
      }
      const row = e.target.closest('[data-track-root]');
      if (row) { trackSelection?.clear(); selectTrack(row.dataset.id, true, false); }
    });
    $('#library').addEventListener('contextmenu', (e) => {
      const row = e.target.closest('[data-track-root]');
      const track = row && findTrack(row.dataset.id);
      if (!track) return;
      e.preventDefault(); e.stopPropagation();
      if (trackSelection?.selected.has(track.id)) openBulkContextMenu([...trackSelection.selected],e.clientX,e.clientY);
      else { trackSelection?.clear(); openContextMenu(track, { getBoundingClientRect: () => ({ right:e.clientX, bottom:e.clientY }) }); }
    });
    $('#library').addEventListener('keydown', (e) => {
      const row = e.target.closest('[data-track-root]');
      if (!row || e.target.closest('button')) return;
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r=row.getBoundingClientRect(); if(trackSelection?.selected.has(row.dataset.id))openBulkContextMenu([...trackSelection.selected],r.right,r.bottom);else openContextMenu(findTrack(row.dataset.id),row); return; }
      if (e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); selectTrack(row.dataset.id, true, false); }
    });

    document.addEventListener('load', (e) => {
      if (!e.target.matches?.('.cover-img, img.online-thumb')) return;
      e.target.classList.add('is-loaded');
      e.target.parentElement?.classList.remove('placeholder');
    }, true);
    document.addEventListener('error', (e) => {
      if (e.target.matches?.('.app-cover-fallback, .brand-icon, .settings-about-icon')) {
        if (e.target.src !== defaultAppIconUrl) e.target.src = defaultAppIconUrl;
        return;
      }
      if (!e.target.matches?.('.cover-img, img.online-thumb')) return;
      const img = e.target;
      const parent = img.parentElement;
      img.remove();
      parent?.classList.add('placeholder');
      parent?.classList.add('image-failed');
    }, true);

    $('#playerCover').addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();const track=currentTrack();if(track)openContextMenu(track,{getBoundingClientRect:()=>({right:e.clientX,bottom:e.clientY})});});
    $('#contextMenu').addEventListener('click', async (e) => {
      const menu = $('#contextMenu');
      if (e.target.closest('button:disabled')) return;
      if(e.target.closest('[data-folder-source],[data-folder-move-playlist],[data-folder-command]')){try{await handleFolderMenu(e,menu);}catch(error){toast('bad',I18n.t('FoldersTitle'),I18n.errorMessage(error));}return;}
      if(trackTools?.handleMenu(e,menu))return;
      const trigger = e.target.closest('[data-submenu-trigger]');
      if (trigger) { e.stopPropagation(); const wrap = trigger.closest('.context-submenu-wrap'); const open = !wrap.classList.contains('open') || wrap.dataset.sticky !== '1'; wrap.dataset.sticky = open ? '1' : '0'; if (open) positionTrackSubmenu(wrap); else { wrap.classList.remove('open'); trigger.setAttribute('aria-expanded','false'); } return; }
      if(menu.dataset.menuKind==='playlists'){const keys=JSON.parse(menu.dataset.playlistKeys||'[]'),action=e.target.closest('[data-batch-playlist]')?.dataset.batchPlaylist,alias=e.target.closest('[data-batch-alias]')?.dataset.batchAlias;if(action)askPlaylistBatch(keys,action);if(alias)askPlaylistBatch([...new Set([...keys.filter(k=>k.startsWith('artist:')),alias])],'alias',alias);return;}
      const access=e.target.closest('[data-link-access]');if(access){askPlaylistBatch([state.categoryContextKey,access.dataset.linkAccess],'link');return;}
      if (menu.dataset.menuKind === 'tracks') { await handleBulkMenu(e,menu); return; }
      const merge = e.target.closest('[data-merge-target]');
      if (merge) { openMergeDialog(state.categoryContextKey, merge.dataset.mergeTarget); return; }
      const alias = e.target.closest('[data-alias-target]');
      if (alias) { askArtistAlias(state.categoryContextKey, alias.dataset.aliasTarget); return; }
      const addCat = e.target.closest('[data-add-category]');
      if (addCat && menu.dataset.menuKind === 'track') {
        const t = findTrack(menu.dataset.trackId); const oldRect=menu.getBoundingClientRect();
        if (t) await toggleTrackCategory(t, addCat.dataset.addCategory);
        if (t) { openContextMenu(t, { getBoundingClientRect:()=>({ right:oldRect.right, bottom:oldRect.top-6 }) }); const wrap=$('#contextMenu .context-submenu-wrap'); if(wrap){wrap.dataset.sticky='1';positionTrackSubmenu(wrap);} }
        return;
      }
      if (e.target.closest('[data-new-category-for-track]')) {
        const t=findTrack(menu.dataset.trackId); state.pendingTracksForNewCategory=null; state.pendingTrackForNewCategory=t?.rel||'';state.pendingNewTracks=t?[t]:null;
        hideContextMenu(); state.categoryEditMode = true; openCategoryEditor(); return;
      }
      const categoryCommand = e.target.closest('[data-category-command]');
      if (categoryCommand && menu.dataset.menuKind === 'category') {
        const cat = categoryByKey(state.categoryContextKey); const cmd = categoryCommand.dataset.categoryCommand;
        hideContextMenu(); if (!cat || categoryCommand.disabled) return;
        if (cmd === 'move') { state.categoryEditMode = true; state.categorySignature=''; renderCategories(true); toast('info',I18n.t("UIMoveMode"),I18n.t("UIHoldAPlaylistAndDragItToIts"),2200); }
        else if (cmd === 'rename') openCategoryEditor(cat,true);
        else if (cmd === 'style') openCategoryEditor(cat,false);
        else if (cmd === 'split') askArtistSplit([cat.key]);
        else if(cmd==='restore-private'){const values=await requestPasswords({title:I18n.t("UIRestoreRemovedTracks2"),fields:[{key:'source',label:I18n.t("UIPasswordFor", {value1:(cat.label)})}]});if(values){const result=await runVaultCommand({type:'restore',key:cat.key,password:values.source});await refreshAfterVault(result);}}
        else if (cmd === 'hide') await hideCategory(cat.key);
        else if (cmd === 'delete') await deleteCategory(cat.key);
        return;
      }
      const item = e.target.closest('[data-menu]'); if (!item) return;
      if (item.dataset.menu === 'addTo') { e.stopPropagation(); const wrap=e.target.closest('.context-submenu-wrap'); if(wrap){const open=!wrap.classList.contains('open')||wrap.dataset.sticky!=='1';wrap.dataset.sticky=open?'1':'0';if(open)positionTrackSubmenu(wrap);else wrap.classList.remove('open');} return; }
      const t = findTrack(menu.dataset.trackId); hideContextMenu(); if (!t) return;
      if(item.dataset.menu==='remove-current')removeChosenTracks([t]).catch(e=>toast('bad',I18n.t("UICouldNotRemoveTheSong"),I18n.errorMessage(e)||String(e)));
      if (item.dataset.menu === 'favorite') toggleFavorite(t);
      if (item.dataset.menu === 'reveal') api.library.reveal(t.rel);
      if (item.dataset.menu === 'source' && t.sourceUrl) api.system.openExternal(t.sourceUrl);
      if (item.dataset.menu === 'trim') openTrimForTrack(t);
      if (item.dataset.menu === 'delete') askDelete(t);
    });

    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('#contextMenu,[data-track-tools-popover]') && !e.target.closest('[data-action="menu"]')) hideContextMenu();
      if (!e.target.closest('#sortControl')) closeSortPopover();
    });
    // Finish edit mode AFTER the clicked control handles its action. Removing
    // the hidden-playlist rail on pointerdown moved tracks before pointerup,
    // so the first click on a menu or layout control could be lost.
    document.addEventListener('click', (e) => {
      if (state.categoryEditMode && !state.categoryDrag && !playlistSelection?.withinZone(e) && !e.target.closest('[data-category],[data-add-category],[data-restore-category],#hiddenCategories,#contextMenu,#playlistLayoutControl,.modal-layer:not(.hidden)')) {
        state.categoryEditMode=false;state.categorySignature='';renderCategories(true);
      }
    });

    $('#playBtn').addEventListener('click', togglePlay);
    $('#prevBtn').addEventListener('click', prevTrack);
    $('#nextBtn').addEventListener('click', () => nextTrack(false));
    $('#shuffleBtn').addEventListener('click', toggleShuffleMode);
    $('#repeatBtn').addEventListener('click', cycleRepeatMode);
    $('#playerFavorite').addEventListener('click', () => toggleFavorite(currentTrack()));
    $('#seek').addEventListener('input', (e) => {
      const d = audio.duration || currentTrack()?.duration || 0;
      if (d) audio.currentTime = (Number(e.target.value) / 1000) * d;
      setRangeFill(e.target, Number(e.target.value) / 10);
    });
    $('#volume').addEventListener('input', (e) => setVolume(Number(e.target.value) / 100, true));
    $('#volume').addEventListener('change', (e) => { const v=Math.max(0,Math.min(1,Number(e.target.value)/100)); state.settings.volume=v; api.settings.set({volume:v}).catch(()=>{}); });
    $('#muteBtn').addEventListener('click', toggleMute);
    $('#onlinePreviewMute').addEventListener('click',toggleMute);
    audio.addEventListener('volumechange',()=>{onlinePreviewAudio.volume=audio.volume;onlinePreviewAudio.muted=audio.muted;updatePreviewMuteButton();});

    audio.addEventListener('play', () => {
      if (!guardPlayback('local')) return;
      updatePlayerUI(); patchTrackVisuals([state.currentId]); updateMediaSession(); ensureAudioAnalyser(); syncOverlayState(true);
    });
    audio.addEventListener('playing', () => { guardPlayback('local'); });
    audio.addEventListener('pause', () => { updatePlayerUI(); patchTrackVisuals([state.currentId]); updateMediaSession(); syncOverlayState(true); });
    audio.addEventListener('ended', () => nextTrack(true));
    audio.addEventListener('timeupdate', () => {
      const d = audio.duration || 0;
      const ratio = d ? audio.currentTime / d : 0;
      $('#seek').value = Math.round(ratio * 1000);
      setRangeFill($('#seek'), ratio * 100);
      $('#currentTime').textContent = formatTime(audio.currentTime);
      syncOverlayState();
    });
    audio.addEventListener('loadedmetadata', () => {
      const d = Number.isFinite(audio.duration) ? audio.duration : 0;
      $('#totalTime').textContent = formatTime(d);
      const t = currentTrack(); if (t && d > 0) { t.duration = d; patchDuration(t); updateMeta(); }
      syncOverlayState(true);
    });
    audio.addEventListener('error', () => { if (audio.src) toast('bad',I18n.t("UICouldNotOpenThisFile"),I18n.t("UIBuiltInPlayerMayNotSupportThisFormat")); });

    $$('.modal-close').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));
    $$('.modal-layer').forEach((layer) => layer.addEventListener('pointerdown', (e) => { if (e.target === layer && layer.id !== 'confirmModal') closeModal(layer.id); }));
    $('#confirmCancel').addEventListener('click', cancelConfirmation);
    $('#confirmDelete').addEventListener('click', runPendingConfirmation);

    $('#onlineSearchBtn').addEventListener('click', doOnlineSearch);

    $('#onlineResults').addEventListener('click', (e) => {
      const preview = e.target.closest('[data-online-preview]');
      if (preview) { previewOnline(preview.dataset.onlinePreview); return; }
      const download = e.target.closest('[data-online-download]');
      if (download) { if (!download.disabled) prepareDownload(download.dataset.onlineDownload); return; }
      const item = e.target.closest('[data-online-item]');
      if (item && !item.classList.contains('search-result-blocked')) previewOnline(item.dataset.onlineItem);
    });
    $('#onlineResults').addEventListener('keydown', (e) => {
      const item = e.target.closest('[data-online-item]');
      if (!item || e.target.closest('button')) return;
      if (e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); if(!item.classList.contains('search-result-blocked'))previewOnline(item.dataset.onlineItem); }
    });
    onlinePreviewAudio.addEventListener('play', () => {
      if (!guardPlayback('online')) return;
      if (state.onlinePreview) setOnlinePreviewButton(state.onlinePreview.sourceUrl, true);
      updateOnlinePreviewBar();
    });
    onlinePreviewAudio.addEventListener('playing', () => { guardPlayback('online'); });
    onlinePreviewAudio.addEventListener('pause', () => { if (state.onlinePreview) setOnlinePreviewButton(state.onlinePreview.sourceUrl, false); updateOnlinePreviewBar(); });
    onlinePreviewAudio.addEventListener('timeupdate', updateOnlinePreviewBar);
    onlinePreviewAudio.addEventListener('loadedmetadata', updateOnlinePreviewBar);
    onlinePreviewAudio.addEventListener('ended', () => {
      releasePlayback('online');
      if (state.onlinePreview) setOnlinePreviewButton(state.onlinePreview.sourceUrl, false);
      updateOnlinePreviewBar();
    });
    $('#onlinePreviewToggle').addEventListener('click', async () => {
      if (!state.onlinePreview) return;
      if (onlinePreviewAudio.paused) {
        const token = claimPlayback('online');
        try { await playClaimed('online', token, onlinePreviewAudio); } catch {}
      } else {
        onlinePreviewAudio.pause();
        releasePlayback('online');
      }
    });
    $('#onlinePreviewClose').addEventListener('click', stopOnlinePreview);

    $('#trimStart').addEventListener('input', (e) => { if (!state.trim) return; state.trim.start = Number(e.target.value); syncTrimUI('start'); });
    $('#trimEnd').addEventListener('input', (e) => { if (!state.trim) return; state.trim.end = Number(e.target.value); syncTrimUI('end'); });
    $$('#trimModal [data-trim-nudge]').forEach((b) => b.addEventListener('click', () => {
      if (!state.trim) return;
      const [side, delta] = b.dataset.trimNudge.split(':');
      state.trim[side] += Number(delta) || 0;
      syncTrimUI(side);
    }));
    $('#applyAutoTrim').addEventListener('click', applyAutoTrim);
    $('#autoTrimCard').addEventListener('dblclick', applyAutoTrim);
    $('#autoTrimCard').addEventListener('keydown', (e) => { if (e.key === 'Enter' && state.trim?.suggestion) applyAutoTrim(); });
    $('#resetTrim').addEventListener('click', () => { if (!state.trim) return; state.trim.start = 0; state.trim.end = state.trim.duration; syncTrimUI(); });
    $('#trimPreviewToggle').addEventListener('click', async () => {
      if (!state.trim || !trimPreviewAudio.src) return;
      if (!trimPreviewAudio.paused) { trimPreviewAudio.pause(); return; }
      if (trimPreviewAudio.ended || trimPreviewAudio.currentTime >= (state.trim.duration || Infinity) - .05) trimPreviewAudio.currentTime = Math.max(0,Number(state.trim.start)||0);
      const token = claimPlayback('trim');
      try { await playClaimed('trim', token, trimPreviewAudio); } catch (e) { toast('bad',I18n.t("UICouldNotStartTheAudioPreview"), I18n.errorMessage(e) || String(e)); }
    });
    $('#trimSeek').addEventListener('input',(e)=>{if(!state.trim||!trimPreviewAudio.src)return;trimPreviewAudio.currentTime=clamp(e.target.value,0,state.trim.duration||Number(e.target.max)||0);syncTrimTransport();});
    $('#trimJumpStart').addEventListener('click',()=>{if(trimPreviewAudio.src){trimPreviewAudio.currentTime=Math.max(0,Number(state.trim?.start)||0);syncTrimTransport();}});
    $('#trimRewind').addEventListener('click',()=>{if(trimPreviewAudio.src){trimPreviewAudio.currentTime=Math.max(0,trimPreviewAudio.currentTime-5);syncTrimTransport();}});
    $('#trimForward').addEventListener('click',()=>{if(trimPreviewAudio.src){trimPreviewAudio.currentTime=Math.min(state.trim?.duration||trimPreviewAudio.duration||Infinity,trimPreviewAudio.currentTime+5);syncTrimTransport();}});
    trimPreviewAudio.addEventListener('play', () => { if (!guardPlayback('trim')) return; syncTrimTransport(); });
    trimPreviewAudio.addEventListener('playing', () => { guardPlayback('trim'); syncTrimTransport(); });
    trimPreviewAudio.addEventListener('pause', syncTrimTransport);
    trimPreviewAudio.addEventListener('timeupdate', syncTrimTransport);
    trimPreviewAudio.addEventListener('loadedmetadata', syncTrimTransport);
    $('#trimCancel').addEventListener('click', () => closeModal('trimModal'));
    $('#trimDownload').addEventListener('click', async () => {
      if (!state.trim) return;
      const { sourceUrl, start, end } = state.trim;
      closeModal('trimModal');
      await downloadOnline(sourceUrl, { start, end });
    });

    $$('.theme-option').forEach((b) => b.addEventListener('click', async () => {
      if ((state.suppressThemeClickUntil || 0) > performance.now()) return;
      if (state.settings.theme === b.dataset.theme) return;
      const previousTheme = state.settings.theme;
      const requestedTheme = b.dataset.theme;
      const change = () => { state.settings.theme = requestedTheme; applyAppearance(); };
      if (document.startViewTransition) document.startViewTransition(change); else { document.documentElement.classList.add('theme-switching'); change(); setTimeout(() => document.documentElement.classList.remove('theme-switching'), 360); }
      try {
        const saved = await api.settings.set({ theme:requestedTheme });
        state.settings.theme = saved?.theme || requestedTheme;
        applyAppearance();
      } catch (error) {
        state.settings.theme = previousTheme;
        applyAppearance();
        toast('bad',I18n.t("UIThemeNotSaved"),I18n.errorMessage(error) || I18n.t("UICouldNotWriteSettingsTryAgain"));
      }
    }));
    $$('#accentOptions button[data-accent]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.accent === 'custom') { openRgbModal(state.settings.customAccent || '#b038ae',{type:'accent'}); return; }
      state.settings.accent = b.dataset.accent;
      state.settings.customAccent = b.dataset.color || accentValues[b.dataset.accent] || state.settings.customAccent;
      applyAppearance();
      await api.settings.set({ accent:state.settings.accent, customAccent:state.settings.customAccent });
    }));

    $('#colorPlane').addEventListener('pointerdown', (e) => { e.currentTarget.setPointerCapture(e.pointerId); updateColorPlaneFromPointer(e); });
    $('#colorPlane').addEventListener('pointermove', (e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) updateColorPlaneFromPointer(e); });
    $('#colorHue').addEventListener('input', (e) => { state.colorDraft.h=Number(e.target.value); syncRgbControls(); });
    for (const key of ['R','G','B']) $('#rgb'+key+'Number').addEventListener('input', (e) => updateRgb(key,e.target.value));
    for (const key of ['H','S','L']) $('#hsl'+key+'Number').addEventListener('input', (e) => updateHsl(key,e.target.value));
    $('#colorHexInput').addEventListener('input', (e) => { if (e.target.value.length >= 6) updateColorFromHex(e.target.value); });
    $('#colorHexInput').addEventListener('paste', () => setTimeout(() => updateColorFromHex($('#colorHexInput').value),0));
    $('#copyHexBtn').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#colorHexInput').value.toUpperCase()); toast('good',I18n.t("UIHEXCopied"),$('#colorHexInput').value.toUpperCase(),1200); } catch {} });
    $$('.color-tabs [data-color-model]').forEach((b) => b.addEventListener('click', () => { state.colorDraft.model=b.dataset.colorModel; syncRgbControls(); }));
    $('#rgbCancel').addEventListener('click', () => closeModal('colorModal'));
    $('#rgbApply').addEventListener('click', applyColorPicker);

    $$('#appIconOptions [data-app-icon]').forEach((b) => b.addEventListener('click', async () => {
      if (b.id === 'customIconBtn' || b.dataset.appIcon === 'custom-gradient') { openCustomIconDesigner(); return; }
      state.settings.appIcon = b.dataset.appIcon; applyAppearance(); await api.settings.set({appIcon:state.settings.appIcon}); await applyAppIconPreview();
    }));
    $('#surfaceStyleOptions')?.addEventListener('click', async (e) => { const b=e.target.closest('[data-surface-style]'); if(!b)return; updateSurface({surfaceStyle:b.dataset.surfaceStyle}); applyAppearance(); await persistSurfaceSettings(); });
    $('#surfaceApplyAll').addEventListener('change',async e=>{state.settings.surfaceApplyAll=e.target.checked;applyAppearance();await persistSurfaceSettings();});
    $('#surfaceTargetOptions').addEventListener('click',e=>{const b=e.target.closest('[data-surface-target]');if(!b)return;surfaceTarget=b.dataset.surfaceTarget;applyAppearance();});
    $('#surfaceCommonResetBtn').addEventListener('click',async()=>{Object.assign(state.settings,Surface.resetToCommon(state.settings,surfaceTarget));applyAppearance();await persistSurfaceSettings();});
    let surfaceDebounce=0;
    const queueSurfaceSave=()=>{ clearTimeout(surfaceDebounce); surfaceDebounce=setTimeout(persistSurfaceSettings,180); };
    $('#surfaceOpacity')?.addEventListener('input',(e)=>{ updateSurface({surfaceOpacity:clamp(Number(e.target.value),0,100)}); applyAppearance(); queueSurfaceSave(); });
    $('#surfaceBorderOpacity')?.addEventListener('input',(e)=>{ updateSurface({surfaceBorderOpacity:clamp(Number(e.target.value),0,100)}); applyAppearance(); queueSurfaceSave(); });
    $('#surfaceBorderThickness')?.addEventListener('input',(e)=>{ updateSurface({surfaceBorderThickness:clamp(Number(e.target.value),0,6)}); applyAppearance(); queueSurfaceSave(); });
    $('#surfaceBorderColorBtn').addEventListener('click',()=>openRgbModal(selectedSurface().surfaceBorderColor,{type:'surface-border',surfaceGroup:surfaceTarget}));
    for(const id of ['surfaceOpacity','surfaceBorderOpacity','surfaceBorderThickness']) $('#'+id).addEventListener('change',()=>{clearTimeout(surfaceDebounce);persistSurfaceSettings();});
    $('#surfaceResetBtn').addEventListener('click',async()=>{
      clearTimeout(surfaceDebounce);
      updateSurface(Surface.defaults);
      applyAppearance();await persistSurfaceSettings();
    });
    $('#customBgStops')?.addEventListener('input',(e)=>{ if(!state.customIconDraft)return; const color=e.target.closest('[data-custom-stop-color]'); const pos=e.target.closest('[data-custom-stop-pos]'); if(color){ const [kind,index]=color.dataset.customStopColor.split(':'); state.customIconDraft[kind][Number(index)].color=color.value; renderCustomIconPreview(); return; } if(pos){ const [kind,index]=pos.dataset.customStopPos.split(':'); state.customIconDraft[kind][Number(index)].pos=clamp(Number(pos.value),0,100); pos.nextElementSibling.textContent=`${pos.value}%`; setRangeFill(pos,Number(pos.value)); renderCustomIconPreview(); }});
    $('#customFgStops')?.addEventListener('input',(e)=>{ if(!state.customIconDraft)return; const color=e.target.closest('[data-custom-stop-color]'); const pos=e.target.closest('[data-custom-stop-pos]'); if(color){ const [kind,index]=color.dataset.customStopColor.split(':'); state.customIconDraft[kind][Number(index)].color=color.value; renderCustomIconPreview(); return; } if(pos){ const [kind,index]=pos.dataset.customStopPos.split(':'); state.customIconDraft[kind][Number(index)].pos=clamp(Number(pos.value),0,100); pos.nextElementSibling.textContent=`${pos.value}%`; setRangeFill(pos,Number(pos.value)); renderCustomIconPreview(); }});
    const bindStopClick=(rootId)=>$(rootId)?.addEventListener('click',(e)=>{ if(!state.customIconDraft)return; const rm=e.target.closest('[data-custom-stop-remove]'); if(!rm)return; const [kind,index]=rm.dataset.customStopRemove.split(':'); const list=state.customIconDraft[kind]; const min=kind==='bg'?2:1; if(list.length<=min)return; list.splice(Number(index),1); renderCustomIconEditor(); });
    bindStopClick('#customBgStops'); bindStopClick('#customFgStops');
    $('#addBgStopBtn')?.addEventListener('click',()=>{ if(!state.customIconDraft)return; if(state.customIconDraft.bg.length>=7)return; const last=state.customIconDraft.bg.at(-1)||{color:'#ffffff',pos:100}; state.customIconDraft.bg.push({ color:last.color, pos:Math.min(100, Number(last.pos)+10) }); renderCustomIconEditor(); });
    $('#addFgStopBtn')?.addEventListener('click',()=>{ if(!state.customIconDraft)return; if(state.customIconDraft.fg.length>=4)return; const last=state.customIconDraft.fg.at(-1)||{color:'#ffffff',pos:100}; state.customIconDraft.fg.push({ color:last.color, pos:Math.min(100, Number(last.pos)+20) }); renderCustomIconEditor(); });
    $('#customIconCancel')?.addEventListener('click',()=>closeModal('customIconModal'));
    $('#customIconSave')?.addEventListener('click',saveCustomIcon);
    $('#uploadBackgroundBtn').addEventListener('click', chooseBackground);
    $('#backgroundMode').addEventListener('click', async (e) => { const b=e.target.closest('[data-background-mode]'); if(!b)return; state.settings.backgroundMode=b.dataset.backgroundMode; applyAppearance(); await api.settings.set({backgroundMode:state.settings.backgroundMode}); });
    let backgroundOpacityTimer=0;
    $('#backgroundOpacity').addEventListener('input',(e)=>{state.settings.backgroundOpacity=clamp(e.target.value,1,100);applyAppearance();clearTimeout(backgroundOpacityTimer);backgroundOpacityTimer=setTimeout(()=>api.settings.set({backgroundOpacity:state.settings.backgroundOpacity}),180);});
    $('#backgroundOpacity').addEventListener('change',()=>api.settings.set({backgroundOpacity:state.settings.backgroundOpacity}));
    $('#backgroundHistory').addEventListener('click', async (e) => {
      const remove=e.target.closest('[data-remove-background]');
      if(remove){ e.stopPropagation(); const ref=remove.dataset.removeBackground; state.settings.backgroundHistory=(state.settings.backgroundHistory||[]).filter(x=>x!==ref); if(state.settings.customBackground===ref) state.settings.customBackground=state.settings.backgroundHistory[0]||''; await api.settings.set({backgroundHistory:state.settings.backgroundHistory,customBackground:state.settings.customBackground}); await renderBackgroundHistory(); applyLibraryBackground(); return; }
      const b=e.target.closest('[data-background-ref]'); if(!b)return; state.settings.customBackground=b.dataset.backgroundRef; state.settings.backgroundMode='custom'; applyAppearance(); await api.settings.set({customBackground:state.settings.customBackground,backgroundMode:'custom'}); await renderBackgroundHistory();
    });
    $('#playlistLayoutControl').addEventListener('click', async (e) => { const b=e.target.closest('button[data-category-layout]'); if(!b||!e.currentTarget.contains(b))return; state.categoryEditMode=false; state.settings.categoryLayout=b.dataset.categoryLayout; applyAppearance(); state.categorySignature=''; renderCategories(true); await persistCategorySettings(); });

    $('#categoryIconGrid').addEventListener('click',(e)=>{const b=e.target.closest('[data-category-icon]');if(!b||!state.categoryDraft)return;state.categoryDraft.icon=b.dataset.categoryIcon;renderCategoryEditor();});
    $('#categoryColorOptions').addEventListener('click',(e)=>{const c=e.target.closest('[data-category-color]');if(c&&state.categoryDraft){state.categoryDraft.color=c.dataset.categoryColor;if(state.categoryDraft.gradient.length===1)state.categoryDraft.gradient[0]=c.dataset.categoryColor;renderCategoryEditor();return;}if(e.target.closest('[data-category-color-custom]')&&state.categoryDraft)openRgbModal(state.categoryDraft.color,{type:'category'});});
    $('#categoryNameInput').addEventListener('input',(e)=>{if(!state.categoryDraft)return;state.categoryDraft.name=e.target.value;updateCategoryPreviewOnly();});
    $('#categoryGlowToggle').addEventListener('change',(e)=>{if(!state.categoryDraft)return;state.categoryDraft.glow=e.target.checked;renderCategoryEditor();});
    $('#categoryGlowIntensity').addEventListener('input',(e)=>{if(!state.categoryDraft)return;state.categoryDraft.glowIntensity=Number(e.target.value);$('#categoryGlowIntensityValue').textContent=`${Math.round(state.categoryDraft.glowIntensity)}%`;setRangeFill(e.target,state.categoryDraft.glowIntensity);updateCategoryPreviewOnly();});
    $('#categoryGradientList').addEventListener('click',(e)=>{if(!state.categoryDraft)return;const sw=e.target.closest('[data-gradient-color]');if(sw){openRgbModal(state.categoryDraft.gradient[Number(sw.dataset.gradientColor)],{type:'gradient',index:Number(sw.dataset.gradientColor)});return;}const rm=e.target.closest('[data-gradient-remove]');if(rm&&state.categoryDraft.gradient.length>1){state.categoryDraft.gradient.splice(Number(rm.dataset.gradientRemove),1);renderCategoryEditor();}});
    $('#addGradientColorBtn').addEventListener('click',()=>{if(state.categoryDraft?.gradient.length<4)openRgbModal(state.categoryDraft.gradient.at(-1)||state.categoryDraft.color,{type:'gradient-add'});});
    $('#categoryStyleCancel').addEventListener('click',()=>closeModal('categoryStyleModal'));
    $('#categoryStyleSave').addEventListener('click',saveCategoryEditor);

    let gradientDragIndex=-1;
    $('#categoryGradientList').addEventListener('dragstart',(e)=>{const row=e.target.closest('[data-gradient-index]');if(!row)return;gradientDragIndex=Number(row.dataset.gradientIndex);e.dataTransfer.effectAllowed='move';});
    $('#categoryGradientList').addEventListener('dragover',(e)=>e.preventDefault());
    $('#categoryGradientList').addEventListener('drop',(e)=>{e.preventDefault();const row=e.target.closest('[data-gradient-index]');if(!row||gradientDragIndex<0||!state.categoryDraft)return;const to=Number(row.dataset.gradientIndex);const [value]=state.categoryDraft.gradient.splice(gradientDragIndex,1);state.categoryDraft.gradient.splice(to,0,value);gradientDragIndex=-1;renderCategoryEditor();});

    $('#mergeChoices').addEventListener('change', () => { $('#mergeConfirm').disabled = !$('#mergeChoices input:checked'); });
    $('#mergeCancel').addEventListener('click', () => closeModal('mergeModal'));
    $('#mergeConfirm').addEventListener('click', confirmMerge);

    $('#minBtn').addEventListener('click', () => api.window.minimize());
    $('#maxBtn').addEventListener('click', async () => updateMaxIcon(await api.window.toggleMaximize()));
    $('#closeBtn').addEventListener('click', () => api.window.close());

    document.addEventListener('keydown', (e) => {
      const editing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
      if (e.defaultPrevented || state.hotkeyRecording || trackTools?.dialog?.open) return;
      const modalOpen = !!document.querySelector('.modal-layer:not(.hidden)');
      if (!editing && !modalOpen && (e.ctrlKey || e.metaKey) && !e.altKey && ['KeyZ','KeyY'].includes(e.code)) {
        e.preventDefault(); undoTrackMove(e.code === 'KeyY' || e.shiftKey); return;
      }
      if (e.key === 'Escape') { closeTopOverlay(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); focusSearchInput(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); addFiles(); return; }
      if (!editing && !e.target.closest('button,[role=button],.search-aux-popover') && e.code === 'Space' && !e.target.closest('[data-track-root]')) { e.preventDefault(); togglePlay(); }
      if (!editing && e.key.toLowerCase() === 'm') toggleMute();
      if (!editing && e.key === 'ArrowRight' && e.altKey) nextTrack(false);
      if (!editing && e.key === 'ArrowLeft' && e.altKey) prevTrack();
    });

    window.addEventListener('beforeunload', () => {
      try {
        const playerPatch = Object.fromEntries(Object.entries(state.settings.playerOverlay).filter(([key,value]) => JSON.stringify(value) !== JSON.stringify(state.overlayLastSaved[key])));
        api.settings.flush({ volume: state.settings.volume, playerOverlay: playerPatch, ...Surface.normalize(state.settings) });
      } catch {}
    });
    window.addEventListener('resize', () => { hideContextMenu(); closeSortPopover(); });
    api.library.onChanged(() => loadLibrary({ quiet:true }));
    api.online.onProgress(acceptDownloadProgress);
    api.online.onToolStatus((p) => toast('info',I18n.t("UIPreparingTools"),p.text || '',2200,'tool'));
    api.window.onMaximized(updateMaxIcon);
    const releaseCenter=new window.PulseReleaseCenter({openPage:page=>{openModal('settingsModal');setSettingsPage(page);},isBusy:()=>{
      if(bulkBusy || state.hotkeyRecording || state.categoryDraft || state.trim || state.customIconDraft && !$('#customIconModal').classList.contains('hidden'))return true;
      if(document.querySelector('dialog[open]'))return true;
      return !!(document.querySelector('#lyricsEditor[open]')&&lyricsView?.isStudioDirty?.());
    }});

    const systemThemeQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
    systemThemeQuery?.addEventListener?.('change', updateSystemThemeSwatch);
  }

  async function init() {
    api.library.onLoudness?.(data=>{const node=$('#loudnessStatus');if(node&&data.requestId===loudnessRequest)I18n.setText(node,()=>I18n.t('LoudnessAnalyzing',{done:data.finished,total:data.total}));});
    menuReorder=new window.PulseMenuReorder({menu:$('#contextMenu'),getOrders:()=>state.settings.menuOrders||{},save:async(key,order)=>{
      const next={...(state.settings.menuOrders||{}),[key]:order};await api.settings.set({menuOrders:next});state.settings.menuOrders=next;
    },notify:error=>toast('bad',I18n.t('UIOrderNotSaved'),I18n.errorMessage(error))});
    applyIcons();
    renderSkeleton();
    lyricsView = new window.PulseLyricsView({api,audio,getTrack:currentTrack,notify:toast,requestPasswords,togglePlay,
      seek:time=>{if(!audio.src)return;const duration=Number.isFinite(audio.duration)?audio.duration:(currentTrack()?.duration||0);audio.currentTime=clamp(time,0,duration||Math.max(0,time));},
      onOpen:()=>{trackReorder?.cancel();trackSelection?.clear();playlistSelection?.clear();hideContextMenu();closeSortPopover();}
    });
    searchUI=new window.PulseOnlineSearchUI({api,formatTime,patchDownloads:patchDownloadRows,stopPreview:stopOnlinePreview,
      getTracks:()=>state.tracks,onQuery:q=>{if(state.query!==q){state.query=q;renderLibraryBody();}},playLocal:id=>selectTrack(id,true),openExpanded:()=>openModal('onlineModal'),closeExpanded:preserve=>closeModal('onlineModal',preserve===true),
      save:prefs=>{state.settings.onlineSearch=structuredClone(prefs);api.settings.set({onlineSearch:state.settings.onlineSearch}).catch(error=>toast('bad',I18n.t('SearchSettingsError'),I18n.errorMessage(error)));}});
    trackTools=new window.PulseTrackTools({api,notify:toast,submenu:playlistSubmenu,arm:armTrackSubmenu,hideMenu:hideContextMenu,
      animationEnabled,toggleAnimation, getTrackById:findTrack,getTrack:rel=>allKnownTracks().find(t=>t.rel===rel),refresh:()=>refreshAfterVault(),
      closeSearch:()=>{if(searchUI?.mode==='expanded')closeModal('onlineModal');else searchUI?.close();}});
    new window.PulseListeningTracker({audio,getTrack:()=>state.playbackOwner==='local'?currentTrack():null,isEnabled:()=>searchUI?.discovery?.enabled===true,
      command:command=>api.discovery?.command(command)||Promise.resolve({ok:false})});
    presetsUI=new window.PulsePresetsUI({api,notify:toast,confirm:openConfirmation,
      prepare:async()=>{
        clearTimeout(volumeTimer);await persistOverlaySettings(true);await overlaySaveChain;
        await api.settings.set({volume:state.settings.volume,backgroundOpacity:state.settings.backgroundOpacity,...Surface.normalize(state.settings)});
        await lyricsView?.flushPresentation();
      },
      applied:async settings=>{
        clearTimeout(volumeTimer);clearTimeout(overlayPersistTimer);clearTimeout(gameOverlayPersistTimer);
        state.settings=Library.normalizeOrganization(settings);state.overlayLastSaved=structuredClone(state.settings.playerOverlay);
        state.categorySignature='';state.librarySignature='';searchUI.configure(state.settings.onlineSearch);
        state.hotkeyStatus=await api.hotkeys.status().catch(()=>({}));
        applyAppearance();renderHotkeys();renderOverlaySettings();renderGameOverlaySettings();renderLanguages();
        await applyAppIconPreview();await renderBackgroundHistory();setVolume(state.settings.volume,false);
        lyricsView.words=state.settings.lyricsDisplay?.wordMode!=='lines';lyricsView.lastGradient=state.settings.lyricsLastGradient;lyricsView.updateTools();lyricsView.render();
        renderLibrary();updateSortControl();syncOverlayState(true);await searchUI.refreshDiscovery();
      }
    });
    bindEvents();
    bindTrackSelection();
    bindTrackReordering();
    bindPlaylistSelection();bindVaultUi();
    bindPlaylistScrolling();
    setupMediaSessionActions();
    await loadAppInfo();
    try {
      state.settings = Library.normalizeOrganization({ ...state.settings, ...(await api.settings.get()) });
      searchUI.configure(state.settings.onlineSearch);
      state.gameOverlayStatus = await api.gameOverlay.status().catch(()=>state.gameOverlayStatus);
      if (!accentValues[state.settings.accent] && state.settings.accent !== 'custom') state.settings.accent = 'purple';
      state.settings.categoryOrder = Array.isArray(state.settings.categoryOrder) ? state.settings.categoryOrder : [];
      state.settings.categoryStyles = state.settings.categoryStyles && typeof state.settings.categoryStyles === 'object' ? state.settings.categoryStyles : {};
      state.settings.customCategories = Array.isArray(state.settings.customCategories) ? state.settings.customCategories : [];
      state.settings.backgroundHistory = Array.isArray(state.settings.backgroundHistory) ? state.settings.backgroundHistory.slice(0,5) : [];
      state.settings.categoryLayout = state.settings.categoryLayout === 'side' ? 'side' : 'top';
      state.settings.backgroundMode = ['off','track','custom'].includes(state.settings.backgroundMode) ? state.settings.backgroundMode : 'off';
      state.settings.appIcon = state.settings.appIcon || 'builtin:blue-violet';
      state.settings.backgroundOpacity = clamp(state.settings.backgroundOpacity ?? 34,1,100);
      Object.assign(state.settings,Surface.normalize(state.settings));
      state.settings.hotkeys = { ...hotkeyDefaults, ...(state.settings.hotkeys || {}) };
      state.settings.playerOverlay = { ...playerOverlayDefaults, ...state.settings.playerOverlay };
      state.overlayLastSaved = structuredClone(state.settings.playerOverlay);
      state.hotkeyStatus = await api.hotkeys.status().catch(() => ({}));
      renderHotkeys();
      renderOverlaySettings();
      await migrateCustomIconMark();
      applyAppearance();
      await applyAppIconPreview();
      await renderBackgroundHistory();
      updateSortControl();
      setVolume(Number(state.settings.volume ?? .82), false);
      state.lastVolume = Number(state.settings.volume ?? .82) || .82;
      updateMaxIcon(await api.window.isMaximized());
    } catch {}
    await loadLibrary();
    if (state.settings.lastTrack) {
      const last = state.tracks.find((t) => t.rel === state.settings.lastTrack);
      if (last) await selectTrack(last.id, false);
    }
    applyLibraryBackground();
    renderOnlineNotice();
    searchUI.refreshDiscovery();
    syncOverlayState(true);
    { const gm=state.settings.gameOverlay?.mode||'auto'; if (state.settings.playerOverlay?.visualizer && (state.settings.playerOverlay?.mode !== 'off' || gm==='auto' || gm==='rtss')) ensureAudioAnalyser(); }
  }


  let languageBusy = false;
  function renderLanguages() {
    const list=$('#languageList'); if(!list)return;
    // Avoid replacing a focused radio on ordinary catalog refresh.
    const focused=document.activeElement?.closest('[data-language]')?.dataset.language;
    list.replaceChildren(...I18n.languages.map(language=>{
      const label=document.createElement('label');label.className='language-option';
      const radio=document.createElement('input');radio.type='radio';radio.name='app-language';radio.value=language.code;
      radio.dataset.language=language.code;radio.checked=language.code===I18n.language;radio.disabled=languageBusy;
      label.append(radio);
      if(language.iconUrl){const img=document.createElement('img');img.src=language.iconUrl;img.alt='';img.setAttribute('aria-hidden','true');img.addEventListener('error',()=>img.remove(),{once:true});label.append(img);}
      const name=document.createElement('span');name.textContent=language.name;
      const code=document.createElement('small');code.textContent=language.code;name.append(code);label.append(name);
      radio.addEventListener('change',()=>chooseLanguage(language.code));return label;
    }));
    if(focused)list.querySelector(`[data-language="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
    I18n.setText($('#languageDiagnostics'),()=>I18n.diagnostics.map(d=>I18n.t(d.key,d.params)).join('\n'));
    if(!I18n.languages.some(l=>l.code===I18n.language))I18n.setText($('#languageStatus'),()=>I18n.t('LanguageUnavailable',{code:I18n.language}));
  }
  async function refreshLanguages() {
    try {const snapshot=await api.i18n?.reload();if(snapshot)I18n.applySnapshot(snapshot);else renderLanguages();}
    catch(error){I18n.setText($('#languageStatus'),()=>I18n.t('LanguageReloadFailed',{detail:I18n.errorMessage(error)}));}
  }
  async function chooseLanguage(code) {
    if(languageBusy || code===I18n.language)return;
    languageBusy=true;renderLanguages();
    try {
      const snapshot=await api.i18n.setLanguage(code);
      state.settings.language=snapshot.language;I18n.applySnapshot(snapshot);
      I18n.setText($('#languageStatus'),()=>I18n.t('LanguageSaved'));
    } catch(error){I18n.setText($('#languageStatus'),()=>I18n.t('LanguageSaveFailed',{detail:I18n.errorMessage(error)}));}
    finally{languageBusy=false;renderLanguages();$('#languageList')?.querySelector(`[data-language="${CSS.escape(I18n.language)}"]`)?.focus({preventScroll:true});}
  }
  $('#reloadLanguagesBtn').addEventListener('click',refreshLanguages);
  $('#openLanguagesFolderBtn').addEventListener('click',async()=>{
    try {const detail=await api.i18n.openFolder();if(detail)throw Error(detail);}
    catch(error){I18n.setText($('#languageStatus'),()=>I18n.errorMessage(error));}
  });
  document.addEventListener('pulsedeck:language-changed',()=>{
    const fields=[...$('#library').querySelectorAll('input,textarea,select')].map((node,index)=>({index,value:node.value,focused:node===document.activeElement,start:node.selectionStart,end:node.selectionEnd}));
    state.settings.language=I18n.language;
    state.categorySignature='';state.librarySignature='';
    renderCategories(true);renderLibraryBody();
    const restored=[...$('#library').querySelectorAll('input,textarea,select')];for(const field of fields){const node=restored[field.index];if(!node)continue;node.value=field.value;if(field.focused){node.focus({preventScroll:true});if(typeof field.start==='number')try{node.setSelectionRange(field.start,field.end);}catch{}}}
    updateMeta();updateSortControl();updatePlayerUI();
    renderHotkeys();renderGameOverlaySettings();patchDownloadRows();renderLanguages();
    // Relocalize owned labels only; never re-load tracks or reset a lyrics draft.
    lyricsView?.onLanguageChanged?.();
    I18n.refreshBindings();
  });

  init();
})();

})();
