# Architecture / boundaries

- `app/main.js` owns IPC, paths, playback orchestration and trusted update operations.
  `app/preload.js` exposes narrow methods, not arbitrary processes or filesystem APIs.
- `app/updates/security.js` is a pure SemVer / URL / signature validator. A feed
  cannot supply its own verification key. `transport.js` bounds redirects, bytes,
  time and streaming hashes; partial files are never launched.
- `manager.js` persists app update preferences, pending signed envelope and cache;
  requires a current, nonce-bound main-renderer acknowledgement before quitting.
- `components.js` stages binary versions and switches an index only after hash,
  extraction, PE and probe checks. `upstream-components.js` discovers publisher
  versions independently of the application feed. Only complete tool groups
  inside the selected application directory are resolved; PATH is not searched.
  Runtime / JavaScript libraries update with the app.
- `storage-paths.js` fixes user paths independently of replaceable code. I18n merges
  trusted built-in catalogs with non-executable per-user JSON overrides.
- `release-center.js` is the About/Updates UI. It renders remote release notes as
  text. It cannot choose arbitrary installer paths or pass arbitrary process args.
- `installer/engine` embeds a checksummed package, bootstraps pinned Electron,
  owner-draws the startup window, and journals installation/removal on Windows.
  `components.go` provisions pinned yt-dlp and FFmpeg/FFprobe into the selected
  directory before application commit. Test-only injected I/O exercises failure
  and repair without downloading or launching Windows binaries in Linux.
- `installer/ui` runs in that temporary pinned runtime with sandbox,
  contextIsolation, restricted IPC sender/frame and local-only navigation/CSP.
  It uses its own HTML directory chooser. It launches only its package's
  maintenance executable and the exact completed installation path.
- Transparent window: the logo extends beyond the **drawn panel**, not the OS
  window. OS security prompts are external and are never hidden or restyled.
- `native` remains the separate RTSS/window helper. This update does not inject
  DLLs into games or bypass protections.

This implementation intentionally does not use NSIS or electron-updater. A custom
UI is not a substitute for Windows acceptance tests or independent security review.
Feed signing is Ed25519; no Authenticode certificate is included. System administrators,
malicious same-user code, a compromised maintainer key and arbitrary hardware failure
are outside the guarantees of a signed GitHub transport.
