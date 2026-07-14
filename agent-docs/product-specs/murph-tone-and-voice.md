# How Murph Talks

Last verified: 2026-07-14
Status: Implemented for onboarding, settings, hosted mailbox handoff, prompt tone, voice memo default resolution, supervisor-run preview generation, and private Humor, Push, and Detail controls in conversation and Settings

## Product Contract

Murph's speaking style has five controls:

1. Tone: `casual` or `formal`.
2. Voice: one option from the shared voice roster.
3. Humor: an integer from 0 through 10.
4. Push: an integer from 0 through 10.
5. Detail: an integer from 0 through 10.

Tone and voice appear during the hosted first visit and under **How Murph talks** in Settings. Humor, Push, and Detail are available through explicit conversational requests and under **Personality** in Settings. Settings shows all three effective 0–10 values in one dialog on desktop and one drawer on mobile; it does not add onboarding steps.

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

The `show` action resolves missing values to these defaults and labels them `source: "default"`. A successful explicit set remains `source: "custom"` even when the chosen score equals the product default. Reset removes the override and restores the effective default. Resetting the last override removes the empty personality object.

No prompt text, inferred psychological profile, or conversation excerpt is stored. Prompt behavior stays code-owned.

## Conversational Surface

The assistant uses the headless `murph.assistant_style` operation. Turn
planning registers it only for the exact current private direct conversation;
other audiences receive no style operation or style prompt surface. Its closed
actions are `show`, `set` with one exact integer score, and `reset` for one dial
or all dials. Raw CLI style commands are intentionally absent so no registered
general command advertises an audience-independent path around the turn-level
gate. This is a tool-registration and prompt-surface policy, not a filesystem
sandbox around the privileged Codex runtime.

Each action returns the effective post-action snapshot:

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

The assistant must read canonical state for a setting query, report the scores
and sources, and not treat the query's `updated: false` as a mutation outcome.
It must not infer a score from its current prose. After a successful set or
reset, it treats the returned `settings` snapshot as authoritative for the rest
of that reply:

- Confirm the exact effective score and whether it is custom or default.
- If `updated` is false, say the setting was already in that state.
- If the operation errors or returns no `settings` snapshot, say the result is unconfirmed. Do not claim that it changed or stayed unchanged. One `show` may report current canonical state without claiming whether the original action caused it.
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

Personality dials apply only to the member's private interactive conversation. Group behavior remains owned by the current group context and the group-chat and group-comedy rules. Turn planning may read the shared preferences document for existing tone and voice behavior, but a group prompt never receives, advertises, exposes, or applies a member's private dials, and Murph does not mutate them from a group. Assistant turns receive a headless style operation only when the exact current route is private and direct; group and indeterminate routes omit both that operation and all prompt or assistant CLI contract references to the style surface.

The raw style CLI hard cut is effective only after every old assistant runner
bundle has drained or restarted. A gradual rollout that leaves warm older
bundles serving turns leaves the retired shell command reachable, so deploy the
runner/CLI change as an immediate convergence and verify the live fleet reports
the new bundle before treating the audience boundary as active. The first
personality-aware reader/writer release remains the rollback floor.

A future group-level style control needs separate group-scoped authority and storage. It must not reuse a member's private preference as room-wide truth.

## Hosted Settings Projection

The web surfaces use the same tone ids and shared voice roster defined above.

`hosted_member.assistant_tone`, `hosted_member.assistant_voice`, and the nullable
`assistant_humor`, `assistant_push`, and `assistant_detail` columns capture the
latest web-side choices for display and mailbox handoff. The three numeric
columns have database range constraints from 0 through 10. They are a
Settings-side display/write projection, not canonical preference truth;
`bank/preferences.json` remains canonical.

`POST /api/settings/assistant-style` validates the authenticated member's
values, updates requested columns, appends one `member.preferences.updated`
event, and best-effort signals the runtime. While the web rollout gate is off,
tone/voice events retain the legacy complete tone/voice snapshot required by
the old coalescing consumer. Once the gate is enabled, events contain only the
request delta. Personality payloads are strict,
non-empty sparse objects. They reject unknown keys, fractions, out-of-range
scores, and mixed tone-or-voice plus personality requests before persistence.
The response returns the full web projection so the Settings row can update
without inventing a second readback service.

Conversation-written personality values do not reverse-sync into the web
projection. Settings therefore resolves missing columns to the shared defaults
for display but submits only dials deliberately touched in that dialog, even
when a touched dial returns to its displayed value. Projection equality must
not suppress that explicit canonical intent. The dialog must never submit all
three displayed defaults automatically. Personality events always carry only
fields touched by the request. Tone/voice events gain that same sparse contract
when the web gate is enabled, so a steady-state web save cannot overwrite an
unseen canonical sibling preference.

After the web gate is enabled, `member.preferences.updated` is a delta contract,
not a replaceable snapshot. The hosted system mailbox applies every preference
item in mailbox order. An older retry blocks newer preference deltas until it
succeeds; preference items must not be latest-wins coalesced or superseded. The
gate-off complete snapshot is deployment compatibility for the old consumer,
not a second steady-state contract.

The scheduled handoff backstop selects retained unconsumed preference rows for
active person members before applying its bounded batch limit, then rechecks
the canonical async access gate before signaling. It drains oldest candidates
first so inactive or newer rows cannot permanently hide older valid work.

Every newly appended mailbox row receives one immutable per-member causal
sequence serialized across conversation and system lanes. The sequence is
assigned by the mailbox owner at durable acceptance, carried through the local
system pending item or conversation input record, and passed into the canonical
preference mutation. `bank/preferences.json` retains only each sparse field's
value. The canonical companion document
`bank/assistant-preference-mutations.json` retains each sparse field's
last-applied sequence. An older or equal Settings event terminally ignores only
stale fields, still applies a newer sibling, and advances `updatedAt` whenever
a sibling value really changes. Conversational commands from one accepted turn
may apply at the same sequence in command order. Replaying a Settings event
after the canonical commit is therefore an idempotent no-op without an event
receipt, reservation lifecycle, cap, or mailbox-removal acknowledgment.
Ordering never uses the web projection or wall-clock comparison.

System-lane completion is acknowledged only with a successful workspace
checkpoint. The runtime derives the contiguous handled prefix from the imported
system watermark and the earliest real pending system item; local synthetic
retention wakes do not block it. The web checkpoint transaction advances the
durable system `consumed_seq` together with the snapshot CAS, so a conflict or
rollback leaves pending work replayable.

The canonical assistant-input selector admits a bounded, cursor-ordered compound
batch. Foreground starts with the oldest fresh input in the current wake and may
add only later fresh siblings; it never pulls older pending backlog ahead of that
batch. Background starts with the oldest replyable pending input. A batch
continues only while every input has the same canonical conversation and
provider-native reply anchor and each positive per-member mailbox causal
sequence is the exact successor of the previous one. A conversation or
reply-anchor change, sequence gap, 50-input bound, or legacy sequence-zero input
ends the batch, and the remainder stays pending.

The runtime exposes the batch's terminal sequence as its compound turn frontier
through the existing authenticated loopback CLI bridge. Exact-successor proof
means that frontier cannot cross an intervening system-lane Settings mutation.
The selected batch is frozen before the provider starts; mailbox input accepted
later remains pending for another turn. The binding is installed by every
compatible runtime rather than being feature-gated, so the personality commands
advertised by that runtime are executable throughout rollout. The model can
request a style command but cannot provide or replace the numeric sequence. The
invocation-local bridge value is transport only; it is cleared when the turn
ends and never becomes an ordering authority.

Tokenless pending items restored from the legacy v1 local mailbox state are
treated as sequence zero. They drain through the same terminal path. A legacy
field applies only if no legacy conversational or sequenced mutation has
already established that field's watermark, which is the bounded compatibility
policy for history whose original cross-lane order cannot be reconstructed.

Tone is read from the canonical vault during turn planning. An absent saved tone resolves to the shared `formal` default, and prompt assembly adds one persistent user-facing writing contract (casual lowercases all Murph-authored prose except casing-sensitive literals; formal keeps standard capitalization and no slang, staying warm and direct). Voice memo defaults resolve in this order:

1. Explicit tool argument `voiceId`.
2. Vault assistant voice preference mapped through the shared roster to an ElevenLabs voice id.
3. No stored preference resolves to the shared default (`upbeat`).
4. `MURPH_ELEVENLABS_VOICE_ID`.

Explicit `classic` and unknown stale vault voice ids fall through to the environment default.

## Deploy And Rollback

The personality field is additive but existing preferences readers are strict.
Deploy readers that accept and preserve it before any command can write it.
The causal watermarks live in their own bounded canonical companion document,
so adding them does not alter the strict `bank/preferences.json` shape.

The rollback floor is therefore the first deployed runtime and CLI version that understands the optional personality field. Rollback below that floor requires removing the new field with a current compatible binary or forward-deploying a compatible reader. Do not hand-edit canonical preferences files.

The sparse-delta and shared-causal-sequence transition uses one gated expand,
switch, then contract rollout:

1. Vercel predeploy applies only the nullable `causal_seq` column and unique
   index. Deploy the new sequence-producing web build with
   `MURPH_ASSISTANT_PERSONALITY_CAUSAL_WRITES_ENABLED=0`; the Settings
   personality controls remain unavailable while old functions drain. The old
   Cloudflare parser ignores the new optional mailbox field and its consumer
   continues receiving complete snapshots during the mixed-version window even
   though each new row already carries a causal sequence.
2. The normal post-deploy contract-migration lane waits for the old Vercel
   function window, then fails closed only if a legacy preference row remains
   above the authoritative system-lane `consumed_seq`. It installs the
   new-write check `NOT VALID`, so handled retained history does not block the
   rollout and new null-sequence preference writes are rejected.
3. Deploy the new Cloudflare worker and runner with
   `container_rollout=immediate`; prove the managed fleet has converged. The
   compatible runtime always installs the invocation-local causal binding, so
   its advertised conversational personality commands do not depend on a
   second Cloudflare gate.
4. Enable the Vercel gate. Settings switches tone/voice to sparse deltas and
   exposes personality controls only after the FIFO consumer fleet is present.
   Tone, voice, ordinary conversation, and current-inbound replies stay
   available throughout.

The new consumer accepts already-imported tokenless v1 local pending items
through the explicit sequence-zero path. The pre-switch drain ensures that
compatibility path is not asked to reconstruct unavailable cross-lane order.

After the new Cloudflare runtime can accept conversational personality writes
or the Vercel gate is enabled, both the new Cloudflare runtime and
causal-sequence-producing Vercel build are rollback floors. Do not disable the
web gate or roll either plane back independently; forward-deploy the compatible
pair. Post-deploy, save one dial, run a
conversational change to the same dial, confirm the later accepted intent wins
canonically, and confirm no preference item remains rejected or stuck.

## Preview Clips

Run:

```bash
node scripts/generate-murph-voice-previews.mjs
```

The script loads local env files without printing secret values, requires `ELEVENLABS_API_KEY`, defaults to `eleven_v3` unless `MURPH_ELEVENLABS_MODEL_ID` overrides it, uses `MURPH_ELEVENLABS_VOICE_ID` for the `classic` ("New York") clip, and writes MP3 files to `apps/web/public/audio/murph-voices/`. Build `packages/contracts` first so the script reads the shared roster from the package export.

Preview clips are generated by the supervisor after review. The shared preview line must not mention a human voice name; every option is Murph with a different vibe.
