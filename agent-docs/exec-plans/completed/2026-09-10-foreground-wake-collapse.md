# Collapse foreground runtime wake handling

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal and protected invariant

Admitted foreground input promptly notifies its exact runtime and outranks background maintenance. Preserve durable mailbox ownership, current access and execution authority, canonical write serialization, and exclusion of stale or concurrent writers.

## Evidence and deletion decisions

Web owns admission, Temporal owns durable recovery, Cloudflare owns the exact runtime fence, the runtime owns foreground execution, and core owns atomic writes. No new owner, process, queue, persisted state, dependency, configuration, or wire field is necessary.

- ReviewGPT architecture consultation completed with tool-verified gpt-6-pro attribution. The parent read its patch, reproduced failures against original source, applied the relevant changes, corrected two test expectations, and ran actual repository checks. This was a base-source consultation, not a final pushed-head PR audit.
- Delete trusted-direct abort/replacement of eligible system-mailbox runtimes and conversion of their accepted wakes into five-second retries. The runtime already supports conversation-driven foreground continuation within the same invocation. Preserve execution-blocked release/recheck and retention-only preemption.
- Delete the unreachable non-runtime fence branch and its live diagnostic label. Historical analytics readers still recognize retired labels.
- Delete activity-generation comparison from pointerless wake acknowledgement. Two overlapping identity-verified wakes no longer invalidate one another. Exact operation, abort, destroy, and stop checks remain; activity generation still protects idle expiry.
- Delete Linq-only and cached-checkpoint gates on the existing direct wake. Both messaging sources start it at the signal owner's validated callback. Ownership/access/cancellation checks precede the hint; webhook success still awaits durable Temporal acknowledgement.
- Forward the existing live foreground-yield predicate into raw cleanup. Bounded/preemptible cleanup uses the existing zero-timeout canonical lock attempt. Contention returns no mutation and `hasMore: true`, retaining the maintenance continuation. Unbounded offline repair retains its normal wait.
- Cleanup yields during manifest/proof reads and before starting a prepared batch. An admitted transaction remains atomic. Deadline-only interruption preserves existing bounded partial-progress behavior.
- Keep `retry_later` for unconfirmed transport, startup, and ownership. Renaming or reporting success for these outcomes would relocate recovery or misrepresent receipt.

## Product UX walkthrough

- Effort: Patch. Outcome: remove intentional foreground handoff delays around a healthy exact runtime; let maintenance yield at safe boundaries.
- Linq and Telegram, cached and reread checkpoint: authorized direct hint begins while durable signal acknowledgement is pending. Denied access, wrong mailbox owner, and cancellation cannot start a hint.
- Warm background owner and overlapping notifications: acknowledge the same exact runtime without abort/reinvoke. Existing HTTP entrypoint composition preserves a foreground wake through a subsequent system wake.
- Actual synthetic runtime journey: conversation arriving during device work in a system-mailbox invocation reaches reply delivery. Concurrent import scenarios retain canonical receipts and delivery ordering.
- Blocked child, restored policy, and retention-only child: a wake grants no provider authority. Blocked work releases before a fresh eligible owner starts; retention-only work retains exact preemption.
- Outstanding canonical writer: cleanup settles before lock release, changes no file or manifest, and resumes successfully after release. A foreign writer is preserved. Foreground during proof discards a prepared batch.
- Verdict: Ready for the scoped local patch. No presentation, assistant prompt, tool choice, context, or reply wording changed; deterministic runtime/delivery evidence covers this change without a live-model journey.

## Verification

- Before correction, all three controller cases failed: trusted direct replaced the child, while ordinary wakes returned a five-second retry. Telegram and absent-checkpoint direct hints failed. Both real held-lock deadline cases and live-yield coverage failed. The pointerless overlapping-wake regression also failed against its original guard.
- Cloudflare: runner-container suite, 235 passed; user-runner-alarm suite, 176 passed; runtime-processing responses and container entrypoint suites, 61 passed. Includes exact identity, abort/stop races, uncertain transport, cold admission, startup cleanup, retention preemption, owner-release callback, and composed HTTP wake coverage.
- Runtime: maintenance, concurrent device-import integration, and workspace-entrypoint system-preemption suites, 150 passed. Includes synthetic reply delivery, blocked-provider authority, and retained cleanup continuation across snapshot restore.
- Web: direct-wake handoff and orchestration signal-owner suites, 55 passed. Changelog page suite, ten passed.
- Core: final storage migration suite, 52 passed; canonical lock suites, nine passed. Extended proof wraps real manifest/hash reads. Removing only the precommit yield guard makes its second-candidate case fail by committing the prepared first artifact; restoring the guard passes. Total unique focused tests across the affected suites: 748 passed.
- Typechecks passed for `@murphai/core`, `@murphai/assistant-runtime`, `@murphai/cloudflare-runner`, and `@murphai/hosted-web`; core was repeated after the final source/test changes.
- `pnpm complexity:diff` passed. Controller maximum fell from 24 to 20; wake maximum fell from 74 to 73; Web handoff fell from 11 to 10. Core maximum remains 47 after removing a duplicate decision introduced in the consultation patch. Existing maintenance and evidence-validation hotspots do not justify another abstraction for this fix.
- `pnpm docs:drift` and `git diff --check` passed. Parent review covered the complete source/test diff, unchanged provider input, exact writer ownership, honest failure outcomes, live yielding, atomic commit boundaries, retained continuations, and privacy.

## Hot path and deployment limits

Existing call counts and deadlines are retained. Telegram and checkpoint-reread messages now use the same optional direct hint as Linq: at most two attempts within its existing 29-second deadline, overlapping the durable signal. No database query or provider call is added to the runtime foreground path. No provider-visible input changes for individual or group runtimes.

The reproductions prove unnecessary retries and an asynchronous cleanup deadline hole. They do not establish the cause of an observed long delay before the first HTTP notification. An accepted wake converted into a retry cannot explain its own earlier transport delay; an already-default runtime does not take the cross-mode branch. Keep this attribution gap explicit. Available production evidence does not identify the failed wake's internal reason, and a lock wait is not evidence of an event-loop stall.

No production mutation, push, PR, deployment, or rollback was performed. Response schemas, stored modes, exact fence facts, and Temporal history are unchanged. Before deployment, verify serving runtime images support in-place continuation or prove prompt owner-release convergence through the actual Temporal consumer. Deploy the capable runtime/consumer first if an older serving image lacks that behavior; current-source tests alone do not prove every deployed combination.

## Documentation, changelog, and tooling

Updated the runtime protocol owner and its index entry, plus current Cloudflare retry diagnostics documentation. Included member-visible changelog item `foreground-wake-reliability`; its source PR list is empty until a PR exists.

Reused existing Frog issue #2440 for ReviewGPT capture identity rejection. The workaround exported the exact conversation and verified assistant turn, preceding user turn, completed marker, model attribution, and artifact ownership before downloading the patch. No duplicate Frog entry was created. Review packets and synthetic command logs remain ignored, with no production rows or direct personal identifiers in committed artifacts.
Completed: 2026-09-10
