Goal (incl. success criteria):
- Get the repository verification path and hosted-local E2E suite green for the current checkout.
- Success means the canonical acceptance check and hosted-local E2E command complete successfully, with any needed fixes scoped to current failures.

Constraints/Assumptions:
- Preserve unrelated dirty working-tree edits and existing active lanes.
- Do not expose secrets, raw identifiers, message contents, local paths, or private payloads in committed artifacts.
- Treat hosted runner egress/logging changes as sensitive; keep diagnostics metadata-only and secret-safe.

Key decisions:
- Start from observed failing checks, then widen to acceptance and hosted-local E2E once blockers are fixed.

State:
- Complete. Repo acceptance, Cloudflare verification, and explicit hosted-local E2E are green after fixing dirty runtime idle-checkpoint starvation.

Done:
- Fixed the Cloudflare typecheck blocker in hosted egress diagnostic work without reverting existing edits.
- Focused hosted egress and hosted runtime-control checks passed.
- `pnpm verify:acceptance` passed.
- `pnpm hosted-local e2e` failed with two sanitized blockers:
  - Linq first-contact duplicate-welcome follow-up did not observe the expected direct reply send before timeout.
  - Idle checkpoint deferred progress stayed in-flight while durable conversation mailbox lag remained one item behind.
- Diagnosed the hosted-local idle hang as dirty runtime idle-checkpoint starvation: repeated no-progress runtime wakes reset the relative idle checkpoint wait, so hot dirty mailbox state could remain uncommitted.
- Changed hosted runtime dirty waiting to use an absolute idle checkpoint deadline that only resets after new dirty runtime work.
- Added a unit regression proving no-progress runtime wakes do not postpone `idle_shutdown`.
- Kept post-checkpoint pending wake drain from starting more hot work once the host checkpoint deadline is due.
- Added a unit regression proving pending wake drain is skipped after a host-deadline checkpoint.
- Strengthened the idle checkpoint deferred-progress E2E proof to require durable committed mailbox progress and the idle-shutdown snapshot log; foreground deferred import evidence is only accepted while the workspace version is still unchanged.
- Updated the hosted environment policy test fixture to include the required log fingerprint secret.
- Required completion audits passed: simplify, security/privacy, coverage-write, and task-finish review.
- Focused hosted-local E2Es passed for idle checkpoint deferred progress and Linq first-contact.
- Full `pnpm hosted-local e2e` passed.
- Focused Murph Age CLI product-mode report regression passed after acceptance exposed the existing dirty-worktree blocker.
- Final `pnpm verify:acceptance` passed.

Now:
- Closing the scoped plan and committing the hosted-runtime verification fix.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `apps/cloudflare/test/hosted-local-idle-checkpoint-deferred-progress-e2e.test.ts`
- `apps/cloudflare/test/hosted-env-policy.test.ts`
- `pnpm verify:acceptance`
- `pnpm hosted-local e2e`
- `pnpm --dir apps/cloudflare verify`
- `pnpm --dir apps/cloudflare typecheck`
Status: completed
Updated: 2026-05-19
Completed: 2026-05-19
