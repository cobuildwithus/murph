# PR 528 ReviewGPT Round 5 Fixes

## Goal

Resolve the two accepted ReviewGPT findings on the exact pushed PR head:

1. A durable replyable input recovered after restart must run before bounded route-proof repair.
2. The default-off route-proof producer must still commit the admitted replacement direct chat as the member's durable home route.

## Constraints

- Keep foreground reply delivery independent from repair readiness and repair failures.
- Keep proof repair provider-independent when no replyable input is pending.
- Preserve terminal route proof through pending-index compaction.
- Preserve consumer-first rollout compatibility: while the proof flag is off, bind the new home but omit the new proof field from the mailbox event.
- Preserve quota ordering so rejected inputs mutate neither home routing nor mailbox state.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
- `packages/assistant-runtime/src/hosted-runtime/turn-input.ts`
- `packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-turn-input.test.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
- `apps/cloudflare/DEPLOY.md`
- `agent-docs/operations/imessage-deliverability.md`

## Verification Plan

- Focused assistant-runtime selection and maintenance tests.
- Focused web Linq dispatch tests.
- Scoped `pnpm test:diff` across the changed runtime, web, and rollout documentation.
- Required coverage and security completion audits.
- Rerun ReviewGPT on the pushed PR head and continue until zero accepted findings.
