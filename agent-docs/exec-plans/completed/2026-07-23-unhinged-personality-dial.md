# Unhinged Personality Dial + Style-Dissatisfaction Offers

Created: 2026-07-23
Status: completed

## Outcome and invariant

1. Murph gains a fourth personality dial, `unhinged` (integer 0–10, default 0),
   alongside Humor, Push, and Detail. It scales how much Murph self-censors its
   own style and how much latitude it takes with edgy, crude, or adult-flavored
   material in clearly consensual adult company. At high scores Murph stops
   moralizing about consensual adult bits, runs edgy opt-in group games on
   self-reported honor-system scoring instead of refusing them as unverifiable,
   and matches the room's register.
2. The dial is conversational-only: no Settings row, no picker step, no web
   write path. `murph.assistant_style` (private direct or authenticated hosted
   Linq group room) is the only mutation surface.
3. Murph proactively offers its style settings when members are visibly unhappy
   with how it is replying, and may set a dial itself when a member clearly asks
   for an ongoing behavior change.

Invariants preserved:

- Precedence order item 1 (safety, truth, privacy, consent, authorization,
  clinical boundaries) stays above every dial. The dial scales expression and
  Murph's self-imposed conservatism, never tool authority, notification
  cadence, data access, confirmation requirements, or factual honesty.
- The sparse personality contract: absent dial ⇒ no prompt text, no thread
  contract change for members who never touch it. Default 0 ⇒ current behavior.
- Per-field causal ordering (projection watermarks + canonical companion
  watermarks) applies to the new field exactly like Humor/Push/Detail.
- Thread-stable prompt partition: band text renders only in the thread-context
  layer; guidance/offer text lives in the stable route-capability layer; the
  pinned `staticPromptHash` literal is untouched.

## Owner and boundary

The existing personality-dial family owns this. No new service, table, state
owner, or tool: extend `assistantPersonalitySettingIds` and its generic
machinery end to end, plus two additive `hosted_member` columns.

## Evidence

Live group-chat failure (2026-07-23): members explicitly asked Murph to loosen
up for an opt-in adult group game; Murph refused on verifiability/consent
grounds and members had no way to change its posture. Settings discovery is
also zero inside conversation: nothing tells an unhappy member that Humor,
Push, Detail (or now Unhinged) exist.

## Change list

1. `packages/contracts/src/preferences.ts`: add `unhinged` to
   `assistantPersonalitySettingIds`, schemas, `defaultAssistantPersonalityScores`
   (0), `assistantPreferenceFieldIds`, per-field mutation-state `applied` entry.
   Persona combinations supply no unhinged default; the Classic default 0
   applies everywhere (`resolveAssistantPersonalityScores`).
2. `packages/core/src/preferences.ts`: verify the generic merge/normalize and
   watermark write cover the new key.
3. `packages/vault-usecases/src/preferences.ts`: extend the hardcoded
   `buildAssistantPersonalityResult` settings block.
4. `packages/hosted-execution/src/assistant-personalization.ts`: add the field
   to the personality update schema.
5. `apps/web/prisma/schema.prisma` + additive migration: nullable
   `assistant_unhinged` and `assistant_unhinged_causal_seq` on `hosted_member`,
   matching the existing dial columns exactly — plain nullable integers with the
   0–10 range enforced at the application boundary, not by a DB check constraint.
6. `apps/web/src/lib/hosted-onboarding/member-preferences.ts`: extend the
   per-dial enumerations (read, applicability, column write, stored-score
   switch, normalize).
7. `apps/web/app/api/settings/assistant-style/route.ts`: browser writes must
   reject `unhinged` (web-hidden dial); UI lists stay three-dial —
   `PERSONALITY_DIAL_FIELDS` unchanged and `formatPersonalitySummary` switched
   off the shared id array so the hidden dial cannot leak into the summary.
8. `packages/assistant-engine/src/assistant/system-prompt.ts`:
   - `renderAssistantUnhingedPreference` five-band renderer wired into
     `buildAssistantPersonalityPreferenceText`;
   - `buildAssistantStyleSettingsGuidanceText` covers the fourth dial, its
     aliases, and the rule that a clear ongoing "change how you act" request is
     authorization to set the matching dial;
   - a bare directional request with no number resolves through a same-turn
     `show` plus a bounded step, never an endpoint the member did not ask for;
   - a group-only shared-dial rule: Unhinged rises above 0 only when the room's
     own register supports it, never on one member's say-so over another's
     visible discomfort;
   - one style-dissatisfaction bullet in `buildAssistantCapabilityOffersText`.
   This layer is resident on every turn, so the additions stay inside a ~1_000
   character growth against the pre-dial prompt and the ratchet cap moves once.
9. `murph.assistant_style` tool (`assistant-style.ts`): schema flows from the
   shared setting enum; extend the hardcoded reset-all map.
10. Tests: contracts preferences/personas, assistant-style dynamic tool,
    model-behavior layer partition (no literal pin change expected), web
    settings route rejection, member-preferences projection, personalization
    round-trip, customize-settings summary non-leak.
11. Docs: `agent-docs/product-specs/murph-tone-and-voice.md` (six controls,
    Unhinged bands, conversational-only surface, deploy floor note); dial
    enumerations in `ARCHITECTURE.md` where they name Humor/Push/Detail.

## Failure, skew, rollback

Additive-first. Deploy Web (accepts field + columns) before the runner exposes
the dial: old runner + new Web is inert; new runner + old Web fails the hosted
personality write closed without blocking the reply. Rollback floor: first Web
build with the column plus first runner/CLI that reads the optional key —
same class as the existing personality floor.

## Proof

`pnpm test:diff` across touched owners; full `pnpm verify:acceptance` (schema
change); focused new tests above; preliminary completion-specialists ReviewGPT
pass (prompt + coverage lenses; no rendered frontend states change);
local product-experience-review; final ReviewGPT gate (persisted-state +
cross-owner triggers).
Updated: 2026-07-24
Completed: 2026-07-24
