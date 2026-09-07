# Drain newer device wakes behind retained retries

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Goal

Drain redundant connection wake signals through the existing retained device job owner without losing provider retries, dirty payloads, lifecycle changes, or foreground priority.

## Evidence and owner

The local queue selector blocks later same-connection work behind a future retained resource job. A successful pass can retain that job again and defer the same webhook signal indefinitely. The system mailbox preparation owner already collapses redundant browser refresh requests; extend that admission boundary to transfer plain device wake hints to the selected retained continuation. Preserve the continuation's exact job hints and existing checkpoint/dirty-ack paths.

## Scope and constraints

Change only runtime mailbox admission and focused proof. Do not change provider backoff, scheduling cadence, Web admission, Temporal, alert thresholds, or persisted schemas. Distinct connection epochs, explicit jobs, manual reconciliation, attempted work, lifecycle events, and recording effects must preserve their own execution. Scheduled signals must not advance a future provider retry.

## Product UX

- Outcome: Connected-device updates stop accumulating redundant wake signals behind a retained retry.
- Reaches: Existing connections with pending background retries, including restored queues and fresh webhook data.
- Proof: Reproduce repeated post-checkpoint retention, then prove the queue frontier drains while the exact future provider job and dirty acknowledgement remain owned. Preserve foreground preemption and lifecycle changes.

## Tasks

1. Add a failing composed mailbox preparation/record/restore regression.
2. Transfer eligible admitted wake hints to the selected retained owner using existing state.
3. Prove retry, partial dirty acknowledgement, arrival, epoch, job, and lifecycle boundaries.
4. Run focused suites, typecheck, complexity checks, and parent review.
5. Document the owner contract and public recovery outcome; commit, open PR, run required review and CI, merge, deploy, and inspect production convergence.

## Risks and mitigation

- Lost newer work: Collapse only already queued plain hints at admission and preserve the selected durable continuation through all checkpoint/retry paths.
- Lost explicit work or lifecycle ordering: Exclude jobs/manual/attempted/recording work and stop across an incompatible same-connection item.
- Provider retry acceleration: Preserve job availableAt and the existing scheduled-signal admission restriction.
- Rollout: Runtime-only behavior over the existing schema; old snapshots remain readable and ordinary Web/Worker interfaces remain unchanged.

## Verification

- Baseline failure confirmed in the real hosted workspace entrypoint: a retained resource retry leaves three items instead of one after the pass and checkpoint.
- The composed mailbox regression also fails on baseline after successful dirty acknowledgement and restore.
- The fixed admission retains one exact future provider job, advances the handled frontier over absorbed hints, and keeps provider calls at zero before that job is due.
- Dirty-ack failure and restore preserve the recording operation; a newer dirty revision schedules the same owner without another mailbox signal.
- Boundary proof covers explicit jobs, manual reconcile, connection epochs, lifecycle events, attempted and recording work, newer schedules, and independent connections.
- All 197 focused tests passed across mailbox notification, real workspace entrypoint, foreground preemption, and mailbox state suites.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm complexity:diff` passed: changed-source complexity debt remains 20 and maximum remains 30. The existing preparation and post-checkpoint record hotspots retain their ownership; new hint eligibility is a private predicate.
- Parent review covered the full diff, exact continuation ownership, retry and checkpoint failure paths, bounded local queue scanning, and privacy.
- PR review, exact-head CI, merge, managed deployment, and read-only production convergence checks remain release gates.

## Implementation outcome

The local reproduction and fix are complete. PR #3003 owns the remaining release gates: exact-head CI, required ReviewGPT, merge, managed Cloudflare deployment, and production convergence inspection. No production state was manually rewritten. The public changelog explains the recovery behavior without private incident details.
Completed: 2026-09-06
