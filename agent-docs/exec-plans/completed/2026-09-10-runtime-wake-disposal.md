# Preserve consumed wakes during disposal

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal and scope

Complete PR #3207 and its authorized production release after correcting the concrete CI failure. Keep the previous completed local plan immutable. Reuse the checkpoint wake listener and foreground handoff; add no state owner or retry mechanism.

## Cause and correction

The first candidate added a post-wait disposal guard. A wake can resolve the wait before dispose begins, but resume its continuation afterward. Discarding that already-consumed notification prevents the durable-effect caller from re-notifying foreground work before a follow-up snapshot.

The existing test `durable follow-up checkpoints yield to foreground-pending idle conflicts` failed both in CI and in an isolated local run on the first candidate. Removing the post-wait discard restores the original unconditional caller contract. Disposal still cancels a pending wait; notifications already received remain available to `takeNotification()`.

## Product UX and verification

- Result: Ready for release review. Real foreground input retains priority over a follow-up checkpoint; empty scheduler nudges still allow the final independent-completion snapshot to finish.
- `pnpm --filter @murphai/assistant-runtime test hosted-runtime-workspace-entrypoint-checkpoint-races.test.ts hosted-runtime-background-wake-convergence.test.ts hosted-runtime-workspace-entrypoint-system-preemption.test.ts --maxWorkers=1`: all 51 tests passed, including the exact previously failing CI scenario.
- `pnpm --filter @murphai/assistant-runtime typecheck`: passed.
- `pnpm complexity:diff`: passed; existing hotspot debt and maximum remain unchanged.
- Parent review: no extra network, provider, persistence, or auth change in this correction; existing cancellation and notification ownership are restored. Original local proof and compatible persisted schemas still apply.
- Changelog: internal bookkeeping correction; no additional public entry.

## Release gates

The first ReviewGPT round passed, but its candidate is superseded by this CI correction. Push the corrected head, rerun sensitive full-snapshot ReviewGPT and required CI, merge only after both pass, then use the protected Cloudflare deployment workflow and verify the deployed version and native rollout receipt. Do not infer deployment success from upload alone.
Completed: 2026-09-10
