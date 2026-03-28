You are Codex Worker F2 operating in the current shared worktree. Do not create a commit.

Before any code changes:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Add your own row as `Codex Worker F2` with this lane's files/symbols and mark it `in_progress`.
- Keep this patch scoped to `packages/core/src/bank/providers.ts` and `packages/core/src/domains/shared.ts`.
- Do not touch `canonical-mutations.ts`; that cleanup is separate.

After changes:
- Run the narrowest relevant tests you touch.
- Remove your ledger row before finishing.
- Final response: summary, files changed, tests run, blockers.

Task:

Collapse the immediate helper duplication between `packages/core/src/bank/providers.ts` and `packages/core/src/domains/shared.ts`, and remove the no-op title-helper fork without changing behavior.

Best-guess fix:
- In `domains/shared.ts`, keep both exported names if needed, but back `ensureMarkdownHeading` / `replaceMarkdownTitle` with a single implementation.
- In `bank/providers.ts`, import and reuse:
  - `compactObject`
  - `normalizeOptionalText`
  - `uniqueTrimmedStringList`
  - the shared title/heading helper
  - `validateContract`
- Rebuild `validateProviderFrontmatter(...)` on top of `validateContract(providerFrontmatterSchema, ...)` while preserving exact provider error codes/messages.
- Keep provider-specific slug/body/path/conflict logic local.

Regression anchors:
- `packages/core/test/health-bank.test.ts`
- `packages/core/test/canonical-mutations-boundary.test.ts`
- `packages/core/test/core.test.ts`

