# PR 992 post-round-7 latest-base reconciliation

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Reconcile the round-7-remediated PR #992 branch with the newest `main` after
  additional merged work made the PR conflicting again.

## Success criteria

- Incorporate current `origin/main` through an ordinary merge without losing
  either the referral/completion corrections or newer base behavior.
- Resolve each textual conflict from the owning invariants and adjacent
  code-path evidence.
- Run conflict-specific tests and typechecks, commit and push the merge, and
  leave PR #992 conflict-free on the final exact head.

## Scope

- In scope: the newest base merge, manual conflict resolution, directly affected
  verification, exact-head push, and PR metadata reconciliation.
- Out of scope: unrelated Setup CLI repair, new feature work, deployment, or a
  new ReviewGPT round without explicit authorization.

## Constraints

- Preserve the round-7 transport-idempotency gate and existing mailbox/outbox
  ownership.
- Preserve newer base privacy, billing, checkout, and runtime behavior.
- Keep the immutable ReviewGPT baseline and round lineage unchanged.

## Tasks

1. Merge current `origin/main` and inspect every conflict and auto-merged overlap.
2. Run conflict-specific proof and typechecks.
3. Close this plan, push the exact head, and update PR #992.

## Verification

- `git diff --name-only --diff-filter=U` — passed; no unresolved paths.
- `git diff --cached --check` and repository conflict-marker scan — passed
  before the merge commit.
- `pnpm --filter @murphai/assistant-runtime typecheck` — passed.
- `pnpm --filter @murphai/hosted-web typecheck` — passed.
- Focused Assistant Runtime merge seam — 523 tests passed across workspace
  assistant phase, entrypoint, and group-tool Linq context.
- Focused Web merge seam — 387 tests passed and 13 environment-gated tests
  skipped across account deletion, group tools, Linq routing, usage-credit
  settlement/reconciliation, and migration guards.
- `pnpm --filter @murphai/assistant-runtime build` — passed; this supplied the
  ignored runtime `dist` artifact required by the hosted-local harness.
- `pnpm --filter @murphai/hosted-local-harness test` — 410 passed, 1 skipped.
- Canonical `pnpm test:diff -- <all 79 PR paths>` — passed on the exact merged
  head:
  - all affected package/app typechecks passed;
  - Assistant Engine 2,752 passed, 7 skipped;
  - Assistant Runtime 1,917 passed, 2 skipped;
  - CLI 1,083 passed, 1 skipped;
  - hosted-local harness 410 passed, 1 skipped;
  - hosted execution 420 passed;
  - Setup CLI 124 passed;
  - Web 6,942 passed, 195 skipped, lint 0 errors/13 warnings, dev smoke passed,
    and the production build completed;
  - Cloudflare Node 2,013 passed and Workers 2 passed.

## Decisions

- The aggregate acceptance gate's isolated Setup CLI Venice wizard failure is
  outside this branch: `packages/setup-cli` has no PR diff, and the exact
  isolated coverage test reproduces the same selection mismatch. It is recorded
  as an unrelated base blocker rather than widened into this runtime fix.
- The ordinary merge produced four textual conflicts: the architecture owner
  summary, two documentation indexes, and one PostgreSQL concurrency test.
  Each was additive. The resolution preserves both the referral/generic-credit
  model and current `main`'s saved-card PaymentIntent and detached-payment
  behavior.
- Auto-merged source seams were compared against both parents. The round-7
  transport-idempotency filter and deferred outbox wake remain intact, while
  current `main`'s SMS participant context, subscription checkout lifecycle,
  privacy deletion, and saved-card funding behavior are retained.
- The first explicit-path `test:diff` attempt reached the hosted-local harness
  without its required ignored Assistant Runtime build artifact and failed at
  that shared precondition. Building the package made the focused harness pass,
  and the complete explicit-path canonical rerun then passed without a source
  change.
Completed: 2026-07-27
