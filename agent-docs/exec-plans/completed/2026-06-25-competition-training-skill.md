Goal (incl. success criteria):
- Land the supplied `competition-training` assistant skill packet into `packages/assistant-engine`.
- Success means the skill is registered in the assistant skill catalog, its progressive-disclosure references and eval corpus are present, focused tests prove the registry and structural invariants, and the repository-required scoped verification passes.

Constraints/Assumptions:
- Keep the change narrow: no new runtime service, dependency, schema, persisted state, CLI surface, migration, or generated artifact.
- Packet wrapper docs, validation reports, and patch helper files are integration artifacts and should not be committed unless the repo needs them.
- Preserve existing assistant skill architecture: route by registry hint, read `SKILL.md` on demand, and use references only through progressive disclosure.
- Preserve unrelated active ledger rows and avoid existing active experiment-onboarding work.

Key decisions:
- Base the worktree branch on `origin/main` to avoid unrelated local main changes.
- Treat the packet as behavioral intent and integrate it through existing assistant-engine skill assets instead of bulk-copying packet-level scaffolding.

State:
- Verification complete; ready to close and commit.

Done:
- Created an isolated worktree on `codex/competition-training-skill`.
- Inspected the archive manifest, integration guide, validation script, registry patch, skill root, and focused test.
- Ran the packet-local validator successfully in the extracted archive.
- Integrated the `competition-training` skill directory, eval corpus, assistant-engine registry entry, and focused structural test.
- Normalized the new skill payload to ASCII and fixed JSONL escaping after validation caught the affected scenario.
- Ran packet validation, assistant-engine package tests, assistant-engine typecheck, diff-aware affected verification, and root typecheck on the final content.

Now:
- Close the active plan and create the scoped commit.

Next:
- Push the branch, open a draft PR, and start the PR-lane review loop if tooling is available.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-engine/src/assistant-skill-assets.ts
- packages/assistant-engine/skills/competition-training/**
- packages/assistant-engine/test/assistant-competition-training-skill.test.ts
- pnpm --dir packages/assistant-engine test -- assistant-competition-training-skill.test.ts
- pnpm --dir packages/assistant-engine typecheck
- pnpm test:diff packages/assistant-engine/src/assistant-skill-assets.ts packages/assistant-engine/skills/competition-training packages/assistant-engine/test/assistant-competition-training-skill.test.ts
- pnpm typecheck
- node checks/validate.mjs from extracted packet root
- pnpm --dir packages/operator-config build
- pnpm build:test-runtime:prepared
- pnpm --dir packages/assistant-engine build
- pnpm --dir packages/health-commons generate
- git diff --check
- JSONL parse check for 100 eval scenarios
- ASCII and local identifier/secret scans over the new payload
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
