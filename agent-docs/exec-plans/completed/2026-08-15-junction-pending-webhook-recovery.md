# Recover pending Junction connections from confirmed webhooks

Status: completed
Created: 2026-08-15
Updated: 2026-08-16

## Goal

- Let an authenticated Junction source-attributed webhook complete a matching
  pending connection when the provider confirms that exact source is active.
- Preserve the encrypted queue and existing consent, application, connection,
  source-epoch, and webhook-trace checks.

## Success criteria

- A focused regression test reproduces the current `WEBHOOK_ACCOUNT_NOT_READY`
  loop for a pending Junction connection.
- The same event confirms the connection, admits the exact source, persists the
  webhook, and schedules both callback-equivalent initial work and normal dirty
  work in one hosted admission flow.
- Unattributed events, inactive sources, changed credentials, withdrawn
  consent, stale source epochs, and private provider applications stay closed.
- Focused package and hosted Web tests pass on the final file state.
- Required exact-head CI and ReviewGPT gates pass on the pull request.

## Scope

- In scope:
  - Pending Junction webhook admission in `packages/device-syncd`.
  - Hosted source verification and atomic setup confirmation in `apps/web`.
  - Focused regression coverage for both owner boundaries.
  - Pull request merge, Web deploy confirmation, and retained DLQ redrive after
    the fixed Web version is live.
- Out of scope:
  - Queue retry policy, dead-letter retention, and monitoring thresholds.
  - Purging, copying, or decrypting dead-letter payloads.
  - The separate PlanetScale telemetry-omission alert.

## Constraints

- Technical constraints:
  - Reuse the existing `onConnectionSourceObserved` and hosted admission flow.
  - Do not accept a webhook from the pending state without provider proof.
  - Keep provider I/O outside database transactions.
  - Commit setup, source, initial mailbox work, dirty state, and trace under the
    existing health-data admission lock.
- Product/process constraints:
  - Do not drop queued health data to clear the alert.
  - Use a task worktree, focused proof, a pull request, ReviewGPT, and green CI.

## Risks and mitigations

1. Risk: A stale webhook could activate the wrong source.
   Mitigation: Treat the webhook only as a trigger. Verify the exact source live,
   then recheck its credential epoch, connection epoch, application, and status.
2. Risk: Setup confirmation could commit without webhook work.
   Mitigation: Write setup, source admission, initial mailbox work, dirty state,
   and trace in the same final locked transaction.
3. Risk: Web and queue deploy order could lose recovery coverage.
   Mitigation: Keep the queue envelope contract unchanged and deploy Web before
   redriving the dead-letter queue.
4. Risk: A callback could admit the source while a durable webhook is checking
   it, then cause that webhook to be acknowledged without its exact payload.
   Mitigation: Retry durable work when source proof changes. On replay, the
   already-admitted source follows normal persistence before trace completion.
5. Risk: Recovery could confirm the source without the source-scoped historical
   import and runtime handoff that callback completion creates.
   Mitigation: Both paths use the same transaction owner. Recovery commits the
   provider-owned initial jobs and mailbox handoff even when dirty state exists.
6. Risk: Established Junction webhooks could pay for an unnecessary recovery
   lock and provider preparation read.
   Mitigation: Shared ingress carries its transient defer decision to Web. Only
   deferred source admission enters the recovery preparation path.
7. Risk: Every post-commit Temporal signal could fail after webhook acceptance,
   leaving committed initial and dirty work asleep without another member action.
   Mitigation: The existing scheduled mailbox-handoff sweep now selects one
   exact unconsumed `device-sync.wake` per user. It retries from mailbox and
   lane-watermark truth without a new queue, ledger, scheduler, or dirty-row
   scan.

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
- Accept only explicit active Junction statuses as source proof. Ambiguous,
  missing, error, failed, inactive, revoked, and disconnected statuses retry.
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
  - `apps/web/test/device-sync-hosted-wake.test.ts`: 162 passed after final
    review remediation, including the established-source fast path.
  - `packages/device-syncd/test/junction-provider.test.ts`: 278 passed.
  - `apps/web/test/device-sync-prepared-webhook-authority-postgres.test.ts`:
    5 passed against an isolated migrated PostgreSQL database.
  - `apps/web/test/device-sync-db-spike-resilience-postgres.test.ts`: 6 passed;
    the 1,641-receipt replay retains its established-source read bounds.
  - `packages/device-syncd` typecheck: passed.
  - `apps/web` typecheck: passed.
  - `pnpm docs:drift`: passed.
  - Preliminary ReviewGPT finding accepted: ambiguous Junction source status
    was not positive proof. The provider predicate and real PostgreSQL retry
    proof now fail closed.
  - Preliminary ReviewGPT finding accepted: concurrent source admission could
    supersede live proof and terminally settle durable work before its payload
    merged. Durable work now retries, and real PostgreSQL replay proof persists
    the exact payload once before trace completion.
  - Final ReviewGPT round 1 finding accepted: source recovery could confirm
    setup without callback-equivalent initial work or a guaranteed runtime
    handoff. Recovery now reuses the callback transaction owner and the
    provider's exact source-work builder. Real PostgreSQL proves the encrypted
    initial mailbox and runtime signal persist even when dirty state exists.
  - Final ReviewGPT round 1 finding accepted: established source webhooks always
    entered an extra recovery preparation lock. Shared ingress now passes its
    transient defer decision, and established sources keep the normal two-pass
    durable admission path without a provider read.
  - Final ReviewGPT round 2 required a retrospective because post-commit
    best-effort signaling still repeated the accepted runtime-handoff failure.
    The recorded decision keeps the user outcome and reuses the existing shared
    scheduled mailbox-handoff owner. It adds `device-sync.wake` to that bounded
    unconsumed-mailbox selection instead of adding new state or a process.
  - Real PostgreSQL prepared-webhook proof now forces the first Temporal signal
    to fail, replays the same provider event through a fresh service instance,
    proves one retained mailbox row, and accepts its later scheduled handoff.
  - Real PostgreSQL shared-handoff selection proof: 3 passed, including exact
    selection of an unconsumed `device-sync.wake` row.
  - Shared handoff and hosted wake unit proof: 172 passed.
  - Assistant-runtime cold-restart proof: 1 passed, with 315 unrelated tests
    skipped by the focused name filter; the same durable `device-sync.wake`
    survives clean-state restore, bounded provider replay, and quiescence.
  - Final ReviewGPT round 3 completed a fresh full audit of exact pushed head
    `bca8329f2e4cb6ac75b7f6731c4ec03e999cb4d5` and returned
    `ROUND_OUTCOME: PASS` with no qualifying findings.
  - All required GitHub checks passed on that reviewed head. The optional Native
    iOS hosted E2E job failed before PR code ran because its new protected GitHub
    Environment has not been provisioned; it is not a required check for this PR.
  - Parent final review found no remaining correctness, liveness, ownership, or
    scope issue in the reviewed production patch.
Completed: 2026-08-16
