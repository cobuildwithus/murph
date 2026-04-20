# Audit and land remaining hard-cut compatibility cleanups

Status: completed
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Verify whether the four proposed hard-cut cleanups are already landed in the current repo state.
- If any cleanup is still outstanding, land the smallest current-shape simplification that removes the leftover compatibility surface without widening behavior.
- Keep the repo aligned with the greenfield owner-boundary posture documented in `ARCHITECTURE.md`.

## Success criteria

- `packages/vault-usecases` no longer exposes workout-owned measurement compatibility wrappers if they are still present.
- `@murphai/assistant-cli` exports only the intentional assistant CLI public subpaths that still have live callers.
- Hosted execution and assistant-runtime legacy wake/event alias types are removed if they are still unused.
- The local hosted-dev environment helper no longer strips deprecated proxy env vars if those names truly have no remaining readers.

## Scope

- `packages/vault-usecases/src/**`
- `packages/assistant-cli/package.json`
- directly coupled `packages/assistant-cli/src/**` only if export removal makes files unreachable or tests need updates
- `packages/hosted-execution/src/contracts.ts`
- `packages/assistant-runtime/src/hosted-runtime/models.ts`
- `scripts/dev-hosted-local/environment.ts`
- directly coupled tests/docs for the touched surfaces only

## Constraints

- Preserve unrelated dirty-tree edits already in flight across hosted runtime, hosted web, and Cloudflare surfaces.
- Keep package boundaries narrow; do not replace one compatibility shim with another.
- Do not remove active parser rejection paths for legacy payloads unless current source-of-truth docs and callers prove they are obsolete.
- Prefer compile-time hard cuts over speculative runtime fallback logic.

## Risks and mitigations

1. Risk: A hidden internal caller still imports a compatibility surface.
   Mitigation: Search current repo callers first, then let the typechecker and diff-aware verification confirm the cut.

2. Risk: Export-surface cleanup in `assistant-cli` breaks internal relative imports or active Ink UI wiring.
   Mitigation: Remove package exports before deleting implementation files, and only delete files if they become provably unreachable.

3. Risk: Alias cleanup in hosted execution accidentally removes real wire-contract behavior.
   Mitigation: Restrict that cut to unused type aliases only and preserve the live parsers and rejection branches.

4. Risk: Environment cleanup removes an active local-dev variable.
   Mitigation: Verify there are no remaining readers of the deprecated env names before removing the scrub and its tests.

## Tasks

1. Register the lane and inspect current callers for each proposed cleanup.
2. Fan out four worker lanes, one per recommendation, to verify landed vs. outstanding and patch their owned surface if needed.
3. Integrate any needed edits in the shared tree, keeping scope narrow and aligned with the repo boundary rules.
4. Run scoped verification and required audit passes for the touched owners.
5. Commit the scoped change and report landed/not-landed status for each recommendation.

## Verification

- passed: `pnpm --dir packages/assistant-cli test:coverage`
- passed: `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --project cli-assistant packages/cli/test/assistant-core-facades.test.ts --no-coverage`
- passed: `git diff --check -- packages/assistant-cli/package.json packages/assistant-cli/test/assistant-command-runtime.test.ts`
- failed for unrelated pre-existing reason: `pnpm typecheck` -> `config/vitest-package.ts(4,29): error TS2305: Module '"vitest/config"' has no exported member 'UserConfig'.`

## Outcome

1. `packages/vault-usecases` workout-measurement wrapper cleanup was already landed in the workspace; no additional edits were needed in this lane.
2. `@murphai/assistant-cli` still exposed `./assistant/stop`; this lane removed that final private compatibility subpath and aligned the package-manifest test.
3. Hosted wake/event alias cleanup was already effectively landed for the proposed dead aliases; the remaining `HostedExecutionWake` alias still has live internal test callers, so this lane left it intact.
4. Deprecated hosted-local proxy env scrubbing was already removed in the workspace; no additional edits were needed in this lane.
Completed: 2026-04-20
