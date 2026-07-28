# PR 936 current-main conflict resolution

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Reconcile PR #936 with the latest `origin/main` without weakening the
  receipt-anchored 14-day inbound-message content retirement or dropping the
  Assistant Ask and migration-inventory behavior newly merged to `main`.

## Success criteria

- The branch contains a normal merge of current `origin/main`.
- The three observed conflicts preserve both branches' durable rules and
  migration entries without adding state, compatibility machinery, or a new
  runtime owner.
- The retention rollout documentation agrees with the actual five-signal
  hourly owner.
- Focused conflict-path verification and the canonical diff-aware lane pass.
- The final scoped commit is pushed, CI is green, the PR is conflict-free, and
  the manual resolution delta receives the required next exact-head ReviewGPT
  correction-verification `ROUND_OUTCOME: PASS`.

## Scope

- In scope:
  - `agent-docs/RELIABILITY.md`
  - `agent-docs/SECURITY.md`
  - `apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
  - Merge-generated updates from `origin/main`, this plan, its exact ledger
    row, PR metadata, verification, CI, and ReviewGPT evidence.
- Out of scope:
  - New retention behavior, state owners, migrations, dispatchers, queues, or
    unrelated cleanup.
  - Reopening previously accepted ReviewGPT corrections except where the new
    merge directly affects them.

## Constraints

- Preserve one receipt owner, the existing workspace checkpoint CAS, and the
  existing hourly retention wake.
- Resolve each conflict from both code paths and current tests; do not choose
  either side wholesale.
- Preserve unrelated working-tree and coordination-ledger work.
- Keep the existing PR open; this task updates its branch but does not merge
  the PR.

## Risks and mitigations

1. Risk: A doc-side resolution could silently drop either retention or
   Assistant Ask reliability/security requirements.
   Mitigation: combine the non-overlapping owner rules and read back both
   clauses after the merge.
2. Risk: The migration inventory could omit a migration from either branch.
   Mitigation: retain every chronologically ordered entry and run the focused
   inventory test.
3. Risk: A conflict-free textual merge could still disturb a shared runtime
   boundary changed by incoming `main`.
   Mitigation: run diff-aware canonical verification, CI, and an exact-head
   ReviewGPT correction round scoped to the merge-resolution delta.

## Tasks

1. Inspect both sides of every conflict and the incoming owner-level changes.
2. Merge current `origin/main` normally and resolve the three conflicts with
   the smallest combined result.
3. Run focused migration/readback checks and canonical diff-aware verification.
4. Perform the parent final review, privacy scan, and diff-shape check.
5. Close this plan and commit through `scripts/finish-task`, push, and refresh
   PR metadata.
6. Run CI and the next ReviewGPT correction-verification round concurrently;
   resolve only accepted findings and finish with a conflict-free PR.

## Decisions

- Use a normal merge rather than rewriting the already-reviewed branch
  history.
- Keep both branches' adjacent durable rules and migration entries.
- Correct the stale rollout sentence from 25 to five signals per successful
  hourly run because the production owner exports a batch size of five and
  the live deployment runbook already uses that value.

## Verification

- Manual remerge review confirmed that the resolution:
  - preserves the incoming Assistant Ask reliability and authorization rules,
  - preserves the inbound-retention terminality and security rules,
  - corrects the retention signal capacity to five snapshots per successful
    hourly run, and
  - retains the retention, paid-usage, growth-aggregate, and thread-container
    migrations in timestamp order.
- The Web prepared lane passed after its wrapper expanded the requested focused
  filter to the full app surface: 530 files and 6,748 tests passed, with 14
  files and 177 tests skipped.
- Canonical
  `pnpm test:diff agent-docs/RELIABILITY.md agent-docs/SECURITY.md apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
  passed locally. It covered repository syntax, Temporal, crypto, logging,
  dependency, and package-boundary guards; Web TypeScript; the same 530-file,
  6,748-test suite; lint with no errors; dev smoke; and the production Next.js
  build.
- `git diff --check`, merge-parent shape, and conflict-marker readback passed.
- A final four-commit `origin/main` advance changed only Cloudflare deploy-smoke
  timeout ownership and merged cleanly with no task-specific resolution.
- Remaining exact-head gates after plan closeout and push: current-base
  conflict proof, CI, and the next ReviewGPT correction-verification round.
Completed: 2026-07-26
