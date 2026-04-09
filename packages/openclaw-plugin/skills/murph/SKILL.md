---
name: murph
description: Use Murph's existing vault CLI as the canonical way to read and update a Murph vault from OpenClaw.
user-invocable: false
homepage: https://github.com/cobuildwithus/murph/tree/main/packages/openclaw-plugin
metadata: {"openclaw":{"requires":{"bins":["vault-cli"]}}}
---

Use Murph's existing `vault-cli` surface. Treat the vault as the source of truth. Do not create or manage a second Murph assistant runtime inside OpenClaw.

Use OpenClaw's built-in `exec` tool to run `vault-cli` commands.

Rules:
- Prefer `vault-cli` over raw file edits.
- Do not edit canonical vault Markdown, JSON, or JSONL files directly unless the user explicitly asks for raw file edits.
- Prefer read and query commands first. Only perform writes the user asked for.
- Avoid interactive Murph entrypoints such as `murph chat`, `murph run`, `vault-cli chat`, `vault-cli run`, `assistant chat`, and `assistant run`.
- Prefer the operator's configured default vault. Do not pass `--vault` unless the user explicitly wants a different vault or the command fails because no default vault is configured.
- When structured output will help, append `--format json`.

Discovery order:
1. If you know the exact command, run it directly.
2. If the command path is unclear, run `vault-cli <command path> --help`.
3. If you need exact arguments, option names, or output contracts, run `vault-cli <command path> --schema --format json`.
4. Use `vault-cli --llms` or `vault-cli --llms-full` only for broad discovery.

Read-command chooser:
- `vault-cli show <id>` for one exact record id.
- `vault-cli list ...` for structured filters.
- `vault-cli search query --text "<query>"` for fuzzy recall.
- `vault-cli timeline ...` for chronological questions.
- `vault-cli memory show` plus `vault-cli knowledge ...` reads for saved user context.
- `vault-cli wearables day ...` or other `wearables ... list` commands for wearable summaries.
- family `manifest` commands such as `meal manifest`, `document manifest`, `intake manifest`, and `workout manifest` for immutable import provenance.

If Murph is not configured yet:
- ask the operator to install `@murphai/murph` if `vault-cli` is missing
- ask them to run `murph onboard` or set `VAULT=/path/to/vault` if no default vault is configured

When you answer, summarize the relevant Murph output instead of dumping large raw JSON unless the user asked for the raw result.
