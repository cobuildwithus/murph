# Remove public goals, knowledge marketing, and pitch microsites

## Scope

Remove `/goals`, `/knowledge`, `/pitch`, their exclusive web components, assets, APIs, navigation, and tooling. Preserve `/compare`, measurement methods, assistant Health Commons content and retrieval, private goals, and challenge behavior. Do not introduce replacements or redirects.

## Product UX

- Effort: Product change.
- Public visitors no longer see navigation or homepage entrypoints to retired pages; direct requests use the existing not-found behavior.
- Existing comparison guides remain available. Assistant evidence and private goals remain unchanged.
- Remove public-goal Telegram resume handling while retaining ordinary account-link setup guidance.
- Result: Ready. Public navigation and footer no longer link to retired routes; existing comparison pages pass their regression suite.

## Work

- [x] Remove exclusive routes, UI, assets, APIs, and scripts.
- [x] Remove shared references, stale public links, goal trace policies, and obsolete checks.
- [x] Run focused regression tests, web typecheck, and complexity/diff checks.
- [x] Record evidence and prepare the separate draft PR for parent review.

## Verification

- Web typecheck passed (`pnpm --dir apps/web typecheck`).
- Nine focused web suites passed: 158 tests covering homepage/layout, sitemap, route traces, webhook recovery, telemetry, biomarker preservation, and changelog integrity.
- Updated homepage and comparison-page regression suites passed: 22 tests.
- Existing Playwright retired-navigation journey passed at 390, 768, 900, 1023, and 1024 pixel widths.
- Complexity guard and documentation drift checks passed; unchanged hotspots remain in legacy changelog validation and the existing Linq recovery wrapper.
- Added-line privacy review and `git diff --check` passed.
- `/compare` source, Health Commons content/runtime, private goal owners, and measurement-method routes have no changes.
- No new product surface, redirect, migration, or persistence owner was added. Historical changelog entries retain their history with retired interactive links removed.
- Parent owns Claude review, final ReviewGPT, and exact-head CI after draft PR handoff.

Status: completed
Updated: 2026-10-19
Completed: 2026-10-19
