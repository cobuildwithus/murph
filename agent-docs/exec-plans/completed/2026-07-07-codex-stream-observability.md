# Codex Stream Observability

## Goal

Make Codex stream/provider transport failures and fresh-thread recovery decisions queryable from hosted runtime logs without storing prompts, message contents, provider payloads, raw identifiers, URLs, or local paths.

## Constraints

- Metadata-only diagnostics; no raw prompts, transcripts, message content, provider response bodies, IDs, auth values, or local paths.
- Keep the change focused on existing assistant provider trace plumbing and hosted runtime log projection.
- Preserve existing retry/fresh-thread behavior; this task only adds observability.
- Do not touch unrelated dirty `apps/web` changes in the current checkout.
- Run focused tests and typechecks before handoff.

## Plan

1. Inspect Codex stream failure, resume failure, fresh-thread fallback, and hosted provider-trace log paths.
2. Add derived transport fields for terminal/exhausted stream failure patterns.
3. Add a metadata-only fresh-thread fallback lifecycle trace for resumed transport failures.
4. Project the new trace/fields through hosted runtime structured logs.
5. Add focused tests, run verification, review privacy/scope, and commit only scoped files.

## Verification

- `pnpm --dir packages/assistant-engine test -- codex-runtime-helpers.test.ts`
- `pnpm --dir packages/assistant-engine test -- assistant-codex-runtime.test.ts`
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-events.test.ts`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- Diff/privacy review before commit

## State

Implemented and ready to close.

- Added metadata-only terminal/exhausted transport booleans.
- Added metadata-only fresh-thread fallback lifecycle trace events for resumed transport failures.
- Projected the new trace and transport fields through hosted runtime structured logs.
- Focused assistant-engine and assistant-runtime tests/typechecks passed.
- Scoped `test:diff` passed static guards, logging guard, owner package typechecks, assistant-cli tests, assistant-engine tests, assistant-runtime tests, and assistantd tests; it failed later in reverse-dependent CLI tests on unrelated paths:
  - `packages/cli/test/release-script-coverage-audit.test.ts` expects missing `agent-docs/operations/pr-deep-review-loop.md`.
  - `packages/cli/test/cli-expansion-intervention.test.ts` `intervention edit/delete` got `edited.ok === false`.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
