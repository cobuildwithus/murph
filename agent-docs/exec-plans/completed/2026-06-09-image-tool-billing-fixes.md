# Image tool billing and robustness fixes on PR #77

Status: completed
Created: 2026-06-09
Updated: 2026-06-09

## Goal

- Close the review findings on the GPT Image 2 dynamic tool branch
  (`codex/gpt-image-2-dynamic-tool`) with the smallest correct fixes, stacked
  as a PR into that branch.

## Success criteria

- Additional-usage credential attribution uses the same `effectiveEnv` rule as
  the primary turn, so image generations are not metered as member-credential
  when the member key env is listed but unset.
- The OpenAI image request has a bounded deadline; a timeout surfaces as a
  tool-failure reply, not a turn abort.
- The continuity E2E destroy matcher only counts `activity-expired` destroys
  and baselines after first completion, closing the false-pass window.
- The raw-token leak fixture in `codex-runtime-helpers.test.ts` is restored.
- Docs tell the truth about Images-unconfigured deploys (paid call then upload
  503) and about upstream Codex dropping dynamic tools on cold thread/resume.

## Scope

- In scope:
  - `packages/assistant-engine/src/assistant/service-usage.ts` (+ call sites in
    `notification-turn.ts`, `local-service.ts`)
  - `packages/assistant-engine/src/assistant-codex/openai-image-generation.ts`
  - `apps/cloudflare/test/hosted-local-codex-container-continuity-e2e.test.ts`
  - `apps/cloudflare/test/hosted-local-container-continuity-e2e.test.ts`
  - `packages/assistant-engine/test/codex-runtime-helpers.test.ts` (+ focused
    coverage for the two behavior fixes)
  - `apps/cloudflare/DEPLOY.md`, `packages/assistant-engine/README.md`
- Out of scope (consciously rejected for complexity):
  - Worker-to-container Images capability plumbing (bounded loud failure;
    escalate only if traces show real burn).
  - Merging the abandoned primary run's image usage into the invalid-output
    fallback result (ordinal collision needs a new concept; rare-squared path).
  - Failed-request usage drafts (failures are not billed; rpc text + traces
    already surface them).
  - Murph-side machinery for the upstream dynamic-tools-on-resume gap.

## Decisions

- Upstream codex (verified at source) accepts dynamic tools only on
  thread/start, drops them to an empty list on cold resume, and offers no
  resume/turn field to re-send them. The fix belongs upstream; Murph documents
  the limitation instead of building workarounds.
- Attribution fix is symmetry with `createAssistantProviderUsageAttribution`:
  pass the turn's effective env through `recordAdditionalAssistantUsageEvents`.
- Timeout composes `AbortSignal.timeout` with the caller signal inside
  `generateOpenAiImage`; `TimeoutError` is not an `AbortError`, so the existing
  tool catch already converts it into a failure reply.

## Verification

- Focused vitest for service-usage, generate-image/openai-image tests.
- `bash scripts/workspace-verify.sh test:diff <touched files>`
- `pnpm typecheck`

## Progress

- effectiveEnv made a required input of `recordAdditionalAssistantUsageEvents`
  and passed at all four service call sites; seam test asserts forwarding.
- `generateOpenAiImage` now always runs under a 120s deadline composed with
  the caller signal; new test pins TimeoutError -> tool failure reply (not a
  turn abort) and that a signal is always present.
- Continuity E2E matchers count activity-expired destroy-request logs only and
  baseline after first completion; helper renamed to
  `countActivityExpiredDestroyRequestLogs` in both tests.
- Raw-token leak fixture restored in `codex-runtime-helpers.test.ts`.
- DEPLOY.md states the real Images-unconfigured behavior (billed generation,
  upload 503) and the escalation condition for capability plumbing; engine
  README documents the upstream dynamic-tools-on-cold-resume gap verified in
  codex-rs source.
- Consciously dropped from the review findings: worker-to-container Images
  capability plumbing, invalid-output fallback usage merge (ordinal collision
  needs a new concept for a rare-squared path), failed-request usage drafts.
- Verification green: focused engine suites (82 tests), root `pnpm typecheck`,
  `test:diff` over all touched files (exit 0), `pnpm docs:drift`.
- Final review-only audit subagent approved with four non-blocking
  observations (proof-strength/wording), recorded in the PR description.
Completed: 2026-06-09
