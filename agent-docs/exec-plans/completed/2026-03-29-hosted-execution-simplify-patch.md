# Hosted Execution Simplify Patch

Status: completed
Created: 2026-03-29
Updated: 2026-03-29

## Goal

Integrate the supplied `murph-simplify.patch` on top of the current dirty tree so the hosted-execution clients share duplicated requester and auth/header logic without changing behavior.

## Scope

- Remove duplicated requester-resolution logic across the hosted web control-plane client resolvers.
- Reuse the same authenticated JSON headers in the hosted execution control client.
- Flatten the no-op body/header branching in the hosted web control-plane request path.
- Clarify trust-boundary token naming from `token` to `authorizationToken` in the internal request flow.
- Add focused regression tests for proxy/direct resolution and token normalization behavior.

## Constraints

- Preserve the existing exported client pairs and current public TypeScript surface.
- Keep the patch behavior-preserving and limited to `packages/hosted-execution`.
- Do not widen into broader HTTP utility extraction or adjacent hosted runtime abstractions.

## Risks

1. The simplification touches shared hosted control-plane code used by multiple callers.
   Mitigation: keep the API shape unchanged and add focused regressions around proxy/direct resolution and token normalization.
2. Repo-wide verification is already red in unrelated active lanes.
   Mitigation: run focused hosted-execution proof first, then the required repo-wide commands and separate unrelated blockers explicitly.

## Verification Plan

- Focused verification for the touched hosted-execution surface:
  - `pnpm exec vitest run packages/hosted-execution/test/hosted-execution.test.ts --coverage.enabled=false`
- Required repo commands after integration:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Required completion-workflow audit passes via spawned subagents:
  - `simplify`
  - `task-finish-review`

## Working Notes

- The patch explicitly avoids collapsing exported client interface pairs or introducing a broader HTTP helper; preserve that narrow boundary.
- This surface already saw recent hosted trust-boundary cleanup, so port only the behavior-preserving dedupe and regression coverage.
Completed: 2026-03-29
