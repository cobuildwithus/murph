# Edit Murph personality from Settings and chat

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Let a member change Murph's main and optional supporting personality from
  Settings and by asking Murph in chat, with both paths writing the existing
  canonical assistant persona preference.

## Success criteria

- Settings shows the saved main and optional supporting personality and opens
  the existing persona selector in a focused two-step edit flow.
- A Settings persona save updates only `persona`; it does not implicitly change
  tone, voice, or the existing independently editable style levels.
- `murph.personalization` can read and atomically update the same main and
  optional supporting personality under its existing input-bound authority.
- Existing onboarding, tone, voice, and dial behavior remains available and
  unchanged.
- Focused tests, Web and package typechecks, responsive design proof, required
  ReviewGPT rounds, Claude UI review, exact-head CI, and mergeability are green.

## Scope

- In scope: Settings snapshot/row/picker wiring, persona-only picker mode,
  hosted personalization contract/handler/tool guidance, focused coverage,
  design catalog, changelog, and owner-doc alignment.
- Out of scope: new Humor/Push/Detail/Unhinged controls, another persona model,
  new dependencies, a generalized preferences framework, or model, provider,
  and reasoning changes. The existing Humor/Push/Detail Settings editor remains
  in scope for preservation.

## Constraints

- Technical constraints: reuse `AssistantPersonaId`, `MurphPersonaPicker`,
  `/api/settings/assistant-style`, `upsertHostedMemberAssistantPreferencesTx`,
  and the existing `murph.personalization` authority boundary.
- Product/process constraints: preserve conversation-first parity, keep group
  versus private ownership unchanged, use the worktree/PR lane, and complete
  the repository's frontend and ReviewGPT gates.

## Risks and mitigations

1. Risk: reusing onboarding UI could accidentally overwrite tone or voice.
   Mitigation: make persona-only persistence explicit and cover the exact POST
   body plus unchanged tone/voice behavior.
2. Risk: model-facing main/supporting fields could form an invalid blend.
   Mitigation: validate both against the existing base-persona enum and reject
   a supporting personality equal to the main personality before persistence.
3. Risk: Settings and chat could drift onto separate storage paths.
   Mitigation: both resolve to the existing combined persona ID and write
   through the same canonical member-preferences owner.

## Tasks

1. Project the canonical persona into Settings and adapt the existing picker
   for a focused main/supporting edit flow.
2. Extend the hosted personalization contract, transactional handler, dynamic
   tool schema, prompt guidance, and group next-turn prompt with
   main/supporting persona fields.
3. Preserve the existing Settings style-level dialog and catalog study beside
   the real persona picker mode.
4. Add focused contract, persistence, component, prompt/tool, snapshot, and
   changelog coverage.
5. Run local proof, create the scoped commit/PR, then complete exact-head
   ReviewGPT, Claude UI review, CI, and mergeability gates.

## Decisions

- Reuse one `MurphPersonaPicker` implementation with an explicit two-step mode
  instead of creating a second selector.
- Keep `AssistantPersonaId` as the only persisted persona value; chat exposes
  main/supporting base-persona inputs and resolves them through the existing
  contract helper.
- Keep the Settings numeric-dial dialog as the independent Humor, Push, and
  Detail editor; the persona picker does not replace it.
- Require persona changes to send a complete main/supporting pair after any
  needed read, so the write stays atomic without a new pre-write database read.
- Reject persona writes from scheduled occurrences while preserving their
  existing tone, voice, and dial authority.

## Verification

- Focused package proof: 92 tests passed across Hosted Execution and Assistant
  Engine personalization, authority, and model-behavior coverage.
- Focused Web proof: 127 tests passed across the picker, Settings row and route,
  settings snapshot, hosted personalization handler, and changelog surfaces.
- Type proof: Hosted Execution, Assistant Engine, and Web typechecks passed. The
  Web Prisma client was regenerated locally after merging current `main`; that
  produced no repository diff.
- Static proof: focused ESLint and `git diff --check` passed.
- Responsive proof: the real design-catalog component was exercised at 1440
  CSS pixels / 2x and 390 CSS pixels / 3x. The resulting desktop main step and
  mobile supporting step were inspected locally and after hosted upload.
- Initial provider-input proof: a pinned real Codex App Server request capture
  against the candidate and its `main` base was repeated twice with identical
  normalized results. The direct-chat request grew from 29,984 to 30,037 tokens
  (+53, +0.1768%); the group-chat request grew from 23,038 to 23,073 tokens
  (+35, +0.1519%). No database, network, provider-call, or awaited-latency step
  was added or moved.
- Claude UI review: attempted with the required Fable model and review-only
  packet, but the account returned an explicit out-of-usage-credits response.
  Per repository policy, this is recorded as a non-blocking unavailable review,
  not as a pass; no further Claude request was made.
- Exact-head preliminary and final ReviewGPT both returned actionable findings.
  Remediation preserves style levels, applies room-owned personas to later
  group turns, closes scheduled persona authority, requires complete persona
  pairs, and removes pointer mutation while saving. Focused proof, provider
  measurement, the final remediation review round, exact-head CI, mergeability,
  plan archival, and marking the draft PR ready remain.
