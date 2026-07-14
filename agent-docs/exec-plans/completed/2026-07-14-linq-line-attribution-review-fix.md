# Linq Line Attribution Review Fix

## Goal

Preserve line-health attribution for routed Linq delivery outcomes without restoring caller-supplied route authority as an authorization input.

## Constraints

- Keep the Web-owned final authorization and atomic provider dispatch claim unchanged.
- Treat the line lookup key as optional post-send attribution only; it must never reject an outcome or authorize a send.
- Keep old and new runner/Web versions independently deployable.
- Add no new state owner, service, queue, dependency, or abstraction.

## Plan

1. Carry the selected delivery context's existing line lookup key in the outcome payload.
2. Prefer that optional key for outcome attribution while retaining the existing home-route fallback for old runners.
3. Strengthen regression coverage for line attribution and the single anchored voice-memo provider claim.
4. Run focused verification, required review follow-ups, commit to `main`, and immediately redeploy.

## Verification

- Focused assistant-runtime callback tests.
- Focused Web Linq delivery route tests.
- Affected typechecks and `git diff --check`.
- Follow-up coverage, deep-review, and security/privacy review.

## State

Active.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
