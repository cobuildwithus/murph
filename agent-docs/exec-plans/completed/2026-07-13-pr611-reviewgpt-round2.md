# PR 611 ReviewGPT Round 2

## Goal

Remove the group-confirmation rollout workflow as a competing Vercel production
alias owner. Configure the producer and rollout bearer once, then let the next
normal production release capture that configuration and perform the bounded
private drain.

## Constraints

- Preserve the private server-rendered confirmation UX and deterministic retry.
- Never create, assign, or promote a Vercel deployment from the rollout helper.
- Keep group content and secret values out of the control path and logs.
- Preserve exact production-commit proof before configuration mutation.
- Retain the explicit one-time transition retirement condition.

## Working Set

- `apps/web/scripts/complete-group-join-confirmation-rollout.ts`
- `apps/web/test/production-migration-guard.test.ts`
- hosted group-confirmation rollout architecture, security, verification, and app docs

## Verification Plan

- Focused Vitest proving configuration-only setup, overlapping invocations with
  no deployment mutation, and enabled-release draining.
- Hosted-web typecheck, docs drift, diff check, parent security/coverage/final review.
- Guarded push, CI, and a fresh exact-head ReviewGPT round.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
