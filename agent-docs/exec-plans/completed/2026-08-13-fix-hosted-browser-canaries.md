# Fix hosted browser canaries

Status: completed
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Restore the protected-main Junction and Stripe browser canaries by making
  their Playwright drivers follow the current product navigation contracts.

## Success criteria

- The Junction driver confirms the required Vital disclosure before waiting
  for the provider authorization redirect.
- The Stripe driver waits for a complete settings document instead of racing
  a committed-but-still-loading navigation.
- Focused support tests and affected Web/Cloudflare typechecks pass.
- Exact-head CI and required ReviewGPT gates pass before merge.
- Fresh protected-main canaries pass after merge, or any unrelated external
  blocker is reported with secret-safe evidence.

## Scope

- In scope: hosted-local Junction and Stripe browser drivers, focused proof,
  and the owning canary contract tests.
- Out of scope: provider business logic, production UI behavior, credentials,
  and unrelated canary scenarios.

## Constraints

- Technical constraints: preserve credential redaction and secret-free
  artifacts; do not weaken either live provider proof.
- Product/process constraints: pin fixes to the existing UI contracts, run
  ReviewGPT concurrently with PR CI, and merge only after the routed gates.

## Risks and mitigations

1. Risk: a driver-only workaround could bypass the journey under test.
   Mitigation: perform the same accessible button action a member must take
   and continue asserting the external provider and callback boundaries.
2. Risk: broader navigation waits could hide a broken settings response.
   Mitigation: require DOM readiness and validate the navigation response
   before asserting the settings projection.

## Tasks

1. Fix both browser-driver sequencing defects and add focused contract proof.
2. Run focused tests and affected typechecks, then inspect the full diff.
3. Commit, push, open the PR, and launch specialist/final ReviewGPT with CI.
4. Resolve accepted findings, merge, and monitor fresh main canaries.

## Decisions

- Keep production application code unchanged: both failures are stale browser
  automation assumptions, while the current member-facing contracts are valid.
- Keep distinct Junction display values for the disclosure button (`Whoop`) and
  the post-connect heading (`WHOOP`) because both are real UI contracts.
- Replace implementation-text billing checks with behavioral Page/Response
  doubles so branch and ordering regressions fail before the live lane.

## Verification

- Commands to run: focused Web support and hosted-local canary workflow tests;
  Web and Cloudflare typechecks; exact-head required GitHub checks; protected-
  main Junction and Stripe canaries after merge.
- Expected outcomes: deterministic local checks and both live canaries pass.
- Completed focused proof:
  - Connect page: 100/100 passed.
  - Hosted billing support: 13/13 passed.
  - Junction workflow: 6/6 passed.
  - Web, hosted-local harness, and Cloudflare typechecks passed.
  - Exact-head GitHub required checks passed.
- Review outcome:
  - Preliminary specialists found the WHOOP/Whoop selector mismatch and weak
    source-scan billing proof; both were accepted and corrected.
  - Final ReviewGPT round 2 performed a fresh full-patch audit and passed with
    no findings.
Completed: 2026-08-13
