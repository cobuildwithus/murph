# Journal, Personal Patterns, and development personas

Status: completed

## Outcome

Journal and Personal Patterns give a useful, consistent view for members with
different providers and different amounts of context. Local development has a
small persona switcher that exercises the real Browser Vault projections with
synthetic data.

## Product UX plan

The work covers five materially different journeys:

1. A member with rich Oura sleep and activity history.
2. A member with rich Whoop recovery and workout history.
3. A member who uses training plans and completes suggested exercises.
4. A member who uses Family or group conversations, has no connected wearable,
   and keeps private facts private.
5. A context-heavy member with meals, travel, calendar, and home changes.

Every persona uses synthetic values. Private exports can inform data shape only.
They never enter repository files, screenshots, snapshots, or committed output.

## Product rules

- Journal reads canonical records. It does not create a second store.
- Journal shows useful facts, completed actions, accepted plans, and measured
  outcomes. A reminder or suggestion alone is not a Journal event.
- Personal Patterns evaluates every supported factor and outcome. When a
  comparison is not possible, the table keeps the row or column and explains
  why.
- Missing data remains unknown. It never becomes a confirmed absence.
- Provider names do not control eligibility. Canonical fields do.
- Meal records appear in Journal. Patterns use only bounded, meaningful meal
  factors, such as a structured late-meal note.
- The development persona switcher exists only in local development. It does
  not change production auth, storage, or member data.

## Work

- [x] Keep recognized factors and supported outcomes visible when evidence is
      insufficient.
- [x] Add clear insufficient-state details and focused regression tests.
- [x] Complete provider-independent sleep and recovery outcomes.
- [x] Add canonical meals to Journal without exposing raw attachments.
- [x] Create five synthetic Browser Vault personas through the real projection.
- [x] Add a compact local-development persona switcher.
- [x] Verify Journal inclusion rules for plans, exercises, reminders, groups,
      environment context, meals, and travel.
- [x] Run focused query, web, accessibility, and responsive browser checks.

## Exclusions

- No new database table, Journal store, statistical service, or AI calculator.
- No auth impersonation and no production persona switcher.
- No raw or transformed private export data in the repository.
- No calendar or email ingestion that does not already have a canonical owner.
- No web editing controls for Journal.

## Evidence

- Focused query tests cover factor visibility, outcome visibility, grouping,
  meals, provider-neutral data, and the 120-day window. The query suite passed
  62 focused tests.
- Web tests cover loading, error, empty, live, and persona states. The focused
  web suite passed 351 tests.
- Assistant, runtime, contract, hosted execution, Cloudflare, and CLI focused
  tests passed.
- Query, web, assistant engine, assistant runtime, contracts, hosted execution,
  Cloudflare, and CLI type checks passed.
- Headless browser proof covers desktop and narrow layouts for Journal and
  Personal Patterns. Both narrow pages have no horizontal document overflow
  and no accessibility violations.
- The live Oura persona shows Yard work in Personal Patterns across nine
  provider-independent outcomes. The Family persona shows the correct no-data
  state without a connected wearable.
Updated: 2026-08-27
Completed: 2026-08-27
