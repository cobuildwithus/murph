Package owner: `@murphai/assistant-engine`
Path: `packages/assistant-engine`
Current shape: about 140 source files, 5 tests

Task

Expand package-local coverage readiness for `@murphai/assistant-engine` so the root repo coverage lane can include this package with package-wide patterns rather than curated file lists.

Your ownership

- You own `packages/assistant-engine/**`.
- You may add package-local shared test helpers under `packages/assistant-engine/test/**` when that reduces duplication.
- Do not edit root `vitest.config.ts`, `config/**`, or other packages. If central integration is needed, report it in your final message.
- Preserve unrelated dirty edits in this package. There is already in-flight assistant-engine work in the tree.

Workflow

1. Read the package `vitest.config.ts`, `package.json`, current tests, and the source surface.
2. Compare coverage-enabled package patterns in `packages/core`, `packages/hosted-execution`, `packages/importers`, and `packages/query`.
3. Start with a thorough package plan in commentary:
   - proposed package-local coverage config
   - major untested seams
   - shared test harness/helpers to reuse or add
   - proposed GPT-5.4 high subagent split
4. Add package-local coverage config in the same repo style if needed.
5. Spawn GPT-5.4 high subagents for disjoint seams inside this package. Prefer seams such as:
   - assistant runtime/store/state and locking
   - provider execution/failover/outbox
   - automation/channel/web-search or knowledge helpers
   Adjust the split to the real package shape you find. Keep write ownership disjoint.
6. Integrate the subagent changes, keep tests high-value and behavior-oriented, and avoid line-chasing.
7. Run package-local verification and report:
   - what you changed
   - which harness/helpers are now shared
   - what root integration should include for this package

Requirements

- Reuse existing helper patterns before creating new harnesses.
- Prefer a small number of package-local shared helpers over many copy-pasted stubs.
- Keep the package API and behavior unchanged.
- Do not commit.
