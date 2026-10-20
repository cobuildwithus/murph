# Faster meal intake

Status: completed
Created: 2026-10-13
Updated: 2026-10-13

## Goal

- A routine meal log (photo, label, restaurant item, or home-cooked
  description) reaches its saved meal and daily nutrition card in fewer
  provider rounds and less wall time, with equal or better nutrition accuracy.
- Production evidence: two 2026-10-13 reply-latency alerts were silent meal
  photo plus nutrition-card turns of about 80 seconds. Card turns had a
  14-day median of 46 seconds against 14 seconds for other direct replies.

## Success criteria

- A production-shaped live benchmark of 21 synthetic meals (public Food-101
  photos, synthetic labels for fictional products, restaurant and home-cooked
  text) on gpt-6.1-sol at low reasoning shows fewer provider requests and lower
  median and tail wall time, with every case saving one meal in a plausible
  calorie range and attaching its card.
- Deterministic tests cover each changed owner. No priority processing.

## Scope

- In scope: food-journal skill and meal router guidance, compact food-label
  nutrition rows, generic food-label ranking, `meal add --with-daily-totals`
  card output, CLI size-bound validation messages, live benchmark harness.
- Out of scope: service tier, model or reasoning changes, delivery pipeline,
  incur dependency patch, label API response shape.

## Constraints

- Technical constraints: resident prompt growth needs a reviewed budget
  update; the Web label API and runner CLI deploy separately, so the API
  response shape stays unchanged.
- Product/process constraints: numeric suppression, provenance, selected-day
  recovery, and goal authority remain unchanged; no private member data in
  fixtures or evidence.

## Risks and mitigations

1. Risk: ranking changes regress other food searches.
   Mitigation: generic-only, complete-identity-gated signals; existing
   Postgres search suite plus new cases; before/after comparison of 50 real
   USDA queries on a locally imported FDC database.
2. Risk: moving skill sections behind references hides recovery or safety
   rules.
   Mitigation: explicit triggers in SKILL.md; tests read the skill package.
3. Risk: a precomputed card bypasses goal or coverage rules.
   Mitigation: only no-goals, complete-coverage days receive it; accepted
   goals and incomplete coverage keep the existing model-authored paths.

## Tasks

1. Build the local benchmark harness and labels API; record the baseline.
2. Fix compact fat and Foundation fiber rows.
3. Precompute the totals-only card on a combined save; chain save and card.
4. Start lookups with the skill read; split the skill into a capture core
   plus on-demand references.
5. Improve generic food ranking.
6. Same-window baseline versus optimized benchmark; focused tests; commit.

## Decisions

- Keep the skill read but start label lookups in the same tool step instead
  of inlining the capture contract in the resident prompt.
- The CLI returns `dailyTotals.totalsOnlyCard` only for missing goals and
  complete coverage; accepted goals need model-authored statuses.
- Lookups use the default TOON output; only parsed saves use JSON.
- The incur flag-validation envelope still hides size bounds; the skill states
  the 240-character provenance limit instead of patching the dependency.

## Verification

- Commands to run: focused assistant-engine, CLI, operator-config, and hosted
  Web tests; Postgres search suite; live meal intake benchmark.
- Expected outcomes: all pass; benchmark shows the improvements above.

## Results (2026-10-13)

- Same-window live A/B, 21 cases each, gpt-6.1-sol low reasoning, one local
  subscription home, baseline `origin/main` 325cbf663d plus test-only harness
  against its own unfixed labels API: wall p50 55.0s to 34.6s, mean 56.0s to
  33.7s, p90 74.1s to 44.1s, max 90.5s to 50.0s; provider requests mean 7.43
  to 4.62; input tokens per turn mean 349k to 190k. 21/21 saved one meal in
  range and attached a card in both arms. A follow-up fiber fix took the one
  unchanged case (label plus blueberries) from 8 requests and 50s to 3 and 24s.
- Baseline causes, from Codex rollouts: separate skill read; compact lookups
  never returned fat (USDA "Total lipid (fat)" missed a word-boundary regex),
  driving web searches; 1-3 retries per meal on a hidden 240-character
  provenance limit; a separate card round; poor generic matches.
- Labels data: full USDA FDC 2026-04-30 imported locally with
  apps/web/sql/foods/import-fdc.sh. Ranking: 50 real queries before/after;
  butter, 2% and whole milk, eggs, chicken breast, mayonnaise, bread, English
  muffin, and seaweed improve; "hamburger bun" now prefers a hamburger (USDA
  order "rolls hamburger" is the skill's query form). Latency unchanged.
- Deterministic: assistant-engine 5754 passed; CLI 1502 passed; Web food and
  supplement search including Postgres 253 passed; operator-config passed;
  typechecks for engine, CLI, operator-config, and hosted Web passed;
  complexity guard passed with no new debt.
- Complete first provider input (scripted loopback, gpt-6.1-sol catalog):
  direct 167277 to 167581 bytes (+304, +0.182%); group 143214 to 143518
  (+304, +0.212%). No exact tokenizer is configured.

## Completion

- PR #4135. Final ReviewGPT round 1 on `aaf13785c1` (GPT-6 Pro, Mountain
  lane, full guarded snapshot): `ROUND_OUTCOME: PASS`, no findings.
- Exact-head CI on `aaf13785c1`: 37 passed, 3 skipped by design.
- This closing commit archives the plan only; behavior is unchanged from the
  reviewed head. Merge and deployment remain separate actions.
Completed: 2026-10-13
