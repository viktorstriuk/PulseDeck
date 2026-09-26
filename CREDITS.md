# PulseDeck · MusheP

PulseDeck's original code, custom installer and update tooling: © 2026 MusheP,
MIT. See LICENSE. Third-party assets and programs retain their own licenses.

Author's public profiles (provided by the author):
- GitHub: https://github.com/viktorstriuk
- YouTube: https://www.youtube.com/@mushep
- Telegram: https://t.me/mushepchannel
- Twitch: https://www.twitch.tv/themushep
- TikTok: https://www.tiktok.com/@themushep

These are author profiles, NOT the official application update repository.
The update repository and its Ed25519 trust key are intentionally unset.

## Artwork provenance
On 2026-09-23 the author declared that the supplied playlist/pointer/link icons
and the three source shapes of the PulseDeck mark were obtained from SVG Repo
under its Public Domain designation:
https://www.svgrepo.com/page/licensing/#PD

This is the author's provenance statement, not an assertion that every icon on
SVG Repo is Public Domain. Individual asset URLs were not supplied; the original
source names and checksums are recorded in docs/assets-provenance.json. Future
contributions should record each exact asset page and license.

The PulseDeck monitor/pulse/note composition was made by MusheP. In 2.7.1 its
vector geometry was recovered from the author-provided raster because the
original composition SVG was unavailable. The recovered geometry is retained;
it is not described as a found original SVG. Existing preset colors remain.

app/assets/author/mushep.png is the author's supplied PNG, copied unmodified.
app/assets/ui/link.svg is the user's supplied link.svg, copied unmodified.

The five new social SVGs are from Font Awesome Free Brands 6.7.2 by Fonticons,
Inc., CC BY 4.0. Changes: paths extracted into standalone monochrome SVGs and
colored in the UI with CSS masks. Attribution and license are retained. Brand
names and logos remain subject to their owners' trademark rights; no endorsement
is implied.

## Ресурс интерфейса 2.8.1

`app/assets/ui/user-off.svg` предоставлен MusheP 24 сентября 2026 года для подписи
«Без аккаунта» в установщике и сохранён без изменения SVG. Контрольная сумма
зафиксирована в `docs/assets-provenance.json`. Точная страница исходного ресурса
не передана; происхождение SVG Repo следует ранее предоставленным сведениям автора.

## 2.9.2 artwork tools

`app/assets/player-icons/cover-selected.svg` is the user's `select.svg`, supplied
on 2026-09-26 and copied without geometry changes. CSS supplies the accent color.
Its SHA-256 is recorded in `docs/assets-provenance.json`; an exact per-asset
source page/license was not supplied, so no additional license is asserted.

MusicBrainz and Cover Art Archive are queried for release artwork only after a
user action. They are external services, not bundled libraries. Their response
metadata and album artwork remain subject to the applicable rights. LRCLIB is
the existing synchronized-lyrics service. No affiliation or endorsement is implied.
