# Make mailbox webhook nudges Workflow-owned

Status: active
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

1. Map current direct-nudge/fallback call sites and tests.
2. Change mailbox handoffs to always start the pointer-only Workflow.
3. Update tests and durable docs to state Workflow-owned nudge handoff.
4. Run focused verification and required audit passes.
5. Close the plan and commit the scoped change.

## Decisions

- Prefer simple robust handoff over lowest possible direct-nudge latency.

## Verification

- Commands to run: focused Vitest for touched hosted web/Cloudflare tests,
  `pnpm --dir apps/web typecheck`, `pnpm --dir apps/cloudflare typecheck`,
  `git diff --check`, and a truthful scoped `test:diff` if not blocked by
  unrelated dirty work.
- Expected outcomes: changed behavior is covered and pointer-only privacy
  boundary remains explicit.
