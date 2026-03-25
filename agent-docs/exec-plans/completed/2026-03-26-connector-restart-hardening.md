# Connector Restart Hardening

## Goal

Keep long-running inbox and assistant automation resilient when a single poll connector watch loop throws by automatically retrying that connector with bounded backoff instead of leaving it permanently dead for the rest of the run.

## Scope

- `packages/inboxd/src/kernel/daemon.ts`
- `packages/parsers/src/inboxd/pipeline.ts`
- `packages/cli/src/inbox-app/{runtime,types}.ts`
- focused `packages/inboxd/test/connectors-daemon.test.ts`
- focused `packages/cli/test/inbox-cli.test.ts`

## Non-Goals

- Do not rewrite connector-specific polling logic for email, Telegram, iMessage, or Linq.
- Do not change inbox source configuration, persisted daemon state schema, or canonical capture persistence contracts unless a tiny additive runtime field is unavoidable.
- Do not expose unsafe connector details in default terminal logs.

## Invariants

- Canonical/raw inbox writes remain exactly where they already happen.
- A connector failure must still surface through existing run events and remain debuggable.
- Abort signals must still shut the daemon down promptly and close connectors cleanly.
- Existing `continueOnConnectorFailure` semantics for sibling connectors staying alive must remain intact.

## Plan

1. Add daemon-level retry/backoff support around connector runs, keeping retries opt-in and bounded by the run signal.
2. Thread the restart option through parser and CLI runtime entrypoints so foreground inbox/assistant runs enable it without changing connector configs.
3. Add regression tests for successful restart-after-failure, repeated all-connector failure handling, and CLI/runtime option wiring.
4. Run focused tests first, then the required repo checks, then completion-workflow audit passes before commit.

## Verification

- `pnpm exec vitest run --no-coverage packages/inboxd/test/connectors-daemon.test.ts packages/cli/test/inbox-cli.test.ts`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- completion workflow audit passes: `simplify` -> `test-coverage-audit` -> `task-finish-review`
