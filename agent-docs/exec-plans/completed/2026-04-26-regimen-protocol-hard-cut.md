# Regimen Protocol Hard Cut

## Goal

Make the private vault naming unambiguous:

- legacy private health-bank `protocol` records become `regimen` records
- Health Commons-backed private adaptation records become private `protocol` records
- public Health Commons commands remain under `commons protocol`

Success means the contracts, storage families, query/read models, vault usecases, CLI command graph, generated schemas, tests, and durable docs no longer expose the old private adaptation/profile surface or legacy private `protocol` as agent-facing concepts.

## Constraints

- This is a greenfield hard cut. Do not add compatibility aliases for old `protocol` or old profile commands.
- Preserve unrelated dirty-tree work. The repository already has active overlapping CLI, contracts, core, query, and vault-usecases edits; work with them instead of reverting them.
- Public Health Commons protocol variants keep their public protocol vocabulary and `commons protocol` command surface.
- Avoid privacy-sensitive examples. Use neutral names and do not write local account paths or personal identifiers into docs, fixtures, or logs.
- Dependency changes are out of scope.

## Scope

Primary files are expected under:

- `packages/contracts/**`
- `packages/core/**`
- `packages/query/**`
- `packages/vault-usecases/**`
- `packages/cli/**`
- directly coupled generated schema and incur artifacts
- `docs/contracts/**` and directly coupled assistant/agent command docs

Do not widen into Health Commons content research or hosted runtime work except where tests or prompt copy directly references the renamed surfaces.

## Target Model

- `regimen`: private medication/supplement/therapy/habit registry, stored under `bank/regimens/**`, with `docType: "regimen"` and `regimenId`.
- `protocol`: private reusable Health Commons-backed adaptation, stored under `bank/protocols/**`, with `docType: "protocol"`, `protocolId`, `commonsProtocolRef`, structured diff, effective spec, personalization, `effectiveSpecHash`, and `protocolRevisionId`.
- `commons protocol`: public Health Commons recipe lookup and run source.
- `experiment`: points to `commonsProtocolRef`, optionally points to private `protocolRef`, and snapshots `effectiveProtocolSnapshot`.

## Plan

1. Land the contract/schema rename and generated schema outputs.
2. Land core and query storage/read-model rename paths.
3. Land vault-usecases and CLI command graph changes: `regimen ...`, `protocol upsert/list/show`, and no old profile subcommand.
4. Update experiment planning/start surfaces to use `commonsProtocolRef`, private `protocolRef`, and `effectiveProtocolSnapshot`.
5. Update docs, command manifests, prompts, and tests to remove ambiguous legacy terminology.
6. Regenerate generated artifacts and run focused package verification, then broader checks where truthful.
7. Run required review passes and close this plan with a scoped commit if the dirty tree allows it; otherwise archive the plan and report the overlap blocker.

## Verification Targets

- `pnpm --dir packages/contracts typecheck`
- `pnpm --dir packages/contracts test`
- `pnpm --dir packages/core typecheck`
- `pnpm --dir packages/core test`
- `pnpm --dir packages/query typecheck`
- `pnpm --dir packages/query test`
- `pnpm --dir packages/vault-usecases typecheck`
- `pnpm --dir packages/vault-usecases test`
- `pnpm --dir packages/cli typecheck`
- focused CLI tests for `regimen`, `protocol`, `commons protocol`, and experiment plan/start
- `pnpm typecheck` and diff-aware verification if not blocked by unrelated active work

## State

Created 2026-04-26. Greenfield hard cut is implemented and focused verification is green.

Completed:

- Added private `protocol` as the Health Commons-backed adaptation store and moved legacy medication/supplement/therapy/habit records to `regimen`.
- Updated experiments to use `commonsProtocolRef`, optional private `protocolRef`, and required `effectiveProtocolSnapshot` for protocol-backed runs.
- Removed the old protocol-profile/writePath surfaces from contracts, Health Commons onboarding, command capabilities, docs, fixtures, assistant prompts/tests, share packs, browser-vault export, and hosted share previews.
- Kept public Health Commons lookup under `commons protocol` and private protocol commands to `protocol upsert/list/show`.

Verification:

- Passed: `pnpm --dir packages/contracts generate`
- Passed: `pnpm --dir packages/contracts typecheck`
- Passed: `pnpm --dir packages/contracts test`
- Passed: `pnpm --dir packages/core typecheck`
- Passed: `pnpm --dir packages/core test`
- Passed: `pnpm --dir packages/query typecheck`
- Passed: `pnpm --dir packages/query test`
- Passed: `pnpm --dir packages/vault-usecases typecheck`
- Passed: `pnpm --dir packages/vault-usecases test`
- Passed: `pnpm --dir packages/health-commons generate`
- Passed: `pnpm --dir packages/health-commons generate:check`
- Passed: `pnpm --dir packages/health-commons typecheck`
- Passed: `pnpm --dir packages/health-commons test`
- Passed: `pnpm --dir packages/assistant-engine typecheck`
- Passed: `pnpm --dir packages/assistant-engine test`
- Passed: `pnpm --dir packages/assistant-runtime typecheck`
- Passed: `pnpm --dir packages/assistant-runtime test`
- Passed: `pnpm --dir apps/cloudflare typecheck`
- Passed: focused `apps/cloudflare` node-runner test
- Passed: `pnpm --dir apps/web typecheck`
- Passed: focused hosted-share/browser-vault/join web tests
- Passed: focused CLI regimen/protocol/commons/experiment suites
- Passed: stale-surface scans for old profile/writePath/attachedProtocol/legacy protocol commands
- Passed: `git diff --check`

Known blocker:

- `pnpm --dir packages/cli typecheck` still fails in an unrelated active typed-food lane at `packages/cli/test/food-save-typed-parity.test.ts(253,30)` because `payloadWriteCall[2]` may be `undefined`.

Commit/close:

- Do not commit from this lane yet. The shared checkout has extensive overlapping active rows and unrelated dirty work across hosted, CLI, Health Commons research, and runtime lanes.
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
