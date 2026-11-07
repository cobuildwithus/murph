# Explain bounded Stripe fixture rejection categories

Status: completed
Created: 2026-11-02
Updated: 2026-11-02

## Goal and protected invariant

Distinguish provider request, payment, and fixture-input rejection categories in
the existing official Checkout fixture failure. Keep provider response bodies,
messages, identifiers, URLs, credentials, and unrecognized values private.
Preserve fixture requests, success/failure, ownership checks, polling, cleanup,
process lifecycle, timeouts, and the existing 8 KiB per-stream bound.

## Owner and evidence

The existing test-only `runOfficialStripeCheckoutFixture` captures stdout and
stderr and emits an allowlisted failure through `HostedStripeBillingLiveError`.
Its composed sanitizer tests prove step/status reporting but discard the JSON
error category. Distinct synthetic parameter and payment rejections currently
produce the same diagnostic. Extend this existing boundary, with no new state,
monitoring infrastructure, exported API, dependencies, provider call, or retry.
The live rejection's underlying cause remains unknown; this is targeted telemetry.

Stripe CLI 1.45.1 formats `RequestError` as a fixed status prefix followed by the
JSON response body. Its fixture executor returns the failed request error.
Official sources: https://github.com/stripe/stripe-cli/blob/v1.45.1/pkg/requests/base.go
and https://github.com/stripe/stripe-cli/blob/v1.45.1/pkg/fixtures/fixtures.go.
Stripe error fields: https://docs.stripe.com/api/errors and
https://docs.stripe.com/error-codes. Parse only the already bounded complete
stderr at the anchored prefix. Never search messages for lookalikes.

## Scope and decisions

- Ask ReviewGPT to implement a small, closed-category diagnostic and composed tests.
- Emit only finite source-defined error type/code/fixture-parameter categories;
  missing, malformed, unsupported, partial, and truncated evidence stay unknown.
- Preserve all existing behavior and output bounds. Diagnostic extraction must
  never replace the original failure with a parser exception.
- Reuse existing Frog entry `20261022103239-stripe-checkout-fixture`; no duplicate.
- Internal proof tooling only; no member-visible UX or changelog entry.
- No provider-mutating rerun, direct production write, or production secret access.
- Current workflow admits live provider execution only on protected-main schedules;
  PR and main-push checks are hermetic. Follow executable policy where older
  verification prose still describes live execution on trusted PRs.
- Existing reviewed PR4399 remains deployed and under its separate observation.

## Tasks and verification

1. ReviewGPT author implementation and focused synthetic tests at the public sandbox boundary.
2. Run new tests against unchanged source to expose the missing distinctions;
   apply source and prove success, malformed/private/truncated input, split pipes,
   timeout, startup failure, and completion behavior remain correct.
3. Run focused hosted billing tests, Web typecheck/lint, complexity and doc guards.
4. Parent review, scoped commit, draft PR, pushed-candidate ReviewGPT and required CI.
5. Merge and canonical deployment after gates pass; verify serving revision and
   observe read-only for four hours through the existing same-chat heartbeat.

## Deployment and outcome limits

Test-only failure formatting is compatible with current Web and Worker releases;
no schema, runtime protocol, provider request, or migration changes. Synthetic
proof establishes formatting and privacy, not the cause of a live rejection.
Only a scheduled or separately authorized hosted matrix can exercise the new
provider categories. Silence cannot close the unresolved billing failure.

## Progress

- Isolated checkout based on current verified main; existing relevant source is unchanged.
- Baseline: 48 hosted billing support tests pass; Web typecheck passes. Local Node is 24.14.1 while the manifest requests 24.22.1; exact-head CI remains required for the supported runtime.
- ReviewGPT authored the exact source/test patch in https://chatgpt.com/c/6ae8df6b-30e0-83e9-8e6f-9286e3884bb0; the parent inspected and applied it.
- Fourteen open PRs inspected; none touch either intended source/test file.
- Before: all nine new composed category assertions fail against unchanged source.
- After: 119 focused billing tests pass (88 support, 27 projection waiter, four Checkout route tests).
- Web typecheck and Web Oxlint pass; lint has existing warnings outside changed files.
- Complexity guard passes and excludes test paths; parent inspected the bounded private formatter and close-handler extension directly. No new runtime hotspot.
- Docs drift and diff whitespace checks pass. Parent review found no private output, additional requests, lifecycle changes, or exported parser.
- Implementation is complete. Exact pushed-head review, CI, merge, canonical admission and observation remain delivery gates tracked in the PR and automation state; no live recovery claim.
Completed: 2026-11-02
