# Land hosted contract and local-state hard cuts

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Remove the remaining compatibility fallbacks called out in the hosted wake→ingress contract, hosted-run Prisma baseline, hosted run redacted vault-sync summary shape, and local assistant-usage pending filename handling without widening beyond those hard-cut seams.

## Success criteria

- Hosted-execution parsers only accept canonical ingress-event keys and counts.
- Hosted-run Prisma baseline and schema use canonical ingress column names with no legacy `wake_ids_json` aliasing.
- Hosted runtime redacted summaries only write plural `vaultSyncImports`, and hosted web only reads the plural shape.
- Runtime-state assistant usage no longer deletes legacy pending filenames and no longer carries the legacy helper path logic.
- Focused verification and required audit passes complete, or unrelated existing failures are documented truthfully.

## Scope

- In scope:
- `packages/hosted-execution/src/{parsers.ts,parsers/run-control.ts}`
- Directly coupled hosted-execution parser tests only if needed
- `apps/web/prisma/{schema.prisma,migrations/2026040600_init/migration.sql}`
- Directly coupled Prisma generation outputs only if the repo updates them from this schema baseline
- `apps/web/src/lib/{hosted-ingress/store-append.ts,hosted-run/store.ts,vault-sync/session-service.ts}`
- `apps/cloudflare/src/{runner-outbound/turn-input.ts,user-runner.ts}`
- `packages/assistant-runtime/src/hosted-runtime/execution.ts`
- `packages/runtime-state/src/assistant-usage.ts`
- Directly coupled tests for the touched seams
- `agent-docs/exec-plans/active/{2026-04-23-hosted-hard-cut-cleanups.md,COORDINATION_LEDGER.md}`
- Out of scope:
- Any redesign of hosted device-sync, snapshot cleanup, key rotation, external/provider payload normalizers, or local assistant-usage semantics beyond removing the legacy cleanup path.

## Constraints

- Technical constraints:
- Preserve canonical contracts and current writer behavior; remove only the named compatibility fallbacks and aliases.
- Do not touch `apps/cloudflare/src/user-key-store.ts` legacy key-location handling.
- Treat existing dirty-tree edits in overlapping hosted/device-sync files as authoritative context; do not revert or absorb unrelated churn.
- Product/process constraints:
- Use `gpt-5.4` `xhigh` subagents for the implementation slices requested by the user.
- Follow the shared ledger/plan workflow and required verification/audit steps before handoff.

## Risks and mitigations

1. Risk: Removing legacy parser keys could break stale serialized hosted payloads that still cross a parsing boundary.
   Mitigation: Verify current writers only emit canonical ingress keys, tighten parser tests to canonical keys only, and keep the cut limited to the named parsers.
2. Risk: Renaming the baseline Prisma column could drift the schema, migration, and generated client.
   Mitigation: update the baseline schema and migration together, then run Prisma generation/typecheck paths that prove the current app code matches the new canonical column name.
3. Risk: Hard-cutting the singular vault-sync redacted summary field could hide conflict counts for older hosted-run rows.
   Mitigation: remove only the named dual-write and reader fallback, and document that pre-cut rows need reset/ignore semantics if the old field still exists.
4. Risk: Removing legacy pending assistant-usage filename cleanup could leave stale local residue.
   Mitigation: keep the code cut narrow, verify current filename resolution still works, and document the one-time local pending-usage reset expectation in handoff.

## Tasks

1. Remove hosted wake/run-control parser fallbacks for `wakeId`, `wakeIds`, and `pendingWakeCount`, and keep proof on canonical ingress keys only.
2. Rename the hosted-run baseline Prisma column away from `wake_ids_json`, regenerate any required Prisma artifacts, and verify current hosted-run callers still match.
3. Remove the singular vault-sync redacted-summary dual-write/fallback and the local assistant-usage legacy pending-path cleanup helpers.
4. Run focused verification, required audit passes, and close/commit only if the shared ledger churn allows a safe scoped commit.

## Decisions

- Split implementation ownership across disjoint `gpt-5.4 xhigh` workers: hosted-execution parser cut, Prisma baseline cut, assistant-runtime/runtime-state cleanup, and web/cloudflare canonical-key follow-through.
- Keep this as a hard cut rather than a compatibility shim because the listed canonical contracts/writers are already in place and the user explicitly requested the cleanup.

## Verification

- Commands to run:
- `pnpm typecheck`
- A truthful `pnpm test:diff ...` or focused owner-level verification over the touched hosted-execution, apps/web, apps/cloudflare, assistant-runtime, and runtime-state surfaces
- `pnpm test:smoke`
- Expected outcomes:
- The touched seams pass focused verification on canonical ingress keys/column names only, with any unrelated pre-existing branch failures documented explicitly.

## Outcome

- Completed the hosted parser hard cut, the hosted-run Prisma baseline rename, the plural-only vault-sync redacted-summary cut, and the runtime-state pending-usage legacy cleanup removal.
- Follow-up simplify audit found two real cleanup gaps, both fixed:
- hosted-execution parsers now reject legacy `wakeId`, `wakeIds`, and `pendingWakeCount` even when dual-key payloads also include the canonical ingress keys.
- assistant-runtime no longer carries the dead aggregate `vaultSyncImportResult` slot in `HostedRunDrainMetrics`.
- Required audits completed:
- `simplify` found the two issues above and they were fixed before rerunning affected checks.
- `coverage-write` found no additional proof worth adding.
- `task-finish-review` found no further blocking issues.
- Verification results:
- `pnpm typecheck` passed.
- `pnpm --dir packages/hosted-execution test:coverage -- test/parser-threshold-coverage.test.ts test/hosted-execution-parsers-coverage.test.ts test/hosted-execution.test.ts` passed.
- `pnpm --dir packages/runtime-state test:coverage` passed.
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-run-store.test.ts test/vault-sync-session-service.test.ts` passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-run-drain-coverage.test.ts` passed.
- `pnpm test:smoke` passed.
- Direct runtime proof passed for canonical ingress parsing plus legacy-key rejection and canonical assistant-usage listing/deletion with leftover legacy filename ignore semantics.
- `git diff --check` on the touched files passed.
- `pnpm test:diff ...` remains blocked by the unrelated pre-existing `packages/assistant-engine/test/assistant-wrapper-exports.test.ts` failure expecting `executeCodexPrompt`.
- No scoped commit was created because these touched files overlap earlier uncommitted work in the same dirty tree and the shared `COORDINATION_LEDGER.md` also carries unrelated concurrent churn, so an exact task-only commit would have absorbed work outside this task.
