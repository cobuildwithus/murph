# Murph Tone And Voice

Last verified: 2026-07-10
Status: Partial — onboarding, Settings, hosted mailbox handoff, prompt tone, voice memo default resolution, and preview generation are implemented; assistant-callable inspection and updates remain open

## Product Contract

Hosted members can choose how Murph talks during the first visit and later in Settings. The first-visit sequence is:

1. Text-line members: contact card picker, tone, voice, welcome.
2. Members without a text line: tone, voice, welcome.

The Settings account section exposes the same picker as "How Murph talks." Skip advances without writing preferences. Continue writes the currently selected step.

## Preferences

Shared contracts live in `packages/contracts/src/preferences.ts`.

- Tone ids: `casual`, `formal`.
- `formal` is the shared default tone (`defaultAssistantTonePreference`). The picker preselects it and prompt assembly resolves an absent saved tone to it, so skipping the picker does not silently restore casual behavior.
- Voice ids are vibe-based stable preference ids: `classic`, `drill-sergeant`, `grandpa`, `country`, `jamaican`, `radio-host`, `deep-calm`, `warm`, `husky`, `storyteller`, `british-warm`, `late-night`, `easygoing`, `northern`, `football-announcer`, `sweet`, `mysterious`, `upbeat`, `narrator`, `expressive`, `bubbly`, and `smooth`.
- `upbeat` is the shared default voice id (`defaultAssistantVoiceOptionId`), sits first in the roster, and is displayed as "Classic Murph".
- `classic` is displayed as "New York", preserves the previous default sound, and has `elevenLabsVoiceId: null` so it resolves to `MURPH_ELEVENLABS_VOICE_ID`.
- Alternate voice ids map to curated ElevenLabs voice ids in the shared roster. Picker copy must describe the vibe, never a voice actor name.
- The picker preselects the shared default when the member has no saved voice preference.
- Each roster entry has `gender: "male" | "female"` for the All | Male | Female display filter. Gender is not persisted; the saved member preference remains only the voice option id.
- Preview assets are served from `/audio/murph-voices/<id>.mp3`.

The canonical vault document is `bank/preferences.json`. Its optional assistant block is:

```json
{
  "assistant": {
    "tone": "casual",
    "voice": "deep-calm"
  }
}
```

Vault reads tolerate stale voice strings so old choices do not break turns. Web writes validate against the current roster.

## Web Capture And Handoff

`hosted_member.assistant_tone` and `hosted_member.assistant_voice` capture the latest web-side choices for settings display and mailbox handoff. The session-authenticated route `POST /api/settings/assistant-style` validates the request, updates changed columns, appends a `member.preferences.updated` hosted mailbox event, and best-effort signals the runtime.

Runtime handling mirrors the member activation shape without creating a vault. If the vault is missing, the system wake fails and retries until `member.activated` bootstrap has run. When the vault exists, hosted runtime applies the preferences through `core.updateAssistantPreferences`.

## Conversation Control Gap

Members cannot inspect or persistently change their saved tone or voice through
an assistant-accessible typed CLI command or headless product operation. Current
assistant guidance sends them to `/settings?voice=true`. This feature is
therefore not conversation-complete under
`docs/contracts/00-invariants.md`.

A direct vault-only setter would leave the Settings copy stale: assistant
behavior reads canonical `bank/preferences.json`, while Settings reads the
`hosted_member` capture. Follow-up must route web and conversation through one
owning mutation contract. Any additional stored copy must be downstream-only
derived state, never an independently writable peer. The operation must also
return the saved result to the assistant for confirmation. Until then, the
browser picker during onboarding or in Settings is the only supported
persistent change path.

## Assistant Behavior

Tone is read from the canonical vault during turn planning. An absent saved tone resolves to the shared `formal` default. Prompt assembly adds one persistent user-facing writing contract to the thread-context prompt:

- `casual`: all Murph-authored natural-language prose stays lowercase across progress notes, tool/action confirmations, blockers, questions, notifications, and final answers. Casing-sensitive literals such as URLs, code, identifiers, medical/technical acronyms, and exact quotations retain their original casing. Wording stays relaxed and conversational, with slang only when natural.
- `formal`: the same user-visible surfaces use complete sentences, standard capitalization and punctuation, and no lowercase sentence starts, casual shorthand, slang, or fragmentary acknowledgements. The register stays warm and direct rather than stiff.

Voice memo default resolution is:

1. Explicit tool argument `voiceId`.
2. Vault assistant voice preference mapped through the shared roster to an ElevenLabs voice id.
3. No stored preference resolves to the shared default (`upbeat`).
4. `MURPH_ELEVENLABS_VOICE_ID`.

Explicit `classic` and unknown stale vault voice ids fall through to the environment default.

## Preview Clips

Run:

```bash
node scripts/generate-murph-voice-previews.mjs
```

The script loads local env files without printing secret values, requires `ELEVENLABS_API_KEY`, defaults to `eleven_v3` unless `MURPH_ELEVENLABS_MODEL_ID` overrides it, uses `MURPH_ELEVENLABS_VOICE_ID` for the `classic` ("New York") clip, and writes MP3 files to `apps/web/public/audio/murph-voices/`. Build `packages/contracts` first so the script reads the shared roster from the package export.

Preview clips are generated by the supervisor after review. The shared preview line must not mention a human voice name; every option is Murph with a different vibe.
