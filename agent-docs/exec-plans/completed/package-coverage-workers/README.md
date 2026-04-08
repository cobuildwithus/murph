# Package coverage worker prompts

These prompts are for the package-coverage rollout tracked by:

- `agent-docs/exec-plans/active/2026-04-08-package-coverage-rollout.md`

Each prompt owns one target package.

Shared rules for the worker batch:

- Stay package-local by default.
- Reuse existing repo coverage config patterns and package-local test helpers instead of cloning setup.
- Package workers may add package-local shared harness files under their owned package when that reduces duplication.
- Do not edit root `vitest.config.ts`, shared repo config under `config/**`, or another package unless the prompt explicitly assigns that file. Report root-integration needs in the worker final message instead.
- Preserve unrelated worktree edits. This repo already has active overlapping lanes.
- Do not commit from worker lanes.

Package targets:

- `assistant-engine.md`
- `assistant-runtime.md`
- `assistantd.md`
- `murph.md`
- `contracts.md`
- `device-syncd.md`
- `inboxd.md`
- `messaging-ingress.md`
- `openclaw-plugin.md`
