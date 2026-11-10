# Preserve device retry history across hosted cold restore

Status: completed
Created: 2026-11-10

## Goal and decisions

Preserve the device queue's existing retry timing and remaining budget across
hosted cold restore. The queue owns policy; the encrypted runner mailbox journal
owns recovery. Remaining budget cannot reconstruct consumed attempts, so add one
optional `attempts` integer to the existing hint. Keep wire `maxAttempts` as
remaining budget; restore the local ceiling as consumed plus remaining.

Web and Worker share admission-wake parsers, but retained continuations are
written and restored inside the runner checkpoint. Extend the reader before
emitting the field. Old readers drop unknown fields and preserve today's budget
and absolute deadline. No table, queue, flag, migration, new I/O or lane guard.

## Product UX

Outcome: repeated background failures keep the established backoff after restore.
Reaches: ordinary transport retries, retained sparse jobs and leased handoff.
Proof: compare warm and repeated-cold timing, legacy hints, exhaustion and replay.
Foreground replies, typing, standby capacity and the foreground idle window stay
on their existing paths.

## Work and verification

1. Prove the reset with a focused warm/cold regression.
2. Extend the hint reader and existing enqueue boundary; update owner docs.
3. Run focused package tests, typechecks and complexity; review the full diff.
4. Close the plan, commit with the requested trailer, push, open a draft PR,
   verify exact head, mark ready and run required CI and final ReviewGPT.
5. Report evidence and blockers; do not merge or deploy.

## Implementation and local result

The hint parser and normalizer preserve a non-negative safe integer `attempts`.
The existing queue insert seeds that counter; the runner converts remaining
budget to a total ceiling. Simplified the existing conversion call rather than
adding another recovery owner. Retry policy and retention classification are
unchanged. The shared five-attempt default is exported from the existing types
entrypoint so restore and queue insertion keep one default.

Base proof: ordinary transport, retained sparse and leased handoff all failed
with restored attempts 1 versus warm attempts 2. Current proof compares failures
1 through 6 and the capped slot, rejects early claims, preserves remaining
budget and terminalizes ordinary work at the same count. Legacy hints still
reset timing and exhaust at that count. Existing validation and expired-final-
lease tests prove their separate behavior remains intact.

Passed focused suites: assistant-runtime hosted device runtime (170 tests),
device-syncd hosted-runtime/config/store/service (421 tests). Commands:
`pnpm exec vitest run <named test paths> --no-coverage --silent` from the root;
`pnpm --filter @murphai/device-syncd --filter @murphai/assistant-runtime typecheck`;
`pnpm complexity:diff`; `git diff --check`.
The suite first identified expectations that still encoded reset counters;
those now assert lifetime counters and unchanged remaining budget. Both
package typechecks pass. Complexity debt and maxima are unchanged.

A temporary Vitest proof loaded the actual hint parser from base 25632e26fa:
old/new, old/old, new/old and new/new shapes all passed; the old reader drops
only the additive history while preserving the legacy deadline and budget.
The temporary proof and copied reader were removed after execution.

Product UX: Ready. No conversation or provider-input code changes, new awaited
work, foreground idle/standby changes or production access. No public changelog:
this repairs internal retry scheduling without changing the data contract.

## Delivery boundary

Runner image only. The new runner reads both shapes before writing history;
Web/Worker admission parsers share the additive definition but do not process
runner checkpoint continuations. Mixed runner versions remain readable; an old
runner loses history exactly as before and keeps the same remaining budget.
Roll forward with the fixed image to preserve history from the next failure;
previously lost history cannot be recovered. No migration or hard rollback floor.
No deployment or merge is authorized. Exact-head CI and final ReviewGPT evidence
will be recorded on the PR after push, not claimed by this local execution record.
Updated: 2026-11-10
Completed: 2026-11-10
