# How Murph Talks

Last verified: 2026-07-10
Status: Implemented for onboarding, settings, hosted mailbox handoff, prompt tone, voice memo default resolution, supervisor-run preview generation, and private conversation-first Humor, Push, and Detail dials

## Product Contract

Murph's speaking style has five controls:

1. Tone: `casual` or `formal`.
2. Voice: one option from the shared voice roster.
3. Humor: an integer from 0 through 10.
4. Push: an integer from 0 through 10.
5. Detail: an integer from 0 through 10.

Tone and voice appear during the hosted first visit and under **How Murph talks** in Settings. The numeric personality dials are conversation-first in this release. The Settings page does not display them yet.

The first-visit sequence remains:

1. Text-line members: contact card picker, tone, voice, welcome.
2. Members without a text line: tone, voice, welcome.

Skip advances without writing a tone or voice preference. Continue writes the selected step. Personality dials do not add onboarding steps.

## Canonical Preferences

Shared contracts live in `packages/contracts/src/preferences.ts`. The canonical vault document is `bank/preferences.json`.

- Tone ids: `casual`, `formal`.
- `formal` is the shared default tone (`defaultAssistantTonePreference`). The picker preselects it and prompt assembly resolves an absent saved tone to it, so skipping the picker does not silently restore casual behavior.
- Voice ids are vibe-based stable preference ids: `classic`, `drill-sergeant`, `grandpa`, `country`, `jamaican`, `radio-host`, `deep-calm`, `warm`, `husky`, `storyteller`, `british-warm`, `late-night`, `easygoing`, `northern`, `football-announcer`, `sweet`, `mysterious`, `upbeat`, `narrator`, `expressive`, `bubbly`, and `smooth`.
- `upbeat` is the shared default voice id (`defaultAssistantVoiceOptionId`), sits first in the roster, and is displayed as "Classic Murph".
- `classic` is displayed as "New York", preserves the previous default sound, and has `elevenLabsVoiceId: null` so it resolves to `MURPH_ELEVENLABS_VOICE_ID`.
- Alternate voice ids map to curated ElevenLabs voice ids in the shared roster. Picker copy must describe the vibe, never a voice actor name.
- The picker preselects the shared default when the member has no saved voice preference.
- Each roster entry has `gender: "male" | "female"` for the All | Male | Female display filter. Gender is not persisted; the saved member preference remains only the voice option id.
- Preview assets are served from `/audio/murph-voices/<id>.mp3`.

Its optional assistant block is:

```json
{
  "assistant": {
    "tone": "casual",
    "voice": "deep-calm",
    "personality": {
      "humor": 9,
      "push": 7,
      "detail": 4
    }
  }
}
```

The personality object is strict and sparse. It stores only explicit user choices. Every stored value is an integer from 0 through 10. Unknown keys, fractions, and out-of-range scores fail validation instead of being ignored or clamped.

The effective defaults are:

| Dial | Default |
| --- | ---: |
| Humor | 3 |
| Push | 3 |
| Detail | 5 |

`hosted_member.assistant_tone` and `hosted_member.assistant_voice` capture the latest web-side choices for settings display and mailbox handoff. The session-authenticated route `POST /api/settings/assistant-style` and the member-bound signed assistant personalization callback use the same mutation owner. That owner validates the request, updates changed columns, appends a `member.preferences.updated` hosted mailbox event, and best-effort signals the runtime.

`assistant style show` resolves missing values to these defaults and labels them `source: "default"`. A successful explicit set remains `source: "custom"` even when the chosen score equals the product default. Reset removes the override and restores the effective default. Resetting the last override removes the empty personality object.

No prompt text, inferred psychological profile, or conversation excerpt is stored. Prompt behavior stays code-owned.

## Hosted Conversation Control

Hosted conversations expose one typed `murph.personalization` operation when
the runtime has its web-owned port:

- `action: "read"` returns the effective tone, voice, model, and Sol
  availability. Nullable hosted storage is presentation-only normalized to the
  canonical `formal` tone and `upbeat` ("Classic Murph") voice defaults; a read
  does not persist those defaults.
- `action: "update"` accepts at least one validated tone, voice, or Terra/Sol
  field and saves only the fields the member asked to change.
- Style and model changes in one request use one web transaction. The existing
  billing owner checks a requested model before the style owner can append its
  mailbox event, so an ineligible Sol request cannot partially change tone or
  voice. Any later style failure rolls the model write back.
- The result distinguishes `saved`, `unchanged`, and `rejected`, returns the
  effective values after the operation, and marks a changed model as applying
  on the next hosted invocation. The current run keeps the model with which it
  started and can take up to three idle minutes to close. A saved tone or voice
  converges through the existing mailbox owner for a later turn; it does not
  retroactively change the reply running the tool, so a same-turn voice demo is
  not activation proof.
- The invocation-scoped bridge completion budget exceeds the configured
  canonical web-control timeout. Once the owner request starts, the CLI waits
  for that request to settle instead of reporting a shorter local timeout while
  the preference write can still complete.
- Sol rejection exposes only the safe `sol_requires_edge` reason. Generic tool
  failure is not evidence about the member's plan or eligibility. A compound
  Sol plus style request is rejected atomically: no requested field changes,
  and the assistant must not silently split or retry it.

Voice labels shown to members map to tool ids from the shared
`assistantVoiceOptions` roster; voice guidance derives the complete mapping
from that roster, including "Classic Murph" -> `upbeat` and "New York" ->
`classic`, rather than maintaining a second label table. Model guidance maps
the Terra and Sol display labels to the canonical `gpt-5.6-terra` and
`gpt-5.6-sol` constants respectively.

This path deliberately does not write `bank/preferences.json` directly. Tone
and voice still flow from the hosted-member capture through
`member.preferences.updated` to `core.updateAssistantPreferences`, preserving
Settings/runtime convergence. The model remains a web-owned nullable intent
with no vault peer. When the typed operation is unavailable,
`/settings?voice=true` is the narrow voice/sound fallback, while `/settings` is
the fallback for tone or model changes.

## Personality Dial Conversation Control

The canonical commands are:

```bash
vault-cli assistant style show --format json
vault-cli assistant style set <humor|push|detail> <0-10> --format json
vault-cli assistant style reset <humor|push|detail|all> --format json
```

Each command returns the effective post-command snapshot:

```json
{
  "vault": "<vault-path>",
  "preferencesPath": "bank/preferences.json",
  "updated": true,
  "recordedAt": "2026-07-10T12:00:00.000Z",
  "settings": {
    "humor": { "value": 9, "source": "custom" },
    "push": { "value": 3, "source": "default" },
    "detail": { "value": 5, "source": "default" }
  }
}
```

The assistant interprets these natural-language aliases:

- `jokes` and `funny` mean Humor.
- `intensity`, `coach`, and `strictness` mean Push.
- `brief`, `wordy`, and `thorough` mean Detail when the user is clearly discussing a setting.

Examples of persistent requests include “put your humor at nine,” “set intensity to seven,” “turn jokes off,” “use detail three from now on,” and “reset your humor.” A request limited to the current reply, such as “be serious for this one” or “keep this short,” is not persisted. An ordinary complaint or inferred preference is not persisted unless the user clearly asks for an ongoing setting change.

The assistant must read canonical state for a setting query. It must not infer a score from its current prose. After a set or reset, it treats the returned `settings` snapshot as authoritative for the rest of that reply:

- Confirm the exact effective score and whether it is custom or default.
- If `updated` is false, say the setting was already in that state.
- If the command fails, say the setting was not confirmed or changed.
- When Humor changes above 0 and the context is safe, include one fresh, fitting funny line.
- When Humor changes to 0, confirm it plainly without a joke.
- Do not hard-code a recurring acknowledgement joke.

## Behavior Bands

The exact integer is preserved and shown to the user. Prompt behavior uses five reviewed bands because adjacent scores do not need separate policy text.

### Humor

| Score | Behavior |
| ---: | --- |
| 0 | No intentional jokes, bits, teasing, or funny asides. |
| 1–3 | Occasional light, dry humor when it fits. |
| 4–6 | Regular wit when useful; usefulness still leads. |
| 7–9 | Prominent, bold, dry humor; prefer one strong line over several jokes. |
| 10 | Maximum safe comedic ambition in ordinary contexts. Bold, surprising, slightly unhinged deadpan is welcome, but never forced or repetitive. |

### Push

| Score | Behavior |
| ---: | --- |
| 0 | No motivational pressure. Give calm options and let the user choose. |
| 1–3 | Supportive teammate energy and a small, reversible next step. |
| 4–6 | High-school-coach energy around a user-chosen goal and one clear next step. |
| 7–9 | Strict college-coach energy around a user-chosen goal. Name avoidance plainly without judging the person. |
| 10 | Terse, theatrical drill-sergeant energy for a user-chosen, low-risk goal. Never insult, shame, threaten, coerce, punish, or create false urgency. |

Push controls delivery, not authority. It never turns health into compliance or moral worth. It cannot make Murph demand unsafe exertion, override a stop rule, manufacture urgency, or continue pressure after the user says to stop.

### Detail

| Score | Behavior |
| ---: | --- |
| 0 | The shortest complete answer, often one sentence, with required safety context retained. |
| 1–3 | Concise answer with only the essential reason or next step. |
| 4–6 | Balanced explanation with the most useful supporting context. |
| 7–9 | Relevant context, tradeoffs, uncertainty, and a practical plan. |
| 10 | Comprehensive treatment when warranted: assumptions, options, edge cases, and evidence limits, without repetition. |

Detail controls presentation, not completeness of material warnings. A low score never removes a contraindication, stop rule, material uncertainty, required confirmation, or emergency guidance.

## Baseline And Sparse Prompting

The stored document remains sparse, and the thread-context personality block appears only when at least one explicit override exists. This preserves the current prompt and thread contract for members who never use the dials.

Classic Murph's static personality text explicitly embodies the defaults: occasional light, dry humor when it fits; supportive teammate energy with small reversible next steps; and balanced detail with useful context. If a default changes, the shared default constant, this static baseline, docs, and prompt regression must change together.

Each explicit override renders its exact score and reviewed band in thread context. Missing sibling dials are not rendered. Because thread context participates in the assistant contract fingerprint, a changed dial starts one fresh compatible Codex thread on the next turn while committed transcript history preserves conversation continuity. No custom session invalidation or prompt hot-reload mechanism is needed.

The returned command snapshot governs the acknowledgement in the same turn. The newly written preference naturally enters the prompt on the next turn.

## Precedence And Protected Contexts

Personality settings change expression only. The precedence order is:

1. Safety, truth, privacy, consent, authorization, and clinical boundaries.
2. Protected-context and channel rules.
3. The user's explicit current-turn instruction.
4. The saved personality dials.
5. Classic Murph defaults.

Humor is suppressed for plausible emergencies, direct self-harm language, serious medication or health decisions, grief, trauma, abuse, acute distress, and sensitive privacy, authentication, billing, consent, or irreversible-action confirmations. Jokes must not ambiguously claim that Murph sent, bought, booked, changed, deleted, disclosed, or authorized something.

The dials never change notification eligibility or frequency, quiet hours, tool access, spending or confirmation requirements, diagnostic confidence, model selection, data access, or real-world action authority. Personality preferences do not enter notification-decision or private maintenance prompts.

## Audience Scope

Personality dials apply only to the member's private interactive conversation. Group behavior remains owned by the current group context and the group-chat and group-comedy rules. Turn planning may read the shared preferences document for existing tone and voice behavior, but a group prompt never receives, exposes, or applies a member's private dials, and Murph does not mutate them from a group.

A future group-level style control needs separate group-scoped authority and storage. It must not reuse a member's private preference as room-wide truth.

## Hosted Tone And Voice

The web surfaces use the same tone ids and shared voice roster defined above.

`hosted_member.assistant_tone` and `hosted_member.assistant_voice` capture the latest web-side choices for display and mailbox handoff. `POST /api/settings/assistant-style` validates those values, updates changed columns, appends `member.preferences.updated`, and best-effort signals the runtime. This release does not add personality columns or claim that web Settings shows the numeric dials.

Tone is read from the canonical vault during turn planning. An absent saved tone resolves to the shared `formal` default, and prompt assembly adds one persistent user-facing writing contract (casual lowercases all Murph-authored prose except casing-sensitive literals; formal keeps standard capitalization and no slang, staying warm and direct). Voice memo defaults resolve in this order:

1. Explicit tool argument `voiceId`.
2. Vault assistant voice preference mapped through the shared roster to an ElevenLabs voice id.
3. No stored preference resolves to the shared default (`upbeat`).
4. `MURPH_ELEVENLABS_VOICE_ID`.

Explicit `classic` and unknown stale vault voice ids fall through to the environment default.

## Deploy And Rollback

The personality field is additive but existing preferences readers are strict. Deploy readers that accept and preserve `assistant.personality` before any command can write it. After the first personality override is stored, a binary that predates personality support may reject that preferences document.

The rollback floor is therefore the first deployed runtime and CLI version that understands the optional personality field. Rollback below that floor requires removing the new field with a current compatible binary or forward-deploying a compatible reader. Do not hand-edit canonical preferences files.

This release changes shared packages and the bundled assistant CLI/runtime, not web storage or a web-to-runtime event schema. A deployed runner must contain the compatible contracts, core mutation, CLI command, and assistant prompt together before personality writes are enabled. Hosted rollout should use the repository's normal immediate runner-bundle path when old warm containers could otherwise execute the previous strict reader.

## Preview Clips

Run:

```bash
node scripts/generate-murph-voice-previews.mjs
```

The script loads local env files without printing secret values, requires `ELEVENLABS_API_KEY`, defaults to `eleven_v3` unless `MURPH_ELEVENLABS_MODEL_ID` overrides it, uses `MURPH_ELEVENLABS_VOICE_ID` for the `classic` ("New York") clip, and writes MP3 files to `apps/web/public/audio/murph-voices/`. Build `packages/contracts` first so the script reads the shared roster from the package export.

Preview clips are generated by the supervisor after review. The shared preview line must not mention a human voice name; every option is Murph with a different vibe.
