'use strict';

// Shared by Electron's main process, the renderer and node:test. No filesystem or DOM.
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.PulseLibrary = model;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const I18n = typeof module === 'object' && module.exports ? require('../i18n') : globalThis.PulseI18n;

  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const clone = value => JSON.parse(JSON.stringify(value));
  const token = value => String(value || '').replaceAll('\\', '/').toLocaleLowerCase('ru');
  const artistKey = value => String(value || '').trim().toLocaleLowerCase('ru');
  const unique = values => [...new Set((Array.isArray(values) ? values : []).map(token).filter(Boolean))];
  const SYSTEM_KEYS = new Set(['all', 'favorite', 'downloads', 'recent']);
  const SORTS = ['manual', 'recent', 'old', 'title', 'titleDesc', 'artist', 'album', 'durationAsc', 'durationDesc', 'source', 'sizeDesc'];
  const FIELDS = ['favorites', 'customCategories', 'categoryOrder', 'categoryStyles', 'artistAliases', 'artistNames', 'artistAliasHistory', 'playlistMembership', 'trackOrders', 'trackOrderSchema', 'protectedPlaylists'];

  function normalizeOrganization(settings) {
    const next = { ...settings };
    next.protectedPlaylists = {...record(next.protectedPlaylists)};
    next.favorites = unique(next.favorites);
    next.categoryOrder = [...new Set((Array.isArray(next.categoryOrder) ? next.categoryOrder : []).map(String))];
    next.categoryStyles = { ...record(next.categoryStyles) };
    next.customCategories = (Array.isArray(next.customCategories) ? next.customCategories : [])
      .filter(c => c && typeof c.id === 'string' && c.id.startsWith('custom:'))
      .filter((c, i, list) => list.findIndex(x => x.id === c.id) === i)
      .map(c => ({ ...c, name: String(c.name || ''), tracks: unique(c.tracks) }));
    next.artistAliases = Object.create(null);
    for (const [from, to] of Object.entries(record(settings.artistAliases))) {
      const a = artistKey(from), b = artistKey(to);
      if (a && b && a !== b) next.artistAliases[a] = b;
    }
    // Flatten chains and repair imported cycles deterministically, never looping on bad settings.
    const aliases = { ...next.artistAliases };
    for (const a of Object.keys(aliases)) {
      const target = resolveArtist(a, aliases);
      if (target === a) delete next.artistAliases[a]; else next.artistAliases[a] = target;
    }
    next.artistNames = Object.create(null);
    for (const [key, value] of Object.entries(record(settings.artistNames))) {
      if (artistKey(key)) next.artistNames[artistKey(key)] = String(value || key).slice(0, 300);
    }
    next.playlistMembership = Object.create(null);
    for (const [key, value] of Object.entries(record(settings.playlistMembership))) {
      if (!key || key === 'all' || key === 'favorite') continue;
      const included = unique(value?.included), excluded = unique(value?.excluded);
      const exclude = new Set(excluded);
      next.playlistMembership[key] = { included: included.filter(x => !exclude.has(x)), excluded };
    }
    next.trackOrders = Object.create(null);
    for (const [category, orders] of Object.entries(record(settings.trackOrders))) {
      next.trackOrders[category] = Object.create(null);
      for (const [sort, rels] of Object.entries(record(orders))) {
        if (SORTS.includes(sort) && Array.isArray(rels)) next.trackOrders[category][sort] = unique(rels);
      }
    }
    // 2.6 stored hand-edited sequences under automatic sort names. Preserve that
    // data and promote the last visible sequence into a real Manual option once.
    if (Number(settings.trackOrderSchema || 0) < 2) {
      for (const orders of Object.values(next.trackOrders)) {
        if (!orders.manual?.length) {
          const legacy = orders[settings.sort] || orders.recent || Object.values(orders).find(a => a?.length);
          if (legacy?.length) orders.manual = [...legacy];
        }
      }
      if (next.trackOrders.all?.[settings.sort]?.length && settings.sort !== 'manual') next.sort = 'manual';
    }
    // Small reversible records for rules created from 2.6.3 onward. Older rules
    // are still split by their original artist tags and legacy membership pins.
    next.artistAliasHistory = (Array.isArray(settings.artistAliasHistory) ? settings.artistAliasHistory : [])
      .filter(x => x && artistKey(x.from) && artistKey(x.to) && artistKey(x.from) !== artistKey(x.to))
      .map(x => ({from:artistKey(x.from),to:artistKey(x.to),added:unique(x.added),
        membership:{included:unique(x.membership?.included),excluded:unique(x.membership?.excluded)},
        orders:Object.fromEntries(Object.entries(record(x.orders)).filter(([k,v]) => SORTS.includes(k) && Array.isArray(v)).map(([k,v]) => [k,unique(v)]))}));
    next.trackOrderSchema = 2;
    return next;
  }

  function resolveArtist(name, aliases = {}) {
    let current = artistKey(name);
    const visited = [];
    while (current && own(aliases, current) && artistKey(aliases[current]) !== current) {
      const cycleStart = visited.indexOf(current);
      if (cycleStart !== -1) return visited.slice(cycleStart).sort()[0];
      visited.push(current);
      current = artistKey(aliases[current]);
    }
    return current;
  }

  function categories(tracks, settings, includeHidden = false) {
    const base = [
      { key: 'all', label: I18n.t("LibraryAllTracks"), icon: 'music', color: '#8b72ff' },
      { key: 'favorite', label: I18n.t("LibraryFavorites"), icon: 'heartFill', color: '#f174a8' },
      { key: 'downloads', label: I18n.t("LibraryDownloads"), icon: 'download', color: '#27ab7b' },
      { key: 'recent', label: I18n.t("LibraryRecent"), icon: 'clock', color: '#4665c2' },
    ].map(c => ({ ...c, system: true, kind: 'system', canRename: true, canDelete: false }));
    const map = new Map();
    for (const t of tracks) {
      const raw = String(t.artist || '@unknown-artist').trim();
      const source = artistKey(raw), canonical = resolveArtist(source, settings.artistAliases);
      if (!canonical) continue;
      const entry = map.get(canonical) || { count: 0, spellings: new Map() };
      entry.count++;
      if (source === canonical) entry.spellings.set(raw, (entry.spellings.get(raw) || 0) + 1);
      map.set(canonical, entry);
    }
    // Keep a rule's destination even if its own last file was removed or an external drive is absent.
    for (const target of Object.values(settings.artistAliases || {})) {
      const canonical = resolveArtist(target, settings.artistAliases);
      if (!map.has(canonical)) map.set(canonical, { count: 0, spellings: new Map() });
    }
    const artists = [...map.entries()].map(([name, entry]) => ({
      key: `artist:${name}`, sourceArtistNormalized: name, count: entry.count,
      label: name === '@unknown-artist' ? I18n.t('UnknownArtist') : [...entry.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], I18n.locale))[0]?.[0]
        || settings.artistNames?.[name] || name,
      icon: 'music', color: '#7890b9', system: false, kind: 'artist', canRename: true, canDelete: true,
    })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, I18n.locale));
    for (const [key, vault] of Object.entries(settings.protectedPlaylists || {})) {
      if (key.startsWith('artist:') && !artists.some(c=>c.key===key)) artists.push({key, sourceArtistNormalized:key.slice(7), label:vault.name||key.slice(7), icon:'music', color:'#7890b9', kind:'artist', system:false, canRename:true, canDelete:true});
    }
    const customs = (settings.customCategories || []).map(c => ({
      ...c, key: c.id, label: c.name || I18n.t("UIPlaylist"), icon: c.icon || 'pi:star',
      color: c.color || '#b038ae', kind: 'custom', system: false, canRename: true, canDelete: true,
    }));
    const rank = new Map((settings.categoryOrder || []).map((key, i) => [key, i]));
    return [...base, ...artists, ...customs].map(c => {
      const style = c.kind === 'custom' ? c : (settings.categoryStyles?.[c.key] || {});
      return { ...c, ...style, key: c.key, kind: c.kind, system: c.system, canRename: c.canRename, canDelete: c.canDelete,
        protected: !!settings.protectedPlaylists?.[c.key], label: style.name || c.label, hidden: !!style.hidden, deleted: !!style.deleted,
        glowIntensity: Math.max(0, Math.min(100, Number(style.glowIntensity ?? 45))) };
    }).filter(c => (!c.deleted || c.system) && (includeHidden || !c.hidden))
      .sort((a, b) => (rank.get(a.key) ?? 1e9) - (rank.get(b.key) ?? 1e9));
  }

  // Build sets once per view, not once per track (large libraries remain linear).
  function membershipPredicate(settings, key, now = Date.now()) {
    const custom = (settings.customCategories || []).find(c => c.id === key);
    const included = new Set(unique(settings.playlistMembership?.[key]?.included));
    const excluded = new Set(unique(settings.playlistMembership?.[key]?.excluded));
    const favorites = new Set(unique(settings.favorites));
    const customTracks = new Set(unique(custom?.tracks));
    return track => {
      if (settings.protectedPlaylists?.[key]) return track.vaultKey === key;
      if (track.vaultKey) return false;
      const rel = token(track.rel);
      if (key === 'all') return true;
      if (key === 'favorite') return favorites.has(rel);
      if (custom) return customTracks.has(rel);
      if (excluded.has(rel)) return false;
      if (included.has(rel)) return true;
      if (key === 'downloads') return !!track.downloaded;
      if (key === 'recent') return now - Number(track.addedAt || 0) <= 30 * 86400000;
      if (key.startsWith('artist:')) return resolveArtist(track.artist || '@unknown-artist', settings.artistAliases) === key.slice(7);
      return false;
    };
  }

  function containsTrack(settings, tracks, key, track, now = Date.now()) {
    return membershipPredicate(settings, key, now)(track);
  }

  function baseSort(list, sort) {
    const collate = (a, b) => String(a || '').localeCompare(String(b || ''), 'ru', { sensitivity: 'base', numeric: true });
    const comparators = {
      recent: (a, b) => b.addedAt - a.addedAt,
      old: (a, b) => a.addedAt - b.addedAt,
      title: (a, b) => collate(a.title, b.title), titleDesc: (a, b) => collate(b.title, a.title),
      artist: (a, b) => collate(a.artist, b.artist) || collate(a.title, b.title),
      album: (a, b) => collate(a.album, b.album) || collate(a.title, b.title),
      durationAsc: (a, b) => (Number(a.duration) || 0) - (Number(b.duration) || 0) || collate(a.title, b.title),
      durationDesc: (a, b) => (Number(b.duration) || 0) - (Number(a.duration) || 0) || collate(a.title, b.title),
      source: (a, b) => collate(a.sourceProvider || (a.downloaded ? 'online' : 'local'), b.sourceProvider || (b.downloaded ? 'online' : 'local')) || collate(a.artist, b.artist),
      sizeDesc: (a, b) => (Number(b.size) || 0) - (Number(a.size) || 0) || collate(a.title, b.title),
    };
    const compare = comparators[sort] || comparators.recent;
    return [...list].sort((a, b) => compare(a, b) || collate(a.rel, b.rel));
  }

  function applyOrder(sorted, rels) {
    if (!Array.isArray(rels) || !rels.length) return sorted;
    const rank = new Map(unique(rels).map((rel, i) => [rel, i]));
    return [...sorted].sort((a, b) => (rank.get(token(a.rel)) ?? Number.MAX_SAFE_INTEGER) - (rank.get(token(b.rel)) ?? Number.MAX_SAFE_INTEGER));
  }

  function view(tracks, settings, category, sort, query = '', now = Date.now()) {
    const member = membershipPredicate(settings, category, now);
    const sorted = baseSort(tracks.filter(member), sort);
    const ordered = sort === 'manual' ? applyOrder(sorted, settings.trackOrders?.[category]?.manual) : sorted;
    const q = String(query).trim().toLocaleLowerCase('ru');
    return q ? ordered.filter(t => `${t.title} ${t.artist} ${t.album}`.toLocaleLowerCase('ru').includes(q)) : ordered;
  }

  // A filtered drag replaces ONLY the slots occupied by visible tracks.
  function mergeVisibleOrder(fullOrder, visibleOrder) {
    const full = unique(fullOrder), visible = unique(visibleOrder);
    const allowed = new Set(full);
    const remaining = visible.filter(x => allowed.has(x));
    const visibleSet = new Set(remaining);
    let index = 0;
    return full.map(rel => visibleSet.has(rel) ? remaining[index++] : rel);
  }

  function addTracks(settings, key, rels) {
    const added = unique(rels);
    if (key === 'all') return;
    if (key === 'favorite') { settings.favorites = unique([...(settings.favorites || []), ...added]); return; }
    const custom = settings.customCategories.find(c => c.id === key);
    if (custom) { custom.tracks = unique([...custom.tracks, ...added]); return; }
    const addedSet = new Set(added);
    const membership = settings.playlistMembership[key] || { included: [], excluded: [] };
    settings.playlistMembership[key] = { included: unique([...membership.included, ...added]), excluded: membership.excluded.filter(x => !addedSet.has(token(x))) };
  }

  function toggleMembership(settings, tracks, key, rel) {
    const next = normalizeOrganization(clone(settings));
    if (!categories(tracks, next, true).some(c => c.key === key)) throw I18n.error("LibraryPlaylistNoLongerExists");
    const track = tracks.find(t => token(t.rel) === token(rel));
    if (!track) throw I18n.error("LibraryTrackNoLongerExists");
    if (key === 'all') return { settings: next, added: false, unchanged: true };
    const has = membershipPredicate(next, key)(track), wanted = token(track.rel);
    if (!has) addTracks(next, key, [wanted]);
    else if (key === 'favorite') next.favorites = next.favorites.filter(x => token(x) !== wanted);
    else {
      const custom = next.customCategories.find(c => c.id === key);
      if (custom) custom.tracks = custom.tracks.filter(x => token(x) !== wanted);
      else {
        const current = next.playlistMembership[key] || { included: [], excluded: [] };
        next.playlistMembership[key] = { included: current.included.filter(x => token(x) !== wanted), excluded: unique([...current.excluded, wanted]) };
      }
    }
    return { settings: next, added: !has };
  }

  function removeCategory(next, key) {
    if (SYSTEM_KEYS.has(key)) throw I18n.error("LibrarySystemPlaylistsCannotBeDeleted");
    next.customCategories = next.customCategories.filter(c => c.id !== key);
    if (key.startsWith('artist:')) next.categoryStyles[key] = { ...(next.categoryStyles[key] || {}), deleted: true };
    else delete next.categoryStyles[key];
    next.categoryOrder = next.categoryOrder.filter(k => k !== key);
    delete next.playlistMembership[key];
    delete next.trackOrders[key];
  }

  function mergePlaylists(settings, tracks, sourceKey, targetKey) {
    const next = normalizeOrganization(clone(settings));
    const cats = categories(tracks, next, true);
    const source = cats.find(c => c.key === sourceKey), target = cats.find(c => c.key === targetKey);
    if (!source || !target || sourceKey === targetKey) throw I18n.error("LibrarySelectTwoDifferentExistingPlaylists");
    const moved = unique([
      ...tracks.filter(membershipPredicate(next, sourceKey)).map(t => t.rel),
      ...(source.tracks || []), ...(next.playlistMembership[sourceKey]?.included || []),
    ]);
    const before = tracks.filter(membershipPredicate(next, targetKey)).length;
    addTracks(next, targetKey, moved);
    if(source.system)next.categoryStyles[sourceKey]={...(next.categoryStyles[sourceKey]||{}),hidden:true};else removeCategory(next,sourceKey);
    const custom=next.customCategories.find(c=>c.id===targetKey);if(custom)custom.hidden=false;else next.categoryStyles[targetKey]={...(next.categoryStyles[targetKey]||{}),hidden:false};
    const after = tracks.filter(membershipPredicate(next, targetKey)).length;
    return { settings: next, targetKey, sourceKey, moved: moved.length, added: after - before };
  }

  function aliasArtist(settings, tracks, sourceKey, targetKey) {
    const next = normalizeOrganization(clone(settings));
    const cats = categories(tracks, next, true);
    const source = cats.find(c => c.key === sourceKey && c.kind === 'artist');
    const target = cats.find(c => c.key === targetKey && c.kind === 'artist');
    if (!source || !target || sourceKey === targetKey) throw I18n.error("LibraryTwoDifferentArtistPlaylistsAreRequired");
    const from = source.sourceArtistNormalized, to = resolveArtist(target.sourceArtistNormalized, next.artistAliases);
    if (from === to) throw I18n.error("LibraryTheseArtistsAreAlreadyMergedUnderOneRule");
    const moved = unique(tracks.filter(membershipPredicate(next, sourceKey)).map(t => t.rel));
    const membership = clone(next.playlistMembership[sourceKey] || {included:[],excluded:[]});
    const targetPins = new Set(next.playlistMembership[targetKey]?.included || []);
    // Automatic artist membership follows aliases, not sticky manual pins. Only
    // explicitly included tracks need transfer; record new pins for a later split.
    next.artistAliasHistory.push({from,to,membership,orders:clone(next.trackOrders[sourceKey] || {}),
      added:membership.included.filter(rel => !targetPins.has(rel))});
    addTracks(next, targetKey, membership.included);
    const movedSet = new Set(moved);
    next.playlistMembership[targetKey].excluded = next.playlistMembership[targetKey].excluded.filter(rel => !movedSet.has(rel));
    next.artistNames[from] = source.label;
    next.artistNames[to] = target.label;
    next.artistAliases[from] = to;
    for (const name of Object.keys(next.artistAliases)) next.artistAliases[name] = resolveArtist(name, next.artistAliases);
    removeCategory(next, sourceKey);
    next.categoryStyles[targetKey] = { ...(next.categoryStyles[targetKey] || {}), deleted: false };
    return { settings: normalizeOrganization(next), sourceKey, targetKey, moved: moved.length };
  }

  function requireTracks(tracks, rels) {
    const wanted = unique(rels);
    if (!wanted.length) throw I18n.error("LibrarySelectTracksFirst");
    const byRel = new Map(tracks.map(t => [token(t.rel),t]));
    if (wanted.some(rel => !byRel.has(rel))) throw I18n.error("LibrarySomeTracksNoLongerExistRefreshYourSelection");
    return wanted.map(rel => byRel.get(rel));
  }

  function bulkAdd(settings, tracks, key, rels) {
    const next = normalizeOrganization(clone(settings));
    if (!categories(tracks,next,true).some(c => c.key === key)) throw I18n.error("LibraryPlaylistNoLongerExists");
    const selected = requireTracks(tracks,rels), member = membershipPredicate(next,key);
    const added = selected.filter(t => !member(t)).length;
    addTracks(next,key,selected.map(t => t.rel));
    return {settings:next,targetKey:key,added,count:selected.length};
  }


  function bulkRemove(settings, tracks, key, rels) {
    const next=normalizeOrganization(clone(settings));
    if(key==='all')throw I18n.error("LibraryRemovingTracksFromAllAlsoRequiresDeletingTheir");
    if(!categories(tracks,next,true).some(c=>c.key===key))throw I18n.error("LibraryPlaylistNoLongerExists");
    const selected=requireTracks(tracks,rels), wanted=new Set(selected.map(t=>token(t.rel)));
    const removed=selected.filter(membershipPredicate(next,key)).length;
    if(key==='favorite')next.favorites=next.favorites.filter(r=>!wanted.has(token(r)));
    else {
      const custom=next.customCategories.find(c=>c.id===key);
      if(custom)custom.tracks=custom.tracks.filter(r=>!wanted.has(token(r)));
      else {const m=next.playlistMembership[key]||{included:[],excluded:[]};
        next.playlistMembership[key]={included:m.included.filter(r=>!wanted.has(token(r))),excluded:unique([...m.excluded,...wanted])};}
    }
    return {settings:next,removed,count:selected.length,targetKey:key};
  }

  function bulkCategories(settings, tracks, keys, action, targetKey='') {
    let next=normalizeOrganization(clone(settings));
    const wanted=[...new Set(Array.isArray(keys)?keys:[])], cats=categories(tracks,next,true);
    if(!wanted.length || wanted.some(k=>!cats.some(c=>c.key===k)))throw I18n.error("AppRefreshYourPlaylistSelection");
    const eligible=action==='delete'?wanted.filter(k=>!SYSTEM_KEYS.has(k)):wanted;
    const skipped=wanted.filter(k=>!eligible.includes(k));
    if(action==='merge' && (!wanted.includes(targetKey)||wanted.length<2))throw I18n.error("LibrarySelectThePlaylistToKeep");

    for(const key of eligible){
      if(action==='hide'){
        const custom=next.customCategories.find(c=>c.id===key);
        if(custom)custom.hidden=true;else next.categoryStyles[key]={...(next.categoryStyles[key]||{}),hidden:true};
      }else if(action==='delete')removeCategory(next,key);
      else if(action==='merge' && key!==targetKey)next=mergePlaylists(next,tracks,key,targetKey).settings;
    }
    if(!['hide','delete','merge'].includes(action))throw I18n.error("AppUnknownOperation");
    return {settings:next,targetKey,count:eligible.length,applied:eligible,skipped};
  }

  function playlistBatchEligibility(cats,action){
    return cats.filter(c=>action==='delete'?c.canDelete:action==='alias'?c.kind==='artist':action==='link'?c.protected:true);
  }

  function aliasSelectedPlaylists(settings,tracks,keys,targetKey){
    let next=normalizeOrganization(clone(settings));
    const cats=categories(tracks,next,true), selected=[...new Set(keys||[])].map(k=>cats.find(c=>c.key===k)).filter(Boolean);
    const artists=selected.filter(c=>c.kind==='artist');
    if(artists.length<2)throw I18n.error("LibrarySelectAtLeastTwoDifferentArtists");
    for(const c of artists)if(c.key!==targetKey)next=aliasArtist(next,tracks,c.key,targetKey).settings;
    return {settings:next,targetKey,count:artists.length};
  }

  function artistGroups(settings, tracks) {
    const groups = new Map(), aliases = settings.artistAliases || {};
    const names = new Map(Object.entries(settings.artistNames || {}));
    for (const t of tracks) if (artistKey(t.artist)) names.set(artistKey(t.artist),String(t.artist).trim());
    const artists = new Set([...names.keys(),...Object.keys(aliases),...Object.values(aliases)]);
    for (const raw of artists) {
      const name = artistKey(raw), canonical = resolveArtist(name,aliases);
      if (!canonical) continue;
      if (!groups.has(canonical)) groups.set(canonical,{key:`artist:${canonical}`,canonical,members:[],label:names.get(canonical)||canonical});
      groups.get(canonical).members.push({name,label:names.get(name)||name});
    }
    return [...groups.values()].filter(g => g.members.length > 1 && g.members.some(m => own(aliases,m.name)));
  }

  function selectionArtists(settings, tracks, rels) {
    const selected = requireTracks(tracks,rels);
    const canonical = [...new Set(selected.map(t => resolveArtist(t.artist,settings.artistAliases)).filter(Boolean))];
    // A group elsewhere in the library is NOT part of this selection. In 2.6.3
    // two tracks by A incorrectly exposed Split merely because B was aliased to A.
    const raw = new Set(selected.map(t=>artistKey(t.artist)).filter(Boolean));
    const groups = artistGroups(settings,tracks).filter(g => g.members.filter(m=>raw.has(m.name)).length > 1);
    return {canonical,groups,canAlias:canonical.length>1,canSplit:groups.length>0};
  }

  function aliasSelectedArtists(settings, tracks, rels, targetKey) {
    let next = normalizeOrganization(clone(settings));
    const info = selectionArtists(next,tracks,rels);
    if (!info.canAlias) throw I18n.error("LibrarySelectedTracksAlreadyBelongToASingleArtist");
    if (!categories(tracks,next,true).some(c => c.kind === 'artist' && c.key === targetKey)) throw I18n.error("LibrarySelectAnExistingArtist");
    let moved = 0;
    const removed = [];
    // Work on a private copy; a failure cannot persist half of a multi-rule edit.
    for (const name of info.canonical) {
      const sourceKey = `artist:${resolveArtist(name,next.artistAliases)}`;
      if (sourceKey === targetKey) continue;
      if (next.categoryStyles[sourceKey]?.deleted) next.categoryStyles[sourceKey] = {...next.categoryStyles[sourceKey],deleted:false};
      const result = aliasArtist(next,tracks,sourceKey,targetKey);
      next = result.settings; moved += result.moved; removed.push(sourceKey);
    }
    return {settings:next,targetKey,sourceKeys:removed,moved};
  }

  function splitArtistGroups(settings, tracks, keys) {
    const next = normalizeOrganization(clone(settings));
    const requested = new Set((Array.isArray(keys)?keys:[]).map(k => String(k).replace(/^artist:/,''))
      .map(name => resolveArtist(name,next.artistAliases)));
    const groups = artistGroups(next,tracks).filter(g => requested.has(g.canonical));
    if (!groups.length) throw I18n.error("LibraryThereAreNoMergedArtistsHere");
    const rawMembers = new Set(groups.flatMap(g => g.members.map(m => m.name)));
    const canonical = new Set(groups.map(g => g.canonical));
    const history = next.artistAliasHistory.filter(h => canonical.has(resolveArtist(h.from,next.artistAliases)));
    const recorded = new Set(history.map(h => h.from));
    const legacySources = new Set([...rawMembers].filter(name => own(next.artistAliases,name) && !recorded.has(name)));
    // Reverse transfers in reverse order, preserving memberships present before
    // each rule, custom playlists, favorites and unrelated artist groups.
    for (const h of [...history].reverse()) {
      const sourceKey = `artist:${h.from}`, targetKey = `artist:${h.to}`;
      const target = next.playlistMembership[targetKey];
      if (target) { const added = new Set(h.added); target.included = target.included.filter(rel => !added.has(rel)); }
      next.playlistMembership[sourceKey] = clone(h.membership);
      if (Object.keys(h.orders).length) next.trackOrders[sourceKey] = clone(h.orders);
    }
    next.artistAliasHistory = next.artistAliasHistory.filter(h => !history.includes(h));
    const byRel = new Map(tracks.map(t => [token(t.rel),artistKey(t.artist)]));
    for (const name of rawMembers) {
      const key = `artist:${name}`;
      delete next.artistAliases[name];
      next.categoryStyles[key] = {...(next.categoryStyles[key]||{}),deleted:false,hidden:false};
      const membership = next.playlistMembership[key];
      if (membership) {
        // 2.6.0–2.6.2 pinned automatic tracks into the destination as well. Do
        // not leave those duplicate memberships behind when the rule is gone.
        membership.included = membership.included.filter(rel => !legacySources.has(byRel.get(rel)) || byRel.get(rel) === name);
      }
    }
    return {settings:normalizeOrganization(next),groups:groups.map(g=>g.key),artists:[...rawMembers],count:rawMembers.size};
  }

  function splitSelectedArtists(settings, tracks, rels) {
    const info = selectionArtists(settings,tracks,rels);
    return splitArtistGroups(settings,tracks,info.groups.map(g=>g.key));
  }

  function organizationPatch(settings) {
    return Object.fromEntries(FIELDS.map(key => [key, settings[key]]));
  }

  function removeTrack(settings, rel) {
    const next = normalizeOrganization(clone(settings)), wanted = token(rel);
    next.favorites = next.favorites.filter(x => x !== wanted);
    for (const c of next.customCategories) c.tracks = c.tracks.filter(x => x !== wanted);
    for (const membership of Object.values(next.playlistMembership)) {
      membership.included = membership.included.filter(x => x !== wanted);
      membership.excluded = membership.excluded.filter(x => x !== wanted);
    }
    for (const orders of Object.values(next.trackOrders)) for (const sort of Object.keys(orders)) orders[sort] = orders[sort].filter(x => x !== wanted);
    for (const h of next.artistAliasHistory) {
      h.added = h.added.filter(x=>x!==wanted);
      h.membership.included = h.membership.included.filter(x=>x!==wanted);
      h.membership.excluded = h.membership.excluded.filter(x=>x!==wanted);
      for (const k of Object.keys(h.orders)) h.orders[k] = h.orders[k].filter(x=>x!==wanted);
    }
    return next;
  }


  class OrderHistory {
    constructor(limit = 100) { this.limit = limit; this.undoStack = []; this.redoStack = []; }
    push(entry) {
      if (JSON.stringify(entry.before) === JSON.stringify(entry.after) && entry.beforeSort === entry.afterSort) return false;
      this.undoStack.push(clone(entry));
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack.length = 0;
      return true;
    }
    take(redo = false) {
      const source = redo ? this.redoStack : this.undoStack;
      const target = redo ? this.undoStack : this.redoStack;
      const entry = source.pop();
      if (!entry) return null;
      target.push(entry);
      return { ...clone(entry), order: clone(redo ? entry.after : entry.before) };
    }
    discard(category) {
      this.undoStack = this.undoStack.filter(x => x.category !== category);
      this.redoStack = this.redoStack.filter(x => x.category !== category);
    }
  }

  const trackTitle=t=>String(t?.title || I18n.t('AppUntitled'));
  const trackArtist=t=>String(t?.artist || I18n.t('UnknownArtist'));
  const trackCreator=t=>String(t?.artist || I18n.t('AppUnknownCreator'));
  return { trackTitle, trackArtist, trackCreator, token, artistKey, unique, SORTS, SYSTEM_KEYS, normalizeOrganization, resolveArtist, categories, containsTrack,
    membershipPredicate, baseSort, applyOrder, view, mergeVisibleOrder, addTracks, toggleMembership,
    mergePlaylists, aliasArtist, bulkAdd, bulkRemove, bulkCategories, playlistBatchEligibility, aliasSelectedPlaylists, requireTracks, artistGroups, selectionArtists, aliasSelectedArtists, splitArtistGroups, splitSelectedArtists, organizationPatch, removeTrack, OrderHistory };
});
