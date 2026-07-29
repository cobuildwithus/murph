# Onboarding choice-point final-review remediation

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Resolve the three accepted production-path findings from final ReviewGPT
  round one on PR #1061 without adding another lifecycle, session, retry, or
  routing owner.

## Success criteria

- Run the exact permission-bound check-in in the existing fresh, ephemeral,
  one-shot Codex shape while replaying canonical conversation history and
  preserving the ordinary session's resume state.
- Treat unreadable canonical onboarding authority as retryable unavailability;
  consume the one-shot only when a successful read proves ineligibility.
- Derive corrected Linq conversation identity from the canonical home-route
  participant lookup key, with the existing member phone key only as a legacy
  fallback.
- Add production-faithful regression coverage, pass canonical verification and
  CI on the pushed head, and obtain a zero-finding remediation ReviewGPT round.

## Scope

- In scope: the existing assistant-engine permission turn and authority gates,
  Web Linq route authority, their focused tests, and the PR completion record.
- Out of scope: new durable state, schedulers, provider-thread persistence,
  routing tables, or a separate goal/check-in subsystem.

## Verification

- Focused provider/app-server, cron/outbox authority, and Web route/session
  tests plus typechecks.
- Canonical `pnpm test:diff` and `pnpm verify:acceptance`.
- Exact-head CI, final ReviewGPT remediation round, and mergeability proof.

## Evidence

- Focused assistant-engine regression suite passed: 590 tests across seven
  files.
- Focused Web Linq route suite passed: 41 tests.
- Assistant-engine and Web typechecks passed.
- `pnpm test:diff` passed, including all affected package tests, typechecks,
  the Web production build, and Cloudflare Node and Workers suites.
- `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance` passed in the isolated
  Testbox lane, including coverage and package-boundary verification.
- `git diff --check` and the final identifier-leak inspection passed.
- Exact-head CI, the ReviewGPT remediation round, and mergeability proof remain
  PR-lane gates after this scoped commit is pushed.
Completed: 2026-07-29
