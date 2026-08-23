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

## Scope

- In scope: recognize the exact query-bound progression, resume the existing
  safe action loop, add focused unit and real-Chromium coverage, update the
  directly affected verification contract, and require a passing protected
  post-merge canary.
- Out of scope: new action text, broad click heuristics, retries, provider-state
  repair, credential changes, Oura/WHOOP behavior, or weaker callback/cleanup
  assertions.

## Tasks

1. [x] Prove the live two-step consent mechanism with content-free diagnostics.
2. [x] Implement the smallest exact-step progression rule and regression
   coverage.
3. Run focused verification, ReviewGPT, and exact-head CI in a follow-up PR.
4. Merge and require a successful exact post-merge protected Garmin canary.

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

## Verification

- Focused browser-runner unit suite, including direct route departure and a
  partial-marker failure.
- Real headed-Chromium exact-route, nearby-route, and content-free checkbox
  proof.
- Hosted Web typecheck, docs drift, diff/privacy checks, ReviewGPT, exact-head
  required CI, and the protected post-merge Garmin canary.

Completed local proof:

- Browser-runner unit suite: 37 passed.
- Real headed-Chromium smoke: 7 passed.
- Hosted Web typecheck: passed.
- Docs drift and diff checks: passed.
