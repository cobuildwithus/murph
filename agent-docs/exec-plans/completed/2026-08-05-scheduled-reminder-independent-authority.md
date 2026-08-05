# Preserve independently authorized scheduled reminders

Status: completed
Created: 2026-08-05
Updated: 2026-08-05

## Goal

- Keep an active, independently authorized scheduled reminder deliverable when a
  related plan has completed, unless the saved automation itself defines that
  state as a skip condition or current evidence proves the requested action is
  already complete.
- Preserve the provider's structured send-or-skip decision in the existing cron
  run record so a successful no-delivery run is diagnosable without private
  transcript reconstruction.

## Success criteria

- Ordinary active automations receive an engine-owned authority boundary that
  prevents a related plan's lifecycle from becoming an invented cancellation.
- Plan-owned support keeps its existing typed lifecycle and consent gates, and
  conditional reminders can still skip for conditions stated in their saved
  instructions or proven completion of the requested action.
- Cron run records distinguish provider `skip` from a send decision that did
  not create a delivery effect while remaining readable across older records.
- Focused contract and cron-runtime tests, package typechecks, exact-head CI,
  and required ReviewGPT gates pass.

## Scope

- In scope: scheduled-notification execution instructions, cron run-record
  observability, focused contracts/runtime tests, and matching durable docs.
- Out of scope: changing production records, adding a scheduler or queue,
  changing plan lifecycle ownership, replaying the historical occurrence, or
  persisting private model/tool content.

## Constraints

- Technical constraints: reuse the existing automation and cron-run owners;
  keep old v1 run records parseable; store only bounded structured metadata.
- Product/process constraints: preserve wise model silence, explicit consent
  boundaries, product-critical reminder delivery, and private evidence rules.

## Risks and mitigations

1. Risk: broad anti-skip wording could create noisy reminders after the user
   already acted.
   Mitigation: protect only against implicit cancellation from a merely related
   plan while explicitly retaining saved skip conditions and proven completion.
2. Risk: a run-record schema addition could reject existing vault history.
   Mitigation: make the new structured decision nullable/optional on read and
   write it deterministically for new notification runs.

## Tasks

1. [x] Add failing contract/runtime regressions for independent reminder authority
   and structured no-delivery decisions.
2. [x] Implement the smallest execution and run-record changes in current owners.
3. [x] Update the live automation contract documentation and run focused proof.
4. [ ] Commit, push, open the PR, and complete exact-head CI plus ReviewGPT gates.

## Decisions

- The historical incident was a provider `skip`, not a delivery failure or
  lifecycle invalidation; no production mutation is needed for diagnosis.
- Treat the active automation as the authority. Related records are context,
  not cancellation authority, unless ownership or the saved instructions say
  otherwise.
- Persist decision metadata on `AssistantCronRunRecord`; do not create a new
  observability store.

## Verification

- Passed `pnpm --filter @murphai/operator-config exec vitest run --config
  vitest.config.ts --no-coverage test/assistant-cli-contracts.test.ts` (23/23).
- Passed `pnpm --filter @murphai/assistant-engine exec vitest run --config
  vitest.config.ts --no-coverage test/assistant-cron-runtime.test.ts` (168/168).
- Passed package typechecks for `@murphai/operator-config` and
  `@murphai/assistant-engine`.
- Passed `git diff --check`.
- Pending: exact-head PR CI, preliminary completion-specialists ReviewGPT, and
  final ReviewGPT.
Completed: 2026-08-05
