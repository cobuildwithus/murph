# Worker 08: Integration, Dependencies, Residue

You are one of several parallel Codex workers editing the same current worktree. The user explicitly approved subagents for this hard-cut effort; actively look for independent subtasks and spawn focused subagents to parallelize exploration, implementation, or review while you keep the immediate critical path local. Give each subagent a narrow scope, explicit file ownership, and a requirement not to commit or revert unrelated work. Do not launch codex-workers recursively. Do not commit.

Read:

- `AGENTS.md`
- `agent-docs/exec-plans/active/2026-04-28-codex-app-server-hard-cut.md`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/operations/completion-workflow.md`

## Ownership

You own final integration cleanup after the source workers have landed enough changes:

- `packages/assistant-engine/package.json`
- `packages/cli/package.json`
- `pnpm-lock.yaml`
- package exports affected by deleted files
- docs touched only to keep architecture/runtime docs truthful
- residue scans and verification notes

Avoid broad source edits unless fixing stale imports/exports from files deleted by other workers.

## Goal

Remove AI SDK dependencies and prove there is no active Murph AI SDK/OpenAI-compatible assistant runtime left.

## Required Work

- Remove these deps wherever no longer used:
  - `ai`
  - `@ai-sdk/openai`
  - `@ai-sdk/openai-compatible`
- Update `pnpm-lock.yaml` through normal package-manager workflow.
- Remove stale package exports or barrels pointing at deleted modules.
- Run residue scans:

```sh
rg "from 'ai'|from \"ai\"|@ai-sdk|generateText|generateObject" packages apps
rg "openai-compatible|responses" packages/assistant-engine/src packages/operator-config/src packages/cli/src packages/assistant-runtime/src apps/cloudflare/src
rg '"(ai|@ai-sdk/openai|@ai-sdk/openai-compatible)"' package.json packages/*/package.json apps/*/package.json pnpm-lock.yaml
```

Expected allowed residue:

- Vercel AI Gateway provider config with `wire_api = "responses"` for Codex.
- Explicit fail-closed legacy messages if source workers kept minimal parsers.
- Historical docs only if not part of live architecture.

There should be no active AI SDK import and no active OpenAI-compatible assistant provider.

## Verification

Run:

```sh
pnpm deps:guard
pnpm typecheck
pnpm test:diff packages/assistant-engine packages/operator-config packages/assistant-runtime packages/cli apps/cloudflare
```

If full diff-aware verification is blocked by ongoing worker edits or unrelated dirty work, run the package-local fallback commands listed in the plan and report exact blockers.

Final message must include:

- dependency changes
- residue scan results
- verification commands and results
- remaining known blockers by likely owner
- whether the hard-cut definition of done is met
