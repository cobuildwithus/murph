# PR 213 ReviewGPT round 12

## Goal

Resolve accepted ReviewGPT round 12 findings on PR 213:

1. Accepted no-reply completions must not allow the same side-effecting input
   to be retried after a later provider failure.
2. Overlapping visible progress must not escape while no-reply acceptance is
   awaiting durable persistence.
3. A later no-reply marker must not be committed before any earlier pending
   assistant answer that belongs before the steered user input.
4. Notification turns should not retain unreachable no-reply invalidation
   machinery now that `finish_without_reply` is disabled for them.

Success means the fixes are minimal, focused regressions pass, scoped
verification passes, the PR branch is pushed, and the next ReviewGPT round is
started.

## Constraints / Assumptions

- Preserve the round-10 flat outbox contract.
- Keep no-reply durability centralized; do not add a new persisted state owner.
- Prefer fail-closed behavior over speculative retry complexity.
- Do not expose secrets, local account identifiers, home-directory paths, or
  sensitive payloads in committed artifacts.

## Key decisions

- Reserve no-reply delivery contexts before awaiting marker persistence so
  overlapping progress/trace admission treats that context as suppressed.
- Reject later-context no-reply when an earlier completed assistant answer is
  pending, rather than introducing a new ordered commit buffer.
- If a terminal provider failure follows an accepted no-reply covering the
  latest accepted delivery context, complete the turn as a no-reply suppression
  outcome instead of surfacing a retryable failure.
- Delete notification-turn unsafe-history invalidation machinery because
  notification provider calls disable `finish_without_reply`.

## State

Active.

## Done

- Pushed round-11 commit `0a7e01aa8539`.
- Ran ReviewGPT round 12 against PR #213 and captured accepted findings.
- Patched Codex no-reply reservation, steered ordering rejection,
  local-service terminal no-reply completion, and notification cleanup.
- Verification passed:
  - `pnpm exec vitest run packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/assistant-engine/test/assistant-local-service-runtime.test.ts packages/assistant-engine/test/assistant-notification-turn-runtime.test.ts packages/assistant-engine/test/assistant-automation-runtime.test.ts packages/assistant-engine/test/assistant-service-runtime.test.ts`
  - `pnpm typecheck`
  - `git diff --check`
  - `pnpm test:smoke`
  - `pnpm test:diff -- packages/assistant-engine/src/assistant-codex.ts packages/assistant-engine/src/assistant/local-service.ts packages/assistant-engine/src/assistant/notification-turn.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/assistant-engine/test/assistant-local-service-runtime.test.ts`
- Required completion audits completed:
  - `security-privacy-review`: no critical/high/medium findings.
  - `coverage-write`: added reservation-window visible-output proof in
    `assistant-codex-runtime.test.ts`.
  - `deep-review`: no production-breaking bugs; residual later-ordinal
    terminal-failure proof gap closed with a local-service regression.
- Final post-audit verification passed:
  - `pnpm exec vitest run packages/assistant-engine/test/assistant-local-service-runtime.test.ts -t "no-reply"`
  - `pnpm exec vitest run packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/assistant-engine/test/assistant-local-service-runtime.test.ts packages/assistant-engine/test/assistant-notification-turn-runtime.test.ts packages/assistant-engine/test/assistant-automation-runtime.test.ts packages/assistant-engine/test/assistant-service-runtime.test.ts`
  - `pnpm typecheck`
  - `git diff --check`
  - `pnpm test:smoke`
  - `pnpm test:diff -- packages/assistant-engine/src/assistant-codex.ts packages/assistant-engine/src/assistant/local-service.ts packages/assistant-engine/src/assistant/notification-turn.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/assistant-engine/test/assistant-local-service-runtime.test.ts`

## Now

- Commit and push round-12 fixes.

## Next

- Commit, push, and run ReviewGPT round 13.

## Open questions

- None.

## Working set

- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant/local-service.ts`
- `packages/assistant-engine/src/assistant/notification-turn.ts`
- `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- `packages/assistant-engine/test/assistant-local-service-runtime.test.ts`
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
