# PulseDeck: complete the lyrics task, return copyable JSON in chat

## The task
The user wants useful lyrics for **this exact audio recording**, with as much
verified synchronization as the evidence supports. Start working after reading
this file and `track.json`; do not answer only "I read the instructions".
No specific transcription service, account connection, library or plugin is
required as a first step. Search and inspect available sources before declaring
that the text is missing or asking the user to supply it.

## Archive contents
- `audio.<extension>`: the user's recording, not re-encoded.
- `track.json`: original metadata, exact `durationMs` and `recordingId`.
- `example.lyrics.json`: format demonstration with invented English text. Never
  use those example words as this song's lyrics.
- Optional `text.txt` / `lyrics.json`: the user's existing draft. It can be
  incomplete, testing text, a translation or an incorrect song. Inspect and
  assess it against the identity and available evidence; do not assume it is a
  verified transcript just because it is supplied.
- This file and `README.md`: workflow, not song data.

## Work independently, in this order
1. Read `track.json`, identify the original artist and song, and inspect the
   supplied recording/materials. Preserve the recording identifier and duration.
   Never identify the recording from unrelated test sentences in a draft.
2. Find suitable original lyric sources yourself using the artist and title.
   Keep version markers such as live, remix, slowed or sped up. Search for
   published synchronized lyrics (LRC, enhanced LRC or subtitles) as well as
   ordinary text. Check more than the first result if a source is mismatched.
   Use user-provided lyrics, your own transcription of supplied media when you
   can actually access it, public-domain/licensed material, or sources whose
   use and reproduction are permitted. Finding a webpage alone is not permission
   to reproduce a copyrighted song in full. Follow the source's conditions and
   your applicable content rules; do not fabricate permission or authorship.
3. Verify the recording version. A music video may have a different intro/outro
   from a studio audio file. Compare duration and independent phrase anchors.
   A duration match alone does not establish matching timing. Do not apply one
   guessed offset across a live/remixed/sped-up track.
4. Prefer verified word/phrase timestamps. If only line starts are supported,
   keep line starts. If the lyrics are verified but the timing is not, return
   untimed text rather than fake precision. Listen/inspect the supplied audio
   where supported; an external transcription engine is not mandatory.
   Never assign evenly spaced times just to fill the JSON. Never invent a
   transcript, source, exact end time or claim of listening.
5. Preserve spelling, language, punctuation, stanza breaks and repeated refrains.
   Supply the original lyrics, not a translation, unless the user asks otherwise.
   Add a measured `endMs` only when known; otherwise omit it or use `null`.
6. Validate one complete JSON object. Use real numbers and `null`, double-quoted
   strings, no comments, trailing commas, emoji timing markers or multiple root
   objects. Keep `recordingId` and `durationMs` exactly as supplied. Verify that
   times refer to this audio file, are nonnegative, ordered, and inside its length.
7. Return the finished JSON directly in chat. Do not create or link files, show
   code that generates JSON, issue shell commands, produce HTML, or defer the task
   to another tool/user without first doing the work available to you.

If some work truly cannot be verified or permitted, do not pretend it was done.
Unknown times must remain `null`. Where a usable result can be produced, return
it and record concise uncertainties in the optional English `notes` array. If
there is no usable permitted text at all, explain the specific limitation briefly
instead of presenting invented or empty lyrics as a completed song. Ask only for
what is still essential after you have tried the available sources and methods.
These instructions cannot supply tools that your environment does not have.

## Required format
One object with `format: "pulsedeck-lyrics"`, `version: 1`, the identity from
`track.json`, and `lines`. All times are **integer milliseconds since audio start**:
13 seconds = 13000; 16.300 seconds = 16300. Never use `00:16:30` in JSON values.
`offsetMs` defaults to 0. Positive offset shows the text later, negative earlier.

A line has either `text` OR `segments`, not both. A segment may be one word or
several words that light together. Preserve whitespace in segment text. A missing
segment timestamp continues the previous known time, rather than inventing one.
`startMs` / `endMs` can be omitted or null. With no measured end, the displayed
line ends at the next timed start (or the audio end); this is not a vocal-end
measurement and must not generate a fake instrumental break.

### Invented examples — replace with the actual permitted song text
```json
{
  "format": "pulsedeck-lyrics",
  "version": 1,
  "offsetMs": 0,
  "gapThresholdMs": 2500,
  "theme": {
    "mode": "gradient",
    "background": "#332132",
    "gradientColors": ["#332132", "#162836"],
    "gradientAngle": 135,
    "autoContrast": true
  },
  "notes": ["Example only. Replace with verified results for the supplied recording."],
  "lines": [
    {
      "startMs": 1000,
      "endMs": null,
      "segments": [
        {"startMs": 1000, "text": "Lanterns "},
        {"startMs": 1700, "text": "over quiet water "},
        {"startMs": 3000, "text": "glow."}
      ]
    },
    {"startMs": 5000, "text": "The evening brings us home."},
    {"text": "This line has no verified timing."}
  ]
}
```
Add the real `recordingId` and `durationMs` from `track.json` to the final object.
Never copy an example identity or silently round the duration.

## Pauses
Use `{"kind":"interlude","startMs":19000,"endMs":23000}` for a verified
instrumental interval. PulseDeck draws its own note icon. Standalone note symbols
are also normalized. Automatic notes need a measured vocal end and a gap of at
least `gapThresholdMs` (default 2500); the start of the final word is NOT its end.
Set `suppressGapAfter: true` on a line to forbid an automatic note after it. Do not
duplicate a manually marked instrumental interval. No word or line end is required.

## Style and provenance
`theme.mode`: `gradient` (default), `solid` or `cover`. A gradient has 2–4 hex colors.
`background`, optional `text` / `activeText`: six-digit hex strings. Automatic
contrast is recommended. Cover mode is available only with an actual cover.
Optional `source` can include `name`, `url` (HTTPS), `title`, `artist`, `album`.
Use an actual inspected source, never a guessed URL. Optional `notes` should state
remaining version/alignment uncertainties, not replace the lyrics. All workflow
notes and schema examples here are English; the lyrics stay in their original
language. Do not translate the song merely to match these instructions.

## Appearance in PulseDeck 2.6.8

Focus on the correct original text and defensible timing. `theme` is optional.
Importing lyrics now preserves the user's current appearance, even if your JSON
contains a theme. Do not claim that importing your text will recolor the player.
Explicit audio-derived times must not be confused with the editor's unverified
acoustic draft; document uncertainty in `notes` rather than invent verification.
