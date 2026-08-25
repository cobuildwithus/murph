# Enable explicit hosted subagent model selection

Status: completed
Created: 2026-08-24
Updated: 2026-08-25

## Goal

- Let an eligible member explicitly ask Murph to run a bounded hosted child on any product model already authorized for that runtime, while preserving inherited-model delegation as the default.

## Success criteria

- Hosted Codex explicitly keeps its native per-spawn model selector enabled only when Web confirms that the current managed runtime is authorized for the full product-model catalog.
- A child with an explicit model is attributed and billed to the effective child model; an unspecified child still inherits the parent model.
- Existing root-plus-three concurrency, one-shot leaf, permission, and background-only guidance remain unchanged.
- Focused config, runtime, usage-accounting, and typecheck proof passes.
- ReviewGPT implementation output is independently inspected before integration, and the normal PR review gates complete on the exact candidate head.

## Scope

- In scope: the existing hosted `multi_agent_v2` config boundary, its focused config/runtime/usage tests, and the durable hosted runtime/deploy contract if its behavior statement changes.
- Out of scope: a model router, a new model registry, new persisted state, automatic cross-model policy, concurrency changes, nested children, or new UI.

## Constraints

- Technical constraints: reuse Codex's native `spawn_agent` model field and the existing product model catalog; keep inheritance as the no-argument path; accept only models already admitted by hosted provider configuration.
- Product/process constraints: Product UX classification is a Product change. Entry is an ordinary conversation request; Murph may delegate only bounded self-contained background work whose result is not required for the immediate reply. A one-task child-model request must never become a persistent conversation-model change. Because background completion delivery has no terminal owner yet, this PR does not announce the capability as shipped.

## Risks and mitigations

1. Risk: usage is attributed to the parent model after an explicit child override.
   Mitigation: retain the existing effective child-model evidence path and add focused explicit-model assertions.
2. Risk: exposing the selector accidentally bypasses a member's model entitlement or a custom inference connection's single-model contract.
   Mitigation: derive one boolean at Web's existing assistant-configuration owner, fail closed when absent, and narrow the existing production image catalog to exactly the product models so Codex's native validation rejects every other bundled model before provider traffic. Add no per-turn Murph router or duplicate validation layer.
3. Risk: model selection widens child authority or blocks the foreground reply.
   Mitigation: leave the existing one-shot leaf, permission profile, concurrency ceiling, and background-only hints unchanged and prove their config remains present.

## Tasks

1. [x] Ask ReviewGPT Pro to implement a scoped attachment-based patch against the current task worktree.
2. [x] Inspect the returned patch against the current owner boundaries and apply only the minimal correct slice.
3. [x] Run focused tests and typechecks, then complete the Product UX walkthrough for inherited, explicit-supported, and unsupported-model requests.
4. [x] Commit and push the remediated candidate, pass the canonical final ReviewGPT gate, and close this plan. Exact-head CI, current-base mergeability, and merge remain post-plan release gates on the final archival head.

## Decisions

- Reuse native Codex model selection; do not create a Murph model-routing abstraction.
- Preserve inheritance as the default and expose explicit selection as an opt-in per child.
- Keep plan and provider authority at the existing Web assistant-configuration owner. Project one invocation boolean through the hosted execution contract; Cloudflare and assistant-runtime do not duplicate billing-plan logic.
- Treat a model named for one delegated task as `spawn_agent.model`; reserve `murph.assistant_configuration` for explicit conversation/room changes on future turns.
- Integrate ReviewGPT's production flag and hosted-config assertions. Do not take its proposed rewrite of the late-child runtime test: that scenario intentionally has no parent lifecycle item, and adding one would weaken the regression proof for foreign-child discovery. Existing runtime and usage tests already prove effective-model attribution.
- The pinned Codex 0.147.0 implementation already defaults `expose_spawn_agent_model_overrides` to `true`. Keep the explicit Murph setting anyway: it turns accidental upstream-default behavior into a stable hosted-runtime contract and prevents a future default change from silently hiding the selector.
- Accept final ReviewGPT round 1's production-catalog finding: Web's authority boolean meant the full Murph product catalog, but the image still exposed additional bundled Codex models whose usage allowance has no price owner. Correct the existing image catalog in place to exactly Luna, Terra, and Sol, and keep native Codex validation as the only spawn-time model validator.

## Product UX walkthrough

- Irreducible purpose: an eligible member can ask Murph to run bounded background work on a supported hosted model such as Luna without changing the foreground reply contract or saved conversation model.
- Eligible managed path: Web confirms that the current runtime has the full product-model catalog, Cloudflare forwards that one decision, and generated Codex config exposes the native optional selector. The image-owned catalog contains exactly Luna, Terra, and Sol; it owns string validation, while effective child metadata remains the billing source of truth.
- Inherited path: Murph writes no `default_subagent_model` or `default_subagent_reasoning_effort`, so omitting the option preserves Codex's parent-model inheritance.
- Restricted personal path: when the member is not authorized for the full catalog, the selector is absent; ordinary inherited-model delegation remains available.
- Custom inference path: the selector is absent because the active connection owns one verified model alias; ordinary inherited-model delegation remains available.
- Unsupported value path: Murph adds no free-form router or silent fallback. Codex's native catalog/tool validation rejects any non-product value before a child provider request.
- Saved-setting path: a model named for one delegated task goes on `spawn_agent.model` and never through `murph.assistant_configuration`; only an explicit conversation/room request changes future turns.
- Authority and timing: the root-plus-three ceiling, background-only guidance, one-shot leaf instruction, permission profiles, and no-nested-child boundary are unchanged.
- Delivery path: the current background-result contract revisits late results only on a later ordinary inbound turn. This PR does not add a queue, wake, or notification owner and removes its member-facing changelog entry until that separate product journey exists.
- Evidence target: focused tests cover eligible, restricted, missing-projection, and custom-inference config; the exact production image catalog; explicit supported and rejected child-model selection plus inheritance through the real scripted App Server; prompt scope; effective-model usage attribution; and unchanged concurrency/guidance.
- Difference from plan: the explicit support pin is now authority-gated, the production catalog is product-only, and the changelog claim is removed. Verdict: `Implementing`.

## Deployment

- No migration or persisted-state change is required. Deploy the Cloudflare/runtime consumer first: an old Web projection then disables the optional selector without affecting inherited delegation. Deploy the Web producer second to enable it for authorized managed runtimes.
- Existing old runners retain the pinned Codex default until replacement, matching the pre-PR baseline. New runners fail closed on a missing authority projection, so rollback can temporarily remove explicit selection without blocking ordinary replies or inherited children.
- Post-deploy, verify a newly started eligible managed run exposes only Luna, Terra, and Sol, a restricted or custom-inference run does not expose the selector, a supported-model child is attributed to its effective model, and a non-product bundled model is rejected before provider traffic.

## Verification

- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-control.test.ts` — passed, 32 tests.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-codex-config.test.ts` — passed, 45 tests passed and 4 skipped.
- `pnpm --dir packages/assistant-runtime typecheck` — passed.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/model-behavior.test.ts` — passed, 74 tests.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-scripted-runtime.test.ts -t 'carries a delayed V2 child completion'` — passed, 2 tests with 99 unrelated tests skipped; the real child request used `gpt-5.6-luna` while the root replied without waiting in both conversation scopes.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-subagent-usage.test.ts` — passed, 4 tests.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-runtime.test.ts -t 'holds the workspace boundary'` — passed, 3 tests with 272 unrelated tests skipped.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/hosted-runner-container-identity.test.ts` — passed, 23 tests.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/container-image-contract.test.ts` — passed, 11 tests; the image catalog contains exactly Luna, Terra, and Sol with Flex, and validation fails for either a missing product model or an added non-product model.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-scripted-runtime.test.ts -t 'carries a delayed V2 child completion|rejects a non-product child model|defers broad Murph schemas|keeps physical-note recovery deferred|keeps narrow group reads eager|sends flex service tier'` — passed, 7 tests with 95 unrelated tests skipped; the production-shaped catalog admits the Luna child, native Codex rejects `gpt-5.5` before any child provider request, and every existing catalog-backed App Server path remains green.
- `pnpm --dir apps/web test:prepared hosted-runtime-internal-routes.test.ts` — passed, 64 tests.
- `pnpm --dir packages/hosted-execution typecheck`, `pnpm --dir packages/assistant-runtime typecheck`, `pnpm --dir packages/assistant-engine typecheck`, `pnpm --dir apps/cloudflare typecheck`, and `pnpm --dir apps/web typecheck` — passed.
- Pinned Codex 0.147.0 complete first-request capture with `gpt-tokenizer` 3.4.0 (`o200k_harmony`) — direct changed from 26,777 tokens / 122,618 bytes to 26,711 / 122,332 (-66, -0.2465%, -286 bytes); group changed from 24,046 / 110,136 to 23,965 / 109,873 (-81, -0.3369%, -263 bytes). Volatile local paths and UUIDs were normalized. The only provider-visible changes were the reviewed persistent-versus-one-task guidance and removal of the two non-product bundled models from native collaboration guidance; every other selected field was identical.
- `pnpm docs:drift` — passed.
- `git diff --check` and the task-scoped direct-identifier scan — passed.
- Canonical ReviewGPT round 2 on pushed head `76bc5e5db11df0b745a583657704e70b40e486a9` — `ROUND_OUTCOME: PASS`; the reviewer confirmed the prior catalog/billing finding is closed at the real App Server provider boundary and found no new qualifying issue.
- Parent final call-path and diff review — passed with no unresolved accepted/actionable finding. The implementation retains one Web authority decision, one optional hosted projection, one direct Codex config mapping, and the existing image-owned native catalog boundary; no new state, service, router, or lifecycle owner was introduced.
- Exact-head required CI and the current-base merge-tree remain post-plan release gates after `scripts/finish-task` creates the archival commit.
Completed: 2026-08-25
