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
   Mitigation: allow exactly one opportunity per clean checkpoint and reuse the
   existing dirty/recording continuation after failure, with no projection
   watermark or second retry loop.
5. Risk: a wake-preempted older publication finishes after a newer checkpoint.
   Mitigation: materialize every selected record while the invocation owns the
   restored vault, keep delivery owned and abortable, drain it before retry,
   carry the committed source workspace version bound to those bytes, and
   serialize the final Web replacement against that existing row; stale work
   becomes a no-op.

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
  convergence boundary; projection errors stay fail-soft to imports and replies
  but cannot consume the existing acknowledgement obligation.
- Fence final Web replacement with the committed workspace version instead of
  adding a share watermark, generation table, or projection-specific state.
- Split the existing projector into Web-owned scope resolution, vault-owned
  complete capture, and immutable delivery. Network phases receive the owning
  abort signal; cancellation fully drains the active request before owner
  release or retry, while capture drains before its result is delivered or
  discarded.
- Normalize Junction cadence once in its existing runtime-config owner and make
  the runtime descriptor report the same effective interval.

## Verification

- Local proof completed:
  - `@murphai/assistant-runtime` typecheck and full Vitest suite: 86 files,
    2,210 passed and 4 skipped. The remediation proof mutates a released warm
    vault root between two captured-scope deliveries and proves the older
    immutable payload remains bound to its checkpoint generation.
  - `@murphai/device-syncd` typecheck and full Vitest suite: 46 files and 979
    passed.
  - `@murphai/hosted-execution` full Vitest suite: 45 files and 502 passed.
  - Canonical Web suite: 723 files passed and 47 skipped; 9,706 tests passed
    and 398 skipped. Focused source-version, stale-writer, signed-route, and
    group-read proof: 3 files and 52 passed.
  - Canonical Cloudflare node suite: 141 files passed; 2,405 tests passed and 2
    skipped.
  - Full workspace typecheck, Web typecheck, assistant-runtime typecheck,
    documentation drift/gardening, privacy search, and `git diff --check` pass.
  - Desktop and mobile changelog renders were captured and inspected at the
    exact authored entry.
- ReviewGPT round 2 required a retrospective because the first stale-writer
  correction retained lazy mutable-vault reads after invocation release. The PR
  records the accepted owner-boundary redesign; the local capture/delivery race
  proof is green.
- ReviewGPT round 3 required a second retrospective because wake-detached
  immutable delivery could multiply across retries. The replacement deletes
  detached publication, propagates cancellation into the actual Web-control
  fetch, drains before retry, and stops later scopes after the first failure.
  Focused proof covers system-mailbox wake cancellation, invocation abort,
  graceful shutdown, repeated device/foreground wakes with peak one active
  delivery, fail-fast scope delivery, and Cloudflare fetch cancellation.
- Remaining proof: corrected exact-head preliminary specialists, ReviewGPT
  round 4 PASS, required GitHub Actions, and current-base merge-tree
  verification.
