Murph correctness lane: fence in-flight device-sync jobs so disconnect prevents later token refresh, imports, success transitions, and follow-up enqueueing.

Ownership:
- Own `packages/device-syncd/src/{service.ts,store.ts,types.ts}`.
- Own direct regression coverage in `packages/device-syncd/test/service.test.ts`.
- You may touch directly related helpers only if the disconnect fence requires a minimal dependency.
- This lane is adjacent to other active `device-syncd` work. Read the live file state first, preserve unrelated edits, and do not revert anything you did not author.
- Do not edit outside that scope unless a direct, minimal dependency is unavoidable. If scope changes, update your ledger row first.
- Work in the shared current worktree.
- Do not create commits.

Required repo workflow for this lane:
- Read `AGENTS.md`, `agent-docs/operations/completion-workflow.md`, and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before editing.
- Implement the fix, add or adjust direct coverage, run the narrowest truthful verification for your owned surface, and report any remaining gaps.
- The parent lane will run the final repo-level audit passes and commit after collecting worker results.

Issue:
- `packages/device-syncd/src/service.ts` `disconnectAccount()` marks queued/running jobs dead and then flips the account to `disconnected`.
- `runWorkerOnce()` does not re-check job/account state after the provider call starts.
- Current failure window:
  - worker claims a job and decrypts tokens
  - user disconnects the account
  - disconnect marks queued/running jobs dead and sets account status to `disconnected`
  - the already-running worker still continues and may:
    - refresh/store new tokens on the disconnected account
    - import provider data into the vault
    - mark the job `succeeded` after it was already marked dead
    - enqueue follow-up jobs
    - call `markSyncSucceeded(...)`

Best concrete fix:
- Introduce a cancellation/fencing mechanism tied to account state or account generation/version.
- Good designs include:
  - an account generation/disconnect epoch captured when the job starts and re-checked before any post-provider mutation
  - conditional `completeJob()` / token update / success writes that only apply when the job is still the active running row and the account is still active on the same generation
- The invariant that must hold after disconnect commits:
  - no in-flight worker may refresh/store tokens
  - no in-flight worker may import new snapshots
  - no in-flight worker may mark the job succeeded
  - no in-flight worker may enqueue follow-up jobs

Tests to anchor:
- `packages/device-syncd/test/service.test.ts`

Specific regression proof requested:
- add a regression test with a fake provider job blocked on a promise/latch
- start the job, disconnect the account while the provider call is in flight, then release the job
- assert:
  - importer was not called
  - token update was not persisted
  - the job stayed dead/cancelled rather than succeeded
  - no follow-up jobs were enqueued
  - the account remained disconnected

Report back with:
- files changed
- behavior-level summary
- exact verification commands and results
- any direct scenario proof or remaining gap
