# Third-party notices — PulseDeck 2.8.0

The MIT license in the repository applies to original PulseDeck code, not to
third-party components automatically. Copies of applicable license/attribution
texts are in licenses/ and app/licenses/ in a built application.

## Artwork
- **SVG Repo author-supplied artwork:** Public Domain according to MusheP's
  2026-09-23 statement. Includes playlist/pointer assets, link.svg and the three
  source shapes combined by MusheP into the PulseDeck mark. Exact original asset
  URLs were not provided. Do not generalize this status to the entire website.
  Source: https://www.svgrepo.com/page/licensing/#PD
  See CREDITS.md and docs/assets-provenance.json for provenance and checksums.
- **MusheP PNG / PulseDeck composition:** supplied by the author. Author artwork
  is offered under the project's MIT license; third-party source shapes retain
  their declared Public Domain status. MIT grants no trademark endorsement.
- **Font Awesome Free Brands 6.7.2:** the GitHub, YouTube, Telegram, Twitch and
  TikTok SVGs, by Fonticons, Inc.; CC BY 4.0. Standalone path extraction and CSS
  coloring are modifications. https://fontawesome.com/license/free
  https://creativecommons.org/licenses/by/4.0/
  License notice: licenses/Font-Awesome-Free-6.7.2.txt.
- **Font Awesome 4.7:** general UI glyph outlines in renderer/icons.js, from
  Dave Gandy and contributors; SIL OFL 1.1 for the source glyphs. The renderer
  contains converted vector paths, not a font file.
  https://fontawesome.com/v4/license/
  Notice: licenses/Font-Awesome-4.7-notice.txt.

## Runtime and local programs
- **Electron 44.4.1:** original code MIT; includes Chromium, Node.js and third-party
  libraries under their respective licenses. This web installer downloads the
  pinned official runtime and retains the archive's LICENSE and
  LICENSES.chromium.html with the installed runtime. The runtime is not in this
  source repository. https://www.electronjs.org/
- **Node.js / Chromium:** bundled by Electron, not separately auto-upgraded by
  PulseDeck. Their notices accompany the runtime.
  https://nodejs.org/ / https://www.chromium.org/
- **Go:** installer and game helper built using the Go standard library;
  Go's BSD-3-Clause license is retained. https://go.dev/
- **FFmpeg / FFprobe 9.0.1 Gyan essentials Windows build:** separately downloaded
  tools, GPLv3 according to the supplier. FFmpeg's overall license depends on
  build configuration; this statement is about the pinned Windows bundle.
  https://ffmpeg.org/legal.html
  https://www.gyan.dev/ffmpeg/builds/
  https://github.com/GyanD/codexffmpeg/releases/tag/9.0.1
- **yt-dlp 2026.08.19 Windows executable:** source project is Unlicense, but its
  packaged Windows executable includes third-party GPLv3+ components. Do not
  describe that EXE simply as MIT/Unlicense. https://github.com/yt-dlp/yt-dlp

The public source and default web installer do not redistribute the downloaded
FFmpeg/yt-dlp binaries. Components are retrieved on explicit installation or
first use from the pinned upstream sources. Installed component receipts record
version, download URL, archive digest, binary hashes and licensing/source links;
FFmpeg archive license/readme files are retained. Any distributor who elects to
bundle these executables must provide the corresponding source, build scripts
and notices required by that exact distribution; a checksum alone is not a
license-compliance mechanism. The component approval workflow rejects an empty
license or sourceURL. No claim of a completed corresponding-source audit of the
upstream bundles is made here.

## Services / interoperability (not bundled programs)
- **LRCLIB:** user-triggered lyrics lookup. https://lrclib.net/
- **RivaTuner Statistics Server:** optional separate installation. PulseDeck's
  own helper uses RTSSSharedMemoryV2 interoperability, not an RTSS DLL copied
  into PulseDeck. No anti-cheat bypass is implemented. https://www.guru3d.com/

## Development tools
- **Acorn / acorn-walk:** vendored JavaScript parser/walker, MIT, license copies
  in tools/vendor and licenses. Not loaded by the music player.
  https://github.com/acornjs/acorn
- **Playwright:** browser UI tests, Apache-2.0, not bundled with the application.
  https://playwright.dev/

The installer uses PulseDeck's own Go maintenance engine and a sandboxed Electron
HTML interface, not NSIS or electron-updater. Their earlier proposal was not
adopted for this fully owner-drawn installer. Update manifest verification uses
Node.js crypto (Ed25519) and SHA-256; no third-party auto-update package is hidden
inside the distribution.
