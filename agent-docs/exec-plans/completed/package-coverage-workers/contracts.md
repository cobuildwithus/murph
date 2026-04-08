Package owner: `@murphai/contracts`
Path: `packages/contracts`
Current shape: about 21 source files, 0 tests

Task

Create a clean Vitest-based package-local test surface for `@murphai/contracts` and make it ready for package-wide root coverage.

Your ownership

- You own `packages/contracts/**`.
- You may add package-local shared test helpers under `packages/contracts/test/**`.
- Do not edit root `vitest.config.ts`, `config/**`, or other packages. Report root-integration needs in your final message.
- Preserve unrelated worktree edits.

Workflow

1. Read the package config and current verification path.
2. Compare repo coverage-enabled package patterns and identify the lightest-weight way to add package-local Vitest coverage here.
3. Start with a thorough plan in commentary:
   - whether a new package-local `vitest.config.ts` is needed
   - what package-local test harness should look like
   - which contract seams need coverage first
   - GPT-5.4 high subagent split
4. Add package-local coverage config and tests in the same repo style.
5. Spawn GPT-5.4 high subagents for disjoint seams such as:
   - ids/constants/current-profile or small pure helpers
   - schemas/zod/validation/frontmatter
   - automation/memory/shares or event-lifecycle helpers
6. Integrate the changes and keep tests pure and deterministic.
7. Run package-local verification and report what root integration should do for this new package coverage surface.

Requirements

- Keep the new test surface simple and reusable.
- Avoid introducing runtime behavior changes.
- Do not commit.
