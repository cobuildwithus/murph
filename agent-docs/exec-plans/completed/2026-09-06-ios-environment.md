# Native Environment report and home entry

## Outcome and ownership

Members open a native Environment report from a compact home grade card.
Canonical Habitat records remain in the vault; existing web selectors and grade
rules remain the only scoring owner. The native client stores report data only
in memory. A bounded bearer-authenticated read projects the published core
replica, with current member access and consent checked before and after I/O.
No migration, background job, new dependency, or independent score store.

## Product UX

Feature: Home card opens a native report with overall and category grades,
recorded facts, targets, skipped and unknown details, and a web update handoff.
Cover sufficient, partial, empty, stale, unavailable, consent-required, and
account-switch journeys. Preserve all existing Health and meal setup paths.
Reuse the native adaptive cream/sage design and Dynamic Type. No generated art
is needed for this data report. Web's existing voice editor remains available.

## Plan

1. Reuse encrypted replica decoding and web grading for a narrow companion read.
2. Add native DTOs, epoch-fenced session loading, home card, and report page.
3. Prove backend auth/projection, native transport, stale-result rejection,
   simulator rendering and navigation; run relevant typecheck/build/tests.
4. Review full diffs, update scope owners, commit and report delivery gaps.

## Compatibility and evidence

Deploy the additive backend route before releasing iOS. Older servers yield a
retryable unavailable page; existing Health and Meals remain usable. No rollback
migration.

## Completed implementation and proof

- Added the bearer-authenticated core-replica projection and reused existing
  web grading, unit formatting, encryption, size limits, and identity checks.
- Added a native Home card, expandable Environment report, and web edit
  handoff. Report state lives only in the current authorized session.
- Home and report share one session-owned request. Sign-out cancels it;
  epoch guards discard stale results. Loading, preparing, unavailable, saved,
  empty, partial, consent recovery, and retry states are explicit.
- Backend focused Vitest: 48 tests passed across projection, route, existing
  Environment UI, drawer, and encrypted replica loader suites.
- Web typecheck, endpoint/decoder ESLint, docs drift, and complexity guard
  passed. Existing complexity hotspots did not increase.
- Native XcodeGen and simulator compilation passed. Initial transport,
  session, and UI run: 325 tests passed. After the cancellation correction,
  AppSession plus all seven Environment UI tests: 287 passed, zero failures.
- Simulator screenshots reviewed for Home, report, details, dark appearance,
  and accessibilityXXXL navigation. The large-text UI test reaches the web
  action; the decorative title is capped while report text continues scaling.
- SwiftFormat source lint passed with `swiftformat --lint . --exclude build`.
  The prescribed unfiltered command traversed downloaded package sources under
  the local derived-data folder and reported third-party formatting failures;
  repository sources are clean. No vendor code was changed.
- Independent local native deep-review covered both implementations. Its one
  accepted P2 cancellation-overlap finding is fixed and verified by a suspended
  request regression test. Re-review found no remaining serious issue.
- Parent diff, privacy, and whitespace inspection passed.

## Delivery boundaries

This task produces scoped local commits in the backend `feat/ios-environment`
and native `feat/environment-page` branches. Neither is deployed or released.
Authenticated production decoding and physical-device behavior are not proven
by the simulator fixtures. Deploy the backend before the app release.

The public changelog must accompany the eventual member-facing release. No
published entry is added for this unreleased local implementation; this is
not an internal-only exemption. No PR or source PR number exists yet.

Status: completed
Updated: 2026-09-06
Completed: 2026-09-06
