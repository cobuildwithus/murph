# telegram hardening

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Harden the Telegram assistant path so direct/private Telegram conversations round-trip correctly, unsupported Telegram surfaces stop leaking into assistant sessions, and transient Telegram failures do not stall later replies.

## Success criteria

- Telegram normalization and delivery preserve routing for plain chats, private-chat topics, channel direct-message topics, and business-account chats.
- Edited messages and channel posts stop creating assistant turns by default.
- Telegram auto-reply is scoped away from non-direct chats and keeps scanning after a failed Telegram send.
- Outbound Telegram sends split overlong replies, retry transient failures, honor retry-after hints, and include structured routing fields.
- Setup only reports Telegram as fully configured when the token can authenticate, and focused tests cover the new Telegram edge cases.

## Scope

- In scope:
  - Telegram connector/type/normalizer changes in `packages/inboxd`
  - Telegram target parsing and outbound delivery hardening in `packages/cli`
  - assistant auto-reply scoping, queue-progress, and Telegram-specific prompt/context fixes
  - setup Telegram readiness checks and focused runtime/docs updates
  - targeted tests for Telegram business/direct-topic/edited-message/retry/private-scope cases
- Out of scope:
  - live Telegram network round-trips during repo automation
  - broad assistant/store or setup module refactors unrelated to Telegram behavior
  - full Telegram feature parity beyond the routing and reliability surfaces above

## Risks and mitigations

1. Risk: `setup-services.ts` and adjacent setup files are already part of an active hotspot refactor.
   Mitigation: keep the setup change narrow, reuse existing abstractions, and avoid unrelated module moves.
2. Risk: changing Telegram thread ids could fragment or regress existing session reuse.
   Mitigation: preserve the old `<chatId>` and `<chatId>:topic:<messageThreadId>` encodings and only extend them when newer Telegram routing fields are present.
3. Risk: non-blocking auto-reply failure handling could hide delivery problems.
   Mitigation: emit explicit failure events, persist failure artifacts when needed, and cover the queue-advance behavior with tests.

## Tasks

1. Update Telegram type/normalizer/connector code to model direct-message topics, business routing, reply/media metadata, and supported update classes.
2. Add structured Telegram target parsing plus outbound send splitting/retry/timeout behavior.
3. Tighten assistant auto-reply scoping and queue progress so Telegram failures do not block later captures.
4. Wire setup Telegram readiness to a real authentication probe and adjust operator-facing text where runtime semantics changed.
5. Add focused tests, run completion-workflow audits, rerun required checks, and commit only touched files.

## Verification

- Focused:
  - `pnpm exec vitest --no-coverage packages/cli/test/assistant-channel.test.ts` ✅
  - `pnpm exec vitest --no-coverage packages/cli/test/assistant-runtime.test.ts` ✅
  - `pnpm exec vitest run --config packages/inboxd/vitest.config.ts --no-coverage packages/inboxd/test/telegram-connector.test.ts` ✅
  - `pnpm exec vitest run --no-coverage --config .tmp-vitest-setup-channels.config.mjs` with a one-off temp config that included only `packages/cli/test/setup-channels.test.ts` ✅
  - `pnpm exec vitest --no-coverage packages/cli/test/setup-cli.test.ts` ❌ blocked by the unrelated top-level initialization failure in `packages/cli/src/inbox-services/promotions.ts` (`ReferenceError: Cannot access 'canonicalMealManifestSchema' before initialization`)
- Required:
  - `pnpm typecheck` ❌ blocked by unrelated pre-existing failures in `packages/cli/src/inbox-services.ts`, `packages/cli/src/inbox-services/promotions.ts`, and `packages/cli/src/usecases/vault-usecase-helpers.ts`
  - `pnpm test` ❌ blocked by the same unrelated workspace build failures before test execution
  - `pnpm test:coverage` ❌ blocked by the same unrelated workspace build failures before coverage execution
- Completion workflow:
  - `simplify`
  - `test-coverage-audit`
  - `task-finish-review`
