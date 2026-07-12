Goal (incl. success criteria):
- Reduce Vault CLI fresh-process startup work by removing avoidable imports and preserving truthful Incur command discovery.
- Success means ordinary scoped commands do not evaluate Codex lifecycle implementation code, standalone `--version` avoids the full command graph, installed Incur skills no longer force ordinary scoped commands onto the full graph, measured hot roots use scoped builders, and regression tests plus bundle evidence protect those boundaries.

Constraints/Assumptions:
- Prefer deletion and existing routing primitives over new registries or command metadata layers.
- Keep unconditional CLI shutdown cleanup safe for every command; do not use a command allowlist for child-process cleanup.
- Preserve full-tree routing for global help/discovery, schema, MCP, completion, skill generation, unknown roots, and ambiguous argv.
- Keep Incur command state single-instanced in generated bundles.
- Avoid the active runner-bundle dependency-prune lane except for narrowly scoped proof that cannot live with the owning CLI tests.

Key decisions:
- Make the assistant-engine lifecycle entrypoint a tiny registration facade; assistant Codex code registers the existing stop implementation when it loads.
- Restore a standalone version routing plan without changing ambiguous mixed-argument behavior.
- Extend the existing explicit scoped-root switch for measured assistant hot paths rather than adding another routing abstraction.
- Change Incur skill freshness to accept a canonical full-tree fingerprint supplied by the CLI, generated and verified with existing CLI artifacts.
- Defer speculative container dynamic-tool splitting until a separate measured prototype proves a runner-entry closure reduction.

State:
- Implementation, broad pre-rebase verification, and the required coverage-write audit are complete; ready for the scoped task commit and PR lane.

Done:
- Reviewed recent bundle changes, current static/evaluated closures, representative fresh-process CPU cost, Incur skill-sync behavior, and scoped-routing gaps.
- Created an isolated task branch and worktree from current `origin/main`.
- Replaced the lifecycle re-export with a registration facade while preserving the existing shutdown implementation and semantics.
- Added the exact standalone version route and extended the existing scoped switch to nine measured hot roots.
- Patched Incur with the minimal public full-tree hash and scoped staleness-override seam; updated the lockfile patch hash.
- Generated and verified the canonical full-tree skill hash through the existing CLI artifact pipeline, including alias-safe parity with Incur's stored structural hash.
- Kept installed Incur skills on scoped command paths while preserving truthful full-tree staleness checks.
- Moved three typed health-save core imports behind their handlers; the representative built condition-list closure fell from 350 to 222 resolved modules (36.6%).
- Added deterministic built-CLI import-surface contracts for standalone version, scoped health reads, and lifecycle cleanup.
- Added exact standalone version output before operator-config/full-tree construction; the built path resolves 15 modules under the new 20-module ceiling.
- Preserved full-tree MCP routing regardless of `--mcp` position and updated the Cloudflare container-entrypoint lifecycle mock for the new registration export.
- Passed the truthful diff-coverage lane across CLI, assistant, runtime, core, hosted-local, and web reverse dependents; passed complete Cloudflare verification (94 Node test files / 1,706 tests plus the Workers test).
- Closed the required coverage-write audit with zero findings and no edits; deterministic import-surface tests are the stable regression boundary for startup work, while real-machine wall-clock variance remains non-gating.

Now:
- Close this active plan with the scoped implementation commit.

Next:
- Rebase onto current `origin/main`, rerun post-rebase verification and dependency guards, push the branch, open the PR, and run ReviewGPT plus CI to zero accepted findings and merge-ready status.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-engine/src/codex-lifecycle.ts`
- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/test/**`
- `packages/cli/src/cli-entry.ts`
- `packages/cli/src/vault-cli-routing.ts`
- `packages/cli/src/vault-cli-command-routing.ts`
- `packages/cli/scripts/**`
- `packages/cli/test/**`
- `apps/cloudflare/test/container-entrypoint.test.ts`
- Incur dependency patch/config and lockfile only if the canonical fingerprint seam requires it
- `pnpm test:diff ...`
- built CLI and runner-bundle closure/CPU probes
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
