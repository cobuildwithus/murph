# Batch 2 / Agent 8

Implement the greenfield onboarding/billing/webhook lifecycle migration.

Worker rules:

- You are one implementation worker in a parent-orchestrated `codex-workers` batch.
- This lane runs in the sibling repo clone on clean `main`, not in the live dirty checkout.
- `AGENTS.md` and the repo workflow docs apply in full.
- Stay inside the owned paths below. If a required change clearly belongs outside them, stop and report the blocker instead of widening scope.
- Do not edit `agent-docs/exec-plans/**`, `AGENTS.md`, or the worker-pack files.
- Do not create commits, run `scripts/committer`, run `scripts/finish-task`, push, or launch nested workers/subagents.
- Run only focused in-lane verification that is truthful for your owned paths. Leave merged-scope verification, repo-wide verification, and completion audits to the parent orchestrator.
- Before writing, read the current file state carefully and preserve adjacent edits.
- In your final report, list: files changed, final lifecycle model, removed legacy assumptions, focused verification run, blockers or likely merge risks.

Owned paths only:

- `apps/web/src/lib/hosted-onboarding/member-activation.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-transport.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-dispatch-payload.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-receipt-codec.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-receipt-dispatch.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-receipt-engine.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-receipt-store.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-receipt-transitions.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-receipt-types.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-receipts.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-*.ts`
- `apps/web/src/lib/hosted-onboarding/billing-success-service.ts`
- `apps/web/src/lib/hosted-onboarding/lifecycle.ts`
- `apps/web/app/api/hosted-onboarding/**`
- `apps/web/app/api/settings/email/sync/route.ts`

Do not modify outside those paths.

Target architecture:

- outbox rows are the canonical lifecycle anchor
- webhook receipts are retry journals only, not a second dispatch lifecycle authority
- no staged payload control plane
- no web-side managed-user crypto warmup/provisioning
- verified email sync writes canonical web-owned facts, not hosted-execution env

Required changes:

1. Remove staged dispatch payload assumptions from webhook and onboarding flows.
2. Ensure every Cloudflare-bound execution intent is represented by canonical outbox facts only.
3. Keep webhook receipts as retry journals for receipt-local side effects only.
4. Remove web-side managed-user crypto warmups / provisioning hooks from onboarding and billing flows.
5. Change verified email sync to update canonical web-owned authorization facts, not user env.
6. Keep activation/outbox behavior explicit and idempotent.
7. Keep Stripe billing monotonic and lifecycle logic sharp under the new owner model.
8. Update route tests and focused reconciliation tests.

Implementation style:

- Prefer explicit ownership and fail-closed behavior.
- Delete helper layers that only existed for staged payloads or env sync.
- No rollout-era compatibility behavior.
