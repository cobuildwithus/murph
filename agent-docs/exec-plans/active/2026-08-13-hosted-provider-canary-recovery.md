# Recover hosted Stripe and Junction live canaries

Status: active
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Restore actionable protected-main hosted provider verification: eliminate the
  Starter activation navigation race and make the WHOOP live proof report a
  provider challenge promptly without bypassing authorization.

## Success criteria

- Starter activation waits for the committed authenticated Home surface before
  a subsequent settings read.
- The Junction browser runner races callback observation against authorization,
  detects a provider challenge without echoing sensitive page contents, and
  preserves the required real callback proof.
- Focused tests, affected typechecks, exact-head CI, and ReviewGPT pass.
- After merge, fresh protected-main Stripe succeeds; Junction either succeeds
  or fails promptly with an explicit external-challenge classification.

## Scope

- In scope: the two hosted browser drivers, focused behavioral tests, and their
  live-canary workflow contract.
- Out of scope: provider business logic, credentials, production auth flows,
  challenge bypasses, and weakening protected-main requirements.

## Constraints

- Technical constraints: preserve secret-safe diagnostics and fail-closed
  callback assertions; avoid network-idle sleeps and page-content logging.
- Product/process constraints: use exact accessible UI contracts, review the
  pushed head concurrently with CI, and merge only after required gates pass.

## Risks and mitigations

1. Risk: automation could hide a real provider authorization break.
   Mitigation: challenge detection only shortens and classifies failure; success
   still requires the exact Murph callback and persisted connected state.
2. Risk: a broader Home wait could make Starter proof depend on incidental UI.
   Mitigation: use the stable PageHeader title owned by the Home route and prove
   the ordering with a behavioral page double.

## Tasks

1. Add deterministic authorization/callback ownership and provider-challenge
   classification to the Junction runner with focused tests.
2. Replace the ineffective post-router load-state wait with a committed Home UI
   marker and strengthen the billing driver test.
3. Run focused tests/typechecks and inspect the privacy-safe diff.
4. Commit, push, open a PR, launch specialists/final ReviewGPT with CI, resolve
   accepted findings, merge, and monitor the next main canaries.

## Decisions

- Treat the repeated WHOOP failure as an external challenge boundary: a local
  headless Chromium probe received HTTP 403 with a Cloudflare Turnstile frame,
  while the Murph connect and callback preparation completed successfully.
- Do not land a Stripe-only timing workaround based solely on one failed run;
  preserve the real race fix because the current wait observes the old document
  lifecycle rather than the client-router Home commit.

## Verification

- Commands to run: focused hosted billing support and Junction runner/workflow
  tests; Web, Cloudflare, and hosted-local-harness typechecks; exact-head PR CI;
  fresh protected-main live workflows.
- Expected outcomes: deterministic local proof and actionable, fail-closed live
  provider results without seven-minute opaque waits.
