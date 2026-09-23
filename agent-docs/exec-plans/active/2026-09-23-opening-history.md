# Scope opening replies to the current account

Status: active
Created: 2026-09-23
Updated: 2026-09-23

## Outcome and invariant

Restore the existing quick second onboarding reply after account deletion and recreation in the same direct chat. Preserve the two-reply cap, pending-claim exclusion, chat-lock recheck, access checks, exact-event replay, and confirmed canonical welcome requirement.

## Cause and smallest correction

Retained accepted delivery rows outlive account deletion. The opening reader currently counts the entire chat history, so an earlier account consumes the new account's allowance. Scope the existing bounded reader to the canonical current member creation time, using a single database query. Keep operational latency traces out of business authority; do not delete delivery evidence or add counters/state.

## Product UX patch

Outcome: recreated accounts can use the existing Web opening continuation. Reaches: direct text conversations whose immediately prior confirmed reply is the canonical welcome. Proof: real PostgreSQL lifecycle fixture, existing duplicate/replay/access tests, unchanged model input, and production canary after managed Web release. Existing accounts that exhausted their allowance continue through the normal runtime.

## Verification and delivery

- Reproduce retained old deliveries plus a new account in PostgreSQL; prove the old rows cannot consume its allowance and a current pending claim still can.
- Focused unit tests, Web typecheck, lint, complexity and docs checks.
- Parent review, exact-head CI and final ReviewGPT; managed Web deployment and canary.

## Status

Implementation and focused proof in progress. No production change or latency improvement claimed yet.
