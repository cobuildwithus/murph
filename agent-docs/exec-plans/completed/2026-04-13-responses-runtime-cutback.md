# Responses runtime cutback

Status: completed
Created: 2026-04-13
Updated: 2026-04-13

## Goal

- Simplify the Responses-first hosted assistant runtime implementation after the driver collapse.
- Reduce internal coupling to wire-format request structures while preserving the current Responses behavior.

## Success criteria

- `assistant-engine` no longer carries a wire-shaped internal `responsesProviderOptions` surface just to express one Gateway flag.
- Responses request mutation remains the single Murph-owned place that injects auto-compaction plus Gateway request policy.
- OpenAI-compatible provider option handling is simpler and still preserves `store: false`, `previousResponseId`, and reasoning effort on the Responses path.
- Existing behavior and verification stay green.

## Scope

- In scope:
  - `packages/assistant-engine/**` production code and tests for the Responses request policy seam.
  - `packages/operator-config/**` runtime-target cutbacks directly related to the Responses-first hosted runtime.
  - Small downstream test adjustments if they reference renamed internal surfaces.
- Out of scope:
  - Product behavior changes.
  - Reopening the execution-driver architecture that was just collapsed.
  - Hosted telemetry / Cloudflare runner work already tracked in a separate active plan.

## Constraints

- Preserve direct OpenAI Responses behavior.
- Preserve Vercel Gateway zero-data-retention injection on the Responses path.
- Keep unrelated active worktree edits untouched.

## Risks and mitigations

1. Risk: The cutback could accidentally drop Gateway request metadata from Vercel Responses calls.
   Mitigation: Keep the behavior covered with request-body mutation tests and end-to-end provider execution tests.

2. Risk: Renaming the internal seam could spill into unrelated public contracts.
   Mitigation: Limit the change to `assistant-engine` internals and update only directly affected tests.

3. Risk: Runtime-target cleanup in `operator-config` could accidentally change supported capability flags for Gateway presets.
   Mitigation: Keep the change behavior-preserving and verify it through the diff-aware owner/reverse-dependent test lane.

## Tasks

1. Replace the wire-shaped internal Responses provider-options seam with a smaller Murph-owned request-policy seam.
2. Simplify the Responses request mutation and provider-option branching around that seam.
3. Update tests and rerun truthful verification.

## Decisions

- The model spec should carry Murph-owned request policy, not a partial mirror of provider wire format.
- Preset runtime behavior should read as declarative preset data plus a small Gateway-specific overlay for model-dependent capability flags.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:diff packages/operator-config packages/assistant-engine`
- Expected outcomes:
  - Diff-aware coverage passes for `packages/operator-config`, `packages/assistant-engine`, and affected reverse dependents.
Completed: 2026-04-13
