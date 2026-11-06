# Coalesce retention work within one hosted invocation

Status: completed
Created: 2026-11-03
Updated: 2026-11-03

## Outcome and invariant

Reduce repeated restore/checkpoint invocations for clustered content expiries.
Delete only eligible content, preserve protected inputs and exact deadlines,
and retain failed or interrupted work for retry. Internal execution change;
no assistant prompt, provider input, or visible reply change.

## Owner and root cause

Inboxd owns atomic media/text retirement; idle maintenance merges all content
deadlines; the retention-only entrypoint checkpoints after one pass. The Web
batch of five selects workspaces, not attachments. Inboxd's 100-attachment and
200-capture transaction slices return immediate continuations; future exact
expiries also return through a new invocation. Prove both with real snapshots
and retention owners before editing production code.

## Design and boundaries

Reuse the existing wakeable runtime wait and configured idle duration as a
fixed invocation budget. Drain due slices and nearby exact expiries before
one checkpoint. Do not round deadlines later: the internal contract specifies
14-day content/audio, 30-day video and 90-day image windows without an explicit
coalescing grace. Preserve actual canonical receipt capacity and interruption.
Keep the processing mode and Web column: they authorize inactive-member cleanup
without assistant admission, preserve independent default wakes, and support
old persisted deadlines. Deleting them needs a replacement admission/scheduling
contract across Web, orchestration, Worker and runner, with a staged drain.

Only the runner image should change. Existing Web/Worker requests, old snapshot
shapes and exact wake timestamps must remain compatible. No schema or migration.
Keep the current worktree; local commit only via scripts/committer; no push,
PR, deployment, or external review that requires a pushed PR.

## Tasks and proof

1. Add fail-before burst and multi-batch snapshot regressions.
2. Make the smallest entrypoint change; test foreground preemption, shutdown,
   failure retry, unexpired bytes, and bounded continuation.
3. Run assistant-runtime, inboxd, Web and Cloudflare retention suites, touched
   package typecheck, complexity diff against origin/main, and docs drift.
4. Review full diff and privacy; update the runtime owner doc; close this plan
   and commit with the requested co-author trailer.

## Evidence

- Before production edits, the real-snapshot burst regression failed with six
  invocations instead of one; 205 overdue attachments failed with three instead
  of one. Both pass afterward with one snapshot/invocation. Future bytes are
  checked before each timer advance and at snapshot publication.
- The ten new entrypoint cases also cover fixed-window exhaustion, the earlier
  independent assistant wake, foreground/shutdown/abort interruption, failed
  cleanup followed by successful retry, failed snapshot followed by replay,
  and the real generated-image canonical receipt boundary with continuation.
- Final assistant-runtime selection: 142 tests passed across the new wake-loop,
  idle-maintenance, entrypoint-retention, entrypoint-receipts and pending-input
  index suites. Inboxd media/text retention: 42 passed. Web cleanup, owner split,
  cron route and workspace-store: 47 passed. Cloudflare runtime-processing,
  runner-container and container-identity: 418 passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
  `pnpm complexity:diff --base origin/main` passed: debt remains 420, maximum
  remains 186; the changed retention function stays at the threshold of 20.
  `pnpm docs:drift` and `git diff --check` passed.
- Removed the duplicate retention-only wake selector, a redundant wake-field
  check, and terminal local receipt-counter clearing. Reused the normal idle
  wake selector and existing timer. Production source: 89 added / 88 deleted,
  net +1 line (38 / 37 ignoring indentation changes). No new persisted state,
  dependency, protocol, scheduler, or processing mode.
- Parent review: expiry checks stay with the existing owners; the fixed window
  does not slide; foreground interruption, shutdown, failure retry, canonical
  receipt capacity, default wake ownership and old snapshot compatibility have
  executable coverage. No provider or prompt changes; no live-model run needed.
- Product UX: Ready; internal invocation/snapshot reduction only, with unchanged
  deletion eligibility, protected content and default assistant work. No public
  changelog is needed for this internal execution optimization.
- Expected reduction in the reproduced cases: six to one (83%) for clustered
  expiries and three to one (67%) for the overdue batch. Production reduction
  depends on expiry clustering, independent default wakes, interruptions and
  receipt capacity. The runner can remain resident within its existing ten-minute
  window instead of restoring and snapshotting each item separately.
- Deployment: runner image only, through the normal Worker/container image
  rollout; drain old warm runners. Unchanged Web/Worker requests and persisted
  wake timestamps interoperate in either order. No migration or rearm; rollback
  restores the old invocation frequency without changing retention correctness.
  Mode/column removal remains deferred for the admission and skew reasons above.
- Local-only authorization excludes push, PR, CI, deployment, and the final
  ReviewGPT workflow that requires a pushed PR. Parent review completed locally.
  No new repository friction entry was needed; dependency/client preparation
  used documented commands.
Completed: 2026-11-03
