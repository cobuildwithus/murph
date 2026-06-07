# Pulse Trial Usage Limit

## Goal

Update the Pulse Trial hosted AI usage allowance from $2.50 to $4.50.

## Scope

- Hosted billing plan policy constant and derived Stripe metadata.
- Hosted usage-gate expectations and trial-limit tests.
- User-facing trial allowance copy.
- Join-page view coverage for the visible trial allowance/disclosure.
- Durable Pulse Trial product specs that cite the allowance.

## Constraints

- Keep Pulse Trial as a checkout offer, not a new plan or budget system.
- Preserve stale-trial denial and paid-conversion behavior.
- Do not touch unrelated assistant prompt/test edits in the working tree.

## Verification

- Prefer `pnpm test:diff` scoped to touched files if truthful.
- Run required completion audits for hosted billing/usage behavior.

## State

- Done: updated the Pulse Trial usage policy, Stripe metadata expectations, usage-gate/dashboard tests, visible join-page copy, and durable current-state docs to $4.50.
- Done: focused hosted-web verification passed, including lint, dev smoke, Vitest, and production build.
- Done: security/privacy, coverage, frontend, and final completion reviews completed; accepted findings were fixed.
- Next: close the plan and commit the scoped task changes.
Status: completed
Updated: 2026-06-06
Completed: 2026-06-06
