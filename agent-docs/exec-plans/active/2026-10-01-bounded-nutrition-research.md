# Bound factual research and improve food search

Status: active
Created: 2026-10-01
Updated: 2026-10-01

## Goal

- Return useful source-grounded meal estimates without unnecessary research or browser escalation; improve food search latency and product matching.

## Success criteria

- Compare baseline and revised instructions with GPT-6.1 Sol on synthetic meal corrections, failed lookups, general public facts, and safety/action controls.
- Measure food-search work and latency before/after; target 2–3x where evidence supports it without reducing match quality.
- Pass focused tests, owning typechecks, required specialist/final review and PR CI.

## Scope

- In scope: existing food/computer instruction owners, food-search implementation and focused proof; Opus 5.5 consultation.
- Out of scope: new caches or stores without demonstrated need, production data mutations, private conversation fixtures.

## Constraints

- Technical constraints: reuse current search and meal owners; preserve exact product/serving provenance and bounded database load.
- Product/process constraints: no private evidence in tracked artifacts; no weakened allergy, dose, numeric-sensitivity, or action authorization rules.

## Risks and mitigations

1. Faster estimates could hide uncertainty or accept a wrong variant.
   Mitigation: explicit estimates, exact identity checks, safety controls and adversarial matching cases.

## Tasks

1. Trace prompt conflicts and search query behavior; obtain independent Opus advice.
2. Tighten existing instructions and implement measured search corrections.
3. Run model comparisons and focused regression/type proof.
4. Inspect privacy and final diff, commit, open PR, complete required reviews and CI.

## Decisions

- Existing food-journal, computer-use, and system-prompt owners retain all policy; no new state owner.
- Keep the always-on prompt budgets unchanged; put detailed nutrition stopping rules in the skill and replace the base prompt's exhaustive fallback language.
- Rank food identity from name and brand; retain extended text for indexed discovery. A generic-only 5,001-row probe uses the existing 5,000-row ranking bound and falls back to the original indexed lanes when it overflows. Preserve source filters, canonical diversity, exact IDs and UPCs.
- Product UX: Patch, Ready. Outcome: lower effort for ordinary meal estimates and corrections. Reaches: private meal capture and public factual lookup; exact safety questions and website actions retain their separate verification and authorization rules. Proof: synthetic model tool traces and real PostgreSQL regressions.

## Verification

- Commands: focused assistant and food-label Vitest suites, assistant/Web typechecks, synthetic GPT-6.1 Sol tool-selection evaluation and food-search benchmark.
- Expected: fewer redundant calls and browser escalations, correct estimates/matches, preserved safety and real-world action completion.
- Assistant proof: 96 focused tests passed across nutrition, browser, prompt-size, capability and Codex instruction assembly suites; assistant-engine typecheck passed.
- Backend proof: 206 focused tests passed with local PostgreSQL enabled, including descriptor and brand matching, long-name typos, unrelated misses, optional stemming, generic broad-query diversity, literal-percent names and exact product/source contracts. Hosted Web typecheck passed.
- GPT-6.1 Sol, low reasoning: 8/8 final synthetic scenarios passed with the assembled production base/developer instructions and simulated food, web, browser and meal tools. Baseline also passed 8/8: this is behavioral compatibility and bounded-workflow evidence, not proof of a universal model-latency speedup. Routine missing-label cases used one database lookup and one web search; corrections reused facts; safety questions withheld unverifiable claims; requested website actions still used the browser. Provider latency and live website availability are outside this fixture.
- Opus 5.5 independently assessed the SQL and final candidate; no blocking defects remained. Its identity-ranking and strict-word matching suggestions informed the implementation.
- Benchmark method: alternating baseline/candidate SQL on the same 120,000-row local PostgreSQL fixture with production-shaped indexes, short USDA-style identity text and a separate long-text distribution; six timed runs per query, medians, and top-five identity comparison. No production latency claim or private corpus was used. Specific short-text generic lookup improved about 2.2x; broad generic lookup paid roughly 24 ms for the overflow probe. Final per-query figures belong in the PR evidence.
- Changelog fragment tests: 7 passed after generating the ignored registry. Required review and CI gates remain pending.
