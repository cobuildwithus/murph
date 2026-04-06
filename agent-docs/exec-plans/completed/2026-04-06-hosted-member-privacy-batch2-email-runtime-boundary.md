# Hosted-member privacy Batch 2 email/runtime boundary

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Keep hosted verified email out of the hosted web Postgres account model while the wider hosted-member split continues.
- Prove the supported flow remains `Privy verified email -> hosted execution user env -> Cloudflare verified-sender / route state`.

## Success criteria

- No Prisma email identity field is added to the hosted onboarding/account models.
- Hosted-web proof covers the email sync route extracting verified email from Privy-linked accounts and forwarding it only to hosted execution env sync.
- Hosted-web proof covers the control helper materializing only hosted user env keys before best-effort run triggering.
- The current live-tree docs/tests continue to support Cloudflare route-state ownership without any hosted-web runtime redesign.

## Scope

- In scope:
  - `apps/web/app/api/settings/email/sync/route.ts`
  - `apps/web/src/lib/hosted-execution/control.ts`
  - focused tests under `apps/web/test/**`
  - concise doc/proof touch only if the live tree still lacks a durable statement after the test additions
- Out of scope:
  - Prisma schema redesign
  - hosted email routing changes
  - Cloudflare sender-auth changes
  - moving email identity into any Postgres model

## Constraints

- Preserve unrelated dirty worktree edits.
- Prefer tests and direct proof over runtime redesign.
- Keep verified email as hosted execution env state, not `HostedMember`/`HostedMemberIdentity`/routing/billing database state.

## Risks and mitigations

1. Risk: A test accidentally hard-codes temporary hosted-member split details unrelated to the email boundary.
   Mitigation: Keep assertions focused on the Privy-to-env sync boundary and schema absence of email fields.
2. Risk: A proof gap remains around Cloudflare ownership of verified-sender route state.
   Mitigation: Reuse the existing durable proof note and Cloudflare tests unless a concise clarification is still missing.
3. Risk: Shared-worktree overlap in `apps/web/test/**` causes merge friction.
   Mitigation: Keep edits narrow, read current file state first, and avoid broad helper churn.

## Tasks

1. Review the live route/control/tests/schema for the exact current verified-email boundary.
2. Add the smallest focused tests needed to lock out Prisma email fields and lock in hosted user env sync.
3. Update a concise durable proof note only if the existing proof doc remains insufficient after the tests.
4. Run required verification, then close with a scoped commit.

## Verification

- Direct proof gathered:
  - readback of `apps/web/prisma/schema.prisma` confirmed `HostedMember`, `HostedMemberIdentity`, `HostedMemberRouting`, and `HostedMemberBillingRef` still expose no email field.
  - readback of `apps/web/app/api/settings/email/sync/route.ts` confirmed the route still extracts the verified email from server-side Privy linked accounts and forwards it to hosted execution sync.
  - readback of `apps/web/src/lib/hosted-execution/control.ts` confirmed the helper still writes only hosted user env keys before the best-effort hosted run trigger.
- Command results:
  - `pnpm --dir apps/web test -- hosted-execution-control.test.ts hosted-member-email-runtime-boundary.test.ts settings-email-sync-route.test.ts` passed.
  - `pnpm --dir apps/web lint` passed with pre-existing warnings only.
  - `pnpm typecheck` failed in unrelated pre-existing assistant/CLI files under `packages/assistant-core/**`, `packages/assistant-cli/**`, and `packages/cli/**`.
  - `pnpm test:coverage` failed for the same unrelated pre-existing assistant/CLI typecheck errors during prepared runtime artifact build.
Completed: 2026-04-06
