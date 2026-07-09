# Murph tone + voice onboarding steps

Date: 2026-07-08
Owner: Codex (c1), supervised by Fable
Status: completed

Our utmost priority is clean, simple, long term maintainable and composable
architecture with minimal complexity.

## Why

New members like choosing Murph's contact-card photo before adding the
contact. We are extending that same personalization moment: after the
contact-card step, members choose (1) the tone Murph texts them in and
(2) the ElevenLabs voice Murph uses for voice memos. Inspiration: tomo.ai's
onboarding, which asks "Which sounds more like you?" with two chat-bubble
samples (formal "Hello, what are you?" vs lowercase "yo what is tomo").

This intentionally relaxes the contact-card picker spec's v1 invariant
("one Murph, one voice, different picture on the card"). Update
`agent-docs/product-specs/murph-contact-card-picker.md` accordingly and add a
new product spec `agent-docs/product-specs/murph-tone-and-voice.md`.

## User flow (target)

Initial-visit dialog (`apps/web/app/(dashboard)/home/initial-visit-dialog-client.tsx`),
today a two-step `"contact" | "welcome"` sequence, becomes:

1. `contact` — existing contact-card picker (unchanged; members without a
   text line skip it, as today).
2. `tone` — NEW. "How should Murph talk to you?" Two tappable chat-bubble
   samples rendered as Murph messages (see Tone options below). Continue /
   Skip.
3. `voice` — NEW. "Pick Murph's voice." 3–4 rows, each a tappable
   voice-memo-style preview (reuse `VoiceMemoPlayer` from
   `apps/web/src/components/ui/voice-memo-player.tsx`, as used on the
   homepage) plus a name; radio selection; only one clip plays at a time.
   Continue / Skip.
4. `welcome` — existing welcome dialog (unchanged).

Members without a text line start at `tone` instead of `contact` (tone and
voice apply to Telegram members too — Telegram gets TTS voice memos).

Settings: add one "How Murph talks" card to the hosted account settings
(`apps/web/src/components/settings/hosted-account-settings-cards.tsx`
neighborhood, parity with the existing avatar "Pick a new look" card) that
reopens the same tone + voice choosers and shows the current values. This is
how members who already onboarded change these.

Each step persists on Continue (partial choices survive dismissal): the
client POSTs the chosen field(s) to one new session-authed route. Skip
persists nothing for that step.

## Architecture (decided — follow unless the code proves otherwise)

Follow the existing `timeZone` precedent: web Postgres captures the choice,
a hosted mailbox system event hands it into the container, and the runtime
writes the canonical vault record via `packages/core`. This satisfies the
persisted-state placement gate (user-facing preference => canonical
`vault/**` via core-owned mutation) while letting the web settings UI show
current values from its own capture columns.

Data flow:

```
initial-visit dialog / settings card
  -> POST /api/... (hosted app session auth, zod-validated)
  -> Postgres capture columns on the hosted member (web display copy)
  -> append hosted mailbox system event `member.preferences.updated`
     { tone?, voice? } + wake (same append/wake path member.activated uses in
     apps/web/src/lib/hosted-onboarding/member-activation.ts)
  -> runtime system-mailbox route action (packages/assistant-runtime/src/
     hosted-runtime/system-mailbox.ts, precedent: "apply-member-activation"
     at line 109 -> bootstrapHostedMemberContext in context.ts:199)
  -> packages/core preferences mutation writes vault bank/preferences.json
  -> consumers read the vault record (single canonical source in-container)
```

### 1. Shared voice roster (new, one module)

A single static roster shared by web (labels + preview clips) and the
assistant engine (voice resolution). Suggested home: `packages/contracts`
(where `preferencesDocumentSchema` lives), exported entries:

```ts
{ id: "classic", label: "...", elevenLabsVoiceId: null }   // null => keep env default
{ id: "<alt1>",  label: "...", elevenLabsVoiceId: "<11labs id>" }
{ id: "<alt2>",  label: "...", elevenLabsVoiceId: "<11labs id>" }
{ id: "<alt3>",  label: "...", elevenLabsVoiceId: "<11labs id>" }
```

- Option ids are stable identifiers (same rule as avatar ids — never reuse).
- `classic` maps to `null` so the runtime falls through to
  `MURPH_ELEVENLABS_VOICE_ID`; no literal prod voice id in the repo.
- Preview clips by convention at `apps/web/public/audio/murph-voices/<id>.mp3`.
- For the alternate voices: pick 3 candidate ElevenLabs premade/library voice
  ids (fetch `GET /v1/voices` with `ELEVENLABS_API_KEY` from `.env` if
  available; otherwise leave clearly-marked placeholder ids). Will approves
  the final roster at review — structure so swapping is a one-line change.
- Voice ids are not secrets, but never commit API keys.

Tone options (shared union, same module or sibling): `"casual" | "formal"`.
Unset => current default persona. Casual = lowercase, relaxed, light slang.
Formal = full sentences, proper capitalization, no slang.

### 2. Web capture (apps/web)

- Prisma: two nullable string columns on the hosted member model
  (`assistantTone`, `assistantVoice`) + migration. Values validated against
  the shared unions/roster ids at the route boundary; unknown => 400.
- One new route, e.g. `POST /api/hosted-onboarding/assistant-style`
  (follow the auth pattern of `apps/web/app/api/murph-contact-card/route.ts`:
  active hosted app session required). Body: `{ tone?, voice? }`, partial
  upsert semantics, idempotent. On change: update columns, append
  `member.preferences.updated` mailbox event, trigger the normal wake.
- Reuse the exact mailbox append + wake helpers `member.activated` uses in
  `member-activation.ts`. Do NOT modify files owned by active ledger lanes:
  `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`,
  `apps/web/src/lib/hosted-mailbox/*` (call existing exports only; if a
  change inside them seems required, stop and report instead).
- Dedupe key pattern like `member.activated`'s
  (`member.preferences.updated:<memberId>:<eventId>`); repeated updates are
  last-write-wins.

### 3. Contracts + core + wake plumbing

- `packages/contracts/src/preferences.ts`: extend `preferencesDocumentSchema`
  with an optional `assistant` section:
  `{ tone?: "casual" | "formal"; voice?: <roster option id (string)> }`.
  Keep the existing schema-version seam happy.
- `packages/core/src/preferences.ts`: a narrow setter (pattern:
  `setWearablePreferences` in `packages/vault-usecases/src/preferences.ts`
  and core's existing preference write path) — canonical WriteBatch mutation.
- `packages/hosted-execution` contracts: add the
  `member.preferences.updated` wake kind (precedent: `member.activated`,
  `member.channels.updated` in the `HostedExecutionWake`/system wake unions).
- `packages/assistant-runtime/src/hosted-runtime/system-mailbox.ts` (+
  `events.ts` routing): new route action `apply-member-preferences` that
  writes the vault preference via core. Keep the hosted-runtime diff narrow —
  the mailbox consumed-at lane (ledger) is also touching hosted-runtime
  files. Re-application must be idempotent.
- Do NOT add a `vault-cli` setter for these fields in v1 (web settings is the
  only change surface; avoids web-copy vs vault divergence). A read (`show`)
  surface is fine if it falls out naturally.

### 4. Voice consumption (TTS)

Effective voice resolution order: tool-arg `voiceId` override (existing) >
member vault preference (roster id -> elevenLabsVoiceId) > env
`MURPH_ELEVENLABS_VOICE_ID`.

- Linq path: `packages/assistant-engine/src/assistant-codex/
  generate-voice-memo-tool.ts` — today effective voice =
  `args.voiceId ?? runtime.elevenLabs.voiceId` (lines 95-103), with the
  runtime built from env in `createVoiceMemoToolRuntimeFromEnv` (line 291)
  wired in `packages/assistant-engine/src/assistant/providers/codex-cli.ts:190`.
  Read the vault preference where the vault root is already available and
  thread it into the same resolution point. Prefer reading the preferences
  document once per turn/runtime-construction over per-call file reads if
  that is cleaner, but keep it simple.
- Telegram path: deferred generation at delivery in
  `packages/assistant-engine/src/assistant/channels/runtime.ts`
  (`prepareTelegramVoiceMemoMessage`, line ~340) — must honor the same
  resolution. Both channels run in-container with the vault on disk.
- Unknown/stale roster id in the vault => fall through to env default
  (never fail a voice memo over a preference).
- No egress interceptor change needed: `apps/cloudflare/src/
  runner-egress-elevenlabs.ts` already allows any
  `/v1/text-to-speech/<voiceId>` path with body `{model_id, text}`.
- No usage/pricing change: ElevenLabs TTS is character-priced per model,
  voice-agnostic.

### 5. Tone consumption (prompt)

The persona today is static text in
`packages/assistant-engine/src/assistant/system-prompt.ts`
(`buildAssistantIdentityAndScopeText`, "Personality:" block ~lines 630-639).
Inject the member tone deterministically (not model-discretionary):

- Read the vault preferences document at turn planning
  (`packages/assistant-engine/src/assistant/codex-turn/planning.ts` already
  reads vault-derived prompt inputs, e.g.
  `readAssistantContextSnapshotPrompt` ~lines 481-492) and pass tone into
  `buildAssistantSystemPromptLayers`.
- Render a short tone block in the thread-context layer
  (`threadContextPrompt`, thread-stable, cache-friendly) — two variants:
  - casual: write in lowercase with a relaxed, casual texting style; light
    slang is fine; stay substantive and precise.
  - formal: write in complete sentences with proper capitalization; plain,
    professional, no slang.
  Absent preference => no block (current behavior). Explicit user
  instructions and learned memory still override (existing guidance).
- This is prompt-affecting: keep the block minimal and run the
  `prompt-review` audit pass.

### 6. Voice preview clips + generation script

- Script (e.g. `scripts/generate-murph-voice-previews.mjs`): for each roster
  entry, call ElevenLabs TTS (same request shape as
  `packages/operator-config/src/elevenlabs-runtime.ts`) and write
  `apps/web/public/audio/murph-voices/<id>.mp3`. `classic` uses env
  `MURPH_ELEVENLABS_VOICE_ID`. Requires `ELEVENLABS_API_KEY`; fail with a
  clear message when unset. Keep clips short (~5s) and small.
- One shared preview line, plain and Murph-flavored (no em dashes, no
  jargon), e.g.: "hey, it's murph. i'll send you voice memos that sound
  like this." Final copy per plain-copy rules.
- Run the script if a key is available in `.env`; otherwise commit the
  script plus placeholder-free roster and report that clip generation is
  pending. The voice step UI must degrade gracefully if a clip 404s
  (selection still works; player shows unavailable state).

## Edge cases

- Welcome race: the member may still be picking tone/voice while the welcome
  turn runs. Acceptable: the event is queued in the mailbox and applies on
  the next wake. Do not block or resequence welcome delivery
  (product-critical flow; see invariants).
- Member picks, then dismisses dialog: per-step POST means completed steps
  stick.
- Container not yet created / vault not yet initialized: mailbox queues the
  system event until the runtime consumes it (same as other system events).
  Verify route-action ordering vs `member.activated` vault bootstrap — the
  preferences write must cope with running after vault init (normal) and
  must not create a vault on its own; if the vault does not exist yet, the
  item should defer/retry like other system-mailbox items, not crash.
- Duplicate/replayed events: idempotent apply, last-write-wins.
- Unknown tone/voice values from old clients: 400 at the route; unknown
  values already in the vault: ignore + fall back to defaults.
- Existing members (no preference anywhere): zero behavior change. This must
  be provable — absent preference produces byte-identical prompts and the
  same TTS request as today.

## Out of scope (v1)

- Assistant-initiated tone/voice changes (vault-cli setter) and any Postgres
  <- vault backflow.
- Persisting the contact-card avatar choice (separate follow-up in the
  picker spec).
- Group-chat voice/tone (per-member preference applies to the member's own
  1:1 container behavior).
- New voice cost gating (character pricing already covers usage).

## Verification

- `pnpm test:diff <touched paths>` where truthful; otherwise owner-scoped
  coverage per `agent-docs/operations/verification-and-runtime.md`.
- Focused tests to add/update:
  - `apps/web/test/home-initial-visit-dialog.test.tsx` — contact -> tone ->
    voice -> welcome, skip paths, no-text-line start at tone.
  - New route test (auth, validation, partial upsert, event append + wake,
    idempotency).
  - Contracts/core preferences schema + setter tests.
  - System-mailbox route action test (apply, idempotent re-apply, vault
    missing => defer).
  - Voice resolution tests: tool-arg > vault pref > env, unknown id
    fallback, Telegram delivery path.
  - Prompt test: tone block present/absent per preference; absent =>
    unchanged output.
  - Settings card test.
- Typecheck + lint per repo baseline.
- Completion audits per `agent-docs/operations/completion-workflow.md` for a
  standard/cross-cutting change: `frontend-review` (new apps/web UI),
  `security-privacy-review` (new authed route persisting user data + event
  egress), `coverage-write`, `prompt-review` (tone block), and `deep-review`
  (cross-cutting web + contracts + runtime + engine).

## Process

- Work only in this worktree (`/private/tmp/murph-tone-voice-onboarding`,
  branch `feat/tone-voice-onboarding`). Root checkout stays on `main`.
- Register the ledger row for this plan in
  `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` (this worktree's
  copy) before code changes.
- Avoid files owned by active lanes: `webhook-provider-linq.ts` and its
  tests, `apps/web/src/lib/hosted-mailbox/*` internals, and keep
  hosted-runtime edits narrow (mailbox consumed-at lane overlaps).
- Do not commit; the supervisor reviews first, then handles the final
  commit/PR path.
- If the code contradicts a seam this plan names, stop and report rather
  than improvising a new architecture.

## DEPLOYMENT CONCERNS (carry into the PR body)

Web (Vercel) emits the new `member.preferences.updated` event; the runtime
(Cloudflare) consumes it. Deploy Cloudflare before web and use immediate
runner-container rollout/drain verification before any web build can emit
`member.preferences.updated`. Do not roll the Cloudflare runtime below this
change while web can still emit the new mailbox kind; if rollback below this
runtime floor is required, roll web back or disable the web emitter first.
After deploy, verify `member.preferences.updated` mailbox rows are imported
and the system-mailbox retry backlog is clear.

## Supervisor addendum (2026-07-08, after prod config check)

- Production runs `MURPH_ELEVENLABS_MODEL_ID=eleven_v3` and
  `MURPH_ELEVENLABS_VOICE_ID=tCM7x6cGUkyoHo8AMYRn` (GitHub production
  environment vars; set 2026-06-18). The code-level `eleven_multilingual_v2`
  default is only a fallback.
- Preview-clip script: default the model to `eleven_v3` (overridable via
  `MURPH_ELEVENLABS_MODEL_ID`) so previews match prod output.
- No local `ELEVENLABS_API_KEY` exists in this checkout, so `GET /v1/voices`
  is unavailable: ship the roster with clearly-marked placeholder voice ids
  for the three alternates plus the `classic` (null/env) entry, and make the
  ids trivially swappable. Will is curating v3-optimized voices from the
  ElevenLabs Voice Library; final ids and clips land at review.

## Supervisor addendum 2 (2026-07-08, final voice roster)

Will curated the roster in the ElevenLabs workspace (mostly from the
Optimized-for-V3 collection). Product decision: picker labels describe the
VIBE, never a voice actor's name — every option is still "Murph", just a
different voice. Option ids are vibe-based too, so the underlying ElevenLabs
voice can be swapped later without invalidating saved member preferences.
Exact label copy may be polished at review (plain copy, no jargon):

- `classic` "Classic Murph" -> elevenLabsVoiceId: null (env default; prod env
  voice tCM7x6cGUkyoHo8AMYRn is Will's designed "Murphy Murph" voice)
- `drill-sergeant` "Drill sergeant" -> DGzg6RaUqxGRTHSBjfgF
- `grandpa` "Grandpa" -> NOpBlnGInO9m6vDvFkFC
- `country` "Country" -> Bj9UqZbhQsanLzgalpEG (deep, raspy, Texas)
- `jamaican` "Jamaican, deep" -> dhwafD61uVd8h85wAZSE
- `radio-host` "Radio host" -> nrD2uNU2IUYtedZegcGx (British radio presenter)
- `deep-calm` "Deep and calming" -> Gubgw9l4dtIoQA9YZHgx
- `warm` "Warm and friendly" -> EST9Ui6982FZPSi7gCHi
- `husky` "Husky and bold" -> EkK5I93UQWFDigLMpZcX
- `storyteller` "British storyteller" -> NNl6r8mD7vthiJatiJt1
- `british-warm` "British, warm" -> exsUS4vynmxd379XN4yO
- `late-night` "Late night radio" -> BpjGufoPiobT79j2vtj4 (calm, neutral)
- `easygoing` "Easygoing" -> 1SM7GgM6IMuvQlz2BwM3 (casual, relaxed, light)
- `northern` "Eccentric northerner" -> wo6udizrrtpIxWGp2qJk

Preview clips must not speak a human name: one shared Murph-voiced preview
line for all options (it is always Murph introducing himself).

`ELEVENLABS_API_KEY` now exists in the root `.env` (renamed from
ELEVEN_LABS_API_KEY), so the preview script can run for real with model
`eleven_v3`. Preview clips are the quality gate — the supervisor and Will
will listen and trim/swap before merge. The voice-step UI must handle a
roster this size with a scrollable list.

## Supervisor addendum 3 (2026-07-08, gender filter on the voice step)

- Each roster entry gains a `gender: "male" | "female"` field (display
  filtering only; not persisted per member — the saved preference stays just
  the option id).
- The voice step (and the settings card variant) gets a simple segmented
  filter above the list: All | Male | Female, defaulting to All. Filtering
  never clears an existing selection; a selected voice hidden by the filter
  stays selected.
- Current gender mapping: female = `warm` (Elise), `british-warm` (Blondie),
  `late-night` (Priyanka); all other entries male. Will may add more female
  voices before merge; treat the roster as data-driven.
- Tests: filter shows/hides rows, selection survives filter changes,
  filter state does not persist anywhere.

## Supervisor addendum 4 (2026-07-08, roster additions — second batch)

Will added 8 more voices (mostly female, plus the football announcer). Same
rules: vibe ids/labels, `gender` for the filter, no actor names in UI:

- `football-announcer` "Football announcer" (male) -> gU0LNdkMOQCOrPrwtbee
- `sweet` "Sweet and natural" (female) -> OZxMHsGaBmV5pjMIDIn0 (Amy)
- `mysterious` "Mysterious" (female) -> Z3R5wn05IrDiVCyEkUrK (Arabella)
- `upbeat` "Upbeat" (female) -> tnSpp4vdxKPjI9w0GnoV (Hope, clear)
- `narrator` "Audiobook narrator" (female) -> RILOU7YmBhvwJGDGjNmP (Jane)
- `expressive` "Warm and expressive" (female) -> rCmVtv8cYU60uhlsOo1M (Ana)
- `bubbly` "Bubbly" (female) -> uYXf8XasLslADfZ2MB4u (Hope, gossipy)
- `smooth` "Smooth and sweet" (female) -> aRlmTYIQo6Tlg5SlulGC (Charlotte;
  label confirmed by Will after listening to the preview clip)

Roster total: 22 options. The gender filter from addendum 3 now has real
balance (~12 male / ~10 female).

## Supervisor addendum 5 (2026-07-08, settings deep link + prompt guidance + UX bar)

1. Settings deep link: the settings page must support a query param (mirror
   the existing `/settings?addEmail=true` handling) such as
   `/settings?voice=true` that opens the "How Murph talks" chooser directly.
2. System prompt: add a brief instruction (1-2 lines, near the existing
   `/settings?addEmail=true` guidance at system-prompt.ts ~line 320, using
   the same product-base-URL link conventions) so that when a member asks to
   change Murph's voice, tone, or texting style, Murph mentions they can do
   it at the settings deep link — casually, once, no pushing. This is
   prompt-affecting: it must be covered by the `prompt-review` pass.
3. UX/UI bar (explicit user requirement): the onboarding tone and voice
   steps and the settings card get an extra-thorough frontend pass — mobile
   drawer and desktop dialog parity with the contact-card picker, only one
   clip playing at a time, clear selected states, filter usability with 22
   rows, skip affordances, and copy per plain-copy rules. The supervisor
   will additionally review the rendered UI before merge; polish findings
   are in-scope, not nice-to-have.

## Supervisor addendum 6 (2026-07-08, implementation corrections)

Supervisor implemented the UI round directly at the user's request.

Architecture correction (found during review): the first implementation added
`assistantTone`/`assistantVoice` to `hostedMemberCoreStateSelect`, which is the
base select for billing, auth, crypto, and inbound-message routing paths
(`hosted-member-routing-state.ts`, `hosted-routing/thread-route-store.ts`).
That over-fetched a cosmetic preference on every inbound message and forced 18
unrelated test files to learn about Murph's voice (47 typecheck errors).

Corrected: the columns are owned solely by `member-preferences.ts`, which now
exports `readHostedMemberAssistantPreferences`. `account-settings-snapshot.ts`
composes it in parallel with the member snapshot. Core state, routing selects,
and `HostedMemberRoutingLookup` no longer mention assistant preferences.

UI corrections (from the supervisor's UX findings):
- Tone step now renders each option as a sample Murph message bubble
  (formal vs lowercase casual) instead of an abstract label + description,
  matching the reference design. Step copy: "Which sounds more like you?"
- Voice list no longer nests a scroll container inside the mobile drawer body;
  the max-height applies at `md:` and up only (matches the 768px `useIsMobile`
  breakpoint, so `sm:` would have been wrong).
- Whole voice row is a click target; the player subtree stops propagation.
- Filter block is sticky on mobile and shows a live visible-voice count.
- The 22 preview clips are committed under
  `apps/web/public/audio/murph-voices/` (~740 KB total). The generator script
  now requests `mp3_44100_64` so re-running it reproduces the committed assets
  instead of silently replacing them at a different bitrate.

Verification: `pnpm typecheck` clean; full `apps/web` suite 4002 passed with
only `apps/web/test/action-approvals.db.test.ts` failing (7 tests), which needs
a live Postgres and fails identically on clean `main`.
Updated: 2026-07-08
Completed: 2026-07-08
