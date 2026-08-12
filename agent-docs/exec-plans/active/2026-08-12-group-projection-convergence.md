# Group projection convergence after health imports

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Make newly imported personal health truth converge into every consented group
  projection promptly and durably, without adding work to the foreground reply
  path or introducing another queue, scheduler, or state owner.

## Success criteria

- A successful canonical device import cannot acknowledge its durable dirty
  record before the checkpointed vault gets one projection opportunity through
  existing owners.
- The personal runtime refreshes consented group-share projections before more
  background device-sync churn can starve them, while fresh conversation input
  still preempts background work.
- A group runtime wake after the refresh reads the new projection; an already
  running group reply is not synchronously coupled to personal-runtime work.
- Junction normalizes pathological reconcile intervals at the provider boundary.
- Focused tests prove mixed dirty/non-dirty wake pressure, restart/replay,
  foreground priority, no hot-path call-count increase, and scheduler clamping.
- Architecture and reliability docs describe the one-owner convergence rule.

## Scope

- In scope: canonical import handoff, hosted personal-runtime projection
  scheduling, existing group-share snapshot publication, group wake/read
  behavior, Junction reconcile cadence, focused observability, tests, and owner
  documentation.
- Out of scope: native iOS status/UX changes, new projection infrastructure,
  live production mutations, or synchronous group-container fanout from the
  import transaction.

## Constraints

- Technical constraints: preserve canonical health writes through core; keep
  transactions database-only and bounded; treat wakes as replayable latency
  hints rather than truth; preserve foreground conversation priority; reuse the
  existing share snapshot and runtime mailbox/checkpoint owners.
- Product/process constraints: no private incident evidence in repository
  artifacts; use an isolated PR worktree; run focused proof, preliminary
  ReviewGPT specialists, the final cross-cutting ReviewGPT gate, and exact-head
  CI.

## Risks and mitigations

1. Risk: waking every group directly creates import fanout and database/runtime
   load.
   Mitigation: signal the member-owned personal runtime once and let its existing
   bounded share projection pass update all consented snapshots set-wise.
2. Risk: projection refresh delays a fresh member reply.
   Mitigation: keep conversation admission authoritative and run projection
   work only at existing clean/checkpoint boundaries.
3. Risk: a droppable wake loses the refresh.
   Mitigation: keep the existing durable dirty acknowledgement pending until
   the checkpointed projection opportunity; use wakes only to reduce latency.
4. Risk: repeated imports create a projection loop.
   Mitigation: allow exactly one best-effort opportunity per clean checkpoint,
   then continue through the existing acknowledgement and mailbox owners with
   no projection watermark or second retry loop.

## Tasks

1. Map the current import, dirty-wake, checkpoint, share-projection, and group
   read paths on current main; identify the smallest durable owner boundary.
2. Ask ReviewGPT to challenge the proposed architecture and return a scoped
   patch or concrete findings.
3. Implement the chosen handoff and Junction interval clamp with focused tests.
4. Run focused package tests, typechecks, direct call-order/load proof, and
   inspect the diff for privacy and unrelated changes.
5. Commit and push the exact candidate, open a draft PR, then run preliminary
   specialist and final ReviewGPT gates concurrently with required CI.
6. Resolve accepted findings, rerun affected proof, finalize the PR, and report
   deployment ordering and production verification.

## Decisions

- Prefer one member-runtime projection obligation over per-group wake fanout.
- Do not add synchronous work to canonical import transactions or group reply
  admission.
- Reject direct group wakes: each group read already queries the current
  Web-owned encrypted snapshot, so recipient fanout adds cost without freshness.
- Use the existing checkpoint and dirty-record acknowledgement as the sole
  convergence boundary; projection errors remain fail-soft terminal outcomes
  for that bounded opportunity.
- Normalize Junction cadence once in its existing runtime-config owner and make
  the runtime descriptor report the same effective interval.

## Verification

- Local proof completed:
  - `@murphai/assistant-runtime` typecheck and full Vitest suite: 86 files,
    2,206 passed and 4 skipped.
  - `@murphai/device-syncd` typecheck and full Vitest suite: 46 files and 979
    passed.
  - Web projection-store and hosted group shared-read proof: 2 files and 30
    passed after generating the worktree-local Prisma client.
  - `git diff --check`: clean.
- Remaining proof: exact-head preliminary specialists, final ReviewGPT rounds,
  required GitHub Actions, and current-base merge-tree verification.
