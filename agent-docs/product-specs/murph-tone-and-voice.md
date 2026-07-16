# How Murph Talks

Last verified: 2026-07-16
Status: Implemented for onboarding, personal Settings, hosted mailbox handoff, prompt tone, voice memo default resolution, supervisor-run preview generation, private conversational controls, and room-owned hosted Linq group controls for all five settings

## Product Contract

Murph's speaking style has five controls:

1. Tone: `casual` or `formal`.
2. Voice: one option from the shared voice roster.
3. Humor: an integer from 0 through 10.
4. Push: an integer from 0 through 10.
5. Detail: an integer from 0 through 10.

Tone and voice appear during the hosted first visit and under **How Murph talks** in personal Settings. Humor, Push, and Detail are available through explicit private conversational requests and under **Personality** in personal Settings. Settings shows all three effective 0–10 values in one dialog on desktop and one drawer on mobile; it does not add onboarding steps. An authenticated hosted Linq group may change all five controls conversationally, but those choices belong to that room's Murph runtime and have no separate web UI.

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

`hosted_member.assistant_tone` and `hosted_member.assistant_voice` capture the latest web projection for mailbox handoff. A person member's row also backs personal Settings display; a synthetic thread-container member's row backs only that room runtime. The session-authenticated route `POST /api/settings/assistant-style` and the runtime-bound signed assistant personalization callback use the same mutation owner. That owner validates the request, updates changed columns, appends a `member.preferences.updated` hosted mailbox event, and best-effort signals the same runtime.

For hosted conversational personality writes, Web also owns accepted-input
admission and the hosted projection transaction. It updates only the requested
Humor, Push, or Detail columns and their per-dial causal watermarks atomically
with the sparse canonical mutation event carrying the accepted turn's original
causal sequence. Canonical personality values still live only in the vault.

The `murph.assistant_style` `show` action resolves missing dial values to these defaults and labels them `source: "default"`. A successful explicit set remains `source: "custom"` even when the chosen score equals the product default. Reset removes the override and restores the effective default. Resetting the last override removes the empty personality object.

No prompt text, inferred psychological profile, or conversation excerpt is stored. Prompt behavior stays code-owned.

## Hosted Conversation Control

Hosted conversations expose one typed `murph.personalization` operation when
the runtime has its web-owned port and turn planning grants the current
conversation authority. The callback target is fixed by the runtime: a person
member in direct conversation or the synthetic room member in an authenticated
hosted Linq group. It never accepts a participant target:

- `action: "read"` returns the effective tone and voice plus read-only model and
  Sol-availability context. Nullable hosted storage is presentation-only
  normalized to the canonical `formal` tone and `upbeat` ("Classic Murph")
  voice defaults; a read does not persist those defaults.
- `action: "update"` accepts at least one validated tone or voice field and
  saves only the fields explicitly requested for the current runtime. It cannot mutate model or
  reasoning configuration.
- The result distinguishes `saved` and `unchanged` and returns the effective
  values after the operation. Its retained model fields are read-only context;
  `modelUpdated` and `modelChangeAppliesNextRun` remain false. A saved tone or
  voice converges through the existing mailbox owner for a later turn; it does
  not retroactively change the reply running the tool, so a same-turn voice
  demo is not activation proof.
- The invocation-scoped bridge completion budget exceeds the configured
  canonical web-control timeout. Once the owner request starts, the CLI waits
  for that request to settle instead of reporting a shorter local timeout while
  the preference write can still complete.
- A synthetic room update additionally binds the accepted input to a current
  non-direct Linq wake and route for that same container. A group email, direct
  Linq message, missing route, stale route, or cross-room route cannot mutate
  room style.
- A person-runtime update positively requires that same input to be direct.
  Linq must be explicitly direct, email must be explicitly direct and
  style-authorized, and hosted Telegram remains a person-direct route. A
  mislabeled or retained group input cannot fall through to private settings.

Model and reasoning mutations belong exclusively to the private-direct
`murph.assistant_configuration` surface. That operation reads the current-turn and
saved next-turn configuration, requires user-sourced intent for an exact update,
and saves only when web binds the terminal input id from the locally revalidated
bounded exact-successor provider batch to the callback member and one live
conversation mailbox row. This preference change does not require passkey
approval. A saved update starts on the next turn rather than changing the turn
that requested it.

Voice labels shown to members map to tool ids from the shared
`assistantVoiceOptions` roster; voice guidance derives the complete mapping
from that roster, including "Classic Murph" -> `upbeat` and "New York" ->
`classic`, rather than maintaining a second label table. Model and reasoning
guidance derives from the canonical hosted-assistant configuration contract,
not from the personalization tool.

This path deliberately does not write `bank/preferences.json` directly. Tone
and voice still flow from the hosted-member capture through
`member.preferences.updated` to `core.updateAssistantPreferences`, preserving
Settings/runtime convergence. Model and reasoning remain web-owned nullable
intents with no vault peer. When the typed operations are unavailable,
`/settings?voice=true` is the narrow voice/sound fallback for a person's direct
Murph, while `/settings` is the personal fallback for tone, model, or reasoning
changes. A personal Settings URL is never a fallback for configuring a room.

## Personality Dial Conversation Control

The assistant uses the headless `murph.assistant_style` operation. Turn
planning registers it only for the exact current private direct conversation
or an authenticated hosted Linq group turn. The direct surface targets that
person's Murph; the group surface targets only the synthetic room Murph. Group
email, non-hosted groups, and indeterminate audiences receive no style mutation
operation. Its closed
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
- Interpret each requested dial's outcome directly: `saved` means Web accepted
  that intent, `unchanged` means it was already current, and `superseded` means
  newer intent won. Report the returned effective setting instead of echoing a
  superseded request. `updated` is true only when a saved requested dial changes
  the effective same-turn snapshot.
- If the operation errors or returns no `settings` snapshot, say the result is unconfirmed. Do not claim that it changed or stayed unchanged. One `show` may report current canonical state without claiming whether the original action caused it.
- When Humor changes above 0 and the context is safe, the acknowledgement may include at most one earned joke; no strong beat means no joke.
- When Humor changes to 0, confirm it plainly without a joke.
- Do not hard-code a recurring acknowledgement joke.

In local mode, `set` and `reset` continue to write the canonical vault directly.
In hosted mode, they send one strict `update_personality` request through the
runtime-bound signed personalization callback, carrying invocation-owned
assistant-input authority rather than a model-supplied sequence. Web returns the
effective projection and a per-requested-dial outcome of `saved`, `unchanged`,
or `superseded`. Accepted results form an invocation-only overlay so a later
style operation in the same turn sees what Web accepted before the mailbox
event reaches the vault. `show` always starts from canonical vault state and
applies only that turn-scoped overlay; the overlay is not persisted and cannot
replace mailbox convergence.

## Behavior Bands

The exact integer is preserved and shown to the user. Prompt behavior uses five reviewed bands because adjacent scores do not need separate policy text.

These boundaries are product-design choices, not a validated psychological
scale. They follow four perception rules:

- Warmth, competence, respect, calibrated uncertainty, and urgent safety
  guidance stay high at every score. The dials scale style, not the quality or
  safety of the answer.
- Humor scales creative latitude, not joke frequency or aggression. It is
  permission, not a quota: a specific beat must sharpen the point or reward
  shared context, and no strong beat means no joke at any score. Factual answers
  get at most one humor beat. Humor notices Murph or a concrete absurdity in the
  situation; it never makes the member, their identity, body, symptoms,
  condition, competence, or effort the joke. Stock personification, canned meme
  templates, forced analogies, and repeated or explained punchlines are out.
- Push scales directness and accountability around a member-chosen goal while
  preserving a visible choice to commit, revise, or decline. Higher Push is not
  broader consent to control the member.
- Detail uses answer-first progressive disclosure. Higher scores add
  decision-relevant depth and navigation, not repetition, jargon, or an
  indiscriminate context dump.

### Humor

| Score | Behavior |
| ---: | --- |
| 0 | No jokes, puns, teasing, comic metaphors, or playful asides. Warmth comes from plain language rather than comedy. |
| 1–3 | Occasional, subtle situational wit only when the current exchange is already playful; keep it to one brief aside. |
| 4–6 | When a strong opportunity arises in a safe, low-stakes reply, use one concise dry observation or playful analogy grounded in the actual situation; keep the factual point obvious. |
| 7–9 | When humor is welcome, take a bold, situation-specific swing with deadpan understatement, a precise callback, or absurd but unmistakably nonliteral escalation. Make the contrast large enough to read as a joke; never create plausible harm or ambiguity about facts or intended actions. After the beat, return to the point. |
| 10 | When humor is clearly welcome, take the largest safe creative swing with one bold deadpan beat, ridiculous escalation, or precise callback. Keep absurdity unmistakably nonliteral; only in a long, explicitly playful reply may one brief callback extend the joke. Creative risk applies to wording, never clarity, seriousness, emotional safety, or action status. |

### Push

| Score | Behavior |
| ---: | --- |
| 0 | Reflect, inform, and offer choices without unsolicited challenge, pressure, or accountability; leave the decision visibly with the member. |
| 1–3 | Encourage gently around a stated goal; acknowledge stated friction, offer one small reversible next step, and make it easy to choose, change, or decline. |
| 4–6 | Be direct and action-oriented around an explicit member-chosen, low-risk goal; recommend one concrete, achievable next step, name a practical obstacle only when the conversation supports it, and include an easy fallback. |
| 7–9 | Use firm accountability only for an explicit member-chosen, low-risk, non-sensitive goal. When the conversation shows a gap between the stated plan and reported behavior, describe that observable gap without inferring motive; prioritize one next action or smaller fallback and ask for a specific time, commitment, or revision. |
| 10 | Use maximum directness and brevity only for an explicit member-chosen, low-risk, non-sensitive goal. Name an observable plan-or-behavior gap, never motive or character; ask for a commitment, revision, or decline, then respect the answer. |

Push controls delivery, not authority. It never turns health into compliance or moral worth. It cannot make Murph demand unsafe exertion, override a stop rule, manufacture urgency, continue pressure after the user says to stop, pressure a reply, signup, sharing, spending, consent, or authorization, or change notification and follow-up cadence.

### Detail

| Score | Behavior |
| ---: | --- |
| 0 | Lead with the shortest complete answer: the bottom line, essential action when relevant, and any material caveat. Omit optional background. |
| 1–3 | Lead with the bottom line, then give up to three key points and one next step when relevant. Required warnings, uncertainty, confirmations, and urgent guidance do not count against that limit. |
| 4–6 | Give answer-first balanced detail with the most useful rationale and context; add a main tradeoff or practical next step only when relevant. |
| 7–9 | Give a thorough, answer-first response; add decision-relevant assumptions, uncertainty, alternatives, tradeoffs, implementation, and safety considerations in clear chunks without tangents or repetition. |
| 10 | Give the most complete decision-relevant answer the evidence supports. Start with the conclusion and, when relevant, the immediate action; then cover relevant mechanisms, material alternatives, likely edge cases, and evidence limits. Do not imply completeness, enumerate remote possibilities, or add background that would not change understanding or action. |

Detail controls presentation, not completeness of material warnings. A low score never removes a contraindication, stop rule, material uncertainty, required confirmation, or emergency guidance.

## Baseline And Sparse Prompting

The stored document remains sparse, and the thread-context personality block appears only when at least one explicit override exists. This preserves the current prompt and thread contract for members who never use the dials.

Classic Murph's static personality text explicitly embodies the defaults:
Humor 3 means at most one earned situational beat when playful, with no canned
bits or member-directed jokes; Push 3 means one small reversible step with
visible member choice; Detail 5 means answer first, then useful context. If a
default changes, the shared default constant, this static baseline, docs, and
prompt regression must change together.

Each explicit override renders its exact score and reviewed band in thread context. Missing sibling dials are not rendered. Because thread context participates in the assistant contract fingerprint, a changed dial starts one fresh compatible Codex thread on the next turn while committed transcript history preserves conversation continuity. No custom session invalidation or prompt hot-reload mechanism is needed.

The returned command snapshot governs the acknowledgement in the same turn. The newly written preference naturally enters the prompt on the next turn.

## Precedence And Protected Contexts

Personality settings change expression only. The precedence order is:

1. Safety, truth, privacy, consent, authorization, and clinical boundaries.
2. Protected-context and channel rules.
3. The user's explicit current-turn instruction.
4. The saved personality dials.
5. Classic Murph defaults.

Fit every dial inside the current channel's pacing: Detail sets the length
budget, Humor and Push fit inside it, and Humor never gets its own bubble. When
urgent action is needed, lead with the action, timeframe, and safety essentials;
when the member has limited capacity, omit optional background.

Humor is suppressed for plausible emergencies, direct self-harm language, serious medication or health decisions, grief, trauma, abuse, acute distress, and sensitive privacy, authentication, billing, consent, or irreversible-action confirmations. Jokes must not ambiguously claim that Murph sent, bought, booked, changed, deleted, disclosed, or authorized something.

The dials never change notification eligibility or frequency, quiet hours, tool access, spending or confirmation requirements, diagnostic confidence, model selection, data access, or real-world action authority. Personality preferences do not enter notification-decision or private maintenance prompts.

## Audience Scope

Style preferences always belong to the active conversation runtime. A person runtime's Tone, Voice, Humor, Push, and Detail remain private to that person's Murph. A synthetic hosted group runtime has its own five settings in its own `HostedMember` projection and canonical room vault. Interactive group prompts apply those room values, hosted room notification decisions apply Tone, and generated group voice output resolves the room voice; none of those paths reads or inherits a participant's private settings.

Authenticated hosted Linq group turns receive `murph.personalization` and `murph.assistant_style` bound to the room member. The request has no member selector, and Web accepts a container mutation only when the accepted input proves the same current non-direct Linq room. Group email may use the room's already saved style for expression but cannot mutate it. Non-hosted groups and indeterminate routes receive neither personal preferences nor the style operations. `murph.assistant_configuration` remains private-only; group model and reasoning stay relation-derived.

The raw style CLI hard cut is effective only after every old assistant runner
bundle has drained or restarted. A gradual rollout that leaves warm older
bundles serving turns leaves the retired shell command reachable, so deploy the
runner/CLI change as an immediate convergence and verify the live fleet reports
the new bundle before treating the audience boundary as active. The first
personality-aware reader/writer release remains the rollback floor.

Deploy the Web eligibility and accepted-input route validation before the runner exposes the room tools and prompt. Old runner plus new Web is inert; new runner plus old Web rejects container mutations. Roll the runner immediately after Web so warm group runtimes converge on one contract. No schema migration or preference copy is required.

## Hosted Settings Projection

The web surfaces use the same tone ids and shared voice roster defined above.

`hosted_member.assistant_tone`, `hosted_member.assistant_voice`, and the nullable
`assistant_humor`, `assistant_push`, and `assistant_detail` columns capture the
latest web projection for mailbox handoff. For person members, they also drive
personal Settings display. For synthetic room members, they belong only to the
room runtime and have no personal Settings surface. The three numeric
columns have database range constraints from 0 through 10. They are a
Settings-side display/write projection, not canonical preference truth;
`bank/preferences.json` remains canonical.

`POST /api/settings/assistant-style` validates the authenticated member's
values, updates requested columns, and, when at least one requested field
applies, appends one `member.preferences.updated` event and best-effort signals
the runtime. While the web rollout gate is off,
tone/voice events retain the legacy complete tone/voice snapshot required by
the old coalescing consumer. Once the gate is enabled, events contain only the
request delta. Personality payloads are strict,
non-empty sparse objects. They reject unknown keys, fractions, out-of-range
scores, and mixed tone-or-voice plus personality requests before persistence.
The response returns the full web projection so the Settings row can update
without inventing a second readback service.

Hosted conversation `set` and `reset` now converge the web projection before
the tool reports success. Inside one signed, accepted-input-bound transaction,
Web resolves the turn's canonical sequence, atomically updates each applicable
requested dial and its watermark, and, when at least one dial applies, appends one sparse
`member.preferences.updated` event with `causalOrigin: "turn"` and that original
sequence. The mailbox event then converges the same sparse intent into canonical
vault state. Settings
continues to submit only dials deliberately touched in its dialog, even when a
touched dial returns to its displayed value. Projection equality must not
suppress that explicit canonical intent, and the dialog must never submit all
three displayed defaults automatically.

There is no push channel into an already open Settings page, so a page that was
open during a conversational change needs a reload before it shows the new
projection. Values written in conversation before this convergence path shipped
cannot be reconstructed safely from the web database; an affected member may
see one stale dial until that dial's next conversational set/reset or Settings
save. Sparse writes do not repair untouched siblings. That historical one-time
gap is not an ongoing source-of-truth exception.

After the web gate is enabled, `member.preferences.updated` is a delta contract,
not a replaceable snapshot. The hosted system mailbox applies every preference
item in mailbox order. An older retry blocks newer preference deltas until it
succeeds; preference items must not be latest-wins coalesced or superseded. The
gate-off complete snapshot is deployment compatibility for the old consumer,
not a second steady-state contract.

The scheduled handoff backstop selects retained unconsumed preference rows for
active person members and active synthetic room runtimes before applying its
bounded batch limit. A room is eligible through the same active-owner or
current-active-participant access derivation as the canonical runtime gate.
The sweeper rechecks that async gate before signaling and drains oldest
candidates first so inactive or newer rows cannot permanently hide older valid
work. This is recovery transport for the existing durable mailbox event, not a
second preference or room-settings owner.

Every newly appended mailbox row receives one immutable per-member causal
sequence serialized across conversation and system lanes. The sequence is
assigned by the mailbox owner at durable acceptance, carried through the local
system pending item or conversation input record, and passed into the canonical
preference mutation. `bank/preferences.json` retains only each sparse field's
value. The canonical companion document
`bank/assistant-preference-mutations.json` retains each sparse field's
last-applied sequence. Ordering is field-local: a newer sequence applies and
advances its dial's watermark even if the visible projection value is
unchanged; an older sequence is a stale no-op for that dial while a fresh
sibling may still apply; the same sequence and value is an exact idempotent
retry; and the same sequence with a different value is a later command from the
same accepted turn and applies in command order. The same rules govern Web's
per-dial projection watermarks and the canonical companion watermarks. Ordering
never uses
wall-clock comparison, and replay needs no separate receipt, reservation,
lifecycle cap, or mailbox-removal acknowledgment.

New `conversation.message` mailbox rows also store a nullable server-keyed
lookup of the existing deterministic assistant input id. The raw id is not
persisted in that projection; the mailbox wire shape, `sourceRef`, and event id
do not change. For an update, the conversation personalization callback carries
the terminal provider-accepted input id only after the accepted ids revalidate
as one same-conversation, same-reply-anchor, exact-successor batch; it does not
carry a sequence. Inside the mutation transaction,
web derives the configured lookup-key candidates and resolves the callback
member and one matching key to one live conversation-lane
`conversation.message` row and reads its canonical causal sequence. Missing,
legacy, mismatched, or ambiguous identity fails closed without a numeric
sequence fallback. The web projection stores nullable per-field tone, voice,
Humor, Push, and Detail watermarks and stale-no-ops only requested fields whose
later Settings or conversation intent already has a higher sequence. A
conversation wake keeps its origin sequence and `turn` origin for canonical
application even though the mailbox row receives a newer transport sequence;
Settings wakes continue to use their row sequence. This keeps the display
projection and canonical vault on the same field-local order without making
callback time a new intent.
During the legacy complete-snapshot rollout, additive `requestedFields`
metadata preserves the caller's exact tone/voice field set for new runtimes;
the web projection still advances every field visible to an old snapshot
consumer so either runtime version stays causally consistent.

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

The accepted-input boundary forwards the batch's terminal provider-accepted
input id through the dedicated personalization port. The model cannot provide
or replace that id or a numeric sequence. Web binds the id to the callback
member and one live mailbox row, then derives the canonical sequence for tone,
voice, Humor, Push, and Detail ordering. Exact-successor proof means the
terminal input cannot cross an intervening system-lane Settings mutation. The
selected batch is frozen before the provider starts; mailbox input accepted
later remains pending for another turn. The id is invocation-local transport
only and is cleared after the provider attempt; persisted assistant-input files
are never numeric authority. Missing or ambiguous authority fails the hosted
write closed without blocking the ordinary reply.

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

The sparse-delta, shared-causal-sequence, personalization-authority, and
conversation-to-Settings convergence transition uses additive expansion
followed by a hard cut:

1. Vercel predeploy applies the nullable `causal_seq` expansion and the
   nullable keyed assistant-input lookup projection, plus nullable Humor,
   Push, and Detail projection-watermark columns. Deploy the new web build with
   `MURPH_ASSISTANT_PERSONALITY_CAUSAL_WRITES_ENABLED=0`; the Settings
   personality controls and hosted personality mutation action remain
   unavailable while old functions drain. That build writes a server-keyed
   lookup of the existing deterministic assistant input id for new conversation
   messages, supports the signed input-bound personality transaction, and
   hard-rejects callbacks that do not resolve it. It also rejects the retired
   direct-vault `resolve_preference_causal_seq` action; old Vercel functions may
   still serve that action only during their bounded pre-contract drain. It does
   not change the mailbox wire, `sourceRef`, or event id. This web build is the
   rollback floor.
2. The normal post-deploy contract-migration lane waits for the old Vercel
   function window, then fails closed only if a legacy preference row remains
   above the authoritative system-lane `consumed_seq`. It installs the
   new-write check `NOT VALID`, so handled retained history does not block the
   rollout and new null-sequence preference writes are rejected. After that
   same drain, it seeds all three personality projection watermarks to each
   member's current causal barrier, including dials whose projection value is
   null. This is an intentional exception to the populated-field rule used for
   tone and voice: before reverse convergence, a null personality projection
   could still disagree with a custom canonical vault value. The barrier makes
   older pre-cutover turns stale without pretending the unavailable historical
   value can be backfilled. The boundary row at the barrier keeps the normal
   equal-sequence command semantics; every message accepted after the committed
   seed is strictly newer. A direct-vault write completed through an old Vercel
   function before the drain ends joins the bounded historical non-backfill
   caveat; after the drain, the hard-cut route cannot create another one.
3. Deploy the new Cloudflare worker and runner with
   `container_rollout=immediate`; prove the managed fleet has converged. The
   runtime forwards the terminal input id only from a locally revalidated
   same-conversation, same-anchor, exact-successor accepted-input batch, and Web
   derives its causal sequence from the live member-owned mailbox row inside
   the write transaction. There is no sequence fallback.
4. Set `MURPH_ASSISTANT_PERSONALITY_CAUSAL_WRITES_ENABLED=1` and redeploy Web.
   Settings switches tone/voice to sparse deltas and
   exposes personality controls and hosted conversation convergence only after
   the FIFO consumer fleet is present. Existing reply styling, ordinary
   conversation, and current-inbound replies stay available throughout.

The new consumer accepts already-imported tokenless v1 local pending items
through the explicit sequence-zero path. The pre-switch drain ensures that
compatibility path is not asked to reconstruct unavailable cross-lane order.

During the old-Vercel-function drain, a legacy runtime may still complete the
old direct-vault path through an old function. After that drain, hard-cut Web
rejects the retired resolver: legacy runtimes continue ordinary replies, but
style writes fail closed as unconfirmed until the input-bound fleet converges.
Deploying Web and Cloudflare/runtime in tandem minimizes both windows. Keep Web
at or above the hard-cut build during any runtime rollback; an older runtime
continues ordinary replies but its style writes remain unavailable. Do not
enable the gate until the converged fleet uses the input-bound personality
transaction. Post-deploy, save one dial, run a
conversational change to the same dial, confirm the later accepted intent wins
in both the refreshed Settings projection and canonical vault, exercise a
reset, and confirm no preference item remains rejected or stuck. An already
open Settings page needs a reload; do not mistake that client snapshot for
failed server convergence.

After the gate is enabled, set it to `0` and redeploy Web before a runtime
rollback if unavailable controls must be hidden. Keep Web at or above the
hard-cut transaction rollback floor while personality watermarks exist; never
restore a Web build that serves the retired direct-vault resolver.

## Preview Clips

Run:

```bash
node scripts/generate-murph-voice-previews.mjs
```

The script loads local env files without printing secret values, requires `ELEVENLABS_API_KEY`, defaults to `eleven_v3` unless `MURPH_ELEVENLABS_MODEL_ID` overrides it, uses `MURPH_ELEVENLABS_VOICE_ID` for the `classic` ("New York") clip, and writes MP3 files to `apps/web/public/audio/murph-voices/`. Build `packages/contracts` first so the script reads the shared roster from the package export.

Preview clips are generated by the supervisor after review. The shared preview line must not mention a human voice name; every option is Murph with a different vibe.
