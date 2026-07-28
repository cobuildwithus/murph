# Image response transcript presence

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Preserve a content-free image-presence fact in assistant transcript history
  when a response contains both text and image media.

## Success criteria

- A later assistant turn can distinguish an image-bearing prior response from a
  text-only response without retaining media URLs or alt text.
- Text-only and voice-memo transcript behavior remains unchanged.
- Focused regression coverage fails on the prior behavior and passes with the
  correction.
- Required verification, preliminary specialist review, final ReviewGPT, and
  CI complete on the exact pushed PR head.

## Scope

- In scope: assistant response transcript projection and focused
  assistant-engine tests.
- Out of scope: image generation lifecycle, provider delivery receipts,
  database schema, Cloudflare orchestration, and outbound message copy.

## Constraints

- Keep the transcript fact content-free and independent of provider URLs or
  model-authored media descriptions.
- Do not claim provider delivery; record only that the assistant response
  included image media.
- Add no queue, scheduler, persisted product-state owner, or dependency.

## Tasks

1. Add a focused failing regression for a text response with image media.
2. Implement the smallest transcript projection correction.
3. Run focused tests, typecheck, and canonical affected-path verification.
4. Complete required specialist and final PR review gates with exact-head CI.

## Decisions

- Reuse the existing assistant transcript as the owner of prior assistant
  response context.
- Prefix one fixed image-presence marker so bounded fresh-thread history keeps
  the fact; never copy media metadata into transcript history.

## Verification

- Production evidence: image generation completed; automatic reply dispatch was
  provider-accepted and delivery-receipted without failure. A later fresh model
  turn started before that receipt and received text-only assistant history,
  proving the failure was history projection rather than transport.
- The focused final-response regression failed before the source correction.
- Focused image-presence, preceding-response, media-only, and bounded-history
  tests passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm test:diff packages/assistant-engine/src/assistant/local-service.ts
  packages/assistant-engine/test/assistant-local-service-runtime.test.ts
  packages/assistant-engine/test/assistant-codex-turn-planning.test.ts` passed
  every affected typecheck and the full Assistant Engine suite after the
  coverage remediation (180 files, 2,803 passed, 8 skipped); the unrelated
  reverse-dependent CLI phase became irreversibly red under concurrent
  shared-host verification with eight 60-second CLI command/session timeouts
  and ten Health Commons experiment failures, so the task-owned run was stopped
  rather than collecting redundant failures.
- Canonical remote `pnpm verify:acceptance` passed the affected suites, the
  reverse-dependent CLI files that failed on the shared host, and the broad
  typecheck/web/Cloudflare lanes. It exited red only on the unrelated
  setup-assistant Venice wizard timing test; that unchanged test passed
  immediately in isolation.
- The exact-head hosted image-delivery E2E was replayed locally twice, including
  once with CI-equivalent streamed logging. All three direct, async-completion,
  and upload-failure cases passed both times. The separate unchanged web
  handoff-timeout test that failed in CI also passed in isolation.
- An unchanged-head CI rerun then passed the complete Codex media and provider
  egress E2E leg, including the automatic async image-completion scenario.
- Required local `product-experience-review`: two material findings were
  accepted and fixed (pre-steer image responses and long-history truncation);
  targeted re-review returned `NO FINDINGS` with no material evidence gaps.
- Preliminary `completion-specialists` ReviewGPT: one medium coverage finding
  was accepted for the supported image-only/empty-text branch. Its attached
  patch was downloaded from the owned review thread, inspected as test-only,
  and applied deliberately; the focused runtime lane then passed all four image
  and media-only cases. The substantive preliminary pass is not rerun by
  workflow contract.
Completed: 2026-07-28
