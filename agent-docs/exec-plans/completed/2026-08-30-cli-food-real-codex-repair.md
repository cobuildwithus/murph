# Prove food label query repair with real Codex

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Prove that Murph recovers once from a privacy-safe overlong food-label query,
  completes the intended lookup, and gives the member a concise truthful result.

## Success criteria

- The journey composes the production assistant prompt, food-journal skill, and
  production-shaped Vault CLI boundary rather than a reduced prompt substitute.
- One overlong lookup returns the exact `query` / `too_big` machine error with
  no submitted-query echo or provider call.
- Murph retries with exactly one corrected query of at most 256 characters,
  performs exactly one successful label lookup, and makes no duplicate or
  forbidden calls.
- The member reply states the lookup-backed result without the rejected query,
  validation internals, or unsupported claims.
- The focused live journey, food CLI tests, food schema smoke tests, and touched
  package typechecks pass on the corrected PR head.

## Scope

- In scope:
  - One private-free scenario in the existing real-Codex assistant journey file.
  - Exact tool-effect and member-reply assertions for overlong-query recovery.
  - One narrow prompt-owner exception when live proof establishes that the
    general Health Commons rule conflicts with deterministic exact-label facts.
  - PR evidence and head refresh for the accepted specialist finding.
- Out of scope:
  - New production prompt rules, tool machinery, retries, or food-label behavior
    unless the focused journey proves a concrete production gap.
  - Other Vault CLI families or assistant journeys.

## Constraints

- Technical constraints:
  - Reuse production prompt and dynamic-tool builders and inject synthetic ports.
  - Keep the live journey opt-in and never call production databases, providers,
    delivery channels, or member-facing systems.
- Product/process constraints:
  - Product UX Patch: a private member asking for a food-label lookup should see
    the requested nutrition facts despite one agent-generated overlong query.
  - Entry and promise: an ordinary food lookup request should end in one useful
    lookup-backed reply; recovery is internal and does not blame the member.
  - Affected person: a private-channel member whose lookup needs query repair;
    existing valid-query and provider-fallback journeys remain unchanged.
  - The accepted coverage finding is test/evidence-only; do not rerun either
    ReviewGPT stage after isolated regression-test remediation.

## Risks and mitigations

1. Risk: A mock CLI can pass without matching the production machine contract.
   Mitigation: Return the exact production error envelope and assert its public
   fields, non-echo behavior, request count, and corrected-query bound.
2. Risk: Stochastic model behavior causes brittle proof.
   Mitigation: Assert only product-significant calls, arguments, effects, and
   reply truths; inspect the actual prose and retain deterministic CLI coverage.
3. Risk: Test-only remediation expands into speculative prompt machinery.
   Mitigation: Change production code only if the live journey demonstrates a
   reproducible owning-boundary gap.

## Tasks

1. Inspect existing production-derived food-journal journeys and helper
   contracts, then add the smallest overlong-query recovery scenario.
2. Run only the focused journey through the local Codex subscription and record
   model, auth class, exact effects, reply, and Ready or Hold verdict.
3. Rerun focused Food CLI/schema proof and touched package typechecks.
4. Complete the Product UX walkthrough, close the plan with `finish-task`, push
   the corrected head, and refresh PR evidence without rerunning ReviewGPT.

## Decisions

- Treat the privacy-safe validation failure as an agent-repair boundary, not a
  member-visible error: the member needs the final nutrition result, not query
  validation internals.
- Preserve the already-reviewed production patch and add only focused regression
  proof unless the live result establishes otherwise.
- The first model-reaching run established a concrete owner conflict: the global
  Health Commons mandate caused an unnecessary Commons lookup before the food
  database repair. Keep the exception at that global owner, limited to requests
  for deterministic exact food-label facts; health reasoning and advice beyond
  those returned facts still require Commons.
- Treat `food search-labels --help` as contract discovery, not a provider lookup
  or duplicate effect. Count only invocations that submit a query.

## Verification

- Commands to run:
  - `pnpm test:assistant:live -- --test "repairs one overlong food-label query"`
  - `pnpm exec vitest run packages/cli/test/food-labels.test.ts packages/cli/test/food-save-typed-parity.test.ts`
  - `pnpm exec vitest run packages/cli/test/incur-smoke.test.ts -t 'food search-labels'`
  - Touched package typechecks, PR-body validators, `git diff --check`, and
    privacy-safe scoped diff inspection.
- Expected outcomes:
  - The live journey is `Ready`: one rejected call, one bounded correction, one
    successful lookup, no forbidden effects, and one complete truthful reply.
  - Deterministic proof remains green and no production edit is required unless
    the live journey exposes a concrete behavior gap.

## Product UX walkthrough

- Person and path: a private-channel member asks for calories and protein from
  one exact synthetic food label whose package description exceeds the provider
  query limit. The ordinary production prompt and food-journal skill route the
  request through Vault CLI.
- Effects: one 328-character lookup failed locally with the privacy-safe
  `query` / `too_big` result, one corrected 104-character lookup succeeded, and
  no Commons, dynamic tool, provider fallback, meal mutation, or food mutation
  ran. Incidental CLI help did not count as a lookup.
- Reply review: the final response named the synthetic product and stated the
  returned 420 calories, 18 grams of protein, and one-bowl serving basis. It was
  concise, clear, complete, truthful, and contained neither the rejected query
  nor internal validation language.
- Evidence: `gpt-5.6-terra` through local subscription authentication; the
  focused live command passed on the same home that reached provider action.
- Difference from plan: live proof found the general Commons mandate conflicted
  with the exact-label owner. The narrow global exception resolved that gap
  while retaining Commons for health reasoning or advice beyond label facts.
- Verdict: Ready.

## Outcome

- A production-derived real-Codex journey now proves one privacy-safe overlong
  food-label failure is repaired once and completed through one successful
  bounded lookup with no duplicate or unrelated effects.
- The system prompt now excludes only deterministic exact food-label fact
  retrieval from the general Commons preflight; all non-label health reasoning
  and advice retain the existing Commons requirement.
- Focused prompt, food-skill, live-assistant, Food CLI, schema, and package
  typecheck proof passed.

## Progress

- 2026-08-30: Added the accepted specialist remediation scenario and exact
  privacy, effect-count, bounded-retry, and reply assertions.
- 2026-08-30: Initial model-reaching proof completed the lookup but exposed an
  unnecessary Commons detour caused by the higher-level health-Q&A mandate.
- 2026-08-30: Moved one exact-label-only exception to that mandate owner and
  retained Commons for reasoning and advice beyond returned label facts.
- 2026-08-30: Final live proof was Ready; focused deterministic tests and both
  touched package typechecks passed.
Completed: 2026-08-30
