# Security

Please do not report vulnerabilities together with secrets, private audio,
vault passwords, decrypted playlists, cookies or signing keys in a public issue.
After the official repository is created, enable GitHub Private Vulnerability
Reporting and use its private security report flow. No repository/security inbox
has been configured in this distribution; use an existing trusted private contact
with MusheP rather than invent an address or publish sensitive details publicly.

The application updater is intentionally inactive without both a configured repository and
Ed25519 public key. An untrusted feed cannot select another key or arbitrary
executable path. SHA-256 is checked during download and immediately before install;
Windows Authenticode signing is **not supplied**. OS security protections remain on.

Since 2.9.1, audio components have independent publisher discovery over HTTPS
with SHA-256. This is not authenticated by the PulseDeck Ed25519 key. Setup
uses bundled pins; tools stay inside the selected application directory and
PATH/external component directories are not executable fallback sources.

See docs/updating.md and docs/storage.md for protocol and recovery boundaries.
The test suite is not an independent security audit. In particular, a compromised
maintainer/private key or same-user process able to modify the installation can
invalidate application-level assumptions. Key compromise requires stopping release
publication, rotating credentials and delivering a manually verified trust update.

If a credential ever enters public Git history, revoke it first; deleting only the
current file does not revoke a leaked credential or erase the repository history.
