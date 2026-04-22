# Research Orchestrator Templates

This directory holds the tracked prompt architecture and preset data used by `pnpm research:init`.

What lives here:

- `prompts/`: the reusable DAG-stage prompt templates
- `presets/`: topic presets that specialize family slugs, protocol slugs, discovery shards, and section seams

What `research:init` does:

- chooses a preset when the topic matches one
- creates a per-topic workspace under `output-packages/research/`
- renders the prompt templates with topic-specific metadata
- creates runnable review:gpt command wrappers for the charter and discovery tranche
- leaves later reducer, extraction, synthesis, and QA prompts as generated templates with explicit `TODO_*` placeholders

The generated workspaces are intended to be human-reviewable and safe to inspect in git diffs if needed. They should not hardcode local absolute paths.
