You are Codex Worker W2 operating in the current shared worktree. Do not create a commit.

Before any code changes:
- Read `AGENTS.md` and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Use the pre-registered ledger row `codex-worker-canonical-collector`; update it if scope shifts, and remove it before finishing.
- Keep this behavior-preserving: do not change the public `collectCanonicalEntities` overloads, tolerant-vs-strict semantics, output ordering, or failure accumulation rules.

After changes:
- Run the narrowest truthful tests you touch.
- Remove your ledger row before finishing.
- Final response: summary, files changed, tests run, blockers.

Task:

Simplify `packages/query/src/health/canonical-collector.ts` by collapsing the duplicated strict/tolerant and sync/async collection pipelines and removing the cast-heavy registry collector setup.

Relevant files/symbols:
- `packages/query/src/health/canonical-collector.ts`
  - `collectCanonicalEntities`
  - `collectCanonicalEntitiesStrict`
  - `collectCanonicalEntitiesTolerantAsync`
  - `collectCanonicalEntitiesTolerantSync`
  - `readRegistryCollections*`
  - `readCurrentProfile*`
  - `REGISTRY_COLLECTORS`
  - `buildCanonicalHealthCollection`
- `packages/query/src/health/registries.ts`
- direct call sites only if required:
  - `packages/query/src/model.ts`
  - `packages/query/src/export-pack-health.ts`

Regression anchors to preserve:
- `packages/query/test/health-tail.test.ts`
  - strict malformed-input rejection cases
  - tolerant current-profile fallback and orphan-markdown cases
  - tolerant malformed-registry handling
- export-pack tests that depend on tolerant collection behavior

Best-guess fix:
1. Keep the public overloads, but route them through one shared pipeline with a small injected strategy.
2. Collapse the registry readers into one helper parameterized by the read/failure strategy.
3. Replace `REGISTRY_COLLECTORS` casts with a collector config helper that matches actual usage.

Overlap notes:
- This surface is comparatively isolated. Keep the patch limited to the canonical collector and the minimum adjacent type/call-site updates needed to make the refactor compile and test cleanly.

