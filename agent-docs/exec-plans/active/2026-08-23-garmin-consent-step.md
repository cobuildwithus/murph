# Complete Garmin's second OAuth consent step

Status: active
Created: 2026-08-23
Updated: 2026-08-23

## Goal

- Make the protected Junction Garmin canary complete Garmin's observed two-step
  OAuth consent flow without broadening provider actions or weakening callback,
  persisted-state, disconnect, or deregistration proof.

## Root-cause evidence

- The exact merged canary selects all three data-sharing checkboxes and clicks
  `Save` once, then fails because the pathname remains `/partner/oauthConfirm`.
- A content-free Kernel reproduction proved that `Save` sends a Garmin POST and
  follow-up GET, both HTTP 200, and advances the same pathname by adding both
  `permissionsUpdated` and `selectedCapabilities` query parameters.
- On that advanced state, the checkbox and `Save` controls disappear. Two
  visible enabled buttons render: exactly one positive action and one action
  that matches both the positive and negative classifiers. The existing action
  loop would select only the positive action because negative matching wins.
- PR #2175 merged the exact step recognition. Its protected-main canary proved
  that `Save` now advances, but the positive confirmation action remained on
  the same route long enough for the loop to click it repeatedly until the
  parent killed the browser child at its outer timeout. Earlier runs failed in
  roughly 80 seconds at the first `Save`; the merged run lasted roughly eight
  minutes inside the browser proof and ended with an opaque `SIGTERM`, proving
  the progress-reset defect rather than the original selection-step defect.
- PR #2182 submitted the positive confirmation action once. Its exact
  protected-main canary failed after the bounded 15-second confirmation window
  because Garmin remained on the advanced consent route. The shorter,
  phase-specific failure proves that repeated submission is fixed, but the
  existing URL-only observation cannot distinguish an ignored click from a
  same-route DOM transition.
- PR #2187 added that content-free observation. Its protected-main run showed
  no recognized Garmin actions and three unrelated Murph actions while the
  browser was already on Murph home, proving Garmin departed during the
  asynchronous terminal surface sample. The helper then threw from its stale
  pre-sample route state instead of honoring the current route.
- PR #2188 fixed that race. Its protected-main run completed authorization,
  callback, connected-state, and persisted-reload proof, then exposed a later
  cleanup race: `DOMContentLoaded` made the server-rendered Disconnect button
  visible before its client handler was ready, so the click opened no dialog.

## Scope

- In scope: recognize the exact query-bound progression, resume the existing
  safe action loop, add focused unit and real-Chromium coverage, add
  content-free stalled-confirmation diagnostics, update the directly affected
  verification contract, and require a passing protected post-merge canary.
- Out of scope: new action text, broad click heuristics, retries, provider-state
  repair, credential changes, Oura/WHOOP behavior, or weaker callback/cleanup
  assertions.

## Tasks

1. [x] Prove the live two-step consent mechanism with content-free diagnostics.
2. [x] Implement the smallest exact-step progression rule and regression
   coverage.
3. [x] Run focused verification, ReviewGPT, and exact-head CI in PR #2175.
4. [x] Merge PR #2175 and inspect its exact protected-main Garmin canary.
5. [x] Submit the confirmation action once, run the follow-up completion gates,
   merge PR #2182, and inspect its exact post-merge protected Garmin canary.
6. Capture the stalled post-click surface without provider content, use that
   evidence for the smallest correction, and require a successful exact
   post-merge protected Garmin canary.

## Decisions

- Keep the existing exact Garmin host/path gate and exact three-checkbox/
  one-`Save` gate for the selection step.
- Treat only the joint presence of `permissionsUpdated` and
  `selectedCapabilities` as the observed same-route progression. A partial
  marker pair fails closed.
- Do not add the positive second-step action to a Garmin-specific allowlist;
  reuse the existing positive/negative action classifier that already proves
  exactly one safe action on the live surface.
- Preserve the one-shot `Save` effect; the wait succeeds on either the observed
  same-route progression or route departure and never clicks `Save` again.
- Preserve the existing positive/negative classifier for the advanced state,
  but submit its selected positive action only once and require route departure
  within the existing 15-second progress window. A stalled confirmation fails
  with its redacted Garmin phase instead of resetting the timer through clicks.
- After a terminal surface sample, re-read the current route before throwing.
  A departure during that asynchronous sample continues to the existing
  callback proof; unchanged, invalid, and regressed Garmin states still fail
  closed.
- Before disconnect cleanup, require the reloaded connect page's load boundary
  so the visible server-rendered action has its client handler.

## Verification

- Focused browser-runner unit suite, including direct route departure and a
  partial-marker failure.
- Real headed-Chromium exact-route, nearby-route, and content-free checkbox
  proof.
- Hosted Web typecheck, docs drift, diff/privacy checks, ReviewGPT, exact-head
  required CI, and the protected post-merge Garmin canary.

Completed local proof:

- Browser-runner unit suite: 38 passed.
- Real headed-Chromium smoke: 7 passed.
- Hosted Web typecheck: passed.
- Docs drift and diff checks: passed.
