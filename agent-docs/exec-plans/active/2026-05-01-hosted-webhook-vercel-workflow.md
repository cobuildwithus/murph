# hosted-webhook-vercel-workflow

Status: active
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Move hosted onboarding webhook execution onto a Vercel Workflow path so provider webhook acceptance only depends on durably enqueueing the workflow, while the workflow owns provider validation, mailbox append, and runner nudge retries.

## Success criteria

- Linq and Telegram webhook route handlers start a Vercel Workflow run instead of doing all webhook work in the request handler.
- Workflow steps preserve existing provider verification, mailbox append/idempotency, side-effect, and runner nudge behavior.
- Runner nudges remain required for wake-appended active-member events and retry inside Workflow instead of returning success after a failed handoff.
- Tests cover successful workflow enqueue and start failure behavior for both providers, plus the workflow step behavior.
- Docs describe Vercel Workflow as the web-side durable webhook executor and Cloudflare Durable Objects as the per-user runner coordinator.

## Scope

- In scope: hosted onboarding Linq/Telegram webhook routes, shared hosted webhook service/wake code, Vercel Workflow SDK setup, focused tests, architecture/runtime docs.
- Out of scope: Stripe webhook behavior, Cloudflare Durable Object state machine changes, live deployment configuration outside committed code/docs.

## Constraints

- Technical constraints: keep provider signature/secret validation before mailbox side effects; keep mailbox/Postgres as canonical product truth; keep workflow arguments serializable; do not store secrets in docs or tests.
- Product/process constraints: preserve unrelated dirty tree changes; update lockfile for any dependency change; run focused tests/typecheck where possible.

## Risks and mitigations

1. Risk: Raw webhook payloads and headers become Workflow input/state if the full webhook is wrapped.
   Mitigation: pass only the minimum raw fields required for provider verification and document the privacy tradeoff; never add secrets or authorization headers to logs.
2. Risk: Workflow step retries duplicate mailbox side effects.
   Mitigation: rely on existing provider event idempotency and duplicate response behavior, and keep runner nudge idempotent.
3. Risk: Workflow SDK setup changes Next build behavior.
   Mitigation: use the official `withWorkflow` wrapper and focused route/service tests before handoff.

## Tasks

1. Inspect current webhook route, service, and test seams.
2. Add Workflow SDK dependency/config and define provider-specific webhook workflows.
3. Convert routes to start workflows and update service entrypoints/steps.
4. Update tests and docs.
5. Run focused verification and required review passes.

## Decisions

- Use Vercel Workflow for Linq/Telegram onboarding webhook execution, with the route reduced to raw request capture plus durable workflow start.
- Keep Cloudflare Durable Objects as the per-user runner coordinator; Workflow only retries the web-side webhook processing and nudge handoff.
- Provider verification and mailbox append run inside Workflow steps, which means raw provider bodies and verification headers are serialized into Workflow state. This is the explicit tradeoff for making the full webhook durable.
- Permanent provider validation failures become Workflow `FatalError`s; retryable hosted errors and infrastructure errors retry as Workflow step failures.

## Verification

- Commands to run: focused Vitest for hosted onboarding webhook route/service/idempotency/handoff tests; `pnpm --dir apps/web lint`; `pnpm docs:drift`; `git diff --check`; typecheck if current unrelated drift allows it.
- Expected outcomes: focused tests pass; lint/docs/diff pass or documented unrelated blockers.
- Passing so far: `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-execution-handoff.test.ts apps/web/test/hosted-onboarding-webhook-workflows.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts apps/web/test/hosted-onboarding-linq-route.test.ts apps/web/test/hosted-onboarding-telegram-route.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-onboarding-linq-webhook-auth.test.ts`
