# Pulse Trial beta extension

Status: completed
Created: 2026-07-09
Updated: 2026-07-09

## Goal

- Give every eligible Murph Pulse beta trial exactly seven additional days through a protected Ops workflow that can be previewed, applied once, and safely retried.

## Success criteria

- Preview reports aggregate candidate and skip counts without exposing member or Stripe identifiers.
- Apply extends each eligible Stripe trial from its existing end by exactly seven days and reconciles the matching local billing and AI-usage period ends without resetting usage or trial start.
- A stable campaign marker makes repeated apply attempts idempotent and repairs local state after a Stripe-success/local-write failure without extending Stripe twice.
- Trial extension and “Start paid Pulse” serialize Stripe mutations per member so a concurrent paid conversion cannot be overwritten by a stale extension read.
- The Ops route remains authenticated and mutation-origin protected, and focused tests cover eligibility, ordering, exact extension, retry recovery, and route authorization.
- The UI is implemented through the repository-required Fable lane and verified at desktop and mobile widths.
- Required tests, typecheck/verification, completion audits, ReviewGPT, and PR checks pass.

## Scope

- In scope: one fixed beta-extension campaign, serialized Stripe subscription mutation, local billing and allowance-window reconciliation, protected Ops API/page, aggregate operator feedback, focused tests, and durable Ops documentation.
- Out of scope: changing the default ten-day trial policy, resetting usage, re-enrolling expired or paid members, adding a new billing plan/table/background job, deploying, merging, or applying the campaign in production before the code is deployed.

## Constraints

- Technical constraints: Stripe remains the subscription authority; mutation is Stripe-first; persisted trial start, redemption policy, usage spend, block state, and usage ledger events remain unchanged; no direct identifiers in responses or logs.
- Product/process constraints: default to the smallest fixed campaign tool; preview before apply; require explicit confirmation; delete the campaign surface after production application and reconciliation; delegate user-facing `apps/web` UI implementation to Claude Fable.

## Risks and mitigations

1. Risk: A retry or double-click grants fourteen days.
   Mitigation: Store a fixed campaign marker in existing Stripe subscription metadata, use a deterministic Stripe idempotency key, and treat marker-present retries as reconciliation only.
2. Risk: Stripe succeeds but the local database write fails.
   Mitigation: On retry, read the marked Stripe end and repair the local billing and matching usage-period ends without another Stripe extension.
3. Risk: Local eligibility is stale or references the wrong Stripe object.
   Mitigation: Revalidate trial status, future end, customer ownership, subscription ownership, plan, and offer against Stripe before any mutation.
4. Risk: Extending a trial accidentally grants a fresh usage budget or changes cohort dates.
   Mitigation: Preserve period start and spend; update only the current trial, billing-period, and matching usage-period end timestamps.
5. Risk: A member starts paid Pulse after the extension reads Stripe but before it writes a future trial end.
   Mitigation: Serialize both member-scoped Stripe mutations under the existing hosted-member row lock and re-read the subscription inside the extension lock before updating it.

## Tasks

1. Implement a small campaign-specific extension service with preview/apply and aggregate results.
2. Add the protected Ops API route and focused route/service coverage.
3. Delegate the Ops page and index entry to Claude Fable, then review and integrate the result.
4. Add UI behavior coverage and verify the page in a browser at desktop and mobile widths.
5. Run scoped/full verification and mandatory security, frontend, and coverage passes.
6. Finish the plan-bearing commit, open a draft PR, run ReviewGPT and CI to zero accepted findings, and document the post-deploy production apply/removal steps.

## Decisions

- Extend from Stripe's existing `trial_end`, not from the current time and not by resetting the trial.
- Use the fixed campaign key `pulse-beta-extension-2026-07` and a fixed seven-day delta.
- Keep idempotency in Stripe metadata rather than adding a database table or schema field.
- Reuse the existing hosted-member row lock as the single serialization primitive for trial extension and paid conversion.
- Keep responses count-only; detailed per-member outcomes stay internal to control flow and are not logged.

## Verification

- Focused Vitest: four touched suites pass with 65 tests covering service, paid-conversion serialization, route authorization, and Ops UI states.
- TypeScript and lint: standalone web TypeScript check and focused ESLint pass.
- Direct proof: a count-only production read confirmed current active trials have matching usage periods; no identifiers or secret values were retrieved or emitted.
- Security/privacy: the first pass found a paid-conversion race; the shared lock and locked Stripe re-read fixed it, and the required re-audit returned no medium-or-higher findings.
- Frontend: accepted preview fail-closed, outcome-copy, live-status, partial-apply recovery, and Ops-index findings were fixed through the required Fable lane. Final re-audit returned no actionable findings; authenticated desktop/mobile browser rendering remains a documented gap, with DOM interaction coverage in place.
- Privacy/shape: changed-file personal-identifier, sensitive-pattern, and whitespace scans pass.
- Owner verification: final truthful `pnpm test:diff` passes dependency/boundary/architecture/log guards, dev smoke, focused TypeScript/page generation, the complete hosted-web suite (4,055 passed, 9 skipped), ESLint (nine unrelated pre-existing warnings), and the Next production build with the new Ops route/page.
- Remaining gates: scoped plan-closing commit; draft PR; `pnpm review:gpt pr-review` to zero accepted findings; green PR checks and merge-conflict proof.
Completed: 2026-07-09
