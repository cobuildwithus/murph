# Daemon Restart Cleanup

## Goal

Remove the temporary daemon-side connector restart compatibility shim so foreground inbox/parser runs expose one restart configuration surface instead of both the legacy boolean/delay fields and the new policy object.

## Scope

- `packages/inboxd/src/kernel/daemon.ts`
- `packages/parsers/src/inboxd/pipeline.ts`
- `packages/cli/src/inbox-app/{types,runtime}.ts`
- targeted `packages/inboxd/test/connectors-daemon.test.ts`
- targeted `packages/cli/test/inbox-cli.test.ts`

## Non-Goals

- Do not remove the low-level `runPollConnector(...)` restart options yet.
- Do not change connector-specific retry logic such as Telegram polling backoff.
- Do not alter provider or outbound channel retry behavior from the prior reliability hardening patch.

## Invariants

- Foreground parser-backed runs still enable restartable connectors through the policy surface.
- `runInboxDaemon(...)` still keeps healthy sibling connectors alive under `continueOnConnectorFailure`.
- Existing `runPollConnector(...)` callers still have access to the old restart boolean/delay inputs.

## Plan

1. Remove daemon-facing legacy restart boolean/delay/max-delay inputs from `runInboxDaemon(...)`, parser wiring, and CLI runtime module types.
2. Simplify daemon restart-policy resolution so only `connectorRestartPolicy` feeds the outer restart wrapper.
3. Update targeted tests to assert the policy-only surface and rerun the narrow inbox/runtime regression set.

## Verification

- `pnpm exec vitest run --no-coverage packages/inboxd/test/connectors-daemon.test.ts packages/cli/test/inbox-cli.test.ts`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

Status: completed
Updated: 2026-03-26
Completed: 2026-03-26
