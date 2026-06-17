# Home Initial Visit Existing Login

## Goal

Prevent existing hosted members who authenticate from the landing page from seeing
the first-visit `/home?initialVisit=true` welcome dialog, while preserving the
dialog for true first-time signup/onboarding completions.

## Context

- Product guidance says signup-oriented accessible-stage landing auth may route
  to `/home?initialVisit=true`.
- Login-oriented completion should route to ordinary `/home`.
- The current unified landing CTA defaults to the initial-visit route after any
  accessible-stage auth completion, so existing accounts can see first-run copy.

## Scope

- Hosted Privy completion result/payload.
- Landing auth redirect selection.
- Focused hosted-web tests for new and existing completion behavior.

## Verification Plan

- Focused app tests for landing auth completion and hosted Privy completion.
- App/web verification or truthful diff-aware verification per workflow routing.
- Required completion audits for auth/session and user-facing web behavior.

## State

- 2026-06-17: Implemented and verified. Hosted Privy completion now marks
  first-visit eligibility from server-side member creation/resolution, existing
  direct members are ineligible, and landing auth redirects trust that server
  flag for `/home?initialVisit=true`.
- Focused hosted-web tests, typecheck, lint, `git diff --check`, and
  `pnpm test:diff ...` passed. Lint still reports one unrelated pre-existing
  warning in `apps/web/app/api/internal/hosted-mailbox/fetch/route.ts`.
- Security/privacy review found no concrete issues. Frontend review found a
  split-login/new-signup edge case; fixed by letting the server eligibility flag
  win. Coverage audit added the existing-active-direct-member service test.
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
