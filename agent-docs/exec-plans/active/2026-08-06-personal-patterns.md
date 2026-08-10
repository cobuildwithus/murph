# Personal Patterns

Status: active
Created: 2026-08-06
Updated: 2026-08-10

## Goal

- Help a member see repeated links between actions and next-day sleep or recovery.
- Give the existing weekly health insight one deterministic evidence source.
- Keep the result descriptive. Do not present correlation as cause.

## Product shape

- Add Personal Patterns to the existing Overview page.
- Show a compact factor-by-outcome matrix with magnitude, direction, evidence stage,
  exposed days, comparison days, date range, and one-day lag.
- Reuse the existing Habitat illustration set for factor icons.
- Keep weekly delivery at zero or one useful insight through the current automation.

## Architecture and reuse

- Compute patterns from canonical activity and experiment-session events plus the
  selected wearable sleep and recovery read models.
- Put the deterministic calculation in `@murphai/query` so browser projection and
  `vault-cli` use the same result.
- Add the result to the existing encrypted Browser Vault replica. Do not add an API,
  database table, materialized file, cron, or dependency.
- Keep `weekly-health-insights` as the existing dedupe ledger.

## Evidence rules

- Compare an action day with the next day's outcome.
- Require at least five exposed and five comparison days across at least 21 days.
- Match comparison days by weekday when possible.
- Show only links whose direction repeats in both halves of the observed window.
- Report higher or lower values. Do not label the result good, bad, causal, or proven.
- Suppress same-family and obvious formula links.

## Tasks

1. [x] Add the pure Personal Patterns query model and focused tests.
2. [x] Project the result into Browser Vault and expose it through Overview.
3. [x] Add an assistant-callable `vault-cli wearables patterns --format json` read.
4. [x] Point Weekly health insight at the deterministic read before open-ended search.
5. [x] Add the production Overview section and design-catalog study.
6. [x] Suppress outcome-like factors and document the V1 evidence policy.
7. [ ] Verify focused query, CLI, assistant, web, desktop, and mobile behavior.
8. [ ] Complete the required review, PR, and CI workflow.

## Separate process correction

- Replace the combined 20 GiB and 15% worktree disk floor with one 20 GiB floor.
- Preserve every other worktree count, authorization, and temp-checkout guard.

## Verification log

- The worktree storage guard suite passed 22 tests after the disk-floor correction.
