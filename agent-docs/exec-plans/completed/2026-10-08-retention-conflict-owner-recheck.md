# Wait on the live owner's recheck horizon when retention meets live work

Status: completed
Created: 2026-10-08
Updated: 2026-10-08

## Goal

- Stop `processing_mode_conflict` retry storms. When due `inbox_media_retention`
  work meets a live or unconfirmed runtime in another mode, Cloudflare returns
  `retry_later` at that owner's recheck horizon instead of three seconds out.
  The owner's completion signal already interrupts the Temporal wait, so
  retention still starts as soon as the fence is free.

## Success criteria

- A retention admission that preserves a live, mismatched, or unconfirmed owner
  returns the same horizon that an accepted wake of that owner reports.
- Inactive-owner recovery, the starting-fence deadline, and foreground
  preemption of retention are unchanged.
- The runtime protocol reference states the wait owner.

## Scope

- In scope: `apps/cloudflare/src/runtime-processing.ts`, its PostgreSQL
  orchestration test, and `agent-docs/references/hosted-runtime-protocol.md`.
- Out of scope: the private Temporal workflow, runaway alert thresholds, other
  retry reasons, and the unused retry-delay table plus retry analytics in
  `runtime-processing-responses.ts` (separate deletion).

## Constraints

- Technical constraints: no new state, timer, signal, or workflow change;
  reuse the existing owner recheck computation.
- Product/process constraints: background maintenance only; foreground replies
  keep priority over retention.

## Risks and mitigations

1. Risk: a lost completion signal delays retention.
   Mitigation: the delay is bounded by the same owner recheck horizon the
   workflow already applies to that accepted owner. Retention is background
   cleanup with no reply on its path, so bounded minutes of lateness is
   acceptable.
2. Risk: an unconfirmed liveness read now waits longer before retention retries.
   Mitigation: such owners stay protected by design (2026-09-30 plan); the
   owner's recheck horizon still re-probes and the existing recovery retires
   it when inactive.

## Tasks

1. Pass the owner recheck horizon as the conflict `retryAt`.
2. Extend the conflicting-retention admission test to prove the horizon matches
   an accepted wake of the same owner.
3. Document the wait owner in the runtime protocol reference.

## Decisions

- Production evidence (2026-10-08 03:13Z): retention retried 21 times at
  about 3.4 s behind a live `system_mailbox` run. The run's completion
  `runtimeSignal` cancelled the pending three-second timer and retention started
  immediately, so the polling contributed no progress. 14-day log history shows
  eight such storms, the largest 418 retries in 23 minutes.
- Keep the fix in Cloudflare: it alone observes liveness, and the documented
  `retry_later` contract already makes Temporal wait signal-interruptibly until
  `retryAt`. A workflow change would add a replay-versioned branch to a private
  consumer for the same result.
- Changelog: internal-only background scheduling; no member-visible change.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runtime-processing-postgres.test.ts`:
  62 passed. With the source change reverted, the active, mismatch, and
  unavailable conflict cases fail (three-second `retryAt` versus the owner
  horizon); the starting case keeps its 30-second deadline either way.
- `pnpm --dir apps/cloudflare typecheck` passes after the existing Prisma
  generation prerequisite.
- `pnpm complexity:diff`: debt 0 -> 0, maximum 20 -> 20, no new hotspot.
- `pnpm docs:drift` passes.
- Read-only review of the private Temporal consumer: retention executions carry
  no system-mailbox fingerprint or pointer-free owner, so the longer `retryAt`
  cannot become system-mailbox backoff, and `waitAfterUnsuccessfulProcessing`
  waits signal-interruptibly on the earliest deadline.
Completed: 2026-10-08
