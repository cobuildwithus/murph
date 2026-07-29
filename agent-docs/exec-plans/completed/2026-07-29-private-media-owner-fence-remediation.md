# Private media owner-fence remediation

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Resolve ReviewGPT round 3 by preserving vault-file ownership when an approved
  vault send coexists with an earlier reply-required output failure.
- Make the hosted approval-resume test prove container shutdown from the
  awaited test control instead of bounded rolling logs.

## Success criteria

- An approved vault file keeps the existing visible-reply obligation and owns
  the response-media slot for that delivery context.
- A later vault-file or response-media request is rejected without a second
  provider callback, while the required recovery text remains deliverable.
- The approval-resume test observes completed container shutdown and the
  persisted idle checkpoint without parsing lifecycle logs.
- Focused tests, canonical verification, ReviewGPT, exact-head CI, deployment,
  runtime proof, and worktree retirement pass.

## Scope

- Assistant dynamic-tool final-action ownership and its focused regression.
- Hosted-local activity-expiry test control and approval-resume proof.
- Directly affected architecture and reliability documentation.

## Constraints

- Add no persisted state, queue, reconciliation path, or production lifecycle.
- Reuse the existing final-action patch as the single turn-local owner.
- Preserve visible recovery text and ordinary approved vault-file delivery.

## Tasks

1. [x] Preserve vault-file ownership on the sticky reply-required patch.
2. [x] Block later response-media tools while that owner is active.
3. [x] Replace rolling-log lifecycle inference with a deterministic test-control
   result.
4. [x] Run focused and canonical verification.
5. [ ] Complete ReviewGPT round 4, exact-head CI, merge, deployment, runtime
   proof, and worktree retirement.

## Verification

- `pnpm --filter @murph/assistant-engine typecheck`
- `pnpm --filter @murph/cloudflare typecheck`
- Focused assistant regressions passed, including the mixed-output owner fence.
- Full assistant Codex runtime suite passed: 231 tests.
- Full hosted-local harness suite passed: 19 tests.
- Hosted-local approval-resume E2E passed through a real idle shutdown and cold
  resume.
- Hosted-local image-media delivery E2E passed: 3 tests.
- `pnpm test:diff` passed every admitted guard, package typecheck, and package
  suite. Its final Cloudflare app leg remained unadmitted for ten continuous
  minutes behind unrelated shared-host verifiers; no test failed.
- Canonical `pnpm verify:acceptance` passed on the exact candidate tree through
  the bounded Testbox lane, including 2,053 Cloudflare Node tests, 2 Cloudflare
  Workers tests, all affected package suites, coverage guards, and builds.
- `git diff --check`
Completed: 2026-07-29
Completed: 2026-07-29
