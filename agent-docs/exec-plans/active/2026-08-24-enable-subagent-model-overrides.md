# Enable explicit hosted subagent model selection

Status: active
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Let a member explicitly ask Murph to run a bounded hosted child on any currently supported product model, while preserving inherited-model delegation as the default.

## Success criteria

- Hosted Codex explicitly keeps its native per-spawn model selector enabled for every catalog model supported by the multi-agent backend.
- A child with an explicit model is attributed and billed to the effective child model; an unspecified child still inherits the parent model.
- Existing root-plus-three concurrency, one-shot leaf, permission, and background-only guidance remain unchanged.
- Focused config, runtime, usage-accounting, and typecheck proof passes.
- ReviewGPT implementation output is independently inspected before integration, and the normal PR review gates complete on the exact candidate head.

## Scope

- In scope: the existing hosted `multi_agent_v2` config boundary, its focused config/runtime/usage tests, and the durable hosted runtime/deploy contract if its behavior statement changes.
- Out of scope: a model router, a new model registry, new persisted state, automatic cross-model policy, concurrency changes, nested children, or new UI.

## Constraints

- Technical constraints: reuse Codex's native `spawn_agent` model field and the existing product model catalog; keep inheritance as the no-argument path; accept only models already admitted by hosted provider configuration.
- Product/process constraints: Product UX classification is a Product change. Entry is an ordinary conversation request; Murph may delegate only bounded self-contained background work whose result is not required for the immediate reply. The member should understand that an explicit supported model is honored, while unsupported values fail clearly.

## Risks and mitigations

1. Risk: usage is attributed to the parent model after an explicit child override.
   Mitigation: retain the existing effective child-model evidence path and add focused explicit-model assertions.
2. Risk: exposing the selector accidentally creates unrestricted provider/model input.
   Mitigation: rely on Codex's native runtime-catalog validation for the requested string; add no free-form Murph-owned routing layer.
3. Risk: model selection widens child authority or blocks the foreground reply.
   Mitigation: leave the existing one-shot leaf, permission profile, concurrency ceiling, and background-only hints unchanged and prove their config remains present.

## Tasks

1. Ask ReviewGPT Pro to implement a scoped attachment-based patch against the current task worktree.
2. Inspect the returned patch against the current owner boundaries and apply only the minimal correct slice.
3. Run focused tests and typechecks, then complete the Product UX walkthrough for inherited, explicit-supported, and unsupported-model requests.
4. Commit, open a draft PR, run the required preliminary and final ReviewGPT gates, resolve accepted findings, and hand off only after exact-head CI is green.

## Decisions

- Reuse native Codex model selection; do not create a Murph model-routing abstraction.
- Preserve inheritance as the default and expose explicit selection as an opt-in per child.
- Integrate ReviewGPT's production flag and hosted-config assertions. Do not take its proposed rewrite of the late-child runtime test: that scenario intentionally has no parent lifecycle item, and adding one would weaken the regression proof for foreign-child discovery. Existing runtime and usage tests already prove effective-model attribution.
- The pinned Codex 0.147.0 implementation already defaults `expose_spawn_agent_model_overrides` to `true`. Keep the explicit Murph setting anyway: it turns accidental upstream-default behavior into a stable hosted-runtime contract and prevents a future default change from silently hiding the selector.

## Product UX walkthrough

- Irreducible purpose: a member can ask Murph to run bounded background work on a supported hosted model such as Luna without changing the foreground reply contract.
- Explicit supported path: an ordinary hosted conversation reaches Codex's native `spawn_agent` schema; the generated config explicitly keeps the optional model selector on, and the image-owned catalog owns validation. Effective child metadata remains the billing source of truth.
- Inherited path: Murph writes no `default_subagent_model` or `default_subagent_reasoning_effort`, so omitting the option preserves Codex's parent-model inheritance.
- Unsupported path: Murph adds no free-form router or silent fallback. Codex's native catalog/tool validation owns rejection.
- Authority and timing: the root-plus-three ceiling, background-only guidance, one-shot leaf instruction, permission profiles, and no-nested-child boundary are unchanged.
- Evidence: the focused hosted-config suite asserts selector exposure, absent Murph defaults and hardcoded child models, and unchanged concurrency/guidance; the existing runtime suite proves late child usage is read from authoritative effective metadata even without parent lifecycle evidence; the usage-draft suite proves effective metadata drives attribution. A pinned real-Codex provider-input capture found direct and group requests unchanged after transient-ID normalization: both base and head were 14,665 tokens, with 64,543 direct bytes and 64,541 group bytes.
- Difference from plan: this is an explicit support guarantee rather than a present-day schema expansion because pinned Codex already defaults the selector on. Verdict: `Ready`.

## Deployment

- No migration or persisted-state change is required. Roll out through the normal hosted runtime/container release.
- During gradual rollout, existing warm runner processes can retain the implicit upstream default while new processes carry the explicit Murph setting; the observed tool schema is compatible across that skew.
- Post-deploy, verify a newly started hosted run exposes the selector and that an explicit supported-model child is attributed to its effective model.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-codex-config.test.ts` — passed, 44 tests passed and 4 skipped.
- `pnpm --dir packages/assistant-runtime typecheck` — passed.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-subagent-usage.test.ts` — passed, 4 tests.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-runtime.test.ts -t 'holds the workspace boundary'` — passed, 3 tests with 272 unrelated tests skipped.
- `pnpm --dir apps/web test:prepared changelog-fragments.test.ts` — passed, 7 tests.
- Pinned Codex 0.147.0 provider-input capture with `gpt-tokenizer` 3.4.0 (`o200k_harmony`) — normalized base and head were identical for direct and group conversations (14,665 tokens each; direct 64,543 bytes, group 64,541 bytes).
- `git diff --check` and the task-scoped direct-identifier scan — passed.
- Exact-head required CI remains pending until the PR candidate is pushed.
