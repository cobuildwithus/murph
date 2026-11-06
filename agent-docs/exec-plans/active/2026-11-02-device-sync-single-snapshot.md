# Device sync idle shutdown publishes one snapshot

Status: blocked on required local commit; implementation verified
Created: 2026-11-02
Updated: 2026-11-02

## Goal and protected invariant

Publish one idle snapshot for a completed device pass, including zero dirty acks.
Web may acknowledge payloads only after their canonical work and replay record
are durable. Crashes must retain replayable receipts and continuation ownership.

## Evidence and implementation

The system-work completion effect unconditionally requested a follow-up save;
system-mailbox retirement also unconditionally dirtied the runtime. Recording
changes the portable hosted-system-mailbox.json pending item even with no dirty
ack: it clears the post-checkpoint record, retains a continuation/completion
fence with a retry time, or removes the item and covered hints.

Successful fresh device recording now declares its cleanup replayable. Both
runtime modes retain the first archive and publish final wake/progress through
the existing metadata checkpoint. No persisted schema or dependency changed.
Restored device effects use the existing ready checkpoint-effect queue, preserve
foreground/projection priority, and combine cleanup with the next bounded pass
before one idle save. Completion wakes remain qualified before canceling that
save. No device work restarts after checkpointing.

A durable completion-only fence can replay cadence publication using the existing
connection epoch/version checks and monotonic update. This avoids endlessly
restoring the same completed fence. Future jobs and yielded work retain their
existing admission requirements. Failed acknowledgement/projection and genuinely
new mailbox input still require saves.

The observed 100-job pass consumed 237.817 seconds, below the 300-second budget.
The exact drainWorker limit is 100. Keep that bound: no demonstrated safe reason
to increase one invocation's work or add a post-checkpoint restart.

## Proof and review

Nine real-pass regression cases fail on the original source with two snapshots
instead of one. Nine cases pass with the fix: both runtime modes, staged/zero dirty
acks, crash before/after acknowledgement, durable canonical data, no provider
re-import, final metadata retaining the first archive, and settled later restore.
The ninth case proves two passes with a cold restore between them publish two
snapshots: cleanup must not add an empty recovery invocation or extra archive.
Existing tests preserve foreground priority, projection cancellation/backoff,
receipt preservation, and bounded wake/replay behavior. Tests that injected a
wake into the deleted snapshot now target restore or the cleanup checkpoint.

Final full hosted-runtime/hosted-device-sync-runtime run: 145 suites passed;
3,377 tests passed and six skipped. All nine new regressions pass.
Cloudflare hosted-workspace-invocation: 14 passed.
Assistant-runtime build and typecheck passed. Complexity diff against origin/main
passed with authored hosted-runtime complexity debt reduced by one. The prepared
runtime dependency build also passed. Source change: 106 added, 24 deleted,
net +82 lines across three files. `git diff --check` and the authored-content
privacy scan passed.

Parent review: no production reads or mutations, no secrets/private rows in
fixtures, and no unrelated edits. Internal checkpoint storage/CPU reduction has
no member-facing product copy or new assistant decision; no changelog entry or
real-Codex prompt journey is needed. Device-syncd code is unchanged.

## Completion boundary

Local commit only through scripts/committer; no push, PR, deployment, or other
checkout changes. External PR review/CI is outside the requested local scope.
The dependency install populated dependencies but its prepare hook failed with
`worktree storage guard: current worktree bypassed scripts/create-worktree`.
After all checks passed, the scoped `scripts/committer` attempt exited 1 at
that same guard. No commit was created; the requested co-author footer was in
the attempted message. Implementation and verification are complete, but local
commit remains blocked. The guard was not bypassed or modified. Keep this plan
active until the required commit can be completed.
