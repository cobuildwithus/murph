# Diagnostic lifecycle and expiry

## Outcome and invariants

Let an admitted operator diagnostic finish within its existing request deadline instead of restarting at a routine idle snapshot. Report expired work accurately and retain bounded attempt outcomes. Foreground work remains independent; shutdown, fence loss, and actual workspace snapshots still drain the owned child. No new queue, schema, dependency, or durable state owner.

## Owners and evidence

The detached assistant-ask controller owns the one child and its cancellation. The runtime owns idle checkpoint timing. Web owns operator task status and expiry. Existing full-runtime synthetic proof reproduced an idle checkpoint aborting an unfinished operator diagnostic without host shutdown. Existing reads return stale running status; the feedback reader already derives expiry. Attempt retry failures currently remain only in replaceable local mailbox state.

## Implementation

- Bound operator execution by the admitted expiry, expose its active deadline from the existing controller, and defer only routine idle checkpointing while that window remains.
- Preserve the existing requeue and prepare/complete terminal paths. Emit stage, outcome, elapsed time, attempt count, and bounded error code through existing runtime logs; exclude question, answer, paths, and raw errors.
- Share expiry-derived task status across ordinary Ops and feedback reads without read-time database mutations.
- Update the runtime protocol owner. No prompt or model changes.

## Product UX

Effort: Patch.
Outcome: Diagnostics complete without routine checkpoint restarts; expired requests stop displaying running.
Reaches: Ops and feedback diagnostics, concurrent foreground replies, timeout/retry, and shutdown.
Proof: Full-runtime idle-boundary regression; controller deadline/retry/log privacy tests; Web status/retention tests; existing live Sol runtime/session evidence journey.

## Verification and completion

Focused runtime and Web tests and typechecks, complexity diff, docs checks, parent review, scoped commit and PR. Runtime concurrency and Web status span owners, so final ReviewGPT is required on the stable candidate alongside CI. Deploy the runtime and Web independently: no wire or schema changes; old runtimes retain old cancellation behavior until replaced. No local production mutation or duplicate diagnostic submission is needed for proof.

## Completion evidence

- Implemented within the existing controller, checkpoint, logging, and Web status owners. No prompt, model, wire, schema, or dependency changes.
- Focused runtime tests: 54 passed with one worker. Focused Web tests: 12 passed. Runtime/Web typechecks, complexity guard, docs drift, and docs gardening passed. Earlier loaded-host polling/cleanup failures cleared in the single-worker run.
- Real-Codex diagnostic journey passed on Sol using a local subscription: one provider request, expected synthetic runtime/session evidence, canonical files unchanged, 40.61 seconds of test execution. Diagnostic effect verdict: Ready.
- Parent review completed. ReviewGPT round 1 passed on f1201abf9bba00541e7a52e440bc7ea6b6733ca8 with zero qualifying findings. Full snapshot and all 11 changed-file hashes were checked; captured response hash matches verified gpt-6-pro model evidence. Eragon lane, approximately six minutes after submission; substantive lifecycle, authority, privacy, and status review accepted.
- PR #3123 tracks final CI, merge, and rollout. This final plan closure changes documentation only and does not require another model review. Production is not yet changed by this PR.
Status: completed
Updated: 2026-09-09
Completed: 2026-09-09
