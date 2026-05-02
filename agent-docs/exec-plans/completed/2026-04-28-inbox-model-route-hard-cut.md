# Inbox Model Route Hard Cut

Status: completed
Owner: Codex
Started: 2026-04-28

## Goal

Remove or fail-closed-delete the legacy `vault-cli inbox model route` command/runtime surface for the Codex App Server hard cut.

Success criteria:

- `vault-cli inbox model route` is not registered, invokable, advertised in help, or present in CLI command contracts.
- Model-route-only AI SDK/OpenAI-compatible harness leftovers are deleted where no longer used.
- `inbox model bundle` remains only as a non-model audit/debug artifact if still useful.
- Focused CLI and assistant-engine tests cover the hard cut.
- Residue scans show no live `inbox model route` surface outside negative assertions or historical/owned docs.

## Scope

In scope:

- `packages/assistant-engine/src/inbox-model-harness.ts`
- `packages/assistant-engine/src/inbox-model-contracts.ts`
- `packages/assistant-engine/test/codex-hard-cut-contract.test.ts`
- `packages/cli/src/commands/inbox*.ts`
- `packages/cli/test/inbox-model-*.test.ts`
- `packages/operator-config/src/inbox-cli-contracts.ts` only if needed
- `fixtures/golden-outputs/**` only if generated CLI help snapshots require it
- Adjacent assistant automation daemon/client boundaries only where required to
  fail-close dead model-route-only request fields.

Out of scope:

- Docs/smoke files owned by the docs/smoke hard-cut lane.
- Cloudflare deploy files.
- Hosted-runtime env files.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not write local usernames, home paths, legal names, or direct personal identifiers into files, logs, prompts, tests, or handoff.
- Do not commit.

## Plan

1. Inspect current CLI command wiring, contracts, tests, and hard-cut assertions.
2. Use read-only worker passes for CLI and assistant-engine surface review, then integrate manually.
3. Remove route command wiring/runtime leftovers and update tests/contracts.
4. Run focused tests, typecheck where practical, and residue scans.
5. Run required completion audits if tooling is available, then hand off without committing.

## Verification Log

- Read-only completion/audit passes completed. Addressed findings for stale CLI
  generated schema text, dead assistant-engine bundle contract exports,
  assistant-cli facade negative coverage, and dead `/automation/run-once`
  `modelSpec` forwarding. Stale docs/smoke wording was left untouched because
  it belongs to another active lane.
- `pnpm --dir packages/cli gen:config-schema` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-cli typecheck` passed.
- `pnpm --dir packages/assistantd typecheck` passed.
- `pnpm --dir packages/cli typecheck` passed.
- `pnpm --dir packages/assistant-engine test -- test/codex-hard-cut-contract.test.ts test/assistant-automation-runtime.test.ts` passed: 89 files, 781 tests.
- `pnpm --dir packages/assistant-cli test -- test/assistant-runtime-service-seams.test.ts` passed: 20 files, 118 tests.
- `pnpm --dir packages/assistantd test -- test/http-coverage.test.ts test/service-coverage.test.ts` passed: 11 files, 45 tests.
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage --project cli-inbox-setup --testNamePattern "materializeInboxModelBundle"` passed: 1 file passed, 9 skipped; 9 tests passed, 141 skipped.
- `MURPH_CLI_TEST_PERSISTENT_HARNESS=0 pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage --project cli-schemas-smoke --testNamePattern "inbox help surfaces the first-pass operator commands|inbox model help exposes bundle only"` passed: 1 file passed, 28 skipped; 2 tests passed, 228 skipped.
- `git diff --check` passed.
- Residue scans passed for live `inbox model route` sources/config/fixtures and
  dead automation `modelSpec` forwarding; remaining matches are negative tests,
  generic `providerModel` fields, or the fail-closed assistantd HTTP rejection.
- Direct built CLI checks passed: `inbox model route` returns
  `COMMAND_NOT_FOUND`; `--llms` advertises `inbox model bundle` and not
  `inbox model route`; bundle schema keeps `sensitive` and omits `baseUrl`,
  `apiKey`, and `headersJson`.
Updated: 2026-05-02
Completed: 2026-05-02
