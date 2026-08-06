# Restore Venice GPT-5.6 prompt-cache reuse

Status: completed
Created: 2026-08-05
Updated: 2026-08-05

## Goal

Stop Venice-hosted GPT-5.6 turns from repeatedly paying to create the same
large Codex prompt cache entry when only the conversation tail changes.

## Success criteria

- The Venice `/responses` egress request marks the end of Codex's leading
  stable developer prefix with the GPT-5.6 `prompt_cache_breakpoint` shape.
- The existing session-stable `prompt_cache_key`, request content, tools,
  model mapping, and implicit-cache fallback remain unchanged.
- `/responses/compact` remains unchanged because Venice does not document the
  GPT-5.6 breakpoint fields on that endpoint.
- Focused tests prove the marked prefix stays byte-identical when later user
  and tool-history content changes, and prove future caller-supplied cache
  controls are preserved.
- The exact pushed PR head passes the required specialist, ReviewGPT, and CI
  gates.

## Scope

- In scope:
  - The existing Cloudflare Venice Responses compatibility transform.
  - Focused transform and intercepted-egress tests.
  - Durable Cloudflare architecture, reliability, and deployment guidance.
- Out of scope:
  - Terra/Luna/Sol usage-accounting changes or historical usage rewrites.
  - A Codex fork, custom runner image, new cache service, or new persisted
    cache state.
  - Provider purchases, balance changes, or uncapped live inference.

## Constraints

- Cloudflare remains the sole Venice request-translation and credential owner.
- Never log or persist prompt text, cache keys, provider bodies, credentials,
  or member identifiers as diagnostic evidence.
- Preserve the current fail-closed Responses Lite tool normalization.
- Apply the new field only to canonical GPT-5.6 `/responses` requests with a
  structurally supported leading developer content block.

## Risks and mitigations

1. Risk: Venice's Alpha Responses schema does not formally declare the new
   GPT-5.6 field.
   Mitigation: add only the nested breakpoint, retain implicit caching as a
   fallback, and require a capped post-deploy provider canary before enabling
   Venice broadly.
2. Risk: A breakpoint lands after changing conversation content.
   Mitigation: bound placement to the final supported block in the contiguous
   developer-only prefix that Codex prepends before the first conversation
   item; test changing tails explicitly.
3. Risk: A future Codex release emits its own cache policy.
   Mitigation: preserve caller-supplied breakpoints and top-level cache fields
   rather than overwriting or duplicating them.
4. Risk: Compact requests accept a different schema.
   Mitigation: pass the normalized endpoint into the transform and leave
   `/responses/compact` cache behavior unchanged.

## Tasks

1. [x] Reconstruct the production billing and deployed-request evidence.
2. [x] Verify current OpenAI, Venice, and Codex cache contracts.
3. [x] Implement the smallest endpoint-aware Venice compatibility transform.
4. [x] Add focused unit and intercepted-egress regression proof.
5. [x] Run Cloudflare focused tests, typecheck, and deterministic request proof.
6. [x] Commit, push, open a PR, and complete specialist, ReviewGPT, and CI.
7. [x] Record deployment order and the capped provider canary or exact blocker.

## Decisions

- 2026-08-05: Do not add `prompt_cache_options.mode = "explicit"`. OpenAI
  supports it, but Venice does not declare it; a nested breakpoint alone is
  sufficient to let the provider read the stable prefix while preserving its
  existing implicit cache behavior for the tail.
- 2026-08-05: Do not patch or fork Codex. Stable and current upstream Codex
  releases still emit `prompt_cache_key` but cannot emit
  `prompt_cache_breakpoint`; the existing Worker compatibility boundary can
  add this provider-specific field without changing runner identity.
- 2026-08-05: Use the last supported content block in the contiguous leading
  developer-message prefix. Codex Responses Lite emits tools, base
  instructions, then other initial developer context before conversation
  content; the Worker already converts the tool envelope before forwarding.
- 2026-08-05: Accepted the preliminary and final ReviewGPT finding that a
  hand-authored canary could bypass the Responses Lite compatibility path. The
  activation contract now requires one resumed thread through the candidate's
  pinned Codex App Server and exact pre-/post-transform shape proof.
- 2026-08-05: Accepted the preliminary coverage patch after inspecting its
  full test-only diff and passing `git apply --check`. The existing hosted-local
  warm-reuse scenario now feeds the body emitted by real pinned Codex through
  the production Venice transform and checks its key, tools, and breakpoint.

## Verification

- Focused Vitest for `runner-egress-venice` and Venice interception.
- `pnpm --dir apps/cloudflare typecheck`.
- `git diff --check` and secret/privacy scans over the scoped diff.
- Exact-head GitHub Actions plus preliminary `completion-specialists` and final
  ReviewGPT.
- Post-deploy: one capped two-request Sol canary must show a nonzero cache read
  on the second request and materially lower cache-write tokens, or Venice
  remains disabled and the provider compatibility gap is reported.

Completed local proof:

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  --no-coverage apps/cloudflare/test/runner-egress-venice.test.ts
  apps/cloudflare/test/runner-egress-intercept.test.ts` (242 tests passed).
- `pnpm --dir apps/cloudflare typecheck`.
- `pnpm docs:drift`.
- `git diff --check`.
- `pnpm hosted-local e2e warm-reuse-egress --profile e2e:stub` did not reach
  the scenario. The first attempt hit a 60-second CLI-manifest build timeout;
  the retry cleared that step and then stopped at the current-main runner bundle
  size guard (10,237,027 bytes versus a 10,219,693-byte total budget; 8,551,202
  bytes versus an 8,538,983-byte static-closure budget). This PR does not change
  any runner-bundle input or budget; the focused test remains committed for the
  exact-head hosted lane.
- Preliminary specialists returned one accepted product-experience finding and
  one accepted coverage finding. Final round 1 independently returned the same
  activation-canary finding. Both mechanisms were corrected with no production
  source growth.
- Final correction-verification round 2 returned `ROUND_OUTCOME: PASS` with no
  review-induced findings on
  `77e5e187388047b8b78bef50d4de8d3122670ae8`.
- All required GitHub Actions checks passed on that exact reviewed head.
Completed: 2026-08-05
