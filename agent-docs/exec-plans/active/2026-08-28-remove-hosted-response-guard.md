# Remove duplicate hosted response attachment guard

Status: active
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Remove the redundant hosted-runtime card/media validation branch while
  preserving the serialized hosted-effect parser and durable outbox admission
  as the two canonical invariant owners.

## Success criteria

- The callback helper no longer inspects response cards or media.
- Card/media coexistence remains rejected by hosted-effect parsing and outbox
  intent creation before provider dispatch.
- The hosted email-target rule and every independent delivery authority,
  liveness, routing, and provider-entry boundary remain unchanged.
- Focused tests and package typechecks pass on the exact candidate.

## Scope

- In scope: delete the duplicate card/media conflict branch in
  `packages/assistant-runtime/src/hosted-runtime/callbacks.ts` and make the
  existing owner tests name the canonical boundaries explicitly.
- Out of scope: assistant attachment-tool guards, assistant-engine delivery
  adapter guards, auth/fence/routing checks, response-card behavior changes,
  deployment protocol changes, and unrelated simplification candidates.

## Constraints

- Technical constraints: no new owner, abstraction, fallback, or compatibility
  path; retain malformed-effect rejection at the serialized parser and outbox.
- Product/process constraints: internal behavior-preserving cleanup; no member
  journey, visible reply, tool choice, or provider input may change.

## Risks and mitigations

1. Risk: removing an independent provider-entry safety boundary.
   Mitigation: prove all production effects traverse the serialized parser and
   are admitted by the outbox; retain the direct delivery-adapter boundary.
2. Risk: accidentally weakening the adjacent hosted email target restriction.
   Mitigation: narrow the helper input type to the remaining email fields and
   leave that branch byte-for-byte unchanged.

## Tasks

1. Delete the duplicate callback branch and narrow its helper input.
2. Keep focused parser/outbox regression coverage explicit.
3. Run focused tests, typechecks, diff checks, and inspect the final diff.
4. Commit, push, open a complete draft PR, and run the required sequential
   preliminary and final ReviewGPT gates against exact pushed heads.
5. Confirm exact-head CI and current-base mergeability; do not merge.

## Decisions

- Product UX: not applicable. This is an internal refactor with identical valid
  delivery behavior and identical malformed-effect rejection.
- Assistant live verification: not applicable. No model-visible instruction,
  tool contract, reply text, reply-versus-silence decision, or reachable effect
  changes; deterministic boundary tests are authoritative.
- Changelog: not applicable because no member-visible behavior changes.

## Verification

- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts --no-coverage test/side-effects.test.ts`
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-outbox-runtime.test.ts -t "persists and dispatches response cards through the existing outbox owner"`
- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- `git diff --check`
- Expected outcomes: both canonical owners reject card/media coexistence, valid
  serialized cards continue to round-trip, affected packages typecheck, and the
  diff contains no unrelated changes.
- Results:
  - Frozen dependency hydration passed after the fresh worktree initially had
    no local Vitest or TypeScript links.
  - Hosted-execution focused tests passed: 26 tests.
  - Assistant-engine focused outbox test passed: 1 test, 127 skipped.
  - Hosted-execution and assistant-runtime package typechecks passed.
  - `git diff --check` passed.
