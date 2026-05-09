# Hosted runner stuck invocation recovery

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Prevent a hosted runner container rollout or abort from leaving a per-user Durable Object permanently stuck in an "already active" recovery loop while mailbox conversation messages remain undelivered.

## Success criteria

- Reproduce the stuck active-invocation recovery behavior in focused Cloudflare runner tests and a hosted-local end-to-end scenario.
- Make stale or aborted active invocations recover by clearing the stale lease and starting a clean replay instead of rescheduling a one-second alarm forever.
- Keep the fix narrow: no new queue/control plane, no new persisted state shape unless proven necessary.
- Preserve mailbox ordering, idempotent replay, and existing nudge/usage-gate authority boundaries.

## Scope

- In scope: `apps/cloudflare` user-runner liveness, stale invocation lease handling, and focused tests.
- Out of scope: changing mailbox storage, assistant prompt behavior, hosted-web ingress, billing/usage policy, or broad deploy workflow changes.

## Constraints

- Technical constraints: Durable Object storage remains the durable authority; in-memory locks are only process-local liveness hints. Recovery must remain replay-safe and avoid broad new coordination abstractions.
- Product/process constraints: do not log or persist raw message bodies, user identifiers, or secret material; keep operational logs metadata-only.

## Risks and mitigations

1. Risk: clearing a valid active invocation too aggressively could start duplicate work.
   Mitigation: only clear after the existing stale/orphan timeout rules and preserve persisted lease generation checks.
2. Risk: a fix that special-cases the incident could add brittle recovery complexity.
   Mitigation: keep the change at the generic liveness boundary: active in-memory lock plus persisted lease must be reconciled through one stale-lease path.

## Tasks

1. Inspect current in-memory invocation lock, persisted lease, alarm, and container lifecycle interactions.
2. Add a focused regression test for stale active invocation recovery after container/rollout abort.
3. Implement the smallest recovery change.
4. Run scoped Cloudflare verification, hosted-local end-to-end verification, and required completion audits.

## Decisions

- Treat this as a high-risk operational recovery fix because it touches Durable Object runner coordination.
- Keep durable mailbox and workspace schemas unchanged unless testing proves the existing stale lease model cannot express the fix.

## Verification

- Red proof: temporarily disabled only the local-lock stale recovery branch while keeping the test hook, then `pnpm hosted-local e2e stuck-invocation-recovery` reproduced the stuck `inFlight` state after alarm recovery.
- Green proof:
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts -t "replays from a durable alarm"`
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/index.test.ts -t "stuck invocation|test route"`
  - `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/hosted-local.test.ts`
  - `pnpm --dir apps/cloudflare build`
  - `pnpm hosted-local e2e stuck-invocation-recovery --no-bundle`
- Diff-aware verification: `pnpm test:diff ...` reached Cloudflare verify but is blocked by an unrelated dirty deploy workflow/test expectation mismatch in the DeepSec lane.
Completed: 2026-05-09
