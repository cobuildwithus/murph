# Unify homepage phone-auth completion

Status: completed
Created: 2026-07-29
Updated: 2026-07-29
Review source: PR #1127 final ReviewGPT round 1

## Goal

- Make the homepage phone signup path follow the same in-place completion
  behavior as email and Telegram: keep the initiating phone action visible and
  busy, lock every competing action, and never replace it with a setup loader.

## Success criteria

- Successful homepage SMS verification delegates post-Privy completion to
  `useHostedAuthCompletion`.
- The phone code or manual-resume action remains mounted with an accessible
  spinner while completion is pending.
- Every phone input, resend, verification, reset, and auto-submit path is gated
  while another authentication method is completing.
- Completion failure restores a usable phone recovery state with a legible
  error.
- Focused tests, typecheck, frontend proof, exact-head review, and CI pass.

## Scope

- In scope:
  - Homepage `HostedAuthPanel` phone authentication.
  - Shared phone-controller gating needed to make the panel lock truthful.
  - Focused tests, design-catalog proof, and PR intent documentation.
- Out of scope:
  - Standalone phone-link finalization.
  - Invite-specific code reservation and confirmation.
  - Provider authentication protocol changes.

## Constraints

- Reuse `useHostedAuthCompletion`; do not add another completion owner.
- Preserve controller-owned finalization for standalone auth and link callers.
- Keep consent and redirect behavior unchanged.

## Tasks

1. Delegate the panel phone path to the shared completion owner and keep its
   current action mounted.
2. Gate the full phone interaction boundary, including in-flight send and OTP
   auto-submit races.
3. Add focused success, competing-method race, manual-resume, and recovery
   coverage.
4. Update the design catalog and PR affected-surface disclosure.
5. Run scoped verification, product review, final ReviewGPT remediation round,
   and exact-head CI.

## Decisions

- Keep standalone phone-link loading behavior unchanged; the homepage panel
  supplies the shared completion callback and is the only path changed here.
- Treat the external auth lock as a controller boundary, not only a disabled
  button prop, so stale async work cannot start a competing completion.
- Let delegated phone completion rethrow after the shared completion owner
  releases its lock, so the existing phone controller preserves account-conflict
  and retry recovery without adding another completion request owner.

## Verification

- Passed: four focused hosted-web Vitest files, 124 tests.
- Passed: `pnpm --dir apps/web typecheck:prepared`.
- Passed: scoped hosted-web ESLint and `git diff --check`.
- Passed: desktop and mobile `/design?tab=components` browser proof using the
  production phone verification and authenticated-resume presentations.
- Passed: exact-diff product-experience review with no findings.
Completed: 2026-07-29
