# Remove hosted execution outbox transport status column

Status: completed
Created: 2026-04-16
Updated: 2026-04-16

## Goal

- Remove the obsolete `ExecutionOutbox.status` transport column from the hosted web outbox so the persisted model reflects the final hosted boundary and the runtime relies only on lifecycle state plus claim/retry fields.

## Success criteria

- Prisma schema and migrations no longer define `ExecutionOutboxStatus` or `ExecutionOutbox.status`.
- Hosted execution outbox runtime logic continues to claim, retry, finalize, and prune rows using remaining fields without transport-status bookkeeping.
- Affected route/test fixtures stop referencing the removed column and verification passes or any unrelated blockers are documented truthfully.
- A patch containing only this cleanup lane is ready for handoff.

## Scope

- In scope:
- `apps/web/prisma/**` updates needed to remove the column safely.
- `apps/web/src/lib/hosted-execution/**` runtime updates that currently depend on transport status.
- `apps/web` tests and docs/fixtures that still reference the removed column.
- Out of scope:
- Unrelated hosted callback/device-sync fixes already landed in the prior cleanup commit.
- Broader hosted delivery journal or Cloudflare runtime refactors already owned by other active lanes.

## Constraints

- Technical constraints:
- Preserve existing retry/claim semantics without introducing a new transport-status replacement column.
- Do not disturb unrelated dirty worktree changes in other hosted-runtime and assistant-engine lanes.
- Product/process constraints:
- Keep the cleanup inside the hosted web boundary and return a patch rather than a new commit.
- Send an autosubmitted Pro review request before handoff and note that review thread for follow-up.

## Risks and mitigations

1. Risk: Removing the column can subtly break claim/retry/prune behavior if transport-state assumptions are still embedded in query filters.
   Mitigation: Rewrite selection helpers around `dispatchState`, retry timestamps, and claim expiry, then cover the changed behavior with targeted `apps/web` tests.
2. Risk: Schema cleanup can overlap other active hosted lanes.
   Mitigation: Keep edits constrained to `apps/web` outbox files, a dedicated migration, and directly affected tests/fixtures only.

## Tasks

1. Register the cleanup lane in the active coordination ledger and confirm the Pro review request was autosent.
2. Remove `ExecutionOutbox.status` from Prisma schema/migrations and update outbox runtime logic to stop reading or writing transport status.
3. Update affected `apps/web` route/tests/fixtures, run truthful verification, and produce a scoped patch.

## Decisions

- Return this work as a patch instead of committing so the larger schema cleanup can be reviewed as a follow-on change set.
- Treat `dispatchState`, `nextAttemptAt`, and claim fields as the remaining source of truth for delivery progression.

## Verification

- Commands to run:
- `pnpm --dir apps/web test -- --runInBand hosted-execution-outbox hosted-execution-routes hosted-share-service hosted-onboarding-activation-progress`
- `pnpm --dir apps/web prisma generate`
- `pnpm --dir apps/web typecheck`
- Expected outcomes:
- Targeted `apps/web` tests cover the removed column without regressions.
- Prisma client generation and web typecheck succeed, or any unrelated pre-existing blocker is called out explicitly.
Completed: 2026-04-16
