# Correct the browser refresh and settings mailbox deadlock

Status: completed
Created: 2026-10-01
Updated: 2026-10-01

## Outcome and protected invariants

Drain independently runnable settings updates and browser refreshes without repeated empty invocations. Bound retries when durable work makes no progress while preserving immediate conversation admission, scheduled work, write fences, mailbox retention, and checkpoint authority.

## Evidence and owners

A synthetic queue with a browser refresh before a member preferences update projects both a model-free mailbox wake and a default-owned wake. Default processing hands off the first item before its existing preferences preplanning stage. Neither item advances. Runtime owns execution and wake projection; Web owns durable checkpoints and mailbox facts; Temporal owns no-progress backoff.

## Plan

1. Reproduce the mixed-owner queue and correct execution ordering at the existing runtime owner.
2. Exercise repeated no-progress scheduling and extend the existing orchestration guard if required; do not add a scheduler, queue, or product-state owner.
3. Prove foreground priority, retained work, recovery, and cold/checkpoint convergence with synthetic tests and typechecks.
4. Review the exact candidate with Opus and ReviewGPT, pass CI, then merge and deploy under the existing task authorization.
5. Verify mailbox progress, invocation rate, CDN volume, and errors after release; successful completion alone is insufficient evidence.

## State, failures, and compatibility

Reuse existing mailbox and checkpoint state. No production row edits. Preserve retry deadlines and foreground preemption. Runtime ordering changes must work with existing Web and Temporal consumers; any orchestration change requires replay-compatible deployment through the private owner.

## Verification

- Reproduced the mixed-owner deadlock in a real-mailbox phase regression before the fix.
- Removed the premature model-free return; the existing preferences preplanning now runs before the final handoff.
- Focused runtime proof: 155 tests passed, including three consecutive restored invocations: settings apply, one refresh publication, then idle replay. The earlier pending refresh remains unacknowledged until its own completion.
- `pnpm --filter @murphai/assistant-runtime typecheck` passed after final test edits.
- `pnpm complexity:diff` passed; changed owner complexity decreased from 118 to 115. No new abstraction, persisted state, or dependency.
- Parent review: preserved foreground selection and delivery deferral, bounded preferences processing, explicit projection correction, and existing system-only refresh ownership. Product UX Patch: Ready for the existing settings/refresh journey; no presentation or prompt changes.
- ReviewGPT round 1 passed at `ef166c61655e` with no qualifying findings. This closure changes explanatory evidence only; the reviewed runtime and tests are unchanged.
- Public implementation is complete. Exact-head CI, merge, deployment, and the requested eight-hour production observation remain release steps; they are not claimed complete by this plan closure. The broader scheduler guard is separately owned in the private orchestration companion checkout.

## Changelog

Internal runtime scheduling and resource protection; no new member-facing feature.
Completed: 2026-10-01
