# Make mailbox webhook nudges Workflow-owned

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Simplify hosted mailbox wake handoff so verified inbound mailbox work starts
  one pointer-only Vercel Workflow, and that Workflow step owns Cloudflare
  runner nudge/retry.

## Success criteria

- Linq, Telegram, device-sync, and Cloudflare Email mailbox handoffs start the
  existing `{ mailboxItemId, source }` workflow after the encrypted mailbox row
  exists instead of trying a direct Cloudflare nudge first.
- Direct Cloudflare runner nudge remains inside the Workflow step only.
- No raw webhook/email payloads, verification headers, provider secrets, or
  message content become Workflow inputs or outputs.
- Focused tests and typecheck pass, or unrelated blockers are named.

## Scope

- In scope: hosted web webhook wake handoff, device-sync wake handoff, hosted
  email ingress handoff, directly coupled tests, and durable architecture docs.
- Out of scope: Cloudflare Durable Object runner state-machine changes, Stripe
  reconciliation workflow behavior, settings sync nudges, dependency changes,
  and live deploy verification.

## Constraints

- Technical constraints: preserve mailbox append before workflow start; keep the
  Workflow input pointer-only; keep duplicate safety via mailbox dedupe and DO
  nudge coalescing.
- Product/process constraints: preserve unrelated dirty work and active lanes in
  the shared checkout.

## Risks and mitigations

1. Risk: Normal-path nudge latency may rise because the Workflow owns every
   nudge attempt.
   Mitigation: accept the tradeoff for a simpler durable handoff model; the
   Workflow step still calls the same Cloudflare nudge API with bounded retry.
2. Risk: Email ingress could strand work if the web-side Workflow start callback
   fails.
   Mitigation: keep that failure retryable after mailbox append, matching the
   existing fallback failure behavior.

## Tasks

1. Done: Mapped the current direct-nudge/fallback call sites and tests.
2. Done: Confirmed mailbox handoffs now start the pointer-only Workflow after
   append; the direct Cloudflare nudge remains inside the Workflow step.
3. Done: Updated tests and durable docs to state Workflow-owned nudge handoff.
4. Done: Ran focused verification and required audit passes.
5. Next: Close the plan and commit the scoped change.

## Decisions

- Prefer simple robust handoff over lowest possible direct-nudge latency.

## Verification

- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-execution-handoff.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts apps/web/test/device-sync-hosted-wake.test.ts apps/web/test/hosted-onboarding-webhook-workflows.test.ts`
  (6 files, 87 tests).
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/hosted-email-worker-ingress.test.ts`
  (1 file, 17 tests).
- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-onboarding-webhook-workflows.test.ts apps/web/test/hosted-email-mailbox-ingress-route.test.ts`
  (2 files, 12 tests).
- Passed: `pnpm --dir apps/web typecheck`.
- Passed: `pnpm --dir apps/cloudflare typecheck`.
- Passed: `git diff --check`.
- Partial: scoped `bash scripts/workspace-verify.sh test:diff ...` found an
  unrelated workspace-boundary failure in active
  `apps/cloudflare/scripts/run-hosted-local-e2e.ts`; `apps/cloudflare verify`
  passed. `apps/web verify` then exposed one related stale idempotency test,
  fixed and re-covered by focused tests, plus an unrelated active
  Junction/device-sync connect-target failure in
  `apps/web/test/device-sync-internal-connect-route.test.ts`.
- Required security/privacy review: no findings.
- Required coverage-write pass: no test changes needed; focused proof judged
  sufficient.
- Required final review: one stale retry-policy comment fixed.
Completed: 2026-05-01
