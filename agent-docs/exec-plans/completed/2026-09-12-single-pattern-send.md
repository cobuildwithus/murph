# One observation per Personal Patterns message

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Outcome and scope

Scheduled Personal Patterns messages share exactly one factor-and-outcome finding
in a short conversational paragraph, without a Patterns link or browse-more footer.
This applies to both the first complete report and later newly eligible results.
The managed automation instruction is the existing owner: it currently asks for
up to three highlights and an overflow link. Replace that policy in place.

## Product UX

- Entry and promise: a private scheduled update offers one useful observation.
- Reaches: first complete imports and established members with multiple new results.
- Preserve: pending imports, mutes, grade E suppression, alias migration, evidence
  qualifiers, comparison timing, and existing reviewed-identity bookkeeping.
- Other reviewed results are not a deferred notification queue. No new state,
  schedule, dependency, or delivery mechanism is needed.
- Proof: production-derived deterministic instructions and focused real-Codex
  first/later journeys, with exactly one outcome, no link, bounded commands,
  and complete ledger writes. Replay the existing rename/silence journey too.

## Implementation and verification

1. Update the recipe, existing regression journeys, and product contract.
2. Add a concise public changelog item.
3. Run focused tests and relevant typechecks, then the real scheduled model
   journeys. Inspect synthetic replies and review the full diff and complexity.
4. Record results and finish with a scoped local commit. No deployment is in scope.

## Risks and rollout

This is a prompt-only policy change within the existing managed recipe. Normal
managed-automation reconciliation updates its instructions. Existing persisted
history and delivery behavior retain their contracts. No migration is needed.
The old prompt can still send multiple findings until the new code is deployed.

## Evidence

- Passed: managed-automations suite (59 tests) and Personal Patterns eligibility
  suite (21 tests), through `pnpm --dir packages/assistant-engine test` with each
  exact test file. The initial eligibility filename filter matched no file;
  the corrected `test/assistant-personal-patterns-eligibility.test.ts` passed.
- Passed: `pnpm --dir packages/assistant-engine typecheck` and
  `pnpm --dir apps/web typecheck`.
- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage
  apps/web/test/changelog-page.test.tsx` (10 tests). The documented app-directory
  invocation found no tests; existing Frog entry
  `20260911184822-documented-changelog-test` covers the workaround.
- Passed: `pnpm complexity:diff`; unchanged complexity debt and existing untouched
  reconciliation hotspots require no refactor for this prompt-only change.
- Reviewed: full diff, identifiers, existing recipe reconciliation, unchanged
  state/delivery ownership, and content-only changelog copy. No public PR exists,
  so the changelog source PR list is empty.
- Final ReviewGPT is exempt under the prompt-primary policy; no sensitive runtime
  behavior changed. Foreground individual/group initial requests are unaffected.
- Passed real-Codex journeys through the local subscription with `gpt-5.6-luna`
  and the production automation's high reasoning setting:
  - `pnpm test:assistant:live -- --test 'sends exactly one Personal Pattern without
    a link.*false' --model gpt-5.6-luna --codex-home <CODEX_PROFILE>`
  - Same command with the `.*true` selector for the later update.
  - Same command with `groups clear aliases without notifying for a rename`.
  The default profile and two alternate profiles failed before provider actions;
  the next authenticated profile ran the journeys. No auth material was read or
  copied. The initial broad selector was split into exact first/later selectors.
- Both final message journeys: one finding, no link or page invitation, one
  report read, one ledger write preserving all four graded identities, no
  vocabulary writes and no silence-tool calls. Comparison, timing, magnitude,
  and supporting count were truthful. UX verdict: Ready.
- Rename journey: two bounded report reads and one vocabulary write; notification
  decision remained skip with existing history preserved. UX verdict: Ready.
- Reply review refined the existing comparison instruction to name its baseline
  and use one effect-size number. The deterministic recipe test and typecheck
  passed again before rerunning both message journeys. Numeric assertions accept
  mathematically equivalent delta or group-mean expressions; the grade-A-only
  message no longer inherits a qualifier assertion for omitted C/D highlights.
- Changelog: `2026-09-12 / one-pattern-per-update`. Content-only presentation;
  no renderer change or browser preview required.
- Final parent review: Ready. All code/config checks passed, no new state or
  dependencies, no unrelated edits, and no new Frog entry. Local commit only;
  no PR, CI, merge, deployment, or member-facing sends were performed.
Completed: 2026-09-12
