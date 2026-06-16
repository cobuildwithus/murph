# Join Initial Visit Redirect

## Goal

Fix the `/join` signup/linking flow so a signup-oriented completion that links Telegram or email lands on `/home?initialVisit=true`, preserving the first-visit welcome contract.

## Scope

- `apps/web/src/components/hosted-onboarding/**`
- Focused hosted onboarding tests under `apps/web/test/**`
- No schema, billing, provider webhook, or persisted-state changes expected.

## Constraints

- Preserve existing dirty hosted-onboarding edits and work with them, not against them.
- Keep the redirect rule simple: signup/access-stage completion should use the initial-visit home URL; ordinary login should continue to use plain `/home`.
- Avoid exposing local paths, identifiers, secrets, or raw account data in committed artifacts.

## Verification

- Run focused tests for the touched hosted onboarding/auth behavior.
- Run required `apps/web` verification lane or report a pre-existing blocker with focused proof.
- Run required completion audits for auth/session behavior and coverage.

## State

- Created 2026-06-16.
- Investigation in progress.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
