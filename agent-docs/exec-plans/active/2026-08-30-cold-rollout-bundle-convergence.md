# Cold rollout bundle convergence

Status: active
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Keep hosted invocations available through Cloudflare's mixed Worker/container
  rollout window without ever admitting work to a stale runner image.

## Success criteria

- Direct cold readiness replaces at most one runner whose bundle/source
  fingerprint belongs to the preceding rollout.
- Both attempts use the original lifecycle lock, caller deadline, generation
  ownership, cleanup path, and exact architecture/fingerprint admission.
- A second mismatch or any other failure remains fail-closed.
- Focused tests, Cloudflare typecheck, exact-head ReviewGPT gates, and required
  GitHub checks pass before human merge.

## Scope

- In scope: the hosted runner Durable Object cold-readiness owner, focused
  lifecycle tests, and its durable architecture/deployment contracts.
- Out of scope: device sync, rollout configuration, provider behavior,
  production replay or repair, telemetry, and broader startup-timeout policy.

## Product UX Patch

- Outcome: a member's existing hosted turn can continue starting during a
  routine deploy instead of failing solely because the first cold image is from
  the preceding rollout.
- Reaches: an existing hosted invocation whose runner starts inside the brief
  mixed Worker/container generation window.
- Proof: the production-derived stale-then-current regression reaches exact
  readiness, while second-stale, timeout, unsettled-cleanup, ordinary-health,
  and newer-generation cases remain bounded and fail-closed.

Walkthrough: Ready. The member-visible promise and destination are unchanged;
only recovery inside the existing startup wait improves. No additional delay,
message, permission, provider input, audience, or state owner is introduced.

## Tasks

1. [x] Prove deployment-aligned bundle mismatch from bounded production
   evidence, code history, Cloudflare's rollout contract, and a failing test.
2. [x] Confirm no exact active owner and defer device-sync-owned work.
3. [x] Obtain, inspect, and apply the ReviewGPT-authored bounded fix.
4. [x] Run the full runner-container test file and Cloudflare typecheck.
5. [ ] Complete changelog disposition, exact-head ReviewGPT/CI gates, PR
   readiness, and human-merge handoff.

## Decisions

- Retry only the typed bundle/source fingerprint mismatch proven in production;
  architecture mismatch, poisoned health, and ordinary health failures keep
  their existing behavior.
- Reuse the existing lifecycle and cleanup owners; add no queue, scheduler,
  service, state, telemetry, or rollout-configuration machinery.
- Keep the ordinary bug-fix PR ready for human merge. Do not deploy or merge it
  autonomously.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-container.test.ts`
- `pnpm --dir apps/cloudflare typecheck`
- `git diff --check`
- Preliminary `completion-specialists` and final ReviewGPT on the exact pushed
  head, run concurrently with required GitHub checks.
