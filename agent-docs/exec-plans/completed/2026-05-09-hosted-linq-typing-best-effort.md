# Hosted Linq typing best effort

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Make hosted Linq typing indicators best-effort so a slow or stuck provider typing effect cannot delay the foreground assistant/provider turn or reply delivery.

## Success criteria

- Hosted Linq effects-port typing returns an activity handle without waiting for the first provider `typing` call to settle.
- A non-resolving Linq typing effect does not block the caller.
- Provider typing start/stop failures remain cosmetic and are swallowed/logged through the existing best-effort channel.
- Focused assistant-runtime tests and typecheck pass.

## Scope

- In scope:
  - `packages/assistant-runtime/src/hosted-runtime/channel-activity.ts`
  - `packages/assistant-runtime/test/hosted-runtime-channel-activity.test.ts`
- Out of scope:
  - Generic assistant-engine activity-session semantics for local channel adapters.
  - Telegram typing behavior unless the existing tests require compatibility adjustments.
  - Hosted web or Cloudflare control-plane changes.

## Constraints

- Technical constraints:
  - Preserve existing session handle shape.
  - Keep typing-provider work bounded by the hosted runtime abort signal.
  - Do not persist new state.
- Product/process constraints:
  - Preserve unrelated dirty worktree edits.
  - Keep provider-visible typing indicators cosmetic only.

## Risks and mitigations

1. Risk: Background activity loop can leave unhandled promise rejections.
   Mitigation: Catch and swallow the activity-session promise in the hosted Linq effects-port path.
2. Risk: Stop can still block on a stuck provider `typing_stop` call.
   Mitigation: Bound hosted Linq effects-port start/stop calls with a short timeout.

## Tasks

1. Inspect existing hosted channel activity and test coverage.
2. Add a hosted Linq no-op activity handle plus bounded background activity-session start.
3. Add regression coverage for a non-resolving provider typing effect.
4. Run focused verification, typecheck, and required completion audits.

## Decisions

- Keep the generic `startAssistantChannelActivitySession` contract unchanged because local channel adapters rely on initial-start failures surfacing.
- Apply best-effort nonblocking behavior only to the hosted Linq effects-port path that uses web/provider effects for cosmetic UI feedback.
- Collapse typing failure log details to fixed buckets (`Timeout`, `Error`, `NonError`) so provider-controlled errors cannot leak identifiers through logs.

## Verification

- Commands to run:
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-channel-activity.test.ts`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm typecheck`
- Expected outcomes:
  - Focused regression and package/repo typechecks pass, or any unrelated pre-existing failure is isolated and reported.
- Results:
  - Passed: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-channel-activity.test.ts`.
  - Passed: `pnpm --dir packages/assistant-runtime typecheck`.
  - Passed before the final logging-bucket fix: `pnpm typecheck`.
  - Rerun after the final logging-bucket fix is blocked by unrelated active work: `packages/cloudflare-hosted-control/test/client.test.ts(578,7)` has `allowed: boolean` where `HostedAiUsageAllowDecision` requires `allowed: true`.
  - Scoped diff lane proved `packages/assistant-runtime` typecheck/test, then failed in unrelated reverse-dependent Cloudflare dirty work: `apps/cloudflare/test/user-runner-alarm.test.ts` duplicate browser-vault refresh destroy assertion.
Completed: 2026-05-09
