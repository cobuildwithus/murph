---
name: music-generation
description: |
  How Murph writes the prompt for the generate_song tool so ElevenLabs
  Eleven Music returns the track you intended. Read before every
  generate_song call: reminder songs, group-challenge hype tracks,
  jingles, celebration anthems, and any generated song or instrumental.
  Owns music prompt craft (genre, instrumentation, tempo, key, vocals,
  lyrics, structure, instrumental-only, and duration) plus the
  copyright-safe style rules and the reggae house-style default.
  behavior-followthrough and groupchat-comedy decide WHEN to send a
  song; this skill decides WHAT prompt to send.
---

# Music generation

This skill governs the `prompt` you hand to the `generate_song` tool. The tool
takes only three inputs, and the `prompt` string carries every musical
decision. Writing that prompt well is the whole job.

## The tool

`generate_song` (murph namespace) generates one original track with ElevenLabs
Eleven Music and attaches it to your final response as a native voice memo.

- `prompt` (string, 1-4100 chars, required): all musical direction — style,
  mood, instrumentation, tempo, key, vocals, and the exact lyrics.
- `durationSeconds` (integer, 3-300, default 30): track length. Reminder songs
  sit at 15-30s.
- `instrumental` (boolean, default false): `true` produces no vocals.

Constraints to plan around:

- It does not send on its own — it attaches the song to the reply you compose.
- It cannot share a turn with any other response media (an image, another voice
  memo). A song is the whole message.
- It is available only on a deliverable iMessage/Linq or Telegram reply. If the
  user asked for only the song, attach it and leave the reply text empty.
- Generation can take up to a few minutes.
- Generated audio cannot be re-sent later. If a song may be replayed (a repeat
  challenge dispatch), save the full lyrics and prompt in your durable notes so
  you can regenerate it.

## The prompt is the whole instrument

The model reads only the `prompt` string, plus the length and the instrumental
flag. There are no separate genre, tempo, or lyrics fields — layer all of it
into one natural sentence or two. Cover:

- **Genre / style** — be specific. "Warm 70s roots-reggae groove with offbeat
  guitar skank and a round bassline" beats "reggae." "Energetic 1980s synth-pop
  with a driving drum-machine beat" beats "upbeat song."
- **Mood / energy** — mood words land well: warm, playful, triumphant, mellow,
  gentle, hype, wistful.
- **Instrumentation** — name the instruments. Prefix a single instrument with
  **solo** ("solo acoustic guitar").
- **Tempo and key** — the model follows both. Give a BPM ("90 BPM"), and a key
  when it matters ("in A major").
- **Vocals** — describe the voice ("warm, casual male lead vocal"; "two singers
  harmonizing in C"). Prefix an unaccompanied vocal with **a cappella**.
- **Structure** — for anything longer than a hook, sketch the sections (intro,
  verse, chorus, outro) and timing cues ("lyrics begin around 4 seconds,"
  "instrumental for the first bar"). Keep structure proportional to length; do
  not ask for four verses in 20 seconds.

## Lyrics

Songs include vocals unless you say otherwise. When the words have to land — a
reminder, a callback, a chant — write the lyrics yourself and quote them inside
the prompt rather than describing a topic and hoping. The action has to be
unmistakable. For example, the `prompt` value:

> Upbeat roots-reggae, ~20s, warm male lead vocal. Lyrics: "Lace 'em up, Sam,
> two easy miles / your knees move better the more that you move."

Keep lyrics short: a 20-second track holds a couplet or two, not a full
verse-chorus. For reminder songs specifically, name the action to do now, say
why it matters to this person, fold in at most two non-sensitive personal
details, and keep it encouraging, never shaming.

## Instrumental tracks

Set `instrumental: true` (or add "instrumental only" to the prompt) for a
focus, background, or celebration bed with no words. Everything else — genre,
instruments, tempo, key, mood — still belongs in the prompt.

## Duration

`durationSeconds` is 3-300. Reminder songs are 15-30s. Shorter tracks are
tighter and land faster; match the lyric and structure to the length you ask
for.

## House style and preferences

When the user has no known music preference and nothing else clearly fits
better, default to a light, upbeat reggae groove — Murph's house style. An
explicit or learned preference (a genre they love, a vibe they asked for)
always overrides the default.

## Copyright and safety (hard limits)

- Never name a real artist, band, or song, and never paste copyrighted lyrics.
  These trip Eleven Music's `bad_prompt` guard and fail the generation.
  Describe the *style* generically instead ("90s boom-bap hip-hop beat," not "a
  Beatles-style track").
- Never put sensitive or potentially embarrassing personal information in the
  lyrics — assume the audio could be overheard on a speaker. Do not invent
  personal details.

## Write tight, pick one lane

A longer prompt is not a better prompt. A focused, evocative direction
("rainy-day jazz cafe, mellow, brushed drums, ~20s") beats a paragraph of
competing instructions. If two moods fight, choose one.

## When it fails or would delay

If generation fails, or a time-sensitive reminder cannot wait for it, send the
plain-text version immediately — a song is a delight, never a blocker. Pair a
reminder song with a one-line text version of the same reminder. And a richer
modality never fixes a plan the user keeps ignoring: if reminders are not
landing, revisit the action's size, timing, or relevance rather than dressing
up the same cue.

## Worked examples

Each of these is a complete `prompt` value.

Reminder song, `durationSeconds: 20`, vocal:

> Upbeat, warm roots-reggae groove around 75 BPM, offbeat guitar skank, round
> bassline, light percussion, easygoing male lead vocal. Lyrics: "Morning,
> Priya, sun's up too / ten quiet minutes, just you and the mat / stretch it
> out and the back feels new."

Focus bed, `durationSeconds: 45`, `instrumental: true`:

> Calm lo-fi study beat, soft Rhodes chords, mellow boom-bap drums around 80
> BPM, warm vinyl texture, no vocals. Steady and unintrusive for focused work.

Group-challenge hype track, `durationSeconds: 25`, vocal:

> Triumphant brass-forward funk, ~110 BPM, punchy horns, slap bass, tight drums,
> big gang-vocal chant. Celebratory and a little cocky. Lyrics: "Step-count
> champions, take a bow / the leaderboard belongs to you now."
