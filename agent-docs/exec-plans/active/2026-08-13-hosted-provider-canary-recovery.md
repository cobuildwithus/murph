# Recover hosted Stripe and Junction live canaries

Status: active
Created: 2026-08-13
Updated: 2026-08-14

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

- In scope: the two hosted browser drivers, focused behavioral tests, their
  live-canary workflow contract, and the public Web Viewport Overflow workflow
  as the secret-free Ubuntu/Xvfb proof for the protected headed-browser shape.
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
   Mitigation: require the Home-only `Live Well` eyebrow and its sibling
   `Welcome to Murph` heading, then prove the ordering with a behavioral page
   double.
3. Risk: the public Xvfb proof adds a headed-browser failure owner to every pull
   request and main push.
   Mitigation: keep the proof secret-free and focused on a real
   `headless: false` Chromium launch plus page/title round trip, then run the
   pre-existing marketing overflow gate unchanged afterward.

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
- Reuse Web Viewport Overflow's existing Ubuntu Chromium installation for the
  public pre-merge Xvfb proof instead of adding another browser workflow. This
  intentionally makes the public workflow an owner of the protected canary's
  virtual-display boundary without exposing provider credentials.

## Verification

- Commands to run: focused hosted billing support and Junction runner/workflow
  tests; Web, Cloudflare, and hosted-local-harness typechecks; exact-head PR CI;
  fresh protected-main live workflows.
- Expected outcomes: deterministic local proof and actionable, fail-closed live
  provider results without seven-minute opaque waits.
- Observed before closure: focused runner and workflow tests, affected
  typechecks, the real Ubuntu headed-Chromium/Xvfb job, exact-head CI, and the
  preliminary specialist ReviewGPT pass are green. Final ReviewGPT and fresh
  protected-main live workflows remain required before this plan is complete.
