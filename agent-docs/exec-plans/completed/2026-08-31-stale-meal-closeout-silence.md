# Keep historical meal closeouts silent

Status: completed
Created: 2026-08-31
Updated: 2026-08-31

## Goal

- Keep automatic meal-photo cleanup reliable while preventing a scheduled
  closeout from sending a card, question, or text about a historical capture
  date.

## Success criteria

- Historical retained photos are still inspected, enriched when supported,
  read back, and privacy-tombstoned through the existing closeout workflow.
- Only captures from the scheduled occurrence local date can contribute to a
  member-visible closeout.
- A historical-only run returns `skip` after successful cleanup; mixed work
  excludes historical captures from the outgoing current-date result.
- Current-date closeout behavior remains unchanged.
- The assembled production instructions agree on the occurrence-date boundary
  and contain no conflicting dated-catch-up or selected-work-must-send guidance.
- Focused deterministic tests, package typecheck, and one production-derived
  real-Codex journey pass.

## Scope

- In scope: the automatic-meal-capture skill, the managed closeout seed, the
  shared nutrition-card prompt/reference, matching durable architecture and
  test-map text, deterministic prompt regressions, one focused live journey,
  and the public changelog classification.
- Out of scope: scheduler state, database schema, queue ownership, ingestion,
  capture deduplication, nutrition-card contracts, providers, and frontend UI.

## Constraints

- Technical constraints: keep the existing managed automation and model as the
  sole workflow owner; add no state, service, queue, flag, or dependency.
- Product/process constraints: preserve privacy cleanup and current-date value;
  never encode production evidence, member data, or the reported incident in
  prompts, fixtures, tests, docs, or PR text.

## Risks and mitigations

1. Risk: suppressing delivery could accidentally suppress cleanup.
   Mitigation: instruct cleanup first and assert the historical journey performs
   all canonical mutations before returning `skip`.
2. Risk: generic skill text could conflict with the managed automation seed.
   Mitigation: remove the existing dated-catch-up and selected-work-only
   suppression rules, then inspect the complete assembled prompt.
3. Risk: mixed historical and current work could leak old totals into a current
   card.
   Mitigation: make presentation eligibility occurrence-date-only and add a
   deterministic instruction assertion for exclusion.

## Product UX plan

- Classification: Product change.
- Outcome: members receive a daily captured-meal closeout only for that
  occurrence's local date, never a surprising historical recap.
- Entry and promise: the existing private 9pm automation processes pending
  photos; current-date work may produce the existing closeout, while historical
  cleanup stays private and silent.
- Affected people: a member with only historical backlog; a member whose run
  contains current and historical work; a member with only current-date work.
- Proof: a synthetic historical-only real-Codex journey proves complete cleanup
  and zero member-visible output; deterministic prompt tests prove mixed work
  excludes historical records and current-date behavior remains authorized.

## Tasks

1. Update the automatic closeout skill and managed automation instruction at
   their existing ownership boundary.
2. Strengthen deterministic tests for required and forbidden guidance.
3. Add and run one focused production-derived real-Codex historical-only
   journey.
4. Inspect the assembled prompt, run focused verification and typecheck, then
   complete the Product UX walkthrough.
5. Add the changelog entry, run complexity and final diff review, archive the
   plan through the scoped commit, and open the prompt-primary PR.

## Decisions

- Historical means a selected capture whose vault-local capture date differs
  from the engine-supplied occurrence local date.
- Historical captures remain canonical cleanup work but are never presentation
  inputs for that occurrence.
- The fix is one explicit prompt rule plus proof; no deterministic scheduler or
  persistence mechanism is added.

## Verification

- Passed 96 focused assertions across automatic-meal-capture skill composition,
  managed-automation, response-card, and nutrition-reference tests.
- Passed the focused real-Codex journey with full historical cleanup, no card,
  and the exact terminal `skip` decision. Product UX verdict: Ready.
- Passed Assistant Engine and Web typechecks, 16 focused changelog
  fragment/page assertions, `pnpm complexity:diff`, and `git diff --check`.
- Inspected the assembled scheduled-closeout instructions and final diff; no
  positive historical catch-up authority, private evidence, or new runtime
  state remains.
Completed: 2026-08-31
