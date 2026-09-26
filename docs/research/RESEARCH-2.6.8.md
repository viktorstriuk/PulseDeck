# Engineering notes — 2.6.8

Reviewed 2026-09-23. The implementation is based on the supplied PulseDeck 2.6.7
source, not on downloaded application code. External references informed the
choices below; they do not certify this implementation.

## Retrieval rather than just fuzzy sorting

LRCLIB API supports `q` and `track_name`/`artist_name` searches:
https://lrclib.net/docs

Related open-source local lyrics tools illustrate the metadata problem:
https://github.com/tranxuanthang/lrcget/issues/27
https://github.com/tranxuanthang/lrcget/releases

The local query planner first removes known production-only labels. It retains
meaningful editions. It can infer `Artist - Title` despite uploader metadata;
this is a heuristic and may misread a title that legitimately contains that
pattern, so the visible search fields stay editable and tags are untouched.
Cyrillic transliteration is a matching heuristic, not a universal multilingual
artist-identity service. No public or private artist-alias rule is edited.

After clean exact/free queries, title-only and surviving-token queries, it
reserves room for original/canonical artist-only retrieval. This matters because
local edit distance cannot rank a correct candidate the remote service never
returned. Requests are sequential, deduplicated, at most eight, with a total
25-second deadline and 6-second per-request timeout. A service error/429 stops
expansion; earlier results may be shown as incomplete. No query is sent before
an explicit user action. There is no automatic whole-library lookup.

Local rank is 70% title similarity, 22% artist similarity and 8% duration, minus
an edition-mismatch penalty. Similarity combines bounded Damerau edit distance,
word-order normalization and token coverage. Identical IDs are deduplicated,
unrelated candidates filtered and at most 80 shown. This is not a calibrated
probability of lyric correctness. Duration is only a tie-breaking aid.

A live Node HTTPS probe from this build environment returned EAI_AGAIN for
lrclib.net (see test-results/lrclib-live.json). Therefore the new search network
workflow was tested using controlled API responses, not a successful live search.

## Acoustic draft is not vocal forced alignment

Primary background for spectral-flux/onset detection:
https://librosa.org/doc/0.11.0/generated/librosa.onset.onset_detect.html
https://librosa.org/doc/0.11.0/onset.html

These references describe locating musical note onsets, not proving which lyric
word was sung. PulseDeck uses its own small JS extractor; librosa, Whisper,
WhisperX and a speech/vocal model are NOT included or invoked.

Installed FFmpeg decodes mono f32le at 16 kHz without a PCM disk file. A Worker
uses 512-sample Hann frames and 320-sample (20 ms) hops to measure RMS, positive
spectral change, broad 180–3500 Hz energy and tonal concentration. Silent gaps
are grouped; tiny holes are not taken as separate phrases. An autocorrelation
estimate may propose a tempo, but it is not a verified musical transcription.

Untimed line starts are allocated by activity and approximate syllable weight,
then snapped to nearby onsets. Existing anchors and explicit instrumental cues
constrain placement. Cue offset is converted to/from the actual media clock.
No end-of-vocal timestamps or verified word timestamps are synthesized. The
result remains a preview until applied and a draft until saved. It is marked as
unverified and is one undo step. This feature can save initial placement work,
but may need substantial manual correction, especially in dense arrangements.

Bounded PCM batches are ACKed before decoding resumes. Work is cancellable,
limited to 30 minutes/180 seconds. Private analysis is memory-only, uses the
existing range server, and is discarded on lock. File hash and session identity
are rechecked before accepting results. Ordinary recordings have a four-item
memory feature cache. There is no background microphone or internet upload.

## Interaction references and product decisions

Primary accessibility references consulted:
https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/
https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/examples/toolbar/
https://www.w3.org/WAI/ARIA/apg/patterns/button/

The studio groups frequently used icon actions, preserves names/tooltips and
visible focus, and keeps transport/footer outside the scrolling rows. The group
uses `role=group`, not an unimplemented ARIA toolbar contract; Tab still reaches
controls normally. No claim of full WAI/WCAG conformance is made.

Presentation changes are reversible through direct controls/reset but auto-saved;
content/time edits are drafts with undo/redo and explicit Save. Playback preview
is fed from the draft and the existing audio clock, not a second media element.
Only active-row/segment transitions rebuild highlight content; work stops with
closed/hidden screens. Motion-reduction preferences are honored by CSS.

The timing-order error in the user's screenshot is preserved as validation,
with tools to shift a whole selection or explicitly sort by time, instead of
silently discarding or reordering their work. Text movement uses existing timing
slots so simple row moves do not automatically scramble chronology.
