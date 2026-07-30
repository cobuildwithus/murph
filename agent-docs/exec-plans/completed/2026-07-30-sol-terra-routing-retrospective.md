# Sol/Terra routing retrospective correction

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Preserve exact hosted usage pricing and the foreground reply invariant by
  deferring cross-model child routing until Codex emits authoritative child
  model evidence in the existing activity protocol.

## Success criteria

- Hosted production and shell-smoke configs no longer expose per-spawn model
  overrides or instruct Sol roots to route leaves to Terra.
- The runtime performs no child `thread/resume` lookup for usage attribution.
- A V2 `subAgentActivity` model field, when present, is consumed as direct
  effective-model evidence; absent evidence safely inherits the parent model.
- Focused config, runtime, usage, pricing, and typecheck proof passes; exact-head
  CI and the existing PR ReviewGPT correction loop finish cleanly.

## Scope

- In scope: deletion of cross-model hosted routing configuration, lookup and
  raw-call inference code, focused tests, and correction of the existing PR
  intent and verification claims.
- Out of scope: a new accounting owner, deferred settlement lifecycle, timeout,
  retry, pending-promise map, persisted attribution state, or Codex upgrade.

## Decisions

- Exact pricing is a shipping requirement. Conservative Sol overcount for a
  routed Terra child is not an accepted product behavior.
- Cross-model routing remains disabled until the child activity itself carries
  the effective model or another existing authoritative off-path owner can
  settle it before the immutable usage write.
- Same-model detached children remain supported and inherit the parent model
  when the current protocol omits child model evidence.

## Tasks

1. Delete hosted cross-model routing exposure and guidance.
2. Delete the foreground-adjacent lookup and non-authoritative raw-call join.
3. Parse optional V2 activity model evidence and add ordering-independent proof.
4. Run focused verification, update the PR, and complete correction review and
   exact-head CI.

## Verification

- Passed: assistant-engine focused Vitest, 250 tests.
- Passed: assistant-runtime hosted Codex config Vitest, 42 tests with 2 skipped.
- Passed: Cloudflare container-entrypoint Vitest, 50 tests.
- Passed: hosted allowance-pricing Vitest, 104 tests.
- Passed: assistant-engine, assistant-runtime, and Cloudflare runner typechecks.
- Passed: ReviewGPT correction-verification round 3 with no findings.
- Passed: parent final source, test, privacy, scope, and mergeability review.
- Pending after plan closure: exact-head CI on the final docs-only commit.

## Outcome

- Cross-model child routing is deferred. The hosted production and smoke configs
  match their pre-PR behavior, the racy lookup and raw requested-model inference
  are deleted, and only direct optional V2 activity model evidence can override
  the parent fallback.
Completed: 2026-07-30
