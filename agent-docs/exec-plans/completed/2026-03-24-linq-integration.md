# Linq Integration Plan

## Goal

Merge the Linq integration patch onto the current tree, wiring Linq into assistant delivery, inbox capture, and the onboarding/setup flow with focused regression coverage.

## Scope

- `packages/cli`: Linq runtime/env handling, assistant channel adapter wiring, inbox source registration, onboarding/setup option readiness, and generated CLI metadata alignment.
- `packages/inboxd`: export and connector plumbing for the Linq webhook connector.
- Docs: architecture/runtime/testing docs that describe supported channels and verification coverage.

## Constraints

- Preserve unrelated dirty worktree edits and merge on top of them.
- Keep the change limited to Linq support; do not reshape other channel semantics unless required for consistency.
- Refresh `packages/cli/src/incur.generated.ts` if command metadata changes.
- Run required verification commands after implementation.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
