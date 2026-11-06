# Apple AAC reply fixtures

These are synthetic 440 Hz tones, not recordings of people. They were generated
at 24 kHz, mono, signed 16-bit PCM and encoded by macOS `afconvert` with
`-f m4af -d aac -b 32000`. Durations are 1, 12, 30 and 31 seconds. Apple uses
the same AAC encoder family for AVAudioRecorder. The 30-second fixture includes
encoder priming/padding and stays within 30,500 ms; 31 seconds is rejected.

Tests mutate copies in memory for invalid track types, AAC declarations,
references, lengths, durations and chunk bounds. No fixture contains speech,
transcripts or private metadata.

Container fields follow Apple's [QuickTime file format reference](https://developer.apple.com/documentation/quicktime-file-format/sample_description_atom)
and the [MP4 registration authority](https://mp4ra.org/registered-types/brands).
