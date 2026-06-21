# Feature User-Story Testing Errors

Generated: 2026-06-21

Canonical source: `feature-status.csv`. Detailed cause analysis for the missing/dead rows lives in `gap-triage.md`.

## Current Result

- Passed story rows: 189
- Blocked story rows: 24
- Failed story rows: 0
- Remaining not-started rows: 0

## Verification-Level Notes

- `pnpm --dir apps/web test:prepared` ran 2,772 tests: 2,764 passed, 7 skipped, and 1 failed in `apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`. The failure is a migration-list expectation that does not map to a tracker feature row; it expected the list without `2026062100_hosted_ai_usage_period_counter_backfill`.
- Eight read-only testing workers were launched first, but their child sandbox could not create Vitest SSR temp directories. Parent lane-level commands were then run and passed for tracker-referenced test evidence.

## Blocked Story Rows

| feature_id | area | status | cause |
| --- | --- | --- | --- |
| settings-passkey-create | auth component | blocked_no_existing_test | Reachability gap: HostedPasskeySettings is not imported by any current app route or test; /settings omits the passkey UI, so there is no in-app path to create a passkey from this component. |
| design-brand-guidelines | design | blocked_no_existing_test | Missing coverage: /design brand tab is an internal static design-system route; no route or component test asserts BrandContent or brand tab rendering. |
| design-component-gallery | design | blocked_no_existing_test | Missing coverage: /design components tab is an internal component gallery; no test asserts the expected component groups render. |
| design-interactive-previews | design | blocked_no_existing_test | Missing coverage: interactive previews in the /design components tab use local client state; no DOM/client test clicks or verifies those preview states. |
| design-tabbed-shell | design | blocked_no_existing_test | Missing coverage: DesignPage tab selection and URL replacement are client-side; no test renders /design or verifies tab switching. |
| home-feature-highlights | home | blocked_no_existing_test | Missing coverage: static home feature-card rendering from shared invite card data has no direct component assertion. |
| home-daily-assistant-demo | homepage | blocked_no_existing_test | Missing coverage: landing assistant demo and phone mock copy are static marketing content outside the existing root-page assertions. |
| home-how-it-works-cards | homepage | blocked_no_existing_test | Missing coverage: root-page tests assert high-level landing copy but not the How it works card grid or its static device/protocol/result details. |
| home-persona-phone-demos | homepage | blocked_no_existing_test | Missing coverage: persona phone demos are static marketing examples; tests do not assert persona cards, mock result tiles, or image rendering. |
| home-phone-chat-autoscroll | homepage | blocked_no_existing_test | Missing coverage: PhoneChatScroller relies on a client DOM layout effect to scroll to bottom; current server-render root tests cannot exercise that behavior. |
| home-security-teaser | homepage | blocked_no_existing_test | Missing coverage: security teaser section and /security CTA are not separately asserted by the root-page tests. |
| home-trust-pillars | homepage | blocked_no_existing_test | Missing coverage: trust-pillar card titles and bodies are not asserted by existing landing tests. |
| linq-webhook-health | Linq | blocked_no_existing_test | Missing coverage: GET health handler returns a static provider payload, while existing Linq webhook tests cover POST handling only. |
| overview-design-active-experiment-banner | overview | blocked_no_existing_test | Reachability gap: the overview component is imported only by the /design component gallery, not by overview or dashboard product routes; no product UI test covers it. |
| overview-design-domain-card | overview | blocked_no_existing_test | Reachability gap: the overview component is imported only by the /design component gallery, not by overview or dashboard product routes; no product UI test covers it. |
| overview-design-profile-stats | overview | blocked_no_existing_test | Reachability gap: the overview component is imported only by the /design component gallery, not by overview or dashboard product routes; no product UI test covers it. |
| pitch-ask-live-link | pitch | blocked_no_existing_test | Missing coverage: pitch route test covers the deck shell and first slide only; ask slide CTA/link and trajectory cells are not asserted. |
| pitch-product-step-panels | pitch | blocked_no_existing_test | Missing coverage: pitch route test covers the deck shell and first slide only; product slide panel toggles are not clicked or asserted. |
| pitch-team-achievement-toggle | pitch | blocked_no_existing_test | Missing coverage: pitch route test covers the deck shell and first slide only; team card toggles and achievement panel state are not clicked or asserted. Personal identifiers remain omitted from audit artifacts. |
| security-encryption-details | security | blocked_no_existing_test | Missing coverage: SecurityPage tests cover metadata, nav, and install command only; encryption detail cards/meta are not asserted. |
| security-hosted-architecture-diagram | security | blocked_no_existing_test | Missing coverage: SecurityPage tests cover metadata, nav, and install command only; hosted architecture diagram and legend are not asserted. |
| security-promises | security | blocked_no_existing_test | Missing coverage: SecurityPage tests cover metadata, nav, and install command only; promise cards are not asserted. |
| signals-provider-source-health | signals | blocked_no_existing_test | Missing coverage: SignalsPage renders provider source-health table only for non-empty sourceHealthRows; current dashboard tests/fixtures do not cover that populated branch. |
| telegram-webhook-health | Telegram | blocked_no_existing_test | Missing coverage: GET health handler returns a static provider payload, while existing Telegram webhook tests cover POST, secret, and body handling only. |
