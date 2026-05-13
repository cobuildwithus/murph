# Device-sync dirty wake routing

Status: completed
Created: 2026-05-13
Updated: 2026-05-13

## Goal

- Route hosted device-sync dirty work through the existing `device-sync.wake` mailbox/workflow/runtime lane instead of generic runner nudges that skip device sync.
- Keep hosted assistant-reply nudges behind the hosted AI usage gate while allowing device-sync maintenance to run as free background work.

## Success criteria

- Webhook dirty transitions append a `device-sync.wake` mailbox item and start the existing wake workflow.
- Dirty sweeper retries append `device-sync.wake` mailbox items for stale dirty connections, without logging raw user ids.
- Assistant conversation wake nudges skip the regular runner nudge when the hosted AI usage gate is denied.
- Device-sync wake workflow nudges remain ungated by hosted AI usage allowance.
- Focused hosted web tests cover the changed wake and gate behavior.

## Scope

- `apps/web/src/lib/device-sync/**`
- `apps/web/src/lib/hosted-onboarding/webhook-workflow-steps.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-service-wake.ts`
- `apps/web/src/lib/hosted-mailbox/lag-sweeper.ts`
- focused hosted web tests for device-sync dirty sweeper, hosted wake, mailbox lag, and webhook workflows

## Out of scope

- Cloudflare Durable Object runner protocol changes.
- Hosted AI allowance math, billing plan policy, or usage accounting.
- Provider-specific device-sync reconciliation logic.

## Constraints

- Preserve `apps/web` as the canonical owner of hosted AI usage policy.
- Keep device-sync maintenance independent from assistant usage caps.
- Reuse the existing mailbox/workflow/runtime lane instead of introducing a second nudge protocol.
- Preserve unrelated dirty worktree edits.

## Risks and mitigations

1. Risk: Dirty sweeper retries create excessive mailbox items.
   Mitigation: Keep the existing stale threshold, limit, and concurrency behavior, and only queue bounded retry wakes for selected dirty connections.
2. Risk: Capped users lose background maintenance.
   Mitigation: Apply hosted AI usage gating only to assistant conversation nudges, not `device-sync` workflow nudges or system-lane nudges.
3. Risk: Webhook retries duplicate mailbox wakes.
   Mitigation: Use a stable webhook dirty wake event id derived from the provider trace when present.

## Tasks

1. Done: Register this plan and ledger row.
2. Done: Add a small device-sync dirty wake queue helper and route webhook dirty transitions through it.
3. Done: Make the dirty sweeper list stale dirty connections and append device-sync wake items with dirty-revision dedupe.
4. Done: Add assistant-reply nudge gating for webhook workflow/direct nudges and mailbox lag nudges.
5. Done: Add a system nudge helper that avoids raw runner nudges when conversation lag is pending or uncertain.
6. Done: Update focused tests, run verification, and run required audits.

## Verification

- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-device-sync-dirty-sweeper.test.ts test/hosted-device-sync-dirty-sweeper-route.test.ts test/device-sync-hosted-wake.test.ts test/hosted-onboarding-webhook-workflows.test.ts test/hosted-mailbox-lag-sweeper.test.ts test/hosted-runner-assistant-nudge.test.ts test/hosted-runner-system-nudge.test.ts test/hosted-execution-handoff.test.ts test/hosted-onboarding-linq-dispatch.test.ts test/hosted-onboarding-telegram-dispatch.test.ts test/hosted-onboarding-whatsapp-service.test.ts test/hosted-onboarding-webhook-idempotency.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm test:diff <scoped apps/web files>`
- Security/privacy review found mixed conversation/system lag could bypass usage gating through a raw per-user nudge; fixed by routing any conversation lag through assistant gating and by guarding system/device-sync nudges with a conversation-lag check.
- Final review found dirty-sweeper retries could create repeated wake rows for the same dirty revision; fixed with dirty-revision dedupe.
Completed: 2026-05-13
