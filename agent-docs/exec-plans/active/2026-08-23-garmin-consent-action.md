# Automate the Garmin OAuth consent surface

Status: active
Created: 2026-08-23
Updated: 2026-08-23

## Goal

- Make the protected Junction Garmin canary complete the real Garmin OAuth
  consent screen unattended while preserving fail-closed authorization and all
  callback, persisted-state, disconnect, and deregistration proof.

## Evidence

- The headed Kernel change passed Garmin's prior Cloudflare challenge.
- The exact protected-main run then reached
  `https://connect.garmin.com/partner/oauthConfirm` and failed closed because it
  found three unchecked checkboxes and five unrecognized actions.
- A controlled protected retry plus a read-only, secret-safe attachment to its
  exact active Kernel profile proved that the page exposes one enabled positive
  `Save` button, one enabled negative `Cancel` button, and exactly three visible
  enabled checkboxes with no accessible names or surrounding label text.

## Scope

- In scope: inspect the exact consent control shape, add the narrowest Garmin-
  specific automation, focused regression coverage, and directly affected
  verification guidance.
- Out of scope: broad click heuristics, retries, CAPTCHA solving, credential
  changes, Oura/WHOOP flow changes, or weaker callback/cleanup assertions.

## Constraints

- Do not print or persist provider credentials, account identity, or raw page
  content.
- Bind any new automation to the exact trusted Garmin consent route and explicit
  required controls.
- Keep protected CI unattended and fail closed when the expected surface is not
  present.

## Tasks

1. [x] Inspect the exact consent surface with secret-safe diagnostics.
2. [x] Implement and test the smallest route-bound Garmin consent action.
3. Run focused verification, ReviewGPT, and exact-head CI in a follow-up PR.
4. Merge and require a successful exact post-merge protected Garmin canary.

## Decisions

- Do not add `Save` to the shared provider action allowlist: that would broaden
  automation across unrelated authorization pages.
- Bind the behavior to Garmin plus the exact trusted host and path. Require the
  observed exact checkbox and positive-action cardinality, select all three
  data-sharing checkboxes, and fail closed on any future shape change.
- Keep `Cancel`, generic links, raw page text, credentials, and account identity
  outside the automation and diagnostics.

## Verification

- Focused browser suite: 33 tests passed, including success only after all three
  boxes are selected and failure on changed checkbox or `Save` cardinality.
- Hosted Web typecheck passed.
- Workflow/config contract checks if their contract changes.
- `pnpm docs:drift`, `git diff --check`, privacy review, ReviewGPT, exact-head
  required CI, and the protected post-merge Garmin run.
