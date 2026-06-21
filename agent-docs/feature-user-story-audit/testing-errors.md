# Feature User-Story Testing Errors

Generated: 2026-06-21

Canonical source: `feature-status.csv`.

## Current Result

- Passed story rows: 191
- Blocked story rows: 24
- Failed story rows: 0
- Remaining not-started rows: 0

## Verification-Level Notes

- `pnpm --dir apps/web test:prepared` ran 2,772 tests: 2,764 passed, 7 skipped, and 1 failed in `apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`. The failure is a migration-list expectation that does not map to a tracker feature row; it expected the list without `2026062100_hosted_ai_usage_period_counter_backfill`.
- Eight read-only testing workers were launched first, but their child sandbox could not create Vitest SSR temp directories. Parent lane-level commands were then run and passed for tracker-referenced test evidence.

## Blocked Story Rows

| feature_id | area | status | observed error |
| --- | --- | --- | --- |
| settings-passkey-create | auth component | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| design-brand-guidelines | design | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| design-component-gallery | design | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| design-interactive-previews | design | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| design-tabbed-shell | design | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| home-feature-highlights | home | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| home-daily-assistant-demo | homepage | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| home-how-it-works-cards | homepage | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| home-persona-phone-demos | homepage | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| home-phone-chat-autoscroll | homepage | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| home-security-teaser | homepage | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| home-trust-pillars | homepage | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| linq-webhook-health | Linq | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| overview-design-active-experiment-banner | overview | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| overview-design-domain-card | overview | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| overview-design-profile-stats | overview | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| pitch-ask-live-link | pitch | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| pitch-product-step-panels | pitch | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| pitch-team-achievement-toggle | pitch | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| security-encryption-details | security | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| security-hosted-architecture-diagram | security | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| security-promises | security | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| signals-provider-source-health | signals | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
| telegram-webhook-health | Telegram | blocked_no_existing_test | Testing gap: no existing automated test evidence in tracker; needs dedicated story test. |
