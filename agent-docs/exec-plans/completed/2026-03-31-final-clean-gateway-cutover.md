# Final Clean Gateway Cutover

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Finish the dedicated gateway-core root cutover cleanly by keeping `@murph/gateway-core` as the real owner of the transport-neutral gateway exports, adding assistantd-backed routing for steady-state local gateway operations, and exposing that daemon-aware send path on the compatibility local surface without pretending `@murph/gateway-core/local` is fully migrated yet.

## Success criteria

- `@murph/gateway-core` root ownership remains local and no longer proxies back through `murph/gateway-core`.
- Local gateway list/get/read/fetch/send/events/permissions helpers prefer assistantd when the configured daemon client is available and otherwise fall back to the direct vault-backed path.
- `murph/gateway-core-local` exposes the daemon-aware gateway send helper.
- Regression tests lock in root ownership, daemon-client behavior, and local gateway behavior.
- Required verification commands complete without new failures.

## Scope

- In scope:
  - `packages/cli/src/gateway-daemon-client.ts`
  - `packages/cli/src/gateway/local-service.ts`
  - `packages/cli/src/{gateway-core,gateway-core-local}.ts`
  - `packages/cli/test/{gateway-core,gateway-daemon-client,gateway-local-service}.test.ts`
  - `packages/assistantd/test/http.test.ts`
  - `packages/gateway-core/README.md`
  - `packages/assistantd/README.md`
  - coordination/plan artifacts needed for repo policy
- Out of scope:
  - moving the vault-backed `@murph/gateway-core/local` implementation out of the monolith
  - removing every remaining direct `murph` dependency from downstream consumers
  - unrelated gateway-serving, assistant-core, Cloudflare, or docs lanes already active in the worktree

## Constraints

- Technical constraints:
  - Preserve one-way ownership: the dedicated root package must stay locally owned, but `@murph/gateway-core/local` may remain transitional for now.
  - Keep assistantd routing loopback/token-gated by reusing the existing assistant daemon client configuration rules.
- Product/process constraints:
  - Treat the uploaded patch as intent; port it carefully onto the newer gateway-core state instead of blindly applying it.
  - Preserve unrelated dirty worktree edits in the overlapping gateway, assistant, and Cloudflare files.

## Risks and mitigations

1. Risk: the uploaded patch targeted an older tree and no longer applied cleanly.
   Mitigation: diff the patch against live files, port only the intended behavior, and re-run package-shape plus full verification.
2. Risk: local gateway daemon routing could accidentally bypass the existing local fallback path.
   Mitigation: wrap each steady-state gateway helper with daemon-first logic that returns to the current local implementation whenever the assistantd client is not configured.
3. Risk: package-shape enforcement could reject the new ownership regression proof.
   Mitigation: keep the proof in tests, but resolve the other package source path dynamically so the assertion survives without weakening the guardrail.

## Tasks

1. Inspect the uploaded final-clean gateway cutover patch and port its delta onto the current repo state.
2. Add the new assistantd-backed gateway daemon client and wire daemon-first fallback behavior into local gateway service helpers.
3. Expose the daemon-aware gateway send helper on the compatibility local surface and align `murph/gateway-core` exports with the dedicated root surface where needed.
4. Add regression coverage for gateway root ownership and daemon-client routing, then refresh the gateway/assistantd README notes.
5. Run focused verification, workspace typecheck, and full workspace tests; then close the coordination artifacts for this lane.

## Decisions

- Keep `@murph/gateway-core/local` intentionally transitional. This turn finishes the dedicated root cutover and the steady-state local authority path, not the full vault-backed local implementation move.
- Reuse the existing assistant daemon client configuration seam instead of inventing a second gateway-specific env contract.
- Expand the `murph/gateway-core` compatibility export surface enough to match the dedicated root boundary where the tests now rely on it, but do not attempt the full old-path shim flip while `@murph/gateway-core` still carries the transitional local dependency.

## Verification

- Commands run:
  - `pnpm --dir packages/cli exec vitest run test/gateway-core.test.ts test/gateway-daemon-client.test.ts test/gateway-local-service.test.ts --no-coverage --maxWorkers 1`
  - `pnpm --dir packages/assistantd exec vitest run test/http.test.ts --no-coverage --maxWorkers 1`
  - `pnpm --dir packages/gateway-core exec tsc -p tsconfig.json --noEmit --pretty false`
  - `pnpm --dir packages/cli exec tsx ./scripts/verify-package-shape.ts`
  - `pnpm typecheck`
  - `pnpm test`
- Expected outcomes:
  - Gateway and assistantd focused tests pass.
  - CLI package shape stays valid.
  - Workspace typecheck passes.
  - Full workspace tests pass.

Completed: 2026-03-31
