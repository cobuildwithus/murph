# Browser-vault dashboard projection hard cut

Status: completed
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Replace the hosted browser-vault snapshot's canonical-entity payload with a typed dashboard projection bundle.
- Keep the hosted dashboard surfaces working while removing the extra hosted copy of broad canonical vault entities.

## Success criteria

- New hosted browser-vault snapshots contain only the dashboard-facing projection data needed by the current dashboard pages.
- The dashboard pages no longer depend on reconstructing a generic canonical `VaultReadModel` from hosted snapshots.
- The browser-vault contract is a hard cut to the projection schema with no legacy entity-snapshot bridge.

## Scope

- `packages/query/src/{browser,browser-snapshot,overview,timeline,wearables,read-model}/**`
- directly coupled `packages/query/test/**` only if required
- `packages/assistant-runtime/src/hosted-runtime/browser-vault.ts`
- directly coupled `packages/assistant-runtime/test/**` only if required
- `apps/web/src/lib/browser-vault/context.tsx`
- `apps/web/app/(dashboard)/**`
- directly coupled `apps/web/test/**` only if required
- `ARCHITECTURE.md`
- `agent-docs/references/testing-ci-map.md` if verification ownership changes

## Constraints

- Keep the hosted snapshot contract narrow and product-facing; do not add a second generic query API just to mirror canonical vault entities.
- Preserve decrypt-in-browser behavior and the existing browser-vault session auth boundary.
- Hard-cut the snapshot schema instead of carrying a compatibility bridge.
- Preserve unrelated dirty-tree edits and active hosted-runtime / dashboard rows.

## Verification

- done: `pnpm --dir packages/query typecheck`
- done: `pnpm --dir packages/query build`
- done: `pnpm --dir packages/query exec vitest run test/browser-vault-snapshot.test.ts test/browser-entry-surface.test.ts --no-coverage`
- done: `pnpm --dir packages/assistant-runtime typecheck`
- done: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-browser-vault.test.ts test/hosted-runtime-finalize-coverage.test.ts --no-coverage`
- done: `pnpm --dir apps/web typecheck`
- done: `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/browser-vault-dashboard-pages.test.tsx --no-coverage`
- done: `pnpm --dir apps/cloudflare typecheck`
- done: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/browser-vault-store.test.ts apps/cloudflare/test/runner-run-processor.test.ts --no-coverage`
- done: `git diff --check` on the scoped browser-vault paths
- attempted earlier and not used as final proof: `bash scripts/workspace-verify.sh test:diff ...` hit unrelated workspace/runtime issues outside this hard-cut lane, so owner-level verification is the truthful final evidence for this task

## Notes

- Long-term target is a typed dashboard projection bundle, not a hosted clone of canonical entities.
- The user explicitly requested a greenfield hard cut, so this task should not retain or parse the legacy entity snapshot schema.
- The hard cut now bumps the browser snapshot schema to `murph.browser-vault-dashboard-snapshot.v2` because the hosted payload shape intentionally broke compatibility.
- The final browser payload removes canonical path/provenance fields from history, weekly sample summaries, wearable metrics, assistant summaries, and source-health diagnostics; nested parsers fail closed on unexpected keys to keep the contract tight.
- The browser dashboard now fails closed when the hosted snapshot sidecar is missing instead of rendering an empty ready state, so export/store failures surface as unavailable data rather than “no data yet.”
Completed: 2026-04-20
