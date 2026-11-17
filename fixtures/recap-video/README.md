# Recap video fixture

`synthetic.mp4` is two seconds of one flat colour and a 440 Hz tone, in the
recap video's container shape: H.264 High at 804x1748 and 30 fps, AAC, with the
`moov` box ahead of the media. It is not a recording or a rendered recap.
Generate with FFmpeg:

```sh
ffmpeg -f lavfi -i "color=c=0x334455:size=804x1748:rate=30:duration=2" \
  -f lavfi -i "sine=frequency=440:duration=2" \
  -c:v libx264 -profile:v high -preset medium -crf 30 -pix_fmt yuv420p \
  -c:a aac -b:a 32k -ar 48000 -ac 2 -movflags +faststart -map_metadata -1 \
  -fflags +bitexact -flags:v +bitexact -flags:a +bitexact synthetic.mp4
```

Tests read the checked-in file; FFmpeg is not required.
