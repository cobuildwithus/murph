# hosted-webhook-vercel-workflow

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Add a privacy-preserving Vercel Workflow fallback for hosted onboarding webhook runner nudges, so provider webhook acceptance depends on the local request path verifying and appending the encrypted mailbox row plus either a direct runner nudge or a durable pointer-only nudge retry.

## Success criteria

- Linq and Telegram webhook route handlers keep provider verification and mailbox append in the request/service path.
- Raw provider bodies, message content, provider verification headers, and provider secrets are never Workflow inputs.
- Workflow input is limited to an opaque mailbox item id and provider source after the encrypted mailbox row already exists.
- Runner nudges remain required for wake-appended active-member events; if direct nudge is not accepted, Workflow retries only the nudge by mailbox pointer.
- Tests cover direct nudge success, pointer-only fallback enqueue, workflow start failure behavior, and workflow step retry/fatal behavior.
- Docs describe Vercel Workflow as the pointer-only web-side nudge retry owner and Cloudflare Durable Objects as the per-user runner coordinator.

## Scope

- In scope: hosted onboarding Linq/Telegram webhook service/wake code, pointer-only nudge workflow files, Vercel Workflow SDK setup, focused tests, architecture/runtime docs, and legal subprocessors copy.
- Out of scope: Stripe webhook behavior, Cloudflare Durable Object state machine changes, live deployment configuration outside committed code/docs.

## Constraints

- Technical constraints: keep provider signature/secret validation before mailbox side effects; keep mailbox/Postgres as canonical product truth; keep workflow arguments serializable and pointer-only; do not store secrets or raw provider payloads in Workflow state, docs, tests, or logs.
- Product/process constraints: preserve unrelated dirty tree changes; update lockfile for any dependency change; run focused tests/typecheck where possible.

## Risks and mitigations

1. Risk: Raw webhook payloads and headers become Workflow input/state if the full webhook is wrapped.
   Mitigation: do not wrap the full webhook. Verify and append locally, then start Workflow only with `{ mailboxItemId, source }` after a mailbox row exists.
2. Risk: Workflow step retries duplicate mailbox side effects.
   Mitigation: Workflow does not append mailbox rows or perform provider validation; it only looks up the mailbox owner by opaque id and retries the idempotent Cloudflare nudge.
3. Risk: Workflow SDK setup changes Next build behavior.
   Mitigation: use the official `withWorkflow` wrapper and focused route/service tests before handoff.

## Tasks

1. Inspect current webhook route, service, and test seams.
2. Add Workflow SDK dependency/config and define pointer-only nudge workflow.
3. Keep routes on the existing local service path; update service handoff to start Workflow only after direct nudge is not accepted.
4. Update tests and docs.
5. Run focused verification and required review passes.

## Decisions

- Do not use Vercel Workflow for full Linq/Telegram webhook execution because raw webhook bodies and verification headers can become Workflow state/log inputs.
- Keep Cloudflare Durable Objects as the per-user runner coordinator; Workflow only retries the post-append nudge handoff by opaque mailbox item id.
- Provider verification and mailbox append stay inside the local route/service request path.
- Missing mailbox pointers become Workflow `FatalError`s; unaccepted Cloudflare nudges become bounded Workflow `RetryableError`s.

## Verification

- Commands to run: focused Vitest for hosted onboarding webhook route/service/idempotency/handoff tests; `pnpm --dir apps/web lint`; `pnpm --dir apps/web typecheck`; `pnpm docs:drift`; `git diff --check`; dependency guard/audit checks for Workflow SDK addition.
- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-execution-handoff.test.ts apps/web/test/hosted-onboarding-webhook-workflows.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts apps/web/test/hosted-onboarding-linq-route.test.ts apps/web/test/hosted-onboarding-telegram-route.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-onboarding-linq-webhook-auth.test.ts`
- Passed: coverage worker rerun of `apps/web/test/hosted-execution-handoff.test.ts` plus `apps/web/test/hosted-onboarding-webhook-workflows.test.ts`.
- Passed: `pnpm --dir apps/web legal:pdf`, `pnpm --dir apps/web lint`, `pnpm docs:drift`, `git diff --check`, `pnpm deps:guard`, `pnpm deps:ignored-builds`.
- `pnpm --dir apps/web typecheck` passed before later unrelated dirty-tree edits, then failed after concurrent join-invite/Telegram settings edits changed `JoinInviteTelegramAccountSeed` expectations outside this task.
- Known unrelated blocker: `pnpm deps:audit` remains red on pre-existing non-Workflow advisories.
Completed: 2026-05-01
