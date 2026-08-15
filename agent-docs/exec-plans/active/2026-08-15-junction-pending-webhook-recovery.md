# Recover pending Junction connections from confirmed webhooks

Status: active
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Let an authenticated Junction source-attributed webhook complete a matching
  pending connection when the provider confirms that exact source is active.
- Preserve the encrypted queue and existing consent, application, connection,
  source-epoch, and webhook-trace checks.

## Success criteria

- A focused regression test reproduces the current `WEBHOOK_ACCOUNT_NOT_READY`
  loop for a pending Junction connection.
- The same event confirms the connection, admits the exact source, persists the
  webhook, and schedules normal dirty work in one hosted admission flow.
- Unattributed events, inactive sources, changed credentials, withdrawn
  consent, stale source epochs, and private provider applications stay closed.
- Focused package and hosted Web tests pass on the final file state.
- Required exact-head CI and ReviewGPT gates pass on the pull request.

## Scope

- In scope:
  - Pending Junction webhook admission in `packages/device-syncd`.
  - Hosted source verification and atomic setup confirmation in `apps/web`.
  - Focused regression coverage for both owner boundaries.
- Out of scope:
  - Queue retry policy, dead-letter retention, and monitoring thresholds.
  - Automatic production deploys or dead-letter redrive.
  - The separate PlanetScale telemetry-omission alert.

## Constraints

- Technical constraints:
  - Reuse the existing `onConnectionSourceObserved` and hosted admission flow.
  - Do not accept a webhook from the pending state without provider proof.
  - Keep provider I/O outside database transactions.
  - Commit setup, source, dirty state, and trace under the existing health-data
    admission lock.
- Product/process constraints:
  - Do not drop queued health data to clear the alert.
  - Use a task worktree, focused proof, a pull request, ReviewGPT, and green CI.

## Risks and mitigations

1. Risk: A stale webhook could activate the wrong source.
   Mitigation: Treat the webhook only as a trigger. Verify the exact source live,
   then recheck its credential epoch, connection epoch, application, and status.
2. Risk: Setup confirmation could commit without webhook work.
   Mitigation: Write setup, source admission, dirty state, and trace in the same
   final locked transaction.
3. Risk: Web and queue deploy order could lose recovery coverage.
   Mitigation: Keep the queue envelope contract unchanged and deploy Web before
   redriving the dead-letter queue.

## Tasks

1. Add a package regression test for deferred pending admission.
2. Add a hosted regression test for provider-proved pending recovery.
3. Make the smallest admission and hosted persistence changes.
4. Run focused package and hosted Web proof.
5. Commit, push, open the PR, run required reviews and exact-head CI.
6. Document the safe deploy and dead-letter recovery order in the handoff.

## Decisions

- Reuse the current source-observation hook. No new service, queue, state owner,
  dependency, or background reconciliation process is needed.
- Treat an authenticated source-attributed event plus `isSourceAccessActive`
  as stronger completion proof than a missing browser callback for the same
  source epoch.
- The user approved the trust-boundary change on 2026-08-15 and asked for the
  pull request to merge without another confirmation after all gates pass.

## Verification

- Commands to run:
  - Focused `packages/device-syncd` public-ingress test.
  - Focused hosted Web device-sync wake test.
  - Real PostgreSQL signed-webhook authority test.
  - Relevant TypeScript check selected by the repository diff lane.
  - Required GitHub Actions and ReviewGPT gates on the exact PR head.
- Expected outcomes:
  - Pending recovery succeeds only with exact active-source proof.
  - Existing failure and race tests remain green.
- Completed local proof:
  - `packages/device-syncd/test/public-ingress.test.ts`: 80 passed.
  - `apps/web/test/device-sync-hosted-wake.test.ts`: 161 passed.
  - `apps/web/test/device-sync-prepared-webhook-authority-postgres.test.ts`:
    3 passed against an isolated migrated PostgreSQL database.
  - `packages/device-syncd` typecheck: passed.
  - `apps/web` typecheck: passed.
  - `pnpm docs:drift`: passed.
