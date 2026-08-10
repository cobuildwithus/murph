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
- A Settings save updates only `persona`; it does not implicitly change tone,
  voice, or the separate conversation-only style dials.
- `murph.personalization` can read and atomically update the same main and
  optional supporting personality under its existing input-bound authority.
- Existing onboarding, tone, voice, and dial behavior remains unchanged.
- Focused tests, Web and package typechecks, responsive design proof, required
  ReviewGPT rounds, Claude UI review, exact-head CI, and mergeability are green.

## Scope

- In scope: Settings snapshot/row/picker wiring, persona-only picker mode,
  hosted personalization contract/handler/tool guidance, focused coverage,
  design catalog, changelog, and owner-doc alignment.
- Out of scope: Humor/Push/Detail/Unhinged Settings controls, another persona
  model, new dependencies, a generalized preferences framework, or model,
  provider, and reasoning changes.

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
   tool schema, and prompt guidance with main/supporting persona fields.
3. Delete the obsolete Settings dial dialog and replace its catalog study with
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
- Remove the Settings-only numeric-dial dialog because it is replaced and has
  no remaining production consumer; the independent chat dial owner remains.

## Verification

- Commands to run: focused Vitest files for contracts, hosted execution,
  assistant engine, Web Settings/picker/snapshot/routes, changelog, and prompt;
  touched package typechecks plus Web typecheck; frontend design proof; exact
  PR-head GitHub Actions and ReviewGPT gates.
- Expected outcomes: all focused checks pass, screenshots show usable desktop
  and mobile flows with no overflow, review findings are resolved, CI is green,
  and GitHub reports the PR mergeable.
