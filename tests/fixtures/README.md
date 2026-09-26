# Test fixtures

These small development fixtures came with the supplied PulseDeck source:
`silence.wav`, synthetic rhythm/clock/studio WAV files, and light/dark lyrics-cover
PNG patterns. They are used by reproducible playback, timing, analysis and contrast
tests, not packaged as the user's music library. The mock renderer's artist/title
strings are test data and do not identify a real audio recording in these files.

Keep fixtures required by tests. Do not add downloaded songs, personal cover art,
private playlists, real passwords, cookies or setup executables. Test output goes
in `test-results`, which is excluded from Git and clean source packages.
