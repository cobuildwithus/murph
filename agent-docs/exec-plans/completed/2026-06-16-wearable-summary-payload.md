Goal (incl. success criteria):
- Reduce excessive wearable summary CLI payloads for `wearables day`, `wearables latest`, and `wearables drift` without changing canonical wearable storage or provider ingestion.
- Success means default JSON output omits repeated confidence/debug/null scaffolding unless explicitly requested, focused tests prove the behavior, and required verification passes.

Constraints/Assumptions:
- Keep `packages/query` as the semantic wearable read-model owner and `packages/cli` thin.
- Preserve a way to inspect full confidence/debug detail for operator diagnostics.
- Do not touch unrelated dirty files in the current checkout.
- No provider API behavior change is assumed or needed.

Key decisions:
- Compacting happens at the command service/export boundary in `packages/vault-usecases`, not canonical wearable storage or the `packages/query` diagnostic read model.
- CLI schemas stay exact for the compact command contract and strip unknown full-detail fields after service calls.
- The import-surface contract probe now runs from its temp directory so a local repo `./vault` cannot satisfy the intentionally vault-less probe.

State:
- Active.

Done:
- Repo routing, wearable triage skill, device/provider docs, and query/package boundaries read.
- Traced payload bloat to repeated per-metric confidence/selection envelopes, null metric scaffolding, and duplicated `latest.day` category summaries.
- Implemented compact serializers for wearable command outputs and updated CLI schemas/tests.
- Fixed local hermeticity in the CLI import-surface guard.
- Required focused tests, `test:diff`, root `pnpm typecheck`, security/privacy review, coverage-write pass, direct no-value command scan, whitespace check, and identifier scan passed.

Now:
- Final scoped commit via `scripts/finish-task`.

Next:
- Handoff with root cause, compact-output behavior, verification, and audit results.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/vault-usecases/src/usecases/integrated-services.ts`
- `packages/vault-usecases/src/usecases/types.ts`
- `packages/vault-usecases/test/wearables-query-services.test.ts`
- `packages/cli/src/commands/wearables.ts`
- `packages/cli/test/wearables-schema.test.ts`
- `packages/cli/test/vault-cli-import-surface-contract.test.ts`
- `agent-docs/exec-plans/active/2026-06-16-wearable-summary-payload.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
