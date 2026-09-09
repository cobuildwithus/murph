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

## Progress

- Investigation and synthetic checkpoint cancellation reproduction completed before implementation.
- Implemented deadline-bound execution, routine checkpoint deferral, shared expiry status, and bounded attempt logging.
- New lifecycle, deadline, and log-parser/privacy assertions passed; Web focused tests (12), runtime/Web typechecks, complexity guard, and docs drift passed.
- A loaded-host runtime run hit existing polling/cleanup failures; focused rerun and docs gardening are pending. Live Sol proof, exact-head CI, and final ReviewGPT remain completion gates.
