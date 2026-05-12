# Hosted Webhook Nudge Single Step

## Goal

Stop hosted webhook pointer workflows from supervising workspace checkpoint
progress after a Cloudflare runner nudge is accepted.

Success criteria:

- The Vercel webhook nudge workflow performs one durable runner-nudge handoff
  step and then completes.
- Accepted runner nudges remain the durable boundary; mailbox checkpoint
  publication stays owned by hosted runtime and idle-shutdown checkpointing.
- Old checkpoint-wait retry behavior is removed from tests and durable protocol
  docs.

## Constraints

- Preserve unrelated dirty work in the current checkout.
- Do not add new durable state, queues, polling loops, or Cloudflare protocol
  surfaces.
- Keep Workflow inputs pointer-only: `{ mailboxItemId, source }`.
- Keep existing nudge guardrails for missing items, already checkpointed items,
  older lane pointers, and temporarily unaccepted nudges.

## Plan

1. Remove checkpoint-wait execution from `hostedWebhookNudgeWorkflow`.
2. Delete the checkpoint-wait step and retry constants, unless a deploy-safety
   compatibility need appears while editing.
3. Update hosted webhook workflow tests to assert accepted nudge completion
   instead of checkpoint polling.
4. Update the hosted runtime protocol doc to describe nudge acceptance as the
   workflow completion boundary.
5. Run focused verification, typecheck, and required completion review.

## Verification

Planned:

- `pnpm test:diff apps/web/src/lib/hosted-onboarding/webhook-workflows.ts apps/web/src/lib/hosted-onboarding/webhook-workflow-steps.ts apps/web/src/lib/hosted-onboarding/webhook-workflow-types.ts apps/web/test/hosted-onboarding-webhook-workflows.test.ts agent-docs/references/hosted-runtime-protocol.md`
- `pnpm typecheck`
