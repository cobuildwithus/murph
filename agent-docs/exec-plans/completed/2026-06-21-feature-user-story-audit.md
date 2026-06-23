# Feature User-Story Audit

## Goal

Inventory the hosted web application features from current code, express each as a user story with expected behavior, keep one canonical spreadsheet-style tracker, then switch the loop to testing those user stories and documenting every observed error.

## Scope

- Primary app surface: `apps/web/**`.
- Evidence sources: route/page code, component code, service/API code, Prisma schema, tests, and durable product docs.
- Implementation packages are in scope only when they define expected hosted-web behavior.
- Existing dirty files outside this plan are unrelated and must be preserved.

## Deliverables

- Canonical feature/user-story tracker with feature status, test status, evidence links, expected behavior, and observed errors.
- Worker output records that can be traced back to code/test evidence.
- A testing loop that walks each user story and records reproducible errors.

## Approach

1. Split the `apps/web` surface into parallel read-only worker lanes.
2. Have each worker produce structured feature rows from current code evidence.
3. Consolidate rows into the canonical tracker, deduplicate by feature id, and mark confidence/source coverage.
4. When the inventory reaches broad coverage, move into user-story testing and record failures as tracker updates.

## Worker Lanes

- Public and static surfaces: landing, pitch, security, legal, design, Health Commons public routes.
- Dashboard read surfaces: home, overview, history, signals, biomarkers, experiments.
- Experiment and Health Commons detail surfaces: dynamic experiment, biomarker, measurement-method pages and run overlays.
- Device sync and connected sources: connect page, settings device sync, OAuth/webhook/user routes.
- Hosted onboarding and identity: invite/join, auth, phone/email/Privy/session routes.
- Billing, plans, usage, and account settings: trial, checkout, plan switching, usage gates, data export/delete.
- Messaging and mailbox/runtime ingress: Linq, Telegram, WhatsApp, email ingress, hosted mailbox, runtime callbacks.
- Computer-use and internal operations: browser-vault sessions, computer runs/handoffs, internal health/status/logging.

## Verification Plan

- During inventory: direct readback of worker outputs and tracker rows.
- During tracker creation: validate schema completeness and run text/diff checks for docs/artifacts touched.
- During testing loop: use the narrowest truthful app checks or direct route/component tests for each user story; record command, result, and error evidence.

## Risks

- Feature coverage can drift if based only on route names. Mitigation: workers must cite code/test evidence for each row.
- The spreadsheet runtime may be unavailable. Mitigation: record the blocker explicitly and keep a single canonical CSV/TSV-compatible tracker until `.xlsx` export is available or approved.
- Current checkout has unrelated dirty code. Mitigation: workers run read-only and parent writes only audit artifacts.

## State

- Done: launched eight read-only inventory workers and consolidated 215 feature/user-story rows into `agent-docs/feature-user-story-audit/feature-status.csv`.
- Done: launched eight testing workers for area triage; their child sandbox blocked Vitest temp-directory creation, so parent lane-level focused commands were used for canonical test-loop evidence.
- Done: testing-loop status is complete in the tracker: 191 rows passed and 24 rows are blocked by missing automated story tests; 0 rows remain not started.
- Done: `agent-docs/feature-user-story-audit/testing-errors.md` records non-passing story rows and the unrelated full-suite migration-list failure.
- Verification: tracker CSV integrity, trailing-whitespace, ASCII, and privacy-marker checks passed; `pnpm typecheck` passed; tracker-referenced lane-level tests passed; `pnpm --dir apps/web test:prepared` has one unrelated migration-list assertion failure.
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
