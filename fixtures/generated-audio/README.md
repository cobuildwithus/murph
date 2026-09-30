# Generated MP3 fixtures

These are synthetic 440 Hz tones, not recordings or provider responses.
Each tone lasts 0.25 seconds. Generate with FFmpeg:

```sh
ffmpeg -f lavfi -i sine=frequency=440:duration=0.25 -ar 44100 -ac 1 -c:a libmp3lame -b:a 128k -write_xing 1 -map_metadata -1 speech.mp3
ffmpeg -f lavfi -i sine=frequency=440:duration=0.25 -ar 44100 -ac 1 -c:a libmp3lame -b:a 128k -write_xing 0 -map_metadata -1 stream.mp3
ffmpeg -f lavfi -i sine=frequency=440:duration=0.25 -ar 48000 -ac 2 -c:a libmp3lame -b:a 192k -write_xing 1 -map_metadata -1 music.mp3
```

The fixtures cover the speech/music output formats and streaming MP3 without
Xing duration metadata. Tests read the checked-in files; FFmpeg is not required.
