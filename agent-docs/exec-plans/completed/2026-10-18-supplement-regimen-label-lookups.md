# Supplement regimen label lookups

Status: completed
Created: 2026-10-18
Updated: 2026-10-18

## Goal

- For a requested nutrition calculation involving supplement products (for
  example protein powders saved as supplement regimens), use saved facts first,
  look up only the requested facts the record lacks in the supplement label
  corpus, and explain the concrete blocker for any fact that stays unresolved.

## Success criteria

- Food-journal routes supplement products, including saved supplement regimens,
  to `vault-cli supplement search-labels-batch` after reading the record, and
  does not use the food database for them.
- Saved facts that answer the request trigger no label or web research.
- Bounded fallback keeps found facts, names the concrete blocker per unresolved
  fact, and marks only unresolved routine calories/macros as estimates.
- Focused deterministic boundary tests, a real-CLI fixture test, and focused
  real-model journeys pass on final source. No first provider input change is
  identified.

## Scope

- In scope: `food-journal/SKILL.md` lookup routing and fallback wording; a
  supplement-regimen real-CLI fixture; focused deterministic and live tests.
- Out of scope: CLI, label corpus, search ranking, system prompt, skill router,
  tool contracts, typing behavior, and any production data or replay.

## Constraints

- Technical constraints: skill bodies load on demand, and resident instructions
  and tool contracts stay unchanged. No unconditional searches. No assumption
  that every nutrition field exists. No UPC/FDC requirement.
- Product/process constraints: synthetic invented products only; no member
  content in fixtures, docs, or PR text.

## Risks and mitigations

1. Risk: supplement routing prompts research before saved facts are read.
   Mitigation: record-first wording (`regimen show`; `regimen list` omits amounts)
   and only requested facts the record lacks; a known-fact live control asserts
   zero lookups and zero web calls.
2. Risk: fallback copy claims "no match" when a label matched partially.
   Mitigation: name the concrete blocker per unresolved fact; a partial-label
   live journey asserts preserved facts and no false "no label found" claim.

## Tasks

1. Reproduce on current source with real regimen records and the production prompt surface.
2. Make the smallest skill correction, then address candidate review.
3. Run deterministic, typecheck, complexity, first-input, and focused live proof.
4. Coordinator: review, PR, exact-head CI, merge/deploy, post-release proof.

## Decisions

- Current-source reproduction (gpt-6.1-sol, low, local subscription; synthetic
  real-CLI regimen records, production-scoped CLI contract and prompt): with
  labels available only in the supplement corpus, 2 of 2 baseline runs used only
  the food label batch, did not cite the unrelated fuzzy hits, never queried
  supplement labels, and asked the member to send labels. Causal seam:
  food-journal was the only skill read, and it named only food label commands.
  Supplement label lookup was documented only in micronutrients-supplements.
- A first draft that said "in that same tool round" caused one unnecessary
  supplement lookup in the known-fact control, compared with zero lookups on
  the baseline skill. The final wording reads the record first and looks up only
  missing requested facts.
- Supplement routing has its own bullet so food-only flags do not appear to
  apply. The existing limit is clarified as "at most two food lookups".
- The earlier food-record journeys were non-reproductions and do not exercise
  the changed boundary, so they are not kept in the repository.

## Verification

- Deterministic: grounding and food-journal skill tests (7 passed); turn-planning
  and model-behavior with grounding and skill tests (210 passed); the regimen
  real-CLI fixture test passed; assistant-engine typecheck passed. An earlier
  sweep of the 13 skill-reading suites passed 324 tests with the interim wording.
- `pnpm complexity:diff`: passed; no authored JS/TS source changes (skill and tests only).
- First provider input: the skill body still loads on demand, and the initial
  prompt and skill catalog sources are unchanged. The deterministic planner
  direct/group characterization digests are unchanged. The opt-in shared-schema
  measurement reported matching complete-input byte counts for HEAD and final
  skill text across all four direct/group × native/code-only pairs, while the
  skill file grew 630 bytes. Its equality hashes varied even between two runs
  of unchanged source (Frog entry recorded), so exact byte identity is
  unproven.
- Live, final source, one run each
  (`pnpm test:assistant:live -- --test 'resolves requested facts for saved supplement regimens: <scenario>'`):
  - available: one supplement batch with 2/2 hits, 0 web calls, exact totals;
  - partial: calories and carbs kept, and fat is called unavailable on the
    retrieved labels without a false no-match claim;
  - unavailable: "could not find matching labels" after one web call;
  - known fact: zero lookups and zero web calls, exact saved protein.
- Existing bounded nutrition journeys on final source pass: unavailable-label
  (blocker named plus a marked range), label-miss, and correction (zero lookups).
- Remaining gaps: n = 1–2 per configuration on one model at low reasoning; the
  stub cannot show real corpus coverage; the incident's exact source revision is
  unknown; scheduled turns and regimens with non-protein facts are untested.
  In the partial and unavailable journeys the model often declines to estimate
  and asks for labels; it names the blocker honestly.

## Pull request and changelog

- PR #4196 carries the source, tests, this plan, and the Frog entry (commit
  5926039470) plus the changelog fragment (commit b4d2711b1f).
- Changelog fragment `apps/web/changelog/entries/2026-10-18/supplement-label-nutrition.json`
  (`sourcePullRequests: [4196]`, no visual or `tryIt`) passed
  `pnpm --dir apps/web changelog:generate`, the changelog-page test through
  `apps/web/scripts/run-hosted-web-vitest.mts` (10 passed), and
  `pnpm --dir apps/web typecheck`.

## Review

- Source implementation is complete at b4d2711b1f. Parent candidate review
  findings were resolved before the first commit.
- Final ReviewGPT round 1 returned PASS with REVIEW_COMPLETE, bound to the exact
  commit and accepted turn, with 1/1 attachment, gpt-6-pro, and the 180-second
  minimum met. It reported no qualifying Critical or High bugs and no
  material Complexity Collapse. Its public snapshot held tracked files and
  review context only, no private incident evidence. No accepted findings remain.

## Handoff

- Not complete: final-head CI was still running with no failures at this update.
  Merge, production release, and post-release proof have not happened, and the
  member-facing outcome is not shipped.
- After the coordinator closes this plan with `scripts/finish-task`, final-head
  CI, merge, release, and post-release receipts are tracked on PR #4196 and in
  the coordinator handoff, not here.
Completed: 2026-10-18
