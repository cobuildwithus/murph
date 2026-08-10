# Paused native companion access

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Let a non-suspended member whose own billing is paused open the native
  companion and keep its existing health-sync connection usable, while
  preserving the ordinary active-access gate for assistant/model work and
  other paid product authority.

## Success criteria

- Companion admission, Junction token refresh, onboarding projection, sync
  status, and companion health-data ingress accept paused members.
- Suspended members and non-paused inactive billing states remain blocked with
  their existing stable errors.
- Historical launch consent remains required and mandatory launch request and
  response shapes do not change, so existing iOS and Android builds recover
  after a Web deployment without an app release.
- Optional meal-photo capture remains paid-access gated, and its enrollment or
  activation denial no longer presents as whole-account loss to released iOS
  builds.
- Focused regression tests, Web typecheck, required review gates, and exact-head
  CI pass without unresolved accepted findings.

## Scope

- In scope: the companion-specific member-access predicate, bearer-auth helper,
  native launch/sync route wiring, focused tests, and durable companion access
  documentation, plus feature-scoped mapping for paid meal-photo setup denial.
- Out of scope: canonical assistant/runtime entitlement, browser billing
  recovery, Stripe state, native client code, and paid meal-photo capture
  authority.

## Constraints

- Technical constraints: keep Privy bearer verification, administrative
  suspension, member binding, launch consent, and device-connection lifecycle
  checks unchanged; do not add persisted state or a second entitlement owner.
- Product/process constraints: access to the companion shell and existing
  health sync must not imply renewed billing or paid AI access; preserve
  compatibility with already-released native clients.

## Risks and mitigations

1. Risk: a general entitlement relaxation re-enables paid runtime work.
   Mitigation: add one companion-owned predicate and use it only on native
   companion launch and health-sync boundaries.
2. Risk: admission succeeds but a later mandatory launch request still returns
   `HOSTED_ACCESS_REQUIRED`.
   Mitigation: trace the existing client launch sequence and cover admission,
   sign-in token, onboarding, and status with focused tests.
3. Risk: paused access bypasses suspension or health-data consent.
   Mitigation: preserve the existing suspension assertion and route-local
   consent checks, with negative regression cases.

## Tasks

1. Add the narrow paused-companion access derivation and bearer-auth wrapper.
2. Route mandatory companion launch and health-sync endpoints through it.
3. Add focused access and route regressions; update the durable companion
   architecture/security contract.
4. Run focused verification, commit and push the exact candidate, open the PR,
   and complete preliminary specialist ReviewGPT, final ReviewGPT, and CI.

## Decisions

- Ship this as a Web/backend compatibility change. No native request, response,
  error, or state-machine contract changes.
- Keep meal-photo capture enrollment and upload on active paid access because
  they can authorize assistant/model processing and are not required to open
  or sync the companion.

## Verification

- Passed: focused Vitest suites for companion member access, bearer auth,
  admission, sign-in token, onboarding, status, health-data ingress, and
  meal-photo paid-boundary mapping (5 files, 172 tests).
- Passed: `pnpm --dir apps/web typecheck`.
- Passed: `git diff --check` and changed-line direct-identifier review; only
  pre-existing synthetic fixtures appeared in whole-file scanning.
- Required exact-head GitHub Actions and both ReviewGPT stages.
