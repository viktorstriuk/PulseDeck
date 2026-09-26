'use strict';
(() => {
const I18n = window.PulseI18n;
'use strict';
// Lyrics own neither playback nor a second media element. currentTime is authoritative.
window.PulseLyricsView=class PulseLyricsView{
  constructor({api,audio,getTrack,notify,requestPasswords,onOpen=()=>{},togglePlay,seek}){
    Object.assign(this,{api,audio,getTrack,notify,requestPasswords,onOpen,togglePlay,seek});
    this.L=window.PulseLyrics;this.E=window.PulseLyricsEditor;this.timing=this.E.preferences();this.wordDrafts=new Map();this.C=window.PulseLyricsColors;this.opened=false;this.epoch=0;this.coverEpoch=0;this.frame=0;this.follow=true;this.words=true;
    this.track=null;this.doc=null;this.timing=this.E.preferences();this.recordingId='';this.revision=null;this.rows=[];this.nodes=[];this.active=[];this.theme=this.L.theme();this.coverReady=false;this.average=[48,32,54];
    this.saveTail=Promise.resolve();this.themeTouched=false;this.searchGeneration=0;this.busy=false;this.exporting=false;
    this.mount();this.backdrop=new window.PulseLyricsScene(this.view.querySelector(".ly-backdrop"));this.immersive=new window.PulseLyricsImmersive(this);this.bind();this.initStudio?.();
  }
  $(id){return document.getElementById(id);}
  icon(name,size=20){if(name==='mic')return `<span class="ly-microphone" aria-hidden="true" style="width:${size}px;height:${size}px"></span>`;const paths={
    mic:'<rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
    gradient:'<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8 4v16m4-16v16m4-16v16"/>',
    solid:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
    cover:'<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-7 5 8"/>',
    words:'<path d="M3 5h18M3 10h7M14 10h7M3 15h18M3 20h7m4 0h7"/>',
    lines:'<path d="M3 5h18M3 12h18M3 19h14"/>',
    erase:'<path d="m4 14 9-10 7 7-8 9H8l-4-4zM9 8l7 7M12 20h9"/>',
    sort:'<path d="M6 3v17m-3-3 3 3 3-3M12 5h9m-9 7h6m-6 7h3"/>',
    sync:'<circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/><circle cx="12" cy="12" r="1"/>',
    focus:'<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  };return paths[name]?`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`:window.Icon(name,size);}
  onLanguageChanged(){
    this.updateTools();
    I18n.refreshBindings();
    // No trackChanged(force), parsing, saving, editor reset, or input replacement.
    // Existing editable words/time fields retain their values, focus and history.
  }
  button(id,icon,key){return `<button type="button" id="${id}" class="ly-icon" data-i18n-title="${key}" data-i18n-aria-label="${key}" title="${I18n.h(key)}" aria-label="${I18n.h(key)}">${this.icon(icon)}</button>`;}
  mount(){
    const view=document.createElement('section');view.id='lyricsView';view.className='lyrics-view hidden';I18n.setAttribute(view,'aria-label',()=>(I18n.t("LyricsTitle")));
    view.innerHTML=`<div class="ly-backdrop" aria-hidden="true"><img id="lyricsCover" alt="" draggable="false"><div id="lyricsScrim"></div></div>
      <header class="ly-header"><div class="ly-heading"><span class="ly-eyebrow" id="lyricsArtist" data-i18n="LyricsPULSEDECKLYRICS">${I18n.h("LyricsPULSEDECKLYRICS")}</span><h2 id="lyricsTitle" data-i18n="LyricsTitle">${I18n.h("LyricsTitle")}</h2><span id="lyricsStatus" class="ly-status" role="status"></span></div>
      <div class="ly-tools">${this.button('lyricsWordMode','words',"LyricsWordHighlighting")}${this.button('lyricsBackgroundMode','gradient',"LyricsBackgroundGradient")}${this.button('lyricsSettingsBtn','settings',"LyricsAppearanceAndTiming")}${this.button('lyricsEditBtn','edit',"LyricsEditLyrics")}${this.button('lyricsFocusBtn','focus',"LyricsLyricsOnly")}${this.button('lyricsCloseBtn','close',"LyricsReturnToLibrary")}</div></header>
      <div id="lyricsScroller" class="ly-scroller" tabindex="0" aria-label="${I18n.h("LyricsLyricsScrollFreelyClickALineToSeek")}" data-i18n-aria-label="LyricsLyricsScrollFreelyClickALineToSeek"><div id="lyricsLines" class="ly-lines"></div></div>
      <div id="lyricsEmpty" class="ly-empty"><div class="ly-empty-icon">${this.icon('mic',36)}</div><h3 id="lyricsEmptyTitle" data-i18n="LyricsEverySongHasWords">${I18n.h("LyricsEverySongHasWords")}</h3><p id="lyricsEmptyText" data-i18n="LyricsFindLyricsPasteYourOwnOrAddTimings">${I18n.h("LyricsFindLyricsPasteYourOwnOrAddTimings")}</p><div class="ly-actions"><button id="lyricsFindBtn" class="ly-pill ly-primary">${this.icon('search',17)}<span data-i18n="LyricsFindLyrics">${I18n.h("LyricsFindLyrics")}</span></button><button id="lyricsPasteBtn" class="ly-pill">${this.icon('edit',17)}<span data-i18n="LyricsPasteLyrics">${I18n.h("LyricsPasteLyrics")}</span></button><button id="lyricsImportBtn" class="ly-pill">${this.icon('folder',17)}<span data-i18n="LyricsImport">${I18n.h("LyricsImport")}</span></button></div><div id="lyricsEmptySecondary" class="ly-empty-secondary"></div></div>
      <button id="lyricsResync" class="ly-resync hidden">${this.icon('sync',17)}<span data-i18n="LyricsSynchronise">${I18n.h("LyricsSynchronise")}</span></button>
      <div class="ly-bottom"><button id="lyricsSourceBtn" class="ly-link" title="${I18n.h("LyricsSearchAndSource")}" data-i18n-title="LyricsSearchAndSource" data-i18n="LyricsSearchAndSource">${I18n.h("LyricsSearchAndSource")}</button><span id="lyricsModeInfo"></span><span id="lyricsExportActions" class="ly-export-actions"><button id="lyricsZipBtn" class="ly-link">${this.icon('download',15)}<span data-i18n="LyricsAIZIPPackage">${I18n.h("LyricsAIZIPPackage")}</span></button><button id="lyricsExportBtn" class="ly-link" data-i18n="LyricsExportLyrics">${I18n.h("LyricsExportLyrics")}</button><button id="lyricsCancelExport" class="ly-link hidden" data-i18n="LyricsCancelExport">${I18n.h("LyricsCancelExport")}</button></span></div>`;
    document.querySelector('#app').insertBefore(view,document.querySelector('#player'));this.view=view;
    const trigger=document.createElement('button');trigger.id='lyricsBtn';trigger.className='icon-button subtle lyrics-trigger';I18n.setAttribute(trigger,"title",()=>(I18n.t("LyricsTitle")));I18n.setAttribute(trigger,'aria-label',()=>(I18n.t("LyricsTitle")));trigger.setAttribute('aria-pressed','false');trigger.innerHTML=this.icon('mic',19);document.querySelector('.volume-block').prepend(trigger);
    this.scroller=this.$('lyricsScroller');this.lines=this.$('lyricsLines');
    const dialogs=document.createElement('div');dialogs.id='lyricsDialogs';dialogs.innerHTML=`
    <dialog id="lyricsEditor" class="ly-dialog ly-editor" aria-labelledby="lyricsEditorTitle"><header><div><span class="eyebrow" data-i18n="LyricsTextAndTime">${I18n.h("LyricsTextAndTime")}</span><h2 id="lyricsEditorTitle" data-i18n="LyricsLyricsEditor">${I18n.h("LyricsLyricsEditor")}</h2></div>${this.button('lyricsEditorClose','close',"LyricsCloseEditor")}</header>
      <p class="ly-help" data-i18n="LyricsTXTLRCJSONOrShorthandWithTimestampsSpaces">${I18n.h("LyricsTXTLRCJSONOrShorthandWithTimestampsSpaces")}</p>
      <div class="ly-editor-tools"><button id="lyricsFileBtn" class="button secondary">${this.icon('folder',16)}<span data-i18n="LyricsOpenFile">${I18n.h("LyricsOpenFile")}</span></button><button id="lyricsTimingBtn" class="button secondary">${this.icon('clock',16)}<span data-i18n="LyricsTimeToMusic">${I18n.h("LyricsTimeToMusic")}</span></button><button id="lyricsRawBtn" class="button secondary hidden" data-i18n="LyricsBackToSourceText">${I18n.h("LyricsBackToSourceText")}</button><button id="lyricsEditorPlay" class="button secondary">${this.icon('play',15)}<span data-i18n="LyricsPlayPause">${I18n.h("LyricsPlayPause")}</span></button><span id="lyricsEditorClock">00:00.000</span></div>
      <textarea id="lyricsInput" spellcheck="false" aria-label="${I18n.h("LyricsSongLyricsOrMarkup")}" data-i18n-aria-label="LyricsSongLyricsOrMarkup" placeholder="${I18n.h("LyricsPasteSongLyrics")}" data-i18n-placeholder="LyricsPasteSongLyrics"></textarea>
      <div id="lyricsTiming" class="hidden"><div class="ly-editor-tools"><button id="lyricsStampNext" class="button secondary" data-i18n="LyricsMarkTheStartAndAdvance">${I18n.h("LyricsMarkTheStartAndAdvance")}</button><span class="ly-help" data-i18n="LyricsClickAWordToSetItsTimeLine">${I18n.h("LyricsClickAWordToSetItsTimeLine")}</span></div><div id="lyricsTimingRows"></div></div>
      <label id="lyricsMismatch" class="ly-warning hidden"><input type="checkbox" id="lyricsAllowMismatch"><span data-i18n="LyricsTimingsAreFromAnotherFileApplyThemTo">${I18n.h("LyricsTimingsAreFromAnotherFileApplyThemTo")}</span></label>
      <div id="lyricsImportSummary" class="ly-help" role="status"></div><div id="lyricsEditorError" class="ly-error" role="alert"></div>
      <div class="ly-dialog-actions"><button id="lyricsPreviewBtn" class="button secondary" data-i18n="LyricsCheckTimings">${I18n.h("LyricsCheckTimings")}</button><button id="lyricsSaveBtn" class="button primary" data-i18n="UISave">${I18n.h("UISave")}</button></div></dialog>
    <dialog id="lyricsSettings" class="ly-dialog" aria-labelledby="lyricsSettingsTitle"><header><div><span class="eyebrow" data-i18n="LyricsForYourMusic">${I18n.h("LyricsForYourMusic")}</span><h2 id="lyricsSettingsTitle" data-i18n="LyricsLyricsAppearance">${I18n.h("LyricsLyricsAppearance")}</h2></div>${this.button('lyricsSettingsClose','close',"LyricsCloseAppearanceSettings")}</header>
      <div id="lyricsThemePreview" class="ly-theme-preview"><b><span data-i18n="LyricsYourMusic">${I18n.h("LyricsYourMusic")}</span><br><span data-i18n="LyricsYourWords">${I18n.h("LyricsYourWords")}</span></b><button id="lyricsSettingsMode" class="ly-icon" type="button" title="${I18n.h("LyricsSwitchBackground")}" data-i18n-title="LyricsSwitchBackground" aria-label="${I18n.h("LyricsSwitchBackground")}" data-i18n-aria-label="LyricsSwitchBackground"></button><span id="lyricsThemeMode" data-i18n="LyricsGradient">${I18n.h("LyricsGradient")}</span></div>
      <div id="lyricsPrimaryGroup" class="ly-settings-row"><label for="lyricsPrimaryColor" data-i18n="LyricsBaseColour">${I18n.h("LyricsBaseColour")}</label><input type="color" id="lyricsPrimaryColor"></div>
      <section id="lyricsGradientGroup" class="ly-settings-section"><div class="ly-settings-row"><span data-i18n="LyricsGradientColours">${I18n.h("LyricsGradientColours")}</span><button id="lyricsAddColor" class="text-button" data-i18n="LyricsAddColour">${I18n.h("LyricsAddColour")}</button></div><div id="lyricsGradientColors" class="ly-gradient-colors"></div>
      <div class="ly-presets" id="lyricsGradientPresets"></div>
      <label class="ly-settings-row" for="lyricsGradientAngle"><span data-i18n="LyricsDirection">${I18n.h("LyricsDirection")}</span> <output id="lyricsAngleValue">135°</output></label><input type="range" id="lyricsGradientAngle" min="0" max="360" step="1"></section>
      <label class="ly-check" id="lyricsAutoGroup"><input type="checkbox" id="lyricsAutoContrast"><span data-i18n="LyricsAutomaticReadability">${I18n.h("LyricsAutomaticReadability")}</span></label><p id="lyricsAutoHelp" class="ly-help"></p><section id="lyricsManualColors" class="ly-settings-section">
      <div class="ly-settings-row"><label for="lyricsTextColor" data-i18n="LyricsRegularText">${I18n.h("LyricsRegularText")}</label><input type="color" id="lyricsTextColor"></div><div class="ly-settings-row"><label for="lyricsActiveColor" data-i18n="LyricsActiveText">${I18n.h("LyricsActiveText")}</label><input type="color" id="lyricsActiveColor"></div></section><p id="lyricsContrastInfo" class="ly-help"></p>
      <label class="ly-settings-row" for="lyricsFontScale"><span data-i18n="LyricsTextSize">${I18n.h("LyricsTextSize")}</span> <output id="lyricsFontValue">100%</output></label><input type="range" id="lyricsFontScale" min="65" max="150" step="5">
      <div class="ly-settings-row"><span data-i18n="LyricsLyricsOffset">${I18n.h("LyricsLyricsOffset")}</span><output id="lyricsOffsetValue" data-i18n="LyricsS">${I18n.h("LyricsS")}</output></div><div class="ly-editor-tools"><button id="lyricsEarlier" class="button secondary" data-i18n="LyricsEarlierS">${I18n.h("LyricsEarlierS")}</button><button id="lyricsLater" class="button secondary" data-i18n="LyricsLaterS">${I18n.h("LyricsLaterS")}</button><button id="lyricsResetOffset" class="text-button" data-i18n="LyricsReset">${I18n.h("LyricsReset")}</button></div>
      <p class="ly-help" data-i18n="LyricsChangesAreSavedAutomaticallyTheOffsetShiftsLyrics">${I18n.h("LyricsChangesAreSavedAutomaticallyTheOffsetShiftsLyrics")}</p>
      <label class="ly-settings-row"><span data-i18n="LyricsInstrumentalMarkerForAKnownPause">${I18n.h("LyricsInstrumentalMarkerForAKnownPause")}</span><select id="lyricsGap"><option value="2500" data-i18n="LyricsAtLeastSeconds">${I18n.h("LyricsAtLeastSeconds")}</option><option value="3000" data-i18n="LyricsAtLeastSeconds2">${I18n.h("LyricsAtLeastSeconds2")}</option><option value="5000" data-i18n="LyricsAtLeastSeconds3">${I18n.h("LyricsAtLeastSeconds3")}</option></select></label><p class="ly-help" data-i18n="LyricsNoteAppearsOnlyAfterAnExplicitlySetPhrase">${I18n.h("LyricsNoteAppearsOnlyAfterAnExplicitlySetPhrase")}</p>
      <div class="ly-dialog-actions"><button id="lyricsResetTheme" class="button secondary" data-i18n="LyricsFromCoverReset">${I18n.h("LyricsFromCoverReset")}</button><button id="lyricsSettingsSave" class="button primary" data-i18n="UIDone">${I18n.h("UIDone")}</button></div><span id="lyricsAutosaveStatus" class="ly-autosave" role="status" data-i18n="LyricsSaved">${I18n.h("LyricsSaved")}</span><div id="lyricsSettingsError" class="ly-error" role="alert"></div></dialog>
    <dialog id="lyricsSearch" class="ly-dialog ly-search" aria-labelledby="lyricsSearchTitle"><header><div><span class="eyebrow" data-i18n="LyricsLocalAfterSaving">${I18n.h("LyricsLocalAfterSaving")}</span><h2 id="lyricsSearchTitle" data-i18n="LyricsFindLyrics">${I18n.h("LyricsFindLyrics")}</h2></div>${this.button('lyricsSearchClose','close',"LyricsCloseSearch")}</header>
      <p class="ly-help" data-i18n="LyricsSearchLRCLIBSendsTheSongTitleAndArtist">${I18n.h("LyricsSearchLRCLIBSendsTheSongTitleAndArtist")}</p>
      <form id="lyricsSearchForm"><label><span data-i18n="LyricsArtist">${I18n.h("LyricsArtist")}</span><input id="lyricsSearchArtist" maxlength="200" autocomplete="off"></label><label><span data-i18n="UITitle">${I18n.h("UITitle")}</span><input id="lyricsSearchSong" maxlength="200" autocomplete="off" required></label><button id="lyricsSearchSubmit" class="button primary" type="submit" data-i18n="LyricsSearchLRCLIB">${I18n.h("LyricsSearchLRCLIB")}</button></form>
      <div class="ly-editor-tools"><button id="lyricsGoogle" class="button secondary">${this.icon('external',16)}<span data-i18n="LyricsSearchInBrowser">${I18n.h("LyricsSearchInBrowser")}</span></button><button id="lyricsSearchPaste" class="text-button" data-i18n="LyricsPasteYourOwnLyrics">${I18n.h("LyricsPasteYourOwnLyrics")}</button><button id="lyricsCurrentSource" class="text-button hidden" data-i18n="LyricsOpenSavedSource">${I18n.h("LyricsOpenSavedSource")}</button></div>
      <p id="lyricsSearchState" class="ly-help" role="status"></p><div id="lyricsSearchResults"></div></dialog>
    <dialog id="lyricsExportChoice" class="ly-dialog" aria-labelledby="lyricsExportTitle"><header><h2 id="lyricsExportTitle" data-i18n="LyricsExportLyrics">${I18n.h("LyricsExportLyrics")}</h2></header><p class="ly-help" data-i18n="LyricsJSONPreservesAllTimestampsAppearanceAndInstrumentalBreaks">${I18n.h("LyricsJSONPreservesAllTimestampsAppearanceAndInstrumentalBreaks")}</p><div class="ly-dialog-actions"><button class="button secondary" data-lyrics-export="txt" data-i18n="LyricsTXT">${I18n.h("LyricsTXT")}</button><button class="button secondary" data-lyrics-export="lrc" data-i18n="LyricsLRC">${I18n.h("LyricsLRC")}</button><button class="button primary" data-lyrics-export="json" data-i18n="LyricsJSONEverything">${I18n.h("LyricsJSONEverything")}</button></div><button id="lyricsExportClose" class="text-button" data-i18n="LyricsCancel">${I18n.h("LyricsCancel")}</button></dialog>
    <dialog id="lyricsConfirm" class="ly-dialog ly-confirm" aria-labelledby="lyricsConfirmTitle"><header><h2 id="lyricsConfirmTitle" data-i18n="LyricsConfirmation">${I18n.h("LyricsConfirmation")}</h2></header><p id="lyricsConfirmText" class="ly-help"></p><div class="ly-dialog-actions"><button id="lyricsConfirmNo" class="button secondary" data-i18n="LyricsCancel">${I18n.h("LyricsCancel")}</button><button id="lyricsConfirmYes" class="button primary" data-i18n="PlayerOverlayResume">${I18n.h("PlayerOverlayResume")}</button></div></dialog>`;
    document.body.append(dialogs);this.dialogs=dialogs;
    // Source, export and mode metadata belong to editing, not to the reader.
    this.editorUtilities=view.querySelector('.ly-bottom');
    this.$('lyricsEditor').append(this.editorUtilities);
  }
  bind(){
    const on=(id,fn,type='click')=>this.$(id).addEventListener(type,fn);
    on('lyricsBtn',()=>this.toggle());on('lyricsCloseBtn',()=>this.close());on('lyricsFocusBtn',()=>{document.body.classList.toggle('lyrics-focus');requestAnimationFrame(()=>{if(this.follow)this.align(true);});});
    on('lyricsWordMode',()=>{this.words=!this.words;this.updateTools();this.tick(true);this.api.settings.set({lyricsDisplay:{wordMode:this.words?'words':'lines'}}).catch(()=>{});});
    on('lyricsBackgroundMode',()=>{if(!this.track||this.loading)return;this.theme.mode=this.C.nextMode(this.scene?.mode||this.theme.mode,this.coverReady);this.themeTouched=true;this.paintTheme();this.savePresentation().catch(e=>this.error(e));});
    on('lyricsResync',()=>{this.follow=true;this.align(true);});
    for(const id of ['lyricsPasteBtn','lyricsEditBtn'])on(id,()=>this.edit());
    on('lyricsImportBtn',()=>this.importFile());on('lyricsFileBtn',()=>this.importFile());
    on('lyricsEditorClose',()=>this.closeEditor());this.$('lyricsEditor').addEventListener('cancel',e=>{e.preventDefault();this.closeEditor();});
    on('lyricsPreviewBtn',()=>this.preview());on('lyricsSaveBtn',()=>this.saveEditor());
    on('lyricsTimingBtn',()=>this.openTiming());on('lyricsRawBtn',()=>this.closeTiming());on('lyricsEditorPlay',()=>this.togglePlay());on('lyricsStampNext',()=>this.markTime(this.markIndex,'startMs',true));
    on('lyricsSettingsBtn',()=>this.openSettings());on('lyricsSettingsClose',()=>this.cancelSettings());this.$('lyricsSettings').addEventListener('cancel',e=>{e.preventDefault();this.cancelSettings();});
    on('lyricsSettingsSave',()=>this.saveSettings());on('lyricsResetTheme',()=>{this.theme=this.L.theme({background:this.coverPalette?.[0],gradientColors:this.coverPalette||undefined,mode:this.theme.mode,fontScale:this.theme.fontScale});this.renderSettings();this.paintTheme();});
    for(const [id,prop]of [['lyricsPrimaryColor','background'],['lyricsTextColor','text'],['lyricsActiveColor','activeText']])on(id,()=>{this.theme[prop]=this.$(id).value;if(prop==='background')this.theme.gradientColors[0]=this.theme.background;this.paintTheme();this.renderSettingsColors();},'input');
    on('lyricsAutoContrast',()=>{this.theme.autoContrast=this.$('lyricsAutoContrast').checked;if(!this.theme.autoContrast){this.theme.text=this.$('lyricsTextColor').value;this.theme.activeText=this.$('lyricsActiveColor').value;}this.paintTheme();this.renderSettingsColors();},'change');
    on('lyricsGradientAngle',()=>{this.theme.gradientAngle=+this.$('lyricsGradientAngle').value;this.paintTheme();},'input');
    on('lyricsFontScale',()=>{this.theme.fontScale=+this.$('lyricsFontScale').value;this.paintTheme();if(this.follow)this.align();},'input');
    on('lyricsAddColor',()=>{if(this.theme.gradientColors.length<4){this.theme.gradientColors.push(this.theme.gradientColors.at(-1));this.renderSettings();this.paintTheme();}});
    on('lyricsEarlier',()=>this.nudge(-100,false));on('lyricsLater',()=>this.nudge(100,false));on('lyricsResetOffset',()=>{this.timing.offsetMs=0;if(this.doc)this.doc.offsetMs=0;this.paintTheme();this.tick(true);});
    on('lyricsGap',()=>{this.timing.gapThresholdMs=+this.$('lyricsGap').value;if(this.doc){this.doc.gapThresholdMs=this.timing.gapThresholdMs;this.render();}},'change');
    on('lyricsSettingsMode',()=>{this.theme.mode=this.C.nextMode(this.scene?.mode||this.theme.mode,this.coverReady);this.paintTheme();this.renderSettingsColors();});
    // Let the target widget see navigation keys before shielding the app shortcuts.
    this.dialogs.addEventListener('keydown',e=>e.stopPropagation());
    on('lyricsFindBtn',()=>this.openSearch());
    on('lyricsSourceBtn',()=>this.$('lyricsEditor').open&&this.refindText?this.refindText():this.openSearch());
    on('lyricsSearchClose',()=>this.closeSearch());this.$('lyricsSearch').addEventListener('cancel',e=>{e.preventDefault();this.closeSearch();});
    on('lyricsSearchForm',e=>{e.preventDefault();this.search();},'submit');on('lyricsSearchPaste',()=>{this.closeSearch();this.edit();});
    on('lyricsGoogle',()=>{const q=`${this.$('lyricsSearchArtist').value} ${this.$('lyricsSearchSong').value} lyrics`.trim();this.api.system.openExternal('https://www.google.com/search?q='+encodeURIComponent(q)).catch(e=>this.error(e));});
    on('lyricsCurrentSource',()=>{const url=this.doc?.source?.url;if(url&&/^https:\/\//.test(url))this.api.system.openExternal(url).catch(e=>this.error(e));});
    this.dialogs.querySelectorAll('[data-lyrics-export]').forEach(b=>b.onclick=()=>this.finishExportChoice(b.dataset.lyricsExport));on('lyricsExportClose',()=>this.finishExportChoice(null));this.$('lyricsExportChoice').addEventListener('cancel',e=>{e.preventDefault();this.finishExportChoice(null);});
    on('lyricsZipBtn',()=>this.exportPackage());on('lyricsExportBtn',()=>this.exportText());on('lyricsCancelExport',()=>this.command({type:'cancel-export'}).catch(e=>this.error(e)));
    on('lyricsConfirmNo',()=>this.finishConfirm(false));on('lyricsConfirmYes',()=>this.finishConfirm(true));this.$('lyricsConfirm').addEventListener('cancel',e=>{e.preventDefault();this.finishConfirm(false);});
    this.scroller.addEventListener('wheel',()=>this.manual(),{passive:true});this.scroller.addEventListener('touchstart',()=>this.manual(),{passive:true});
    this.scroller.addEventListener('pointerdown',e=>{this.pointer={x:e.clientX,y:e.clientY,id:e.pointerId,moved:false};if(e.clientX>=this.scroller.getBoundingClientRect().right-20)this.manual();});
    this.scroller.addEventListener('pointermove',e=>{if(this.pointer&&e.buttons&&Math.hypot(e.clientX-this.pointer.x,e.clientY-this.pointer.y)>6){this.pointer.moved=true;this.manual();}});
    this.scroller.addEventListener('scroll',()=>this.syncButton(),{passive:true});
    this.scroller.addEventListener('click',e=>{const node=e.target.closest('[data-lyric-row]');if(!node||this.pointer?.moved||getSelection()?.toString())return;const row=this.rows[+node.dataset.lyricRow];if(row.startMs!==null){this.seek((row.startMs+(this.doc?.offsetMs||0))/1000);this.follow=true;this.tick(true);this.align(true);}});
    document.addEventListener('keydown',e=>this.keydown(e),true);
    for(const name of ['play','pause','ended','seeking','seeked','ratechange','timeupdate','loadedmetadata','emptied'])this.audio.addEventListener(name,()=>{
      this.tick(['seeking','seeked','loadedmetadata','ended'].includes(name));if(['play','seeked','loadedmetadata'].includes(name))this.startClock();if(name==='loadedmetadata'&&this.doc)this.render();
    });
    document.addEventListener('visibilitychange',()=>{cancelAnimationFrame(this.frame);this.frame=0;if(!document.hidden){this.tick(true);this.startClock();}});
    new ResizeObserver(()=>{if(this.opened){if(this.follow)this.align();this.syncButton();}}).observe(this.scroller);
    this.api.lyrics?.onProgress?.(({percent})=>{this.$('lyricsZipBtn').textContent=`ZIP: ${percent}%`;});
    this.api.lyrics?.onLock?.(()=>{if(this.track?.vaultKey)this.clearPrivate();});
    this.api.settings.get().then(s=>{this.words=s.lyricsDisplay?.wordMode!=='lines';this.updateTools();}).catch(()=>{});
  }
  command(c){if(!this.api.lyrics?.command)return Promise.reject(I18n.error("LyricsUpdateAllApplicationFilesTheLyricsBridgeIs"));return this.api.lyrics.command(c);}
  error(e){this.notify('bad',I18n.t("LyricsTitle"),I18n.errorMessage(e)||String(e),6000);}
  async confirm(title,text){if(this.confirmResolve)this.finishConfirm(false);I18n.setOwnedText(this.$('lyricsConfirmTitle'),title);I18n.setOwnedText(this.$('lyricsConfirmText'),text);this.$('lyricsConfirm').showModal();return new Promise(resolve=>this.confirmResolve=resolve);}
  finishConfirm(value){const resolve=this.confirmResolve;this.confirmResolve=null;this.$('lyricsConfirm').close();resolve?.(value);}
  toggle(){this.opened?this.close():this.open();}
  open(){getSelection()?.removeAllRanges();this.onOpen();this.opened=true;document.body.classList.add('lyrics-open');this.view.classList.remove('hidden');this.$('lyricsBtn').classList.add('active');this.$('lyricsBtn').setAttribute('aria-pressed','true');this.trackChanged(this.getTrack(),true);this.scroller.focus({preventScroll:true});this.immersive.open();}
  close(){this.immersive.stop();this.backdrop.clear();this.opened=false;document.body.classList.remove('lyrics-open','lyrics-focus');this.view.classList.add('hidden');this.$('lyricsBtn').classList.remove('active');this.$('lyricsBtn').setAttribute('aria-pressed','false');cancelAnimationFrame(this.frame);this.frame=0;this.closeDialogs(true);if(this.track?.vaultKey)this.clearData();this.$('lyricsBtn').focus({preventScroll:true});}
  clearData(){this.backdrop.clear();this.epoch++;this.coverEpoch++;this.searchGeneration++;this.doc=null;this.timing=this.E.preferences();this.revision=null;this.recordingId='';this.rows=[];this.nodes=[];this.active=[];this.lines.replaceChildren();getSelection()?.removeAllRanges();this.coverReady=false;this.$('lyricsCover').removeAttribute('src');this.$('lyricsInput').value='';this.$('lyricsTimingRows').replaceChildren();this.$('lyricsSearchResults').replaceChildren();this.$('lyricsSearchArtist').value='';this.$('lyricsSearchSong').value='';I18n.setText(this.$('lyricsEditorTitle'),()=>(I18n.t("LyricsLyricsEditor")));this.$('lyricsImportSummary').textContent='';this.$('lyricsEditorError').textContent='';this.editDraft=null;this.wordDrafts.clear();this.wordSelection=null;this.timingFields=[];this.incoming=null;this.settingsBackup=null;this.searchResults=[];}
  clearPrivate(){this.closeDialogs(true);this.clearData();this.track=null;I18n.setText(this.$('lyricsTitle'),()=>(I18n.t("LyricsProtectedPlaylistLocked")));I18n.setText(this.$('lyricsArtist'),()=>(I18n.t("LyricsPULSEDECKLYRICS")));this.theme=this.L.theme();this.paintTheme();this.empty(I18n.t("LyricsPlaylistLocked"),I18n.t("LyricsUnlockTheProtectedPlaylistAndSelectTheSong"));}
  closeDialogs(force=false){this.finishConfirm(false);this.finishExportChoice(null);this.searchGeneration++;for(const dialog of this.dialogs.querySelectorAll('dialog[open]'))dialog.close();if(force){this.settingsBackup=null;this.editOriginal=null;this.editDraft=null;this.wordDrafts.clear();this.wordSelection=null;this.timingFields=[];this.$('lyricsTimingRows').replaceChildren();this.$('lyricsInput').value='';this.$('lyricsSearchResults').replaceChildren();}}
  trackChanged(track,force=false){
    const changed=(track?.rel||'')!==(this.track?.rel||'');
    if(!changed&&!force){const coverChanged=track?.coverUrl!==this.track?.coverUrl||track?.mtime!==this.track?.mtime;if(track)this.track={...track};if(coverChanged&&this.opened)this.loadCover(track,this.epoch);this.tick();return;}
    this.closeDialogs(true);this.clearData();this.track=track?{...track}:null;this.themeTouched=false;this.loading=false;this.theme=this.L.theme();this.average=[48,32,54];this.coverPalette=null;this.follow=true;this.scroller.scrollTop=0;
    I18n.setText(this.$('lyricsTitle'),()=>(track?.title||I18n.t("LyricsTitle")));I18n.setText(this.$('lyricsArtist'),()=>track ? window.PulseLibrary.trackArtist(track) : I18n.t('AppName'));this.$('lyricsStatus').textContent='';this.updateTools();this.paintTheme();
    if(!this.opened)return;
    if(!track){this.empty(I18n.t("LyricsSelectASong"),I18n.t("LyricsOpenYourLibraryAndPlayATrackIts"));return;}
    this.loading=true;this.empty(I18n.t("LyricsOpeningLyrics"),I18n.t("LyricsLookingForSavedTimingsAnAdjacentFileOr"));this.updateTools();
    const epoch=this.epoch;this.loadCover(track,epoch);
    this.saveTail.catch(()=>{}).then(()=>this.command({type:'get',rel:track.rel})).then(result=>{
      if(epoch!==this.epoch||!this.opened)return;
      this.loading=false;this.doc=result.doc;this.timing=this.E.preferences(result.doc||result.timing);this.revision=result.revision||null;this.recordingId=result.recordingId;
      this.theme=this.L.theme(result.theme?{...result.theme,paletteSource:result.theme.paletteSource||'manual'}:{background:this.coverPalette?.[0],gradientColors:this.coverPalette||undefined,paletteSource:'cover'});this.themeTouched=this.theme.paletteSource==='manual';if(!this.themeTouched&&this.coverPalette){this.theme.background=this.coverPalette[0];this.theme.gradientColors=[...this.coverPalette];}this.revisions?.set(track.rel,this.revision);
      this.origin=result.origin||'';this.paintTheme();this.render();this.startClock();
      if(this.L.notes(result.doc).length)this.notify('info',I18n.t("LyricsTimingNotes"),this.L.notes(result.doc).join(' '),8000);
      if(result.warnings?.length)this.notify('info',I18n.t("LyricsCheckLocalLyrics"),result.warnings.join(' '),8000);
      if(this.doc&&!this.doc.lines.some(l=>l.startMs!==null))this.notify('info',I18n.t("LyricsLyricsAreNotSynchronisedToTheMusic"),I18n.t("LyricsYouCanScrollThemFreely"),3500);
    }).catch(e=>{if(epoch!==this.epoch)return;this.loading=false;this.empty(I18n.t("LyricsCouldNotOpenLyrics"),I18n.errorMessage(e)||String(e));this.updateTools();});
  }
  empty(title,text){if(!this.loading)this.immersive.activity();this.$('lyricsEmpty').classList.remove('hidden');I18n.setOwnedText(this.$('lyricsEmptyTitle'),title);I18n.setOwnedText(this.$('lyricsEmptyText'),text);this.scroller.classList.add('hidden');this.$('lyricsResync').classList.add('hidden');this.updateTools();}
  durationMs(){return Math.round((Number.isFinite(this.audio.duration)&&this.audio.duration>0?this.audio.duration:this.track?.duration||0)*1000);}
  async loadCover(track,epoch){
    const coverEpoch=++this.coverEpoch;this.coverReady=false;const raw=track.coverUrl;if(!raw){this.$('lyricsCover').removeAttribute('src');this.paintTheme();return;}
    try{const u=new URL(raw,document.baseURI);if(!['https:','file:','blob:','data:'].includes(u.protocol)&&!(u.protocol==='http:'&&u.hostname==='127.0.0.1'))return;
      const img=new Image();if(u.protocol==='http:'||u.protocol==='https:')img.crossOrigin='anonymous';
      img.src=u.href;await img.decode();if(epoch!==this.epoch||coverEpoch!==this.coverEpoch||!img.naturalWidth)return;
      let average=[48,32,54],colors;try{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,64,64);const result=this.C.palette(ctx.getImageData(0,0,64,64).data);average=result.average;colors=result.colors;}catch{}
      this.average=average;this.coverPalette=colors;this.coverReady=true;this.$('lyricsCover').src=u.href;
      if(this.theme.paletteSource!=='manual'&&colors)this.theme=this.L.theme({...this.theme,background:colors[0],gradientColors:colors,paletteSource:'cover'});this.paintTheme();
    }catch{if(epoch===this.epoch&&coverEpoch===this.coverEpoch){this.coverReady=false;this.$('lyricsCover').removeAttribute('src');this.paintTheme();}}
  }
  paintTheme(){
    const scene=this.C.scene(this.theme,{hasCover:this.coverReady,average:this.average});this.scene=scene;
    const bg=scene.mode==='gradient'?`linear-gradient(${this.theme.gradientAngle}deg in srgb, ${this.theme.gradientColors.join(',')})`:scene.base;
    this.view.style.setProperty('--ly-base',scene.base);this.view.style.setProperty('--ly-background',bg);this.view.style.setProperty('--ly-text',scene.text);this.view.style.setProperty('--ly-active',scene.active);this.view.style.setProperty('--ly-scrim',scene.tint);this.view.style.setProperty('--ly-scrim-alpha',String(scene.scrim));this.view.style.setProperty('--ly-scale',this.theme.fontScale/100);this.view.dataset.background=scene.mode;this.view.dataset.foreground=scene.active==='#000000'?'black':'white';
    this.$('lyricsCover').style.opacity=scene.coverOpacity||0;
    if(this.opened)this.backdrop.set({base:scene.base,background:bg,tint:scene.tint,scrim:scene.scrim,coverOpacity:scene.coverOpacity||0,cover:scene.mode==='cover'&&this.coverReady?this.$('lyricsCover').src:''});
    this.view.dataset.contrast=scene.minContrast.toFixed(3);this.updateTools();
    if(this.$('lyricsSettings').open){
      const p=this.$('lyricsThemePreview');p.style.background=scene.mode==='cover'?scene.base:`linear-gradient(${scene.scrim?'0deg':'135deg'},${scene.tint+'00'},${scene.tint+'00'}), ${bg}`;
      p.style.color=scene.active;
      if(scene.mode==='cover'&&this.coverReady){p.style.backgroundImage=`linear-gradient(${scene.tint+'99'},${scene.tint+'99'}),url("${this.$('lyricsCover').src.replaceAll('"','%22')}")`;p.style.backgroundSize='cover';}
      else p.style.backgroundImage=scene.mode!=='cover'?`linear-gradient(${scene.tint}${Math.round(scene.scrim*255).toString(16).padStart(2,'0')},${scene.tint}${Math.round(scene.scrim*255).toString(16).padStart(2,'0')}),${scene.mode==='solid'?`linear-gradient(${bg},${bg})`:bg}`:'none';
      I18n.setText(this.$('lyricsThemeMode'),()=>this.modeLabel(scene.mode));this.$('lyricsSettingsMode').innerHTML=this.icon(scene.mode);I18n.setAttribute(this.$('lyricsSettingsMode'),"title",()=>(I18n.t("LyricsBackground")+this.modeLabel(scene.mode)));this.updateSettingsVisibility();
      this.$('lyricsAngleValue').textContent=Math.round(this.theme.gradientAngle)+'°';this.$('lyricsFontValue').textContent=Math.round(this.theme.fontScale)+'%';
      I18n.setText(this.$('lyricsContrastInfo'),()=>(I18n.t("LyricsMinimumEstimatedContrast", {value1:(scene.minContrast.toFixed(2)),value2:(scene.minContrast<4.5?I18n.msg("LyricsLowReadabilityEnableAutomaticCorrection"):scene.mode==='cover'?I18n.msg("LyricsBackdropAlsoAccountsForBlackAndWhiteCover"):'')})));
      I18n.setText(this.$('lyricsOffsetValue'),()=>(I18n.t('SecondsValue',{value:I18n.number((this.doc?.offsetMs??this.timing.offsetMs)/1000,{minimumFractionDigits:2,maximumFractionDigits:2})})));
    }
  }
  modeLabel(mode){return {solid:I18n.t("LyricsSolidColour"),gradient:I18n.t("LyricsGradient"),cover:I18n.t("LyricsCover")}[mode]||I18n.t("LyricsGradient");}
  updateTools(){
    const mode=this.scene?.mode||this.theme.mode,b=this.$('lyricsBackgroundMode');b.innerHTML=this.icon(mode);I18n.setAttribute(b,"title",()=>(I18n.t("LyricsBackgroundClickToSwitch", {value1:(this.modeLabel(mode))})));b.setAttribute('aria-label',b.title);b.dataset.mode=mode;b.dataset.available=this.C.modes(this.coverReady).join(',');
    const w=this.$('lyricsWordMode');w.innerHTML=this.icon(this.words?'words':'lines');I18n.setAttribute(w,"title",()=>(this.words?I18n.t("LyricsByWordsSwitchToLines"):I18n.t("LyricsByLinesSwitchToWords")));w.setAttribute('aria-label',w.title);w.setAttribute('aria-pressed',String(this.words));
    const hasTime=!!this.doc?.lines.some(l=>l.startMs!==null);w.disabled=!hasTime;
    for(const id of ['lyricsEditBtn','lyricsSettingsBtn','lyricsFindBtn','lyricsPasteBtn','lyricsImportBtn','lyricsSourceBtn','lyricsZipBtn','lyricsBackgroundMode'])this.$(id).disabled=!this.track||this.loading;
    this.$('lyricsExportBtn').disabled=!this.doc;I18n.setText(this.$('lyricsModeInfo'),()=>(this.doc?(hasTime?(this.words?I18n.t("LyricsByWordsPhrases"):I18n.t("LyricsByLines")):I18n.t("LyricsNotSynchronised")):''));
    this.view.classList.toggle('ly-word-mode',this.words);this.view.classList.toggle('ly-has-text',!!this.doc);
    const exports=this.$('lyricsExportActions'),parent=this.doc?this.editorUtilities:this.$('lyricsEmptySecondary');if(exports.parentElement!==parent)parent.append(exports);
  }
  render(){
    if(!this.opened)return;if(!this.doc){this.empty(I18n.t("LyricsEverySongHasWords"),I18n.t("LyricsFindLyricsPasteYourOwnOrImportExisting"));return;}
    this.rows=this.L.compile(this.doc,this.durationMs());this.nodes=[];this.active=[];const fragment=document.createDocumentFragment();
    for(let i=0;i<this.rows.length;i++){
      const row=this.rows[i],node=document.createElement('div');node.className='ly-line';node.dataset.lyricRow=String(i);node.dir='auto';
      if(row.startMs!==null){node.tabIndex=0;node.setAttribute('role','button');I18n.setAttribute(node,"title",()=>(I18n.t("LyricsGoTo")+this.L.stamp(row.startMs+this.doc.offsetMs)));}
      else node.classList.add('ly-untimed');
      if(row.kind==='interlude'){node.classList.add('ly-interlude');node.innerHTML=this.icon('music',30);I18n.setAttribute(node,'aria-label',()=>(I18n.t("LyricsInstrumentalBreak")));}
      else if(row.segments){node.classList.add('ly-segmented');for(const part of row.segments){const span=document.createElement('span');span.dataset.segment=String(part.startMs??'');span.textContent=part.text;node.append(span);}}
      else node.textContent=row.text;
      if(!this.L.plainLine(row).trim()&&row.kind!=='interlude'){node.classList.add('ly-stanza');node.setAttribute('aria-hidden','true');}
      this.nodes.push(node);fragment.append(node);
    }
    this.lines.replaceChildren(fragment);this.$('lyricsEmpty').classList.add('hidden');this.scroller.classList.remove('hidden');
    const synchronized=this.rows.filter(r=>r.startMs!==null&&r.kind!=='interlude').length;
    I18n.setText(this.$('lyricsStatus'),()=>(synchronized?I18n.t("LyricsTimedLines", {value1:(synchronized),value2:(this.doc.source?.name?' · '+this.doc.source.name:'')}):I18n.t("LyricsFreeReading")));
    this.updateTools();this.tick(true);if(this.follow)this.align(true);
  }
  tick(force=false){
    if(this.$('lyricsEditor').open)this.$('lyricsEditorClock').textContent=this.L.stamp(this.audio.currentTime*1000);
    if(!this.opened||!this.doc||document.hidden)return;
    const t=this.audio.currentTime*1000-this.doc.offsetMs,indices=this.L.activeAt(this.rows,t),key=indices.join(',');
    if(force||key!==this.active.join(',')){
      this.active=indices;const activeSet=new Set(indices);
      this.nodes.forEach((node,i)=>{const row=this.rows[i];node.classList.toggle('ly-active',activeSet.has(i));node.classList.toggle('ly-past',row.startMs!==null&&row.startMs<t&&!activeSet.has(i));if(activeSet.has(i))node.setAttribute('aria-current','true');else node.removeAttribute('aria-current');});
      if(this.follow)this.align(force);else this.syncButton();
    }
    for(const i of indices){const node=this.nodes[i];if(this.rows[i].segments)for(const span of node.querySelectorAll('[data-segment]'))span.classList.toggle('ly-sung',!this.words||(span.dataset.segment!==''&&+span.dataset.segment<=t));}
    this.view.classList.toggle('ly-playing',!this.audio.paused);
  }
  startClock(){cancelAnimationFrame(this.frame);this.frame=0;if(!this.opened||this.audio.paused||document.hidden)return;const loop=()=>{this.tick();if(this.opened&&!this.audio.paused&&!document.hidden)this.frame=requestAnimationFrame(loop);else this.frame=0;};this.frame=requestAnimationFrame(loop);}
  manual(){if(!this.opened)return;this.follow=false;this.scroller.scrollTo({top:this.scroller.scrollTop,behavior:'instant'});this.syncButton();}
  align(instant=false){if(!this.follow||!this.nodes.length)return;
    // A measured vocal end (or the end of the song) may have no active row.
    // Hold the nearest past cue, not the first line of the song.
    const now=this.audio.currentTime*1000-(this.doc?.offsetMs||0);
    let index=this.active[0];if(index===undefined){index=this.rows.findLastIndex(r=>r.startMs!==null&&r.startMs<=now);if(index<0)index=this.rows.findIndex(r=>r.startMs!==null);}
    if(index<0)return;const node=this.nodes[index],r=node.getBoundingClientRect(),s=this.scroller.getBoundingClientRect();
    const top=this.scroller.scrollTop+r.top-s.top+r.height/2-this.scroller.clientHeight*.43;
    if(Math.abs(this.scroller.scrollTop-top)>2)this.scroller.scrollTo({top:Math.max(0,top),behavior:instant||matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});this.syncButton();}
  syncButton(){const node=this.nodes[this.active[0]],r=node?.getBoundingClientRect(),s=this.scroller.getBoundingClientRect();const far=!!r&&Math.abs(r.top+r.height/2-(s.top+s.height*.43))>Math.max(70,s.height*.23);this.$('lyricsResync').classList.toggle('hidden',!this.opened||this.follow||!far);}
  keydown(e){
    const ours=e.target.closest?.('.ly-dialog')||this.dialogs.querySelector('dialog[open]');
    if(ours)return;
    if(!this.opened||document.querySelector('.modal-layer:not(.hidden)'))return;
    if(e.target.closest?.('input,textarea,select,[contenteditable=true]'))return;
    if((e.ctrlKey||e.metaKey)&&['a','z','y'].includes(e.key.toLowerCase())){e.stopImmediatePropagation();if(e.key.toLowerCase()==='a'){e.preventDefault();const range=document.createRange();range.selectNodeContents(this.lines);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);}return;}
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(document.body.classList.contains('lyrics-focus'))document.body.classList.remove('lyrics-focus');else this.close();return;}
    if(e.key==='Enter'&&e.target.dataset.lyricRow){e.preventDefault();e.target.click();return;}
    if(e.code==='Space'&&!e.target.closest('button')){e.preventDefault();e.stopImmediatePropagation();this.togglePlay();return;}
    if(e.code==='ArrowLeft'||e.code==='ArrowRight'){e.preventDefault();e.stopImmediatePropagation();this.seek(this.audio.currentTime+(e.code==='ArrowLeft'?-5:5));this.tick(true);return;}
    if(e.code==='BracketLeft'||e.code==='BracketRight'){e.preventDefault();e.stopImmediatePropagation();this.nudge(e.code==='BracketLeft'?-100:100,true);return;}
    if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(e.code)){this.manual();if(e.target!==this.scroller){e.preventDefault();const top=e.code==='Home'?0:e.code==='End'?this.scroller.scrollHeight:this.scroller.scrollTop+(e.code.includes('Up')?-1:1)*(e.code.includes('Page')?this.scroller.clientHeight*.8:75);this.scroller.scrollTo({top,behavior:'instant'});}}
  }
  async savePresentation(){
    const rel=this.track?.rel,epoch=this.epoch;if(!rel||!this.recordingId)return;
    const doc=this.doc?structuredClone(this.doc):null,theme=structuredClone(this.theme),timing=this.E.preferences(this.doc||this.timing);if(doc)doc.theme=theme;
    const task=this.saveTail.catch(()=>{}).then(async()=>{if(epoch!==this.epoch)return;const r=await this.command({type:'save',rel,doc,theme,timing,revision:this.revision});if(epoch===this.epoch){this.revision=r.revision;this.themeTouched=true;}});this.saveTail=task;return task;
  }
  nudge(delta,persist){this.timing=this.E.preferences({...this.timing,offsetMs:(this.doc?.offsetMs??this.timing.offsetMs)+delta});if(this.doc)this.doc.offsetMs=this.timing.offsetMs;this.tick(true);this.paintTheme();if(persist){this.savePresentation().catch(e=>this.error(e));this.notify('info',I18n.t("LyricsLyricsOffset"),I18n.t("LyricsS3", {value1:(this.timing.offsetMs>0?'+':''),value2:((this.timing.offsetMs/1000).toFixed(2))}),1400);}}

  edit(incoming=null){
    if(!this.track||this.loading)return;this.editEpoch=this.epoch;this.incoming=incoming;this.editDraft=null;this.markIndex=0;this.wordSelection=null;this.wordDrafts.clear();
    const doc=incoming?.doc||(this.doc?{...structuredClone(this.doc),theme:structuredClone(this.theme)}:null);this.$('lyricsInput').value=doc?JSON.stringify(doc,null,2):'';this.editOriginal=this.$('lyricsInput').value;
    I18n.setText(this.$('lyricsEditorTitle'),()=>window.PulseLibrary.trackTitle(this.track));this.$('lyricsEditorError').textContent='';this.$('lyricsImportSummary').textContent=incoming?.warnings?.join(' ')||'';
    this.$('lyricsTiming').classList.add('hidden');this.$('lyricsTimingBtn').classList.remove('hidden');this.$('lyricsRawBtn').classList.add('hidden');this.$('lyricsInput').classList.remove('hidden');this.$('lyricsTimingRows').replaceChildren();
    const mismatch=doc?.recordingId&&doc.recordingId!==this.recordingId;this.$('lyricsMismatch').classList.toggle('hidden',!mismatch);this.$('lyricsAllowMismatch').checked=false;
    if(!this.$('lyricsEditor').open)this.$('lyricsEditor').showModal();this.$('lyricsInput').focus();if(doc)this.preview();
  }
  async closeEditor(){if(this.$('lyricsEditor').open&&(this.editDraft||this.$('lyricsInput').value!==this.editOriginal)){if(!await this.confirm(I18n.t("LyricsCloseWithoutSaving"),I18n.t("LyricsUnsavedTextAndTimingChangesWillBeLost")))return;}this.$('lyricsEditor').close();this.editDraft=null;this.wordDrafts.clear();this.wordSelection=null;this.timingFields=[];this.incoming=null;this.$('lyricsInput').value='';this.$('lyricsTimingRows').replaceChildren();}
  parseEditor(){
    if(this.editDraft){const r=this.L.normalize(this.editDraft,{durationMs:this.durationMs()});r.doc.theme=structuredClone(this.theme);return r;}
    const raw=this.$('lyricsInput').value,r=this.L.parse(raw,{durationMs:this.durationMs()});
    // A pasted TXT/LRC has no presentation: retain this recording's preferences.
    // Import never changes this recording's palette; only presentation controls do.
    r.doc.theme=structuredClone(this.theme);
    if(!/"offsetMs"|\[offset:|initial-prefs/.test(raw))r.doc.offsetMs=this.timing.offsetMs;
    if(!/"gapThresholdMs"/.test(raw))r.doc.gapThresholdMs=this.timing.gapThresholdMs;
    return r;
  }
  preview(){try{const r=this.parseEditor(),textRows=r.doc.lines.filter(l=>l.kind==='lyric'&&this.L.plainLine(l).trim());this.$('lyricsEditorError').textContent='';I18n.setText(this.$('lyricsImportSummary'),()=>(I18n.t("LyricsLinesTimedSegmented", {value1:(textRows.length),value2:(textRows.filter(l=>l.startMs!==null).length),value3:(textRows.filter(l=>l.segments).length),value4:([...new Set([...(this.incoming?.warnings||[]),...this.L.notes(r.doc),...r.warnings])].join(' '))})));
      this.$('lyricsMismatch').classList.toggle('hidden',!(r.doc.recordingId&&r.doc.recordingId!==this.recordingId));return r;
    }catch(e){I18n.setText(this.$('lyricsEditorError'),()=>(I18n.errorMessage(e)));return null;}}
  async saveEditor(){
    if(this.busy||this.editEpoch!==this.epoch)return;const r=this.preview();if(!r)return;
    if(r.doc.recordingId&&r.doc.recordingId!==this.recordingId&&!this.$('lyricsAllowMismatch').checked){I18n.setText(this.$('lyricsEditorError'),()=>(I18n.t("LyricsConfirmApplyingTimingsFromADifferentFile")));return;}
    if(r.doc.lines.some(line=>this.durationMs()>0&&Math.max(line.startMs||0,line.endMs||0)>this.durationMs()+1000)&&!await this.confirm(I18n.t("LyricsCheckTheRecordingVersion"),I18n.t("LyricsSomeTimestampsExceedTheDurationSaveTheTimings")))return;
    r.doc.recordingId=this.recordingId;r.doc.theme=structuredClone(this.theme);this.flushPresentation?.();
    const epoch=this.epoch,rel=this.track.rel;this.busy=true;this.$('lyricsSaveBtn').disabled=true;
    try{await this.saveTail.catch(()=>{});if(epoch!==this.epoch)return;
      const result=await this.command({type:'save',rel,doc:r.doc,theme:r.doc.theme,revision:this.revision});if(epoch!==this.epoch)return;
      this.doc=result.doc;this.timing=this.E.preferences(result.doc||result.timing);this.revision=result.revision;this.theme=this.L.theme(result.theme);this.themeTouched=this.theme.paletteSource==='manual';this.$('lyricsEditor').close();this.$('lyricsInput').value='';this.editDraft=null;this.wordDrafts.clear();this.wordSelection=null;this.timingFields=[];this.$('lyricsTimingRows').replaceChildren();this.incoming=null;this.paintTheme();this.render();this.startClock();
      this.notify('good',I18n.t("LyricsLyricsSaved"),this.doc.lines.some(l=>l.startMs!==null)?I18n.t("LyricsTimingsLinkedToThisRecording"):I18n.t("LyricsLyricsAreNotSynchronisedToTheMusic2"),4000);
    }catch(e){if(epoch===this.epoch)I18n.setText(this.$('lyricsEditorError'),()=>(I18n.errorMessage(e)));}finally{this.busy=false;this.$('lyricsSaveBtn').disabled=false;}
  }
  async importFile(){if(!this.track)return;const epoch=this.epoch;if(this.$('lyricsEditor').open&&(this.editDraft||this.$('lyricsInput').value!==this.editOriginal)){if(!await this.confirm(I18n.t("LyricsReplaceUnsavedEdits"),I18n.t("LyricsImportWillOpenDifferentLyricsInTheEditor")))return;}if(epoch!==this.epoch)return;try{const r=await this.command({type:'import',rel:this.track.rel});if(epoch!==this.epoch||r.canceled)return;if(this.$('lyricsEditor').open)this.$('lyricsEditor').close();this.edit(r);}catch(e){if(epoch===this.epoch)this.error(e);}}
  openTiming(){const r=this.preview();if(!r)return;this.editDraft=r.doc;this.markIndex=0;this.wordSelection=null;this.wordDrafts.clear();this.$('lyricsInput').classList.add('hidden');this.$('lyricsTiming').classList.remove('hidden');this.$('lyricsTimingBtn').classList.add('hidden');this.$('lyricsRawBtn').classList.remove('hidden');this.renderTiming();}
  closeTiming(){if(this.editDraft)this.$('lyricsInput').value=JSON.stringify(this.editDraft,null,2);this.editDraft=null;this.wordSelection=null;this.wordDrafts.clear();this.timingFields=[];this.$('lyricsInput').classList.remove('hidden');this.$('lyricsTiming').classList.add('hidden');this.$('lyricsTimingBtn').classList.remove('hidden');this.$('lyricsRawBtn').classList.add('hidden');this.$('lyricsTimingRows').replaceChildren();}
  rowEndHint(index){const end=this.E.inferredEnd(this.editDraft.lines,index,this.durationMs());return end===null?I18n.t("LyricsAutoUntilTheEndOfTheSong"):I18n.t("LyricsAuto")+this.L.stamp(end).replace(/\.000$/,'');}
  rowFieldsRefresh(){for(const field of this.timingFields||[]){const value=this.editDraft.lines[+field.el.dataset.timeRow]?.[field.el.dataset.timeKey];if(!field.el.contains(document.activeElement))field.set(value);}}
  rowStart(index,value){
    try{this.editDraft.lines[index]=this.E.shiftStart(this.editDraft.lines[index],value);this.wordDrafts.delete(index);this.refreshWordTokens(index);this.rowFieldsRefresh();if(this.wordSelection?.row===index)this.openWord(index,this.wordSelection.word,false);this.preview();}
    catch(e){I18n.setText(this.$('lyricsEditorError'),()=>(I18n.errorMessage(e)));}
  }
  renderTiming(){
    const container=this.$('lyricsTimingRows');container.replaceChildren();this.timingFields=[];
    this.editDraft.lines.forEach((row,i)=>{
      const el=document.createElement('div');el.className='ly-timing-row';el.dataset.timingRow=String(i);el.classList.toggle('current',i===this.markIndex);
      const area=document.createElement('div');area.className='ly-timing-copy';const head=document.createElement('button');head.type='button';head.className='ly-timing-line-select';I18n.setText(head,()=>(I18n.t("LyricsLine", {value1:(i+1)})));head.onclick=()=>{this.markIndex=i;container.querySelectorAll('.ly-timing-row').forEach((n,j)=>n.classList.toggle('current',j===i));};
      const words=document.createElement('div');words.className='ly-word-tokens';words.dataset.wordsRow=String(i);area.append(head,words);el.append(area);
      for(const [key,label]of [['startMs',I18n.t("LyricsStart")],['endMs',I18n.t("LyricsEndOptional")]]){
        const cell=document.createElement('div');cell.className='ly-timing-cell';const caption=document.createElement('span');I18n.setOwnedText(caption,label);
        const field=new window.PulseTimeField({value:row[key],label:I18n.t("LyricsOfLine", {value1:(key==='startMs'?I18n.msg("LyricsStart"):I18n.msg("LyricsEnd")),value2:(i+1)}),automatic:key==='endMs'?()=>this.rowEndHint(i):I18n.t("LyricsNotSet"),onChange:value=>{
          if(key==='startMs')this.rowStart(i,value);else{this.editDraft.lines[i].endMs=value;this.preview();}
        }});field.el.dataset.timeKey=key;field.el.dataset.timeRow=String(i);this.timingFields.push(field);
        const tap=document.createElement('button');tap.type='button';tap.className='ly-tap';I18n.setText(tap,()=>(I18n.t("LyricsNow")));I18n.setAttribute(tap,'aria-label',()=>(I18n.t("LyricsOfLineNow", {value1:I18n.msg(key==='startMs'?'LyricsStart':'LyricsEndOptional'),value2:(i+1)})));tap.onclick=()=>this.markTime(i,key);
        cell.append(caption,field.el,tap);el.append(cell);
      }
      const suppress=document.createElement('label');suppress.className='ly-no-gap ly-check';const cb=document.createElement('input');cb.type='checkbox';cb.checked=row.suppressGapAfter;cb.onchange=()=>{this.editDraft.lines[i].suppressGapAfter=cb.checked;};const suppressText=document.createElement('span');I18n.setText(suppressText,()=>I18n.t('LyricsNoAutomaticNoteAfterThis'));suppress.append(cb,suppressText);el.append(suppress);
      const panel=document.createElement('div');panel.className='ly-word-panel hidden';panel.dataset.wordPanel=String(i);el.append(panel);container.append(el);this.refreshWordTokens(i);
    });
    if(this.wordSelection)this.openWord(this.wordSelection.row,this.wordSelection.word,false);
  }
  refreshWordTokens(index){
    const row=this.editDraft?.lines[index],box=this.$('lyricsTimingRows').querySelector(`[data-words-row="${index}"]`);if(!row||!box)return;
    const words=this.wordDrafts.get(index)||this.E.tokens(row);this.wordDrafts.set(index,words);box.replaceChildren();
    if(row.kind==='interlude'){I18n.setText(box,()=>(I18n.t("LyricsInstrumental")));return;}
    words.forEach((word,j)=>{const btn=document.createElement('button');btn.type='button';btn.className='ly-word-token';btn.dataset.wordIndex=String(j);btn.dataset.wordRow=String(index);btn.textContent=word.text;btn.classList.toggle('has-time',word.startMs!==null);btn.classList.toggle('chosen',this.wordSelection?.row===index&&this.wordSelection.word===j);I18n.setAttribute(btn,"title",()=>(word.startMs===null?I18n.t("LyricsSetWordTime"):this.L.stamp(word.startMs)+(word.explicit?'':I18n.t("LyricsTogetherWithThePreviousWord"))));btn.setAttribute('aria-pressed',String(btn.classList.contains('chosen')));btn.onclick=()=>this.openWord(index,j);box.append(btn);});
  }
  openWord(rowIndex,wordIndex,focus=true){
    const words=this.wordDrafts.get(rowIndex),word=words?.[wordIndex];if(!word)return;this.wordSelection={row:rowIndex,word:wordIndex};this.markIndex=rowIndex;
    this.$('lyricsTimingRows').querySelectorAll('.ly-timing-row').forEach((n,j)=>n.classList.toggle('current',j===rowIndex));
    this.$('lyricsTimingRows').querySelectorAll('.ly-word-token').forEach(n=>{const chosen=+n.dataset.wordRow===rowIndex&&+n.dataset.wordIndex===wordIndex;n.classList.toggle('chosen',chosen);n.setAttribute('aria-pressed',String(chosen));});
    this.$('lyricsTimingRows').querySelectorAll('.ly-word-panel').forEach(n=>{n.classList.add('hidden');n.replaceChildren();});
    const panel=this.$('lyricsTimingRows').querySelector(`[data-word-panel="${rowIndex}"]`);panel.classList.remove('hidden');
    const heading=document.createElement('div');heading.className='ly-word-heading';const title=document.createElement('strong');title.textContent=word.text.trim();const sub=document.createElement('small');I18n.setText(sub,()=>(I18n.t("LyricsWordOfLine", {value1:(wordIndex+1),value2:(words.length),value3:(rowIndex+1)})));heading.append(title,sub);
    const field=new window.PulseTimeField({value:word.explicit?word.startMs:null,label:I18n.t("LyricsTimeOfWordLine", {value1:(wordIndex+1),value2:(rowIndex+1)}),automatic:word.startMs===null?I18n.t("LyricsNoTimestamp"):I18n.t("LyricsTogether", {value1:(this.L.stamp(word.startMs).replace(/\.000$/,''))}),onChange:value=>this.setWordTime(rowIndex,wordIndex,value)});field.el.dataset.wordTime='true';
    const actions=document.createElement('div');actions.className='ly-word-actions';
    for(const [label,fn,disabled]of [
      [I18n.t("LyricsNow"),()=>{const ms=Math.max(0,Math.round(this.audio.currentTime*1000-this.editDraft.offsetMs));field.set(ms);this.setWordTime(rowIndex,wordIndex,ms);},false],
      [I18n.t("LyricsNowNext"),()=>{this.setWordTime(rowIndex,wordIndex,Math.max(0,Math.round(this.audio.currentTime*1000-this.editDraft.offsetMs)));if(wordIndex+1<words.length)this.openWord(rowIndex,wordIndex+1);else if(rowIndex+1<this.editDraft.lines.length)this.openWord(rowIndex+1,0);},false],
      ['←',()=>this.openWord(rowIndex,wordIndex-1),wordIndex===0],['→',()=>this.openWord(rowIndex,wordIndex+1),wordIndex===words.length-1]
    ]){const b=document.createElement('button');b.type='button';b.className='ly-tap';I18n.setOwnedText(b,label);b.disabled=disabled;I18n.setAttribute(b,"title",()=>(label==='←'?I18n.t("LyricsPreviousWord"):label==='→'?I18n.t("LyricsNextWord"):b.textContent));b.onclick=fn;actions.append(b);}
    const help=document.createElement('p');help.className='ly-help';I18n.setText(help,()=>(I18n.t("LyricsWithoutItsOwnTimestampAWordIsSung")));
    panel.append(heading,field.el,actions,help);if(focus){panel.scrollIntoView({block:'nearest'});field.focus(0);}
  }
  setWordTime(rowIndex,wordIndex,value){
    try{const result=this.E.wordRow(this.editDraft.lines[rowIndex],this.wordDrafts.get(rowIndex),wordIndex,value);this.editDraft.lines[rowIndex]=result.row;this.wordDrafts.set(rowIndex,result.words);this.refreshWordTokens(rowIndex);
      const startField=this.timingFields[rowIndex*2];if(startField)startField.set(result.row.startMs);this.rowFieldsRefresh();this.preview();
    }catch(e){I18n.setText(this.$('lyricsEditorError'),()=>(I18n.errorMessage(e)));}
  }
  markTime(i,key,next=false){if(!this.editDraft?.lines[i])return;const value=Math.max(0,Math.round(this.audio.currentTime*1000-this.editDraft.offsetMs));try{if(key==='startMs')this.editDraft.lines[i]=this.E.shiftStart(this.editDraft.lines[i],value);else this.editDraft.lines[i][key]=value;this.wordDrafts.delete(i);this.wordSelection=null;
    this.markIndex=next?Math.min(i+1,this.editDraft.lines.length-1):i;this.renderTiming();this.$('lyricsTimingRows').querySelector('.current')?.scrollIntoView({block:'nearest'});this.preview();}catch(e){I18n.setText(this.$('lyricsEditorError'),()=>(I18n.errorMessage(e)));}}
  updateSettingsVisibility(){
    const cover=this.scene?.mode==='cover',gradient=this.scene?.mode==='gradient',auto=cover||this.theme.autoContrast;
    this.$('lyricsGradientGroup').classList.toggle('hidden',!gradient);this.$('lyricsPrimaryGroup').classList.toggle('hidden',cover);
    this.$('lyricsManualColors').classList.toggle('hidden',auto);this.$('lyricsAutoGroup').classList.toggle('hidden',cover);
    I18n.setText(this.$('lyricsAutoHelp'),()=>(cover?I18n.t("LyricsTextColourAndTheCoverBackdropAreChosen"):auto?I18n.t("LyricsTextColoursAreChosenAutomaticallyTurnThisOff"):I18n.t("LyricsManualTextColoursCheckReadabilityInThePreview")));
  }
  openSettings(){if(!this.track||this.loading)return;this.settingsBackup={theme:structuredClone(this.theme),doc:this.doc?structuredClone(this.doc):null,timing:structuredClone(this.timing)};this.$('lyricsSettingsError').textContent='';this.$('lyricsSettings').showModal();this.renderSettings();this.paintTheme();}
  renderSettings(){
    this.$('lyricsPrimaryColor').value=this.theme.background;this.$('lyricsGradientAngle').value=this.theme.gradientAngle;this.$('lyricsFontScale').value=this.theme.fontScale;this.$('lyricsAutoContrast').checked=this.theme.autoContrast;
    this.$('lyricsGap').value=String(this.doc?.gapThresholdMs??this.timing.gapThresholdMs);this.$('lyricsGap').disabled=false;
    for(const id of ['lyricsEarlier','lyricsLater','lyricsResetOffset'])this.$(id).disabled=false;
    this.renderSettingsColors();
    const presets=[[I18n.t("LyricsSunset"),['#794332','#362144']],[I18n.t("LyricsTide"),['#17545b','#172341']],[I18n.t("LyricsLilac"),['#51324e','#292340']],[I18n.t("LyricsDawn"),['#f2d8ad','#ceb2c8']]];
    const box=this.$('lyricsGradientPresets');box.replaceChildren();for(const [label,colors]of presets){const b=document.createElement('button');b.type='button';b.className='ly-preset';b.style.background=`linear-gradient(135deg in srgb,${colors.join(',')})`;b.title=label;b.setAttribute('aria-label',label);b.onclick=()=>{this.theme.gradientColors=[...colors];this.theme.background=colors[0];this.renderSettings();this.paintTheme();};box.append(b);}
  }
  renderSettingsColors(){
    const list=this.$('lyricsGradientColors');list.replaceChildren();this.theme.gradientColors.forEach((color,i)=>{const el=document.createElement('label');el.className='ly-gradient-stop';const input=document.createElement('input');input.type='color';input.value=color;I18n.setAttribute(input,'aria-label',()=>(I18n.t("LyricsGradientColour", {value1:(i+1)})));const label=document.createElement('span');label.textContent=color.toUpperCase();input.oninput=()=>{this.theme.gradientColors[i]=input.value;if(i===0){this.theme.background=input.value;this.$('lyricsPrimaryColor').value=input.value;}label.textContent=input.value.toUpperCase();this.paintTheme();};el.append(input,label);if(this.theme.gradientColors.length>2){const b=document.createElement('button');b.type='button';b.innerHTML=this.icon('close',12);I18n.setAttribute(b,'aria-label',()=>(I18n.t("LyricsRemoveColour", {value1:(i+1)})));b.onclick=()=>{this.theme.gradientColors.splice(i,1);this.renderSettingsColors();this.paintTheme();};el.append(b);}list.append(el);});
    this.$('lyricsAddColor').disabled=this.theme.gradientColors.length>=4;this.$('lyricsTextColor').value=this.theme.text||this.scene?.text||'#dddddd';this.$('lyricsActiveColor').value=this.theme.activeText||this.scene?.active||'#ffffff';
    const auto=this.theme.autoContrast||this.scene?.mode==='cover';this.$('lyricsTextColor').disabled=auto;this.$('lyricsActiveColor').disabled=auto;this.$('lyricsAutoContrast').disabled=this.scene?.mode==='cover';this.updateSettingsVisibility();
  }
  cancelSettings(){if(this.settingsBackup){this.theme=this.settingsBackup.theme;this.doc=this.settingsBackup.doc;this.timing=this.settingsBackup.timing;this.settingsBackup=null;this.paintTheme();this.render();}this.$('lyricsSettings').close();}
  async saveSettings(){const epoch=this.epoch;this.$('lyricsSettingsSave').disabled=true;try{await this.savePresentation();if(epoch!==this.epoch)return;this.settingsBackup=null;this.$('lyricsSettings').close();this.render();}catch(e){I18n.setText(this.$('lyricsSettingsError'),()=>(I18n.errorMessage(e)));}finally{this.$('lyricsSettingsSave').disabled=false;}}
  openSearch(){if(!this.track||this.loading)return;const q=this.L.searchIdentity(this.track);this.$('lyricsSearchArtist').value=q.artist;this.$('lyricsSearchSong').value=q.title;I18n.setText(this.$('lyricsSearchState'),()=>(q.fromTitle?I18n.t("LyricsArtistWasTakenFromTheFilenameTagsAnd"):I18n.t("LyricsRemoveProductionLabelsTrySeveralQueriesAndCheck")));this.$('lyricsSearchResults').replaceChildren();this.$('lyricsCurrentSource').classList.toggle('hidden',!this.doc?.source?.url);this.$('lyricsSearchSubmit').disabled=false;if(!this.$('lyricsSearch').open)this.$('lyricsSearch').showModal();}
  closeSearch(){this.searchGeneration++;this.$('lyricsSearch').close();this.searchResults=[];this.$('lyricsSearchResults').replaceChildren();this.$('lyricsSearchState').textContent='';}
  async search(){
    const epoch=this.epoch,generation=++this.searchGeneration;this.$('lyricsSearchSubmit').disabled=true;I18n.setText(this.$('lyricsSearchState'),()=>(I18n.t("LyricsSearchingForMatchingVersions")));this.$('lyricsSearchResults').replaceChildren();
    try{const found=await this.command({type:'search',rel:this.track.rel,artist:this.$('lyricsSearchArtist').value,title:this.$('lyricsSearchSong').value,consent:true,duration:this.durationMs()/1000});
      if(epoch!==this.epoch||generation!==this.searchGeneration||!this.$('lyricsSearch').open)return;
      this.searchResults=found;I18n.setText(this.$('lyricsSearchState'),()=>(found.length?I18n.t("LyricsClosestMatchesFirstCheckTheVersionASimilar"):I18n.t("LyricsNoMatchesYouCanSearchInABrowser")));
      for(const item of found){const row=document.createElement('div');row.className='ly-result';const copy=document.createElement('div');const title=document.createElement('strong');title.textContent=`${item.artist} - ${item.title}`;const meta=document.createElement('span');I18n.setText(meta,()=>(`${item.album||I18n.t("LyricsNoAlbum")} · ${Math.floor(item.duration/60)}:${String(Math.round(item.duration%60)).padStart(2,'0')} · ${item.instrumental?I18n.t("LyricsInstrumental2"):item.synced?I18n.t("LyricsSynchronised"):I18n.t("LyricsLyricsOnly")}${item.delta!==null&&item.delta>2?I18n.t('DurationDifference',{seconds:I18n.number(item.delta,{minimumFractionDigits:1,maximumFractionDigits:1})}):''}`));copy.append(title,meta);if(item.approximate||item.variantMismatch||item.partial){const hint=document.createElement('small');hint.className='ly-match-note';I18n.setText(hint,()=>([item.variantMismatch?I18n.t("LyricsDifferentRecordingVersion"):item.approximate?I18n.t("LyricsSimilarSpelling"):'',item.partial?I18n.t("LyricsSearchCompletedPartially"):''].filter(Boolean).join(' · ')));copy.append(hint);}const btn=document.createElement('button');btn.type='button';btn.className='button secondary';I18n.setText(btn,()=>(I18n.t("LyricsView")));btn.onclick=()=>{if(epoch!==this.epoch)return;try{
          const result=item.instrumental?this.L.normalize({lines:[{startMs:0,endMs:this.durationMs()||null,kind:'interlude',text:''}]}):this.L.parse(item.synced||item.plain,{kind:item.synced?'lrc':'txt',durationMs:this.durationMs()});
          result.doc.source={name:'LRCLIB',url:item.url,title:item.title,artist:item.artist,album:item.album};if(item.delta>2)result.warnings.push(I18n.t("LyricsDurationDiffersFromTheCurrentRecordingCheckSynchronisation"));
          this.closeSearch();this.edit(result);
        }catch(e){this.error(e);}};row.append(copy,btn);this.$('lyricsSearchResults').append(row);}
    }catch(e){if(epoch===this.epoch&&generation===this.searchGeneration)I18n.setText(this.$('lyricsSearchState'),()=>(I18n.errorMessage(e)));}
    finally{if(epoch===this.epoch&&generation===this.searchGeneration)this.$('lyricsSearchSubmit').disabled=false;}
  }
  async passwordForExport(){if(!this.track?.vaultKey)return null;
    // The shared password sheet is not a native <dialog>. Suspend the editor's
    // top-layer modal while it is open, preserving the draft and undo history.
    const editor=this.$('lyricsEditor'),resume=editor.open,epoch=this.epoch,focus=document.activeElement;
    this.exportPasswordPrompt=resume;if(resume)editor.close();
    try{const values=await this.requestPasswords({title:I18n.t("LyricsUnencryptedCopyOfAProtectedSong"),text:I18n.t("LyricsExportContainsUnencryptedLyricsAndForZIPThe"),fields:[{key:'source',label:I18n.t("UIPlaylistPassword")}]});return values?values.source:undefined;}
    finally{if(resume&&this.opened&&epoch===this.epoch){editor.showModal();if(focus?.isConnected)focus.focus({preventScroll:true});}this.exportPasswordPrompt=false;}}
  async exportPackage(){
    if(!this.track||this.exporting)return;const epoch=this.epoch,track={...this.track};
    if(!await this.confirm(I18n.t("LyricsPrepareAnAIZIPPackage"),I18n.t("LyricsArchiveWillContainAnUnencryptedAudioCopyWithout")))return;
    let password=await this.passwordForExport();if(epoch!==this.epoch||password===undefined)return;
    this.exporting=true;this.$('lyricsCancelExport').classList.remove('hidden');I18n.setText(this.$('lyricsZipBtn'),()=>(I18n.t("LyricsPreparingZIP")));
    try{const r=await this.command({type:'export-package',rel:track.rel,password});password='';if(r.ok)this.notify('good',I18n.t("LyricsAIArchiveSaved"),I18n.t("LyricsNothingWasSentToTheInternet"));}catch(e){this.error(e);}finally{password='';this.exporting=false;this.$('lyricsZipBtn').innerHTML=this.icon('download',16)+I18n.t("LyricsAIZIPPackage");this.$('lyricsCancelExport').classList.add('hidden');}
  }
  finishExportChoice(value){const done=this.exportChoiceResolve;this.exportChoiceResolve=null;this.$('lyricsExportChoice').close();done?.(value);}
  async exportText(){if(!this.track||!this.doc)return;const epoch=this.epoch,rel=this.track.rel;
    this.$('lyricsExportChoice').showModal();const format=await new Promise(resolve=>this.exportChoiceResolve=resolve);if(!format||epoch!==this.epoch)return;
    let password=await this.passwordForExport();if(epoch!==this.epoch||password===undefined)return;
    try{const r=await this.command({type:'export-text',rel,password,format});password='';if(r.ok)this.notify('good',I18n.t("LyricsLyricsSaved"),format==='json'?I18n.t("LyricsJSONPreservesWordTimingsBackgroundAndInstrumentalBreaks"):format==='lrc'?I18n.t("LyricsLRCLineStartsAndOverallOffset"):I18n.t("LyricsTXTPlainTextWithoutSynchronisation"));}catch(e){this.error(e);}finally{password='';}
  }
};

})();
