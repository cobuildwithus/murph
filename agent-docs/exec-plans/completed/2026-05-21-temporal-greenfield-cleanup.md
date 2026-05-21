# Temporal Greenfield Cleanup

## Goal

Land the final greenfield hosted Temporal cleanup from the production-readiness
review: keep mailbox demand priority simple, remove or mechanically guard legacy
scheduler drift, and preserve the north-star ownership split.

Success criteria:

- Any mailbox lag outranks manual demand.
- System-only mailbox lag still avoids AI usage gating.
- Legacy Cloudflare scheduling surfaces are either removed when no production
  caller remains or mechanically guarded against production regression.
- CI/local guards catch reintroduction of old scheduler names or raw payload
  storage in Temporal orchestration surfaces.

## Constraints

- Preserve unrelated hosted-local Temporal E2E edits under
  `scripts/dev-hosted-local/**`.
- Keep the architecture greenfield: avoid deploy-skew compatibility unless a
  current caller requires it.
- Do not expose local identifiers, raw provider payloads, mailbox contents,
  prompts, transcripts, secrets, or account-specific infrastructure values.

## Working Set

- `apps/web/src/lib/hosted-orchestration/runtime-demand.ts`
- `apps/web/test/hosted-orchestration-demand.test.ts`
- `apps/cloudflare/src/**`
- `apps/cloudflare/test/**`
- `scripts/**`
- `agent-docs/references/hosted-temporal-orchestration.md`
- `agent-docs/references/testing-ci-map.md`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/index.md`

## Verification Plan

- Focused hosted web orchestration demand tests.
- Focused Cloudflare tests if Cloudflare production code changes.
- Guard script test or direct guard command for architecture invariant checks.
- `pnpm typecheck`, `pnpm docs:drift`, `pnpm logs:guard`, and scoped
  `test:diff` for touched files unless blocked by unrelated dirty work.

## Progress

- Any mailbox lag now outranks manual demand while system-only lag remains
  ungated by AI usage policy.
- Legacy production Cloudflare nudge/browser-vault scheduling/run-until-idle
  Durable Object methods were removed; local tests now use the signed
  ensure-execution route or explicit test-only helpers.
- Added `hosted-temporal:guard` and wired it into root typecheck/diff
  verification to block old scheduler names and Temporal workflow payload
  regression.
Status: completed
Updated: 2026-05-21
Completed: 2026-05-21
