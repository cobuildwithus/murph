# Hosted onboarding retry and success-state fixes

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Fix the reported hosted onboarding/runtime bugs with small, durable changes:
  Linq retries must be idempotent, missing crypto roots must surface as 404,
  checkout success must wait for trusted billing/session state, device-sync completion must not trust unsigned query state, and Linq binding retry must not reuse an aborted transaction.

## Success criteria

- Each reported bug has a focused code fix and regression coverage.
- Fixes reuse existing hosted-web ownership/state seams rather than introducing new product state or broad abstractions.
- Required hosted-web verification, typecheck, and completion reviews run or any blocker is documented.

## Scope

- In scope: `apps/web` hosted onboarding, crypto-context route, Stripe checkout success UI/API state, device-sync completion state helpers, Linq binding retry behavior, and focused tests.
- Out of scope: broad hosted onboarding redesign, schema migrations unless unavoidable, new billing products, or unrelated active hosted/cloudflare/assistant work.

## Constraints

- Technical constraints: preserve web-owned hosted control facts, fail closed across trust boundaries, keep retry/idempotency behavior explicit, avoid `as any`/lazy casts, and avoid logging sensitive identifiers or payloads.
- Product/process constraints: preserve unrelated dirty worktree edits, coordinate with active hosted Linq rows, run required checks/reviews, and use `scripts/finish-task` if a scoped commit is safe.

## Risks and mitigations

1. Risk: A retry fix could accidentally drop legitimate first-contact onboarding messages.
   Mitigation: key idempotency to durable receipt/member state and cover duplicate/retry cases with tests.
2. Risk: Success pages could regress happy-path onboarding.
   Mitigation: verify against trusted server/session state and keep pending states explicit.
3. Risk: Active worktree overlap could block a scoped commit.
   Mitigation: keep edits limited to clean `apps/web` files and stop rather than mixing unrelated changes.

## Tasks

1. Trace each reported bug to its owning route/helper/service.
2. Implement minimal idempotency, status mapping, signed/trusted state, and transaction-boundary fixes.
3. Add focused regression tests for each changed behavior.
4. Run hosted-web verification/typecheck and completion audits.
5. Close the plan and commit with the scoped task path if the dirty worktree allows it.

## Decisions

- Use existing hosted-web durable state and signed callback/session checks; do not add new persisted state unless tracing proves an existing seam cannot represent the required fact.

## Verification

- Commands to run: focused `apps/web` tests, `pnpm typecheck`, and either truthful `pnpm test:diff <touched paths>` or `pnpm verify:acceptance` per hosted-web routing.
- Expected outcomes: all focused bug regressions pass; any broader pre-existing failures are named with evidence.
Completed: 2026-05-09
