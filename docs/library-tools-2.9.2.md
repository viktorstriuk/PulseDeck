# Track tools and import architecture · 2.9.2

This document distinguishes implementation choices from the external API contracts.
No service availability or Windows integration is inferred from fixture results.

## Files and identity

`app/library/editor.js` resolves only indexed public tracks or authenticated vault
entries. Public paths are realpath/lstat-checked and must remain below MUSIC_DIR.
A public change is an atomic `.pulse.json` update, retaining `_pulseTrackId`,
`_pulseAddedAt`, unrelated metadata and one `_pulsePrevious` snapshot. A UUID revision
prevents a stale editor/background job from overwriting a newer edit. There is no
new automatic undo UI or whole-job transaction; already completed items remain.
Audio bytes/file names never change in this flow. Lyrics hashes remain attached to
the same recording. Export to other tag editors requires an explicit future tag
writing feature, not assumptions about sidecar support.

Vault edits occur in the authenticated manifest under the existing exclusive write
queue. Image objects are encrypted before referencing them in that manifest. A
short-lived plaintext image is used by the existing encryption worker and removed
in `finally`. This is not a promise that plaintext never touches temporary storage.
Only the changed cover capability is revoked, not the active audio capability.
Original encrypted cover objects may remain for existing references/recovery.
Lock aborts private batch work and removes private panel state.

An editor snapshot scans membership once per capability check/batch. Per-track
metadata, real file checks and revisions are still refreshed before writes. This
avoids N whole-library scans for N renamed tracks without relaxing write guards.

## Artwork discovery and images

`app/online/covers.js` reuses the six-provider service/cache/ranker for first-stage
results. Disabled providers stay disabled. The secondary catalog searches
MusicBrainz releases, then requests front-cover metadata from Cover Art Archive.
The latter is a music-release catalog, not a generic web-image search engine.
The implementation accepts only an explicit HTTPS image-host list, finite redirects
and bounded responses. Main owns expiring opaque selection IDs; the renderer cannot
instruct it to fetch an arbitrary URL as an image. It does not forward cookies.

Catalog requests are serialized with at least 1100 ms between MusicBrainz starts,
with an identifying User-Agent. JSON requests are capped at 3 MiB, images at 16 MiB,
12-second deadlines, cache lifetime 10 minutes and selection lifetime 30 minutes.
A result has at most 72 musical-source images; the secondary stage examines at most
six release responses. This is bounded discovery, not unbounded image pagination.
Music-source failures do not poison the cache as a successful empty result. No-hit
CAA 404 is distinct from service failure.

The UI is a native top-layer popover with a four-column image grid and explicit
selection. Hover only opens the parent editing submenu, never a network search.
Typing is debounced at 320 ms with composition-event support and request generations.
Download is followed by PNG/JPEG/WebP header limits (24 million pixels, 12 000 per
axis), actual nativeImage decoding, a maximum 1200-pixel edge and PNG re-encoding.
SVG, GIF, active content and oversized/unrecognized images are rejected. Preview
thumbnails are fetched by Chromium as images with no referrer; choosing a result
stores a separate normalized image, never HTML from its origin.

## URL search

`online/service.js:resolveLink` accepts one supported track URL, not arbitrary
hosts or album/playlist entry lists. It uses the installed extractor's probe mode,
records normalized metadata, and returns a derived artist/title query. The UI keeps
the pasted URL unchanged, pins its track, then requests alternative providers.
Source provenance distinguishes YouTube from the music.youtube.com host. Source
filtering, canonical deduplication and cancellation remain in the shared model.
An explicit URL can appear even when that source is disabled for broad text search.
The exact stream/download still depends on the source and installed components.

## Capabilities and conservative enrichment

`shared/track-enrichment.js` owns labels/placeholders and the conservative spaced
hyphen/em-dash/en-dash inference. A recognized unknown artist plus a plausible
non-numeric prefix is required. Real artists such as Unknown Mortal Orchestra and
A-ha are preserved. `library/enrichment.js` runs one queue, at most 2000 tracks,
with optional artist/cover/lyrics actions in that order. Counts reflect current
artwork and lyrics. Intentionally suppressed lyrics are not offered again.

Auto-cover matching requires strong title (or album) and artist similarity. Lyrics
use the existing LRCLIB ranker with synced content, non-instrumental/same-version,
score at least 92, artist/title thresholds and a duration tolerance of 2–4 seconds
(the middle portion is 1% of recording duration). Unknown duration/artist is not
accepted as proof of a match. The best accepted duration match is chosen first.
Existing unsynced lyrics are upgraded only if normalized words match; different
manual words remain untouched. Lyrics and track-metadata revisions are checked
again within the write queue. Manual foreground searches no longer cancel a
background batch search; cancellation has separate ownership.

Only selected online actions authorize network queries. Audio is not uploaded.
Failures are logged per item, not turned into guaranteed unavailability/no match.
The user can cancel remaining work; published copies/edits stay. A private playlist
lock cancels its queue. Multiple IPC lock listeners remain independent.

## Drop and archive plan

Preload derives real file paths with `webUtils.getPathForFile(File)`, then invokes
a dedicated guarded `library:prepare-drop` channel. The generic command channel
does not accept arbitrary import paths. The confirmation UI receives a token,
counts and up to five sample names rather than a recursively editable file list.
A 30-minute in-memory plan owns the staging directory. No plan survives a restart
as an executable instruction; stale staging is cleaned on later preparation.

Folders are traversed recursively without following symlinks; hidden/private
folders are skipped. Only supported media and useful sidecars/images are read.
Existing music-directory files are not recopied. Import preserves local readable
lyrics and normalized covers where available; source audio remains in place.
Physical duplicate drop paths collapse, while two different files with the same
name are handled by the existing collision-safe publisher. This is not an acoustic
or hash-based deduplication feature. Source stat changes between inspection and
copy are errors. A corrupt archive does not leak partially extracted songs into a
successful plan, and other dropped sources can still be inspected.

ZIP central/local names, methods, sizes, CRC, directory bounds and traversal are
checked; deflate output is streamed with real output limits. TAR/TGZ headers,
paths, padding and gzip integrity are bounded and validated. RAR/7z/ZIP64,
encrypted/multipart archives, symbolic links and nested archives are not supported.
Only stored/deflate ZIP and regular TAR entries are accepted. DOS-era ZIP encoding
fallback is IBM866; other legacy encodings may need repacking to UTF-8. Limits are
listed in the release notes. The audio publish operation, not archive extraction,
is the point at which music becomes part of the library.

## External API contracts checked on 2026-09-26

- Electron webUtils documents obtaining real paths in preload through
  `getPathForFile`, not the deprecated File.path property. The implementation follows
  that ownership boundary. https://www.electronjs.org/docs/latest/api/web-utils
- MusicBrainz documents request throttling and meaningful application User-Agent.
  The 1100 ms local spacing is our conservative implementation choice, not a promise
  that the service will not throttle. https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting
- Cover Art Archive documents release JSON, front images, thumbnails and redirects;
  404 and 503 are separate responses. https://musicbrainz.org/doc/Cover_Art_Archive/API
- LRCLIB remains the existing application's lyric backend. Its documentation URL
  returned no readable text to the research tool in this session; the new adapter
  reuses the source project's existing query/response model and controlled fixtures,
  not a claimed new verification of its live contract. https://lrclib.net/docs

Browser screenshots use existing PulseDeck icon PNGs as unmistakable fixture art.
They are evidence of layout and interaction, not evidence of online search results.
