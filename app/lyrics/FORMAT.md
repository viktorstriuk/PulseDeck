# PulseDeck lyrics — format v1

One UTF-8 JSON object. Paste it directly into the lyrics editor. The AI package
contains `README.md`, `INSTRUCTIONS.md` and `example.lyrics.json`, all in English.
The actual lyrics retain their original language.

```json
{"format":"pulsedeck-lyrics","version":1,"lines":[{"text":"An original example without synchronization."}]}
```

## Document fields

| Field | Meaning |
|---|---|
| `format` / `version` | `"pulsedeck-lyrics"` / `1` |
| `recordingId` | SHA-256 of the exact audio file, 64 hexadecimal characters |
| `durationMs` | Duration of this recording, in milliseconds |
| `offsetMs` | Integer milliseconds; positive shows lyrics later, negative earlier |
| `theme` | Presentation settings, described below |
| `gapThresholdMs` | Known-pause threshold for automatic notes, default `2500` |
| `source` | Optional `name`, HTTPS `url`, `title`, `artist`, `album` |
| `notes` | Optional uncertainty/provenance strings (up to 12, 1200 chars each) |
| `lines` | Ordered array of lyric lines and instrumental cues |

Saving attaches the current recording ID. A matching title does not prove a
matching recording version. A different hash requires explicit import approval.
Renaming a file does not change its hash; transcoding or rewriting embedded tags does.

## Lines and words

`startMs` is the start. `endMs` is an optional **measured vocal end**, not the
start of the last word. Unknown values can be absent or `null`. Starts range from
0 to 24 hours. Simultaneous starts are allowed. A measured end requires a start.
With no end, the display lasts until the next later timed line or the end of the
recording. That inferred display end is not stored as a measured vocal end and
does not create automatic instrumental notes.

Use `text` OR `segments` on each line, never two divergent copies of its text.
These example words are invented, not taken from a published song:

```json
{
  "startMs":1000,
  "endMs":null,
  "segments":[
    {"startMs":1000,"text":"Lanterns "},
    {"startMs":2500,"text":"over quiet water "},
    {"startMs":4800,"text":"glow."}
  ]
}
```

The phrase “over quiet water” lights together. Preserve spaces and punctuation in
segment text. A missing mark inherits the preceding mark; the first segment uses
the line start. With no line start, it is derived from the first known segment.
Fully untimed lines remain readable text. Do not distribute words uniformly in
time or invent timestamps to complete a schema.

In the timing editor, click any word to edit its own mark. Unmarked following
words remain grouped with it until the next explicit mark. Clearing a word mark
rejoins it to the preceding phrase. `Now → next` stamps the real audio position
and selects the next word. The editor preserves imported precision and text.

Minute/second fields are duration spinbuttons, not a clock of day. Up/down edits
the focused part; left/right or `:` changes parts; Page Up/Down makes larger
steps. Milliseconds are optional and can be revealed using `ms`. Hiding that
part does not round stored values. Blank is distinct from `00:00`.

## Instrumental intervals

```json
{"kind":"interlude","startMs":19000,"endMs":24000,"text":""}
```

`kind` is `lyric` or `interlude`. A standalone ♪ / ♫ / ♬ / 🎵 / 🎶 is also
normalized to the application's own icon. Notes inside ordinary sentences remain
text. Explicit and automatic intervals do not duplicate each other.
`suppressGapAfter: true` forbids an automatic interval after that line; it does
not delete a manually entered instrumental cue.

Automatic notes require a known vocal end and a gap of at least 2500 ms by default.
A long held word with no measured end must not become a false instrumental break.
Untimed text within a gap prevents that inference. A lead-in may be shown before
the first known lyric if no untimed text precedes it; an outro needs a measured
last phrase end and known audio duration.

## Presentation

```json
{
  "mode":"gradient",
  "background":"#332132",
  "gradientColors":["#332132","#162836"],
  "gradientAngle":135,
  "text":null,
  "activeText":null,
  "autoContrast":true,
  "fontScale":100
}
```

Modes: `solid`, `gradient` (default), `cover`. Cover mode requires a genuine,
successfully decoded cover; the application-icon fallback is not a cover.
Gradients use 2–4 `#RRGGBB` colors, direction 0–360 degrees, sRGB interpolation.
Text scale is 65–150%. Solid mode uses `background`.

Automatic contrast chooses light/dark text and a protective scrim when needed.
It always applies to cover mode. In solid/gradient manual mode `text` and
`activeText` are editable. Ineffective settings are hidden with explanations;
their previously saved values are retained.

Presentation, offset and pause threshold can be saved before lyrics exist. They
are stored independently from `doc` and applied when plain text is first added.
In 2.6.8, importing lyrics NEVER changes the current presentation, even when the
imported JSON contains a `theme`. Exports still include it for interoperability.
Explicit timing preferences (offset/gap threshold) may be imported; appearance is
changed only through the appearance controls or an automatic cover refresh.
Protected recording preferences use authenticated encrypted storage.

`paletteSource` is `cover` (automatic) or `manual`. The first uses the current
cover colors; editing colors marks the palette manual. Font size, contrast,
mode and angle changes do not freeze automatic cover-derived colors. Older
saved themes without this field are conservatively treated as manual to avoid
silently overwriting a user's colors. “From cover / reset” re-enables automatic
palette derivation. Changing text never does.

Appearance controls take effect immediately and are persisted separately after
a 220 ms debounce. Closing the dialog flushes pending changes, not reverts them.
The status distinguishes saved, saving and failed; failures provide a retry.
A deleted lyric has a `suppressed` tombstone so neighboring/in-file lyrics are
not silently rediscovered. Audio and original sidecar/tag contents are unchanged.

## Import/export

LRC: `[00:13.000]Example`. `[offset:200]` has the usual opposite sign, equivalent
to `offsetMs: -200`. Repeated line timestamps are supported. Enhanced LRC:
`[00:13.000]Lanterns <00:15.000>over quiet water`. LRC export is line-level and
lossy: use JSON to preserve word marks, ends, styling and gap suppression.

Compact input: `(00:13.000):"Lanterns 😀00:15.000😀over quiet water"`.
`{00:13.000}:"Example"` sets `suppressGapAfter`. A marker refers to the following
fragment. An extra colon is interpreted as a fractional second with a warning:
`00:16:30 = 00:16.300 = 16300 ms`. For 30 milliseconds use `.030`; for 300 use
`.300`. New JSON contains numeric milliseconds, not ambiguous clock strings.

TXT is freely scrollable. Partial synchronization never discards untimed lines.
HTML is accepted only as inert data from a compatible `lyric-data` JSON array
(`t`, `end`, `text`, `kind`) and `initial-prefs`; scripts, CSS, audio and external
resources are never executed/imported from it.

Limits: about 2 MiB of lyric characters, 5000 lines, 50000 segments, 20000 characters
per text field. HTML containers have a 64 MiB limit. Invalid imports do not replace
saved lyrics. Notes are displayed as text, not executed markup.

## Timing studio (2.6.8)

The inline player shares the existing audio element. Draft cues are previewed
without overwriting the saved document. Row/word selections support Ctrl and
Shift. Bulk shifts move actual cue times (including measured ends and segments),
not the display offset; untimed content stays untimed. Invalid boundary shifts
are atomic and leave all original times intact. Chronological errors remain
visible and must be corrected or explicitly sorted before saving.

Text reordering moves selected rows/words between existing timing slots. Row
internal word offsets travel with their text. Split creates a new row at the
selected word. Group actions are undoable; history is session-only, capped at
80 snapshots with an approximate 8 MiB budget (at least one snapshot retained).
Playback speeds and selection loops are temporary editor helpers.

“Rhythm draft” locally decodes PCM with the installed FFmpeg and analyzes
onsets, energy and broad mid-band activity in a Worker. It is NOT speech
recognition, lyric transcription or reliable vocal/instrument separation.
Estimated line starts are based on activity and text length, with nearby onset
snapping. Known instrumental intervals and retained timestamps constrain the
proposal. Unknown vocal ends remain null. The draft carries a provenance warning,
is never saved automatically, and applying the whole proposal is one undo step.
Limits: 30 minutes of audio, 180-second timeout, bounded PCM backpressure; no
plaintext PCM file and no audio upload. Private-track analysis is not cached on
disk and is revoked on lock. Public analysis cache holds at most four recordings.
