# Assistant Memory Tools

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Replace the current heuristic-owned assistant memory flow with an explicit typed memory surface that the assistant can call through the existing CLI.
- Keep assistant memory local-first, Markdown-backed, outside the canonical vault, and non-authoritative versus vault records.
- Reduce bootstrap prompt bloat by keeping only durable core memory always in context and retrieving project/daily context on demand.

## Success criteria

- `vault-cli assistant memory search|get|upsert` exist as real CLI commands with documented structured outputs.
- Assistant chat/runtime code uses the typed memory layer for retrieval and commit decisions instead of directly auto-writing memory from every prompt.
- The assistant can decide when to persist memory, and the commit layer still enforces sectioning, dedupe, replacement, sensitivity, and vault-authority rules.
- Fresh sessions inject only a small core memory block by default; recent project/daily notes are retrieved on demand.
- Focused tests cover memory commands, typed memory service behavior, and the revised assistant session flow.

## Scope

- In scope:
  - assistant memory service refactor around typed `search`, `get`, and `upsert` operations
  - CLI command surface for assistant memory inspection and writes
  - assistant runtime changes so provider-backed chats can explicitly call memory commands through the existing CLI access path
  - tightening automatic memory writes into explicit remember/proposal-driven upserts rather than unconditional heuristic commits
  - focused tests and docs updates for the new behavior
- Out of scope:
  - vector or embedding-backed search
  - canonical vault writes derived from assistant memory
  - new external provider tool protocols beyond the existing CLI-mediated model access

## Constraints

- Keep the source of truth in Markdown under `assistant-state/<vault-bucket>/`.
- Keep assistant memory outside the canonical vault and non-canonical on conflicts.
- Do not persist raw prompt/response excerpts into memory files.
- Preserve provider session reuse, local transcript storage, and existing assistant binding/delivery semantics.
- Keep health-memory persistence stricter than general response-style memory and require explicit remember intent or an equivalent typed commit path.

## Risks and mitigations

1. Risk: the assistant writes noisy or overscoped memory through the new CLI surface.
   Mitigation: keep `upsert` typed, section-scoped, deduped, and policy-validated; reject unsupported/sensitive writes rather than silently broadening capture.
2. Risk: retrieval becomes too broad and bloats prompts anyway.
   Mitigation: keep bootstrap limited to core long-term memory; return cited, filtered snippets from `search`/`get` and let the assistant pull them only when relevant.
3. Risk: CLI topology drift breaks generated incur metadata.
   Mitigation: regenerate `packages/cli/src/incur.generated.ts` and add/adjust CLI tests with the command schema.
4. Risk: older tests assume unconditional post-turn memory extraction.
   Mitigation: rewrite the assistant-service tests around explicit remember/upsert behavior and preserve only the desired durable-memory cases.

## Tasks

1. Refactor assistant memory internals into typed read/search/upsert operations while preserving Markdown storage.
2. Add `vault-cli assistant memory search|get|upsert` and wire schemas/generated CLI metadata.
3. Update assistant system guidance and post-turn behavior so memory persistence is explicit and tool-mediated.
4. Narrow bootstrap injection to core long-term memory and move episodic/daily recall to explicit retrieval.
5. Update focused tests and docs.
6. Run simplify, coverage audit, required checks, and final review; then clean up the coordination row and commit scoped files.

## Outcome

- Added typed assistant memory search/get/upsert operations over Markdown-backed `assistant-state/` storage.
- Exposed those operations through real `vault-cli assistant memory ...` commands and regenerated Incur metadata.
- Reworked assistant chat turns so memory persistence is explicit and tool-mediated through a narrow localhost bridge instead of hidden post-turn heuristic commits.
- Reduced fresh-session bootstrap context to a small core long-term memory block and moved daily/project recall to explicit retrieval.
- Added focused assistant tests, updated runtime/docs, and added smoke manifests for the new documented commands.

## Verification

- Simplify pass: removed a stale long-term prompt helper and tightened the system prompt so typed assistant-memory upserts are the only read-only exception.
- Coverage audit: added missing smoke manifests for `assistant memory search|get|upsert`.
- Required checks passed:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
Completed: 2026-03-18
