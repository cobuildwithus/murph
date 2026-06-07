# Pulse Trial Usage Limit

## Goal

Update the Pulse Trial hosted AI usage allowance from $2.50 to $4.50.

## Scope

- Hosted billing plan policy constant and derived Stripe metadata.
- Hosted usage-gate expectations and trial-limit tests.
- User-facing trial allowance copy.
- Durable Pulse Trial product specs that cite the allowance.

## Constraints

- Keep Pulse Trial as a checkout offer, not a new plan or budget system.
- Preserve stale-trial denial and paid-conversion behavior.
- Do not touch unrelated assistant prompt/test edits in the working tree.

## Verification

- Prefer `pnpm test:diff` scoped to touched files if truthful.
- Run required completion audits for hosted billing/usage behavior.

## State

- Now: locating and updating the existing $2.50 references.
- Next: run focused verification and completion review.
