# Add hosted device-sync failure logging

Status: completed
Created: 2026-05-03
Updated: 2026-05-03

## Goal

- Add privacy-bounded hosted runtime logging that makes device-sync job failures diagnosable after OAuth/connect succeeds.

## Success criteria

- Hosted device-sync failures produce durable structured runtime logs with provider, phase, sync timestamps, retry state, and sanitized error code/message.
- Logs avoid raw provider payloads, tokens, scopes beyond existing status facts, contact identifiers, account ids, connection ids, local paths, and health data.
- Focused tests cover the new log shape and non-regression behavior.
- Required verification passes or unrelated blockers are documented.

## Scope

- In scope:
  - `packages/assistant-runtime` hosted device-sync pass observability.
  - Directly coupled hosted-runtime tests.
- Out of scope:
  - Changing WHOOP provider sync behavior.
  - Changing hosted web device-sync persistence or UI status rules.
  - Adding new persisted tables or raw provider diagnostics.

## Constraints

- Use the existing hosted runtime log port and parser contract.
- Keep device-sync control-plane and execution-plane authority unchanged.
- Preserve unrelated active rows and dirty work in this checkout.

## Tasks

1. Identify the narrow hosted-runtime seam after device-sync jobs run and before control-plane reconciliation.
2. Emit one bounded log per newly observed failed connection state.
3. Add focused tests for redaction and log emission.
4. Run focused verification and typecheck.
5. Close the plan and commit the scoped change if safe.

## Decisions

- Prefer metadata-only durable logs over persisting raw provider error details in the hosted device-sync SQL rows.
- Treat the local account id and hosted connection id as sensitive correlation identifiers; log presence and provider/status facts instead.

## Verification

- Commands run:
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-maintenance`
  - `pnpm --dir packages/assistant-runtime test -- hosted-runtime-events-coverage`
  - `pnpm --dir packages/hosted-execution test -- hosted-runtime-control`
  - `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/maintenance.ts packages/assistant-runtime/src/hosted-runtime/events.ts packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts packages/assistant-runtime/test/hosted-runtime-events-coverage.test.ts packages/hosted-execution/src/runtime-control.ts packages/hosted-execution/test/hosted-runtime-control.test.ts`
  - `pnpm typecheck`
  - `pnpm test:smoke`
  - `git diff --check`
- Outcomes:
  - Focused and diff-aware tests passed.
  - Root typecheck passed.
  - Scenario smoke and diff hygiene passed.
Completed: 2026-05-03
