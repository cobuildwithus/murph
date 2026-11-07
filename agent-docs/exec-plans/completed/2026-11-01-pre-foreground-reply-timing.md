# Attribute pre-foreground reply planning time

Status: completed
Created: 2026-11-01
Updated: 2026-11-01

## Goal

Attribute an observed post-automation/pre-foreground delivery interval through
existing runtime diagnostics. Preserve operation order, authority, timing anchors,
typing order, thresholds, failure handling and all external effects.

## Evidence and owner

Passive timing evidence isolates an unmeasured interval after automation returns.
The existing workspace assistant phase owns device follow-up wake projection,
mailbox next-wake projection and provider cleanup planning in that interval.
No specific operation is yet a proven bottleneck or removable work. Extend that
owner's queued foreground milestone with fixed numeric child durations; keep
runtime-only reader validation in the current timing reader. Do not add state,
network calls, generic profiling, new stages or performance policy.

## Scope and constraints

- Six optional monotonic durations: total, prelude, device wake projection,
  nested maintenance module load, system mailbox projection and cleanup plan.
- Existing retained rows and log buffering remain the only diagnostic owner.
- No private content or new identifiers. No model calls, runtime wakes, replay,
  synthetic customer sends, protected inspection, billing or access changes.
- Old rows remain sparse; old readers may drop optional fields. Coordinate
  reader-first deployment and validate natural traffic only after release.
- No member-visible behavior or initial provider input changes; no changelog or
  live assistant journey applies. Required independent non-Claude review remains.

## Tasks

1. Verify owners, guarded isolation and current source. Complete.
2. Implement fixed timing attribution and synthetic composed boundary tests. Complete.
3. Focused tests/typecheck, complexity and candidate review passed; PR #4426 is Ready.
4. Independent ReviewGPT and native final review passed; final-head CI remains a merge gate.
5. Follow-up after final-head CI: coordinate merge/release, then qualify fields on natural traffic. The PR/task retains this verification boundary.

## Verification

Prove injected synthetic durations survive the existing log queue with exact
operation count/order and unchanged wake/cleanup results. Cover absent config,
module-load failure, invalid numeric metadata and legacy sparse records. Keep
blocked info-log I/O from blocking foreground work. Measure bounded observer
cost without changing production timing. CI owns required aggregate checks.

## Risks and decisions

The device module timing is nested, so it is never added to its parent. Total
starts after the most recent automation lane returns; it does not replace the
existing automation-finished milestone. Errors retain existing handling and no
new stage is emitted when foreground delivery never starts. These diagnostics
prove attribution only, not an improvement or historical recovery.

## Candidate evidence

- Six focused runtime suites: 212 tests passed (foreground, device sync,
  diagnostics, new attribution, timing reader and existing log queue).
- Final request-parser compatibility addition: all 4 attribution tests passed;
  assistant-runtime typecheck passed after that last test edit.
- Complexity guard passed: unchanged hotspot debt and maximum; no new hotspot.
- Documentation drift and diff whitespace checks passed.
- Synthetic owner delays preserve exact call order and selected wake; failure
  handling and missing configuration remain unchanged. Legacy log-request parser
  accepts the added numbers; old sparse records remain sparse.
- Added observer work on the configured normal path is ten monotonic clock
  reads and bounded numeric assignments. The synthetic emitted addition is under
  400 bytes, with no additional timing rows or awaited logging operations. Log
  queue tests prove info records do not initiate a request before coalescing and
  remain non-blocking. No production overhead or speedup claim.
- Native candidate review: existing scopes, canonical writes, provider input,
  thresholds, operation/typing order and anchors unchanged. Only the existing
  foreground milestone publishes these values; no generic profiler or new owner.
- Adjacent typing/device owners confirmed no overlap or release reservation.
  Another protected rollout is active; this task has no release slot.

## Independent and final review

PR #4426 candidate `9741d8fd0dfe1260033df3c5d8bbf8e197809532` received a valid
round-one GPT-6 Pro PASS through the canonical managed review workflow. The
waited capture completed successfully after 185.8 seconds with the exact
committed turn, response digest and completion marker. No qualifying findings
were received or accepted. A prior lane failed before sending; its evidence is
retained separately and it is not a substantive review. No Claude was used.

Native final review confirms no new authority, owner, network call, operation
move or timing-anchor change. All source and test files remain at the reviewed
candidate. This closeout changes only explanatory documentation; final exact-head
CI and current-base merge proof are still required. No formal PR approval or
production deployment has been performed. Production attribution and any
performance improvement remain unproven until later natural traffic.
Completed: 2026-11-01
