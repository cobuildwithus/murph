# Research Orchestrator Templates

This directory holds the tracked prompt architecture used by the charter-first research tooling.

What lives here:

- `prompts/`: the reusable DAG-stage prompt templates
- `lib.mjs`: shared path-safety, wrapper-generation, and template-rendering helpers for the research tooling

What the workflow does:

1. `pnpm research:init` creates a per-topic workspace under `output-packages/research/` with only the charter prompt, charter command, and shared runner.
2. The charter response must return explicit machine-readable JSON blocks for the resolved protocol identity, discovery shards, section seams, source-extraction schema, and initial file plan.
3. `pnpm research:materialize --workspace <dir>` reads that charter output and generates the post-charter discovery commands plus later template prompts with explicit `TODO_*` placeholders.

The generated workspaces are intended to be human-reviewable and safe to inspect in git diffs if needed. They should not hardcode local absolute paths or bake in topic-specific default shard maps before the charter runs.
