/* Per-component surface profiles. No DOM scanning and no persisted CSS strings. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PulseSurfaceStyle=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const defaults=Object.freeze({surfaceStyle:'glass',surfaceOpacity:94,surfaceBorderColor:'#d9e5f0',surfaceBorderOpacity:18,surfaceBorderThickness:1});
  const keys=Object.freeze(Object.keys(defaults));
  const groups=Object.freeze(['windows','menus','contextMenus','blocks','controls','bars','notifications']);
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const number=(v,f,max)=>v===null||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))?f:Math.max(0,Math.min(max,Number(v)));
  function profile(raw={},fallback=defaults){
    raw=object(raw)?raw:{};
    return {surfaceStyle:['glass','gradient','translucent','outline','invisible'].includes(raw.surfaceStyle)?raw.surfaceStyle:fallback.surfaceStyle,
      surfaceOpacity:number(raw.surfaceOpacity,fallback.surfaceOpacity,100),
      surfaceBorderColor:/^#[0-9a-f]{6}$/i.test(raw.surfaceBorderColor||'')?raw.surfaceBorderColor.toLowerCase():fallback.surfaceBorderColor,
      surfaceBorderOpacity:number(raw.surfaceBorderOpacity,fallback.surfaceBorderOpacity,100),
      surfaceBorderThickness:number(raw.surfaceBorderThickness,fallback.surfaceBorderThickness,6)};
  }
  function normalize(raw={}){
    raw=object(raw)?raw:{};const common=profile(raw),profiles={};
    for(const group of groups)if(object(raw.surfaceProfiles)&&Object.hasOwn(raw.surfaceProfiles,group)&&object(raw.surfaceProfiles[group]))profiles[group]=profile(raw.surfaceProfiles[group],common);
    return {...common,surfaceApplyAll:raw.surfaceApplyAll===true,surfaceProfiles:profiles};
  }
  function current(settings,group='blocks'){
    const common=profile(settings);
    return settings.surfaceApplyAll===true||!groups.includes(group)?common:profile(settings.surfaceProfiles?.[group],common);
  }
  function update(settings,group,patch){
    const next=normalize(settings);
    if(next.surfaceApplyAll||!groups.includes(group))Object.assign(next,profile({...profile(next),...patch}));
    else next.surfaceProfiles[group]=profile({...current(next,group),...patch});
    return next;
  }
  function resetToCommon(settings,group){const next=normalize(settings);if(groups.includes(group))delete next.surfaceProfiles[group];return next;}
  function tokens(p){
    const invisible=p.surfaceStyle==='invisible',clear=invisible||p.surfaceStyle==='outline',a=p.surfaceOpacity/100;
    const rgb=[1,3,5].map(i=>parseInt(p.surfaceBorderColor.slice(i,i+2),16)).join(',');
    return {'panel-bg':clear?'transparent':`color-mix(in srgb,var(--surface-2) ${p.surfaceOpacity}%,transparent)`,
      'panel-gradient':!clear&&p.surfaceStyle==='gradient'?`linear-gradient(145deg,rgba(var(--accent-rgb),${a*.16}),transparent 76%)`:'none',
      'panel-border':invisible?'transparent':`rgba(${rgb},${p.surfaceBorderOpacity/100})`,
      'panel-filter':!clear&&a>0&&p.surfaceStyle==='glass'?'blur(16px) saturate(1.12)':'none',
      'surface-effective-width':invisible?'0px':`${p.surfaceBorderThickness}px`,
      'panel-hover-tint':clear?'transparent':`color-mix(in srgb,var(--text) ${a*5}%,transparent)`,
      'panel-selected-tint':clear?'transparent':`color-mix(in srgb,var(--accent) ${a*14}%,transparent)`};
  }
  // Each actual surface is assigned once. A nested button does NOT inherit a
  // dialog's profile, and a submenu does NOT inherit a settings card's profile.
  const selectors={
    windows:'.modal,.ly-dialog,.library-import-dialog',
    menus:'.select-popover,.ly-studio-menu,.settings-nav,.search-popover,.search-aux-popover',
    contextMenus:'.context-menu,.context-submenu',
    blocks:`.library.list-view,.category-sidebar,.track-card,.setting-card,.player-config-card,.player-control-field,.player-switch-card,
      .settings-reset-footer,.hotkey-row,.background-opacity-row,.switch-row:not(.compact-switch),.trim-media,.trim-control-row,.auto-trim-card,
      .online-preview-bar,.notice,.vault-lock-panel,.vault-info-banner,.vault-warning,.vault-editor-security,.game-overlay-explainer,
      .game-overlay-live-main,.game-overlay-meta,.game-overlay-detected-item,.game-overlay-rtss-metrics>span,.game-overlay-compat>span,
      .game-overlay-anchor-field,.game-overlay-offset-grid,.game-overlay-stretch-state,.merge-choice,.language-option,.custom-stop-row,
      .gradient-color-row,.custom-icon-preview,.category-preview,.category-icon-grid,.trim-wave,.ly-word-panel,.ly-result,.ly-timing-row,
      .ly-gradient-stop,.ly-warning,.ly-studio-player,.about-author,.playlist-drag-ghost.playlist-drag-from-sidebar`,
    controls:`.button.secondary,.button.accent-outline,.icon-button:not(.subtle):not(#prevBtn):not(#nextBtn),.select-trigger,.segmented,.source-tab,
      .online-download,.hotkey-combo,.element-toggle-grid button,.choice-button-row button,.visualizer-style-grid button,.game-overlay-mode-grid button,
      .game-overlay-anchor-grid button,.overlay-color-button,.app-icon-grid>button,.trim-nudges button,.trim-transport-button.primary,.top-search,
      .modal-search,.url-import,.track-selection-status button,.field-label input:not([type=range]):not([type=color]):not([type=checkbox]):not([type=radio]),
      .vault-inline-form input,.vault-password-field input,.batch-target,.game-overlay-offset-grid input,.ly-dialog select,#lyricsInput,
      .ly-dialog input:not([type=color]):not([type=range]):not([type=checkbox]):not(.ly-time-part),.ly-time-segments,.game-overlay-status-pill,
      .game-overlay-allow-chip,.game-overlay-flow>span`,
    bars:'.titlebar,.player,.track-selection-status',
    notifications:'.toast,#vaultOperationStatus'
  };
  function scopeCSS(){return groups.map(g=>`html[data-surface-style] :where(${selectors[g]}){${Object.keys(tokens(defaults)).map(k=>`--${k}:var(--pd-${g}-${k});`).join('')}}`).join('\n');}
  function paint(root,settings){
    const common=profile(settings);
    root.dataset.surfaceStyle=common.surfaceStyle;root.dataset.surfaceClear=String(common.surfaceOpacity===0);
    root.dataset.surfaceApplyAll=String(settings.surfaceApplyAll===true);
    for(const g of groups)for(const [k,v]of Object.entries(tokens(current(settings,g))))root.style.setProperty(`--pd-${g}-${k}`,v);
  }
  return Object.freeze({defaults,keys,groups,selectors,profile,normalize,current,update,resetToCommon,tokens,scopeCSS,paint});
});
