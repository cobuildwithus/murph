# Isolate viewport animation setup from unrelated CSP errors

Status: completed
Created: 2026-09-28
Updated: 2026-09-28

## Goal and protected invariant

Viewport proof reaches layout measurement when an unrelated script is blocked by
CSP. The animation-freeze stylesheet must actually apply, and blocked scripts
and styles must remain blocked.

## Smallest correction and scope

Use the existing page DOM to append the unchanged animation-freeze stylesheet
and inspect its own stylesheet result. Share this narrow setup with two browser
regressions. Keep external-request blocking and overflow assertions unchanged.
Reuse committed Frog report `20260916144024-viewport-proof-can`; issue binding
remains pending repository reconciliation.

## Proof and completion

- Reproduced a real script CSP violation racing Playwright style insertion in
  bundled Chromium: the style applied, but the helper rejected the script error.
- The allowed-style regression fails with the original helper. With the repair,
  allowed styles apply despite the blocked script; blocked styles still fail.
- Run both browser regressions, scoped ESLint, complexity and docs guards,
  parent review, required external review and exact-head CI.
- Verify merge-tree compatibility with the separate hover-proof candidate.
- Internal browser harness only; no product behavior, CSP policy, credentials,
  dependencies, runtime, or deployment changes.

## Verification outcome

Both synthetic Chromium CSP regressions pass. Restoring the previous helper makes
the allowed-style case fail on the real unrelated script policy violation.
Scoped ESLint and complexity guard pass (test-only file excluded by the metric).
Parent candidate review found no issues. Full viewport CI and required external
review remain landing gates; no merge or deployment is claimed.
Completed: 2026-09-28
